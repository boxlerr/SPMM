"use client";

import React from "react";
import { FileWarning, Clock, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { API_URL } from "@/config";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface PorOperario { id_operario: number | null; operario: string; incidencias: number; minutos: number; }
interface PorMes { mes: string; incidencias: number; minutos: number; }
interface Reciente {
    id: number; nro_ot: number | null; proceso: string | null; operario: string | null;
    minutos_perdidos: number; descripcion: string | null; fecha_registro: string;
}
interface Metricas {
    total_incidencias: number;
    total_minutos: number;
    total_operarios_extra: number;
    por_operario: PorOperario[];
    por_mes: PorMes[];
    recientes: Reciente[];
}

const fmtHoras = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${m.toString().padStart(2, "0")}m`;
};

export default function IncidenciasPlanos() {
    const [data, setData] = React.useState<Metricas | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [open, setOpen] = React.useState(false);

    const fetchData = React.useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/incidencias/metricas`, { headers: getAuthHeaders() });
            if (res.ok) {
                const json = await res.json();
                setData(json.data ?? null);
            }
        } catch (e) {
            console.error("Error al cargar incidencias de planos:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchData();
    }, [fetchData]);

    const total = data?.total_incidencias ?? 0;
    const minutos = data?.total_minutos ?? 0;
    const extra = data?.total_operarios_extra ?? 0;

    return (
        <section className="bg-white rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-50 text-amber-600 rounded-lg border border-amber-100/50">
                        <FileWarning className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Interpretación de planos</h2>
                        <p className="text-gray-500 text-xs">Tiempo perdido por no interpretar planos</p>
                    </div>
                </div>
                {total > 0 && (
                    <button
                        onClick={() => setOpen(true)}
                        className="text-xs font-medium text-amber-700 hover:text-amber-900 hover:underline"
                    >
                        Ver detalle
                    </button>
                )}
            </div>

            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-7 w-7 border-4 border-gray-200 border-t-amber-500" />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-amber-600 mb-2"><FileWarning className="h-4 w-4" /></div>
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Incidencias</p>
                            <p className="text-3xl font-bold text-amber-600">{total}</p>
                        </div>
                        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-red-600 mb-2"><Clock className="h-4 w-4" /></div>
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tiempo perdido</p>
                            <p className="text-3xl font-bold text-red-600">{fmtHoras(minutos)}</p>
                        </div>
                        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-indigo-600 mb-2"><Users className="h-4 w-4" /></div>
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Gente extra</p>
                            <p className="text-3xl font-bold text-indigo-600">{extra}</p>
                        </div>
                    </div>
                )}
                {!loading && total === 0 && (
                    <p className="text-sm text-gray-400 text-center mt-4">Sin incidencias registradas todavía.</p>
                )}
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileWarning className="w-5 h-5 text-amber-600" />
                            Incidencias de interpretación de planos
                        </DialogTitle>
                        <DialogDescription>
                            {total} incidencias · {fmtHoras(minutos)} perdidas · {extra} operarios extra
                        </DialogDescription>
                    </DialogHeader>

                    {/* Por operario */}
                    <div className="mt-2">
                        <h4 className="text-sm font-semibold text-gray-800 mb-2">Por operario</h4>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                                    <tr><th className="text-left px-3 py-2">Operario</th><th className="text-center px-3 py-2">Incidencias</th><th className="text-center px-3 py-2">Tiempo</th></tr>
                                </thead>
                                <tbody>
                                    {(data?.por_operario ?? []).map((o, i) => (
                                        <tr key={i} className="border-t">
                                            <td className="px-3 py-2">{o.operario?.trim() || "Sin asignar"}</td>
                                            <td className="px-3 py-2 text-center">{o.incidencias}</td>
                                            <td className="px-3 py-2 text-center">{fmtHoras(o.minutos)}</td>
                                        </tr>
                                    ))}
                                    {(data?.por_operario ?? []).length === 0 && (
                                        <tr><td colSpan={3} className="px-3 py-3 text-center text-gray-400">Sin datos</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Por mes */}
                    <div className="mt-4">
                        <h4 className="text-sm font-semibold text-gray-800 mb-2">Por mes</h4>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                                    <tr><th className="text-left px-3 py-2">Mes</th><th className="text-center px-3 py-2">Incidencias</th><th className="text-center px-3 py-2">Tiempo</th></tr>
                                </thead>
                                <tbody>
                                    {(data?.por_mes ?? []).map((m, i) => (
                                        <tr key={i} className="border-t">
                                            <td className="px-3 py-2">{m.mes}</td>
                                            <td className="px-3 py-2 text-center">{m.incidencias}</td>
                                            <td className="px-3 py-2 text-center">{fmtHoras(m.minutos)}</td>
                                        </tr>
                                    ))}
                                    {(data?.por_mes ?? []).length === 0 && (
                                        <tr><td colSpan={3} className="px-3 py-3 text-center text-gray-400">Sin datos</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Recientes */}
                    <div className="mt-4">
                        <h4 className="text-sm font-semibold text-gray-800 mb-2">Últimas incidencias</h4>
                        <div className="space-y-2">
                            {(data?.recientes ?? []).map((r) => (
                                <div key={r.id} className="text-sm border rounded-lg px-3 py-2 bg-gray-50/50">
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium">OT {r.nro_ot ?? "-"} · {r.proceso || "Proceso s/d"}</span>
                                        <span className="text-red-600 font-semibold">{fmtHoras(r.minutos_perdidos)}</span>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {r.operario?.trim() || "Sin operario"} · {new Date(r.fecha_registro).toLocaleDateString()}
                                    </div>
                                    {r.descripcion && <div className="text-xs text-gray-600 mt-1">{r.descripcion}</div>}
                                </div>
                            ))}
                            {(data?.recientes ?? []).length === 0 && (
                                <p className="text-center text-gray-400 text-sm py-3">Sin incidencias</p>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </section>
    );
}
