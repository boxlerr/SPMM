import React from 'react';
import { Button } from "@/components/ui/button";
import { PlusCircle, X, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { API_URL } from "@/config";
import { ProcesosEditor, ProcesoRow, makeEmptyRow } from "@/components/planning/ProcesosEditor";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

/**
 * Alta rápida (inline) de procesos sobre una OT existente. Usa el mismo listado
 * `ProcesosEditor` que el alta de OT (rediseño reunión Metlo 2-jul-2026), así la
 * carga queda idéntica en los dos lados e incluye la columna Máquina.
 * Guarda cada proceso tildado con POST /ordenes/{id}/procesos (secuencial, para
 * que cada uno vea el max(orden) actualizado).
 */
export function AddProcessRow({ orderId, onProcessAdded, isCentered = false, variant = 'table', label }: { orderId: number, onProcessAdded: () => void, isCentered?: boolean, variant?: 'table' | 'card', label?: string }) {
    const [isAdding, setIsAdding] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [procesos, setProcesos] = React.useState<any[]>([]);
    const [maquinarias, setMaquinarias] = React.useState<any[]>([]);
    const [rows, setRows] = React.useState<ProcesoRow[]>([]);

    const fetchCatalogos = async () => {
        try {
            const [pRes, mRes] = await Promise.all([
                fetch(`${API_URL}/procesos`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/maquinarias`, { headers: getAuthHeaders() }),
            ]);
            if (pRes.ok) {
                const data = await pRes.json();
                if (data?.data && Array.isArray(data.data)) setProcesos(data.data);
            }
            if (mRes.ok) {
                const data = await mRes.json();
                setMaquinarias(Array.isArray(data) ? data : (data?.data || []));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const openEditor = () => {
        setIsAdding(true);
        fetchCatalogos();
        setRows([makeEmptyRow()]);
    };

    const handleBatchSave = async () => {
        // Sólo se guardan los procesos tildados ("Va") con proceso elegido y minutos.
        const validItems = rows.filter(r => r.incluido && r.proceso_id && r.tiempo);
        if (validItems.length === 0) return;

        setLoading(true);
        try {
            // Secuenciales (no en paralelo) para que cada POST vea el max(orden)
            // actualizado y los procesos queden numerados correctamente.
            let allSuccess = true;
            let firstError: string | null = null;
            for (const item of validItems) {
                const res = await fetch(`${API_URL}/ordenes/${orderId}/procesos`, {
                    method: 'POST',
                    headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id_proceso: parseInt(item.proceso_id),
                        tiempo_estimado: parseInt(item.tiempo) || 0,
                        cant_operarios: parseInt(item.cant_operarios) || 1,
                        // id_maquinaria: máquina preseleccionada ('' -> null = planificador decide)
                        id_maquinaria: item.maquina_id ? parseInt(item.maquina_id) : null,
                    })
                });
                if (!res.ok) {
                    allSuccess = false;
                    try {
                        const body = await res.json();
                        firstError = body?.errors?.[0]?.message || null;
                    } catch { /* body no era JSON */ }
                    break;
                }
            }

            if (allSuccess) {
                setRows([]);
                onProcessAdded();
                setIsAdding(false);
                toast.success("Procesos guardados correctamente");
            } else {
                toast.error(firstError || "Error al guardar uno o más procesos");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error al guardar los procesos");
        } finally {
            setLoading(false);
        }
    };

    if (!isAdding) {
        let buttonText = label;
        if (!buttonText) {
            buttonText = isCentered ? "Agregar primer proceso" : "Agregar Proceso";
        }

        return (
            <button
                onClick={openEditor}
                className={cn(
                    "flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors w-full px-4 py-2 hover:bg-gray-100",
                    isCentered ? "justify-center" : ""
                )}
            >
                <PlusCircle className="w-4 h-4" />
                {buttonText}
            </button>
        );
    }

    const guardables = rows.filter(r => r.incluido && r.proceso_id && r.tiempo).length;

    return (
        <div className={cn(
            "flex flex-col w-full animate-in fade-in slide-in-from-top-1 bg-blue-50/30 border-t border-blue-100 p-3 gap-2",
            variant === 'card' ? "rounded-lg border bg-white" : ""
        )}>
            <div className="flex justify-between items-center px-1">
                <span className="text-xs font-medium text-blue-800">Nuevos Procesos</span>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-gray-500 hover:text-red-600"
                    onClick={() => setIsAdding(false)}
                >
                    <X className="w-4 h-4" />
                </Button>
            </div>

            <ProcesosEditor
                rows={rows}
                onChange={setRows}
                procesos={procesos}
                maquinarias={maquinarias}
            />

            <div className="flex items-center justify-end mt-1">
                <Button
                    size="sm"
                    className="h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1 shadow-sm"
                    onClick={handleBatchSave}
                    disabled={loading || guardables === 0}
                >
                    {loading ? "..." : (
                        <>
                            <Save className="w-3.5 h-3.5" />
                            Guardar Todo ({guardables})
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}
