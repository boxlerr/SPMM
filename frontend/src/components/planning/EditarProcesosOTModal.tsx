"use client";

/**
 * Editar los procesos de una OT SIN salir de la planificación.
 *
 * Lucas, 10/09: "desde la planificación que pueda eliminar procesos, agregarlos o
 * editarles los nombres, todo full manipulación en los procesos; que pueda editar
 * el orden también". Y el 10/09 al ver el aviso de la prensa: "acá puedo agregar
 * proceso... pone preparación de máquina, entonces pone un oficial que la prepare y
 * después lo sigue haciendo un pasante".
 *
 * Por qué no alcanzaba con lo que ya había: la vista previa deja sacar una línea
 * DEL PLAN, y eso no toca la OT — al recalcular vuelve. Lo que el taller necesita
 * es arreglar la OT: el historial trajo procesos que no van (CNC en piezas que no
 * lo llevan), faltan preparaciones y hay pasos en el orden equivocado. Hasta ahora
 * había que salir de la planificación, abrir Operaciones, buscar la OT, editarla y
 * volver a empezar el plan.
 *
 * Reusa `ProcesosEditor`, el mismo editor del alta de OT: arrastrar para reordenar,
 * agregar, borrar, minutos, máquina y persona. No es una segunda implementación de
 * lo mismo.
 *
 * ⚠️ El guardado manda la lista COMPLETA y el backend borra lo que no viene, así que
 * cada fila viaja con su `id_otp` —el id de la pasada—. Sin eso, en una OT que
 * repite un proceso (la 13813 tiene TORNO CNC 13 veces) se pierde el avance de las
 * pasadas. Es el mismo contrato que usa el modal de OT.
 */

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    ProcesosEditor, ProcesoRow, makeEmptyRow,
    ProcesoCatalogoItem, MaquinaCatalogoItem, OperarioCatalogoItem,
} from "@/components/planning/ProcesosEditor";
import { API_URL } from "@/config";
import { AlertTriangle, Save } from "lucide-react";

const getAuthHeaders = (): HeadersInit => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface Props {
    /** id interno de la OT. null = cerrado. */
    ordenId: number | null;
    /** El número que se ve en pantalla (id_otvieja), solo para el título. */
    numeroVisible?: number | string;
    /**
     * Catálogo de procesos. Opcional: la vista previa no lo tiene a mano —trabaja
     * con el plan ya resuelto— y pasarlo por props obligaba a cargarlo en la
     * pantalla de Operaciones aunque nadie abra este modal. Si no viene, se pide
     * solo, una vez, al abrir.
     */
    procesos?: ProcesoCatalogoItem[];
    maquinarias: MaquinaCatalogoItem[];
    operarios?: OperarioCatalogoItem[];
    onClose: () => void;
    /** Se llama después de guardar bien. El padre recalcula el plan. */
    onGuardado: (ordenId: number) => void;
}

export default function EditarProcesosOTModal({
    ordenId, numeroVisible, procesos, maquinarias, operarios, onClose, onGuardado,
}: Props) {
    const [rows, setRows] = useState<ProcesoRow[]>([]);
    const [catalogo, setCatalogo] = useState<ProcesoCatalogoItem[]>(procesos ?? []);
    const [cargando, setCargando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cleanUrl = API_URL.replace(/\/$/, "");

    // El catálogo se pide una sola vez y queda: abrir el modal para tres OT
    // distintas no tiene por qué traer 400 procesos tres veces.
    useEffect(() => {
        if (procesos?.length) { setCatalogo(procesos); return; }
        if (!ordenId || catalogo.length) return;
        let vivo = true;
        (async () => {
            try {
                const r = await fetch(`${cleanUrl}/procesos`, { headers: getAuthHeaders() });
                const json = await r.json();
                const lista = Array.isArray(json) ? json : (json?.data ?? []);
                if (vivo) setCatalogo(lista.map((p: any) => ({ id: p.id, nombre: p.nombre })));
            } catch {
                // Sin catálogo se puede reordenar y borrar igual; lo que no se puede es
                // elegir un proceso nuevo. Mejor eso que no abrir el modal.
            }
        })();
        return () => { vivo = false; };
    }, [ordenId, procesos, catalogo.length, cleanUrl]);

    useEffect(() => {
        if (!ordenId) return;
        let vivo = true;
        setCargando(true);
        setError(null);
        (async () => {
            try {
                const r = await fetch(`${cleanUrl}/ordenes/${ordenId}`, { headers: getAuthHeaders() });
                if (!r.ok) throw new Error(`Error ${r.status}`);
                const json = await r.json();
                const ot = json?.data ?? json;
                if (!vivo) return;
                setRows((ot?.procesos || []).map((p: any) => ({
                    id: Math.random().toString(36).slice(2),
                    id_otp: p.id,
                    proceso_id: String(p.proceso?.id ?? p.id_proceso ?? ""),
                    tiempo: p.tiempo_proceso != null ? String(p.tiempo_proceso) : "",
                    cant_operarios: p.cant_operarios != null ? String(p.cant_operarios) : "1",
                    maquina_id: p.id_maquinaria ? String(p.id_maquinaria) : "",
                    operario_id: p.id_operario ? String(p.id_operario) : "",
                    incluido: true,
                })));
            } catch (e: any) {
                if (vivo) setError(e?.message || "No se pudieron traer los procesos de la OT.");
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [ordenId, cleanUrl]);

    const guardar = useCallback(async () => {
        if (!ordenId) return;
        setGuardando(true);
        setError(null);
        try {
            // Sólo `procesos`: el DTO usa exclude_unset, así que la cabecera de la OT
            // —cliente, fechas, prioridad— no se toca. Mandar el objeto entero desde
            // acá sería arriesgar pisar campos que esta pantalla ni muestra.
            const r = await fetch(`${cleanUrl}/ordenes/${ordenId}`, {
                method: "PUT",
                headers: { ...(getAuthHeaders() as Record<string, string>), "Content-Type": "application/json" },
                body: JSON.stringify({
                    procesos: rows
                        .filter(p => p.incluido && p.proceso_id)
                        .map(p => ({
                            proceso_id: parseInt(p.proceso_id),
                            id_otp: p.id_otp,
                            tiempo_proceso: parseInt(p.tiempo) || 0,
                            cant_operarios: parseInt(p.cant_operarios) || 1,
                            maquinaria_id: p.maquina_id ? p.maquina_id : null,
                            operario_id: p.operario_id ? p.operario_id : null,
                        })),
                }),
            });
            if (!r.ok) throw new Error((await r.text().catch(() => "")) || `Error ${r.status}`);
            onGuardado(ordenId);
            onClose();
        } catch (e: any) {
            setError(e?.message || "No se pudieron guardar los procesos.");
        } finally {
            setGuardando(false);
        }
    }, [ordenId, rows, cleanUrl, onGuardado, onClose]);

    const quedanSinProcesos = rows.filter(p => p.incluido && p.proceso_id).length === 0;

    return (
        <Dialog open={ordenId != null} onOpenChange={(abierto) => { if (!abierto && !guardando) onClose(); }}>
            <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        Procesos de la OT {numeroVisible ?? ordenId}
                    </DialogTitle>
                    <p className="text-sm text-gray-500">
                        Se guardan en la orden, no sólo en este plan. Al cerrar, el plan se vuelve a calcular.
                    </p>
                </DialogHeader>

                {error && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {cargando ? (
                    <div className="flex justify-center py-16"><Spinner /></div>
                ) : (
                    <ProcesosEditor
                        rows={rows}
                        onChange={setRows}
                        procesos={catalogo}
                        maquinarias={maquinarias}
                        operarios={operarios}
                        disabled={guardando}
                    />
                )}

                {/* Guardar sin ningún proceso es válido —el backend los borra todos, y
                    para eso está—, pero no puede pasar de callado: una OT sin procesos
                    no se puede planificar y no hay historial para volver atrás. */}
                {quedanSinProcesos && !cargando && (
                    <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                            La OT va a quedar sin ningún proceso, así que no se va a poder planificar
                            hasta que le cargues alguno.
                        </AlertDescription>
                    </Alert>
                )}

                <div className="flex justify-between items-center gap-2 pt-2 border-t">
                    <Button
                        variant="ghost"
                        onClick={() => setRows(rs => [...rs, makeEmptyRow()])}
                        disabled={cargando || guardando}
                    >
                        Agregar proceso
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose} disabled={guardando}>
                            Cancelar
                        </Button>
                        <Button
                            className="bg-red-600 hover:bg-red-700"
                            onClick={guardar}
                            disabled={cargando || guardando}
                        >
                            {guardando ? <Spinner className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                            Guardar y recalcular
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
