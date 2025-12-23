import React from "react"
import { OrdenEstado } from "./types"

interface StatusOrdersModalProps {
    isOpen: boolean
    onClose: () => void
    selectedStatus: string | null
    statusOrders: OrdenEstado[]
    loading: boolean
    title?: string
}

export default function StatusOrdersModal({
    isOpen,
    onClose,
    selectedStatus,
    statusOrders,
    loading,
    title,
}: StatusOrdersModalProps) {
    if (!isOpen) return null

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case "completadas":
                return "from-green-50 to-emerald-50"
            case "en_proceso":
            case "en_curso":
                return "from-blue-50 to-indigo-50"
            case "retrasadas":
                return "from-red-50 to-rose-50"
            case "pendientes":
                return "from-yellow-50 to-amber-50"
            default:
                return "from-gray-50 to-slate-50"
        }
    }

    const getStatusLabel = (status: string) => {
        switch (status.toLowerCase()) {
            case "completadas":
                return "Completadas"
            case "en_proceso":
            case "en_curso":
                return "En Curso"
            case "retrasadas":
                return "Retrasadas"
            case "pendientes":
                return "Pendientes"
            default:
                return status
        }
    }

    const [searchTerm, setSearchTerm] = React.useState("")

    const safeOrders = statusOrders || []
    const filteredOrders = safeOrders.filter(orden =>
        orden.id.toString().includes(searchTerm) ||
        orden.articulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        orden.sector.toLowerCase().includes(searchTerm.toLowerCase()) ||
        orden.prioridad.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-300"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r ${getStatusColor(selectedStatus || "")}`}>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">{title || `Órdenes ${getStatusLabel(selectedStatus || "")}`}</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            {filteredOrders.length} {filteredOrders.length === 1 ? "orden encontrada" : "órdenes encontradas"}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white rounded-lg transition-colors">
                        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Search Bar */}
                <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Buscar por ID, artículo, sector..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                        <svg className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-500"></div>
                        </div>
                    ) : !filteredOrders || filteredOrders.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-gray-500">No hay órdenes que coincidan con la búsqueda</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredOrders.map((orden) => (
                                <div
                                    key={orden.id}
                                    className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all"
                                >
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Orden #</p>
                                            <p className="text-sm font-bold text-gray-900">{orden.id}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Artículo</p>
                                            <p className="text-sm text-gray-900" title={orden.articulo}>
                                                {orden.articulo}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Fecha</p>
                                            <p className="text-sm text-gray-900">{orden.fecha_entrega || "Sin fecha"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Estado</p>
                                            <p className="text-sm text-gray-900">
                                                {orden.estado === "Completada" && selectedStatus?.toLowerCase().includes("curso")
                                                    ? "En Curso (Reabierta)"
                                                    : orden.estado}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Process Info for En Curso */}
                                    {(orden.proceso_actual || orden.procesos_totales !== undefined) && (
                                        <div className="mt-3 pt-3 border-t border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 -mx-4 px-4 py-3">
                                            <div className="flex items-center justify-between mb-2">
                                                {orden.proceso_actual && (
                                                    <div className="flex-1 pr-4">
                                                        <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-0.5">Proceso Actual</p>
                                                        <p className="text-sm font-bold text-gray-800 truncate">{orden.proceso_actual}</p>
                                                    </div>
                                                )}
                                                {orden.procesos_totales !== undefined && (
                                                    <div className="text-right flex-shrink-0">
                                                        <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-0.5">Progreso</p>
                                                        <p className="text-sm font-medium text-gray-700">
                                                            {orden.procesos_pendientes === 0
                                                                ? <span className="text-emerald-600 font-bold flex items-center gap-1">
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                                    Finalizando
                                                                </span>
                                                                : <span className="tabular-nums">
                                                                    {orden.procesos_totales - (orden.procesos_pendientes || 0)} <span className="text-gray-400">/</span> {orden.procesos_totales}
                                                                </span>}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Progress Bar */}
                                            {orden.procesos_totales !== undefined && orden.procesos_totales > 0 && (
                                                <div className="w-full bg-blue-200/50 rounded-full h-1.5 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-500 ease-out ${orden.procesos_pendientes === 0
                                                            ? "bg-emerald-500"
                                                            : "bg-gradient-to-r from-blue-500 to-indigo-600"
                                                            }`}
                                                        style={{
                                                            width: `${Math.max(5, Math.min(100, ((orden.procesos_totales - (orden.procesos_pendientes || 0)) / orden.procesos_totales) * 100))}%`
                                                        }}
                                                    ></div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 pt-3 border-t border-gray-100">
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Cliente</p>
                                            <p className="text-sm text-gray-900 font-medium">{orden.cliente}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Prioridad</p>
                                            <p className="text-sm text-gray-900">{orden.prioridad}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Cantidad</p>
                                            <p className="text-sm text-gray-900">{orden.cantidad} unidades</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
