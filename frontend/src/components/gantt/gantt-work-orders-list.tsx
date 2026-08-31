"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { GanttTask } from "@/lib/types";
import { toTitleCase } from "@/lib/gantt-utils";
import { OrderFiles } from "@/components/common/OrderFiles";
import { RegisterDeliveryDialog } from "@/components/planning/RegisterDeliveryDialog";
import { AddProcessRow } from "@/components/planning/AddProcessRow";
import { cn } from "@/lib/utils";
import {
    Clipboard,
    Search,
    Pencil,
    X as XIcon,
    Check,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    Clock,
    Calendar as CalendarIcon,
    Cog,
    ListChecks,
    PackageCheck,
    Plus,
    Paperclip,
    AlertCircle,
    Wrench,
    ArrowUp,
    ArrowDown,
    Trash2,
} from "lucide-react";

interface GanttWorkOrdersListProps {
    tasks: GanttTask[];
    onTaskClick?: (task: GanttTask) => void;
    onBulkStatusChange?: (taskIds: string[], newStatus: string) => void;
    onProcessReorder?: (ordenId: number, orderedTasks: GanttTask[]) => void;
    onTaskDelete?: (task: GanttTask) => void;
    onDataRefresh?: () => void;
}

/** Filtros de la barra superior. Nacen del pedido de Lucas (14/08): el sistema
 *  viejo tenía un panel de filtros a la vista (Pendientes / Todas / Finalizados
 *  Pend. Entrega + urgencia) y acá solo había un buscador. Son los mismos
 *  criterios traducidos a los datos que sí tenemos: avance de procesos,
 *  prioridad y entrega. */
type EstadoFiltro = "todas" | "pendientes" | "en_proceso" | "terminadas" | "pend_entrega";
type PrioridadFiltro = "todas" | "urgentes" | "normales";
type EntregaFiltro = "todas" | "sin_entregar" | "parcial" | "completa";

/** Botón de filtro tipo "pill". Chico a propósito: la barra entera tiene que
 *  entrar en dos renglones y no comerse la pantalla. */
function FilterPill({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap",
                active
                    ? "bg-red-600 text-white border-red-600 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
            )}
        >
            {children}
        </button>
    );
}

export function GanttWorkOrdersList({ tasks, onTaskClick, onBulkStatusChange, onProcessReorder, onTaskDelete, onDataRefresh }: GanttWorkOrdersListProps) {
    const [searchTerm, setSearchTerm] = React.useState("");
    const [isSelectionMode, setIsSelectionMode] = React.useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = React.useState<Set<string>>(new Set());

    // --- Filtros ---
    const [estadoFiltro, setEstadoFiltro] = React.useState<EstadoFiltro>("todas");
    const [prioridadFiltro, setPrioridadFiltro] = React.useState<PrioridadFiltro>("todas");
    const [entregaFiltro, setEntregaFiltro] = React.useState<EntregaFiltro>("todas");
    const [soloSinPlanificar, setSoloSinPlanificar] = React.useState(false);
    const [soloSinOperario, setSoloSinOperario] = React.useState(false);
    const [operarioFiltro, setOperarioFiltro] = React.useState("todos");
    const [clienteFiltro, setClienteFiltro] = React.useState("todos");

    // OTs con los procesos contraídos. Vista contraída = solo la cabecera de la OT,
    // que es lo que permite ver 10 OTs de un vistazo en vez de dos.
    const [collapsedOTs, setCollapsedOTs] = React.useState<Set<string>>(new Set());
    const [allCollapsed, setAllCollapsed] = React.useState(false);

    // Delivery Dialog State
    const [deliveryDialogOpen, setDeliveryDialogOpen] = React.useState(false);
    const [selectedOrderForDelivery, setSelectedOrderForDelivery] = React.useState<{ id: number, total: number, delivered: number } | null>(null);

    const ITEMS_PER_PAGE = 30;
    const [currentPage, setCurrentPage] = React.useState(1);

    // Reset page cuando cambia la búsqueda o cualquier filtro (si no, quedás
    // parado en la página 4 de un resultado que ahora tiene una sola).
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, estadoFiltro, prioridadFiltro, entregaFiltro, soloSinPlanificar, soloSinOperario, operarioFiltro, clienteFiltro]);

    const filteredTasks = tasks.filter(task => {
        const term = searchTerm.toLowerCase();
        return (
            task.workOrderNumber.toLowerCase().includes(term) ||
            task.workOrderId.toString().includes(term) ||
            task.process.toLowerCase().includes(term) ||
            task.resourceName.toLowerCase().includes(term)
        );
    });

    // Group tasks by Work Order
    const tasksByOT = filteredTasks.reduce((acc, task) => {
        if (!acc[task.workOrderNumber]) {
            acc[task.workOrderNumber] = [];
        }
        acc[task.workOrderNumber].push(task);
        return acc;
    }, {} as Record<string, GanttTask[]>);

    // Opciones de los combos: solo lo que realmente aparece en pantalla, para no
    // ofrecer un operario o un cliente que no tiene ninguna OT planificada.
    const operariosDisponibles = React.useMemo(() => {
        const set = new Set<string>();
        tasks.forEach(t => { if (t.resourceName && t.resourceName !== "Sin Asignar") set.add(t.resourceName); });
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
    }, [tasks]);

    const clientesDisponibles = React.useMemo(() => {
        const set = new Set<string>();
        tasks.forEach(t => { if (t.client) set.add(t.client); });
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
    }, [tasks]);

    /** ¿La OT (con TODOS sus procesos) pasa los filtros de la barra? */
    const otPasaFiltros = (otTasks: GanttTask[]) => {
        const total = otTasks.length;
        const completados = otTasks.filter(t => t.status === "finalizado_total").length;
        const enCurso = otTasks.filter(t => t.status === "en_proceso").length;
        const head = otTasks[0];
        const unidades = head.quantity || 0;
        const entregado = head.cantidad_entregada || 0;
        const entregaCompleta = unidades > 0 && entregado >= unidades;

        // Estado (mismo vocabulario que el sistema viejo: pendiente / en producción /
        // terminado; "Pend. Entrega" = procesos listos pero mercadería sin entregar).
        if (estadoFiltro === "pendientes" && !(completados === 0 && enCurso === 0)) return false;
        if (estadoFiltro === "en_proceso" && !(enCurso > 0 || (completados > 0 && completados < total))) return false;
        if (estadoFiltro === "terminadas" && completados !== total) return false;
        if (estadoFiltro === "pend_entrega" && !(completados === total && !entregaCompleta)) return false;

        // Prioridad
        const esUrgente = head.priority === "urgente" || head.priority === "critica";
        if (prioridadFiltro === "urgentes" && !esUrgente) return false;
        if (prioridadFiltro === "normales" && esUrgente) return false;

        // Entrega
        if (entregaFiltro === "sin_entregar" && entregado !== 0) return false;
        if (entregaFiltro === "parcial" && !(entregado > 0 && !entregaCompleta)) return false;
        if (entregaFiltro === "completa" && !entregaCompleta) return false;

        // Checkboxes
        if (soloSinPlanificar && !otTasks.some(t => t.isUnplanned)) return false;
        if (soloSinOperario && !otTasks.some(t => !t.resourceName || t.resourceName === "Sin Asignar")) return false;

        // Combos
        if (operarioFiltro !== "todos" && !otTasks.some(t => t.resourceName === operarioFiltro)) return false;
        if (clienteFiltro !== "todos" && head.client !== clienteFiltro) return false;

        return true;
    };

    const hayFiltrosActivos =
        estadoFiltro !== "todas" || prioridadFiltro !== "todas" || entregaFiltro !== "todas" ||
        soloSinPlanificar || soloSinOperario || operarioFiltro !== "todos" || clienteFiltro !== "todos";

    const limpiarFiltros = () => {
        setEstadoFiltro("todas");
        setPrioridadFiltro("todas");
        setEntregaFiltro("todas");
        setSoloSinPlanificar(false);
        setSoloSinOperario(false);
        setOperarioFiltro("todos");
        setClienteFiltro("todos");
    };

    const toggleCollapse = (otNumber: string) => {
        setCollapsedOTs(prev => {
            const next = new Set(prev);
            if (next.has(otNumber)) next.delete(otNumber);
            else next.add(otNumber);
            return next;
        });
    };

    const capitalizeFirstLetter = (string: string) => {
        return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
    };

    const getInitials = (name: string) => {
        if (!name || name === "Sin Asignar") return "?";
        const parts = name.trim().split(' ');
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    const formatDate = (dateStr: string) => {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}`;
    };

    const totalOTs = Object.keys(tasksByOT).length;
    const sortedOTs = Object.keys(tasksByOT)
        .filter(ot => otPasaFiltros(tasksByOT[ot]))
        .sort((a, b) => parseInt(a) - parseInt(b));

    const totalPages = Math.ceil(sortedOTs.length / ITEMS_PER_PAGE);
    const paginatedOTs = sortedOTs.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const handlePrevious = () => {
        if (currentPage > 1) setCurrentPage(p => p - 1);
    };

    const handleNext = () => {
        if (currentPage < totalPages) setCurrentPage(p => p + 1);
    };

    const toggleSelectionMode = () => {
        setIsSelectionMode(!isSelectionMode);
        setSelectedTaskIds(new Set());
    };

    const toggleTaskSelection = (taskId: string) => {
        const newSelected = new Set(selectedTaskIds);
        if (newSelected.has(taskId)) {
            newSelected.delete(taskId);
        } else {
            newSelected.add(taskId);
        }
        setSelectedTaskIds(newSelected);
    };

    const toggleGroupSelection = (otNumber: string, tasks: GanttTask[]) => {
        const newSelected = new Set(selectedTaskIds);
        const allSelected = tasks.every(t => newSelected.has(t.id));

        if (allSelected) {
            tasks.forEach(t => newSelected.delete(t.id));
        } else {
            tasks.forEach(t => newSelected.add(t.id));
        }
        setSelectedTaskIds(newSelected);
    };

    const handleBulkComplete = () => {
        if (onBulkStatusChange) {
            onBulkStatusChange(Array.from(selectedTaskIds), 'finalizado_total');
            setIsSelectionMode(false);
            setSelectedTaskIds(new Set());
        }
    };

    // --- Helpers de presentación (locales al componente) ---

    /** "01:30" + "02:15" -> minutos transcurridos (asumiendo mismo día). Si endDate
     *  difiere, retornamos null para que el caller decida (mostrar duración en hs). */
    const minutesBetween = (startTime: string, endTime: string): number => {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        const total = (eh * 60 + em) - (sh * 60 + sm);
        return total > 0 ? total : 0;
    };

    /** 45 -> "45 min", 90 -> "1h 30m", 1440 -> "24 h" */
    const formatDuration = (mins: number): string => {
        if (mins <= 0) return "—";
        if (mins < 60) return `${mins} min`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m === 0 ? `${h} h` : `${h}h ${m}m`;
    };

    /** Suma la duración estimada de todos los procesos de una OT en minutos. */
    const sumDurations = (tasks: GanttTask[]): number =>
        tasks.reduce((acc, t) => acc + Math.round((t.duration || 0) * 60), 0);

    /** Devuelve clases + label para el badge de estado de un proceso. */
    const statusMeta = (status: GanttTask["status"]) => {
        switch (status) {
            case "finalizado_total":
                return { label: "Completado", cls: "bg-green-100 text-green-700 border-green-200" };
            case "en_proceso":
                return { label: "En curso", cls: "bg-blue-100 text-blue-700 border-blue-200" };
            case "pausado":
                return { label: "Pausado", cls: "bg-amber-100 text-amber-700 border-amber-200" };
            case "finalizado_parcial":
                return { label: "Parcial", cls: "bg-purple-100 text-purple-700 border-purple-200" };
            default:
                return { label: "Pendiente", cls: "bg-gray-100 text-gray-600 border-gray-200" };
        }
    };

    /** Devuelve clases para el badge de prioridad. */
    const priorityMeta = (p?: GanttTask["priority"]) => {
        switch (p) {
            case "critica":
                return { label: "Crítica", cls: "bg-red-100 text-red-700 border-red-200" };
            case "urgente":
                return { label: "Urgente", cls: "bg-orange-100 text-orange-700 border-orange-200" };
            default:
                return null;
        }
    };

    /** Anillo circular SVG simple para mostrar % de completado de la OT. */
    const ProgressRing = ({ percent }: { percent: number }) => {
        const size = 40;
        const stroke = 4;
        const r = (size - stroke) / 2;
        const c = 2 * Math.PI * r;
        const offset = c - (percent / 100) * c;
        const colorClass =
            percent === 100 ? "text-green-500" :
                percent >= 50 ? "text-blue-500" :
                    percent > 0 ? "text-amber-500" :
                        "text-gray-300";
        return (
            <div className="relative" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="-rotate-90">
                    <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={stroke} className="text-gray-100" fill="none" />
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        stroke="currentColor"
                        strokeWidth={stroke}
                        className={cn("transition-all duration-700", colorClass)}
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={c}
                        strokeDashoffset={offset}
                    />
                </svg>
                <span className={cn("absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums", colorClass)}>
                    {percent}%
                </span>
            </div>
        );
    };

    return (
        <Card className="p-3 sm:p-4 bg-white border-none shadow-lg relative">
            {/* Cabecera compacta: título + contador + acciones, todo en un renglón.
                Antes el título, la bajada y el buscador se comían ~180px de alto
                antes de la primera OT (pedido de Lucas: "hay mucho espacio vacío"). */}
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 bg-red-100 rounded-lg shrink-0">
                        <Clipboard className="w-4 h-4 text-red-600" />
                    </div>
                    <h3 className="text-base font-bold text-gray-800 tracking-tight flex items-center gap-2 truncate">
                        Órdenes de Trabajo Planificadas
                        <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200 tabular-nums">
                            {hayFiltrosActivos ? `${sortedOTs.length} de ${totalOTs}` : sortedOTs.length}
                        </span>
                    </h3>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            const next = !allCollapsed;
                            setAllCollapsed(next);
                            setCollapsedOTs(next ? new Set(sortedOTs) : new Set());
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-xs font-medium flex items-center gap-1.5 transition-colors"
                        title={allCollapsed ? "Mostrar los procesos de cada OT" : "Ver solo las cabeceras de las OTs"}
                    >
                        {allCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                        {allCollapsed ? "Expandir todo" : "Contraer todo"}
                    </button>
                    <button
                        onClick={toggleSelectionMode}
                        className={cn(
                            "px-2.5 py-1.5 rounded-lg transition-all duration-200 font-medium text-xs shadow-sm border flex items-center gap-1.5",
                            isSelectionMode
                                ? "bg-gray-800 text-white border-gray-800 ring-2 ring-gray-200"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        )}
                    >
                        {isSelectionMode ? <><XIcon className="w-3.5 h-3.5" />Cancelar selección</> : <><Pencil className="w-3.5 h-3.5" />Edición rápida</>}
                    </button>
                </div>
            </div>

            {/* Barra de filtros SIEMPRE a la vista (pedido de Lucas 14/08: en el sistema
                viejo el panel de filtros está arriba de la tabla y acá solo había
                buscador). Filtra por OT completa, no por proceso suelto. */}
            <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50/70 p-2.5 space-y-2">
                {/* Buscador + combos */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            className="block w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 text-sm transition-colors"
                            placeholder="Buscar por OT, proceso u operario..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <select
                        value={clienteFiltro}
                        onChange={(e) => setClienteFiltro(e.target.value)}
                        className="py-1.5 px-2 border border-gray-300 rounded-lg bg-white text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-red-500 max-w-[220px]"
                        title="Filtrar por cliente"
                    >
                        <option value="todos">Todos los clientes</option>
                        {clientesDisponibles.map(c => <option key={c} value={c}>{toTitleCase(c)}</option>)}
                    </select>
                    <select
                        value={operarioFiltro}
                        onChange={(e) => setOperarioFiltro(e.target.value)}
                        className="py-1.5 px-2 border border-gray-300 rounded-lg bg-white text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-red-500 max-w-[200px]"
                        title="Filtrar por operario asignado"
                    >
                        <option value="todos">Todos los operarios</option>
                        {operariosDisponibles.map(o => <option key={o} value={o}>{toTitleCase(o)}</option>)}
                    </select>
                </div>

                {/* Grupos de filtros rápidos */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Estado</span>
                        <FilterPill active={estadoFiltro === "todas"} onClick={() => setEstadoFiltro("todas")}>Todas</FilterPill>
                        <FilterPill active={estadoFiltro === "pendientes"} onClick={() => setEstadoFiltro("pendientes")} title="Ningún proceso arrancado">Pendientes</FilterPill>
                        <FilterPill active={estadoFiltro === "en_proceso"} onClick={() => setEstadoFiltro("en_proceso")} title="Con al menos un proceso en curso o terminado">En producción</FilterPill>
                        <FilterPill active={estadoFiltro === "terminadas"} onClick={() => setEstadoFiltro("terminadas")} title="Todos los procesos finalizados">Terminadas</FilterPill>
                        <FilterPill active={estadoFiltro === "pend_entrega"} onClick={() => setEstadoFiltro("pend_entrega")} title="Procesos terminados pero falta entregar">Pend. entrega</FilterPill>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Prioridad</span>
                        <FilterPill active={prioridadFiltro === "todas"} onClick={() => setPrioridadFiltro("todas")}>Todas</FilterPill>
                        <FilterPill active={prioridadFiltro === "urgentes"} onClick={() => setPrioridadFiltro("urgentes")} title="Urgentes y críticas">Urgentes</FilterPill>
                        <FilterPill active={prioridadFiltro === "normales"} onClick={() => setPrioridadFiltro("normales")}>Normales</FilterPill>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Entrega</span>
                        <FilterPill active={entregaFiltro === "todas"} onClick={() => setEntregaFiltro("todas")}>Todas</FilterPill>
                        <FilterPill active={entregaFiltro === "sin_entregar"} onClick={() => setEntregaFiltro("sin_entregar")}>Sin entregar</FilterPill>
                        <FilterPill active={entregaFiltro === "parcial"} onClick={() => setEntregaFiltro("parcial")}>Parcial</FilterPill>
                        <FilterPill active={entregaFiltro === "completa"} onClick={() => setEntregaFiltro("completa")}>Completa</FilterPill>
                    </div>

                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={soloSinPlanificar}
                            onChange={(e) => setSoloSinPlanificar(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        Con procesos sin planificar
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={soloSinOperario}
                            onChange={(e) => setSoloSinOperario(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        Con procesos sin operario
                    </label>

                    {hayFiltrosActivos && (
                        <button
                            onClick={limpiarFiltros}
                            className="ml-auto text-[11px] font-semibold text-red-600 hover:text-red-700 hover:underline flex items-center gap-1"
                        >
                            <XIcon className="w-3 h-3" /> Limpiar filtros
                        </button>
                    )}
                </div>
            </div>

            <div className="space-y-2.5 pb-4">
                {paginatedOTs.map((otNumber, index) => {
                    const otTasks = tasksByOT[otNumber];
                    const totalTasks = otTasks.length;
                    const completedTasks = otTasks.filter(t => t.status === "finalizado_total").length;
                    const inProgressTasks = otTasks.filter(t => t.status === "en_proceso").length;
                    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
                    const allGroupSelected = otTasks.every(t => selectedTaskIds.has(t.id));

                    // Metadatos OT (toma del primer task — todos los tasks de la misma OT
                    // comparten estos campos porque vienen de la misma orden).
                    const head = otTasks[0];
                    const productDescription = head.notes || "";
                    const totalDurationMin = sumDurations(otTasks);
                    // Para los rangos de Inicio/Fin del header solo consideramos tasks
                    // planificados (los huérfanos no tienen horarios).
                    const plannedOtTasks = otTasks.filter(t => !t.isUnplanned);
                    const firstStart = plannedOtTasks[0] ?? head;
                    const lastEnd = plannedOtTasks[plannedOtTasks.length - 1] ?? head;
                    const prio = priorityMeta(head.priority);
                    const delivered = head.cantidad_entregada || 0;
                    const totalUnits = head.quantity || 0;
                    const deliveryPercent = totalUnits > 0 ? Math.round((delivered / totalUnits) * 100) : 0;

                    // Barra superior coloreada según estado global de la OT.
                    const topBarCls =
                        progress === 100 ? "bg-green-500" :
                            inProgressTasks > 0 ? "bg-blue-500" :
                                "bg-gradient-to-r from-red-500 to-red-400";

                    const isCollapsed = collapsedOTs.has(otNumber);

                    return (
                        <div
                            key={otNumber}
                            className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all duration-300"
                        >
                            {/* Barra de estado arriba */}
                            <div className={cn("absolute top-0 left-0 h-1 w-full", topBarCls)} />

                            {/* HEADER de la OT — clickeable para contraer/expandir los procesos */}
                            <div className="px-4 pt-3.5 pb-3 border-b border-gray-100 flex items-start gap-3">
                                {/* Avatar / Selector */}
                                {isSelectionMode ? (
                                    <button
                                        type="button"
                                        onClick={() => toggleGroupSelection(otNumber, otTasks)}
                                        className={cn(
                                            "h-11 w-11 rounded-xl flex items-center justify-center transition-colors shrink-0 border-2",
                                            allGroupSelected
                                                ? "bg-red-500 border-red-500 text-white"
                                                : "bg-gray-50 border-gray-200 text-gray-400 hover:border-red-300"
                                        )}
                                        title={allGroupSelected ? "Deseleccionar todos los procesos de esta OT" : "Seleccionar todos los procesos de esta OT"}
                                    >
                                        {allGroupSelected ? <Check className="w-5 h-5" /> : <div className="w-4 h-4 border-2 border-current rounded" />}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => toggleCollapse(otNumber)}
                                        className="h-11 w-11 rounded-xl bg-gradient-to-br from-red-50 to-red-100 border border-red-200/60 flex flex-col items-center justify-center text-red-700 shrink-0 shadow-sm hover:border-red-300 transition-colors"
                                        title={isCollapsed ? "Mostrar procesos" : "Ocultar procesos"}
                                    >
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-red-500/80 leading-none mb-0.5">OT</span>
                                        <span className="text-sm font-bold leading-none tabular-nums">{otNumber}</span>
                                    </button>
                                )}

                                {/* Info principal */}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start gap-2 flex-wrap">
                                        <h4 className="font-bold text-base text-gray-900 truncate max-w-full" title={head.client || ""}>
                                            {head.client || "Sin cliente"}
                                        </h4>
                                        {prio && (
                                            <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border", prio.cls)}>
                                                <AlertCircle className="w-2.5 h-2.5" />
                                                {prio.label}
                                            </span>
                                        )}
                                    </div>
                                    {productDescription && (
                                        <p className="text-xs text-gray-600 line-clamp-1 mt-0.5 leading-snug" title={productDescription}>
                                            <PackageCheck className="w-3 h-3 inline-block mr-1 text-gray-400 -mt-0.5" />
                                            {productDescription}
                                        </p>
                                    )}
                                    {/* Fila de metadatos: procesos, duración total, inicio, fin */}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500 font-medium">
                                        <span className="flex items-center gap-1" title="Cantidad de procesos">
                                            <Cog className="w-3 h-3 text-gray-400" />
                                            {totalTasks} {totalTasks === 1 ? "proceso" : "procesos"}
                                        </span>
                                        {totalDurationMin > 0 && (
                                            <span className="flex items-center gap-1" title="Duración estimada total">
                                                <Clock className="w-3 h-3 text-gray-400" />
                                                {formatDuration(totalDurationMin)}
                                            </span>
                                        )}
                                        <span className="flex items-center gap-1" title="Inicio del primer proceso">
                                            <CalendarIcon className="w-3 h-3 text-gray-400" />
                                            Inicio {formatDate(firstStart.startDate)} · {firstStart.startTime}
                                        </span>
                                        <span className="flex items-center gap-1" title="Fin del último proceso">
                                            <CalendarIcon className="w-3 h-3 text-gray-400" />
                                            Fin {formatDate(lastEnd.endDate)} · {lastEnd.endTime}
                                        </span>
                                    </div>
                                </div>

                                {/* Bloque derecho: Entrega + Progreso */}
                                <div className="flex items-center gap-3 shrink-0">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedOrderForDelivery({
                                                id: head.workOrderId,
                                                total: totalUnits,
                                                delivered,
                                            });
                                            setDeliveryDialogOpen(true);
                                        }}
                                        className="hidden md:block rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 hover:border-gray-300 transition-colors text-right min-w-[80px]"
                                        title="Registrar entrega"
                                    >
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block leading-none">Entrega</span>
                                        <span className="text-sm font-bold text-gray-800 tabular-nums block mt-0.5">
                                            {delivered}<span className="text-gray-400 mx-0.5">/</span>{totalUnits}
                                        </span>
                                        <div className="mt-1 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className={cn(
                                                    "h-full rounded-full transition-all duration-700",
                                                    deliveryPercent === 100 ? "bg-green-500" : deliveryPercent > 0 ? "bg-amber-500" : "bg-gray-300"
                                                )}
                                                style={{ width: `${deliveryPercent}%` }}
                                            />
                                        </div>
                                    </button>
                                    <ProgressRing percent={progress} />
                                    {!isSelectionMode && (
                                        <button
                                            type="button"
                                            onClick={() => toggleCollapse(otNumber)}
                                            className="h-8 w-8 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50 flex items-center justify-center transition-colors"
                                            title={isCollapsed ? "Mostrar procesos" : "Ocultar procesos"}
                                        >
                                            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* PROCESOS */}
                            {!isCollapsed && (
                            <div className="px-4 py-3 bg-gray-50/40">
                                <div className="flex items-center justify-between mb-2">
                                    <h5 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
                                        <ListChecks className="w-3 h-3" />
                                        Procesos asignados
                                        <span className="text-gray-400 normal-case tracking-normal font-medium">
                                            ({completedTasks}/{totalTasks} completados)
                                        </span>
                                    </h5>
                                    {/* Archivos compacto: solo enlace para subir/ver — no ocupa espacio si no hay nada */}
                                    <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                        <Paperclip className="w-3 h-3" />
                                        <OrderFiles orderId={head.workOrderId} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5">
                                    {(() => {
                                        const sortedOtTasks = [...otTasks].sort((a, b) =>
                                            (a.orden ?? Number.MAX_SAFE_INTEGER) - (b.orden ?? Number.MAX_SAFE_INTEGER)
                                        );
                                        const handleMove = (taskIndex: number, dir: -1 | 1) => {
                                            if (!onProcessReorder) return;
                                            const target = taskIndex + dir;
                                            if (target < 0 || target >= sortedOtTasks.length) return;
                                            const next = [...sortedOtTasks];
                                            [next[taskIndex], next[target]] = [next[target], next[taskIndex]];
                                            onProcessReorder(head.workOrderId, next);
                                        };
                                        return sortedOtTasks.map((task, taskIndex) => {
                                        const sMeta = statusMeta(task.status);
                                        const taskDuration = Math.round((task.duration || 0) * 60) || minutesBetween(task.startTime, task.endTime);
                                        const isSelected = selectedTaskIds.has(task.id);
                                        const canMoveUp = !!onProcessReorder && taskIndex > 0 && !isSelectionMode;
                                        const canMoveDown = !!onProcessReorder && taskIndex < sortedOtTasks.length - 1 && !isSelectionMode;
                                        return (
                                            <div
                                                key={task.id}
                                                className={cn(
                                                    "relative rounded-xl border p-3 transition-all duration-200 overflow-hidden",
                                                    task.isUnplanned
                                                        ? "bg-amber-50/30 border-dashed border-amber-300 cursor-default"
                                                        : "bg-white cursor-pointer",
                                                    !task.isUnplanned && (
                                                        isSelectionMode && isSelected
                                                            ? "border-red-500 ring-2 ring-red-100 shadow-md bg-red-50/30"
                                                            : "border-gray-200 hover:border-red-300 hover:shadow-md hover:-translate-y-0.5"
                                                    )
                                                )}
                                                onClick={() => {
                                                    if (task.isUnplanned) return;
                                                    if (isSelectionMode) toggleTaskSelection(task.id);
                                                    else onTaskClick?.(task);
                                                }}
                                                title={task.isUnplanned ? "Proceso sin planificar — re-planificá la OT para asignar horario, operario y máquina." : undefined}
                                            >
                                                {isSelectionMode && !task.isUnplanned && (
                                                    <div className="absolute top-2 right-2 z-10">
                                                        <div className={cn(
                                                            "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                                                            isSelected
                                                                ? "bg-red-500 border-red-500 text-white scale-110"
                                                                : "bg-white border-gray-300"
                                                        )}>
                                                            {isSelected && <Check className="w-3 h-3" />}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Línea 1: # paso + reorder + estado */}
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-1">
                                                        <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-md bg-gray-100 text-[10px] font-bold text-gray-600 tabular-nums">
                                                            {task.orden ?? taskIndex + 1}
                                                        </span>
                                                        {!!onProcessReorder && !isSelectionMode && (
                                                            <div className="flex items-center gap-0.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); handleMove(taskIndex, -1); }}
                                                                    disabled={!canMoveUp}
                                                                    title="Subir orden"
                                                                    className="h-5 w-5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                                                                >
                                                                    <ArrowUp className="w-3 h-3" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); handleMove(taskIndex, 1); }}
                                                                    disabled={!canMoveDown}
                                                                    title="Bajar orden"
                                                                    className="h-5 w-5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                                                                >
                                                                    <ArrowDown className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        )}
                                                        {!!onTaskDelete && !isSelectionMode && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); onTaskDelete(task); }}
                                                                title="Eliminar proceso"
                                                                className="h-5 w-5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors ml-0.5"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <span className={cn(
                                                        "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                                                        task.isUnplanned
                                                            ? "bg-amber-100 text-amber-700 border-amber-200"
                                                            : sMeta.cls
                                                    )}>
                                                        {task.isUnplanned ? "Sin planificar" : sMeta.label}
                                                    </span>
                                                </div>

                                                {/* Nombre del proceso */}
                                                <h6 className="font-bold text-sm text-gray-900 leading-tight mb-2 line-clamp-2" title={capitalizeFirstLetter(task.process)}>
                                                    {capitalizeFirstLetter(task.process)}
                                                </h6>

                                                {/* Operario */}
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-700 font-bold text-[10px] shrink-0 border border-gray-200">
                                                        {getInitials(task.resourceName)}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block leading-none">Recurso humano</span>
                                                        <span className="text-xs text-gray-700 font-medium truncate block">
                                                            {toTitleCase(task.resourceName) || "Sin asignar"}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Máquina — siempre visible; "Sin asignar" cuando no hay (ej. procesos manuales) */}
                                                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
                                                    <div className={cn(
                                                        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 border",
                                                        task.machineName
                                                            ? "bg-gradient-to-br from-indigo-50 to-indigo-100 text-indigo-600 border-indigo-200"
                                                            : "bg-gray-50 text-gray-400 border-gray-200"
                                                    )}>
                                                        <Wrench className="w-3 h-3" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block leading-none">Máquina</span>
                                                        {task.machineName ? (
                                                            <span className="text-xs text-gray-700 font-medium truncate block" title={task.machineName}>
                                                                {toTitleCase(task.machineName)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-gray-400 italic truncate block">
                                                                Sin asignar
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Horarios — solo si está planificado. Si no, mostramos solo "min estimados". */}
                                                <div className="space-y-1">
                                                    {!task.isUnplanned && (
                                                        <>
                                                            <div className="flex items-center justify-between text-[11px]">
                                                                <span className="text-gray-400 font-medium flex items-center gap-1">
                                                                    <CalendarIcon className="w-2.5 h-2.5" /> Inicio
                                                                </span>
                                                                <span className="font-bold text-gray-800 tabular-nums">
                                                                    {formatDate(task.startDate)} · {task.startTime}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center justify-between text-[11px]">
                                                                <span className="text-gray-400 font-medium flex items-center gap-1">
                                                                    <CalendarIcon className="w-2.5 h-2.5" /> Fin
                                                                </span>
                                                                <span className="font-bold text-gray-800 tabular-nums">
                                                                    {task.endDate !== task.startDate ? `${formatDate(task.endDate)} · ` : ""}{task.endTime}
                                                                </span>
                                                            </div>
                                                        </>
                                                    )}
                                                    {taskDuration > 0 && (
                                                        <div className={cn(
                                                            "flex items-center justify-center gap-1 text-[10px] text-gray-500",
                                                            !task.isUnplanned && "pt-1.5 mt-1.5 border-t border-dashed border-gray-200"
                                                        )}>
                                                            <Clock className="w-2.5 h-2.5" />
                                                            <span className="font-semibold tabular-nums">{formatDuration(taskDuration)}</span>
                                                            <span className="text-gray-400">estimados</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    });
                                    })()}

                                    {/* Card "Agregar Proceso" — chico: antes reservaba 200px de alto
                                        aunque estuviera vacío y era el hueco más grande de la vista. */}
                                    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white/40 hover:bg-blue-50/30 hover:border-blue-300 transition-all flex items-center justify-center p-3 self-start">
                                        <div className="w-full text-center">
                                            <div className="mx-auto mb-1.5 w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 border border-blue-100">
                                                <Plus className="w-3.5 h-3.5" />
                                            </div>
                                            <AddProcessRow
                                                orderId={head.workOrderId}
                                                onProcessAdded={() => { if (onDataRefresh) onDataRefresh(); }}
                                                isCentered={true}
                                                variant="card"
                                                label="Agregar proceso"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            )}
                        </div>
                    );
                })}
                {sortedOTs.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center animate-in fade-in zoom-in duration-500">
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-3 shadow-inner">
                            <Clipboard className="w-9 h-9 text-gray-300" />
                        </div>
                        <h3 className="text-base font-bold text-gray-900">No hay órdenes planificadas</h3>
                        <p className="text-gray-500 max-w-sm mt-1.5 text-sm">
                            {searchTerm
                                ? "Ninguna OT coincide con la búsqueda. Probá con otro término."
                                : "No se encontraron órdenes de trabajo activas en este momento."}
                        </p>
                    </div>
                )}
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mb-6">
                    <button
                        onClick={handlePrevious}
                        disabled={currentPage === 1}
                        className="h-9 w-9 rounded-full border border-gray-300 flex items-center justify-center hover:text-red-600 hover:border-red-300 disabled:opacity-50 disabled:hover:text-gray-400 disabled:hover:border-gray-300 transition-colors"
                        aria-label="Página anterior"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-medium text-gray-600 tabular-nums">
                        Página {currentPage} de {totalPages}
                    </span>
                    <button
                        onClick={handleNext}
                        disabled={currentPage === totalPages}
                        className="h-9 w-9 rounded-full border border-gray-300 flex items-center justify-center hover:text-red-600 hover:border-red-300 disabled:opacity-50 disabled:hover:text-gray-400 disabled:hover:border-gray-300 transition-colors"
                        aria-label="Página siguiente"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Barra flotante de acciones en modo selección */}
            {isSelectionMode && selectedTaskIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
                    <div className="bg-gray-900 text-white px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-5 border border-gray-700">
                        <div className="flex items-center gap-2 border-r border-gray-700 pr-5">
                            <span className="bg-white text-gray-900 text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center tabular-nums">
                                {selectedTaskIds.size}
                            </span>
                            <span className="font-medium text-sm">seleccionados</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleBulkComplete}
                                className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-full text-sm font-bold transition-colors flex items-center gap-2 shadow-lg shadow-green-900/20"
                            >
                                <Check className="w-4 h-4" />
                                Marcar completados
                            </button>
                            <button
                                onClick={() => setSelectedTaskIds(new Set())}
                                className="text-gray-400 hover:text-white transition-colors p-1"
                                title="Limpiar selección"
                            >
                                <XIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <RegisterDeliveryDialog
                open={deliveryDialogOpen}
                onOpenChange={setDeliveryDialogOpen}
                currentOrder={selectedOrderForDelivery}
                onSuccess={() => {
                    if (onDataRefresh) onDataRefresh();
                }}
            />
        </Card>
    );
}
