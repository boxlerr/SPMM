"use client";

/**
 * TODAS las órdenes, en una sola lista.
 *
 * Por qué existe: las otras solapas parten el trabajo (No Planificadas, Planificadas,
 * Historial) y en ninguna se ve el total. La pregunta "¿cuántas OT tengo y dónde
 * quedó ésta?" no tenía dónde contestarse, y desaparecer de una lista al planificar
 * se lee como haber perdido la orden.
 *
 * Por qué es una SOLAPA y no una sección del menú: nació como `/ordenes` en el
 * sidebar y duraba un día — al lado de la solapa "Órdenes de Trabajo" de Operaciones
 * quedaban dos cosas con el mismo nombre en lugares distintos. Julián, 11/09: "tiene
 * que estar adentro de órdenes de trabajo en una solapita más, no generar otra
 * sección en el sidebar; es muy confuso ya".
 *
 * Se apoya en GET /ordenes-resumen, que trae una fila por OT con los conteos ya
 * hechos por Postgres. No trae los procesos: para verlos se abre la OT.
 */

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal";
import { API_URL } from "@/config";
import { usePermisos } from "@/hooks/usePermisos";
import { cn } from "@/lib/utils";
import { TipoTrabajoBadge, textoTipoTrabajo, type TipoTrabajo } from "@/components/common/TipoTrabajoBadge";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { MarcaPausada } from "@/components/pausas/MarcaPausada";
import { filtroBusqueda, partesDeFecha, type ColumnaExport } from "@/lib/exportar";
import { rangoPrioridad } from "@/lib/prioridad";
import {
    Search, RefreshCw, Plus, CalendarClock, FileText, AlertTriangle,
    ClipboardList, CheckCircle2, CircleDashed, ArrowUpDown, Ban,
} from "lucide-react";

const getAuthHeaders = (): HeadersInit => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
};

type EstadoPlan = "planificada" | "sin_planificar" | "entregada";

interface OrdenResumen {
    id: number;
    id_otvieja: number | null;
    cliente: string | null;
    codigo: string | null;
    articulo: string | null;
    detalle: string | null;
    unidades: number | null;
    cantidad_entregada: number | null;
    fecha_orden: string | null;
    fecha_prometida: string | null;
    fecha_entrega: string | null;
    suspendida: number | null;
    fabricacion: number | null;
    reparacion: number | null;
    tiene_plano: number | null;
    no_lleva_plano: number | null;
    prioridad: string | null;
    /** "fabricacion" | "reparacion" | "ambas" | null — lo arma el backend. */
    tipo_trabajo: TipoTrabajo;
    /** "tiene" | "no_lleva" | "falta". Tres estados: el que falta hay que ir a buscarlo. */
    estado_plano: "tiene" | "no_lleva" | "falta";
    procesos: number;
    procesos_finalizados: number;
    planos: number;
    planificada: boolean;
    procesos_planificados: number | null;
    planificada_en: string | null;
    entregada: boolean;
    estado_plan: EstadoPlan;
}

interface Resumen {
    total: number;
    planificadas: number;
    sin_planificar: number;
    entregadas: number;
    sin_procesos: number;
    sin_tipo: number;
    falta_plano: number;
}

// RF-02 pide ver «todas las órdenes EN CURSO»: las que siguen en el taller, o sea las
// que no se entregaron (sin planificar + en el plan). Es un contador-filtro más y no una
// casilla aparte, así no se puede pedir «entregadas en curso» y ver la lista vacía.
type Filtro = "todas" | "en_curso" | EstadoPlan;
type Orden = "prometida" | "ot" | "cliente" | "procesos" | "prioridad" | "estado";

const FILTROS: { id: Filtro; label: string; clave: keyof Resumen | null }[] = [
    { id: "todas", label: "Todas", clave: "total" },
    // Su número es total − entregadas: sale del mismo resumen, también con el backend viejo.
    { id: "en_curso", label: "En curso (sin entregar)", clave: null },
    { id: "sin_planificar", label: "Sin planificar", clave: "sin_planificar" },
    { id: "planificada", label: "Planificadas", clave: "planificadas" },
    { id: "entregada", label: "Entregadas", clave: "entregadas" },
];

/** La fecha si es de verdad; null si está vacía o es la marca de «sin fecha» del sistema
 *  viejo (1950-01-01) o el 3000-01-01 de lo que no vence. Una OT vieja con prometida
 *  1950 salía «01/01/1950» y con 27.000 días de atraso en rojo, y encabezaba el orden
 *  «más urgente». */
const fechaReal = (f: string | null): string | null => (f && partesDeFecha(f) ? f : null);

const fecha = (f: string | null) =>
    fechaReal(f) ? new Date(f!).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

/** Días de acá a la fecha prometida. Negativo = atrasada. */
const diasPara = (f: string | null): number | null => {
    const real = fechaReal(f);
    if (!real) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const d = new Date(real); d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - hoy.getTime()) / 86400000);
};

const ROTULO_ESTADO: Record<EstadoPlan, string> = {
    entregada: "Entregada",
    planificada: "En el plan",
    sin_planificar: "Sin planificar",
};

const ROTULO_ORDEN: Record<Orden, string> = {
    prometida: "Fecha prometida (más urgente)",
    ot: "N° de OT (más nueva)",
    cliente: "Cliente (A-Z)",
    procesos: "Cantidad de procesos",
    prioridad: "Prioridad (más urgente)",
    estado: "Estado (sin planificar, en el plan, entregada)",
};

// Orden del «Estado»: primero lo que falta planificar, después lo que ya está en el plan y
// al final lo entregado (lo que ya no pide nada).
const RANGO_ESTADO: Record<EstadoPlan, number> = { sin_planificar: 0, planificada: 1, entregada: 2 };

/** Las columnas del archivo exportado: las de la tabla, con los números separados. */
const COLUMNAS_EXPORT: ColumnaExport<OrdenResumen>[] = [
    { titulo: "N° OT", tipo: "id", valor: (o) => o.id_otvieja ?? o.id },
    { titulo: "Cliente", valor: (o) => o.cliente ?? "" },
    { titulo: "Código", valor: (o) => o.codigo ?? "" },
    { titulo: "Artículo", valor: (o) => o.articulo ?? "" },
    { titulo: "Cant.", tipo: "entero", valor: (o) => o.unidades },
    { titulo: "Prometida", tipo: "fecha", valor: (o) => o.fecha_prometida },
    {
        titulo: "Días de atraso",
        tipo: "entero",
        valor: (o) => {
            const d = o.entregada ? null : diasPara(o.fecha_prometida);
            return d !== null && d < 0 ? -d : null;
        },
    },
    { titulo: "Trabajo", valor: (o) => textoTipoTrabajo(o.tipo_trabajo) },
    { titulo: "Prioridad", valor: (o) => o.prioridad ?? "" },
    { titulo: "Procesos", tipo: "entero", valor: (o) => o.procesos },
    { titulo: "Procesos terminados", tipo: "entero", valor: (o) => o.procesos_finalizados },
    {
        titulo: "Plano",
        valor: (o) => (o.planos > 0 ? `${o.planos} archivo${o.planos === 1 ? "" : "s"}` : o.estado_plano === "no_lleva" ? "No lleva" : "Falta"),
    },
    { titulo: "Estado", valor: (o) => ROTULO_ESTADO[o.estado_plan] ?? o.estado_plan },
    { titulo: "Planificada el", tipo: "fecha", valor: (o) => o.planificada_en },
    { titulo: "Entregada el", tipo: "fecha", valor: (o) => o.fecha_entrega },
];

export default function TodasLasOrdenes({ onRefresh }: { onRefresh?: () => void }) {
    const { showToast } = useToast();
    // RF-24: dar de alta una OT pide la solapa Órdenes en escritura.
    const { puedeSeccion } = usePermisos();
    const puedeCrear = puedeSeccion("operaciones_ordenes", "write");
    const cleanUrl = API_URL.replace(/\/$/, "");

    const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
    const [resumen, setResumen] = useState<Resumen | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [filtro, setFiltro] = useState<Filtro>("todas");
    const [busqueda, setBusqueda] = useState("");
    const [huecos, setHuecos] = useState<("procesos" | "tipo" | "plano")[]>([]);
    const [orden, setOrden] = useState<Orden>("prometida");
    const [visibles, setVisibles] = useState(100);

    const [modalAbierto, setModalAbierto] = useState(false);
    const [otAEditar, setOtAEditar] = useState<any>(null);

    const cargar = async () => {
        setCargando(true);
        setError(null);
        try {
            const r = await fetch(`${cleanUrl}/ordenes-resumen`, { headers: getAuthHeaders() });
            if (!r.ok) throw new Error(`Error ${r.status}`);
            const json = await r.json();
            setOrdenes(json?.data?.ordenes || []);
            setResumen(json?.data?.resumen || null);
        } catch (e: any) {
            setError(e?.message || "No se pudieron cargar las órdenes.");
        } finally {
            setCargando(false);
        }
    };

    useEffect(() => { cargar(); }, []);
    useEffect(() => { setVisibles(100); }, [filtro, busqueda, huecos, orden]);

    const filtradas = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        let lista = ordenes.filter(o => {
            if (filtro === "en_curso" ? o.estado_plan === "entregada"
                : filtro !== "todas" && o.estado_plan !== filtro) return false;
            // Los huecos SUMAN: tildar dos muestra las que tienen cualquiera de los dos,
            // porque lo que se busca es "qué me falta completar", no la intersección.
            if (huecos.length && !huecos.some(h =>
                h === "procesos" ? o.procesos === 0
                    : h === "tipo" ? !o.tipo_trabajo
                        : o.estado_plano === "falta")) return false;
            if (!q) return true;
            return [o.id_otvieja, o.cliente, o.articulo, o.codigo, o.detalle]
                .some(v => String(v ?? "").toLowerCase().includes(q));
        });
        const cmp: Record<Orden, (a: OrdenResumen, b: OrdenResumen) => number> = {
            // Más urgente primero: la prometida más vieja arriba. Sin fecha, al fondo.
            prometida: (a, b) => (fechaReal(a.fecha_prometida) || "9999").localeCompare(fechaReal(b.fecha_prometida) || "9999"),
            ot: (a, b) => (b.id_otvieja ?? 0) - (a.id_otvieja ?? 0),
            cliente: (a, b) => (a.cliente || "").localeCompare(b.cliente || ""),
            procesos: (a, b) => b.procesos - a.procesos,
            // Prioridad y estado desempatan por la prometida: entre dos urgentes, arriba
            // la que vence antes.
            prioridad: (a, b) => rangoPrioridad(a.prioridad) - rangoPrioridad(b.prioridad)
                || cmp.prometida(a, b),
            estado: (a, b) => (RANGO_ESTADO[a.estado_plan] ?? 3) - (RANGO_ESTADO[b.estado_plan] ?? 3)
                || cmp.prometida(a, b),
        };
        return [...lista].sort(cmp[orden]);
    }, [ordenes, filtro, busqueda, huecos, orden]);

    const abrirOT = async (o: OrdenResumen) => {
        try {
            const r = await fetch(`${cleanUrl}/ordenes/${o.id}`, { headers: getAuthHeaders() });
            const json = await r.json();
            const completa = json?.data ?? json;
            if (!completa?.id) throw new Error("respuesta vacía");
            setOtAEditar(completa);
            setModalAbierto(true);
        } catch {
            showToast("No se pudo abrir la orden de trabajo.", "error");
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Todas las órdenes</h3>
                    <p className="text-gray-500 mt-0.5 text-sm">
                        Las que entraron al plan y las que quedaron afuera, juntas.
                    </p>
                </div>
                {/* `flex-wrap` (RF-27): Actualizar y «Nueva orden de trabajo» piden ~330px
                    y en un teléfono angosto el segundo se salía del recuadro. */}
                <div className="flex flex-wrap gap-2">
                    {/* RF-22: sale lo que la lista tiene filtrado y ordenado, también lo que
                        todavía no se dibujó por el «Ver más». */}
                    <ExportarMenu
                        titulo="Todas las órdenes"
                        archivo="ordenes_todas"
                        filas={filtradas}
                        columnas={COLUMNAS_EXPORT}
                        filtros={() => [
                            ...(filtro !== "todas" ? [`Estado: ${FILTROS.find((f) => f.id === filtro)?.label ?? filtro}`] : []),
                            ...filtroBusqueda(busqueda),
                            ...(huecos.length
                                ? [`Con huecos: ${huecos.map((h) => (h === "procesos" ? "sin procesos" : h === "tipo" ? "sin tipo" : "falta plano")).join(", ")}`]
                                : []),
                            `Ordenado por ${ROTULO_ORDEN[orden]}`,
                        ]}
                        disabled={cargando}
                        className="h-9"
                    />
                    <Button variant="outline" onClick={cargar} disabled={cargando}>
                        <RefreshCw className={cn("h-4 w-4 mr-2", cargando && "animate-spin")} />
                        Actualizar
                    </Button>
                    {puedeCrear && (
                        <Button
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => { setOtAEditar(null); setModalAbierto(true); }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Nueva orden de trabajo
                        </Button>
                    )}
                </div>
            </div>

            {error && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Los contadores son los filtros: tocar uno recorta la lista. Es el mismo
                número que se lee arriba, así no hay dos verdades en la pantalla. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {FILTROS.map(f => {
                    const activo = filtro === f.id;
                    const valor = !resumen ? 0
                        : f.id === "en_curso" ? resumen.total - resumen.entregadas
                            : f.clave ? resumen[f.clave] : 0;
                    const color =
                        f.id === "en_curso" ? "text-blue-700 border-blue-300 bg-blue-50"
                        : f.id === "planificada" ? "text-emerald-700 border-emerald-300 bg-emerald-50"
                            : f.id === "sin_planificar" ? "text-amber-700 border-amber-300 bg-amber-50"
                                : f.id === "entregada" ? "text-gray-600 border-gray-300 bg-gray-50"
                                    : "text-red-700 border-red-300 bg-red-50";
                    return (
                        <button
                            key={f.id}
                            onClick={() => setFiltro(f.id)}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-all",
                                activo ? `${color} ring-2 ring-offset-1 ring-current shadow-sm`
                                    : "bg-white border-gray-200 hover:border-gray-300 text-gray-700"
                            )}
                        >
                            <div className="text-2xl font-bold tabular-nums">{valor}</div>
                            <div className="text-xs font-medium">{f.label}</div>
                        </button>
                    );
                })}
            </div>

            {/* `flex-wrap` + ancho mínimo del buscador: con el menú abierto, a 1024px el
                buscador quedaba de 60px al lado de las casillas y el orden. Ahora, si no
                entra, el orden baja al renglón de abajo. */}
            <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-2">
                <div className="relative flex-1 min-w-0 lg:min-w-[14rem]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        className="pl-9"
                        placeholder="Buscar por N° de OT, cliente, artículo o código…"
                        value={busqueda}
                        onChange={e => setBusqueda(e.target.value)}
                    />
                </div>
                {/* Los tres huecos de datos que frenan el trabajo, cada uno con su
                    número: sin procesos no se planifica, sin tipo no se filtra, y
                    sin plano alguien tiene que ir a buscarlo al Drive. */}
                {([
                    ["procesos", "Sin procesos", "sin_procesos"],
                    ["tipo", "Sin tipo", "sin_tipo"],
                    ["plano", "Falta plano", "falta_plano"],
                ] as const).map(([clave, texto, campo]) => (
                    <label key={clave} className="flex items-center gap-1.5 text-sm text-gray-700 shrink-0 px-1">
                        <input
                            type="checkbox"
                            className="h-4 w-4 accent-red-600"
                            checked={huecos.includes(clave)}
                            onChange={e => setHuecos(h => e.target.checked ? [...h, clave] : h.filter(x => x !== clave))}
                        />
                        {texto}
                        {resumen && (
                            <span className="rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold">
                                {resumen[campo]}
                            </span>
                        )}
                    </label>
                ))}
                <select
                    value={orden}
                    onChange={e => setOrden(e.target.value as Orden)}
                    className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm shrink-0"
                >
                    <option value="prometida">Fecha prometida (más urgente)</option>
                    <option value="ot">N° de OT (más nueva)</option>
                    <option value="cliente">Cliente (A-Z)</option>
                    <option value="procesos">Cantidad de procesos</option>
                    <option value="prioridad">Prioridad (más urgente)</option>
                    <option value="estado">Estado</option>
                </select>
            </div>

            {cargando ? (
                <div className="flex justify-center py-16"><Spinner /></div>
            ) : (
                <>
                    <div className="text-sm text-gray-500 flex items-center gap-1.5">
                        <ArrowUpDown className="h-3.5 w-3.5" />
                        {filtradas.length} {filtradas.length === 1 ? "orden" : "órdenes"}
                        {filtro !== "todas" || busqueda || huecos.length
                            ? ` de ${ordenes.length} en total` : ""}
                    </div>

                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                        <th className="px-3 py-2.5">N° OT</th>
                                        <th className="px-3 py-2.5">Cliente</th>
                                        <th className="px-3 py-2.5">Artículo</th>
                                        <th className="px-3 py-2.5 text-right">Cant.</th>
                                        <th className="px-3 py-2.5">Prometida</th>
                                        <th className="px-3 py-2.5">Trabajo</th>
                                        <th className="px-3 py-2.5">Prioridad</th>
                                        <th className="px-3 py-2.5 text-center">Procesos</th>
                                        <th className="px-3 py-2.5 text-center">Plano</th>
                                        <th className="px-3 py-2.5">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filtradas.slice(0, visibles).map(o => {
                                        const dias = o.entregada ? null : diasPara(o.fecha_prometida);
                                        const atrasada = dias !== null && dias < 0;
                                        return (
                                            <tr
                                                key={o.id}
                                                onClick={() => abrirOT(o)}
                                                className="hover:bg-red-50/40 cursor-pointer transition-colors"
                                            >
                                                <td className="px-3 py-2 font-semibold text-gray-900 whitespace-nowrap">
                                                    <span className="inline-flex items-center gap-1.5">
                                                        {o.id_otvieja ?? o.id}
                                                        <MarcaPausada idOrden={o.id} />
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={o.cliente || ""}>
                                                    {o.cliente || "—"}
                                                </td>
                                                <td className="px-3 py-2 text-gray-700 max-w-[280px]">
                                                    <div className="truncate" title={o.articulo || ""}>{o.articulo || "—"}</div>
                                                    {o.codigo && <div className="text-[11px] text-gray-400">{o.codigo}</div>}
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                                    {o.unidades ?? "—"}
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <span className={cn("tabular-nums", atrasada && "text-red-600 font-semibold")}>
                                                        {fecha(o.fecha_prometida)}
                                                    </span>
                                                    {atrasada && (
                                                        <span className="ml-1.5 text-[11px] text-red-600">
                                                            {Math.abs(dias!)}d
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <TipoTrabajoBadge tipo={o.tipo_trabajo} />
                                                </td>
                                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{o.prioridad || "—"}</td>
                                                <td className="px-3 py-2 text-center">
                                                    {o.procesos === 0 ? (
                                                        <span
                                                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[11px] font-semibold"
                                                            title="Sin procesos cargados: no se puede planificar"
                                                        >
                                                            <AlertTriangle className="h-3 w-3" /> sin procesos
                                                        </span>
                                                    ) : (
                                                        <span className="tabular-nums text-gray-700">
                                                            {o.procesos_finalizados > 0
                                                                ? `${o.procesos_finalizados}/${o.procesos}`
                                                                : o.procesos}
                                                        </span>
                                                    )}
                                                </td>
                                                {/* Tres estados, no dos. "No lleva" y "falta" se veían
                                                    iguales y son opuestos: uno se saltea, al otro hay que
                                                    ir a buscarlo. */}
                                                <td className="px-3 py-2 text-center">
                                                    {o.planos > 0 ? (
                                                        <span className="inline-flex items-center gap-1 text-blue-700" title={`${o.planos} archivo(s)`}>
                                                            <FileText className="h-3.5 w-3.5" />
                                                            <span className="tabular-nums text-[11px]">{o.planos}</span>
                                                        </span>
                                                    ) : o.estado_plano === "no_lleva" ? (
                                                        /* Escrito y con su cartelito, no un guioncito gris:
                                                           "no lleva" tiene que leerse sin dudar, si no hay
                                                           que abrir la OT para saberlo (Lucas, 10/09). */
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                                                              title="El taller marcó que esta pieza no necesita plano: no hay que buscarlo">
                                                            <Ban className="h-3 w-3" />
                                                            No lleva
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                                                              title="No hay plano cargado y nadie marcó que no lleve: hay que ir a buscarlo">
                                                            <AlertTriangle className="h-3 w-3" />
                                                            Falta
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <EstadoChip orden={o} />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {filtradas.length === 0 && (
                            <div className="py-14 text-center text-gray-500 text-sm">
                                No hay órdenes que coincidan con lo que buscás.
                            </div>
                        )}
                    </div>

                    {visibles < filtradas.length && (
                        <div className="flex justify-center">
                            <Button variant="outline" onClick={() => setVisibles(v => v + 200)}>
                                Ver más ({filtradas.length - visibles} restantes)
                            </Button>
                        </div>
                    )}
                </>
            )}

            <CreateWorkOrderModal
                isOpen={modalAbierto}
                onClose={() => { setModalAbierto(false); setOtAEditar(null); }}
                onSuccess={() => { setModalAbierto(false); setOtAEditar(null); cargar(); onRefresh?.(); }}
                orderToEdit={otAEditar}
            />
        </div>
    );
}

function EstadoChip({ orden }: { orden: OrdenResumen }) {
    if (orden.estado_plan === "entregada") {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-[11px] font-medium">
                <CheckCircle2 className="h-3 w-3" /> Entregada
            </span>
        );
    }
    if (orden.estado_plan === "planificada") {
        return (
            <span
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-semibold"
                title={orden.planificada_en
                    ? `Planificada el ${fecha(orden.planificada_en)} · ${orden.procesos_planificados} procesos en el plan`
                    : undefined}
            >
                <ClipboardList className="h-3 w-3" /> En el plan
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[11px] font-semibold">
            <CircleDashed className="h-3 w-3" /> Sin planificar
        </span>
    );
}
