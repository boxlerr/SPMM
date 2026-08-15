"use client";

/**
 * Auditoría de planificaciones.
 *
 * Cada intento de planificar queda registrado, salga bien o mal: qué OTs se
 * pidieron (por su número visible), si fue vista previa o confirmación, cuánto
 * tardó, qué dio y —si falló— el error textual. Y abajo, el historial de borrados.
 *
 * Existe porque el 15/08 un intento murió en el servidor y otro tardó un minuto,
 * y no había NINGÚN lugar en la app donde ver qué se intentó y qué pasó: la única
 * evidencia estaba en los logs de Cloud Run, que el equipo no ve.
 */

import { useCallback, useEffect, useState } from "react";
import {
    ClipboardList, RefreshCw, ChevronDown, ChevronRight,
    CheckCircle2, XCircle, AlertTriangle, Trash2, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface Intento {
    id: number;
    creado_en: string;
    tipo: string;
    ordenes_pedidas: number;
    ordenes_visibles: string | null;
    resultado: string;
    procesos_planificados: number | null;
    procesos_excedentes: number | null;
    sin_asignar: number | null;
    sin_maquina: number | null;
    diagnosticos_bloqueantes: number | null;
    diagnosticos_avisos: number | null;
    duracion_ms: number | null;
    error: string | null;
    id_planificacion_lote: string | null;
}

interface Borrado {
    id: number;
    id_planificacion_lote: string | null;
    descripcion_lote: string | null;
    alcance: string;
    filas_borradas: number;
    ots_borradas: number;
    orden_ids: string | null;
    borrado_en: string;
}

const TIPO_LABEL: Record<string, string> = {
    preview: "Vista previa",
    confirmar: "Confirmación",
    plan_manual: "Plan manual",
    re_planificar: "Re-planificar",
};

const fmtFecha = (iso: string) =>
    new Date(iso).toLocaleString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });

const fmtDur = (ms: number | null) => {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
};

export default function AuditoriaPage() {
    const [intentos, setIntentos] = useState<Intento[]>([]);
    const [borrados, setBorrados] = useState<Borrado[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [abierto, setAbierto] = useState<number | null>(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL.replace(/\/$/, "")}/auditoria/planificacion`, {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setIntentos(Array.isArray(data?.intentos) ? data.intentos : []);
            setBorrados(Array.isArray(data?.borrados) ? data.borrados : []);
        } catch {
            setError("No se pudo cargar la auditoría. Probá actualizar.");
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => {
        cargar();
    }, [cargar]);

    return (
        <div className="container mx-auto py-8 px-4 max-w-5xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <ClipboardList className="h-7 w-7 text-muted-foreground" />
                        Auditoría
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Cada intento de planificación y cada borrado, con su resultado. Lo que falla también queda.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
                    <RefreshCw className={cn("h-4 w-4 mr-2", cargando && "animate-spin")} />
                    Actualizar
                </Button>
            </div>

            {error && (
                <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {error}
                </div>
            )}

            {cargando ? (
                <div className="flex items-center justify-center py-16">
                    <Spinner className="h-8 w-8" />
                </div>
            ) : (
                <>
                    <section className="rounded-lg border bg-card overflow-hidden mb-8">
                        <div className="px-4 py-3 border-b bg-muted/40">
                            <h2 className="text-sm font-semibold">Intentos de planificación</h2>
                        </div>
                        {intentos.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                                Todavía no hay intentos registrados. Aparecen desde ahora: cada vez que alguien
                                calcule una vista previa o confirme un plan, queda acá.
                            </p>
                        ) : (
                            <ul className="divide-y">
                                {intentos.map((it) => {
                                    const ok = it.resultado === "ok";
                                    const activo = abierto === it.id;
                                    return (
                                        <li key={it.id}>
                                            <button
                                                type="button"
                                                onClick={() => setAbierto(activo ? null : it.id)}
                                                className={cn(
                                                    "w-full px-4 py-2 flex items-center gap-3 text-left transition-colors",
                                                    activo ? "bg-muted/40" : "hover:bg-muted/30"
                                                )}
                                            >
                                                {ok ? (
                                                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                                                ) : (
                                                    <XCircle className="h-4 w-4 text-rose-600 shrink-0" />
                                                )}
                                                <span className="text-sm tabular-nums text-muted-foreground shrink-0 w-24">
                                                    {fmtFecha(it.creado_en)}
                                                </span>
                                                <Badge variant="outline" className="text-xs font-normal shrink-0">
                                                    {TIPO_LABEL[it.tipo] ?? it.tipo}
                                                </Badge>
                                                <span className="text-sm text-gray-700 truncate">
                                                    {it.ordenes_pedidas > 0
                                                        ? `${it.ordenes_pedidas} OT${it.ordenes_pedidas !== 1 ? "s" : ""}`
                                                        : "todas las disponibles"}
                                                    {ok && it.procesos_planificados != null && (
                                                        <span className="text-muted-foreground">
                                                            {" "}· {it.procesos_planificados} procesos
                                                            {(it.procesos_excedentes ?? 0) > 0 && `, ${it.procesos_excedentes} sin lugar`}
                                                        </span>
                                                    )}
                                                    {!ok && (
                                                        <span className="text-rose-700"> · {it.resultado === "sin_solucion" ? "sin solución" : "falló"}</span>
                                                    )}
                                                </span>
                                                <span className="flex-1" />
                                                {(it.diagnosticos_bloqueantes ?? 0) > 0 && (
                                                    <span className="flex items-center gap-1 text-xs text-rose-600 shrink-0" title="Trabas detectadas">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        {it.diagnosticos_bloqueantes}
                                                    </span>
                                                )}
                                                <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums shrink-0">
                                                    <Clock className="h-3 w-3" />
                                                    {fmtDur(it.duracion_ms)}
                                                </span>
                                                {activo ? (
                                                    <ChevronDown className="h-4 w-4 opacity-40 shrink-0" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 opacity-40 shrink-0" />
                                                )}
                                            </button>
                                            {activo && (
                                                <div className="px-4 pb-3 pl-11 space-y-1.5 text-sm">
                                                    {it.ordenes_visibles && (
                                                        <p className="text-muted-foreground">
                                                            <span className="font-medium text-gray-700">OTs:</span>{" "}
                                                            {it.ordenes_visibles.split(",").map((n) => `#${n}`).join(", ")}
                                                        </p>
                                                    )}
                                                    {/* "Sin máquina" no se muestra: los procesos manuales
                                                        (soldadura, embalado...) van sin máquina a propósito y
                                                        el número solo alarmaría. */}
                                                    {ok && (
                                                        <p className="text-muted-foreground">
                                                            {it.procesos_planificados != null && `${it.procesos_planificados} procesos planificados`}
                                                            {(it.sin_asignar ?? 0) > 0 && ` · ${it.sin_asignar} sin operario`}
                                                            {(it.diagnosticos_bloqueantes ?? 0) > 0 && ` · ${it.diagnosticos_bloqueantes} traba(s)`}
                                                            {(it.diagnosticos_avisos ?? 0) > 0 && ` · ${it.diagnosticos_avisos} aviso(s)`}
                                                        </p>
                                                    )}
                                                    {it.id_planificacion_lote && (
                                                        <p className="text-xs text-muted-foreground">
                                                            Lote guardado: <span className="font-mono">{it.id_planificacion_lote}</span>
                                                        </p>
                                                    )}
                                                    {it.error && (
                                                        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 font-mono whitespace-pre-wrap">
                                                            {it.error}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>

                    <section className="rounded-lg border bg-card overflow-hidden">
                        <div className="px-4 py-3 border-b bg-muted/40 flex items-center gap-2">
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                            <h2 className="text-sm font-semibold">Borrados</h2>
                        </div>
                        {borrados.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                                No hay borrados registrados.
                            </p>
                        ) : (
                            <ul className="divide-y">
                                {borrados.map((b) => (
                                    <li key={b.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                                        <span className="tabular-nums text-muted-foreground shrink-0 w-24">
                                            {fmtFecha(b.borrado_en)}
                                        </span>
                                        <Badge variant="outline" className="text-xs font-normal shrink-0">
                                            {b.alcance === "lote" ? "Lote entero" : "OTs sueltas"}
                                        </Badge>
                                        <span className="text-gray-700">
                                            {b.filas_borradas} fila{b.filas_borradas !== 1 ? "s" : ""} de {b.ots_borradas} OT{b.ots_borradas !== 1 ? "s" : ""}
                                            {b.descripcion_lote && (
                                                <span className="text-muted-foreground"> · {b.descripcion_lote}</span>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
