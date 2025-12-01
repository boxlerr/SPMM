import { Server, Database, Wifi } from "lucide-react"
import { useState, useEffect } from "react"

interface SystemStatusProps {
    apiUrl: string
}

export default function SystemStatus({ apiUrl }: SystemStatusProps) {
    const [backendStatus, setBackendStatus] = useState<"online" | "offline" | "checking">("checking")

    useEffect(() => {
        const checkBackend = async () => {
            try {
                const response = await fetch(`${apiUrl}/health`, { method: "GET" })
                setBackendStatus(response.ok ? "online" : "offline")
            } catch {
                setBackendStatus("offline")
            }
        }
        checkBackend()
        const interval = setInterval(checkBackend, 30000) // Check every 30 seconds
        return () => clearInterval(interval)
    }, [apiUrl])

    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-50 text-gray-600 rounded-lg border border-gray-100/50">
                        <Server className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Estado del Sistema</h2>
                        <p className="text-gray-500 text-xs">Información del backend</p>
                    </div>
                </div>
            </div>

            <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Backend Status */}
                    <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-100">
                        <div
                            className={`p-2 rounded-lg ${backendStatus === "online"
                                    ? "bg-green-100 text-green-600"
                                    : backendStatus === "offline"
                                        ? "bg-red-100 text-red-600"
                                        : "bg-yellow-100 text-yellow-600"
                                }`}
                        >
                            <Wifi className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 font-semibold uppercase">Backend API</p>
                            <p
                                className={`text-sm font-bold ${backendStatus === "online"
                                        ? "text-green-600"
                                        : backendStatus === "offline"
                                            ? "text-red-600"
                                            : "text-yellow-600"
                                    }`}
                            >
                                {backendStatus === "online" ? "En línea" : backendStatus === "offline" ? "Desconectado" : "Verificando..."}
                            </p>
                        </div>
                    </div>

                    {/* API URL */}
                    <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-100">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Database className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500 font-semibold uppercase">URL del Backend</p>
                            <p className="text-sm font-mono text-gray-900 truncate" title={apiUrl}>
                                {apiUrl}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}
