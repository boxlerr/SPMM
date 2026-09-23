"use client";

import React from "react";
import {
    Ruler,
    Search,
    RefreshCw,
    X,
    Package,
    FileText,
    Eye,
    Download,
    Printer,
    Trash2,
    UploadCloud,
    Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";
import {
    descargarPlano,
    formatearBytes,
    imprimirPlano,
    olvidarPlano,
    traerArchivoPlano,
} from "@/lib/planos";
import { PlanoThumb } from "@/components/common/PlanoThumb";
import { FileViewerModal } from "@/components/common/FileViewerModal";
import { SubirPlanoModal } from "@/components/planos/SubirPlanoModal";
import { invalidarOrdenesConPlano } from "@/hooks/useOrdenesConPlano";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { filtroBusqueda, type ColumnaExport } from "@/lib/exportar";

/** El servidor todavía no tiene la sección de planos (ver el 404 más abajo). */
class SeccionNoDisponible extends Error {}

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Un plano de la biblioteca: el archivo más el producto del que cuelga.
 *
 * Vienen dos descripciones distintas y no dan lo mismo: `descripcion` es la del plano
 * —la escribe quien lo sube y casi siempre está vacía— y `descripcion_articulo` es la
 * del producto. En la tarjeta manda la del producto, que es la que dice qué pieza es.
 *
 * Un plano puede no tener producto: los que alguien adjuntó a una orden puntual
 * cuelgan de esa orden y llegan sin código. Aparecen igual, buscables por el nombre
 * del archivo.
 */
export interface PlanoBiblioteca {
    id: number;
    nombre: string;
    tipo_archivo: string;
    fecha_subida?: string | null;
    bytes?: number | null;
    id_articulo?: number | null;
    cod_articulo?: string | null;
    descripcion?: string | null;
    descripcion_articulo?: string | null;
    id_orden_trabajo?: number | null;
}

// De a cuántos se piden. La página en sí pesa poco (ninguna respuesta trae archivos,
// solo su tamaño); lo caro es dibujar las miniaturas, y esas salen recién cuando
// entran en pantalla, así que se puede pedir de a mucho sin que se note.
const POR_PAGINA = 48;

/** RF-22: qué es cada plano, de qué producto y cuándo se subió. */
const COLUMNAS_EXPORT: ColumnaExport<PlanoBiblioteca>[] = [
    { titulo: "Código", valor: (p) => p.cod_articulo?.trim() ?? "" },
    { titulo: "Producto", valor: (p) => p.descripcion_articulo?.trim() || p.descripcion?.trim() || "" },
    { titulo: "Archivo", valor: (p) => p.nombre },
    { titulo: "Tipo", valor: (p) => p.tipo_archivo ?? "" },
    { titulo: "Cargado en", valor: (p) => (p.id_orden_trabajo ? `OT ${p.id_orden_trabajo}` : p.id_articulo ? "Producto" : "") },
    { titulo: "Subido", tipo: "fechaHora", valor: (p) => p.fecha_subida },
    { titulo: "Tamaño (KB)", tipo: "numero", decimales: 0, valor: (p) => (p.bytes ? p.bytes / 1024 : null) },
];

export interface BibliotecaPlanosProps {
    className?: string;
    /** Título del encabezado propio. Solo se usa si `conEncabezado` está en true. */
    titulo?: string;
    /** Bajada del encabezado propio. Solo se usa si `conEncabezado` está en true. */
    subtitulo?: string;
    /**
     * Dibujar el encabezado grande (ícono + título + contador).
     *
     * En falso queda solo la barra de herramientas —buscador, contador chiquito,
     * Actualizar y Subir plano—, que es lo que hace falta cuando la biblioteca se monta
     * abajo de un título que ya está puesto (el caso de Recursos): dos títulos
     * encimados hacen parecer que son dos pantallas distintas.
     */
    conEncabezado?: boolean;
}

/**
 * La biblioteca de planos: todos los que hay, sin pasar por una orden.
 *
 * Hasta ahora un plano solo se veía abriendo la OT que lo usaba, y para eso había que
 * saber de antemano qué OT era. Acá se entra por donde el taller los tiene en la
 * cabeza: el código del producto.
 *
 * Vive como componente y no como pantalla porque lo mismo se monta adentro de Recursos:
 * los planos son un recurso más del taller y quien los administra ya está ahí.
 */
export function BibliotecaPlanos({
    className,
    titulo = "Planos",
    subtitulo = "Todos los planos cargados, buscables por código de producto",
    conEncabezado = true,
}: BibliotecaPlanosProps) {
    const base = API_URL.replace(/\/$/, "");

    const [items, setItems] = React.useState<PlanoBiblioteca[]>([]);
    const [total, setTotal] = React.useState(0);
    const [cargando, setCargando] = React.useState(true);
    const [cargandoMas, setCargandoMas] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    // `busqueda` es lo que se está tecleando y `consulta` lo que ya salió a buscar:
    // son cientos de planos y el filtro lo hace el servidor, así que cada letra sería
    // un pedido.
    const [busqueda, setBusqueda] = React.useState("");
    const [consulta, setConsulta] = React.useState("");

    /** Cuál se está mirando en grande. `null` = el visor está cerrado. */
    const [abierto, setAbierto] = React.useState<number | null>(null);
    /** Cuál está esperando el "sí, borralo". */
    const [aBorrar, setABorrar] = React.useState<PlanoBiblioteca | null>(null);
    const [subidaAbierta, setSubidaAbierta] = React.useState(false);

    // Cada pedido se numera y solo contesta el último: escribiendo rápido salen varios
    // en paralelo y no vuelven en orden, así que sin esto la lista puede terminar
    // mostrando el resultado de lo que se tipeó dos letras antes.
    const ultimoPedido = React.useRef(0);

    const cargar = React.useCallback(
        async (texto: string, desde: number) => {
            const mio = ++ultimoPedido.current;
            if (desde === 0) {
                setCargando(true);
                // La lista se rearma entera: el índice que tenía el visor abierto ya no
                // apunta al mismo plano.
                setAbierto(null);
            } else {
                setCargandoMas(true);
            }
            setError(null);

            try {
                const params = new URLSearchParams({
                    limit: String(POR_PAGINA),
                    offset: String(desde),
                });
                const limpio = texto.trim();
                if (limpio) params.set("buscar", limpio);

                const res = await fetch(`${base}/planos/biblioteca?${params.toString()}`, {
                    headers: getAuthHeaders(),
                });
                // El 404 se distingue del resto a propósito. El front sale por Vercel
                // apenas se pushea, y el servidor se actualiza a mano: existe la ventana
                // en la que esta pantalla ya está publicada y el servidor todavía no sabe
                // de planos. Echarle la culpa a la conexión en ese rato manda a todo el
                // taller a revisar el wifi por algo que no tiene arreglo de su lado.
                // 404 y 422 son la misma situación vista desde dos servidores: el que
                // no conoce la ruta contesta 404, y el ANTERIOR —que solo tiene
                // /planos/{id}— toma "biblioteca" como si fuera el id, no puede
                // convertirlo a número y contesta 422. Mirar solo el 404 dejaba al taller
                // con el mensaje de "fijate la conexión" justo en la ventana entre que
                // sale el front y se actualiza el servidor, que es cuando más pasa.
                if (res.status === 404 || res.status === 422) throw new SeccionNoDisponible();
                if (!res.ok) throw new Error(`Error ${res.status}`);

                const json = await res.json();
                if (mio !== ultimoPedido.current) return;

                const pagina: PlanoBiblioteca[] = Array.isArray(json?.data) ? json.data : [];
                setItems((previos) => (desde === 0 ? pagina : [...previos, ...pagina]));
                setTotal(Number(json?.total) || 0);
            } catch (e) {
                if (mio !== ultimoPedido.current) return;
                console.error("Error trayendo la biblioteca de planos", e);
                setError(
                    e instanceof SeccionNoDisponible
                        ? "Los planos todavía no están disponibles en el servidor. Es cuestión de que se actualice: probá de nuevo más tarde."
                        : "No se pudieron traer los planos. Fijate la conexión y probá de nuevo."
                );
                // Solo se vacía si falló la primera página: si falló un "Ver más", lo que
                // ya está en pantalla sigue sirviendo.
                if (desde === 0) {
                    setItems([]);
                    setTotal(0);
                }
            } finally {
                if (mio === ultimoPedido.current) {
                    setCargando(false);
                    setCargandoMas(false);
                }
            }
        },
        [base]
    );

    React.useEffect(() => {
        const t = setTimeout(() => setConsulta(busqueda), 300);
        return () => clearTimeout(t);
    }, [busqueda]);

    React.useEffect(() => {
        cargar(consulta, 0);
    }, [consulta, cargar]);

    /**
     * Qué planos están bajándose para descargar o imprimir.
     *
     * Los dos botones tardan lo que tarde el archivo —el más pesado de la carpeta del
     * taller son 13 MB— y hasta acá no mostraban nada mientras tanto. Sobre la conexión
     * del taller eso son varios segundos sin señal, y el que toca de nuevo termina con
     * tres diálogos de impresión encimados (la bajada se comparte, la impresión no).
     */
    const [ocupados, setOcupados] = React.useState<Set<number>>(new Set());
    const marcarOcupado = (id: number, si: boolean) =>
        setOcupados((previos) => {
            const copia = new Set(previos);
            if (si) copia.add(id);
            else copia.delete(id);
            return copia;
        });

    const descargar = async (plano: PlanoBiblioteca) => {
        if (ocupados.has(plano.id)) return;
        marcarOcupado(plano.id, true);
        try {
            await descargarPlano(plano.id, plano.nombre);
        } catch {
            toast.error("No se pudo descargar el plano.");
        } finally {
            marcarOcupado(plano.id, false);
        }
    };

    /**
     * Imprimir sin abrir el visor.
     *
     * El archivo hay que bajarlo igual —el endpoint pide token, así que no se le puede
     * apuntar nada directo—, pero si ya se dibujó la miniatura está en el cache y sale
     * en el acto. Lo demás lo resuelve `imprimirPlano`, que es la misma función que usa
     * el visor: la parte delicada (esperar a que el archivo cargue antes de mandar a
     * imprimir, o la hoja sale en blanco) está escrita una sola vez.
     */
    const imprimir = async (plano: PlanoBiblioteca) => {
        if (ocupados.has(plano.id)) return;
        marcarOcupado(plano.id, true);
        try {
            const blob = await traerArchivoPlano(plano.id);
            const como = await imprimirPlano(blob, plano.nombre, plano.tipo_archivo);
            if (como === "en_pestana") {
                toast.info("Se abrió el plano en una pestaña nueva: imprimilo desde ahí.");
            }
        } catch (e) {
            console.error("Error imprimiendo el plano", e);
            toast.error(e instanceof Error ? e.message : "No se pudo imprimir el plano.");
        } finally {
            marcarOcupado(plano.id, false);
        }
    };

    const confirmarBorrado = async () => {
        const plano = aBorrar;
        if (!plano) return;

        try {
            const res = await fetch(`${base}/planos/${plano.id}`, {
                method: "DELETE",
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error(`Error ${res.status}`);

            setItems((previos) => previos.filter((p) => p.id !== plano.id));
            setTotal((n) => Math.max(0, n - 1));
            // La lista se acortó: el índice que tenía el visor ya no apunta al mismo
            // plano, así que se cierra en vez de mostrar otro.
            setAbierto(null);
            // El archivo y su miniatura quedan guardados por id: si no se olvidan, un
            // plano nuevo con ese mismo id mostraría el dibujo del que se borró.
            olvidarPlano(plano.id);
            // Solo si el plano era de una ORDEN. La columna Plano de las tablas de
            // planificación sale de una lista cacheada, y esa lista mira únicamente los
            // planos pegados a una orden: el del producto nunca entra (es la regla que
            // evita prender solo el filtro de interpretación de planos, ver
            // find_ordenes_con_plano). Llamarlo para un plano de producto sería un
            // refresco al pedo y haría creer que esa columna se actualiza sola.
            if (plano.id_orden_trabajo != null) invalidarOrdenesConPlano();
            toast.success("Se eliminó el plano");
        } catch (e) {
            console.error("Error borrando el plano", e);
            toast.error("No se pudo eliminar el plano.");
        }
    };

    /**
     * Qué se pierde al borrar, dicho antes de borrarlo.
     *
     * Un plano de producto no es un adjunto de una orden: lo comparten TODAS las OTs que
     * fabrican esa pieza, las que ya están planificadas incluidas. Desde acá no se ve
     * ninguna orden, así que si el cartel no lo dice, borrarlo parece que saca un
     * archivo de una lista.
     */
    const textoBorrado = (plano: PlanoBiblioteca | null): string => {
        if (!plano) return "";
        const codigo = plano.cod_articulo?.trim();
        if (codigo) {
            return `Vas a eliminar «${plano.nombre}», que es el plano del producto ${codigo}. No se saca de una orden sola: se va a dejar de ver en TODAS las órdenes que fabriquen ese producto, incluidas las que ya están planificadas. Esto no se puede deshacer.`;
        }
        return `Vas a eliminar «${plano.nombre}». Este plano lo subieron a una orden puntual, así que se va a dejar de ver ahí. Esto no se puede deshacer.`;
    };

    const hayMas = items.length < total;
    const buscando = consulta.trim().length > 0;

    const buscador = (
        <div className="relative w-full max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Buscar por código, producto o nombre del archivo..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="pl-8 pr-8"
            />
            {busqueda && (
                <button
                    type="button"
                    onClick={() => setBusqueda("")}
                    title="Limpiar la búsqueda"
                    className="absolute right-2 top-2 p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );

    const acciones = (
        <>
            {/* RF-22: los planos que ya trajo la grilla, con la búsqueda puesta. */}
            <ExportarMenu
                titulo="Planos"
                archivo="planos"
                filas={items}
                columnas={COLUMNAS_EXPORT}
                disabled={cargando}
                filtros={() => filtroBusqueda(consulta)}
                aviso={hayMas
                    ? `Salen los ${items.length} que ya se ven, de ${total}. Para sumar más, tocá «Ver más planos» abajo.`
                    : undefined}
            />
            <Button onClick={() => setSubidaAbierta(true)} size="sm">
                <UploadCloud className="h-4 w-4 mr-2" />
                Subir plano
            </Button>
            <Button
                onClick={() => cargar(consulta, 0)}
                disabled={cargando}
                variant="outline"
                size="sm"
            >
                <RefreshCw className={cn("h-4 w-4 mr-2", cargando && "animate-spin")} />
                Actualizar
            </Button>
        </>
    );

    return (
        <div className={cn("space-y-4", className)}>
            {conEncabezado ? (
                // RF-27: 16px de relleno en el teléfono en vez de 24, y el contador con los
                // dos botones puede bajar de renglón: en una fila, «Actualizar» se salía
                // de la tarjeta por la derecha.
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-100 rounded-lg">
                                <Ruler className="w-6 h-6 text-red-600" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">{titulo}</h1>
                                <p className="text-sm text-gray-500">{subtitulo}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <div className="text-right">
                                <p className="text-2xl font-bold text-gray-900 tabular-nums leading-none">
                                    {cargando ? "—" : total}
                                </p>
                                <p className="text-[11px] font-medium text-gray-400 mt-1">
                                    {buscando ? "coinciden" : total === 1 ? "plano cargado" : "planos cargados"}
                                </p>
                            </div>
                            {acciones}
                        </div>
                    </div>

                    <div className="mt-4">{buscador}</div>
                </div>
            ) : (
                // Sin encabezado propio el contador se vuelve una línea al lado del
                // buscador: el número sigue haciendo falta (dice si el filtro encontró
                // algo), pero en grande competiría con el título de la pantalla que la
                // está montando.
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                        {buscador}
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                            {cargando
                                ? "—"
                                : `${total} ${buscando ? "coinciden" : total === 1 ? "plano" : "planos"}`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">{acciones}</div>
                </div>
            )}

            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Grilla */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
                {cargando ? (
                    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={i}
                                className="rounded-xl border border-gray-200 bg-white p-3 animate-pulse"
                            >
                                <div className="h-28 w-full bg-slate-100 rounded-lg" />
                                <div className="h-3 w-2/3 bg-slate-100 rounded mt-3" />
                                <div className="h-2.5 w-full bg-slate-100 rounded mt-2" />
                            </div>
                        ))}
                    </div>
                ) : items.length === 0 ? (
                    <div className="py-16 text-center">
                        <div className="w-14 h-14 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-4">
                            <Ruler className="w-6 h-6 text-gray-300" />
                        </div>
                        {buscando ? (
                            <>
                                <p className="text-base font-semibold text-gray-700">
                                    No hay ningún plano que coincida con «{consulta.trim()}»
                                </p>
                                <p className="text-sm text-gray-500 mt-1">
                                    Probá con el código del producto, con una palabra de la
                                    descripción o con el nombre del archivo.
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-base font-semibold text-gray-700">
                                    Todavía no hay planos cargados
                                </p>
                                <p className="text-sm text-gray-500 mt-1">
                                    Subí el primero con «Subir plano» y va a quedar pegado al
                                    producto que elijas.
                                </p>
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                            {items.map((plano, i) => {
                                const codigo = plano.cod_articulo?.trim();
                                const producto =
                                    plano.descripcion_articulo?.trim() || plano.descripcion?.trim();

                                return (
                                    // La tarjeta dejó de ser un <button>: adentro hay más
                                    // botones (descargar, imprimir, eliminar) y un botón
                                    // adentro de otro no es HTML válido. El click en la
                                    // tarjeta lo sigue tomando el botón grande de adentro,
                                    // así que abrir el plano se siente igual que antes.
                                    <div
                                        key={plano.id}
                                        className="group relative p-3 rounded-xl border border-gray-200 bg-white shadow-sm hover:border-blue-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setAbierto(i)}
                                            title={`Ver ${plano.nombre}`}
                                            className="w-full text-left cursor-zoom-in rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                                        >
                                            <PlanoThumb plano={plano} className="h-28 border-slate-100" />

                                            <div className="mt-3 min-w-0">
                                                {codigo ? (
                                                    <p className="text-base font-bold text-gray-900 truncate leading-tight">
                                                        {codigo}
                                                    </p>
                                                ) : (
                                                    <p className="text-base font-bold text-gray-400 truncate leading-tight">
                                                        Sin código
                                                    </p>
                                                )}

                                                {producto ? (
                                                    <p
                                                        className="text-xs text-gray-600 mt-1 leading-snug line-clamp-2"
                                                        title={producto}
                                                    >
                                                        <Package className="w-3 h-3 inline-block mr-1 -mt-0.5 text-gray-400" />
                                                        {producto}
                                                    </p>
                                                ) : (
                                                    <p className="text-xs text-gray-400 mt-1 italic">
                                                        Cargado desde una orden
                                                    </p>
                                                )}

                                                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100 min-w-0">
                                                    <FileText className="w-3 h-3 text-gray-300 flex-shrink-0" />
                                                    <span
                                                        className="text-[11px] text-gray-400 truncate"
                                                        title={plano.nombre}
                                                    >
                                                        {plano.nombre}
                                                    </span>
                                                    <span className="text-[11px] text-gray-300 whitespace-nowrap ml-auto">
                                                        {formatearBytes(plano.bytes)}
                                                    </span>
                                                </div>
                                            </div>
                                        </button>

                                        {/* Las acciones salen al pasar el mouse y con el foco del
                                            teclado: apoyadas sobre la miniatura tapan el dibujo, y
                                            en una grilla de 48 tarjetas dejarlas siempre visibles
                                            es un tablero de botones. Mientras no se ven tampoco
                                            reciben clicks. */}
                                        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg border border-gray-100 bg-white/95 p-0.5 shadow-sm opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
                                            <button
                                                type="button"
                                                onClick={() => setAbierto(i)}
                                                title="Ver el plano"
                                                className="p-1.5 rounded-md text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void descargar(plano)}
                                                disabled={ocupados.has(plano.id)}
                                                title={ocupados.has(plano.id) ? "Trayendo el plano…" : "Descargar el plano"}
                                                className="p-1.5 rounded-md text-gray-500 hover:text-green-600 hover:bg-green-50 transition-colors disabled:opacity-40 disabled:cursor-wait"
                                            >
                                                {ocupados.has(plano.id)
                                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    : <Download className="w-3.5 h-3.5" />}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void imprimir(plano)}
                                                disabled={ocupados.has(plano.id)}
                                                title={ocupados.has(plano.id) ? "Trayendo el plano…" : "Imprimir el plano"}
                                                className="p-1.5 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:cursor-wait"
                                            >
                                                <Printer className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setABorrar(plano)}
                                                title="Eliminar el plano"
                                                className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-6 flex flex-col items-center gap-2">
                            <p className="text-xs text-gray-400">
                                Mostrando {items.length} de {total}
                            </p>
                            {hayMas && (
                                <Button
                                    onClick={() => cargar(consulta, items.length)}
                                    disabled={cargandoMas}
                                    variant="outline"
                                    size="sm"
                                >
                                    {cargandoMas ? (
                                        <>
                                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                            Trayendo...
                                        </>
                                    ) : (
                                        "Ver más planos"
                                    )}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* El visor se lleva la lista entera para que las flechas pasen de un plano al
                siguiente sin volver a la grilla: el que compara dos piezas parecidas los
                mira uno atrás del otro. */}
            <FileViewerModal
                isOpen={abierto !== null}
                onClose={() => setAbierto(null)}
                file={abierto !== null ? items[abierto] ?? null : null}
                planos={items}
                indice={abierto ?? 0}
                onIndiceChange={setAbierto}
            />

            <ConfirmationDialog
                isOpen={!!aBorrar}
                onClose={() => setABorrar(null)}
                onConfirm={confirmarBorrado}
                title="Eliminar el plano"
                description={textoBorrado(aBorrar)}
                confirmText="Eliminar"
                cancelText="Cancelar"
                variant="destructive"
            />

            <SubirPlanoModal
                abierto={subidaAbierta}
                onClose={() => setSubidaAbierta(false)}
                onSubido={() => cargar(consulta, 0)}
            />
        </div>
    );
}
