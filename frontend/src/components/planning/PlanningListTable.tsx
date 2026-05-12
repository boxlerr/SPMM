"use client";

import React from "react";
import { WorkOrder, PlanificacionItem } from "@/lib/types";
import { AddProcessRow } from "@/components/planning/AddProcessRow";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, getWorkOrderRowColor } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
    Search, ChevronDown, ChevronRight, CalendarClock,
    Pencil,
    LayoutDashboard,
    Save,
    X,
    PlusCircle,
    Plus,
    GripVertical,
    AlertCircle,
    AlertTriangle,
    Check,
    CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { OrderFiles } from "@/components/common/OrderFiles";
import { Button } from "@/components/ui/button";
import { DeliveryProgress } from "@/components/common/DeliveryProgress";
import { RegisterDeliveryDialog } from "@/components/planning/RegisterDeliveryDialog";


import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { Checkbox } from "@/components/ui/checkbox";
import { addWorkMinutes, calculateWorkingMinutes } from "@/lib/gantt-utils";
import { API_URL } from "@/config";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

interface PlanningListTableProps {
    data: WorkOrder[];
    isLoading: boolean;
    onRowClick: (item: WorkOrder) => void;
    onProcessStatusChange?: (ordenId: number, procesoId: number, newStatusId: number) => void;
    onProcessReorder?: (ordenId: number, newOrder: any[]) => void;
    onOperatorChange?: (ordenId: number, procesoId: number, operarioId: number) => void;
    onMachineryChange?: (ordenId: number, procesoId: number, maquinariaId: number) => void; // Added
    selectedIds?: number[];
    onSelectionChange?: (ids: number[]) => void;
    operarios?: any[];
    maquinarias?: any[]; // Added
    planificacion?: PlanificacionItem[];
    onDataChange?: () => void; // Added for refreshing data without reload
    hideStatus?: boolean; // New prop to hide status column
    highlightedIds?: number[]; // New prop for visual highlighting
    onFieldUpdate?: (ordenId: number, field: string, value: any) => Promise<void>;
    /** Zoom (%) aplicado SOLO a la tabla (no al search ni a las tarjetas mobile). */
    tableZoom?: number;
}

export const PlanningListTable = React.memo(_PlanningListTable);

function _PlanningListTable({
    data,
    isLoading,
    onRowClick,
    onProcessStatusChange,
    onProcessReorder,
    onOperatorChange,
    onMachineryChange, // Added
    selectedIds = [],
    onSelectionChange,
    operarios = [],
    maquinarias = [], // Added
    planificacion = [],


    onDataChange, // Added
    hideStatus = false,
    highlightedIds = [],
    tableZoom = 100
}: PlanningListTableProps) {


    const [sortConfig, setSortConfig] = React.useState<{
        key: 'id' | 'id_otvieja' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'prioridad' | 'estado' | 'fecha_prometida' | 'fecha_entrega' | null;
        direction: 'asc' | 'desc' | null
    }>({
        key: null,
        direction: null,
    });
    const [searchTerm, setSearchTerm] = React.useState("");
    const [expandedOrderIds, setExpandedOrderIds] = React.useState<number[]>([]);

    // Estado del scroll horizontal para mostrar/ocultar el gradient fade dinámicamente.
    // Cuando el usuario llega al final del scroll (no hay más columnas a la derecha),
    // ocultamos el fade para que no engañe diciendo "hay más".
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [showRightFade, setShowRightFade] = React.useState(true);

    const toggleRow = (orderId: number) => {
        setExpandedOrderIds(prev =>
            prev.includes(orderId)
                ? prev.filter(id => id !== orderId)
                : [...prev, orderId]
        );
    };

    const handleSelectAll = (checked: boolean) => {
        if (!onSelectionChange) return;
        if (checked) {
            onSelectionChange(sortedData.map(item => item.id));
        } else {
            onSelectionChange([]);
        }
    };

    const handleSelectRow = (orderId: number, checked: boolean) => {
        if (!onSelectionChange) return;
        if (checked) {
            onSelectionChange([...selectedIds, orderId]);
        } else {
            onSelectionChange(selectedIds.filter(id => id !== orderId));
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr || dateStr.startsWith('1950')) return "-";
        try {
            const date = new Date(dateStr);
            return new Intl.DateTimeFormat('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).format(date);
        } catch (e) {
            return dateStr;
        }
    };

    const toTitleCase = (str: string | null | undefined) => {
        if (!str) return "";
        return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    const getEditableProductDescription = (item: WorkOrder) => {
        if ((item.articulo?.cod_articulo === 'NO-DEF' || item.articulo?.descripcion?.toLowerCase().includes('heredado')) && item.observaciones) {
            return item.observaciones;
        }
        return item.articulo?.descripcion;
    };


    const getScheduledStart = (ordenId: number, procesoId: number) => {
        if (!planificacion || planificacion.length === 0) return "-";
        const item = planificacion.find(p => p.orden_id === ordenId && p.proceso_id === procesoId);
        if (!item) return "-";

        // Logic matching convertPlanificacionToGanttTasks from page.tsx/gantt-utils
        const baseDate = item.creado_en ? new Date(item.creado_en) : new Date();
        const normalizedBaseDate = new Date(baseDate);
        normalizedBaseDate.setHours(9, 0, 0, 0); // 9:00 AM start

        const start = addWorkMinutes(normalizedBaseDate, item.inicio_min);

        // Formato compacto y legible: "Jue 07/05 09:00".
        // Antes el Intl daba "jue., 07/05, 09:00" con comas que cortaban feo cuando
        // se truncaba. Construyo manualmente para mantener todo en una sola línea.
        const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const dia = dias[start.getDay()];
        const dd = String(start.getDate()).padStart(2, '0');
        const mm = String(start.getMonth() + 1).padStart(2, '0');
        const hh = String(start.getHours()).padStart(2, '0');
        const mi = String(start.getMinutes()).padStart(2, '0');
        return `${dia} ${dd}/${mm} ${hh}:${mi}`;
    };


    const getRowColor = (item: WorkOrder) => {
        // Highlighted check (e.g. reused orders in re-planning)
        if (highlightedIds.includes(item.id)) {
            return "bg-green-50 hover:bg-green-100 text-green-900 border-l-4 border-green-500";
        }
        return getWorkOrderRowColor(item);
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

    const handleSort = (key: 'id' | 'id_otvieja' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'prioridad' | 'estado' | 'fecha_prometida' | 'fecha_entrega') => {
        let direction: 'asc' | 'desc' | null = 'asc'; // 1st click: asc (default)

        if (sortConfig.key === key) {
            if (sortConfig.direction === 'asc') {
                direction = 'desc'; // 2nd click: desc
            } else if (sortConfig.direction === 'desc') {
                direction = null; // 3rd click: default (null)
            }
        }

        setSortConfig({ key: direction ? key : null, direction });
    };

    const filteredData = React.useMemo(() => {
        if (!searchTerm) return data;
        const lowerTerm = searchTerm.toLowerCase();
        return data.filter(item =>
            item.id.toString().includes(lowerTerm) ||
            (item.id_otvieja && item.id_otvieja.toString().includes(lowerTerm)) ||
            String(item.observaciones || "").toLowerCase().includes(lowerTerm) ||
            String(item.cliente?.nombre || "").toLowerCase().includes(lowerTerm) ||
            String(item.articulo?.cod_articulo || "").toLowerCase().includes(lowerTerm) ||
            String(item.articulo?.descripcion || "").toLowerCase().includes(lowerTerm)
        );
    }, [data, searchTerm]);

    const sortedData = React.useMemo(() => {

        // Sort processes by 'orden' for each item to ensure correct display
        const dataWithSortedProcesses = filteredData.map(item => ({
            ...item,
            procesos: [...item.procesos].sort((a, b) => a.orden - b.orden)
        }));

        if (!sortConfig.key || !sortConfig.direction) return dataWithSortedProcesses;

        return [...dataWithSortedProcesses].sort((a, b) => {
            switch (sortConfig.key) {
                case 'id':
                    return sortConfig.direction === 'asc' ? a.id - b.id : b.id - a.id;
                case 'id_otvieja':
                    const valViejaA = a.id_otvieja || 0;
                    const valViejaB = b.id_otvieja || 0;
                    return sortConfig.direction === 'asc' ? valViejaA - valViejaB : valViejaB - valViejaA;
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
                    const valA = a.unidades || 0;
                    const valB = b.unidades || 0;
                    return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
                case 'prioridad':
                    const prioA = a.id_prioridad || 0;
                    const prioB = b.id_prioridad || 0;
                    return sortConfig.direction === 'asc' ? prioA - prioB : prioB - prioA;
                case 'estado':
                    const statusA = getOrderStatus(a);
                    const statusB = getOrderStatus(b);
                    return sortConfig.direction === 'asc' ? statusA.localeCompare(statusB) : statusB.localeCompare(statusA);
                case 'fecha_prometida':
                    return sortConfig.direction === 'asc'
                        ? new Date(a.fecha_prometida || '2100-01-01').getTime() - new Date(b.fecha_prometida || '2100-01-01').getTime()
                        : new Date(b.fecha_prometida || '1970-01-01').getTime() - new Date(a.fecha_prometida || '1970-01-01').getTime();
                case 'fecha_entrega':
                    return sortConfig.direction === 'asc'
                        ? new Date(a.fecha_entrega || '2100-01-01').getTime() - new Date(b.fecha_entrega || '2100-01-01').getTime()
                        : new Date(b.fecha_entrega || '1970-01-01').getTime() - new Date(a.fecha_entrega || '1970-01-01').getTime();
                default:
                    return 0;
            }
        });
    }, [filteredData, sortConfig]);

    // Observa el scroll horizontal del contenedor de la tabla y actualiza `showRightFade`:
    //   true  → hay más columnas a la derecha → mostrar el gradient fade
    //   false → llegó al final → ocultar el gradient (no engaña al usuario)
    React.useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const updateFade = () => {
            const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
            // Margen de 2px para evitar parpadeo por subpixel rendering.
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
    }, [sortedData.length]);

    type SortColumn = 'id' | 'id_otvieja' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'prioridad' | 'estado' | 'fecha_prometida' | 'fecha_entrega';

    const SortIcon = ({ column }: { column: SortColumn }) => {
        if (sortConfig.key !== column || !sortConfig.direction) return <span className="ml-1 text-gray-300 opacity-0 group-hover:opacity-50">↕</span>;
        return (
            <span className="ml-1 text-red-600 font-bold">
                {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </span>
        );
    };

    const getOrderStatus = (order: WorkOrder) => {
        if (!order.procesos || order.procesos.length === 0) return 'Pendiente';

        const allFinalized = order.procesos.every(p => p.estado_proceso.id === 3);
        if (allFinalized) return 'Finalizado';

        const hasProgress = order.procesos.some(p => p.estado_proceso.id === 2 || p.estado_proceso.id === 3);
        if (hasProgress) return 'En Proceso';

        return 'Pendiente';
    };

    const renderStatusBadge = (status: string) => {
        switch (status) {
            case 'Finalizado':
                return <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-green-200">Finalizado</Badge>;
            case 'En Proceso':
                return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200">En Proceso</Badge>;
            default:
                return null;
        }
    };

    const [editingOrder, setEditingOrder] = React.useState<{ id: number, field: string, value: string, originalValue: string } | null>(null);
    const [editingStartDate, setEditingStartDate] = React.useState<{ orderId: number, processId: number, planId: number, value: string } | null>(null);
    const [deliveryOrder, setDeliveryOrder] = React.useState<{ id: number, total: number, delivered: number } | null>(null);

    const handleTextClick = (orderId: number, field: string, currentValue: string | undefined | number) => {
        const val = currentValue?.toString() || "";
        setEditingOrder({
            id: orderId,
            field,
            value: val,
            originalValue: val
        });
    };

    const handleDateClick = (orderId: number, field: string, currentValue: string | undefined) => {
        let val = "";
        if (currentValue && !currentValue.startsWith('1950')) {
            try {
                val = new Date(currentValue).toISOString().split('T')[0];
            } catch (e) {
                val = "";
            }
        }
        setEditingOrder({
            id: orderId,
            field,
            value: val,
            originalValue: val
        });
    };

    const handleDateSave = async () => {
        if (!editingOrder) return;
        if (editingOrder.value === editingOrder.originalValue) {
            setEditingOrder(null);
            return;
        }

        try {
            const response = await fetch(`${API_URL}/ordenes/${editingOrder.id}`, {
                method: 'PUT',
                headers: { ...getAuthHeaders() as Record<string, string>, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    [editingOrder.field]: editingOrder.field.startsWith('fecha_') ? (editingOrder.value ? new Date(editingOrder.value).toISOString() : null) : (editingOrder.field === 'unidades' ? parseInt(editingOrder.value) || 0 : editingOrder.value)
                })
            });

            if (!response.ok) throw new Error('Failed to update field');

            setEditingOrder(null);
            
            // If the parent provided an onDataChange callback, use it
            if (onDataChange) {
                onDataChange();
            }

        } catch (error) {
            console.error('Error saving date:', error);
            // Optionally show error toast
        }
    };

    const handleStartDateClick = (orderId: number, processId: number, currentValue: string) => {
        if (!planificacion) return;
        const item = planificacion.find(p => p.orden_id === orderId && p.proceso_id === processId);
        if (!item) return;

        // Current Value is e.g. "vie 05-12, 09:48 a. m." which is formatted.
        // We need the raw Date.
        // Re-calculate raw date from planificacion item
        const baseDate = item.creado_en ? new Date(item.creado_en) : new Date();
        const normalizedBaseDate = new Date(baseDate);
        normalizedBaseDate.setHours(9, 0, 0, 0);

        const start = addWorkMinutes(normalizedBaseDate, item.inicio_min);

        // Format to datetime-local string: YYYY-MM-DDTHH:mm
        const yyyy = start.getFullYear();
        const mm = String(start.getMonth() + 1).padStart(2, '0');
        const dd = String(start.getDate()).padStart(2, '0');
        const hh = String(start.getHours()).padStart(2, '0');
        const min = String(start.getMinutes()).padStart(2, '0');

        const isoString = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

        setEditingStartDate({
            orderId,
            processId,
            planId: item.id,
            value: isoString
        });
    };

    const handleStartDateSave = async () => {
        if (!editingStartDate) return;
        // console.log("Saving new start date:", editingStartDate.value);

        // Calculate new inicio_min
        const item = planificacion.find(p => p.id === editingStartDate.planId);
        if (!item) return;

        const baseDate = item.creado_en ? new Date(item.creado_en) : new Date();
        const normalizedBaseDate = new Date(baseDate);
        normalizedBaseDate.setHours(9, 0, 0, 0);

        const newDate = new Date(editingStartDate.value);
        if (isNaN(newDate.getTime())) return; // Invalid date

        const newInicioMin = calculateWorkingMinutes(normalizedBaseDate, newDate);
        const duration = item.fin_min - item.inicio_min;
        const newFinMin = newInicioMin + duration;

        try {
            const response = await fetch(`${API_URL}/planificacion/${editingStartDate.planId}`, {
                method: 'PUT',
                headers: { ...getAuthHeaders() as Record<string, string>, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inicio_min: newInicioMin,
                    fin_min: newFinMin
                })
            });

            if (!response.ok) throw new Error('Failed to update start date');

            setEditingStartDate(null);
            window.location.reload();
        } catch (error) {
            console.error('Error saving start date:', error);
        }
    };

    const calculateRealMinutes = (start?: string, end?: string) => {
        if (!start) return "-";
        if (!end) return "En curso...";

        const startDate = new Date(start);
        const endDate = new Date(end);

        const diffMs = endDate.getTime() - startDate.getTime();
        const diffMins = Math.round(diffMs / 60000);

        return `${diffMins} min`;
    };

    const renderDetails = (item: WorkOrder) => (
        <div className="w-full border rounded-md overflow-hidden bg-white shadow-inner">
            <div className="p-2 mb-2">
                <div
                    className="cursor-pointer hover:ring-2 ring-blue-100 rounded-xl transition-all"
                    onClick={(e) => {
                        e.stopPropagation();
                        setDeliveryOrder({
                            id: item.id,
                            total: item.unidades || 0,
                            delivered: item.cantidad_entregada || 0
                        });
                    }}
                >
                    <DeliveryProgress
                        total={item.unidades}
                        delivered={item.cantidad_entregada}
                    />
                </div>
            </div>
            <div className="px-2 pb-2">
                <OrderFiles orderId={item.id} />
            </div>
            <div className="w-full text-sm">
                <div className="hidden md:grid bg-gray-100 text-[11px] uppercase text-gray-600 grid-cols-[40px_3fr_110px_110px_70px_70px_2fr_2fr] gap-3 px-4 py-2 font-bold border-t border-gray-200">
                    <div>#</div>
                    <div>Proceso</div>
                    <div>Inicio Estimado</div>
                    <div>Estado</div>
                    <div className="text-center">Min. Est.</div>
                    <div className="text-center text-blue-700">Min. Real</div>
                    <div>Operario</div>
                    <div>Maquinaria</div>
                </div>

                <div>
                    {item.procesos && item.procesos.length > 0 ? (
                        <>
                            {item.procesos.map((proc, idx) => {
                                const plannedItem = planificacion ? planificacion.find(p => p.orden_id === item.id && p.proceso_id === proc.proceso.id) : null;
                                const machineName = plannedItem?.nombre_maquinaria || (plannedItem?.id_maquinaria ? "Cargando..." : "Maquinaria no asignada");

                                return (
                                    <div
                                        key={`${item.id}-${proc.proceso.id}`}
                                        className="flex flex-col md:grid md:grid-cols-[40px_3fr_110px_110px_70px_70px_2fr_2fr] gap-3 px-4 py-4 md:py-2 border-t hover:bg-gray-50 items-stretch md:items-center bg-white"
                                    >
                                        {/* # */}
                                        <div className="flex flex-row justify-between md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase self-center">Orden</span>
                                            <div className="flex items-center text-gray-500 font-mono">
                                                {proc.orden}
                                            </div>
                                        </div>

                                        {/* Proceso */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Proceso</span>
                                            <div className="font-medium text-xs md:text-sm truncate" title={proc.proceso?.nombre || "-"}>{proc.proceso?.nombre || "-"}</div>
                                        </div>

                                        {/* Inicio Estimado */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Inicio Estimado</span>
                                            <div
                                                className="group relative flex items-center justify-center gap-1 text-xs font-medium text-amber-900 bg-amber-50/80 px-2 py-1 rounded-lg border border-amber-200/60 cursor-pointer hover:bg-amber-100 hover:border-amber-300 hover:shadow-sm transition-all duration-200 w-full whitespace-nowrap"
                                                onClick={() => handleStartDateClick(item.id, proc.proceso.id, "")}
                                                title="Click para editar fecha de inicio estimada"
                                            >
                                                <CalendarClock className="w-3 h-3 text-amber-600/70 group-hover:text-amber-700 transition-colors" />
                                                {editingStartDate?.orderId === item.id && editingStartDate?.processId === proc.proceso.id ? (
                                                    <input
                                                        type="datetime-local"
                                                        className="border rounded px-1 py-0.5 text-[10px] w-full bg-white shadow-inner focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
                                                        value={editingStartDate.value}
                                                        onChange={(e) => setEditingStartDate({ ...editingStartDate, value: e.target.value })}
                                                        onBlur={handleStartDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleStartDateSave()}
                                                        autoFocus
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <span className="group-hover:text-amber-950 transition-colors whitespace-nowrap block">
                                                        {getScheduledStart(item.id, proc.proceso.id)}
                                                    </span>
                                                )}
                                                <Pencil className="w-3 h-3 text-amber-400 opacity-0 group-hover:opacity-100 absolute right-1 transition-all duration-200" />
                                            </div>
                                        </div>

                                        {/* Estado */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Estado</span>
                                            <div>
                                                <Select
                                                    defaultValue={proc.estado_proceso?.id?.toString() || "1"}
                                                    onValueChange={(val) => onProcessStatusChange && onProcessStatusChange(item.id, proc.proceso.id, parseInt(val))}
                                                >
                                                    <SelectTrigger className={cn(
                                                        "h-7 text-xs w-full border-none shadow-none font-medium px-2",
                                                        (proc.estado_proceso?.id === 3 || (!proc.estado_proceso?.id && false)) ? "text-green-800 bg-green-100 hover:bg-green-200" :
                                                            proc.estado_proceso?.id === 2 ? "text-blue-800 bg-blue-100 hover:bg-blue-200" :
                                                                "text-gray-800 bg-gray-100 hover:bg-gray-200"
                                                    )}>
                                                        <SelectValue placeholder="Estado" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="1">Pendiente</SelectItem>
                                                        <SelectItem value="2">En Proceso</SelectItem>
                                                        <SelectItem value="3">Finalizado</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        {/* Min. Est. */}
                                        <div className="flex flex-row justify-between md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase self-center">Min. Est.</span>
                                            <div className="text-center text-gray-600 text-xs">{proc.tiempo_proceso || "-"}</div>
                                        </div>

                                        {/* Min. Real */}
                                        <div className="flex flex-row justify-between md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase self-center">Min. Real</span>
                                            <div className="text-center font-bold text-blue-700 text-xs">
                                                {calculateRealMinutes(proc.inicio_real, proc.fin_real)}
                                            </div>
                                        </div>

                                        {/* Operario */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Operario</span>
                                            <div>
                                                {onOperatorChange && operarios.length > 0 ? (
                                                    <Select
                                                        value={operarios.find(op => {
                                                            const opName = `${op.nombre} ${op.apellido}`.trim().toLowerCase();
                                                            const currentName = (proc.operario_nombre || "").trim().toLowerCase();
                                                            return opName === currentName;
                                                        })?.id?.toString() || undefined}
                                                        onValueChange={(val) => onOperatorChange(item.id, proc.proceso.id, parseInt(val))}
                                                    >
                                                        <SelectTrigger className="h-7 text-xs w-full border border-gray-200 px-2">
                                                            <SelectValue placeholder={toTitleCase(proc.operario_nombre) || "Sin Asignar"} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {operarios.map((op) => (
                                                                <SelectItem key={op.id} value={op.id.toString()}>
                                                                    {toTitleCase(`${op.nombre} ${op.apellido}`)}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <span className="text-gray-700 text-xs font-medium block truncate" title={toTitleCase(proc.operario_nombre) || "Sin Asignar"}>
                                                        {toTitleCase(proc.operario_nombre) || "Sin Asignar"}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Maquinaria */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Maquinaria</span>
                                            <div>
                                                {onMachineryChange && maquinarias.length > 0 ? (
                                                    <Select
                                                        value={plannedItem?.id_maquinaria?.toString() || "0"}
                                                        onValueChange={(val) => onMachineryChange(item.id, proc.proceso.id, parseInt(val))}
                                                    >
                                                        <SelectTrigger className="h-7 text-xs w-full border border-gray-200 px-2">
                                                            <SelectValue placeholder={machineName} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="0" className="text-gray-400 italic">Maquinaria no asignada</SelectItem>
                                                            {maquinarias.map((m) => (
                                                                <SelectItem key={m.id} value={m.id.toString()}>
                                                                    {m.nombre}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <div className="text-gray-600 text-xs font-medium truncate" title={machineName}>
                                                        {machineName}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            <RegisterDeliveryDialog
                                open={!!deliveryOrder}
                                onOpenChange={(open) => !open && setDeliveryOrder(null)}
                                currentOrder={deliveryOrder}
                                onSuccess={() => {
                                    window.location.reload();
                                }}
                            />
                            <div className="px-3 py-3 bg-gray-50 border-t border-gray-200">
                                <AddProcessRow
                                    orderId={item.id}
                                    onProcessAdded={() => {
                                        if (onDataChange) onDataChange();
                                    }}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="px-4 py-4 bg-gray-50 border-t border-gray-100">
                            <div className="w-full">
                                <AddProcessRow
                                    orderId={item.id}
                                    onProcessAdded={() => {
                                        if (onDataChange) onDataChange();
                                    }}
                                    isCentered={true}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-700"></div>
            </div>
        );
    }

    return (
        <div className="space-y-4 mt-6">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                    placeholder="Buscar por OT, pedido, cliente, código o producto..."
                    className="pl-10 border-gray-300 focus:border-red-500 focus:ring-red-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Mobile Card View (< md) */}
            <div className="md:hidden space-y-4">
                {sortedData.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 bg-white rounded-lg shadow">
                        {searchTerm ? "No se encontraron resultados." : "No hay órdenes activas."}
                    </div>
                ) : (
                    sortedData.map((item) => (
                        <Card key={item.id} className={cn("overflow-hidden border border-gray-200 shadow-sm", getRowColor(item))}>
                            <div
                                className="p-4"
                                onClick={() => toggleRow(item.id)}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-lg text-gray-800">#{item.id_otvieja || item.id}</span>
                                        {!hideStatus && renderStatusBadge(getOrderStatus(item))}
                                    </div>
                                    <button className="text-gray-400">
                                        {expandedOrderIds.includes(item.id) ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                    </button>
                                </div>

                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="font-semibold text-gray-900 line-clamp-1">{item.cliente?.nombre || "-"}</span>
                                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{item.articulo?.cod_articulo}</span>
                                    </div>

                                    <div className="text-gray-600 line-clamp-2 text-xs">
                                        {(item.articulo?.cod_articulo === 'NO-DEF' || item.articulo?.descripcion?.toLowerCase().includes('heredado')) && item.observaciones
                                            ? item.observaciones
                                            : item.articulo?.descripcion}
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-gray-100/50 mt-2">
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Cant.</span>
                                            <span className="font-medium">{item.unidades}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Prioridad</span>
                                            <Badge variant="outline" className="bg-white/50 text-[10px] h-5 px-1.5">
                                                {getPriorityLabel(item.id_prioridad, item.prioridad?.descripcion)}
                                            </Badge>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Entrega</span>
                                            <span className="font-medium">{item.fecha_entrega ? formatDate(item.fecha_entrega) : "-"}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Material</span>
                                            <span className={cn("font-medium",
                                                item.estado_material === 'sin_stock' ? "text-red-600" :
                                                    item.estado_material === 'ok' ? "text-green-600" :
                                                        "text-gray-600"
                                            )}>
                                                {item.estado_material === 'ok' ? 'OK' : item.estado_material === 'pedido' ? 'Pedido' : 'Sin Stock'}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">N° Pedido</span>
                                            <span className="font-medium text-gray-700">{item.n_pedido || item.n_ped_l || "-"}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Aprobado Por</span>
                                            <span className="font-medium text-gray-700">{item.aprobado_por || "-"}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Expanded Details for Mobile */}
                            {expandedOrderIds.includes(item.id) && (
                                <div className="bg-gray-50 border-t p-2">
                                    {renderDetails(item)}
                                </div>
                            )}
                        </Card>
                    ))
                )}
            </div>

            {/* Desktop Table View (>= md). El `zoom` aplica SOLO acá (no al search ni a las tarjetas mobile). */}
            <Card className="hidden md:block overflow-hidden border-none shadow-xl bg-white w-full relative" style={{ zoom: tableZoom / 100 }}>
                <div ref={scrollContainerRef} className="w-full overflow-x-auto pt-4 scrollbar-horizontal-visible scrollbar-top">
                    <table className="w-full min-w-[1600px] text-sm text-left">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                            <tr>
                                <th className="w-12 px-2 py-3">
                                    {onSelectionChange && (
                                        <label className="flex items-center justify-center w-full h-full py-1 cursor-pointer">
                                            <Checkbox
                                                className="h-5 w-5"
                                                checked={sortedData.length > 0 && selectedIds.length === sortedData.length}
                                                onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                            />
                                        </label>
                                    )}
                                </th>
                                <th className="w-10 px-3 py-3"></th>
                                <th className="w-12 px-3 py-3 font-bold text-gray-500 text-center" title="Número de fila">#</th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('id_otvieja')}
                                >
                                    <div className="flex items-center">
                                        OT
                                        <SortIcon column="id_otvieja" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('fecha_entrada')}
                                >
                                    <div className="flex items-center">
                                        F. Entrada
                                        <SortIcon column="fecha_entrada" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group min-w-[200px]"
                                    onClick={() => handleSort('cliente')}
                                >
                                    <div className="flex items-center">
                                        Cliente
                                        <SortIcon column="cliente" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('codigo')}
                                >
                                    <div className="flex items-center">
                                        Código
                                        <SortIcon column="codigo" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group min-w-[400px]"
                                    onClick={() => handleSort('descripcion')}
                                    title="Ordenar por producto"
                                >
                                    <div className="flex items-center">
                                        Producto
                                        <SortIcon column="descripcion" />
                                    </div>
                                </th>
                                <th className="px-3 py-3 font-bold text-gray-600">
                                    N° Pedido
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('unidades')}
                                    title="Ordenar por cantidad"
                                >
                                    <div className="flex items-center justify-center">
                                        Cant.
                                        <SortIcon column="unidades" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('prioridad')}
                                    title="Ordenar por prioridad"
                                >
                                    <div className="flex items-center justify-center">
                                        Prioridad
                                        <SortIcon column="prioridad" />
                                    </div>
                                </th>
                                <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group">
                                    Material
                                </th>
                                <th className="px-3 py-3 font-bold text-gray-600 text-center" title="¿La OT tiene procesos cargados?">
                                    Proceso
                                </th>
                                <th className="px-3 py-3 font-bold text-gray-600 text-center" title="¿La OT tiene plano cargado?">
                                    Plano
                                </th>
                                {!hideStatus && (
                                    <th
                                        className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                        onClick={() => handleSort('estado')}
                                    >
                                        <div className="flex items-center justify-center">
                                            Estado
                                            <SortIcon column="estado" />
                                        </div>
                                    </th>
                                )}
                                <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group">
                                    Entrega
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('fecha_prometida')}
                                >
                                    <div className="flex items-center">
                                        F. Prom.
                                        <SortIcon column="fecha_prometida" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('fecha_entrega')}
                                >
                                    <div className="flex items-center">
                                        F. Entrega
                                        <SortIcon column="fecha_entrega" />
                                    </div>
                                </th>
                                <th className="px-3 py-3 font-bold text-gray-600">
                                    Aprobado x
                                </th>
                                <th className="px-3 py-3 font-bold text-gray-600">
                                    Pedido x
                                </th>
                            </tr>
                        </thead>
                        {/* `[&_td]:align-middle` centra verticalmente todas las celdas de body.
                            Antes cuando "INDUSTRIAS CERAMICAS LOURDES S.A." rompía en 3-4 líneas,
                            el resto de las celdas (#, OT, fecha, código) se anclaban al top y la
                            fila se veía desalineada. */}
                        <tbody className="[&_td]:align-middle">
                            {sortedData.length === 0 ? (
                                <tr className="bg-gray-50 border-b">
                                    <td colSpan={19} className="px-3 py-8 text-center text-gray-500">
                                        {searchTerm ? "No se encontraron resultados para la búsqueda." : "No hay órdenes activas en este momento."}
                                    </td>
                                </tr>

                            ) : (
                                sortedData.map((item, index) => (
                                    <React.Fragment key={item.id}>
                                        <tr
                                            onClick={() => onRowClick(item)}
                                            className={cn(
                                                "border-b transition-colors duration-150 cursor-pointer hover:opacity-80",
                                                getRowColor(item)
                                            )}
                                        >
                                            <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                                                {onSelectionChange && (
                                                    <label className="flex items-center justify-center w-full h-full py-2 cursor-pointer">
                                                        <Checkbox
                                                            className="h-5 w-5"
                                                            checked={selectedIds.includes(item.id)}
                                                            onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                                        />
                                                    </label>
                                                )}
                                            </td>
                                            <td className="px-3 py-3">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleRow(item.id);
                                                    }}
                                                    className="p-1 hover:bg-black/10 rounded transition-colors"
                                                >
                                                    {expandedOrderIds.includes(item.id) ? (
                                                        <ChevronDown className="h-4 w-4 text-gray-600" />
                                                    ) : (
                                                        <ChevronRight className="h-4 w-4 text-gray-400" />
                                                    )}
                                                </button>
                                            </td>
                                            <td className="px-3 py-3 text-center text-gray-500 font-mono text-xs select-none">{index + 1}</td>
                                            <td className="px-3 py-3 font-medium">{item.id_otvieja || item.id}</td>
                                            <td className="px-3 py-3 font-medium cursor-pointer hover:bg-black/5 rounded-sm" onClick={(e) => { e.stopPropagation(); handleDateClick(item.id, 'fecha_entrada', item.fecha_entrada); }}>
                                                {editingOrder?.id === item.id && editingOrder.field === 'fecha_entrada' ? (
                                                    <input
                                                        type="date"
                                                        className="border rounded px-1 py-1 text-xs w-full shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    formatDate(item.fecha_entrada)
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-gray-500 italic">{item.cliente?.nombre || "-"}</td>
                                            <td className="px-3 py-3 font-mono text-xs">{item.articulo?.cod_articulo || "-"}</td>
                                            <td className="px-3 py-3 font-medium text-gray-900 min-w-[300px] max-w-[450px] cursor-pointer hover:bg-black/5 rounded-sm" onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'observaciones', getEditableProductDescription(item)); }}>
                                                {editingOrder?.id === item.id && editingOrder.field === 'observaciones' ? (
                                                    <input
                                                        type="text"
                                                        className="border rounded px-2 py-1 text-xs w-full shadow-inner focus:ring-2 focus:ring-blue-500/20"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className="line-clamp-2" title={getEditableProductDescription(item)}>
                                                        {getEditableProductDescription(item) || "-"}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-600 cursor-pointer hover:bg-black/5 rounded-sm" onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'n_pedido', item.n_pedido || item.n_ped_l); }}>
                                                {editingOrder?.id === item.id && editingOrder.field === 'n_pedido' ? (
                                                    <input
                                                        type="text"
                                                        className="border rounded px-1 py-1 text-xs w-full shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.n_pedido || item.n_ped_l || "-"
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-center font-medium cursor-pointer hover:bg-black/5 rounded-sm" onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'unidades', item.unidades); }}>
                                                {editingOrder?.id === item.id && editingOrder.field === 'unidades' ? (
                                                    <input
                                                        type="number"
                                                        className="border rounded px-1 py-1 text-xs w-16 text-center shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.unidades ?? "-"
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                    {getPriorityLabel(item.id_prioridad, item.prioridad?.descripcion)}
                                                </Badge>
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                {item.estado_material === 'sin_stock' ? (
                                                    <Badge
                                                        variant="destructive"
                                                        className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200 gap-1 pl-1.5 shadow-none font-semibold cursor-help"
                                                        title="Material no disponible y no pedido al proveedor"
                                                    >
                                                        <AlertTriangle className="h-3 w-3" /> Sin Stock
                                                    </Badge>
                                                ) : item.estado_material === 'pedido' ? (
                                                    <Badge
                                                        variant="outline"
                                                        className="bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200 gap-1 pl-1.5 shadow-none font-semibold cursor-help"
                                                        title="Material pedido al proveedor, esperando entrega"
                                                    >
                                                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                                        Pedido
                                                    </Badge>
                                                ) : item.estado_material === 'ok' ? (
                                                    <Badge
                                                        variant="outline"
                                                        className="bg-green-50 text-green-700 hover:bg-green-100 border-green-200 gap-1 pl-1.5 shadow-none font-semibold cursor-help"
                                                        title="Material disponible para producción"
                                                    >
                                                        <CheckCircle2 className="h-3 w-3" /> OK
                                                    </Badge>
                                                ) : (
                                                    <Badge
                                                        variant="destructive"
                                                        className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200 gap-1 pl-1.5 shadow-none font-semibold cursor-help"
                                                        title="No hay datos de materiales cargados - Verificar disponibilidad"
                                                    >
                                                        <AlertTriangle className="h-3 w-3" /> Sin Stock
                                                    </Badge>
                                                )}
                                            </td>
                                            {/* Proceso: Sí (verde) si tiene procesos cargados. */}
                                            <td className="px-3 py-3 text-center">
                                                {(item.procesos && item.procesos.length > 0) ? (
                                                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-semibold">Sí</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 font-semibold">No</Badge>
                                                )}
                                            </td>
                                            {/* Plano: Sí (verde) si tiene_plano==1. */}
                                            <td className="px-3 py-3 text-center">
                                                {Number(item.tiene_plano) === 1 ? (
                                                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-semibold">Sí</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 font-semibold">No</Badge>
                                                )}
                                            </td>
                                            {!hideStatus && (
                                                <td className="px-3 py-3 text-center">
                                                    {renderStatusBadge(getOrderStatus(item))}
                                                </td>
                                            )}
                                            <td className="px-3 py-3">
                                                <div
                                                    className="cursor-pointer hover:opacity-70 transition-opacity"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeliveryOrder({
                                                            id: item.id,
                                                            total: item.unidades || 0,
                                                            delivered: item.cantidad_entregada || 0
                                                        });
                                                    }}
                                                    title="Click para registrar entrega"
                                                >
                                                    <DeliveryProgress
                                                        total={item.unidades}
                                                        delivered={item.cantidad_entregada}
                                                        compact={true}
                                                    />
                                                </div>
                                            </td>

                                            {/* Editable F. Prometida */}
                                            <td className="px-3 py-3 font-medium cursor-pointer hover:bg-black/5" onClick={(e) => { e.stopPropagation(); handleDateClick(item.id, 'fecha_prometida', item.fecha_prometida); }}>
                                                {editingOrder?.id === item.id && editingOrder.field === 'fecha_prometida' ? (
                                                    <input
                                                        type="date"
                                                        className="border rounded px-1 py-0.5 text-xs w-full"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    formatDate(item.fecha_prometida)
                                                )}
                                            </td>

                                            {/* Editable F. Entrega */}
                                            <td className="px-3 py-3 text-gray-500 cursor-pointer hover:bg-black/5" onClick={(e) => { e.stopPropagation(); handleDateClick(item.id, 'fecha_entrega', item.fecha_entrega); }}>
                                                {editingOrder?.id === item.id && editingOrder.field === 'fecha_entrega' ? (
                                                    <input
                                                        type="date"
                                                        className="border rounded px-1 py-0.5 text-xs w-full"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.fecha_entrega && !item.fecha_entrega.startsWith('1950') ? (
                                                        formatDate(item.fecha_entrega)
                                                    ) : (
                                                        <div className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors bg-gray-50/50 px-2 py-1 rounded border border-transparent hover:border-gray-200">
                                                            <CalendarClock className="h-3 w-3" />
                                                            <span>dd/mm/aaaa</span>
                                                        </div>
                                                    )
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-600 cursor-pointer hover:bg-black/5 rounded-sm" onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'aprobado_por', item.aprobado_por); }} title={item.aprobado_por || "-"}>
                                                {editingOrder?.id === item.id && editingOrder.field === 'aprobado_por' ? (
                                                    <input
                                                        type="text"
                                                        className="border rounded px-1 py-1 text-xs w-full shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.aprobado_por || "-"
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-600 cursor-pointer hover:bg-black/5 rounded-sm" onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'requerido_por', item.requerido_por); }} title={item.requerido_por || "-"}>
                                                {editingOrder?.id === item.id && editingOrder.field === 'requerido_por' ? (
                                                    <input
                                                        type="text"
                                                        className="border rounded px-1 py-1 text-xs w-full shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.requerido_por || "-"
                                                )}
                                            </td>
                                        </tr>
                                        {expandedOrderIds.includes(item.id) && (
                                            <tr className="bg-gray-50 border-b">
                                                <td colSpan={19} className="px-4 py-4">
                                                    {renderDetails(item)}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {/* Gradient fade en el borde derecho — solo se muestra cuando hay
                    más contenido scrolleable a la derecha. Cuando el usuario llega al
                    final, `showRightFade` pasa a false y el gradient desaparece con
                    una transición suave de opacidad. */}
                <div
                    className={`pointer-events-none absolute top-0 right-0 h-full w-12 bg-gradient-to-l from-white via-white/80 to-transparent transition-opacity duration-200 ${showRightFade ? 'opacity-100' : 'opacity-0'}`}
                />
            </Card >
        </div >
    );
}


