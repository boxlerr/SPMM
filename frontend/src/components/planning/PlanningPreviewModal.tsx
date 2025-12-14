
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Clock, User, Cog, AlertCircle } from "lucide-react";

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
    isConfirming: boolean;
}

export function PlanningPreviewModal({ isOpen, onClose, onConfirm, results, isConfirming }: PlanningPreviewModalProps) {

    // Helper to capitalize first letter
    const capitalize = (s: string) => {
        if (!s) return "";
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
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

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl sm:max-w-[90vw] w-[90vw] max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Vista Previa de Planificación</DialogTitle>
                    <DialogDescription>
                        Revise la planificación propuesta antes de confirmar.
                        Se planificarán {results.length} procesos correspondientes a {Object.keys(groupedResults).length} órdenes de trabajo.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 pr-4 mt-4 bg-gray-50/50 rounded-md border p-4">
                    {Object.keys(groupedResults).length === 0 ? (
                        <div className="text-center py-10 text-gray-500">
                            No hay resultados para mostrar.
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {Object.entries(groupedResults).map(([ordenId, items]) => (
                                <div key={ordenId} className="bg-white rounded-lg border shadow-sm p-4">
                                    <h3 className="font-bold text-lg mb-3 flex items-center text-gray-800 justify-between border-b pb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-sm border">OT #{ordenId}</span>
                                            {items[0].cliente && (
                                                <span className="text-blue-700 font-semibold">{capitalize(items[0].cliente)}</span>
                                            )}
                                        </div>
                                        <div className="text-sm text-gray-500 font-normal flex flex-col items-end">
                                            {items[0].codigo && <span className="font-mono text-xs">{items[0].codigo}</span>}
                                            {items[0].articulo && <span className="italic">{capitalize(items[0].articulo)}</span>}
                                        </div>
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {items.map((item, idx) => (
                                            <div key={idx} className="flex flex-col justify-between p-3 bg-gray-50 rounded border border-gray-100 hover:border-blue-200 transition-colors">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="font-semibold text-gray-700 truncate block w-full border-b pb-1">
                                                            {capitalize(item.nombre_proceso)}
                                                        </span>
                                                    </div>

                                                    <div className="space-y-1 text-sm text-gray-600">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-4 h-4 flex items-center justify-center text-gray-400"><User className="w-3 h-3" /></div>
                                                            <span className="font-medium">
                                                                {item.operario_nombre ? capitalize(item.operario_nombre) : (
                                                                    <span className="text-red-500 text-xs px-1 bg-red-50 rounded border border-red-100">Sin Asignar</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-4 h-4 flex items-center justify-center text-gray-400"><Cog className="w-3 h-3" /></div>
                                                            <span>
                                                                {item.maquinaria_nombre ? capitalize(item.maquinaria_nombre) : <span className="text-gray-400 italic">Sin Máquina</span>}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 pt-1 border-t mt-1">
                                                            <div className="w-4 h-4 flex items-center justify-center text-gray-400"><Clock className="w-3 h-3" /></div>
                                                            <span className="text-xs font-mono text-blue-600">
                                                                {item.fecha_inicio_texto} - {item.fecha_fin_texto}
                                                            </span>
                                                            <span className="text-xs text-gray-400 ml-auto">({item.duracion_min}m)</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                <DialogFooter className="mt-4 gap-2">
                    <Button variant="outline" onClick={onClose} disabled={isConfirming}>
                        Cancelar
                    </Button>
                    <Button onClick={onConfirm} disabled={isConfirming || results.length === 0} className="bg-blue-600 hover:bg-blue-700">
                        {isConfirming ? (
                            <>Confirmando...</>
                        ) : (
                            <>Confirmar y Guardar</>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog >
    );
}
