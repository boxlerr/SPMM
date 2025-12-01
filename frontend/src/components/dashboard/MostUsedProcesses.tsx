import { Activity } from "lucide-react"
import { ProcesoUtilizado } from "./types"

interface MostUsedProcessesProps {
    procesos: ProcesoUtilizado[]
    loading: boolean
}

const capitalize = (text: string) => {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

export default function MostUsedProcesses({ procesos, loading }: MostUsedProcessesProps) {
    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100/50">
                        <Activity className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Procesos</h2>
                        <p className="text-gray-500 text-xs">Mayor volumen de uso</p>
                    </div>
                </div>
            </div>
            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-indigo-500"></div>
                    </div>
                ) : !procesos || procesos.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No hay datos</div>
                ) : (
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {procesos.map((proc, idx) => (
                            <div key={idx} className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors">
                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg mt-1">
                                    <Activity className="h-4 w-4" />
                                </div>
                                <div className="flex-1 space-y-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-medium text-gray-700 truncate max-w-[150px]">{capitalize(proc.proceso)}</span>
                                        <span className="text-gray-900 font-bold">{proc.cantidad}</span>
                                    </div>
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-indigo-500 rounded-full"
                                            style={{ width: `${(proc.cantidad / Math.max(...procesos.map((p) => p.cantidad))) * 100}%` }}
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
