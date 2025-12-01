import { Clock } from "lucide-react"
import { TiempoPromedio } from "./types"

interface AverageTimeProps {
    tiempoPromedio: TiempoPromedio | null
    loading: boolean
}

export default function AverageTime({ tiempoPromedio, loading }: AverageTimeProps) {
    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-50 text-orange-600 rounded-lg border border-orange-100/50">
                        <Clock className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Tiempo Promedio</h2>
                        <p className="text-gray-500 text-xs">De producción</p>
                    </div>
                </div>
            </div>
            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-orange-500"></div>
                    </div>
                ) : !tiempoPromedio ? (
                    <div className="text-center py-8 text-gray-500">No hay datos</div>
                ) : (
                    <div className="flex items-center justify-center py-8">
                        <div className="text-center">
                            <div className="text-4xl font-bold text-orange-600">
                                {tiempoPromedio.dias}d {tiempoPromedio.horas}h
                            </div>
                            <p className="text-sm text-gray-500 mt-2">Tiempo promedio de producción</p>
                        </div>
                    </div>
                )}
            </div>
        </section>
    )
}
