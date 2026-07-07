"use client";

/**
 * Dashboard "Rendimiento — estimado vs. real" (pedido por Lucas, reunión 2-jul).
 * Muestra, por PROCESO o por OPERARIO, el tiempo estimado vs. el real y el desvío %.
 * El tiempo real sale de fin_real - inicio_real (se estampa al marcar avance).
 * Hasta que no se marquen procesos En Proceso → Finalizado, muestra un empty state.
 */

import React from "react";
import { Gauge, Settings, User } from "lucide-react";
import { API_URL } from "@/config";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface Row {
    proceso_id?: number;
    operario_id?: number;
    proceso?: string;
    operario?: string;
    cantidad: number;
    estimado_min: number;
    real_min: number;
    desvio_pct: number | null;
}

const fmtHoras = (min: number) => {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h <= 0) return `${m} min`;
    return `${h}h ${m.toString().padStart(2, "0")}m`;
};

function DesvioBadge({ d }: { d: number | null }) {
    if (d === null || d === undefined) return <span className="text-gray-400">—</span>;
    // Positivo = tardó MÁS que lo estimado (malo, rojo). Negativo = más rápido (bueno, verde).
    const cls = d > 10 ? "text-red-600" : d < -10 ? "text-green-600" : "text-gray-600";
    return <span className={`${cls} font-semibold tabular-nums`}>{d > 0 ? "+" : ""}{d}%</span>;
}

export default function RendimientoEstimadoReal() {
    const [procesos, setProcesos] = React.useState<Row[]>([]);
    const [operarios, setOperarios] = React.useState<Row[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [tab, setTab] = React.useState<"procesos" | "operarios">("procesos");

    const fetchData = React.useCallback(async () => {
        setLoading(true);
        try {
            const [rp, ro] = await Promise.all([
                fetch(`${API_URL}/api/dashboard/rendimiento-procesos`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/api/dashboard/rendimiento-operarios`, { headers: getAuthHeaders() }),
            ]);
            if (rp.ok) { const j = await rp.json(); setProcesos(Array.isArray(j.data) ? j.data : []); }
            if (ro.ok) { const j = await ro.json(); setOperarios(Array.isArray(j.data) ? j.data : []); }
        } catch (e) {
            console.error("Error al cargar rendimiento estimado vs real:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => { fetchData(); }, [fetchData]);

    const rows = tab === "procesos" ? procesos : operarios;
    const totalEst = rows.reduce((a, r) => a + (r.estimado_min || 0), 0);
    const totalReal = rows.reduce((a, r) => a + (r.real_min || 0), 0);
    const desvioTotal = totalEst > 0 ? Math.round(((totalReal - totalEst) / totalEst) * 100) : null;

    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100/50">
                        <Gauge className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Rendimiento — estimado vs. real</h2>
                        <p className="text-gray-500 text-xs">Tiempo real (marcado) comparado con el estimado</p>
                    </div>
                </div>
                <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs font-medium">
                    <button
                        onClick={() => setTab("procesos")}
                        className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${tab === "procesos" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                        <Settings className="h-3.5 w-3.5" /> Por proceso
                    </button>
                    <button
                        onClick={() => setTab("operarios")}
                        className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${tab === "operarios" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                        <User className="h-3.5 w-3.5" /> Por operario
                    </button>
                </div>
            </div>

            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-10">
                        <div className="animate-spin rounded-full h-7 w-7 border-4 border-gray-200 border-t-blue-500" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="text-center py-10">
                        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Gauge className="h-6 w-6 text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-600">Todavía no hay tiempos reales cargados</p>
                        <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                            Marcá los procesos como <b>En Proceso → Finalizado</b> a medida que avanzan y el rendimiento se empieza a medir solo.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Resumen */}
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Estimado</p>
                                <p className="text-xl font-bold text-gray-800">{fmtHoras(totalEst)}</p>
                            </div>
                            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Real</p>
                                <p className="text-xl font-bold text-blue-700">{fmtHoras(totalReal)}</p>
                            </div>
                            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Desvío</p>
                                <p className="text-xl font-bold"><DesvioBadge d={desvioTotal} /></p>
                            </div>
                        </div>

                        {/* Tabla */}
                        <div className="border rounded-lg overflow-hidden overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                                    <tr>
                                        <th className="text-left px-3 py-2">{tab === "procesos" ? "Proceso" : "Operario"}</th>
                                        <th className="text-center px-3 py-2">#</th>
                                        <th className="text-right px-3 py-2">Estimado</th>
                                        <th className="text-right px-3 py-2">Real</th>
                                        <th className="text-right px-3 py-2">Desvío</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {rows.map((r, i) => (
                                        <tr key={i} className="hover:bg-gray-50/50">
                                            <td className="px-3 py-2 font-medium text-gray-800">
                                                {(tab === "procesos" ? r.proceso : r.operario)?.trim() || "—"}
                                            </td>
                                            <td className="px-3 py-2 text-center text-gray-500">{r.cantidad}</td>
                                            <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{fmtHoras(r.estimado_min)}</td>
                                            <td className="px-3 py-2 text-right text-blue-700 tabular-nums">{fmtHoras(r.real_min)}</td>
                                            <td className="px-3 py-2 text-right"><DesvioBadge d={r.desvio_pct} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-2">
                            Desvío = cuánto más (rojo) o menos (verde) tardó lo real vs. lo estimado.
                        </p>
                    </>
                )}
            </div>
        </section>
    );
}
