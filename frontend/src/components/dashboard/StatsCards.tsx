import { TrendingUp, CheckCircle2, Clock, AlertCircle, XCircle } from "lucide-react"
import { EstadisticasOrdenes } from "./types"

interface StatsCardsProps {
    estadisticas: EstadisticasOrdenes | null
    loading: boolean
    error: string | null
    onStatusClick: (estado: string) => void
}

export default function StatsCards({ estadisticas, loading, error, onStatusClick }: StatsCardsProps) {
    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                <p className="text-red-700">Error al cargar estadísticas: {error}</p>
            </div>
        )
    }

    if (loading || !estadisticas) {
        return (
            <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100/50">
                            <TrendingUp className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-gray-900">Estado de Órdenes</h2>
                            <p className="text-gray-500 text-xs">Resumen general del sistema</p>
                        </div>
                    </div>
                </div>
                <div className="p-6">
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-500"></div>
                    </div>
                </div>
            </section>
        )
    }

    const stats = [
        {
            label: "COMPLETADAS",
            value: estadisticas.completadas,
            percentage: estadisticas.porcentaje_completadas,
            icon: CheckCircle2,
            color: "green",
            bgColor: "bg-green-50",
            textColor: "text-green-600",
            borderColor: "border-green-100",
            progressColor: "bg-green-500",
        },
        {
            label: "EN CURSO",
            value: estadisticas.en_proceso,
            percentage: estadisticas.porcentaje_en_proceso,
            icon: Clock,
            color: "blue",
            bgColor: "bg-blue-50",
            textColor: "text-blue-600",
            borderColor: "border-blue-100",
            progressColor: "bg-blue-500",
        },
        {
            label: "PENDIENTES",
            value: estadisticas.pendientes,
            percentage: estadisticas.porcentaje_pendientes,
            icon: AlertCircle,
            color: "yellow",
            bgColor: "bg-yellow-50",
            textColor: "text-yellow-600",
            borderColor: "border-yellow-100",
            progressColor: "bg-yellow-500",
        },
        {
            label: "RETRASADAS",
            value: estadisticas.retrasadas,
            percentage: estadisticas.porcentaje_retrasadas,
            icon: XCircle,
            color: "red",
            bgColor: "bg-red-50",
            textColor: "text-red-600",
            borderColor: "border-red-100",
            progressColor: "bg-red-500",
        },
    ]

    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100/50">
                        <TrendingUp className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Estado de Órdenes</h2>
                        <p className="text-gray-500 text-xs">Resumen general del sistema</p>
                    </div>
                </div>
            </div>

            <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {stats.map((stat) => {
                        const Icon = stat.icon
                        const statusKey = stat.label.toLowerCase().replace(" ", "_")
                        return (
                            <div
                                key={stat.label}
                                onClick={() => onStatusClick(statusKey)}
                                className={`${stat.bgColor} border ${stat.borderColor} rounded-xl p-4 hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer`}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <div className={`p-2 ${stat.bgColor} ${stat.textColor} rounded-lg border ${stat.borderColor}`}>
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <span className={`text-xs font-semibold ${stat.textColor}`}>{stat.percentage}%</span>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{stat.label}</p>
                                    <p className={`text-3xl font-bold ${stat.textColor}`}>{stat.value}</p>
                                    <div className="h-1.5 bg-white/50 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${stat.progressColor} rounded-full transition-all duration-1000`}
                                            style={{ width: `${stat.percentage}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </section>
    )
}
