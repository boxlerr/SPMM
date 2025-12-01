import { Factory } from "lucide-react"
import { OcupacionSector } from "./types"

interface SectorOccupationProps {
    ocupacionSectores: OcupacionSector[]
    loading: boolean
}

const capitalize = (text: string) => {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

export default function SectorOccupation({ ocupacionSectores, loading }: SectorOccupationProps) {
    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-50 text-purple-600 rounded-lg border border-purple-100/50">
                        <Factory className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Ocupación</h2>
                        <p className="text-gray-500 text-xs">Carga por sector</p>
                    </div>
                </div>
            </div>
            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-purple-500"></div>
                    </div>
                ) : !ocupacionSectores || ocupacionSectores.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No hay datos</div>
                ) : (
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {ocupacionSectores.map((sector) => (
                            <div key={sector.sector} className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors">
                                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg mt-1">
                                    <Factory className="h-4 w-4" />
                                </div>
                                <div className="flex-1 space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-bold text-gray-900">{capitalize(sector.sector)}</span>
                                        <div className="text-right">
                                            <span className="block font-bold text-purple-600">{sector.porcentaje}%</span>
                                            <span className="text-xs text-gray-500">{sector.ordenes_activas} órdenes</span>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-purple-500 rounded-full transition-all duration-1000"
                                            style={{ width: `${sector.porcentaje}%` }}
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
