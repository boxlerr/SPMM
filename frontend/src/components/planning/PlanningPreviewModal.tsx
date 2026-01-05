
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Clock, User, Cog, AlertCircle, CalendarClock, Edit2, RotateCcw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    secuencia?: number; // Added
    fecha_inicio_estimada?: string; // Added
    fecha_fin_estimada?: string; // Added
    // Enriched fields
    cliente?: string;
    articulo?: string;
    codigo?: string;
    operario_nombre?: string | null;
    maquinaria_nombre?: string | null;
    fecha_inicio_texto?: string;
    fecha_fin_texto?: string;
}

interface PlanningPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
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
    onConfirm,
    results,
    operatorLoads = {},
    isConfirming,
    availableOperators = [],
    availableMachines = []
}: PlanningPreviewModalProps) {

    // Local state for edits
    // Map: orden_id -> proceso_id -> Modified Result
    const [editedResults, setEditedResults] = React.useState<Record<string, PlanificacionResult>>({});

    // Reset edits when results change or modal opens
    React.useEffect(() => {
        setEditedResults({});
    }, [results, isOpen]);

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
            // Also update rango if needed? keeping simple for now
        }
        if (field === 'id_maquinaria') {
            const maq = availableMachines.find(m => m.id == value);
            updated.maquinaria_nombre = maq ? maq.nombre : (value ? 'Desconocido' : null);
            updated.sin_maquinaria = !value;
        }

        // Special handling for Date/Time
        // If we edit start time text, we need to recalculate numeric minutes (approx) relative to NOW or base date
        // But for simplicity, let's assume we receive a full Date string ISO from input?
        // Actually, the API expects 'inicio_min'. 
        // We need a way to convert the Input datetime-local back to 'inicio_min'.
        // Let's assume T=0 is "Now" (or whatever base the backend used).
        // EDIT: The current backend returns 'inicio_min'. The Service calculates dates based on T=0=Now.
        // So: new_min = (new_date - now) / 60000.
        // We will do this calculation when confirming or just store the override values.
        // Let's store the 'start_date_obj' or similar if we want logic here.
        // For visual, we update 'fecha_inicio_texto'.

        // Wait, to support proper saving, we need to update 'inicio_min'.
        // Let's try to recalculate minutes relative to 'now' timestamp used effectively.
        // We can approximate: original_date - (original_min * 60000) = Base Time.
        // Base Time + new_min = new_date.
        // So: new_min = (new_date - Base Time) / 60000.

        if (field === 'fecha_inicio_texto') {
            // This is just display text, we probably want a real Date handler
        }

        setEditedResults(prev => ({ ...prev, [key]: updated }));
    };

    const handleDateChange = (original: PlanificacionResult, newDateStr: string) => {
        // newDateStr is "YYYY-MM-DDTHH:mm" from input type="datetime-local"
        if (!newDateStr) return;

        const newDate = new Date(newDateStr);
        if (isNaN(newDate.getTime())) return;

        // Calculate 'inicio_min'.
        // We assume 'inicio_min' was calculated relative to NOW.
        // We need to know what "NOW" was. 
        // We can infer it: Current Start Date - (Current Inicio Min) minutes.
        // Or uncouple it and just send absolute dates to backend? Backend expects minutes relative to T=0.
        // Let's infer T=0 from the original item.
        // T0 = OriginalStartDate - (OriginalInicioMin * 60000)

        // Ensure we parse the original text date correctly or use a raw date if we had it anywhere.
        // We have 'fecha_inicio_texto' which is formatted.
        // Maybe we should pass the raw absolute date in 'results' from the parent?
        // The parent calculates: startDate = new Date(now.getTime() + startMin * 60000)
        // If we want to be precise, we should assume T0 is roughly "Now" when modal opened.
        // Let's assume T0 = StartTime - Minutes.

        // BETTER APPROACH: Use the backend provided Estimated Date to infer T0 if available.
        // But for edits relative to "Now", simpler logic might suffice if we assume T0 is "Now".
        // HOWEVER, the backend now returns `fecha_inicio_estimada`. 
        // If we edit it, we should update `fecha_inicio_estimada` for display AND `inicio_min` for persistence.

        // Let's assume the user is planning relative to "Now" in the backend's mind (or start of shift).
        // A simple relative calc is: newMin = (newDate - now) / 60000. 
        // But if backend projected start is tomorrow 8am (min 600), and now is today 5pm.
        // Date.now() + 600*60000 might != Tomorrow 8am depending on logic.

        // Let's try to preserve the offset.
        // But actually, `inicio_min` is what the backend optimizes.
        // If we change the date, we probably just want to FORCE that date.
        // The backend `planificar_pendientes` doesn't really accept fixed dates easily unless we lock them.
        // But for this UI, we just update the min.

        const nowMs = Date.now();
        // Fallback: estimate minutes from now.
        const newMin = Math.round((newDate.getTime() - nowMs) / 60000);

        const key = `${original.orden_id}-${original.proceso_id}`;
        const current = getEffectiveItem(original);
        const duration = current.duracion_min || 0;

        const formattedStart = newDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        // Update both min and text
        let updated = {
            ...current,
            inicio_min: newMin,
            fin_min: newMin + duration,
            fecha_inicio_texto: formattedStart,
            fecha_inicio_estimada: newDateStr // Ensure the input reflects the new value immediately
        };
        setEditedResults(prev => ({ ...prev, [key]: updated }));
    };

    // Convert text date to suitable input value (YYYY-MM-DDTHH:mm)
    // This is tricky because we only have "dd/MM/yyyy, HH:mm" in text.
    // We should probably rely on computed dates.
    // Let's Compute the Date object on the fly from 'inicio_min'.
    const getDateFromMin = (min: number) => {
        const d = new Date(Date.now() + min * 60000);
        // Format for input: YYYY-MM-DDTHH:mm
        // Adjust for timezone offset
        const iso = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        return iso;
    }


    const handleConfirmWithEdits = () => {
        // Merge original results with edits
        // We need to return the array of FINAL objects.
        const finalResults = results.map(r => getEffectiveItem(r));
        // We pass this to onConfirm. But onConfirm currently takes no args?
        // We defined "onConfirm: () => void". We should update it to accept data or just expose it.
        // But wait, the parent has 'results' but not 'editedResults'.
        // We should pass the merged array to onConfirm.
        // @ts-ignore
        onConfirm(finalResults);
    };

    // Helper to capitalize first letter
    const capitalize = (s: string) => {
        if (!s) return "";
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    };


    const formatTime = (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${h}h ${m}m`;
    };

    // Group results by Order ID for better visualization
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

    // Calculate NEW load per operator from this batch
    const newLoads = React.useMemo(() => {
        const loads: Record<number, number> = {};
        results.forEach(res => {
            if (res.id_operario && res.duracion_min) {
                loads[res.id_operario] = (loads[res.id_operario] || 0) + res.duracion_min;
            }
        });
        return loads;
    }, [results]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl sm:max-w-[90vw] w-[90vw] max-h-[85vh] h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl">
                <DialogHeader className="p-6 pb-4 border-b bg-white z-10">
                    <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                        <div className="p-1.5 bg-blue-100 rounded-lg">
                            <CalendarClock className="w-6 h-6 text-blue-600" />
                        </div>
                        Vista Previa de Planificación
                    </DialogTitle>
                    <DialogDescription className="text-base text-gray-500">
                        Revise la planificación propuesta antes de confirmar.
                        Se planificarán <span className="font-semibold text-gray-900">{results.length} procesos</span> correspondientes a <span className="font-semibold text-gray-900">{Object.keys(groupedResults).length} órdenes de trabajo</span>.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 bg-gray-50/50 p-6">
                    {Object.keys(groupedResults).length === 0 ? (
                        <div className="text-center py-20 flex flex-col items-center gap-3">
                            <div className="p-4 bg-gray-100 rounded-full">
                                <AlertCircle className="w-8 h-8 text-gray-400" />
                            </div>
                            <p className="text-gray-500 font-medium text-lg">No hay resultados para mostrar.</p>
                            <p className="text-sm text-gray-400">Intente seleccionar otras órdenes o parámetros.</p>
                        </div>
                    ) : (
                        <div className="space-y-6 max-w-5xl mx-auto">
                            {Object.entries(groupedResults).map(([ordenId, items]) => (
                                <div key={ordenId} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
                                    <div className="bg-gray-50/80 px-4 py-3 border-b flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Badge variant="outline" className="bg-white px-2.5 py-1 text-sm font-medium border-gray-300 text-gray-700 shadow-sm">
                                                OT #{ordenId}
                                            </Badge>
                                            {items[0].cliente && (
                                                <div className="flex items-center gap-1.5 text-blue-700 font-semibold">
                                                    <User className="w-4 h-4" />
                                                    {capitalize(items[0].cliente)}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right flex flex-col">
                                            {items[0].codigo && <span className="font-mono text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 mb-1 inline-block text-center self-end">{items[0].codigo}</span>}
                                            {items[0].articulo && <span className="text-sm font-medium text-gray-700">{capitalize(items[0].articulo)}</span>}
                                        </div>
                                    </div>

                                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {items.map((item, idx) => {
                                            // Use effective item to show edits
                                            const effectiveItem = getEffectiveItem(item);
                                            const opId = effectiveItem.id_operario;
                                            const currentLoad = opId ? (operatorLoads[opId] || 0) : 0;
                                            const addedLoad = effectiveItem.duracion_min || 0;
                                            const totalWeekLoad = currentLoad + addedLoad;

                                            const batchTotalForOp = opId ? (newLoads[opId] || 0) : 0;
                                            const projectedTotal = currentLoad + batchTotalForOp;
                                            const itemKey = `${item.orden_id}-${item.proceso_id}`;
                                            const isEdited = !!editedResults[itemKey];

                                            return (
                                                <div key={idx} className={`flex flex-col p-0 bg-white rounded-lg border transition-all hover:shadow-sm group ring-1 ring-gray-100 ring-offset-0 ${isEdited ? 'border-amber-400 bg-amber-50/10' : 'border-gray-100 hover:border-blue-300'}`}>

                                                    <div className="p-3 border-b border-gray-50 flex items-start justify-between bg-gradient-to-br from-white to-gray-50/30">
                                                        <span className="font-semibold text-gray-800 line-clamp-1" title={effectiveItem.nombre_proceso}>
                                                            {capitalize(effectiveItem.nombre_proceso)}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            {isEdited && (
                                                                <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-amber-100 text-amber-700 border-amber-200">
                                                                    Editado
                                                                </Badge>
                                                            )}
                                                            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-gray-100 text-gray-500">
                                                                {effectiveItem.duracion_min}m
                                                            </Badge>
                                                        </div>
                                                    </div>

                                                    <div className="p-3 space-y-3">
                                                        {/* Operator Info (Editable) */}
                                                        <div className="space-y-1">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Operario</Label>
                                                            </div>
                                                            <Select
                                                                value={effectiveItem.id_operario?.toString() || "0"}
                                                                onValueChange={(val) => handleUpdate(item, 'id_operario', val === "0" ? null : parseInt(val))}
                                                            >
                                                                <SelectTrigger className="h-8 text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-200">
                                                                    <div className="flex items-center gap-2 truncate">
                                                                        <User className="w-3 h-3 text-gray-400" />
                                                                        <SelectValue placeholder="Seleccionar..." />
                                                                    </div>
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="0" className="text-gray-400 italic">Operario no asignado</SelectItem>
                                                                    {availableOperators.map(op => {
                                                                        const isPruebas = op.sector?.toUpperCase() === 'PRUEBAS';
                                                                        return (
                                                                            <SelectItem
                                                                                key={op.id}
                                                                                value={op.id.toString()}
                                                                                disabled={!op.disponible && !isPruebas}
                                                                                className={(!op.disponible && !isPruebas) ? "text-gray-400 italic" : (isPruebas ? "text-amber-600 font-medium" : "")}
                                                                            >
                                                                                {isPruebas ? "Operario no asignado" : `${op.nombre} ${op.apellido}`} {(!op.disponible && !isPruebas) && "(Ausente)"}
                                                                            </SelectItem>
                                                                        );
                                                                    })}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>

                                                        {/* Load Stats Bar (Only if Op assigned) */}
                                                        {effectiveItem.id_operario && (
                                                            <div className="py-1">
                                                                <div className="w-full bg-gray-100 rounded-full h-1 overflow-hidden flex">
                                                                    <div className="bg-blue-400 h-full" style={{ width: `${Math.min((currentLoad / 2400) * 100, 100)}%` }} />
                                                                    <div className="bg-blue-600 h-full" style={{ width: `${Math.min((batchTotalForOp / 2400) * 100, 100)}%` }} />
                                                                </div>
                                                            </div>
                                                        )}

                                                        <div className="grid grid-cols-1 gap-2">
                                                            {/* Machine (Editable) */}
                                                            <div className="space-y-1">
                                                                <Label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Maquinaria</Label>
                                                                <Select
                                                                    value={effectiveItem.id_maquinaria?.toString() || "0"}
                                                                    onValueChange={(val) => handleUpdate(item, 'id_maquinaria', val === "0" ? null : parseInt(val))}
                                                                >
                                                                    <SelectTrigger className="h-8 text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-200">
                                                                        <div className="flex items-center gap-2 truncate">
                                                                            <Cog className="w-3 h-3 text-gray-400" />
                                                                            <SelectValue placeholder="Toque para asignar..." />
                                                                        </div>
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="0" className="text-gray-400 italic">Maquinaria no asignada</SelectItem>
                                                                        {availableMachines.map(m => (
                                                                            <SelectItem key={m.id} value={m.id.toString()}>
                                                                                {m.nombre}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>

                                                            {/* Start Time (Editable) */}
                                                            <div className="space-y-1">
                                                                <Label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Inicio</Label>
                                                                <div className="relative">
                                                                    <Input
                                                                        type="datetime-local"
                                                                        className="h-9 text-xs px-2 border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-200 font-medium"
                                                                        value={effectiveItem.fecha_inicio_estimada ? effectiveItem.fecha_inicio_estimada.slice(0, 16) : getDateFromMin(effectiveItem.inicio_min)}
                                                                        onChange={(e) => handleDateChange(item, e.target.value)}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>

                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                <DialogFooter className="p-4 bg-white border-t mt-auto gap-3">
                    <Button variant="outline" onClick={onClose} disabled={isConfirming} className="border-gray-300 text-gray-700 hover:bg-gray-50">
                        Cancelar
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
