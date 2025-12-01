import { Package } from "lucide-react"
import { TopArticulo } from "./types"

interface TopArticlesProps {
    articulos: TopArticulo[]
    loading: boolean
}

export default function TopArticles({ articulos, loading }: TopArticlesProps) {
    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden xl:col-span-2">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 text-green-600 rounded-lg border border-green-100/50">
                        <Package className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Top Artículos Producidos</h2>
                        <p className="text-gray-500 text-xs">Mayor cantidad producida</p>
                    </div>
                </div>
            </div>
            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-green-500"></div>
                    </div>
                ) : !articulos || articulos.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No hay datos</div>
                ) : (
                    <div className="space-y-3">
                        {articulos.map((art, idx) => (
                            <div key={idx} className="p-4 border border-gray-200 rounded-lg hover:border-green-300 hover:shadow-md transition-all">
                                <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0">
                                        <div className="w-8 h-8 bg-green-100 text-green-700 rounded-full flex items-center justify-center font-bold text-sm">
                                            {idx + 1}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-1" title={art.articulo}>
                                            {art.articulo}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <Package className="h-3.5 w-3.5 text-green-600" />
                                            <span className="text-xs font-bold text-green-600">{art.cantidad} unidades</span>
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
