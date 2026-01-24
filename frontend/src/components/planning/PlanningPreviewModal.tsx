import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Clock, User, Cog, AlertCircle, CalendarClock, Edit2, RotateCcw, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PlanificacionResult {
    orden_id: number;
    proceso_id: number;
    nombre_proceso: string;
    inicio_min: number;
    fin_min: number;
    duracion_min: number;
    prioridad_peso: number;
    id_operario?: number;
    id_rango_operario?: number;
    id_maquinaria?: number;
    rangos_permitidos_proceso?: number[];
    fecha_prometida?: string | null;
    sin_asignar: boolean;
    sin_maquinaria: boolean;
    secuencia?: number;
    fecha_inicio_estimada?: string;
    fecha_fin_estimada?: string;
    // Enriched fields
    cliente?: string;
    articulo?: string;
    codigo?: string;
    operario_nombre?: string | null;
    maquinaria_nombre?: string | null;
    fecha_inicio_texto?: string;
    fecha_fin_texto?: string;
    unidades?: number;
    cantidad_entregada?: number;
    estado_material?: string;
    fecha_entrada?: string | null;
    id_prioridad?: number;
    prioridad_descripcion?: string;
}

interface PlanningPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    onBack?: () => void;
    onConfirm: () => void;
    results: PlanificacionResult[];
    operatorLoads?: Record<number, number>; // Current load in minutes
    isConfirming: boolean;
    availableOperators: any[]; // Resource[] or any
    availableMachines: any[];
}

export function PlanningPreviewModal({
    isOpen,
    onClose,
    onBack,
    onConfirm,
    results,
    operatorLoads = {},
    isConfirming,
    availableOperators = [],
    availableMachines = []
}: PlanningPreviewModalProps) {

    // Local state for edits
    const [editedResults, setEditedResults] = React.useState<Record<string, PlanificacionResult>>({});
    const [expandedOrderIds, setExpandedOrderIds] = React.useState<number[]>([]);

    // Reset when results change or modal opens
    React.useEffect(() => {
        setEditedResults({});
        const allIds = Array.from(new Set(results.map(r => r.orden_id)));
        setExpandedOrderIds(allIds);
    }, [results, isOpen]);

    const toggleRow = (orderId: number) => {
        setExpandedOrderIds(prev =>
            prev.includes(orderId)
                ? prev.filter(id => id !== orderId)
                : [...prev, orderId]
        );
    };

    // Helper to get the effective item (original or edited)
    const getEffectiveItem = (original: PlanificacionResult) => {
        const key = `${original.orden_id}-${original.proceso_id}`;
        return editedResults[key] || original;
    };

    // Handle updates
    const handleUpdate = (original: PlanificacionResult, field: keyof PlanificacionResult, value: any) => {
        const key = `${original.orden_id}-${original.proceso_id}`;
        const current = getEffectiveItem(original);

        let updated = { ...current, [field]: value };

        // Special handling for Resources (update IDs and Names for display)
        if (field === 'id_operario') {
            const op = availableOperators.find(o => o.id == value);
            updated.operario_nombre = op ? `${op.nombre} ${op.apellido}` : (value ? 'Desconocido' : null);
            updated.sin_asignar = !value;
        }
        if (field === 'id_maquinaria') {
            const maq = availableMachines.find(m => m.id == value);
            updated.maquinaria_nombre = maq ? maq.nombre : (value ? 'Desconocido' : null);
            updated.sin_maquinaria = !value;
        }

        setEditedResults(prev => ({ ...prev, [key]: updated }));
    };

    const handleDateChange = (original: PlanificacionResult, newDateStr: string) => {
        if (!newDateStr) return;
        const newDate = new Date(newDateStr);
        if (isNaN(newDate.getTime())) return;

        // Approximate min calculation relative to now to maintain sort/logic consistency if needed
        const nowMs = Date.now();
        const newMin = Math.round((newDate.getTime() - nowMs) / 60000);

        const key = `${original.orden_id}-${original.proceso_id}`;
        const current = getEffectiveItem(original);
        const duration = current.duracion_min || 0;

        const formattedStart = newDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        let updated = {
            ...current,
            inicio_min: newMin,
            fin_min: newMin + duration,
            fecha_inicio_texto: formattedStart,
            fecha_inicio_estimada: newDateStr
        };
        setEditedResults(prev => ({ ...prev, [key]: updated }));
    };

    // Convert text date to suitable input value (YYYY-MM-DDTHH:mm)
    const getDateFromMin = (min: number) => {
        const d = new Date(Date.now() + min * 60000);
        const iso = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        return iso;
    }

    const handleConfirmWithEdits = () => {
        const finalResults = results.map(r => getEffectiveItem(r));
        // @ts-ignore
        onConfirm(finalResults);
    };

    const capitalize = (s: string) => {
        if (!s) return "";
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    };

    const formatDate = (dateStr?: string | null) => {
        if (!dateStr || dateStr.startsWith('1950')) return "-";
        try {
            const date = new Date(dateStr);
            return new Intl.DateTimeFormat('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).format(date);
        } catch (e) {
            return dateStr || "-";
        }
    };

    const getPriorityColor = (priorityId?: number) => {
        switch (priorityId) {
            case 3: // Critica
                return "bg-red-200 hover:bg-red-300 text-red-900";
            case 2: // Urgente
                return "bg-orange-200 hover:bg-orange-300 text-orange-900";
            case 1: // Normal
                return "bg-blue-100 hover:bg-blue-200 text-blue-900";
            default:
                return "bg-white hover:bg-gray-50";
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

    // Group results by Order ID
    const groupedResults = React.useMemo(() => {
        const grouped: Record<number, PlanificacionResult[]> = {};
        results.forEach(res => {
            if (!grouped[res.orden_id]) {
                grouped[res.orden_id] = [];
            }
            grouped[res.orden_id].push(res);
        });
        // Sort items by secuencia if available
        Object.keys(grouped).forEach(key => {
            grouped[parseInt(key)].sort((a, b) => (a.secuencia || 0) - (b.secuencia || 0));
        });
        return grouped;
    }, [results]);

    // Calculate Conflicts
    const conflicts = React.useMemo(() => {
        let count = 0;
        const details: { ordenId: number, days: number }[] = [];
        results.forEach(res => {
            const effective = getEffectiveItem(res);
            if (!effective.fecha_fin_estimada || !effective.fecha_prometida) return;
            const estimatedEnd = new Date(effective.fecha_fin_estimada);
            const promised = new Date(effective.fecha_prometida);
            if (estimatedEnd > promised) {
                const diffTime = Math.abs(estimatedEnd.getTime() - promised.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 0) {
                    count++;
                    details.push({ ordenId: res.orden_id, days: diffDays });
                }
            }
        });
        return { count, details };
    }, [results, editedResults]);


    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="!max-w-[95vw] w-[95vw] max-h-[95vh] h-[95vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl">
                <DialogHeader className="p-6 pb-4 border-b bg-white z-10 shrink-0">
                    <div className="flex justify-between items-start">
                        <div>
                            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                                <div className="p-1.5 bg-blue-100 rounded-lg">
                                    <CalendarClock className="w-6 h-6 text-blue-600" />
                                </div>
                                Vista Previa de Planificación
                            </DialogTitle>
                            <DialogDescription className="text-base text-gray-500 mt-1">
                                Revise la planificación propuesta antes de confirmar.
                            </DialogDescription>
                        </div>
                        {conflicts.count > 0 && (
                            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg ml-4">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                <div className="flex flex-col">
                                    <span className="font-bold text-sm">⚠️ {conflicts.count} Conflictos Detectados</span>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogHeader>

                <div className="flex flex-1 overflow-hidden">
                    {/* Main Table Area */}
                    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                        <ScrollArea className="flex-1 bg-white p-6">
                            {Object.keys(groupedResults).length === 0 ? (
                                <div className="text-center py-20 flex flex-col items-center gap-3">
                                    <div className="p-4 bg-gray-100 rounded-full">
                                        <AlertCircle className="w-8 h-8 text-gray-400" />
                                    </div>
                                    <p className="text-gray-500 font-medium text-lg">No hay resultados para mostrar.</p>
                                </div>
                            ) : (
                                <div className="border rounded-lg overflow-hidden shadow-sm">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                                            <tr>
                                                <th className="w-10 px-4 py-3"></th>
                                                <th className="px-4 py-3 font-bold text-gray-600">OT</th>
                                                <th className="px-4 py-3 font-bold text-gray-600">F. Entrada</th>
                                                <th className="px-4 py-3 font-bold text-gray-600">Cliente</th>
                                                <th className="px-4 py-3 font-bold text-gray-600">Código</th>
                                                <th className="px-4 py-3 font-bold text-gray-600">Descripción</th>
                                                <th className="px-4 py-3 font-bold text-gray-600 text-center">Cant.</th>
                                                <th className="px-4 py-3 font-bold text-gray-600 text-center">Material</th>
                                                <th className="px-4 py-3 font-bold text-gray-600 text-center">Entrega</th>
                                                <th className="px-4 py-3 font-bold text-gray-600 text-center">Prioridad</th>
                                                <th className="px-4 py-3 font-bold text-gray-600 text-center">F. Prom.</th>
                                                <th className="px-4 py-3 font-bold text-gray-600 text-center">Alertas</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {Object.entries(groupedResults).map(([ordenIdStr, items]) => {
                                                const ordenId = parseInt(ordenIdStr);
                                                const firstItem = items[0];
                                                const isExpanded = expandedOrderIds.includes(ordenId);

                                                // Specific helper for this row
                                                const rowConflicts = conflicts.details.filter(d => d.ordenId === ordenId);
                                                const hasConflict = rowConflicts.length > 0;
                                                const maxDelay = hasConflict ? Math.max(...rowConflicts.map(d => d.days)) : 0;

                                                const percentage = firstItem.unidades ? ((firstItem.cantidad_entregada || 0) / firstItem.unidades) * 100 : 0;

                                                return (
                                                    <React.Fragment key={ordenId}>
                                                        <tr
                                                            className={`transition-colors cursor-pointer group ${getPriorityColor(firstItem.id_prioridad)}`}
                                                            onClick={() => toggleRow(ordenId)}
                                                        >
                                                            <td className="px-4 py-3">
                                                                <button className="p-1 hover:bg-black/10 rounded transition-colors text-inherit opacity-70 hover:opacity-100">
                                                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                                </button>
                                                            </td>
                                                            <td className="px-4 py-3 font-medium text-inherit">#{ordenId}</td>
                                                            <td className="px-4 py-3 text-inherit opacity-90">{formatDate(firstItem.fecha_entrada)}</td>
                                                            <td className="px-4 py-3 text-gray-500 italic">{firstItem.cliente || "-"}</td>
                                                            <td className="px-4 py-3 font-mono text-xs text-inherit opacity-80">{firstItem.codigo || "-"}</td>
                                                            <td className="px-4 py-3 text-inherit">{firstItem.articulo ? capitalize(firstItem.articulo) : "-"}</td>
                                                            <td className="px-4 py-3 text-center">
                                                                {firstItem.unidades ? <Badge variant="secondary" className="bg-white/50 text-inherit border-current/20">{firstItem.unidades}</Badge> : "-"}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                {firstItem.estado_material === 'sin_stock' ? (
                                                                    <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-200">Sin Stock</Badge>
                                                                ) : firstItem.estado_material === 'pedido' ? (
                                                                    <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100">Pedido</Badge>
                                                                ) : firstItem.estado_material === 'ok' ? (
                                                                    <Badge className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100">OK</Badge>
                                                                ) : (
                                                                    <span className="text-gray-400">-</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                {firstItem.unidades ? (
                                                                    <div className="flex flex-col items-center gap-1">
                                                                        <span className="text-xs font-medium text-gray-600">{firstItem.cantidad_entregada || 0} / {firstItem.unidades}</span>
                                                                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                                            <div className="h-full bg-green-500" style={{ width: `${percentage}%` }} />
                                                                        </div>
                                                                    </div>
                                                                ) : "-"}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                                    {getPriorityLabel(firstItem.id_prioridad, firstItem.prioridad_descripcion)}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-4 py-3 text-center text-inherit opacity-90">{formatDate(firstItem.fecha_prometida)}</td>
                                                            <td className="px-4 py-3 text-center">
                                                                {hasConflict ? (
                                                                    <div className="flex items-center justify-center gap-1 text-red-700 bg-red-100 px-2 py-1 rounded border border-red-200 text-xs font-bold animate-pulse">
                                                                        <AlertTriangle className="w-3 h-3" />
                                                                        +{maxDelay}d
                                                                    </div>
                                                                ) : null}
                                                            </td>
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr className="bg-gray-50/50">
                                                                <td colSpan={12} className="px-0 py-0 border-b shadow-inner">
                                                                    <div className="px-4 py-4 md:px-8 md:py-6 bg-gray-50/50">
                                                                        <div className="text-xs font-semibold uppercase text-gray-400 mb-2 pl-1">Procesos Planificados</div>
                                                                        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                                                            <div className="grid grid-cols-[auto_1fr_200px_200px_180px] gap-0 text-sm">
                                                                                {/* Inner Header */}
                                                                                <div className="contents text-xs font-bold text-gray-500 uppercase bg-gray-100/50">
                                                                                    <div className="px-4 py-2 border-b">#</div>
                                                                                    <div className="px-4 py-2 border-b">Proceso</div>
                                                                                    <div className="px-4 py-2 border-b">Operario</div>
                                                                                    <div className="px-4 py-2 border-b">Maquinaria</div>
                                                                                    <div className="px-4 py-2 border-b">Inicio Estimado</div>
                                                                                </div>

                                                                                {/* Inner Body */}
                                                                                {items.map((item, idx) => {
                                                                                    const effectiveItem = getEffectiveItem(item);

                                                                                    // Is Late Check
                                                                                    let isLate = false;
                                                                                    if (effectiveItem.fecha_fin_estimada && effectiveItem.fecha_prometida) {
                                                                                        if (new Date(effectiveItem.fecha_fin_estimada) > new Date(effectiveItem.fecha_prometida)) isLate = true;
                                                                                    }

                                                                                    return (
                                                                                        <div key={`${item.orden_id}-${item.proceso_id}`} className="contents group/row">
                                                                                            <div className="px-4 py-3 border-b flex items-center text-gray-400 font-mono text-xs">
                                                                                                {idx + 1}
                                                                                            </div>
                                                                                            <div className="px-4 py-3 border-b flex flex-col justify-center">
                                                                                                <span className="font-medium text-gray-800">{capitalize(effectiveItem.nombre_proceso)}</span>
                                                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                                                    <span className="text-xs text-gray-500 bg-gray-100 px-1.5 rounded">{effectiveItem.duracion_min}m</span>
                                                                                                    {isLate && <span className="text-[10px] text-red-600 font-bold flex items-center gap-0.5">⚠️ Retrasado</span>}
                                                                                                </div>
                                                                                            </div>

                                                                                            {/* Operator Select */}
                                                                                            <div className="px-4 py-2 border-b flex items-center">
                                                                                                <Select
                                                                                                    value={effectiveItem.id_operario?.toString() || "0"}
                                                                                                    onValueChange={(val) => handleUpdate(item, 'id_operario', val === "0" ? null : parseInt(val))}
                                                                                                >
                                                                                                    <SelectTrigger className="h-8 text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-100">
                                                                                                        <SelectValue placeholder="Sin asignar" />
                                                                                                    </SelectTrigger>
                                                                                                    <SelectContent>
                                                                                                        <SelectItem value="0" className="text-gray-400 italic">Sin asignar</SelectItem>
                                                                                                        {availableOperators.map(op => {
                                                                                                            const isPruebas = op.sector?.toUpperCase() === 'PRUEBAS';
                                                                                                            return (
                                                                                                                <SelectItem
                                                                                                                    key={op.id}
                                                                                                                    value={op.id.toString()}
                                                                                                                    disabled={!op.disponible && !isPruebas}
                                                                                                                    className={(!op.disponible && !isPruebas) ? "text-gray-400 italic" : ""}
                                                                                                                >
                                                                                                                    {op.nombre} {op.apellido} {(!op.disponible && !isPruebas) && "(Ausente)"}
                                                                                                                </SelectItem>
                                                                                                            );
                                                                                                        })}
                                                                                                    </SelectContent>
                                                                                                </Select>
                                                                                            </div>

                                                                                            {/* Machinery Select */}
                                                                                            <div className="px-4 py-2 border-b flex items-center">
                                                                                                <Select
                                                                                                    value={effectiveItem.id_maquinaria?.toString() || "0"}
                                                                                                    onValueChange={(val) => handleUpdate(item, 'id_maquinaria', val === "0" ? null : parseInt(val))}
                                                                                                >
                                                                                                    <SelectTrigger className="h-8 text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-100">
                                                                                                        <SelectValue placeholder="Sin asignar" />
                                                                                                    </SelectTrigger>
                                                                                                    <SelectContent>
                                                                                                        <SelectItem value="0" className="text-gray-400 italic">Sin asignar</SelectItem>
                                                                                                        {availableMachines.map(m => (
                                                                                                            <SelectItem key={m.id} value={m.id.toString()}>
                                                                                                                {m.nombre}
                                                                                                            </SelectItem>
                                                                                                        ))}
                                                                                                    </SelectContent>
                                                                                                </Select>
                                                                                            </div>

                                                                                            {/* Start Time Input */}
                                                                                            <div className="px-4 py-2 border-b flex items-center">
                                                                                                <Input
                                                                                                    type="datetime-local"
                                                                                                    className="h-8 text-xs px-2 border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-amber-200"
                                                                                                    value={effectiveItem.fecha_inicio_estimada ? effectiveItem.fecha_inicio_estimada.slice(0, 16) : getDateFromMin(effectiveItem.inicio_min)}
                                                                                                    onChange={(e) => handleDateChange(item, e.target.value)}
                                                                                                />
                                                                                            </div>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </ScrollArea>
                    </div>

                    {/* Operator Workload Sidebar */}
                    <div className="w-80 bg-gray-50 border-l border-gray-200 flex flex-col shrink-0">
                        <div className="p-4 border-b border-gray-200 bg-white/50">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                <User className="w-4 h-4 text-gray-500" />
                                Carga de Operarios
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">Estimación basada en la semana de planificación.</p>
                        </div>
                        <ScrollArea className="flex-1 p-4">
                            <div className="space-y-4">
                                {availableOperators
                                    .filter(op => op.sector?.toUpperCase() !== 'PRUEBAS') // Filter 'PRUEBAS' if hidden
                                    .map(op => {
                                        // Calculate Load
                                        const currentLoadMin = operatorLoads[op.id] || 0;
                                        const sessionLoadMin = results
                                            .map(r => getEffectiveItem(r))
                                            .filter(r => r.id_operario === op.id)
                                            .reduce((sum, r) => sum + (r.duracion_min || 0), 0);

                                        const totalLoadMin = currentLoadMin + sessionLoadMin;
                                        const totalLoadHours = (totalLoadMin / 60);

                                        // Assuming 44h weekly capacity
                                        const maxCapacityHours = 44;
                                        const percentage = Math.min((totalLoadHours / maxCapacityHours) * 100, 100);

                                        const isOverloaded = totalLoadHours > maxCapacityHours;

                                        return (
                                            <div key={op.id} className="bg-white p-3 rounded-lg border shadow-sm">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-sm font-medium text-gray-700 truncate">{op.nombre} {op.apellido}</span>
                                                    <span className={cn(
                                                        "text-xs font-bold px-1.5 py-0.5 rounded",
                                                        isOverloaded ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
                                                    )}>
                                                        {Math.round(percentage)}%
                                                    </span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden mb-1.5">
                                                    <div
                                                        className={cn(
                                                            "h-full transition-all duration-500 rounded-full",
                                                            isOverloaded ? "bg-red-500" :
                                                                percentage > 80 ? "bg-amber-500" : "bg-green-500"
                                                        )}
                                                        style={{ width: `${percentage}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between items-center text-xs text-gray-500">
                                                    <span>{totalLoadHours.toFixed(1)}h / {maxCapacityHours}h</span>
                                                    {sessionLoadMin > 0 && (
                                                        <span className="text-blue-600 font-medium">+{Math.round(sessionLoadMin / 60 * 10) / 10}h nuevas</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                    .sort((a, b) => {
                                        // Sort by Total Load DESC
                                        const loadA = (operatorLoads[a.id] || 0) + results.map(r => getEffectiveItem(r)).filter(r => r.id_operario === a.id).reduce((sum, r) => sum + (r.duracion_min || 0), 0);
                                        const loadB = (operatorLoads[b.id] || 0) + results.map(r => getEffectiveItem(r)).filter(r => r.id_operario === b.id).reduce((sum, r) => sum + (r.duracion_min || 0), 0);
                                        return loadB - loadA;
                                    })
                                }
                            </div>
                        </ScrollArea>
                    </div>
                </div>

                <DialogFooter className="p-4 bg-white border-t mt-auto gap-3 shrink-0">
                    <Button variant="outline" onClick={onBack} disabled={isConfirming} className="border-gray-300 text-gray-700 hover:bg-gray-50">
                        Volver
                    </Button>
                    <Button onClick={handleConfirmWithEdits} disabled={isConfirming || results.length === 0} className="bg-blue-600 hover:bg-blue-700 shadow-md px-6">
                        {isConfirming ? (
                            <span className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                Confirmando...
                            </span>
                        ) : (
                            <>Confirmar y Guardar</>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog >
    );
}
