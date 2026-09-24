"use client";

/**
 * Materia prima › Insumos: el catálogo de insumos, con la ficha de cada uno al costado.
 *
 * LA LISTA LA ARMA EL SERVIDOR
 *
 * Son unas 17.800 piezas: no se bajan enteras para filtrar en el navegador. La búsqueda
 * y los filtros viajan al servidor (de a 50, con páginas), con una espera después de
 * tipear y descartando las respuestas viejas: si «barra» tarda más que «barra redo», la
 * de «barra» llega última y NO pisa la lista (el cuidado que tenía la vieja solapa de
 * Operaciones con su `ultimoPedido`). Mientras llega la nueva, la anterior queda a la
 * vista, apenas apagada: nada de un spinner que tape lo que se estaba mirando.
 *
 * LA FICHA AL COSTADO
 *
 * Tocar una fila abre su ficha a la derecha (en la computadora, un panel fijo de 560 px
 * que acompaña el scroll; en el teléfono, la pantalla entera con «volver»). La lista no
 * se va: se puede ir de un insumo a otro sin perder la búsqueda. Con la ficha abierta
 * la lista tiene menos lugar y esconde columnas sola (por el ancho de SU caja, no el de
 * la ventana: `@container`); lo escondido pasa a un renglón chico debajo de la
 * descripción, así no se pierde nada.
 *
 * Lo que se cambia en la ficha (datos, stock, precio, recortes) se pinta en la fila al
 * instante, sin volver a pedir la lista. Un alta aparece arriba de todo, marcada.
 *
 * Si hay cambios sin guardar en la ficha y se toca otra fila (o se cierra), la ficha
 * pregunta antes de tirarlos.
 *
 * Vino a reemplazar la solapa «Materia Prima» de Operaciones (stock mínimo, RF-14): el
 * punto crítico está en la ficha y los filtros «Con mínimo» / «Bajo mínimo», acá.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Filter, Loader2, PackageSearch, Plus, Scissors, Search, X } from "lucide-react";
import { API_URL } from "@/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { filtroBusqueda, type ColumnaExport } from "@/lib/exportar";
import {
    consulta,
    fmtCantidad,
    fmtFecha,
    fmtPrecio,
    mpGet,
    rotuloTipo,
    TIPOS_INSUMO,
    type InsumoFicha,
    type InsumoFila,
    type Paginado,
    type TipoInsumo,
} from "@/lib/materiaPrima";
import { FichaInsumo, filaDe } from "./FichaInsumo";
import { useCatalogosMP } from "./InsumoCatalogos";
import { CartelError, CartelSinServidor } from "./InsumoComun";

export interface InsumosTabProps {
    edita: boolean;
    /** El insumo que pidió un enlace (`?pieza=ID`: la campanita de stock bajo). Se abre su ficha. */
    piezaInicial?: number | null;
    /** Vino `?nuevo=1`: se abre la ficha de alta. */
    nuevoInicial?: boolean;
}

const POR_PAGINA = 50;
const ESPERA_BUSQUEDA_MS = 400;

interface Filtros {
    tipo: TipoInsumo | null;
    id_material: number | null;
    id_formato: number | null;
    con_stock: boolean;
    bajo_minimo: boolean;
    con_minimo: boolean;
    inactivos: boolean;
}

const SIN_FILTROS: Filtros = {
    tipo: null,
    id_material: null,
    id_formato: null,
    con_stock: false,
    bajo_minimo: false,
    con_minimo: false,
    inactivos: false,
};

const ROTULO_TIPO_CORTO: Record<TipoInsumo, string> = {
    insumo: "Insumo",
    insumo_desc: "c/ descripción",
    consumible: "Consumible",
};

type Activa = number | "nuevo" | null;

const ubicacionDe = (f: Pick<InsumoFila, "estante" | "letra" | "nro">) => [f.estante, f.letra, f.nro].filter(Boolean).join(" · ");

export function InsumosTab({ edita, piezaInicial = null, nuevoInicial = false }: InsumosTabProps) {
    const { catalogos } = useCatalogosMP();

    // ─────────────── la lista ───────────────

    const [texto, setTexto] = useState("");
    const [busqueda, setBusqueda] = useState("");
    const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
    const [pagina, setPagina] = useState(1);
    const [filas, setFilas] = useState<InsumoFila[] | null>(null);
    const [total, setTotal] = useState(0);
    const [paginas, setPaginas] = useState(1);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);
    const [recarga, setRecarga] = useState(0);
    /** Altas de esta sesión: se ven arriba y marcadas aunque no entren en el filtro. */
    const [recienCreados, setRecienCreados] = useState<number[]>([]);

    const ultimo = useRef(0);
    const control = useRef<AbortController | null>(null);

    // La búsqueda sale un rato después de la última tecla, y vuelve a la primera página.
    useEffect(() => {
        const t = texto.trim();
        if (t === busqueda) return;
        const espera = setTimeout(() => {
            setBusqueda(t);
            setPagina(1);
        }, ESPERA_BUSQUEDA_MS);
        return () => clearTimeout(espera);
    }, [texto, busqueda]);

    useEffect(() => {
        const n = ++ultimo.current;
        control.current?.abort();
        const c = new AbortController();
        control.current = c;
        setCargando(true);
        void (async () => {
            const r = await mpGet<Paginado<InsumoFila>>(
                `${API_URL}/materia-prima/insumos?${consulta({
                    search: busqueda,
                    tipo: filtros.tipo,
                    id_material: filtros.id_material,
                    id_formato: filtros.id_formato,
                    // Los filtros apagados no se mandan: el backend ya los tiene en false.
                    con_stock: filtros.con_stock || null,
                    bajo_minimo: filtros.bajo_minimo || null,
                    con_minimo: filtros.con_minimo || null,
                    inactivos: filtros.inactivos || null,
                    page: pagina,
                    size: POR_PAGINA,
                })}`,
                { signal: c.signal },
            );
            if (n !== ultimo.current || r.abortado) return;
            setCargando(false);
            setSinServidor(r.sinServidor);
            if (!r.ok || !r.data) {
                // Se vacía: si no, debajo del error quedarían las filas del filtro ANTERIOR
                // como si fueran las del que se acaba de pedir.
                setFilas([]);
                setTotal(0);
                setPaginas(1);
                setError(r.sinServidor ? null : (r.error ?? "No se pudo traer la lista de insumos."));
                return;
            }
            setError(null);
            setFilas(Array.isArray(r.data.data) ? r.data.data : []);
            setTotal(r.data.total_count ?? 0);
            setPaginas(Math.max(1, r.data.total_pages ?? 1));
        })();
    }, [busqueda, filtros, pagina, recarga]);

    useEffect(() => () => control.current?.abort(), []);

    const cambiarFiltro = <K extends keyof Filtros>(clave: K, valor: Filtros[K]) => {
        setFiltros((f) => ({ ...f, [clave]: valor }));
        setPagina(1);
    };
    const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(SIN_FILTROS) || texto.trim() !== "";
    const limpiar = () => {
        setFiltros(SIN_FILTROS);
        setTexto("");
        setBusqueda("");
        setPagina(1);
    };

    /** Pinta un cambio en una fila (lo que se tocó en la ficha), sin pedir la lista. */
    const parchearFila = useCallback((id: number, parcial: Partial<InsumoFila>) => {
        setFilas((fs) => (fs ? fs.map((f) => (f.id === id ? { ...f, ...parcial } : f)) : fs));
    }, []);

    // ─────────────── la ficha ───────────────

    const [activa, setActiva] = useState<Activa>(() => (nuevoInicial ? "nuevo" : piezaInicial));
    const [fichaInicial, setFichaInicial] = useState<InsumoFicha | null>(null);
    /** Cuántas altas se abrieron: la llave de la ficha de alta (cada «Nuevo insumo» arranca en blanco). */
    const [nAlta, setNAlta] = useState(0);
    const sucio = useRef(false);
    const [pendiente, setPendiente] = useState<(() => void) | null>(null);

    const alSucio = useCallback((s: boolean) => {
        sucio.current = s;
    }, []);

    /** Hace algo que cambia de ficha; si hay cambios sin guardar, primero lo pregunta la ficha. */
    const pedir = useCallback((accion: () => void) => {
        if (sucio.current) {
            setPendiente(() => accion);
            return;
        }
        accion();
    }, []);

    const abrir = (id: number) => {
        if (id === activa) return;
        pedir(() => {
            setFichaInicial(null);
            setActiva(id);
        });
    };
    const abrirAlta = () =>
        pedir(() => {
            setFichaInicial(null);
            setNAlta((n) => n + 1);
            setActiva("nuevo");
        });
    const cerrar = () => pedir(() => setActiva(null));

    // Que el navegador avise si se cierra la pestaña con la ficha a medio editar.
    useEffect(() => {
        const antes = (e: BeforeUnloadEvent) => {
            if (!sucio.current) return;
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", antes);
        return () => window.removeEventListener("beforeunload", antes);
    }, []);

    const alCreado = (f: InsumoFicha, otro: boolean) => {
        const fila = filaDe(f);
        setFilas((fs) => [fila, ...(fs ?? []).filter((x) => x.id !== f.id)]);
        setTotal((t) => t + 1);
        setRecienCreados((r) => [f.id, ...r]);
        if (!otro) {
            sucio.current = false;
            setFichaInicial(f);
            setActiva(f.id);
        }
    };

    const alBorrado = (id: number) => {
        sucio.current = false;
        setFilas((fs) => (fs ? fs.filter((f) => f.id !== id) : fs));
        setTotal((t) => Math.max(0, t - 1));
        setActiva(null);
    };

    // Llevar a la vista la fila que pidió el enlace, UNA vez, cuando aparece.
    const desplazarA = useRef<number | null>(piezaInicial);
    useEffect(() => {
        const id = desplazarA.current;
        if (!id || !filas) return;
        const fila = document.getElementById(`insumo-${id}`);
        if (fila) {
            fila.scrollIntoView({ block: "center", behavior: "smooth" });
            desplazarA.current = null;
        }
    }, [filas]);

    // ─────────────── exportar ───────────────

    const columnasExport: ColumnaExport<InsumoFila>[] = useMemo(() => [
        { titulo: "Código", valor: (f) => f.codigo },
        { titulo: "Descripción", valor: (f) => f.descripcion },
        { titulo: "Tipo", valor: (f) => rotuloTipo(f.tipo) },
        { titulo: "Material", valor: (f) => [f.material, f.calidad].filter(Boolean).join(" ") },
        { titulo: "Formato", valor: (f) => f.formato ?? "" },
        { titulo: "Stock físico", tipo: "numero", valor: (f) => f.stock },
        { titulo: "Reservado", tipo: "numero", valor: (f) => f.reservado },
        { titulo: "Libre", tipo: "numero", valor: (f) => f.libre },
        { titulo: "Punto crítico", tipo: "numero", valor: (f) => f.stock_minimo },
        { titulo: "Bajo mínimo", tipo: "booleano", valor: (f) => f.bajo_minimo },
        { titulo: "Unidad", valor: (f) => f.unidad ?? "" },
        { titulo: "Precio", tipo: "moneda", valor: (f) => f.unitario },
        { titulo: "Fecha del precio", tipo: "fecha", valor: (f) => f.fecha_ultimo_precio },
        { titulo: "Ubicación", valor: (f) => ubicacionDe(f) },
        { titulo: "Proveedor", valor: (f) => f.proveedor ?? "" },
        { titulo: "Recortes disponibles", tipo: "entero", valor: (f) => f.recortes_disponibles || null },
        { titulo: "Inactivo", tipo: "booleano", valor: (f) => f.inactivo },
    ], []);

    const nombreMaterial = catalogos?.materiales.find((m) => m.id === filtros.id_material)?.nombre ?? null;
    const nombreFormato = catalogos?.formatos.find((f) => f.id === filtros.id_formato)?.nombre ?? null;

    const filtrosExport = () => [
        ...filtroBusqueda(busqueda),
        ...(filtros.tipo ? [`Tipo: ${rotuloTipo(filtros.tipo)}`] : []),
        ...(nombreMaterial ? [`Material: ${nombreMaterial}`] : []),
        ...(nombreFormato ? [`Formato: ${nombreFormato}`] : []),
        ...(filtros.con_stock ? ["Con stock"] : []),
        ...(filtros.bajo_minimo ? ["Bajo mínimo"] : []),
        ...(filtros.con_minimo ? ["Con mínimo"] : []),
        ...(filtros.inactivos ? ["Incluye inactivos"] : []),
        ...(paginas > 1 ? [`Página ${pagina} de ${paginas} (${filas?.length ?? 0} de ${total} insumos)`] : []),
    ];

    // ─────────────── dibujo ───────────────

    // Un alta sin poder escribir no se muestra: sería un formulario vacío «para leer».
    // Pasa con un `?nuevo=1` en la prueba piloto (ver ModoEspejo.tsx) o sin permiso. Si
    // `edita` llega un instante después (se estaba averiguando el dueño), el alta aparece.
    const fichaAbierta = activa !== null && (activa !== "nuevo" || edita);
    const desde = total ? (pagina - 1) * POR_PAGINA + 1 : 0;
    const hasta = Math.min(total, (pagina - 1) * POR_PAGINA + (filas?.length ?? 0));

    const alTeclearFila = (e: KeyboardEvent<HTMLTableRowElement>, id: number) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            abrir(id);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const hermana = (e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
            hermana?.focus();
        }
    };

    return (
        // Con la ficha abierta: la ficha crece hasta 560 px y la lista se queda con el resto,
        // pero nunca menos de 16 rem (código, descripción y stock; y «Exportar» y «Nuevo
        // insumo» en un renglón). En una pantalla de 1024 la ficha queda de ~400 px; desde
        // ~1300, de 560.
        <div className={cn("grid items-start gap-4", fichaAbierta && "lg:grid-cols-[minmax(16rem,1fr)_minmax(22rem,560px)]")}>
            {/* ═════════ la lista ═════════ */}
            <section className="min-w-0 space-y-3" aria-label="Lista de insumos">
                {/* Buscador y botones. Envuelven en vez de apretarse: con la ficha abierta
                    en 1024 la lista mide ~16 rem, y en una sola fila el buscador quedaba en
                    66 px (no se veía lo escrito) y «Exportar» salía recortado (E2E del
                    24/09). El buscador nunca baja de 12 rem: si no entra con los botones,
                    va solo en su renglón y los botones abajo, a la derecha. */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[12rem] flex-[1_1_12rem] sm:max-w-md">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            value={texto}
                            onChange={(e) => setTexto(e.target.value)}
                            placeholder="Buscar por código o descripción…"
                            aria-label="Buscar insumos por código o descripción"
                            autoComplete="off"
                            spellCheck={false}
                            className="h-9 w-full rounded-md border border-gray-200 bg-white pl-8 pr-8 text-sm shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 [&::-webkit-search-cancel-button]:hidden"
                        />
                        {cargando && filas ? (
                            <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
                        ) : texto ? (
                            <button
                                type="button"
                                onClick={() => setTexto("")}
                                aria-label="Vaciar la búsqueda"
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        ) : null}
                    </div>
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <ExportarMenu
                            titulo="Insumos de materia prima"
                            archivo="insumos"
                            filas={filas ?? []}
                            columnas={columnasExport}
                            filtros={filtrosExport}
                            disabled={!filas?.length || sinServidor}
                            aviso={paginas > 1
                                ? `Sale la página que estás viendo: ${filas?.length ?? 0} de ${total.toLocaleString("es-AR")}. Para otra parte, pasá de página o filtrá.`
                                : undefined}
                        />
                        {edita && (
                            <Button
                                type="button"
                                size="sm"
                                onClick={abrirAlta}
                                disabled={sinServidor}
                                className="h-9 bg-[#DC143C] text-white hover:bg-[#B01030]"
                            >
                                <Plus className="h-4 w-4" />
                                Nuevo insumo
                            </Button>
                        )}
                    </div>
                </div>

                {/* Filtros en chips */}
                {!sinServidor && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Filter className="mr-0.5 h-3.5 w-3.5 text-gray-400" aria-hidden />
                        {TIPOS_INSUMO.map((t) => (
                            <Chip
                                key={t.valor}
                                activo={filtros.tipo === t.valor}
                                onClick={() => cambiarFiltro("tipo", filtros.tipo === t.valor ? null : t.valor)}
                                title={t.nombre}
                            >
                                {ROTULO_TIPO_CORTO[t.valor]}
                            </Chip>
                        ))}
                        <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden />
                        <ChipDesplegable
                            rotulo="Material"
                            elegido={nombreMaterial}
                            opciones={(catalogos?.materiales ?? []).map((m) => ({ id: m.id, nombre: m.nombre }))}
                            onElegir={(id) => cambiarFiltro("id_material", id)}
                        />
                        <ChipDesplegable
                            rotulo="Formato"
                            elegido={nombreFormato}
                            opciones={(catalogos?.formatos ?? []).map((f) => ({ id: f.id, nombre: f.nombre }))}
                            onElegir={(id) => cambiarFiltro("id_formato", id)}
                        />
                        <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden />
                        <Chip activo={filtros.con_stock} onClick={() => cambiarFiltro("con_stock", !filtros.con_stock)} title="Sólo los que tienen stock físico">
                            Con stock
                        </Chip>
                        <Chip
                            activo={filtros.bajo_minimo}
                            peligro
                            onClick={() => cambiarFiltro("bajo_minimo", !filtros.bajo_minimo)}
                            title="El stock físico está abajo del punto crítico"
                        >
                            Bajo mínimo
                        </Chip>
                        <Chip activo={filtros.con_minimo} onClick={() => cambiarFiltro("con_minimo", !filtros.con_minimo)} title="Los que tienen punto crítico cargado">
                            Con mínimo
                        </Chip>
                        <Chip activo={filtros.inactivos} onClick={() => cambiarFiltro("inactivos", !filtros.inactivos)} title="Mostrar también los inactivos (los que ya no se compran)">
                            Inactivos
                        </Chip>
                        {hayFiltros && (
                            <button type="button" onClick={limpiar} className="ml-1 text-xs font-medium text-gray-500 hover:text-gray-800 hover:underline">
                                Limpiar
                            </button>
                        )}
                    </div>
                )}

                {sinServidor && <CartelSinServidor />}
                {error && <CartelError mensaje={error} onReintentar={() => setRecarga((n) => n + 1)} />}

                {/* La tabla. `@container`: las columnas se esconden por el ancho de esta
                    caja (con la ficha abierta es la mitad), no por el de la ventana. */}
                {!sinServidor && (
                    <div className="@container overflow-hidden rounded-lg border border-gray-200 bg-white">
                        <table className="w-full text-sm">
                            <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold">Código</th>
                                    <th className="px-3 py-2 text-left font-semibold">Descripción</th>
                                    <th className="hidden px-3 py-2 text-left font-semibold @4xl:table-cell">Tipo</th>
                                    <th className="px-3 py-2 text-right font-semibold" title="Libre (lo no reservado para una OT) y, si hay reservas, el físico">Stock</th>
                                    <th className="hidden px-2 py-2 text-left font-semibold @2xl:table-cell">Un</th>
                                    <th className="hidden px-3 py-2 text-right font-semibold @3xl:table-cell">Precio</th>
                                    <th className="hidden px-3 py-2 text-left font-semibold @5xl:table-cell">Ubicación</th>
                                    <th className="hidden px-3 py-2 text-left font-semibold @5xl:table-cell">Proveedor</th>
                                    <th className="hidden w-10 px-2 py-2 @lg:table-cell" aria-label="Recortes" />
                                </tr>
                            </thead>
                            <tbody className={cn("divide-y divide-gray-100 transition-opacity", cargando && filas && "opacity-60")}>
                                {!filas ? (
                                    Array.from({ length: 8 }, (_, i) => (
                                        <tr key={i} aria-hidden>
                                            <td colSpan={9} className="px-3 py-2.5">
                                                <div className="h-5 animate-pulse rounded bg-gray-100" style={{ opacity: 1 - i * 0.1 }} />
                                            </td>
                                        </tr>
                                    ))
                                ) : filas.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-10 text-center">
                                            <PackageSearch className="mx-auto mb-2 h-7 w-7 text-gray-300" />
                                            <p className="text-sm font-medium text-gray-600">
                                                {filtros.bajo_minimo
                                                    ? "Ningún insumo está abajo de su punto crítico."
                                                    : filtros.con_minimo
                                                        ? "Todavía no hay insumos con punto crítico cargado."
                                                        : hayFiltros
                                                            ? "No hay insumos con esa búsqueda o esos filtros."
                                                            : "Todavía no hay insumos cargados."}
                                            </p>
                                            {hayFiltros && (
                                                <button type="button" onClick={limpiar} className="mt-1 text-xs font-medium text-blue-700 hover:underline">
                                                    Limpiar la búsqueda y los filtros
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filas.map((f) => (
                                        <FilaInsumo
                                            key={f.id}
                                            f={f}
                                            activa={f.id === activa}
                                            nueva={recienCreados.includes(f.id)}
                                            onAbrir={() => abrir(f.id)}
                                            onTeclear={(e) => alTeclearFila(e, f.id)}
                                        />
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Páginas */}
                {!sinServidor && filas && total > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                        <span className="tabular-nums">
                            {desde.toLocaleString("es-AR")}–{hasta.toLocaleString("es-AR")} de {total.toLocaleString("es-AR")} insumo{total === 1 ? "" : "s"}
                        </span>
                        {paginas > 1 && (
                            <div className="flex items-center gap-1.5">
                                <span className="tabular-nums">Página {pagina} de {paginas.toLocaleString("es-AR")}</span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    aria-label="Página anterior"
                                    disabled={pagina <= 1 || cargando}
                                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    aria-label="Página siguiente"
                                    disabled={pagina >= paginas || cargando}
                                    onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ═════════ la ficha ═════════
                Computadora: panel pegado arriba (debajo de la cabecera de la página, que
                es `sticky` y mide unos 7 rem) que acompaña el scroll y se desplaza por
                dentro. Teléfono: capa encima de todo (z-[60], arriba del botón del menú
                y de la campana), con su «volver». */}
            {fichaAbierta && (
                <FichaInsumo
                    key={activa === "nuevo" ? `alta-${nAlta}` : `ficha-${activa}`}
                    id={activa === "nuevo" ? null : activa}
                    fichaInicial={fichaInicial}
                    edita={edita}
                    onCerrar={cerrar}
                    onFilaCambio={parchearFila}
                    onCreado={alCreado}
                    onBorrado={alBorrado}
                    onAbrirInsumo={abrir}
                    onSucioChange={alSucio}
                    avisoDescartar={pendiente ? {
                        onSeguir: () => setPendiente(null),
                        onDescartar: () => {
                            const accion = pendiente;
                            sucio.current = false;
                            setPendiente(null);
                            accion();
                        },
                    } : null}
                    className={cn(
                        "max-lg:fixed max-lg:inset-0 max-lg:z-[60] max-lg:h-[100dvh]",
                        "lg:sticky lg:top-[7.75rem] lg:max-h-[calc(100svh-9.5rem)] lg:overflow-hidden lg:rounded-xl lg:border lg:border-gray-200 lg:shadow-md",
                    )}
                />
            )}
        </div>
    );
}

// ═══════════════════════════ piezas ═══════════════════════════

function FilaInsumo({ f, activa, nueva, onAbrir, onTeclear }: {
    f: InsumoFila;
    activa: boolean;
    nueva: boolean;
    onAbrir: () => void;
    onTeclear: (e: KeyboardEvent<HTMLTableRowElement>) => void;
}) {
    const ubicacion = ubicacionDe(f);
    const hayReserva = f.reservado > 0;
    const titulosStock = [
        `Libre: ${fmtCantidad(f.libre, "0")}`,
        `Físico: ${fmtCantidad(f.stock, "0")}`,
        hayReserva ? `Reservado para OT: ${fmtCantidad(f.reservado)}` : null,
        f.stock_minimo != null ? `Punto crítico: ${fmtCantidad(f.stock_minimo)}` : null,
    ].filter(Boolean).join(" · ");

    return (
        <tr
            id={`insumo-${f.id}`}
            tabIndex={0}
            aria-selected={activa}
            onClick={onAbrir}
            onKeyDown={onTeclear}
            className={cn(
                "cursor-pointer align-top outline-none transition-colors focus-visible:bg-blue-50/60",
                activa ? "bg-red-50/70 shadow-[inset_3px_0_0_#DC143C]" : nueva ? "bg-emerald-50/60 hover:bg-emerald-50" : "hover:bg-gray-50",
                f.inactivo && !activa && "text-gray-400",
            )}
        >
            <td className="whitespace-nowrap px-3 py-2">
                <span className={cn("font-mono text-xs font-bold", f.inactivo ? "text-gray-400" : "text-gray-900")}>{f.codigo}</span>
                {f.inactivo && (
                    <span className="mt-0.5 block text-[10px] font-semibold uppercase text-gray-400">inactivo</span>
                )}
                {nueva && !f.inactivo && (
                    <span className="mt-0.5 block text-[10px] font-semibold uppercase text-emerald-600">nuevo</span>
                )}
            </td>
            <td className="min-w-0 px-3 py-2">
                <span className={cn("line-clamp-2 text-[13px] leading-snug", f.inactivo ? "text-gray-400" : "text-gray-800")} title={f.descripcion}>
                    {f.descripcion}
                </span>
                {/* Lo que esconden las columnas cuando no hay lugar, en un renglón chico. */}
                <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px] text-gray-500 @5xl:hidden">
                    <span className="@4xl:hidden">{f.tipo ? ROTULO_TIPO_CORTO[f.tipo] : "Sin clasificar"}</span>
                    {f.unitario != null && <span className="tabular-nums @3xl:hidden">{fmtPrecio(f.unitario)}</span>}
                    {ubicacion && <span className="font-mono">{ubicacion}</span>}
                    {f.proveedor && <span className="max-w-[12rem] truncate">{f.proveedor}</span>}
                    {f.recortes_disponibles > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-violet-700 @lg:hidden">
                            <Scissors className="h-3 w-3" /> {f.recortes_disponibles}
                        </span>
                    )}
                </span>
            </td>
            <td className="hidden whitespace-nowrap px-3 py-2 @4xl:table-cell">
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                    {f.tipo ? ROTULO_TIPO_CORTO[f.tipo] : "Sin clasificar"}
                </span>
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-right" title={titulosStock}>
                <span
                    className={cn(
                        "inline-flex items-center gap-1 font-semibold tabular-nums",
                        f.bajo_minimo ? "text-red-700" : f.libre < 0 ? "text-red-700" : f.libre > 0 ? "text-gray-900" : "text-gray-300",
                    )}
                >
                    {f.bajo_minimo && <AlertTriangle className="h-3.5 w-3.5" aria-label="Abajo del punto crítico" />}
                    {fmtCantidad(f.libre, "0")}
                </span>
                {hayReserva && <span className="block text-[11px] tabular-nums text-gray-400">de {fmtCantidad(f.stock)}</span>}
                <span className="block text-[10px] text-gray-400 @2xl:hidden">{f.unidad ?? ""}</span>
            </td>
            <td className="hidden whitespace-nowrap px-2 py-2 text-xs text-gray-500 @2xl:table-cell">{f.unidad ?? ""}</td>
            <td className="hidden whitespace-nowrap px-3 py-2 text-right @3xl:table-cell">
                {f.unitario != null ? (
                    <>
                        <span className="text-xs font-medium tabular-nums text-gray-800">{fmtPrecio(f.unitario)}</span>
                        {f.fecha_ultimo_precio && <span className="block text-[10px] tabular-nums text-gray-400">{fmtFecha(f.fecha_ultimo_precio)}</span>}
                    </>
                ) : (
                    <span className="text-xs text-gray-300">—</span>
                )}
            </td>
            <td className="hidden whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600 @5xl:table-cell">{ubicacion || <span className="text-gray-300">—</span>}</td>
            <td className="hidden max-w-[12rem] px-3 py-2 text-xs text-gray-600 @5xl:table-cell">
                <span className="line-clamp-2" title={f.proveedor ?? undefined}>{f.proveedor ?? <span className="text-gray-300">—</span>}</span>
            </td>
            <td className="hidden px-2 py-2 text-center @lg:table-cell">
                {f.recortes_disponibles > 0 && (
                    <span
                        className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-violet-700"
                        title={`${f.recortes_disponibles} recorte${f.recortes_disponibles === 1 ? "" : "s"} disponible${f.recortes_disponibles === 1 ? "" : "s"}`}
                    >
                        <Scissors className="h-3 w-3" />
                        {f.recortes_disponibles}
                    </span>
                )}
            </td>
        </tr>
    );
}

/** Un filtro que se prende y se apaga. */
function Chip({ activo, onClick, children, title, peligro = false }: {
    activo: boolean;
    onClick: () => void;
    children: ReactNode;
    title?: string;
    /** «Bajo mínimo»: prendido va en rojo, como el aviso. */
    peligro?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={activo}
            title={title}
            className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                activo
                    ? peligro
                        ? "border-red-700 bg-red-700 text-white"
                        : "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
            )}
        >
            {children}
        </button>
    );
}

/** Un filtro de muchos valores (material, formato): el chip abre la lista. */
function ChipDesplegable({ rotulo, elegido, opciones, onElegir }: {
    rotulo: string;
    elegido: string | null;
    opciones: { id: number; nombre: string }[];
    onElegir: (id: number | null) => void;
}) {
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                        elegido ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                    )}
                >
                    {elegido ? (
                        <>
                            <span className="max-w-[10rem] truncate">{elegido}</span>
                            <span
                                role="button"
                                tabIndex={-1}
                                aria-label={`Quitar el filtro de ${rotulo.toLowerCase()}`}
                                onPointerDown={(e) => {
                                    // Que la cruz quite el filtro sin abrir la lista.
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onElegir(null);
                                }}
                                className="-mr-1 rounded-full p-0.5 hover:bg-white/20"
                            >
                                <X className="h-3 w-3" />
                            </span>
                        </>
                    ) : (
                        <>
                            {rotulo}
                            <ChevronDown className="h-3 w-3 opacity-60" />
                        </>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                {opciones.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-gray-400">Cargando…</p>
                ) : (
                    <>
                        {elegido && (
                            <>
                                <DropdownMenuItem onSelect={() => onElegir(null)} className="text-xs text-gray-500">
                                    Todos
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        )}
                        {opciones.map((o) => (
                            <DropdownMenuItem key={o.id} onSelect={() => onElegir(o.id)} className={cn("text-xs", o.nombre === elegido && "font-semibold text-red-700")}>
                                {o.nombre}
                            </DropdownMenuItem>
                        ))}
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default InsumosTab;
