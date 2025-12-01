import React from "react"
import { OrdenEstado } from "./types"

interface StatusOrdersModalProps {
    isOpen: boolean
    onClose: () => void
    selectedStatus: string | null
    statusOrders: OrdenEstado[]
    loading: boolean
}

export default function StatusOrdersModal({
    isOpen,
    onClose,
    selectedStatus,
    statusOrders,
    loading,
}: StatusOrdersModalProps) {
    if (!isOpen) return null

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case "completadas":
                return "from-green-50 to-emerald-50"
            case "en_proceso":
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
                return "En Proceso"
            case "retrasadas":
                return "Retrasadas"
            case "pendientes":
                return "Pendientes"
            default:
                return status
        }
    }

    return (
        <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-300"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r ${getStatusColor(selectedStatus || "")}`}>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Órdenes {getStatusLabel(selectedStatus || "")}</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            {statusOrders.length} {statusOrders.length === 1 ? "orden encontrada" : "órdenes encontradas"}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white rounded-lg transition-colors">
                        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-500"></div>
                        </div>
                    ) : !statusOrders || statusOrders.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-gray-500">No hay órdenes en este estado</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {statusOrders.map((orden) => (
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
                                            <p className="text-sm text-gray-900 truncate" title={orden.articulo}>
                                                {orden.articulo}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Fecha</p>
                                            <p className="text-sm text-gray-900">{orden.fecha_entrega || "Sin fecha"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Estado</p>
                                            <p className="text-sm text-gray-900">{orden.estado}</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 pt-3 border-t border-gray-100">
                                        <div>
                                            <p className="text-xs text-gray-500 font-semibold uppercase">Sector</p>
                                            <p className="text-sm text-gray-900">{orden.sector}</p>
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
