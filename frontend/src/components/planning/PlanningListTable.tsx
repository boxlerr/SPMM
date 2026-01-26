"use client";

import React from "react";
import { WorkOrder, PlanificacionItem } from "@/lib/types";
import { AddProcessRow } from "@/components/planning/AddProcessRow";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
    highlightedIds = []
}: PlanningListTableProps) {


    const [sortConfig, setSortConfig] = React.useState<{
        key: 'id' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'prioridad' | 'estado' | 'fecha_prometida' | 'fecha_entrega' | null;
        direction: 'asc' | 'desc' | null
    }>({
        key: null,
        direction: null,
    });
    const [searchTerm, setSearchTerm] = React.useState("");
    const [expandedOrderIds, setExpandedOrderIds] = React.useState<number[]>([]);

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

    const getScheduledStart = (ordenId: number, procesoId: number) => {
        if (!planificacion || planificacion.length === 0) return "-";
        const item = planificacion.find(p => p.orden_id === ordenId && p.proceso_id === procesoId);
        if (!item) return "-";

        // Logic matching convertPlanificacionToGanttTasks from page.tsx/gantt-utils
        const baseDate = item.creado_en ? new Date(item.creado_en) : new Date();
        const normalizedBaseDate = new Date(baseDate);
        normalizedBaseDate.setHours(9, 0, 0, 0); // 9:00 AM start

        const start = addWorkMinutes(normalizedBaseDate, item.inicio_min);

        return new Intl.DateTimeFormat('es-AR', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(start);
    };


    const getRowColor = (item: WorkOrder) => {
        // Highlighted check (e.g. reused orders in re-planning)
        if (highlightedIds.includes(item.id)) {
            return "bg-green-50 hover:bg-green-100 text-green-900 border-l-4 border-green-500";
        }

        // 1. Finalizada Total (Violeta)
        const allFinalized = item.procesos?.every(p => p.estado_proceso.id === 3) && item.procesos.length > 0;

        if (allFinalized) return "bg-purple-200 hover:bg-purple-300 text-purple-900";

        // 2. Finalizada Parcial / Entregada Parcial (Gris)
        // If delivered > 0 but not all finished or not all units
        if ((item.cantidad_entregada || 0) > 0 && (item.cantidad_entregada || 0) < (item.unidades || 0)) {
            return "bg-gray-200 hover:bg-gray-300 text-gray-900";
        }

        // 3. En Producción (Naranja)
        // Any process started (id 2) or finished (id 3) but not all finalized
        const anyStarted = item.procesos?.some(p => p.estado_proceso.id === 2 || p.estado_proceso.id === 3);
        if (anyStarted) return "bg-orange-200 hover:bg-orange-300 text-orange-900";

        // 4. Programada (Verde)
        // Check if present in planificacion
        const isScheduled = planificacion?.some(p => p.orden_id === item.id);
        if (isScheduled) return "bg-green-100 hover:bg-green-200 text-green-900";

        // 5. Material Disponible (Marrón/Amber)
        if (item.estado_material === 'ok') return "bg-amber-200 hover:bg-amber-300 text-amber-900";

        // 6. Material Pedido (Amarillo)
        if (item.estado_material === 'pedido') return "bg-yellow-100 hover:bg-yellow-200 text-yellow-900";

        // Default / Sin Stock (Normal or Red ish)
        return "bg-white hover:bg-gray-50 text-gray-900"; // Or maintain white for clean look if no other status
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

    const handleSort = (key: 'id' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'prioridad' | 'estado' | 'fecha_prometida' | 'fecha_entrega') => {
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

    type SortColumn = 'id' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'prioridad' | 'estado' | 'fecha_prometida' | 'fecha_entrega';

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

    const [editingOrder, setEditingOrder] = React.useState<{ id: number, field: 'fecha_prometida' | 'fecha_entrega', value: string } | null>(null);
    const [editingStartDate, setEditingStartDate] = React.useState<{ orderId: number, processId: number, planId: number, value: string } | null>(null);
    const [deliveryOrder, setDeliveryOrder] = React.useState<{ id: number, total: number, delivered: number } | null>(null);

    const handleDateClick = (orderId: number, field: 'fecha_prometida' | 'fecha_entrega', currentValue: string | undefined) => {
        // Prevent editing if it's a legacy date
        if (currentValue?.startsWith('1950')) {
            setEditingOrder({ id: orderId, field, value: '' }); // Clear for new date
            return;
        }
        setEditingOrder({
            id: orderId,
            field,
            value: currentValue ? new Date(currentValue).toISOString().split('T')[0] : ''
        });
    };

    const handleDateSave = async () => {
        if (!editingOrder) return;

        try {
            const response = await fetch(`${API_URL}/ordenes/${editingOrder.id}`, {
                method: 'PUT',
                headers: { ...getAuthHeaders() as Record<string, string>, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    [editingOrder.field]: editingOrder.value ? new Date(editingOrder.value).toISOString() : null
                })
            });

            if (!response.ok) throw new Error('Failed to update date');

            // Optimistic update or refetch needed. 
            // For now, let's just close. The parent should probably handle data refresh or we pass an onUpdate callback.
            setEditingOrder(null);
            // Force refresh ideally
            window.location.reload();

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

            <Card className="overflow-hidden border-none shadow-xl bg-white">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                            <tr>
                                <th className="w-10 px-4 py-3">
                                    {onSelectionChange && (
                                        <Checkbox
                                            checked={sortedData.length > 0 && selectedIds.length === sortedData.length}
                                            onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                        />
                                    )}
                                </th>
                                <th className="w-10 px-4 py-3"></th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('id')}
                                >
                                    <div className="flex items-center">
                                        OT
                                        <SortIcon column="id" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('fecha_entrada')}
                                >
                                    <div className="flex items-center">
                                        F. Entrada
                                        <SortIcon column="fecha_entrada" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('cliente')}
                                >
                                    <div className="flex items-center">
                                        Cliente
                                        <SortIcon column="cliente" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('codigo')}
                                >
                                    <div className="flex items-center">
                                        Código
                                        <SortIcon column="codigo" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('descripcion')}
                                >
                                    <div className="flex items-center">
                                        Descripción
                                        <SortIcon column="descripcion" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('unidades')}
                                    title="Ordenar por cantidad"
                                >
                                    <div className="flex items-center justify-center">
                                        Cant.
                                        <SortIcon column="unidades" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('prioridad')}
                                    title="Ordenar por prioridad"
                                >
                                    <div className="flex items-center justify-center">
                                        Prioridad
                                        <SortIcon column="prioridad" />
                                    </div>
                                </th>
                                <th className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group">
                                    Material
                                </th>
                                {!hideStatus && (
                                    <th
                                        className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                        onClick={() => handleSort('estado')}
                                    >
                                        <div className="flex items-center justify-center">
                                            Estado
                                            <SortIcon column="estado" />
                                        </div>
                                    </th>
                                )}
                                <th className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group">
                                    Entrega
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"

                                    onClick={() => handleSort('fecha_prometida')}
                                >
                                    <div className="flex items-center">
                                        F. Prom.
                                        <SortIcon column="fecha_prometida" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('fecha_entrega')}
                                >
                                    <div className="flex items-center">
                                        F. Entrega
                                        <SortIcon column="fecha_entrega" />
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.length === 0 ? (
                                <tr className="bg-gray-50 border-b">
                                    <td colSpan={12} className="px-4 py-8 text-center text-gray-500">
                                        {searchTerm ? "No se encontraron resultados para la búsqueda." : "No hay órdenes activas en este momento."}
                                    </td>
                                </tr>

                            ) : (
                                sortedData.map((item) => (
                                    <React.Fragment key={item.id}>
                                        <tr
                                            onClick={() => onRowClick(item)}
                                            className={cn(
                                                "border-b transition-colors duration-150 cursor-pointer hover:opacity-80",
                                                getRowColor(item)
                                            )}
                                        >
                                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                {onSelectionChange && (
                                                    <Checkbox
                                                        checked={selectedIds.includes(item.id)}
                                                        onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                                    />
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
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
                                            <td className="px-4 py-3 font-medium">{item.id}</td>
                                            <td className="px-4 py-3">{formatDate(item.fecha_entrada)}</td>
                                            <td className="px-4 py-3 text-gray-500 italic">{item.cliente?.nombre || "-"}</td>
                                            <td className="px-4 py-3 font-mono text-xs">{item.articulo?.cod_articulo || "-"}</td>
                                            <td className="px-4 py-3 font-medium text-gray-900">{item.articulo?.descripcion || "-"}</td>
                                            <td className="px-4 py-3 text-center font-medium">{item.unidades ?? "-"}</td>
                                            <td className="px-4 py-3 text-center">
                                                <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                    {getPriorityLabel(item.id_prioridad, item.prioridad?.descripcion)}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-center">
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
                                            {!hideStatus && (
                                                <td className="px-4 py-3 text-center">
                                                    {renderStatusBadge(getOrderStatus(item))}
                                                </td>
                                            )}
                                            <td className="px-4 py-3">
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
                                            <td className="px-4 py-3 font-medium cursor-pointer hover:bg-black/5" onClick={(e) => { e.stopPropagation(); handleDateClick(item.id, 'fecha_prometida', item.fecha_prometida); }}>
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
                                            <td className="px-4 py-3 text-gray-500 cursor-pointer hover:bg-black/5" onClick={(e) => { e.stopPropagation(); handleDateClick(item.id, 'fecha_entrega', item.fecha_entrega); }}>
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
                                        </tr>
                                        {expandedOrderIds.includes(item.id) && (
                                            <tr className="bg-gray-50 border-b">
                                                <td colSpan={12} className="px-4 py-4">
                                                    <div className="ml-8 border rounded-md overflow-hidden bg-white shadow-inner">
                                                        <div className="px-4 pt-4 mb-4">
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
                                                        <div className="px-4 pt-0">
                                                            <OrderFiles orderId={item.id} />
                                                        </div>
                                                        <div className="w-full text-sm">
                                                            <div className="bg-gray-100 text-xs uppercase text-gray-600 grid grid-cols-[50px_1fr_180px_120px_80px_100px_200px_200px] gap-4 px-4 py-2 font-bold border-t border-gray-200">
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
                                                                                    // ... existing code ...
                                                                                    className="grid grid-cols-[50px_1fr_180px_120px_80px_100px_200px_200px] gap-4 px-4 py-2 border-t hover:bg-gray-50 items-center bg-white"
                                                                                >
                                                                                    {/* ... existing cells ... */}
                                                                                    <div className="flex items-center text-gray-500 font-mono">
                                                                                        {proc.orden}
                                                                                    </div>
                                                                                    <div className="font-medium">{proc.proceso?.nombre || "-"}</div>
                                                                                    <div
                                                                                        className="group relative flex items-center justify-center gap-2 text-xs font-medium text-amber-900 bg-amber-50/80 px-3 py-1.5 rounded-lg border border-amber-200/60 cursor-pointer hover:bg-amber-100 hover:border-amber-300 hover:shadow-sm transition-all duration-200 w-full whitespace-nowrap"
                                                                                        onClick={() => handleStartDateClick(item.id, proc.proceso.id, "")}
                                                                                        title="Click para editar fecha de inicio estimada"
                                                                                    >
                                                                                        <CalendarClock className="w-3.5 h-3.5 text-amber-600/70 group-hover:text-amber-700 transition-colors" />
                                                                                        {editingStartDate?.orderId === item.id && editingStartDate?.processId === proc.proceso.id ? (
                                                                                            <input
                                                                                                type="datetime-local"
                                                                                                className="border rounded px-1 py-0.5 text-xs w-full bg-white shadow-inner focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
                                                                                                value={editingStartDate.value}
                                                                                                onChange={(e) => setEditingStartDate({ ...editingStartDate, value: e.target.value })}
                                                                                                onBlur={handleStartDateSave}
                                                                                                onKeyDown={(e) => e.key === 'Enter' && handleStartDateSave()}
                                                                                                autoFocus
                                                                                                onClick={(e) => e.stopPropagation()}
                                                                                            />
                                                                                        ) : (
                                                                                            <span className="group-hover:text-amber-950 transition-colors">
                                                                                                {getScheduledStart(item.id, proc.proceso.id)}
                                                                                            </span>
                                                                                        )}
                                                                                        <Pencil className="w-3 h-3 text-amber-400 opacity-0 group-hover:opacity-100 absolute right-2 transition-all duration-200" />
                                                                                    </div>
                                                                                    <div>
                                                                                        <Select
                                                                                            defaultValue={proc.estado_proceso?.id?.toString() || "1"}
                                                                                            onValueChange={(val) => onProcessStatusChange && onProcessStatusChange(item.id, proc.proceso.id, parseInt(val))}
                                                                                        >
                                                                                            <SelectTrigger className={cn(
                                                                                                "h-8 w-full border-none shadow-none font-medium",
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
                                                                                    <div className="text-center text-gray-600">{proc.tiempo_proceso || "-"}</div>

                                                                                    {/* Real Minutes Column */}
                                                                                    <div className="text-center font-bold text-blue-700">
                                                                                        {calculateRealMinutes(proc.inicio_real, proc.fin_real)}
                                                                                    </div>

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
                                                                                                <SelectTrigger className="h-8 w-full border border-gray-200">
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
                                                                                            <span className="text-gray-700 text-xs font-medium block">
                                                                                                {toTitleCase(proc.operario_nombre) || "Sin Asignar"}
                                                                                            </span>
                                                                                        )}
                                                                                    </div>

                                                                                    {/* Maquinaria Column */}
                                                                                    <div>
                                                                                        {onMachineryChange && maquinarias.length > 0 ? (
                                                                                            <Select
                                                                                                value={plannedItem?.id_maquinaria?.toString() || "0"}
                                                                                                onValueChange={(val) => onMachineryChange(item.id, proc.proceso.id, parseInt(val))}
                                                                                            >
                                                                                                <SelectTrigger className="h-8 w-full border border-gray-200">
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
                                                                                            <div className="text-gray-600 text-xs font-medium">
                                                                                                {machineName}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}

                                                                        {/* Add Process Button at the bottom of the list when items exist */}

                                                                        <RegisterDeliveryDialog
                                                                            open={!!deliveryOrder}
                                                                            onOpenChange={(open) => !open && setDeliveryOrder(null)}
                                                                            currentOrder={deliveryOrder}
                                                                            onSuccess={() => {
                                                                                window.location.reload();
                                                                            }}
                                                                        />
                                                                        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                                                                            <AddProcessRow
                                                                                orderId={item.id}
                                                                                onProcessAdded={() => {
                                                                                    if (onDataChange) onDataChange();
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    /* Empty State with integrated Add Process Button */
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
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card >
        </div >
    );
}


