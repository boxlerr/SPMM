"use client";

/**
 * Órdenes de Trabajo — TODAS, en una sola lista.
 *
 * Por qué existe: Operaciones muestra el trabajo ya repartido en solapas
 * (Planificadas, Semanal, Diaria, Completadas…) y en ninguna se ve el total.
 * La pregunta "¿cuántas OT tengo y cuántas quedaron afuera del plan?" no tenía
 * dónde contestarse. Acá el corte es lo primero que se ve: adentro del plan,
 * afuera, y entregadas.
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
import { cn } from "@/lib/utils";
import {
    Search, RefreshCw, Plus, CalendarClock, FileText, AlertTriangle,
    ClipboardList, CheckCircle2, CircleDashed, ArrowUpDown,
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
    prioridad: string | null;
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
}

type Filtro = "todas" | EstadoPlan;
type Orden = "prometida" | "ot" | "cliente" | "procesos";

const FILTROS: { id: Filtro; label: string; clave: keyof Resumen | null }[] = [
    { id: "todas", label: "Todas", clave: "total" },
    { id: "sin_planificar", label: "Sin planificar", clave: "sin_planificar" },
    { id: "planificada", label: "Planificadas", clave: "planificadas" },
    { id: "entregada", label: "Entregadas", clave: "entregadas" },
];

const fecha = (f: string | null) =>
    f ? new Date(f).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

/** Días de acá a la fecha prometida. Negativo = atrasada. */
const diasPara = (f: string | null): number | null => {
    if (!f) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const d = new Date(f); d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - hoy.getTime()) / 86400000);
};

export default function OrdenesPage() {
    const { showToast } = useToast();
    const cleanUrl = API_URL.replace(/\/$/, "");

    const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
    const [resumen, setResumen] = useState<Resumen | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [filtro, setFiltro] = useState<Filtro>("todas");
    const [busqueda, setBusqueda] = useState("");
    const [soloSinProcesos, setSoloSinProcesos] = useState(false);
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
    useEffect(() => { setVisibles(100); }, [filtro, busqueda, soloSinProcesos, orden]);

    const filtradas = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        let lista = ordenes.filter(o => {
            if (filtro !== "todas" && o.estado_plan !== filtro) return false;
            if (soloSinProcesos && o.procesos > 0) return false;
            if (!q) return true;
            return [o.id_otvieja, o.cliente, o.articulo, o.codigo, o.detalle]
                .some(v => String(v ?? "").toLowerCase().includes(q));
        });
        const cmp: Record<Orden, (a: OrdenResumen, b: OrdenResumen) => number> = {
            // Más urgente primero: la prometida más vieja arriba. Sin fecha, al fondo.
            prometida: (a, b) => (a.fecha_prometida || "9999").localeCompare(b.fecha_prometida || "9999"),
            ot: (a, b) => (b.id_otvieja ?? 0) - (a.id_otvieja ?? 0),
            cliente: (a, b) => (a.cliente || "").localeCompare(b.cliente || ""),
            procesos: (a, b) => b.procesos - a.procesos,
        };
        return [...lista].sort(cmp[orden]);
    }, [ordenes, filtro, busqueda, soloSinProcesos, orden]);

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
        <div className="p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Órdenes de Trabajo</h1>
                    <p className="text-gray-600 mt-1 text-sm">
                        Todas las OT del sistema: las que entraron al plan y las que quedaron afuera.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={cargar} disabled={cargando}>
                        <RefreshCw className={cn("h-4 w-4 mr-2", cargando && "animate-spin")} />
                        Actualizar
                    </Button>
                    <Button
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => { setOtAEditar(null); setModalAbierto(true); }}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Nueva orden de trabajo
                    </Button>
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {FILTROS.map(f => {
                    const activo = filtro === f.id;
                    const valor = resumen && f.clave ? resumen[f.clave] : 0;
                    const color =
                        f.id === "planificada" ? "text-emerald-700 border-emerald-300 bg-emerald-50"
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

            <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        className="pl-9"
                        placeholder="Buscar por N° de OT, cliente, artículo o código…"
                        value={busqueda}
                        onChange={e => setBusqueda(e.target.value)}
                    />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 shrink-0 px-1">
                    <input
                        type="checkbox"
                        className="h-4 w-4 accent-red-600"
                        checked={soloSinProcesos}
                        onChange={e => setSoloSinProcesos(e.target.checked)}
                    />
                    Solo sin procesos
                    {resumen && (
                        <span className="rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold">
                            {resumen.sin_procesos}
                        </span>
                    )}
                </label>
                <select
                    value={orden}
                    onChange={e => setOrden(e.target.value as Orden)}
                    className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm shrink-0"
                >
                    <option value="prometida">Fecha prometida (más urgente)</option>
                    <option value="ot">N° de OT (más nueva)</option>
                    <option value="cliente">Cliente (A-Z)</option>
                    <option value="procesos">Cantidad de procesos</option>
                </select>
            </div>

            {cargando ? (
                <div className="flex justify-center py-16"><Spinner /></div>
            ) : (
                <>
                    <div className="text-sm text-gray-500 flex items-center gap-1.5">
                        <ArrowUpDown className="h-3.5 w-3.5" />
                        {filtradas.length} {filtradas.length === 1 ? "orden" : "órdenes"}
                        {filtro !== "todas" || busqueda || soloSinProcesos
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
                                                    {o.id_otvieja ?? o.id}
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
                                                <td className="px-3 py-2 text-center">
                                                    {o.planos > 0 ? (
                                                        <span className="inline-flex items-center gap-1 text-blue-700" title={`${o.planos} archivo(s)`}>
                                                            <FileText className="h-3.5 w-3.5" />
                                                            <span className="tabular-nums text-[11px]">{o.planos}</span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-300">—</span>
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
                onSuccess={() => { setModalAbierto(false); setOtAEditar(null); cargar(); }}
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
