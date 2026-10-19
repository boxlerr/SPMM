"use client";

/**
 * Quién hace afuera un paso tercerizado y cuántos días tarda (reunión con Lucas del
 * 17/10/2026).
 *
 * En la vista previa un paso tercerizado decía «Tercerizado» en «Recurso humano» y en
 * «Recurso maquinaria». Lucas: «ahí tiene que poner el proveedor cuando es tercerizado,
 * y cuándo te lo va a devolver: si tarda 10 días, vos le terminaste de hacer el 19, recién
 * volvería al 29». Las dos celdas pasan a ser una sola con el proveedor y los días.
 *
 * Se guarda en la ORDEN al toque (como «No necesita»): el proveedor también para ese paso
 * en las otras OT abiertas del mismo producto, y los días se recuerdan para el proveedor
 * si todavía no tenía. El plan NO se recalcula solo —se rehacen todos los horarios y se
 * llevaría puestos los retoques—: la fila avisa que hay que recalcular, con el botón ahí.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { SelectorProveedor } from "@/app/materia-prima/_components/SelectorProveedor";
import type { Proveedor } from "@/lib/materiaPrima";
import { diaCorto } from "@/lib/paraClaude";

export interface DatosDelProveedor {
    id_proveedor: number | null;
    proveedor_nombre: string | null;
    demora_del_paso: number | null;
    demora_del_proveedor: number | null;
}

interface ProveedorDelPasoProps {
    ordenId: number;
    /** La pasada de la OT (orden_trabajo_proceso.id). Sin ella no se puede guardar. */
    lineaId: number | null;
    datos: DatosDelProveedor;
    /** El día en que vuelve, según el plan calculado. */
    vuelveEl?: string | null;
    /** El último día del plan (YYYY-MM-DD): si vuelve después, lo que sigue queda afuera. */
    finDelPlan?: string | null;
    bloqueado?: boolean;
    /** Lo guardado: la pantalla lo usa para exportar y para el archivo de Claude. */
    onGuardado?: (datos: DatosDelProveedor) => void;
    onRecalcular?: () => void;
}

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Los días que va a usar el planificador: los del paso y, si no, los del proveedor. */
export function demoraEfectiva(d: DatosDelProveedor): number | null {
    return d.demora_del_paso ?? d.demora_del_proveedor ?? null;
}

export function ProveedorDelPaso({
    ordenId, lineaId, datos, vuelveEl, finDelPlan, bloqueado, onGuardado, onRecalcular,
}: ProveedorDelPasoProps) {
    const [actual, setActual] = useState<DatosDelProveedor>(datos);
    const [dias, setDias] = useState<string>(demoraEfectiva(datos)?.toString() ?? "");
    const [guardando, setGuardando] = useState(false);
    /** Se cambió algo desde que se calculó el plan: los horarios todavía no lo esperan. */
    const [sinRecalcular, setSinRecalcular] = useState(false);

    // Un recálculo trae la fila nueva: lo de la orden pasa a ser lo del plan.
    useEffect(() => {
        setActual(datos);
        setDias(demoraEfectiva(datos)?.toString() ?? "");
        setSinRecalcular(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [datos.id_proveedor, datos.demora_del_paso, datos.demora_del_proveedor, vuelveEl]);

    const guardar = async (cambios: Record<string, unknown>, optimista: DatosDelProveedor) => {
        if (lineaId == null) return;
        const antes = actual;
        setActual(optimista);       // se ve al toque; si falla, vuelve
        setGuardando(true);
        try {
            const res = await fetch(`${API_URL}/ordenes/${ordenId}/procesos/linea/${lineaId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify(cambios),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                const motivo = json?.errors?.[0]?.message ?? json?.errorDescription ?? json?.detail;
                throw new Error(typeof motivo === "string" ? motivo : "No se pudo guardar.");
            }
            const d = json?.data ?? {};
            // El backend viejo ignora los campos que no conoce y contesta 200: si no vuelve
            // el proveedor, no se guardó (ver no-necesita-memoria-por-producto).
            if (!("demora_efectiva" in d)) {
                throw new Error("El servidor todavía no guarda el proveedor: falta actualizarlo.");
            }
            const guardado: DatosDelProveedor = {
                id_proveedor: d.proveedor?.id ?? null,
                proveedor_nombre: d.proveedor?.nombre ?? null,
                demora_del_paso: d.demora_dias ?? null,
                demora_del_proveedor: d.proveedor?.demora_dias ?? null,
            };
            setActual(guardado);
            setDias(demoraEfectiva(guardado)?.toString() ?? "");
            setSinRecalcular(true);
            onGuardado?.(guardado);
            const otras = Number(d.otras_del_articulo) || 0;
            if ("id_proveedor" in cambios && cambios.id_proveedor && otras > 0) {
                toast.success(`Guardado en la OT y en ${otras} ${otras === 1 ? "OT abierta" : "OT abiertas"} más del mismo producto.`);
            }
        } catch (e) {
            setActual(antes);
            setDias(demoraEfectiva(antes)?.toString() ?? "");
            toast.error(e instanceof Error ? e.message : "No se pudo guardar el proveedor.");
        } finally {
            setGuardando(false);
        }
    };

    const elegirProveedor = (id: number | null, nombre: string | null) => {
        if (id === actual.id_proveedor) return;
        void guardar(
            { id_proveedor: id, para_el_articulo: true },
            { ...actual, id_proveedor: id, proveedor_nombre: nombre, demora_del_proveedor: null },
        );
    };

    const guardarDias = () => {
        const texto = dias.trim();
        const n = texto === "" ? null : Math.round(Number(texto));
        if (n !== null && (!Number.isFinite(n) || n < 0 || n > 365)) {
            toast.error("Los días van de 0 a 365.");
            setDias(demoraEfectiva(actual)?.toString() ?? "");
            return;
        }
        if (n === demoraEfectiva(actual)) return;
        // Los días son de ESTE trabajo; si el proveedor todavía no tenía los suyos, quedan
        // como los de siempre para la próxima vez que se lo elija.
        const recordar = n !== null && actual.id_proveedor != null && actual.demora_del_proveedor == null;
        void guardar(
            { demora_dias: n, ...(recordar ? { demora_del_proveedor: n } : {}) },
            { ...actual, demora_del_paso: n, ...(recordar ? { demora_del_proveedor: n } : {}) },
        );
    };

    /** Se editó un proveedor desde la lista: si es el de este paso, su nombre y sus días. */
    const alEditarElProveedor = (p: Proveedor) => {
        if (p.id !== actual.id_proveedor) return;
        const nuevo: DatosDelProveedor = {
            ...actual,
            proveedor_nombre: p.razon_social,
            demora_del_proveedor: p.demora_dias ?? null,
        };
        setActual(nuevo);
        setDias(demoraEfectiva(nuevo)?.toString() ?? "");
        // Si el paso usa los días de siempre del proveedor, el plan tiene que esperarlos.
        if (actual.demora_del_paso == null && (p.demora_dias ?? null) !== actual.demora_del_proveedor) {
            setSinRecalcular(true);
        }
        onGuardado?.(nuevo);
    };

    const efectiva = demoraEfectiva(actual);
    const deDonde = actual.demora_del_paso == null && actual.demora_del_proveedor != null
        ? `los de siempre de ${actual.proveedor_nombre ?? "este proveedor"}`
        : null;
    // Vuelve después del último día del plan: lo que sigue de la OT no entra (queda en
    // «Fuera del plan», con el porqué).
    const despuesDelPlan = !!vuelveEl && !!finDelPlan && vuelveEl.slice(0, 10) > finDelPlan.slice(0, 10);

    return (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <SelectorProveedor
                valor={{ id: actual.id_proveedor, nombre: actual.proveedor_nombre }}
                onCambiar={(v) => elegirProveedor(v.id, v.nombre)}
                // Escribir uno nuevo, editarlo y eliminarlo desde la lista (19/10/2026).
                gestionEnLista
                onEditado={alEditarElProveedor}
                disabled={bloqueado || guardando || lineaId == null}
                placeholder="¿Qué proveedor lo hace?"
                className="w-auto min-w-[11rem] max-w-[16rem] flex-1"
                triggerClassName="h-8 text-xs bg-violet-50/40 border-violet-200"
            />
            <label className="flex items-center gap-1 text-xs text-gray-600" title="Días de calendario que tarda en devolverlo">
                <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={365}
                    value={dias}
                    placeholder="—"
                    disabled={bloqueado || guardando || lineaId == null}
                    onChange={(e) => setDias(e.target.value)}
                    onBlur={guardarDias}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    className="h-8 w-14 px-2 text-xs tabular-nums"
                    aria-label="Días que tarda el proveedor"
                />
                días
            </label>
            <span className={cn("text-[11px] leading-tight", sinRecalcular ? "text-orange-700" : "text-gray-500")}>
                {sinRecalcular
                    ? (efectiva
                        ? "Guardado. Recalculá para que el plan lo espere."
                        : "Guardado. Recalculá el plan.")
                    : vuelveEl
                        ? <>vuelve el <strong className="font-semibold text-gray-700">{diaCorto(vuelveEl)}</strong>{deDonde ? ` · ${deDonde}` : ""}{despuesDelPlan ? " · después del plan: lo que sigue, para cuando vuelva" : ""}</>
                        : efectiva == null
                            ? "Sin días: el plan no lo espera"
                            : deDonde}
            </span>
            {sinRecalcular && onRecalcular && (
                <button
                    type="button"
                    onClick={onRecalcular}
                    disabled={bloqueado}
                    className="inline-flex items-center gap-1 rounded border border-orange-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-orange-800 hover:bg-orange-50 disabled:opacity-50"
                    title="Volver a repartir el trabajo con el proveedor y sus días. Se rehacen los horarios de TODO el plan."
                >
                    <RefreshCw className="h-3 w-3" />
                    Recalcular
                </button>
            )}
        </div>
    );
}
