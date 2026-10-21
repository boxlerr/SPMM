"use client";

import React, { useState } from "react";
import { 
    Search, 
    AlertCircle, 
    Edit2, 
    Trash2,
    Clock,
    ChevronDown,
    ChevronRight,
    Calendar,
    Package,
    CheckCircle2,
    AlertTriangle,
    FileText,
    Settings,
    MessageSquare,
    PlusCircle,
    ClipboardList,
    Check,
    CheckSquare,
    Wrench,
    X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PlanificacionItem, WorkOrder } from "@/lib/types";
import { OrderFiles } from "./common/OrderFiles";
import { cn, getWorkOrderRowColor } from "@/lib/utils";
import { WorkOrderFilters, WorkOrderFilterState, initialFilterState, applyWorkOrderFilters } from "./common/WorkOrderFilters";
import { AddProcessRow } from "./planning/AddProcessRow";
import { useOrdenesConPlano, estadoPlano, rankPlano } from "@/hooks/useOrdenesConPlano";
import { addWorkMinutes, formatDate as formatISODate } from "@/lib/gantt-utils";

/** Una PASADA concreta de un proceso dentro de una OT.
 *
 *  `idOtp` (orden_trabajo_proceso.id) es lo que la identifica: el mismo proceso puede
 *  ir dos veces en la misma OT, así que `procesoId` solo no alcanza para decir cuál de
 *  las dos se tocó. */
export type ProcesoRef = {
    ordenId: number;
    procesoId: number;
    idOtp?: number;
    /** Nombre del proceso, para poder nombrarlo en el cartel de confirmación. */
    nombre: string;
};

interface UnplannedWorkOrdersListProps {
    orders: WorkOrder[];
    onEdit: (order: WorkOrder) => void;
    onDelete: (id: number) => void;
    onDataChange?: () => void;
    /** Planificación de estas OTs. Solo la manda la solapa "Planificadas": es de donde
     *  salen el horario y la máquina de cada pasada, que no vienen en `orders`. */
    planificacion?: PlanificacionItem[];
    /** Cambia el estado de varias pasadas de una ("Marcar completados"). Si no viene,
     *  no se ofrece la edición rápida. */
    onProcessStatusChange?: (refs: ProcesoRef[], idEstado: number) => Promise<void> | void;
    /** Pide borrar una pasada. El padre confirma antes de pegarle al backend. */
    onProcessDelete?: (ref: ProcesoRef) => void;
    /** Zoom (%) aplicado SOLO a la tabla, no al header ni a los filtros. */
    tableZoom?: number;
    /** Qué lista es. Cambia SOLO el título, el ícono, el color de acento y el texto
     *  de "no hay nada": la tabla, los filtros, el orden y las columnas son
     *  exactamente los mismos en las dos. Pedido de Julián (1/9): la pestaña
     *  Planificadas tenía un diseño propio (tarjetas plegables) que no se parecía
     *  en nada al resto de Órdenes de Trabajo. */
    variante?: "no_planificadas" | "planificadas";
}

/** Textos y colores que cambian entre las dos listas. Lo único que cambia. */
const COPY_VARIANTE = {
    no_planificadas: {
        titulo: "Órdenes No Planificadas",
        bajada: "Estas órdenes requieren configuración de procesos y fechas.",
        acentoCaja: "bg-orange-50 text-orange-600",
        acentoOrden: "text-orange-600",
        badge: "PENDIENTE",
        badgeClase: "bg-orange-50 text-orange-700 border-orange-100",
        vacioTitulo: "No hay órdenes pendientes",
        vacioBajada: "Todas las órdenes de trabajo actuales ya han sido planificadas en el sistema.",
        vacioFila: "No hay órdenes pendientes.",
    },
    planificadas: {
        titulo: "Órdenes Planificadas",
        bajada: "Estas órdenes ya tienen procesos y fechas asignadas.",
        acentoCaja: "bg-red-50 text-red-700",
        acentoOrden: "text-red-700",
        badge: "PLANIFICADA",
        badgeClase: "bg-red-50 text-red-700 border-red-100",
        vacioTitulo: "No hay órdenes planificadas",
        vacioBajada: "Todavía no se planificó ninguna orden, o las que había ya se entregaron y pasaron al Historial.",
        vacioFila: "No hay órdenes planificadas.",
    },
} as const;

/** Horario y máquina de una pasada, ya formateados para mostrar. */
type PlanDePasada = { inicio: string; fin: string; maquina?: string };

/** "09:30" a partir de un Date. */
const horaDe = (d: Date) => `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

/** "25/08" a partir de un "2026-08-25". */
const diaDe = (iso: string) => {
    const [, mes, dia] = iso.split("-");
    return `${dia}/${mes}`;
};

/**
 * Cruza la planificación con las pasadas de las OTs para poder mostrar, en cada
 * proceso, a qué hora entra y en qué máquina.
 *
 * La clave es la PASADA (`id_orden_trabajo_proceso`), no el proceso: una OT puede
 * llevar el mismo proceso dos veces y cada una tiene su horario y su máquina.
 *
 * Los planes viejos —guardados antes de que la pasada existiera— traen ese campo en
 * null. Para esos se cae a `orden + proceso`, pero SOLO cuando ese proceso aparece una
 * sola vez en el plan de esa OT: si aparece dos veces no hay manera de saber cuál es
 * cuál, y mostrar el horario de la otra pasada es peor que no mostrar nada.
 */
function construirPlanPorPasada(planificacion: PlanificacionItem[]) {
    const porOtp = new Map<number, PlanDePasada>();
    const porProceso = new Map<string, PlanDePasada>();
    const vecesPorProceso = new Map<string, number>();
    /** Qué procesos figuran en el plan, aunque después no se pueda decir qué pasada es
     *  cuál. Sirve para no escribir "Sin planificar" sobre algo que sí está planificado. */
    const procesosEnElPlan = new Set<string>();

    for (const item of planificacion) {
        // `inicio_min` / `fin_min` son minutos de trabajo contados desde las 9:00 del
        // día en que se guardó el plan: el mismo criterio que usa el Gantt.
        const base = item.creado_en ? new Date(item.creado_en) : new Date();
        base.setHours(9, 0, 0, 0);
        const desde = addWorkMinutes(base, item.inicio_min);
        const hasta = addWorkMinutes(base, item.fin_min);
        const plan: PlanDePasada = {
            inicio: `${diaDe(formatISODate(desde))} ${horaDe(desde)}`,
            fin: `${diaDe(formatISODate(hasta))} ${horaDe(hasta)}`,
            maquina: item.nombre_maquinaria,
        };

        if (item.id_orden_trabajo_proceso != null) porOtp.set(item.id_orden_trabajo_proceso, plan);

        const clave = `${item.orden_id}-${item.proceso_id}`;
        procesosEnElPlan.add(clave);
        vecesPorProceso.set(clave, (vecesPorProceso.get(clave) || 0) + 1);
        porProceso.set(clave, plan);
    }

    for (const [clave, veces] of vecesPorProceso) {
        if (veces > 1) porProceso.delete(clave);
    }

    return { porOtp, porProceso, procesosEnElPlan };
}

export function UnplannedWorkOrdersList({
    orders,
    onEdit,
    onDelete,
    onDataChange,
    planificacion,
    onProcessStatusChange,
    onProcessDelete,
    tableZoom = 100,
    variante = "no_planificadas",
}: UnplannedWorkOrdersListProps) {
    const copy = COPY_VARIANTE[variante];
    const [searchTerm, setSearchTerm] = useState("");
    const [expandedOrderIds, setExpandedOrderIds] = useState<number[]>([]);
    const [filters, setFilters] = useState<WorkOrderFilterState>(initialFilterState);

    // --- Edición rápida: tildar varios procesos y cerrarlos todos juntos ---
    // Vuelve de la vista de tarjetas que tenía "Planificadas" antes: era el único
    // cambio de estado masivo del sistema. Sin esto hay que abrir proceso por proceso
    // en la solapa Planificación.
    const [modoSeleccion, setModoSeleccion] = useState(false);
    const [seleccionados, setSeleccionados] = useState<Map<string, ProcesoRef>>(new Map());
    const [guardandoMasivo, setGuardandoMasivo] = useState(false);

    // Índice de la planificación: solo se recalcula si cambió el plan.
    const planIndex = React.useMemo(
        () => construirPlanPorPasada(planificacion || []),
        [planificacion]
    );
    /** ¿Esta lista tiene horario y máquina para mostrar? Solo "Planificadas". */
    const conPlan = !!planificacion;

    const puedeSeleccionar = !!onProcessStatusChange;
    const puedeBorrarProceso = !!onProcessDelete;

    // OTs con el archivo del plano realmente cargado (la bandera del legacy no alcanza).
    const ordenesConPlano = useOrdenesConPlano();

    // Mismo patrón que PlanningListTable: el degradado del borde derecho se oculta
    // dinámicamente cuando el usuario llegó al final del scroll horizontal.
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [showRightFade, setShowRightFade] = useState(true);
    const [sortConfig, setSortConfig] = useState<{
        key: 'id' | 'id_otvieja' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'prioridad' | 'material' | 'proceso' | 'plano' | 'entrega' | 'fecha_prometida' | null;
        direction: 'asc' | 'desc' | null;
    }>({ key: null, direction: null });

    const toggleRow = (orderId: number) => {
        setExpandedOrderIds(prev =>
            prev.includes(orderId)
                ? prev.filter(id => id !== orderId)
                : [...prev, orderId]
        );
    };

    const handleSort = (key: typeof sortConfig.key) => {
        let direction: 'asc' | 'desc' | null = 'asc';
        if (sortConfig.key === key) {
            if (sortConfig.direction === 'asc') direction = 'desc';
            else if (sortConfig.direction === 'desc') direction = null;
        }
        setSortConfig({ key: direction ? key : null, direction });
    };

    const getEditableProductDescription = (order: WorkOrder) => {
        if ((order.articulo?.cod_articulo === 'NO-DEF' || order.articulo?.descripcion?.toLowerCase().includes('heredado')) && order.observaciones) {
            return order.observaciones;
        }
        return order.articulo?.descripcion;
    };

    const SortIcon = ({ column }: { column: typeof sortConfig.key }) => {
        if (sortConfig.key !== column || !sortConfig.direction) return <span className="ml-1 text-gray-300 opacity-0 group-hover:opacity-50">↕</span>;
        return <span className={cn("ml-1 font-bold", copy.acentoOrden)}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
    };

    // Observa el scroll horizontal y actualiza `showRightFade` (true cuando hay
    // más columnas a la derecha, false cuando se llegó al final). Margen de 2px
    // para evitar parpadeo por subpixel rendering.
    React.useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const updateFade = () => {
            const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
            setShowRightFade(remaining > 2);
        };
        updateFade();
        el.addEventListener('scroll', updateFade, { passive: true });
        const ro = new ResizeObserver(updateFade);
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', updateFade);
            ro.disconnect();
        };
    }, [orders.length, tableZoom]);

    const filteredOrders = applyWorkOrderFilters(orders, filters).filter(order => {
        const searchLower = searchTerm.toLowerCase();
        const otId = order.id.toString();
        const oldOtId = order.id_otvieja?.toString() || "";
        const clientRaw = order.cliente;
        const clientName = (typeof clientRaw === 'object' && clientRaw !== null ? (clientRaw as any).nombre : (clientRaw || "")).toString().toLowerCase();
        const artRaw = order.articulo;
        const article = (typeof artRaw === 'object' && artRaw !== null ? (artRaw as any).descripcion : (artRaw || "")).toString().toLowerCase();
        const codArticle = (typeof artRaw === 'object' && artRaw !== null ? (artRaw as any).cod_articulo : "").toString().toLowerCase();
        
        return otId.includes(searchLower) || 
               oldOtId.includes(searchLower) || 
               clientName.includes(searchLower) ||
               article.includes(searchLower) ||
               codArticle.includes(searchLower);
    });

    const sortedOrders = React.useMemo(() => {
        if (!sortConfig.key || !sortConfig.direction) return filteredOrders;
        return [...filteredOrders].sort((a, b) => {
            switch (sortConfig.key) {
                case 'id':
                    return sortConfig.direction === 'asc' ? a.id - b.id : b.id - a.id;
                case 'id_otvieja':
                    return sortConfig.direction === 'asc' ? (a.id_otvieja || 0) - (b.id_otvieja || 0) : (b.id_otvieja || 0) - (a.id_otvieja || 0);
                case 'fecha_entrada':
                    return sortConfig.direction === 'asc'
                        ? new Date(a.fecha_entrada || 0).getTime() - new Date(b.fecha_entrada || 0).getTime()
                        : new Date(b.fecha_entrada || 0).getTime() - new Date(a.fecha_entrada || 0).getTime();
                case 'cliente':
                    return sortConfig.direction === 'asc'
                        ? (a.cliente?.nombre || "").localeCompare(b.cliente?.nombre || "")
                        : (b.cliente?.nombre || "").localeCompare(a.cliente?.nombre || "");
                case 'codigo':
                    return sortConfig.direction === 'asc'
                        ? (a.articulo?.cod_articulo || "").localeCompare(b.articulo?.cod_articulo || "")
                        : (b.articulo?.cod_articulo || "").localeCompare(a.articulo?.cod_articulo || "");
                case 'descripcion':
                    return sortConfig.direction === 'asc'
                        ? (a.articulo?.descripcion || "").localeCompare(b.articulo?.descripcion || "")
                        : (b.articulo?.descripcion || "").localeCompare(a.articulo?.descripcion || "");
                case 'unidades':
                    return sortConfig.direction === 'asc' ? (a.unidades || 0) - (b.unidades || 0) : (b.unidades || 0) - (a.unidades || 0);
                case 'prioridad':
                    return sortConfig.direction === 'asc' ? (a.id_prioridad || 0) - (b.id_prioridad || 0) : (b.id_prioridad || 0) - (a.id_prioridad || 0);
                case 'material': {
                    // Rango: OK (mejor) → Pedido → Sin Stock (peor). `undefined` se trata como Sin Stock.
                    const rank = (estado?: string) => (estado === 'ok' ? 2 : estado === 'pedido' ? 1 : 0);
                    const diff = rank(a.estado_material) - rank(b.estado_material);
                    return sortConfig.direction === 'asc' ? diff : -diff;
                }
                case 'proceso': {
                    const has = (o: WorkOrder) => (o.procesos && o.procesos.length > 0 ? 1 : 0);
                    const diff = has(a) - has(b);
                    return sortConfig.direction === 'asc' ? diff : -diff;
                }
                case 'plano': {
                    const has = (o: WorkOrder) => rankPlano(estadoPlano(o.id, o.tiene_plano, ordenesConPlano));
                    const diff = has(a) - has(b);
                    return sortConfig.direction === 'asc' ? diff : -diff;
                }
                case 'entrega': {
                    // Ordena por proporción entregada (cantidad_entregada / unidades).
                    const ratio = (o: WorkOrder) => (o.cantidad_entregada || 0) / (o.unidades || 1);
                    const diff = ratio(a) - ratio(b);
                    return sortConfig.direction === 'asc' ? diff : -diff;
                }
                case 'fecha_prometida':
                    return sortConfig.direction === 'asc'
                        ? new Date(a.fecha_prometida || 0).getTime() - new Date(b.fecha_prometida || 0).getTime()
                        : new Date(b.fecha_prometida || 0).getTime() - new Date(a.fecha_prometida || 0).getTime();
                default:
                    return 0;
            }
        });
    }, [filteredOrders, sortConfig]);

    const formatDate = (dateStr?: string) => {
        if (!dateStr || dateStr.startsWith('1950')) return "-";
        try {
            const date = new Date(dateStr);
            if (date.getFullYear() === 1950) return "-";
            return date.toLocaleDateString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        } catch (e) {
            return dateStr;
        }
    };

    const getPriorityLabel = (priorityId?: number, descripcion?: string) => {
        if (descripcion) return descripcion;
        switch (priorityId) {
            case 3: return "Crítica";
            case 2: return "Urgente";
            case 1: return "Normal";
            default: return "Normal";
        }
    };

    // --- Procesos: identidad, selección y plan ---

    type Proceso = WorkOrder["procesos"][number];

    /** Identifica la fila de un proceso. Va con la PASADA (`proc.id`) porque el mismo
     *  proceso puede repetirse en la OT; el índice es la red por si la pasada no vino. */
    const claveProceso = (ordenId: number, proc: Proceso, indice: number) =>
        `${ordenId}-${proc.id ?? `p${proc.proceso.id}-${indice}`}`;

    const refDeProceso = (ordenId: number, proc: Proceso): ProcesoRef => ({
        ordenId,
        procesoId: proc.proceso.id,
        idOtp: proc.id,
        nombre: proc.proceso?.nombre || "este proceso",
    });

    const planDeProceso = (ordenId: number, proc: Proceso): PlanDePasada | undefined =>
        (proc.id != null ? planIndex.porOtp.get(proc.id) : undefined)
        ?? planIndex.porProceso.get(`${ordenId}-${proc.proceso.id}`);

    const alternarProceso = (clave: string, ref: ProcesoRef) => {
        setSeleccionados(prev => {
            const next = new Map(prev);
            if (next.has(clave)) next.delete(clave);
            else next.set(clave, ref);
            return next;
        });
    };

    /** Tilda o destilda de un saque todos los procesos de una OT. */
    const alternarOrdenCompleta = (order: WorkOrder) => {
        const procesos = order.procesos || [];
        const claves = procesos.map((proc, i) => claveProceso(order.id, proc, i));
        const todosTildados = claves.length > 0 && claves.every(c => seleccionados.has(c));
        setSeleccionados(prev => {
            const next = new Map(prev);
            procesos.forEach((proc, i) => {
                const clave = claves[i];
                if (todosTildados) next.delete(clave);
                else next.set(clave, refDeProceso(order.id, proc));
            });
            return next;
        });
    };

    const salirDeSeleccion = () => {
        setModoSeleccion(false);
        setSeleccionados(new Map());
    };

    const marcarCompletados = async () => {
        if (!onProcessStatusChange || seleccionados.size === 0) return;
        setGuardandoMasivo(true);
        try {
            // 3 = Finalizado, el mismo id que usa el combo de estado de Planificación.
            await onProcessStatusChange(Array.from(seleccionados.values()), 3);
            salirDeSeleccion();
        } finally {
            setGuardandoMasivo(false);
        }
    };

    /** Columnas del panel "Producción". Va como estilo y no como clase de Tailwind
     *  porque cambia según la solapa y las clases dinámicas no sobreviven al build. */
    const columnasProcesos = React.useMemo(() => {
        const cols: string[] = [];
        if (modoSeleccion) cols.push("28px");
        cols.push("30px", "minmax(130px, 2.5fr)", "95px", "70px", "70px", "minmax(110px, 1.6fr)");
        if (conPlan) cols.push("minmax(100px, 1.3fr)", "minmax(140px, 1.7fr)");
        if (puedeBorrarProceso) cols.push("32px");
        return cols.join(" ");
    }, [modoSeleccion, conPlan, puedeBorrarProceso]);

    return (
        <div className="space-y-4">
            {/* Header & Search */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-2">
                    <div className={cn("p-2 rounded-lg", copy.acentoCaja)}>
                        {variante === "planificadas" ? <ClipboardList className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900">{copy.titulo}</h3>
                        <p className="text-xs text-gray-500">{copy.bajada}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Buscar por OT, Cliente o Producto..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 h-10 bg-gray-50/50 border-gray-200 focus:bg-white transition-all rounded-lg"
                        />
                    </div>
                    {puedeSeleccionar && (
                        <button
                            type="button"
                            onClick={() => (modoSeleccion ? salirDeSeleccion() : setModoSeleccion(true))}
                            title={
                                modoSeleccion
                                    ? "Salir de la edición rápida"
                                    : "Tildar varios procesos y cerrarlos todos juntos. Abrí una orden para ver sus procesos."
                            }
                            className={cn(
                                "h-10 shrink-0 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors",
                                modoSeleccion
                                    ? "bg-gray-800 text-white border-gray-800"
                                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                            )}
                        >
                            {modoSeleccion ? <X className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                            {modoSeleccion ? "Cancelar" : "Edición rápida"}
                        </button>
                    )}
                </div>
            </div>

            {/* En modo selección los procesos se tildan adentro de cada orden, así que
                hace falta decir dónde están: si no, se ve una tabla sin un solo casillero. */}
            {modoSeleccion && (
                <div className="flex items-center gap-2 rounded-lg border border-gray-800/15 bg-gray-800/5 px-3 py-2 text-xs text-gray-600">
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                    <span>
                        Abrí una orden con la flecha de la izquierda y tildá los procesos que quieras cerrar.
                        Podés tildar procesos de varias órdenes antes de guardar.
                    </span>
                </div>
            )}

            <WorkOrderFilters filters={filters} setFilters={setFilters} orders={orders} />

            {filteredOrders.length === 0 ? (
                <div className="py-20 text-center bg-gray-50/30 rounded-2xl border-2 border-dashed border-gray-100">
                    <Clock className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                    <h4 className="text-lg font-medium text-gray-900 font-bold">{copy.vacioTitulo}</h4>
                    <p className="text-gray-500 max-w-xs mx-auto text-sm">
                        {copy.vacioBajada}
                    </p>
                </div>
            ) : (
                <>
                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-3">
                        {sortedOrders.map((order) => (
                            <Card key={order.id} className={cn("overflow-hidden border border-gray-200 shadow-sm", getWorkOrderRowColor(order))}>
                                <div className="p-4" onClick={() => toggleRow(order.id)}>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-lg text-gray-800">#{order.id_otvieja || order.id}</span>
                                            <Badge className={cn("text-[9px]", copy.badgeClase)}>{copy.badge}</Badge>
                                        </div>
                                        <button className="text-gray-400">
                                            {expandedOrderIds.includes(order.id) ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                        </button>
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="font-semibold text-gray-900 line-clamp-1">{order.cliente?.nombre || "-"}</span>
                                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{order.articulo?.cod_articulo}</span>
                                        </div>
                                        <div className="text-gray-600 line-clamp-2 text-xs">{(order.articulo?.cod_articulo === 'NO-DEF' || order.articulo?.descripcion?.toLowerCase().includes('heredado')) && order.observaciones ? order.observaciones : order.articulo?.descripcion}</div>
                                        <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-gray-100/50 mt-2">
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">Cant.</span>
                                                <span className="font-medium">{order.unidades}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">Prioridad</span>
                                                <Badge variant="outline" className="bg-white/50 text-[10px] h-5 px-1.5">
                                                    {getPriorityLabel(order.id_prioridad, order.prioridad?.descripcion)}
                                                </Badge>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">N° Pedido</span>
                                                <span className="font-medium text-gray-700">{order.n_pedido || order.n_ped_l || "-"}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">Aprobado Por</span>
                                                <span className="font-medium text-gray-700">{order.aprobado_por || "-"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {expandedOrderIds.includes(order.id) && (
                                    <div className="bg-gray-50 border-t p-3 space-y-2">
                                        <div className="text-xs text-gray-600">
                                            <span className="font-bold text-gray-800">Observaciones: </span>
                                            {order.observaciones || order.detalle || "Sin observaciones adicionales"}
                                        </div>
                                        <OrderFiles orderId={order.id} />
                                        {/* Process Sub-Table */}
                                        {order.procesos && order.procesos.length > 0 ? (
                                            <div className="w-full border rounded-md overflow-hidden bg-white shadow-inner">
                                                <div className="bg-gray-100 text-[11px] uppercase text-gray-600 grid grid-cols-[40px_3fr_110px_70px] gap-3 px-4 py-2 font-bold border-b border-gray-200">
                                                    <div>#</div>
                                                    <div>Proceso</div>
                                                    <div>Estado</div>
                                                    <div className="text-center">Min. Est.</div>
                                                </div>
                                                {[...order.procesos].sort((a, b) => a.orden - b.orden).map((proc) => (
                                                    <div key={`${order.id}-${proc.proceso.id}`} className="grid grid-cols-[40px_3fr_110px_70px] gap-3 px-3 py-3 border-t hover:bg-gray-50 items-center bg-white text-sm">
                                                        <div className="text-gray-500 font-mono">{proc.orden}</div>
                                                        <div className="font-medium text-xs truncate">{proc.proceso?.nombre || "-"}</div>
                                                        <div>
                                                            <Badge className={cn(
                                                                "text-[10px] shadow-none",
                                                                proc.estado_proceso?.id === 3 ? "bg-green-100 text-green-800 border-green-200" :
                                                                proc.estado_proceso?.id === 2 ? "bg-blue-100 text-blue-800 border-blue-200" :
                                                                "bg-gray-100 text-gray-800 border-gray-200"
                                                            )}>
                                                                {proc.estado_proceso?.id === 3 ? "Finalizado" : proc.estado_proceso?.id === 2 ? "En Proceso" : "Pendiente"}
                                                            </Badge>
                                                        </div>
                                                        <div className="text-center text-gray-600 text-xs">{proc.tiempo_proceso || "-"}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-gray-400 italic py-2">Sin procesos cargados</div>
                                        )}
                                        <div className="flex gap-2 justify-end pt-2">
                                            <Button variant="ghost" size="sm" className={cn("h-8 gap-1.5 hover:bg-gray-100", copy.acentoOrden)} onClick={() => onEdit(order)}>
                                                <Edit2 className="w-3.5 h-3.5" /> Editar
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600 hover:bg-red-50" onClick={() => onDelete(order.id)}>
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        ))}
                    </div>

                    {/* Desktop Table View. El `zoom` aplica SOLO acá (no al header ni a los filtros). */}
                    <Card className="hidden md:block overflow-hidden border-none shadow-xl bg-white w-full relative" style={{ zoom: tableZoom / 100 }}>
                        <div ref={scrollContainerRef} className="w-full overflow-x-auto scrollbar-horizontal-visible scrollbar-top">
                            <table className="w-full min-w-[1600px] text-sm text-left">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                                    <tr>
                                        <th className="w-10 px-3 py-3"></th>
                                        <th className="w-12 px-3 py-3 font-bold text-gray-500 text-center" title="Número de fila">#</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('id_otvieja')}>
                                            <div className="flex items-center">OT<SortIcon column="id_otvieja" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('fecha_entrada')}>
                                            <div className="flex items-center">F. Entrada<SortIcon column="fecha_entrada" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group min-w-[200px]" onClick={() => handleSort('cliente')}>
                                            <div className="flex items-center">Cliente<SortIcon column="cliente" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('codigo')}>
                                            <div className="flex items-center">Código<SortIcon column="codigo" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group min-w-[400px]" onClick={() => handleSort('descripcion')}>
                                            <div className="flex items-center">Producto<SortIcon column="descripcion" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600">N° Pedido</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('unidades')}>
                                            <div className="flex items-center justify-center">Cant.<SortIcon column="unidades" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('prioridad')}>
                                            <div className="flex items-center justify-center">Prioridad<SortIcon column="prioridad" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('material')}>
                                            <div className="flex items-center justify-center">Material<SortIcon column="material" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" title="¿La OT tiene procesos cargados?" onClick={() => handleSort('proceso')}>
                                            <div className="flex items-center justify-center">Proceso<SortIcon column="proceso" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" title="¿La OT tiene plano cargado?" onClick={() => handleSort('plano')}>
                                            <div className="flex items-center justify-center">Plano<SortIcon column="plano" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('entrega')}>
                                            <div className="flex items-center justify-center">Entrega<SortIcon column="entrega" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('fecha_prometida')}>
                                            <div className="flex items-center">F. Prometida<SortIcon column="fecha_prometida" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600">Aprobado x</th>
                                        <th className="px-3 py-3 font-bold text-gray-600">Pedido x</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                {/* `[&_td]:align-middle` centra verticalmente las celdas de cada fila
                                    para que cuando el nombre del cliente o el producto haga wrap a
                                    varias líneas, el resto de las celdas (#, OT, fecha, código) no
                                    queden ancladas al top. */}
                                <tbody className="[&_td]:align-middle">
                                    {sortedOrders.length === 0 ? (
                                        <tr className="bg-gray-50 border-b">
                                            <td colSpan={19} className="px-4 py-8 text-center text-gray-500">
                                                {searchTerm ? "No se encontraron resultados para la búsqueda." : copy.vacioFila}
                                            </td>
                                        </tr>
                                    ) : (
                                        sortedOrders.map((order, index) => (
                                            <React.Fragment key={order.id}>
                                                {/* Doble click en cualquier parte de la fila abre el modal de edición. */}
                                                <tr className={cn("border-b transition-colors duration-150 cursor-pointer", getWorkOrderRowColor(order))} onDoubleClick={() => onEdit(order)}>
                                                    <td className="px-3 py-3">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); toggleRow(order.id); }}
                                                            className="p-1 hover:bg-black/10 rounded transition-colors"
                                                        >
                                                            {expandedOrderIds.includes(order.id) ? (
                                                                <ChevronDown className="h-4 w-4 text-gray-600" />
                                                            ) : (
                                                                <ChevronRight className="h-4 w-4 text-gray-400" />
                                                            )}
                                                        </button>
                                                    </td>
                                                    <td className="px-3 py-3 text-center text-gray-500 font-mono text-xs select-none">{index + 1}</td>
                                                    <td className="px-3 py-3 font-medium">{order.id_otvieja || order.id}</td>
                                                    <td className="px-3 py-3 font-medium">
                                                        {formatDate(order.fecha_entrada)}
                                                    </td>
                                                    <td className="px-3 py-3 text-gray-500 italic">{typeof order.cliente === 'object' ? order.cliente?.nombre : order.cliente || "-"}</td>
                                                    <td className="px-3 py-3 font-mono text-xs">{order.articulo?.cod_articulo || "-"}</td>
                                                    <td className="px-3 py-3 font-medium text-gray-900 min-w-[300px] max-w-[450px]">
                                                        <span className="line-clamp-2" title={getEditableProductDescription(order)}>
                                                            {getEditableProductDescription(order) || "-"}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 text-xs text-gray-600">
                                                        {order.n_pedido || order.n_ped_l || "-"}
                                                    </td>
                                                    <td className="px-3 py-3 text-center font-medium">
                                                        {order.unidades ?? "-"}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                            {getPriorityLabel(order.id_prioridad, order.prioridad?.descripcion)}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        {order.estado_material === 'sin_stock' ? (
                                                            <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200 gap-1 pl-1.5 shadow-none font-semibold">
                                                                <AlertTriangle className="h-3 w-3" /> Sin Stock
                                                            </Badge>
                                                        ) : order.estado_material === 'pedido' ? (
                                                            <Badge variant="outline" className="bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200 gap-1 pl-1.5 shadow-none font-semibold">
                                                                Pedido
                                                            </Badge>
                                                        ) : order.estado_material === 'ok' ? (
                                                            <Badge variant="outline" className="bg-green-50 text-green-700 hover:bg-green-100 border-green-200 gap-1 pl-1.5 shadow-none font-semibold">
                                                                <CheckCircle2 className="h-3 w-3" /> OK
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200 gap-1 pl-1.5 shadow-none font-semibold">
                                                                <AlertTriangle className="h-3 w-3" /> Sin Stock
                                                            </Badge>
                                                        )}
                                                    </td>
                                                    {/* Proceso: Sí (verde) si tiene al menos un proceso cargado, No (gris) si no. */}
                                                    <td className="px-3 py-3 text-center">
                                                        {(order.procesos && order.procesos.length > 0) ? (
                                                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-semibold">Sí</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 font-semibold">No</Badge>
                                                        )}
                                                    </td>
                                                    {/* Plano: verde si el archivo está cargado, ámbar si la OT
                                                        está marcada con plano pero no hay archivo, gris si no
                                                        lleva. Solo el archivo real restringe la asignación a
                                                        operarios que saben leer planos. */}
                                                    <td className="px-3 py-3 text-center">
                                                        {(() => {
                                                            const est = estadoPlano(order.id, order.tiene_plano, ordenesConPlano);
                                                            if (est === 'adjunto') return (
                                                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-semibold">Sí</Badge>
                                                            );
                                                            if (est === 'marcado_sin_archivo') return (
                                                                <Badge
                                                                    variant="outline"
                                                                    className="bg-amber-50 text-amber-700 border-amber-200 font-semibold"
                                                                    title="La OT figura con plano pero no tiene el archivo cargado. Para el planificador es una OT sin plano."
                                                                >
                                                                    Sin archivo
                                                                </Badge>
                                                            );
                                                            return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 font-semibold">No</Badge>;
                                                        })()}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className={cn(
                                                            "text-xs font-bold",
                                                            (order.cantidad_entregada || 0) >= (order.unidades || 1) ? "text-green-700" : "text-orange-600"
                                                        )}>
                                                            {order.cantidad_entregada || 0} / {order.unidades || 0}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 font-medium">
                                                        {formatDate(order.fecha_prometida)}
                                                    </td>
                                                    <td className="px-3 py-3 text-xs text-gray-600" title={order.aprobado_por || "-"}>
                                                        {order.aprobado_por || "-"}
                                                    </td>
                                                    <td className="px-3 py-3 text-xs text-gray-600" title={order.requerido_por || "-"}>
                                                        {order.requerido_por || "-"}
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                onClick={(e) => { e.stopPropagation(); onDelete(order.id); }}
                                                                title="Eliminar Orden"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {expandedOrderIds.includes(order.id) && (
                                                    <tr className="bg-gray-50/20 border-b">
                                                        <td colSpan={19} className="px-3 py-3 md:px-6 md:py-4">
                                                            <div className="flex flex-col gap-4 w-full max-w-[1200px]">
                                                                {/* Grid layout for meta info - More compact columns */}
                                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                                    {/* Observaciones Panel - Smaller min-height, compact header */}
                                                                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col md:col-span-1 lg:col-span-2">
                                                                        <div className="px-3 py-1.5 bg-gray-50/50 border-b border-gray-100 flex items-center gap-2">
                                                                            <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
                                                                            <span className="text-[10px] font-bold uppercase tracking-tight text-gray-500">Observaciones</span>
                                                                        </div>
                                                                        <div className="p-3 text-xs text-gray-600 leading-relaxed min-h-[50px]">
                                                                            {order.observaciones || order.detalle ? (
                                                                                <div className="whitespace-pre-wrap">{order.observaciones || order.detalle}</div>
                                                                            ) : (
                                                                                <span className="text-gray-400 italic">Sin observaciones.</span>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* Archivos Panel - Compact layout */}
                                                                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                                                                        <div className="px-3 py-1.5 bg-gray-50/50 border-b border-gray-100 flex items-center gap-2">
                                                                            <FileText className="w-3.5 h-3.5 text-gray-400" />
                                                                            <span className="text-[10px] font-bold uppercase tracking-tight text-gray-500">Archivos</span>
                                                                        </div>
                                                                        <div className="p-2">
                                                                            <OrderFiles orderId={order.id} />
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Proceso Panel - Tighter headers and rows */}
                                                                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                                                                    <div className="px-3 py-1.5 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            <Settings className="w-3.5 h-3.5 text-gray-400" />
                                                                            <span className="text-[10px] font-bold uppercase tracking-tight text-gray-500">Producción</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2">
                                                                            {modoSeleccion && order.procesos && order.procesos.length > 0 && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => alternarOrdenCompleta(order)}
                                                                                    className="text-[10px] font-bold uppercase tracking-tight text-gray-500 hover:text-gray-800 underline decoration-dotted underline-offset-2"
                                                                                >
                                                                                    {order.procesos.every((proc, i) => seleccionados.has(claveProceso(order.id, proc, i)))
                                                                                        ? "Destildar todos"
                                                                                        : "Tildar todos"}
                                                                                </button>
                                                                            )}
                                                                            {order.procesos && order.procesos.length > 0 && (
                                                                                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                                                                    {order.procesos.length} PASOS
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    <div className="flex flex-col">
                                                                        {order.procesos && order.procesos.length > 0 ? (
                                                                            <>
                                                                                <div
                                                                                    className="bg-gray-50/30 text-[9px] uppercase text-gray-400 grid gap-3 px-4 py-1.5 font-bold border-b border-gray-100"
                                                                                    style={{ gridTemplateColumns: columnasProcesos }}
                                                                                >
                                                                                    {modoSeleccion && <div />}
                                                                                    <div>#</div>
                                                                                    <div>Proceso</div>
                                                                                    <div>Estado</div>
                                                                                    <div className="text-center">Min. Est.</div>
                                                                                    <div className="text-center">Min. Real</div>
                                                                                    <div>Recurso humano</div>
                                                                                    {conPlan && <div>Máquina</div>}
                                                                                    {conPlan && <div>Horario</div>}
                                                                                    {puedeBorrarProceso && <div />}
                                                                                </div>
                                                                                {[...order.procesos].sort((a, b) => a.orden - b.orden).map((proc, pIdx) => {
                                                                                    const clave = claveProceso(order.id, proc, pIdx);
                                                                                    const tildado = seleccionados.has(clave);
                                                                                    const plan = conPlan ? planDeProceso(order.id, proc) : undefined;
                                                                                    // Sin horario hay dos motivos distintos y no dan lo mismo: o el proceso
                                                                                    // se agregó después de planificar (hay que replanificar), o está en el
                                                                                    // plan pero se repite en la OT y el plan es viejo (no se puede saber
                                                                                    // qué pasada es cuál). Decir "Sin planificar" en el segundo caso manda
                                                                                    // a replanificar una OT que ya está planificada.
                                                                                    const estaEnElPlan = planIndex.procesosEnElPlan.has(`${order.id}-${proc.proceso.id}`);
                                                                                    return (
                                                                                    <div
                                                                                        key={clave}
                                                                                        className={cn(
                                                                                            "grid gap-3 px-4 py-2.5 border-b items-center transition-colors",
                                                                                            tildado ? "bg-red-50/40 hover:bg-red-50/60" : "bg-white hover:bg-gray-50/80",
                                                                                            modoSeleccion && "cursor-pointer",
                                                                                            pIdx === order.procesos!.length - 1 && "border-b-0"
                                                                                        )}
                                                                                        style={{ gridTemplateColumns: columnasProcesos }}
                                                                                        onClick={modoSeleccion ? () => alternarProceso(clave, refDeProceso(order.id, proc)) : undefined}
                                                                                    >
                                                                                        {modoSeleccion && (
                                                                                            <div className="flex items-center justify-center">
                                                                                                <div className={cn(
                                                                                                    "w-4 h-4 rounded border-2 flex items-center justify-center transition-all",
                                                                                                    tildado ? "bg-red-500 border-red-500 text-white" : "bg-white border-gray-300"
                                                                                                )}>
                                                                                                    {tildado && <Check className="w-2.5 h-2.5" />}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                        <div className="text-gray-300 font-mono text-[10px]">{pIdx + 1}</div>
                                                                                        <div className="font-semibold text-xs text-gray-800 truncate" title={proc.proceso?.nombre || "-"}>{proc.proceso?.nombre || "-"}</div>
                                                                                        <div>
                                                                                            <Badge className={cn(
                                                                                                "text-[9px] px-1.5 py-0 shadow-none font-bold uppercase leading-tight",
                                                                                                proc.estado_proceso?.id === 3 ? "bg-green-100 text-green-700 border-green-200" :
                                                                                                proc.estado_proceso?.id === 2 ? "bg-blue-100 text-blue-700 border-blue-200" :
                                                                                                "bg-gray-100 text-gray-500 border-gray-200"
                                                                                            )}>
                                                                                                {proc.estado_proceso?.id === 3 ? "OK" : proc.estado_proceso?.id === 2 ? "Producc." : "Pend."}
                                                                                            </Badge>
                                                                                        </div>
                                                                                        <div className="text-center text-gray-500 tabular-nums text-[10px]">{proc.tiempo_proceso || "-"}</div>
                                                                                        <div className="text-center font-bold text-blue-600 tabular-nums text-[10px]">
                                                                                            {proc.inicio_real && proc.fin_real
                                                                                                ? `${Math.round((new Date(proc.fin_real).getTime() - new Date(proc.inicio_real).getTime()) / 60000)}`
                                                                                                : proc.inicio_real ? "..." : "-"
                                                                                            }
                                                                                        </div>
                                                                                        <div className="text-gray-500 text-[10px] font-medium truncate flex items-center gap-1.5 border-l border-gray-100 pl-2 h-4">
                                                                                            {proc.operario_nombre ? proc.operario_nombre.toLowerCase().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : "Sin Asignar"}
                                                                                        </div>
                                                                                        {/* Máquina y horario salen del plan, no de la OT. Un proceso puede
                                                                                            estar cargado y todavía no planificado (se agregó después de
                                                                                            planificar): ahí no hay horario que mostrar. */}
                                                                                        {conPlan && (
                                                                                            <div className="text-gray-500 text-[10px] font-medium truncate flex items-center gap-1" title={plan?.maquina || undefined}>
                                                                                                {plan?.maquina ? (
                                                                                                    <>
                                                                                                        <Wrench className="w-2.5 h-2.5 shrink-0 text-indigo-400" />
                                                                                                        <span className="truncate">{plan.maquina}</span>
                                                                                                    </>
                                                                                                ) : (
                                                                                                    <span className="text-gray-300 italic">Sin máquina</span>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                        {conPlan && (
                                                                                            <div className="text-[10px] tabular-nums truncate">
                                                                                                {plan ? (
                                                                                                    <span className="text-gray-600 font-medium">
                                                                                                        {plan.inicio} <span className="text-gray-300">→</span> {plan.fin}
                                                                                                    </span>
                                                                                                ) : estaEnElPlan ? (
                                                                                                    <span
                                                                                                        className="text-gray-400 font-medium"
                                                                                                        title="Está planificado, pero este proceso va más de una vez en la orden y el plan es anterior al cambio que las distingue: no se puede saber qué horario le toca a cada una. Se acomoda solo la próxima vez que planifiques la OT."
                                                                                                    >
                                                                                                        Sin dato
                                                                                                    </span>
                                                                                                ) : (
                                                                                                    <span
                                                                                                        className="text-amber-600 font-medium"
                                                                                                        title="Este proceso se agregó después de planificar la orden. Volvé a planificarla para darle horario, operario y máquina."
                                                                                                    >
                                                                                                        Sin planificar
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                        {puedeBorrarProceso && (
                                                                                            <div className="flex items-center justify-center">
                                                                                                {!modoSeleccion && (
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        onClick={(e) => { e.stopPropagation(); onProcessDelete!(refDeProceso(order.id, proc)); }}
                                                                                                        title="Eliminar este proceso de la orden"
                                                                                                        className="h-6 w-6 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors"
                                                                                                    >
                                                                                                        <Trash2 className="w-3 h-3" />
                                                                                                    </button>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                    );
                                                                                })}
                                                                                <div className="bg-gray-50/50 border-t border-gray-100">
                                                                                    <AddProcessRow 
                                                                                        orderId={order.id} 
                                                                                        onProcessAdded={() => onDataChange && onDataChange()} 
                                                                                    />
                                                                                </div>
                                                                            </>
                                                                        ) : (
                                                                            <div className="p-4 flex items-center justify-between bg-white">
                                                                                <div className="flex items-center gap-3">
                                                                                    <div className="bg-blue-50 p-2 rounded-full">
                                                                                        <PlusCircle className="w-4 h-4 text-blue-500" />
                                                                                    </div>
                                                                                    <div className="flex flex-col">
                                                                                        <span className="text-xs font-bold text-gray-700">Sin procesos configurados</span>
                                                                                        <span className="text-[10px] text-gray-400">Agregue los pasos para iniciar la producción.</span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="w-auto">
                                                                                    <AddProcessRow 
                                                                                        orderId={order.id} 
                                                                                        onProcessAdded={() => onDataChange && onDataChange()} 
                                                                                        isCentered={false}
                                                                                        label="Configurar ahora"
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {/* Gradient fade derecho — solo visible cuando hay más columnas a la
                            derecha del scroll. Desaparece con transición cuando el usuario
                            llega al final, igual que en PlanningListTable. */}
                        <div
                            className={`pointer-events-none absolute top-0 right-0 h-full w-12 bg-gradient-to-l from-white via-white/80 to-transparent transition-opacity duration-200 ${showRightFade ? 'opacity-100' : 'opacity-0'}`}
                        />
                    </Card>
                </>
            )}

            {/* Barra flotante de la edición rápida. Solo aparece cuando hay algo tildado,
                para no tapar la tabla mientras se elige. */}
            {modoSeleccion && seleccionados.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                    <div className="bg-gray-900 text-white px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-5 border border-gray-700">
                        <div className="flex items-center gap-2 border-r border-gray-700 pr-5">
                            <span className="bg-white text-gray-900 text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center tabular-nums">
                                {seleccionados.size}
                            </span>
                            <span className="font-medium text-sm">
                                {seleccionados.size === 1 ? "proceso tildado" : "procesos tildados"}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={marcarCompletados}
                                disabled={guardandoMasivo}
                                className="bg-green-600 hover:bg-green-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-full text-sm font-bold transition-colors flex items-center gap-2"
                            >
                                <Check className="w-4 h-4" />
                                {guardandoMasivo ? "Guardando..." : "Marcar completados"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setSeleccionados(new Map())}
                                disabled={guardandoMasivo}
                                className="text-gray-400 hover:text-white disabled:opacity-40 transition-colors p-1"
                                title="Destildar todo"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
