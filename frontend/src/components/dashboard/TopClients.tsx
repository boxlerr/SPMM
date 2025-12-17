
import { Users } from "lucide-react"
import { TopCliente } from "./types"

interface TopClientsProps {
    clientes: TopCliente[]
    loading: boolean
}

export default function TopClients({ clientes, loading }: TopClientsProps) {
    if (loading) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-full">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-indigo-50 rounded-lg">
                        <Users className="h-5 w-5 text-indigo-500" />
                    </div>
                    <div className="h-4 bg-gray-100 rounded w-1/3 animate-pulse"></div>
                </div>
                <div className="space-y-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse"></div>
                    ))}
                </div>
            </div>
        )
    }

    const maxCantidad = Math.max(...clientes.map(c => c.cantidad), 1)

    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden h-full">
            <div className="px-6 py-4 border-b border-gray-50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100/50">
                        <Users className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Top Clientes</h2>
                        <p className="text-gray-500 text-xs">Mayor volumen de órdenes</p>
                    </div>
                </div>
            </div>

            <div className="p-6">
                {!clientes || clientes.length === 0 ? (
                    <div className="text-center py-8">
                        <p className="text-gray-500 text-sm">No hay datos de clientes disponibles</p>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {clientes.map((cliente, idx) => (
                            <div key={idx} className="group">
                                <div className="flex justify-between items-end mb-1">
                                    <span className="text-sm font-medium text-gray-700 truncate max-w-[70%] group-hover:text-indigo-600 transition-colors">
                                        {cliente.cliente}
                                    </span>
                                    <span className="text-sm font-bold text-gray-900">
                                        {cliente.cantidad}
                                    </span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                    <div
                                        className="h-full bg-indigo-500 rounded-full transition-all duration-1000 group-hover:bg-indigo-600"
                                        style={{ width: `${(cliente.cantidad / maxCantidad) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    )
}
