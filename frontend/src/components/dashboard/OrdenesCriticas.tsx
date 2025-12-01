import { AlertTriangle, Clock } from "lucide-react"
import { OrdenCritica } from "./types"

interface OrdenesCriticasProps {
    ordenes: OrdenCritica[]
    loading: boolean
}

export default function OrdenesCriticas({ ordenes, loading }: OrdenesCriticasProps) {
    const getPrioridadColor = (prioridad: string) => {
        switch (prioridad.toLowerCase()) {
            case "urgente":
                return "bg-red-100 text-red-700 border-red-200"
            case "alta":
                return "bg-orange-100 text-orange-700 border-orange-200"
            case "media":
                return "bg-yellow-100 text-yellow-700 border-yellow-200"
            default:
                return "bg-gray-100 text-gray-700 border-gray-200"
        }
    }

    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-50 text-orange-600 rounded-lg border border-orange-100/50">
                        <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Órdenes Críticas</h2>
                        <p className="text-gray-500 text-xs">Próximas a vencer (7 días)</p>
                    </div>
                </div>
            </div>

            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-orange-500"></div>
                    </div>
                ) : !ordenes || ordenes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <div className="p-4 bg-green-50 rounded-full mb-4">
                            <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <p className="text-gray-900 font-medium">Sin órdenes críticas</p>
                        <p className="text-gray-500 text-sm mt-1">Todas las órdenes están bajo control</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {ordenes.map((orden) => (
                            <div
                                key={orden.id}
                                className="p-4 border border-gray-200 rounded-lg hover:border-orange-300 hover:shadow-md transition-all"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-bold text-gray-900">Orden #{orden.id}</span>
                                            <span className={`text-xs px-2 py-0.5 rounded-full border ${getPrioridadColor(orden.prioridad)}`}>
                                                {orden.prioridad}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-600 truncate">{orden.articulo}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-orange-600 bg-orange-50 px-2.5 py-1 rounded-lg border border-orange-100">
                                        <Clock className="h-4 w-4" />
                                        <span className="text-sm font-bold">{orden.dias_restantes}d</span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                    <span>Entrega: {orden.fecha_entrega || "Sin fecha"}</span>
                                    <span className="text-gray-700 font-medium">{orden.estado}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    )
}
