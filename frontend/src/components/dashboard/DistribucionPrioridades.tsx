import { BarChart2 } from "lucide-react"
import { DistribucionPrioridad } from "./types"

interface DistribucionPrioridadesProps {
    prioridades: DistribucionPrioridad[]
    loading: boolean
    onPriorityClick: (prioridad: string) => void
}

const getPriorityColor = (prioridad: string) => {
    switch (prioridad.toLowerCase()) {
        case "urgente":
            return "bg-red-500"
        case "urgente 1":
            return "bg-red-600"
        case "alta":
            return "bg-orange-500"
        case "media":
            return "bg-yellow-500"
        case "baja":
            return "bg-green-500"
        default:
            return "bg-gray-500"
    }
}

export default function DistribucionPrioridades({
    prioridades,
    loading,
    onPriorityClick,
}: DistribucionPrioridadesProps) {
    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100/50">
                        <BarChart2 className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Prioridades</h2>
                        <p className="text-gray-500 text-xs">Click para ver órdenes</p>
                    </div>
                </div>
            </div>
            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-500"></div>
                    </div>
                ) : !prioridades || prioridades.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No hay datos</div>
                ) : (
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {prioridades.map((item) => (
                            <div
                                key={item.prioridad}
                                onClick={() => onPriorityClick(item.prioridad)}
                                className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                            >
                                <div className={`p-2 ${getPriorityColor(item.prioridad)} text-white rounded-lg mt-1`}>
                                    <BarChart2 className="h-4 w-4" />
                                </div>
                                <div className="flex-1 space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-bold text-gray-900">{item.prioridad}</span>
                                        <div className="text-right">
                                            <span className="block font-bold text-blue-600">{item.porcentaje}%</span>
                                            <span className="text-xs text-gray-500">{item.cantidad} órdenes</span>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${getPriorityColor(item.prioridad)} rounded-full transition-all duration-1000`}
                                            style={{ width: `${item.porcentaje}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    )
}
