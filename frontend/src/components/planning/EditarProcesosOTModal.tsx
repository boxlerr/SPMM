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
    ProcesosEditor, ProcesoRow, makeEmptyRow, SIN_MAQUINA, pasosSinMinutos,
    ProcesoCatalogoItem, MaquinaCatalogoItem, OperarioCatalogoItem,
} from "@/components/planning/ProcesosEditor";
import { API_URL } from "@/config";
import { AlertTriangle, Save, Undo2 } from "lucide-react";

/** "hoy 15:33" si es de hoy, "10/09 15:33" si no. Lo que se lee en un tooltip. */
const fechaHora = (iso: string) => {
    const d = new Date(iso);
    const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    return mismoDia ? `hoy ${hora}`
        : `${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} ${hora}`;
};

const getAuthHeaders = (): HeadersInit => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface Version {
    id: number;
    creado_en: string;
    usuario: string | null;
    motivo: string | null;
    cantidad: number;
}

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
    /** Lo que el planificador asignó, por id de pasada. */
    const [planificado, setPlanificado] = useState<Record<number, any>>({});
    const [catalogo, setCatalogo] = useState<ProcesoCatalogoItem[]>(procesos ?? []);
    const [cargando, setCargando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [versiones, setVersiones] = useState<Version[]>([]);
    const [deshaciendo, setDeshaciendo] = useState(false);
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
                setPlanificado(Object.fromEntries(
                    (ot?.procesos || [])
                        .filter((p: any) => p.id && p.planificado)
                        .map((p: any) => [p.id, p.planificado])
                ));
                // Mismo orden que el modal de la OT: por paso guardado, desempatando por
                // id. Ver el comentario largo en CreateWorkOrderModal.
                setRows([...(ot?.procesos || [])]
                    .sort((a: any, b: any) =>
                        (a.orden ?? 0) - (b.orden ?? 0) || (a.id ?? 0) - (b.id ?? 0))
                    .map((p: any) => ({
                    id: Math.random().toString(36).slice(2),
                    id_otp: p.id,
                    proceso_id: String(p.proceso?.id ?? p.id_proceso ?? ""),
                    tiempo: p.tiempo_proceso != null ? String(p.tiempo_proceso) : "",
                    cant_operarios: p.cant_operarios != null ? String(p.cant_operarios) : "1",
                    // Ver el comentario del mismo mapeo en CreateWorkOrderModal: la
                    // marca «va a mano» gana sobre el id de máquina.
                    maquina_id: p.no_lleva_maquina
                        ? SIN_MAQUINA
                        : (p.id_maquinaria ? String(p.id_maquinaria) : ""),
                    operario_id: p.id_operario ? String(p.id_operario) : "",
                    incluido: true,
                })));
                const rv = await fetch(`${cleanUrl}/ordenes/${ordenId}/procesos/versiones`,
                    { headers: getAuthHeaders() });
                const jv = await rv.json();
                if (vivo) setVersiones(jv?.data ?? []);
            } catch (e: any) {
                if (vivo) setError(e?.message || "No se pudieron traer los procesos de la OT.");
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [ordenId, cleanUrl]);

    /**
     * Volver a como estaban antes del último cambio.
     *
     * Hasta hoy esto no existía: guardar pisaba la lista y lo que no venía se borraba,
     * sin historial. Se aguantaba mientras editar procesos era raro; desde que se
     * edita desde la planificación, no.
     *
     * Devuelve también el avance: una fila que se borró por error vuelve como estaba,
     * no en Pendiente. Y la restauración deja su propia versión, así que deshacer
     * también se puede deshacer.
     */
    const deshacer = useCallback(async () => {
        if (!ordenId || !versiones.length) return;
        setDeshaciendo(true);
        setError(null);
        try {
            const r = await fetch(
                `${cleanUrl}/ordenes/${ordenId}/procesos/restaurar/${versiones[0].id}`,
                { method: "POST", headers: getAuthHeaders() });
            if (!r.ok) throw new Error((await r.text().catch(() => "")) || `Error ${r.status}`);
            onGuardado(ordenId);
            onClose();
        } catch (e: any) {
            setError(e?.message || "No se pudo deshacer el último cambio.");
        } finally {
            setDeshaciendo(false);
        }
    }, [ordenId, versiones, cleanUrl, onGuardado, onClose]);

    const guardar = useCallback(async () => {
        if (!ordenId) return;
        // Esta pantalla no controlaba los minutos en absoluto: un paso en cero se
        // guardaba y el planificador lo agenda como 1 minuto, así que el plan queda
        // más corto de lo que el taller va a tardar. Ver `tieneMinutos` en
        // ProcesosEditor — la regla es la misma en las tres pantallas.
        const sinMinutos = pasosSinMinutos(rows);
        if (sinMinutos.length > 0) {
            const nombreDe = (id: string) =>
                catalogo.find((c) => c.id.toString() === id)?.nombre || "un paso";
            const cuales = sinMinutos.slice(0, 3).map((p) => `«${nombreDe(p.proceso_id)}»`).join(", ");
            setError(
                sinMinutos.length === 1
                    ? `Falta cargarle los minutos a ${cuales}.`
                    : `Faltan los minutos de ${sinMinutos.length} pasos: ${cuales}` +
                      (sinMinutos.length > 3 ? " y otros." : ".")
            );
            return;
        }
        setGuardando(true);
        setError(null);
        try {
            // Sólo `procesos`: el DTO usa exclude_unset, así que la cabecera de la OT
            // —cliente, fechas, prioridad— no se toca. Mandar el objeto entero desde
            // acá sería arriesgar pisar campos que esta pantalla ni muestra.
            const r = await fetch(`${cleanUrl}/ordenes/${ordenId}?motivo=planificacion`, {
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
                            maquinaria_id: p.maquina_id && p.maquina_id !== SIN_MAQUINA ? p.maquina_id : null,
                            no_lleva_maquina: p.maquina_id === SIN_MAQUINA,
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
    }, [ordenId, rows, catalogo, cleanUrl, onGuardado, onClose]);

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
                        {versiones.length > 0 && (
                            <> Si algo sale mal, <strong>Deshacer</strong> los devuelve a como estaban
                            {versiones[0].usuario ? <> antes del cambio de {versiones[0].usuario}</> : null}.</>
                        )}
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
                        planificado={planificado}
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
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            onClick={() => setRows(rs => [...rs, makeEmptyRow()])}
                            disabled={cargando || guardando || deshaciendo}
                        >
                            Agregar proceso
                        </Button>
                        {versiones.length > 0 && (
                            <Button
                                variant="ghost"
                                onClick={deshacer}
                                disabled={cargando || guardando || deshaciendo}
                                className="text-amber-800 hover:bg-amber-50 hover:text-amber-900"
                                title={`Volver a los ${versiones[0].cantidad} procesos que tenía `
                                    + `antes del cambio del ${fechaHora(versiones[0].creado_en)}`
                                    + (versiones[0].usuario ? ` (lo cambió ${versiones[0].usuario})` : "")}
                            >
                                {deshaciendo
                                    ? <Spinner className="h-4 w-4 mr-2" />
                                    : <Undo2 className="h-4 w-4 mr-2" />}
                                Deshacer el último cambio
                            </Button>
                        )}
                    </div>
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
