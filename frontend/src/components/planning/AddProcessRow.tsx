import React from 'react';
import { Button } from "@/components/ui/button";
import { PlusCircle, X, Save, Paperclip, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { API_URL } from "@/config";
import { tieneMinutos, ProcesosEditor, ProcesoRow, makeEmptyRow } from "@/components/planning/ProcesosEditor";
import { PlanoPanel } from "@/components/common/PlanoPanel";
import { usePlanosDeOrden } from "@/hooks/usePlanos";
import type { Plano } from "@/lib/planos";
import { usePermisos } from "@/hooks/usePermisos";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

/**
 * El plano, al costado del listado de procesos.
 *
 * El que carga los pasos los está leyendo del dibujo mientras los escribe: si para
 * verlo tiene que abrir un modal que tapa la pantalla, la cuenta la hace de memoria.
 *
 * Se pliega porque en un notebook el panel le saca 320px al listado y las columnas de
 * máquina y minutos quedan espichadas: el que ya sabe de memoria qué va lo cierra y
 * recupera el ancho.
 */
function PanelDePlanos({ planos, cargando, error }: { planos: Plano[]; cargando: boolean; error: string | null }) {
    const [abierto, setAbierto] = React.useState(true);

    if (!abierto) {
        return (
            <button
                type="button"
                onClick={() => setAbierto(true)}
                title="Ver el plano"
                className="order-1 lg:order-2 flex-shrink-0 flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
                <Paperclip className="w-3 h-3" />
                <span className="lg:hidden">Ver el plano{planos.length > 0 ? ` (${planos.length})` : ""}</span>
                <ChevronLeft className="w-3.5 h-3.5" />
            </button>
        );
    }

    return (
        <aside className="order-1 lg:order-2 flex-shrink-0 w-full lg:w-[320px] relative rounded-xl border border-gray-200 bg-white p-3">
            <button
                type="button"
                onClick={() => setAbierto(false)}
                title="Plegar el plano"
                className="absolute right-2 top-2 z-10 p-1 rounded-md text-gray-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            >
                <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <div className="max-h-[45vh] overflow-y-auto pr-1">
                <PlanoPanel
                    planos={planos}
                    cargando={cargando}
                    compacto
                    titulo="Plano"
                    vacioTexto={error ?? "Esta orden no tiene ningún plano cargado."}
                />
            </div>
        </aside>
    );
}

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
    const [operarios, setOperarios] = React.useState<any[]>([]);
    const [rows, setRows] = React.useState<ProcesoRow[]>([]);
    // Recién cuando se abre el editor: este componente se dibuja una vez por fila del
    // listado, y pedir los planos siempre sería un pedido por OT en pantalla.
    // El endpoint de la orden ya trae también los planos del producto que fabrica.
    const { planos, cargando: planosCargando, error: planosError } = usePlanosDeOrden(isAdding ? orderId : undefined);
    // RF-24: agregar pasos es editar la OT (solapa Órdenes). Sin eso, no hay botón:
    // lo decide acá y no cada lista que lo monta, así ninguna se olvida.
    const { puedeSeccion } = usePermisos();
    const puedeAgregar = puedeSeccion("operaciones_ordenes", "write");

    const fetchCatalogos = async () => {
        try {
            const [pRes, mRes, oRes] = await Promise.all([
                fetch(`${API_URL}/procesos`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/maquinarias`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/operarios`, { headers: getAuthHeaders() }),
            ]);
            if (pRes.ok) {
                const data = await pRes.json();
                if (data?.data && Array.isArray(data.data)) setProcesos(data.data);
            }
            if (mRes.ok) {
                const data = await mRes.json();
                setMaquinarias(Array.isArray(data) ? data : (data?.data || []));
            }
            if (oRes.ok) {
                const data = await oRes.json();
                setOperarios(Array.isArray(data) ? data : (data?.data || []));
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
        // `r.tiempo` a secas dejaba pasar el "0": un paso en cero minutos se guardaba y
        // el planificador lo agenda como 1 minuto. Ver `tieneMinutos` en ProcesosEditor.
        const validItems = rows.filter(r => r.incluido && r.proceso_id && tieneMinutos(r.tiempo));
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
                        // id_operario: persona preseleccionada ('' -> null = planificador decide)
                        id_operario: item.operario_id ? parseInt(item.operario_id) : null,
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

    if (!puedeAgregar) return null;

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

            <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                <div className="order-2 lg:order-1 flex-1 min-w-0">
                    <ProcesosEditor
                        rows={rows}
                        onChange={setRows}
                        procesos={procesos}
                        maquinarias={maquinarias}
                        operarios={operarios}
                    />
                </div>

                <PanelDePlanos planos={planos} cargando={planosCargando} error={planosError} />
            </div>

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
