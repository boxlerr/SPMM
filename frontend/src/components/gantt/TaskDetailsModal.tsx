import React, { useState, useEffect } from "react";
import { Activity, AlertCircle, FileText, Image as ImageIcon, Eye, Download } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isOperatorQualified } from "@/lib/gantt-utils";

interface Operario {
    id: number;
    nombre: string;
    apellido: string;
    ranges?: number[];
}

interface PlanificacionItem {
    id: number;
    orden_id: number;
    proceso_id: number;
    nombre_proceso: string;
    inicio_min: number;
    fin_min: number;
    creado_en: string;
    id_operario?: number;
    id_maquinaria?: number;
    nombre_maquinaria?: string;
    nombre_operario?: string;
    apellido_operario?: string;
    fecha_prometida?: string;
    prioridad_peso?: number;
    estado?: string;
    id_estado?: number;
    observaciones_ot?: string;
    observaciones_proceso?: string;
    rangos_permitidos?: number[];
    cliente?: string;
}

// Helper function to capitalize first letter
const capitalizeFirstLetter = (text: string): string => {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

interface TaskDetailsModalProps {
    isOpen: boolean;
    selectedItem: PlanificacionItem | null;
    onClose: () => void;
    getProcessColor: (processName: string) => string;
    operarios: Operario[];
    onOperatorChange: (newOpId: string) => void;
    onStatusChange: (newStatus: string) => void;
    variant?: "modal" | "sidebar";
}

// Helper function to get initials
const getInitials = (nombre?: string, apellido?: string): string => {
    if (!nombre) return "??";
    return `${nombre.charAt(0)}${apellido ? apellido.charAt(0) : ""}`.toUpperCase();
}

const TaskDetailsModal: React.FC<TaskDetailsModalProps> = ({
    isOpen,
    selectedItem,
    onClose,
    getProcessColor,
    operarios,
    onOperatorChange,
    onStatusChange,
    variant = "modal",
}) => {
    const [ordenDetails, setOrdenDetails] = React.useState<any>(null);
    const [isLoadingDetails, setIsLoadingDetails] = React.useState(false);

    // Local state for editable fields
    const [localObservaciones, setLocalObservaciones] = React.useState("");
    const [localStatus, setLocalStatus] = React.useState<string>("1");
    const [localOperator, setLocalOperator] = React.useState<string>("");

    const [isSaving, setIsSaving] = React.useState(false);
    const [showSuccess, setShowSuccess] = React.useState(false);

    // Initialize local state when selectedItem changes
    React.useEffect(() => {
        if (selectedItem) {
            setLocalObservaciones(selectedItem.observaciones_proceso || selectedItem.observaciones_ot || "");
            setLocalStatus(selectedItem.id_estado?.toString() || "1");
            setLocalOperator(selectedItem.id_operario?.toString() || "");
            setShowSuccess(false);
        }
    }, [selectedItem]);

    const handleSaveAll = async () => {
        if (!selectedItem) return;

        setIsSaving(true);
        setShowSuccess(false);

        try {
            // 1. Save Observations if changed
            const currentOriginalObs = selectedItem.observaciones_proceso || selectedItem.observaciones_ot || "";
            if (localObservaciones !== currentOriginalObs) {
                const response = await fetch(`http://localhost:8000/ordenes/${selectedItem.orden_id}/procesos/${selectedItem.proceso_id}/observaciones`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ observaciones: localObservaciones }),
                });

                if (response.ok) {
                    console.log("Observaciones guardadas correctamente");
                    selectedItem.observaciones_proceso = localObservaciones;
                } else {
                    console.error("Error al guardar observaciones");
                }
            }

            // 2. Save Status if changed
            if (localStatus !== (selectedItem.id_estado?.toString() || "1")) {
                onStatusChange(localStatus);
            }

            // 3. Save Operator if changed
            if (localOperator !== (selectedItem.id_operario?.toString() || "")) {
                onOperatorChange(localOperator);
            }

            // Show success animation
            setShowSuccess(true);
            setTimeout(() => {
                setShowSuccess(false);
                onClose(); // Close modal after successful save
            }, 1000);

        } catch (error) {
            console.error("Error al guardar cambios:", error);
        } finally {
            setIsSaving(false);
        }
    };

    // Fetch work order details when selectedItem changes
    React.useEffect(() => {
        const fetchOrdenDetails = async () => {
            if (!selectedItem || (!isOpen && variant === "modal")) {
                setOrdenDetails(null);
                return;
            }

            setIsLoadingDetails(true);
            try {
                const response = await fetch(`http://localhost:8000/ordenes/${selectedItem.orden_id}`);
                if (response.ok) {
                    const data = await response.json();
                    setOrdenDetails(data.data || data);
                }
            } catch (error) {
                console.error("Error fetching orden details:", error);
            } finally {
                setIsLoadingDetails(false);
            }
        };

        fetchOrdenDetails();
    }, [selectedItem?.orden_id, isOpen, variant]);

    if (!selectedItem) return null;

    const Content = (
        <div className={`flex flex-col h-full ${variant === "sidebar" ? "bg-white w-full" : "max-h-[inherit]"}`}>
            {/* Header */}
            <div className="bg-white border-b border-gray-100 p-4 sm:p-6 flex-shrink-0">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-red-50 text-red-600 mt-0.5">
                            <Activity className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-lg font-bold text-gray-900 leading-none mb-1.5">Detalle del Proceso</h3>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-sm text-gray-500 font-medium">
                                <span className="whitespace-nowrap shrink-0">OT #{selectedItem.orden_id}</span>
                                {selectedItem.cliente && (
                                    <>
                                        <span className="hidden sm:inline w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                                        <span className="text-gray-700 font-semibold truncate sm:overflow-visible sm:whitespace-normal" title={selectedItem.cliente}>
                                            {selectedItem.cliente}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                    {variant === "sidebar" && (
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-full transition-all shrink-0"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto min-h-0">
                <div className="p-4 sm:p-6 space-y-6">
                    {/* Estado - Highlighted */}
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">
                            Estado Actual
                        </label>
                        <Select
                            value={localStatus}
                            onValueChange={setLocalStatus}
                        >
                            <SelectTrigger className={`w-full h-12 sm:h-11 border-0 font-medium shadow-sm ${localStatus === "3" ? 'bg-green-50 text-green-700 ring-1 ring-green-200' :
                                localStatus === "2" ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' :
                                    'bg-white text-gray-900 ring-1 ring-gray-200'
                                }`}>
                                <SelectValue placeholder="Seleccionar estado" />
                            </SelectTrigger>
                            <SelectContent className="z-[70]">
                                <SelectItem value="1">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-gray-300" />
                                        Pendiente
                                    </div>
                                </SelectItem>
                                <SelectItem value="2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                                        En Curso
                                    </div>
                                </SelectItem>
                                <SelectItem value="3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-green-500" />
                                        Completado
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                        {/* Proceso */}
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                Proceso
                            </label>
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 transition-colors h-12 sm:h-auto">
                                <div
                                    className="w-3 h-3 rounded-full shadow-sm ring-2 ring-white"
                                    style={{
                                        backgroundColor: getProcessColor(
                                            selectedItem.nombre_proceso || "default"
                                        ),
                                    }}
                                />
                                <span className="text-sm text-gray-900 font-semibold">
                                    {capitalizeFirstLetter(selectedItem.nombre_proceso)}
                                </span>
                            </div>
                        </div>

                        {/* Operario */}
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                Operario Asignado
                            </label>
                            <Select
                                value={localOperator}
                                onValueChange={setLocalOperator}
                            >
                                <SelectTrigger className="w-full h-12 text-sm bg-white border-gray-200 hover:border-gray-300 transition-colors">
                                    <SelectValue placeholder="Seleccionar operario">
                                        {localOperator && (
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-[#DC143C] text-white flex items-center justify-center text-xs font-bold shadow-sm">
                                                    {getInitials(
                                                        operarios.find(op => op.id.toString() === localOperator)?.nombre,
                                                        operarios.find(op => op.id.toString() === localOperator)?.apellido
                                                    )}
                                                </div>
                                                <span className="font-medium text-gray-900">
                                                    {capitalizeFirstLetter(operarios.find(op => op.id.toString() === localOperator)?.nombre || "")} {capitalizeFirstLetter(operarios.find(op => op.id.toString() === localOperator)?.apellido || "")}
                                                </span>
                                            </div>
                                        )}
                                        {!localOperator && <span className="text-gray-500">Seleccionar operario</span>}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent className="z-[70]">
                                    {Array.isArray(operarios) &&
                                        operarios.map((op: any) => {
                                            // Handle both 'ranges' (frontend type) and 'rangos' (backend response)
                                            const opRanges = op.ranges || (op.rangos ? op.rangos.map((r: any) => typeof r === 'object' ? r.id : r) : []);
                                            const isQualified = isOperatorQualified(opRanges, selectedItem.rangos_permitidos || []);

                                            return (
                                                <SelectItem
                                                    key={op.id}
                                                    value={op.id.toString()}
                                                    disabled={!isQualified}
                                                    className={!isQualified ? "opacity-50 cursor-not-allowed bg-gray-50" : ""}
                                                >
                                                    <div className="flex items-center justify-between w-full gap-2">
                                                        <span>{op.nombre} {op.apellido}</span>
                                                        {!isQualified && (
                                                            <TooltipProvider>
                                                                <Tooltip delayDuration={0}>
                                                                    <TooltipTrigger asChild>
                                                                        <div className="p-1">
                                                                            <AlertCircle className="w-4 h-4 text-gray-400" />
                                                                        </div>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent className="z-[80] bg-red-50 text-red-600 border-red-100">
                                                                        <p>No tiene la capacidad para realizar este proceso</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )}
                                                    </div>
                                                </SelectItem>
                                            );
                                        })}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Detalles Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Maquinaria */}
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                    Maquinaria
                                </label>
                                <div className="p-3 rounded-lg border border-gray-200 bg-gray-50/50 h-12 flex items-center">
                                    <span className="text-sm text-gray-700 font-medium">
                                        {selectedItem.nombre_maquinaria || "Sin asignar"}
                                    </span>
                                </div>
                            </div>

                            {/* Duración */}
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                    Duración Est.
                                </label>
                                <div className="p-3 rounded-lg border border-gray-200 bg-gray-50/50 h-12 flex items-center">
                                    <span className="text-sm text-gray-700 font-medium">
                                        {selectedItem.fin_min - selectedItem.inicio_min} min
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Artículo */}
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                Artículo
                            </label>
                            <div className="p-4 rounded-lg border border-gray-200 bg-white">
                                {isLoadingDetails ? (
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                                        <span className="text-xs">Cargando detalles...</span>
                                    </div>
                                ) : ordenDetails?.articulo ? (
                                    <div>
                                        <div className="font-semibold text-gray-900 text-sm leading-snug mb-1">
                                            {ordenDetails.articulo.descripcion}
                                        </div>
                                        <div className="text-xs text-gray-500 font-mono bg-gray-100 inline-block px-2 py-0.5 rounded">
                                            {ordenDetails.articulo.cod_articulo}
                                        </div>
                                    </div>
                                ) : (
                                    <span className="text-gray-400 text-sm italic">Sin información del artículo</span>
                                )}
                            </div>
                        </div>

                        {/* Observaciones */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">
                                    Observaciones
                                </label>
                            </div>
                            <div className="relative">
                                <textarea
                                    className="w-full text-sm text-gray-700 bg-amber-50 p-4 rounded-lg border border-amber-100 focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none resize-none min-h-[120px] transition-all duration-200"
                                    placeholder="Agregar observaciones..."
                                    value={localObservaciones}
                                    onChange={(e) => setLocalObservaciones(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Archivos Adjuntos (Mock) */}
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">
                                Archivos Adjuntos
                            </label>
                            <div className="space-y-3">
                                {/* Mock File 1: Image */}
                                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-white hover:border-blue-300 transition-all group">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 text-blue-600">
                                            <ImageIcon className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm font-medium text-gray-900 truncate">plano_pieza_v2.png</span>
                                            <span className="text-xs text-gray-500">2.4 MB • 12/05/2024</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors" title="Ver archivo">
                                            <Eye className="w-4 h-4" />
                                        </button>
                                        <button className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-full transition-colors" title="Descargar">
                                            <Download className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Mock File 2: PDF */}
                                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-white hover:border-red-300 transition-all group">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0 text-red-600">
                                            <FileText className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm font-medium text-gray-900 truncate">especificaciones_tecnicas.pdf</span>
                                            <span className="text-xs text-gray-500">1.8 MB • 10/05/2024</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors" title="Ver archivo">
                                            <Eye className="w-4 h-4" />
                                        </button>
                                        <button className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-full transition-colors" title="Descargar">
                                            <Download className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Fecha Prometida */}
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                Fecha Prometida
                            </label>
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                                {selectedItem.fecha_prometida || "No definida"}
                            </div>
                        </div>
                    </div >
                </div >
            </div >

            {/* Footer with Save Button */}
            <div className="bg-white border-t border-gray-100 p-4 sm:p-6 flex-shrink-0 sticky bottom-0 z-10">
                <button
                    onClick={handleSaveAll}
                    disabled={isSaving}
                    className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-white shadow-lg transition-all duration-300 active:scale-[0.98]
                        ${isSaving
                            ? "bg-gray-400 cursor-wait"
                            : showSuccess
                                ? "bg-green-500 hover:bg-green-600"
                                : "bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 hover:shadow-blue-200 hover:-translate-y-0.5"
                        }
                    `}
                >
                    {isSaving ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>Guardando...</span>
                        </>
                    ) : showSuccess ? (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            <span>¡Guardado!</span>
                        </>
                    ) : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                            <span>Guardar Cambios</span>
                        </>
                    )}
                </button>
            </div>
        </div >
    );

    if (variant === "sidebar") {
        return isOpen ? Content : null;
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[95vw] sm:w-full sm:max-w-[500px] max-h-[90vh] h-[90vh] flex flex-col bg-white rounded-xl shadow-2xl border-0 p-0 overflow-hidden">
                <DialogTitle className="sr-only">Detalle del Proceso</DialogTitle>
                {Content}
            </DialogContent>
        </Dialog>
    );
};

export default TaskDetailsModal;
