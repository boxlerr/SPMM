
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Clock, User, Cog, AlertCircle, CalendarClock } from "lucide-react";

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
}

export function PlanningPreviewModal({ isOpen, onClose, onConfirm, results, operatorLoads = {}, isConfirming }: PlanningPreviewModalProps) {

    // Helper to capitalize first letter
    const capitalize = (s: string) => {
        if (!s) return "";
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    };

    // Helper to format minutes to HM
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

                                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {items.map((item, idx) => {
                                            const opId = item.id_operario;
                                            const currentLoad = opId ? (operatorLoads[opId] || 0) : 0;
                                            const addedLoad = item.duracion_min || 0;
                                            const totalWeekLoad = currentLoad + addedLoad; // Note: this is strictly current item + pre-existing, not accounting for other items in this batch for the SAME operator, but good enough for item context.

                                            // Actually, to show TOTAL projected load, we should sum current + ALL new items for this operator.
                                            // Let's keep it simple: Current Pre-existing + This Batch Total.
                                            const batchTotalForOp = opId ? (newLoads[opId] || 0) : 0;
                                            const projectedTotal = currentLoad + batchTotalForOp;

                                            return (
                                                <div key={idx} className="flex flex-col p-0 bg-white rounded-lg border border-gray-100 hover:border-blue-300 transition-all hover:shadow-sm group ring-1 ring-gray-100 ring-offset-0">

                                                    <div className="p-3 border-b border-gray-50 flex items-start justify-between bg-gradient-to-br from-white to-gray-50/30">
                                                        <span className="font-semibold text-gray-800 line-clamp-1" title={item.nombre_proceso}>
                                                            {capitalize(item.nombre_proceso)}
                                                        </span>
                                                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-gray-100 text-gray-500">
                                                            {item.duracion_min}m
                                                        </Badge>
                                                    </div>

                                                    <div className="p-3 space-y-3">
                                                        {/* Operator Info with Load Stats */}
                                                        <div className="bg-blue-50/50 rounded-md p-2 border border-blue-100/50">
                                                            <div className="flex items-center gap-2 mb-1.5">
                                                                <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                                                    <User className="w-3 h-3" />
                                                                </div>
                                                                <span className="font-medium text-sm text-gray-900">
                                                                    {item.operario_nombre ? capitalize(item.operario_nombre) : (
                                                                        <span className="text-red-500 text-xs font-semibold">Sin Asignar</span>
                                                                    )}
                                                                </span>
                                                            </div>

                                                            {/* Load Stats Bar */}
                                                            {item.id_operario && (
                                                                <div className="space-y-1">
                                                                    <div className="flex justify-between text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                                                                        <span>Carga Semanal</span>
                                                                        <span>{formatTime(projectedTotal)} total</span>
                                                                    </div>
                                                                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden flex">
                                                                        {/* Existing Load */}
                                                                        <div
                                                                            className="bg-gray-400 h-full"
                                                                            style={{ width: `${Math.min((currentLoad / (40 * 60)) * 100, 100)}%` }}
                                                                            title={`Previa: ${formatTime(currentLoad)}`}
                                                                        />
                                                                        {/* New Load (Batch) */}
                                                                        <div
                                                                            className="bg-blue-500 h-full relative"
                                                                            style={{ width: `${Math.min((batchTotalForOp / (40 * 60)) * 100, 100)}%` }}
                                                                            title={`Nueva: ${formatTime(batchTotalForOp)}`}
                                                                        >
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex justify-between text-[10px] text-gray-400">
                                                                        <span>Previa: {formatTime(currentLoad)}</span>
                                                                        <span className="text-blue-600 font-medium">+{formatTime(batchTotalForOp)}</span>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Machine & Time */}
                                                        <div className="flex items-center justify-between text-sm">
                                                            <div className="flex items-center gap-1.5 text-gray-600" title="Maquinaria">
                                                                <Cog className="w-3.5 h-3.5 text-gray-400" />
                                                                <span className="text-xs truncate max-w-[100px]">
                                                                    {item.maquinaria_nombre ? capitalize(item.maquinaria_nombre) : <span className="text-gray-400 italic">--</span>}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                                                                <Clock className="w-3 h-3" />
                                                                <span className="text-xs font-medium font-mono">
                                                                    {item.fecha_inicio_texto}
                                                                </span>
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
                    <Button onClick={onConfirm} disabled={isConfirming || results.length === 0} className="bg-blue-600 hover:bg-blue-700 shadow-md px-6">
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
