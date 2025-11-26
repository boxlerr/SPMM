import React from "react";
import { Activity, X } from "lucide-react";
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
}

// Helper function to capitalize first letter
const capitalizeFirstLetter = (text: string): string => {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

interface SidebarPanelProps {
    isOpen: boolean;
    selectedItem: PlanificacionItem | null;
    onClose: () => void;
    getProcessColor: (processName: string) => string;
    operarios: Operario[];
    onOperatorChange: (newOpId: string) => void;
}

const SidebarPanel: React.FC<SidebarPanelProps> = ({
    isOpen,
    selectedItem,
    onClose,
    getProcessColor,
    operarios,
    onOperatorChange,
}) => {
    const [ordenDetails, setOrdenDetails] = React.useState<any>(null);
    const [isLoadingDetails, setIsLoadingDetails] = React.useState(false);

    // Fetch work order details when selectedItem changes
    React.useEffect(() => {
        const fetchOrdenDetails = async () => {
            if (!selectedItem || !isOpen) {
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
    }, [selectedItem?.orden_id, isOpen]);

    if (!isOpen || !selectedItem) return null;

    return (
        <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-2xl z-50 border-l border-gray-200 flex flex-col transform transition-transform duration-300 ease-in-out">
            {/* Header del panel con branding rojo */}
            <div className="relative bg-gradient-to-r from-[#DC143C] to-[#B8112E] p-4 text-white">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                            <Activity className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">Detalle de Planificación</h2>
                            <p className="text-xs text-white/80 mt-0.5">
                                OT #{selectedItem.orden_id}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/20"
                        title="Cerrar panel"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Contenido del panel */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                    {/* Proceso */}
                    <div>
                        <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                            Proceso
                        </label>
                        <div className="flex items-center gap-2">
                            <div
                                className="w-4 h-4 rounded-full flex-shrink-0"
                                style={{
                                    backgroundColor: getProcessColor(
                                        selectedItem.nombre_proceso || "default"
                                    ),
                                }}
                            />
                            <span className="text-base text-gray-900 font-medium">
                                {capitalizeFirstLetter(selectedItem.nombre_proceso)}
                            </span>
                        </div>
                    </div>

                    {/* Orden de Trabajo */}
                    <div>
                        <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                            Orden de Trabajo
                        </label>
                        <span className="text-base text-gray-900 font-medium">
                            #{selectedItem.orden_id}
                        </span>
                    </div>

                    {/* Operario */}
                    <div>
                        <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                            Operario
                        </label>
                        <Select
                            value={selectedItem.id_operario?.toString() || ""}
                            onValueChange={onOperatorChange}
                        >
                            <SelectTrigger className="w-full">
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

                    {/* Maquinaria */}
                    <div>
                        <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                            Maquinaria
                        </label>
                        <span className="text-base text-gray-900">
                            {selectedItem.nombre_maquinaria || "Sin asignar"}
                        </span>
                    </div>

                    {/* Duración */}
                    <div>
                        <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                            Duración
                        </label>
                        <span className="text-base text-gray-900">
                            {selectedItem.fin_min - selectedItem.inicio_min} minutos
                        </span>
                    </div>

                    {/* Artículo */}
                    <div>
                        <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                            Artículo
                        </label>
                        <div className="text-base text-gray-900">
                            {isLoadingDetails ? (
                                <span className="text-gray-400">Cargando...</span>
                            ) : ordenDetails?.articulo ? (
                                <>
                                    <div className="font-medium">{ordenDetails.articulo.descripcion}</div>
                                    <div className="text-sm text-gray-500 mt-1">
                                        {ordenDetails.articulo.cod_articulo}
                                    </div>
                                </>
                            ) : (
                                "Sin información"
                            )}
                        </div>
                    </div>

                    {/* Observaciones */}
                    {!isLoadingDetails && ordenDetails?.observaciones && (
                        <div>
                            <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                                Observaciones
                            </label>
                            <div className="text-base text-gray-900 bg-gray-50 p-3 rounded-lg border border-gray-200">
                                {ordenDetails.observaciones}
                            </div>
                        </div>
                    )}

                    {/* Fecha Prometida */}
                    <div>
                        <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                            Fecha Prometida
                        </label>
                        <span className="text-base text-gray-900">
                            {selectedItem.fecha_prometida || "N/A"}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SidebarPanel;
