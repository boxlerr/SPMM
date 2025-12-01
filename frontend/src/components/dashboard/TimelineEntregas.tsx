import { Calendar, Package } from "lucide-react"
import { TimelineItem } from "./types"

interface TimelineEntregasProps {
    timeline: TimelineItem[]
    loading: boolean
}

export default function TimelineEntregas({ timeline, loading }: TimelineEntregasProps) {
    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-teal-50 text-teal-600 rounded-lg border border-teal-100/50">
                        <Calendar className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Timeline de Entregas</h2>
                        <p className="text-gray-500 text-xs">Próximas 7 días</p>
                    </div>
                </div>
            </div>

            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-teal-500"></div>
                    </div>
                ) : !timeline || timeline.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="p-4 bg-gray-50 rounded-full mb-4 inline-block">
                            <Calendar className="w-12 h-12 text-gray-400" />
                        </div>
                        <p className="text-gray-900 font-medium">No hay entregas programadas</p>
                        <p className="text-gray-500 text-sm mt-1">No se encontraron órdenes para los próximos 7 días</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {timeline.map((item, idx) => (
                            <div
                                key={idx}
                                className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:border-teal-300 hover:shadow-md transition-all"
                            >
                                <div className="flex-shrink-0">
                                    <div className="p-3 bg-teal-50 text-teal-600 rounded-lg border border-teal-100">
                                        <Calendar className="h-6 w-6" />
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <p className="text-sm font-bold text-gray-900">{item.fecha}</p>
                                        <div className="flex items-center gap-2 bg-teal-50 px-3 py-1 rounded-full border border-teal-100">
                                            <Package className="h-4 w-4 text-teal-600" />
                                            <span className="text-sm font-bold text-teal-600">{item.ordenes} órdenes</span>
                                        </div>
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
