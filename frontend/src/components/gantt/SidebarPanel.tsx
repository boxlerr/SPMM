import React from "react";
import { Activity, X } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { API_URL } from "@/config";

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
                const response = await fetch(`${API_URL}/ordenes/${selectedItem.orden_id}`);
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
        <div
            className={`
                fixed right-0 top-0 bottom-0 w-64 md:w-80 bg-white/95 backdrop-blur-md
                border-l border-gray-300 flex flex-col z-50
                transform transition-all duration-300 ease-out
                shadow-[-8px_0_24px_-8px_rgba(0,0,0,0.15)]
                ${isOpen ? 'translate-x-0' : 'translate-x-full'}
            `}
        >
            {/* Header del panel con branding rojo */}
            <div className="relative bg-gradient-to-r from-[#DC143C] to-[#B8112E] p-4 text-white shadow-lg">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                            <Activity className="h-4 w-4 text-white" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold tracking-tight">Detalle</h2>
                            <p className="text-xs text-white/90 font-medium">
                                OT #{selectedItem.orden_id}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white/90 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/20 active:bg-white/30"
                        title="Cerrar panel"
                        aria-label="Cerrar panel"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Contenido del panel */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                    {/* Proceso */}
                    <div>
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">
                            Proceso
                        </label>
                        <div className="flex items-center gap-2.5 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                            <div
                                className="w-4 h-4 rounded-full flex-shrink-0 shadow-sm"
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

                    {/* Orden de Trabajo */}
                    <div>
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">
                            Orden de Trabajo
                        </label>
                        <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                            <span className="text-sm text-gray-900 font-semibold">
                                #{selectedItem.orden_id}
                            </span>
                        </div>
                    </div>

                    {/* Operario */}
                    <div>
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">
                            Operario
                        </label>
                        <Select
                            value={selectedItem.id_operario?.toString() || ""}
                            onValueChange={onOperatorChange}
                        >
                            <SelectTrigger className="w-full h-10 text-sm">
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
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">
                            Maquinaria
                        </label>
                        <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                            <span className="text-sm text-gray-900">
                                {selectedItem.nombre_maquinaria || "Sin asignar"}
                            </span>
                        </div>
                    </div>

                    {/* Duración */}
                    <div>
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">
                            Duración
                        </label>
                        <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                            <span className="text-sm text-gray-900 font-semibold">
                                {selectedItem.fin_min - selectedItem.inicio_min} minutos
                            </span>
                        </div>
                    </div>

                    {/* Artículo */}
                    <div>                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">
                        Artículo
                    </label>
                        <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200 min-h-[50px]">
                            {isLoadingDetails ? (
                                <span className="text-gray-400 text-xs">Cargando...</span>
                            ) : ordenDetails?.articulo ? (
                                <>
                                    <div className="font-semibold text-gray-900 text-sm leading-snug">
                                        {ordenDetails.articulo.descripcion}
                                    </div>
                                    <div className="text-xs text-gray-600 mt-1 font-medium">
                                        Código: {ordenDetails.articulo.cod_articulo}
                                    </div>
                                </>
                            ) : (
                                <span className="text-gray-500 text-xs">Sin información</span>
                            )}
                        </div>
                    </div>

                    {/* Observaciones */}
                    {!isLoadingDetails && ordenDetails?.observaciones && (
                        <div>
                            <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">
                                Observaciones
                            </label>
                            <div className="text-xs text-gray-900 bg-amber-50 p-2.5 rounded-lg border border-amber-200 leading-relaxed">
                                {ordenDetails.observaciones}
                            </div>
                        </div>
                    )}

                    {/* Fecha Prometida */}
                    <div>
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">
                            Fecha Prometida
                        </label>
                        <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                            <span className="text-sm text-gray-900 font-semibold">
                                {selectedItem.fecha_prometida || "N/A"}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SidebarPanel;
