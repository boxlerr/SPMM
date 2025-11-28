import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Activity } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface Operario {
    id: number;
    nombre: string;
    apellido: string;
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
    console.log("TaskDetailsModal rendering. Variant:", variant, "IsOpen:", isOpen);
    const [ordenDetails, setOrdenDetails] = React.useState<any>(null);
    const [isLoadingDetails, setIsLoadingDetails] = React.useState(false);

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
        <div className={`flex flex-col h-full ${variant === "sidebar" ? "bg-white w-full" : ""}`}>
            {/* Header */}
            <div className="bg-white border-b border-gray-100 p-6 flex-shrink-0">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-50 text-red-600">
                            <Activity className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 leading-none mb-1">Detalle del Proceso</h3>
                            <p className="text-sm text-gray-500 font-medium">
                                OT #{selectedItem.orden_id}
                            </p>
                        </div>
                    </div>
                    {variant === "sidebar" && (
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-full transition-all"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-6">
                    {/* Estado - Highlighted */}
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">
                            Estado Actual
                        </label>
                        <Select
                            value={selectedItem.estado || "pendiente"}
                            onValueChange={onStatusChange}
                        >
                            <SelectTrigger className={`w-full h-11 border-0 font-medium shadow-sm ${selectedItem.estado === 'completado' ? 'bg-green-50 text-green-700 ring-1 ring-green-200' :
                                selectedItem.estado === 'en_curso' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' :
                                    'bg-white text-gray-900 ring-1 ring-gray-200'
                                }`}>
                                <SelectValue placeholder="Seleccionar estado" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="pendiente">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-gray-300" />
                                        Pendiente
                                    </div>
                                </SelectItem>
                                <SelectItem value="en_curso">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                                        En Curso
                                    </div>
                                </SelectItem>
                                <SelectItem value="completado">
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
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 transition-colors">
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
                                value={selectedItem.id_operario?.toString() || ""}
                                onValueChange={onOperatorChange}
                            >
                                <SelectTrigger className="w-full h-11 text-sm bg-white border-gray-200 hover:border-gray-300 transition-colors">
                                    <SelectValue placeholder="Seleccionar operario" />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.isArray(operarios) &&
                                        operarios.map((op) => (
                                            <SelectItem key={op.id} value={op.id.toString()}>
                                                {op.nombre} {op.apellido}
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Detalles Grid */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* Maquinaria */}
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                    Maquinaria
                                </label>
                                <div className="p-3 rounded-lg border border-gray-200 bg-gray-50/50">
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
                                <div className="p-3 rounded-lg border border-gray-200 bg-gray-50/50">
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
                        {!isLoadingDetails && ordenDetails?.observaciones && (
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                    Observaciones
                                </label>
                                <div className="text-sm text-gray-700 bg-amber-50 p-4 rounded-lg border border-amber-100 leading-relaxed">
                                    {ordenDetails.observaciones}
                                </div>
                            </div>
                        )}

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
                    </div>
                </div>
            </div>
        </div>
    );

    if (variant === "sidebar") {
        return isOpen ? Content : null;
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px] bg-white rounded-xl shadow-2xl border-0 p-0 overflow-hidden">
                <DialogTitle className="sr-only">Detalle del Proceso</DialogTitle>
                {Content}
            </DialogContent>
        </Dialog>
    );
};

export default TaskDetailsModal;
