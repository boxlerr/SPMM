"use client";

/**
 * Auditoría: quién hizo qué.
 *
 * Nació el 15/08, cuando un intento de planificar murió en el servidor y otro tardó
 * un minuto y no había NINGÚN lugar en la app donde ver qué se intentó ni qué pasó:
 * la única evidencia estaba en los logs de Cloud Run, que el equipo no ve.
 *
 * El 15/09 pasó a cubrir TODO, no sólo planificar. Hasta ese día borrar una persona,
 * cambiarle los minutos a un proceso o tocar una OT no dejaba rastro en ningún lado,
 * y con el taller ya cargando los datos de verdad «¿quién cambió esto?» no tenía
 * respuesta. De ahí las dos pestañas:
 *
 *   · Todo lo que se hizo — cada alta, edición y borrado del sistema entero, que
 *     escribe el middleware del backend (infrastructure/auditoria_movimientos.py).
 *   · Planificaciones — el historial viejo, que sigue aparte porque un intento de
 *     planificar guarda cosas que no significan nada para «editó la máquina 12»:
 *     cuántas OT entraron, cuántos procesos, qué dijo el solver.
 *
 * La primera va primero y es la que abre por defecto: es la pregunta que se hace
 * todos los días.
 */

import { useCallback, useEffect, useState } from "react";
import {
    ClipboardList, RefreshCw, ChevronDown, ChevronRight,
    CheckCircle2, XCircle, AlertTriangle, Trash2, Clock, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RegistroDeMovimientos } from "@/components/auditoria/RegistroDeMovimientos";
import { HistorialDeProcesos } from "@/components/auditoria/HistorialDeProcesos";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";
import { usePermisos } from "@/hooks/usePermisos";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import type { ColumnaExport } from "@/lib/exportar";

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
    /** Quién lo hizo. Null en los registros anteriores al 10/09, cuando no se guardaba. */
    usuario?: string | null;
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
    /** Quién borró. Null en los registros anteriores al 10/09. */
    usuario?: string | null;
}

/**
 * Quién lo hizo.
 *
 * Los registros de antes del 10/09 no lo tienen, y ahí dice "sin registrar" en vez
 * de dejar el renglón mudo: la diferencia entre "no lo sabemos" y "no se guardaba"
 * importa cuando alguien pregunta quién borró un plan. Inventar un autor sería peor.
 */
function Quien({ usuario }: { usuario?: string | null }) {
    if (!usuario) {
        return (
            <span className="text-xs text-muted-foreground/60 italic shrink-0"
                  title="Este registro es anterior al 10/09/2026, cuando todavía no se guardaba el usuario">
                sin registrar
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0"
              title={`Lo hizo ${usuario}`}>
            <User className="h-3 w-3" />
            {usuario}
        </span>
    );
}

const TIPO_LABEL: Record<string, string> = {
    preview: "Vista previa",
    confirmar: "Confirmación",
    plan_manual: "Plan manual",
    re_planificar: "Re-planificar",
};

// Reloj de 24 horas, igual que en RegistroDeMovimientos: con el de 12 el es-AR
// escribe «10:15 a. m.», que no entra en la columna de 96px y parte la fecha en dos
// renglones (se veía así en la computadora y, más apretado, en el teléfono).
/** RF-22: las dos listas de la solapa, una hoja cada una. */
const COLUMNAS_INTENTOS: ColumnaExport<Intento>[] = [
    { titulo: "Fecha", tipo: "fechaHora", valor: (it) => it.creado_en },
    { titulo: "Tipo", valor: (it) => TIPO_LABEL[it.tipo] ?? it.tipo },
    { titulo: "Quién", valor: (it) => it.usuario ?? "sin registrar" },
    { titulo: "OTs pedidas", valor: (it) => (it.ordenes_pedidas > 0 ? it.ordenes_pedidas : "todas las disponibles") },
    {
        titulo: "Resultado",
        valor: (it) => (it.resultado === "ok" ? "Bien" : it.resultado === "sin_solucion" ? "Sin solución" : "Falló"),
    },
    { titulo: "Procesos planificados", tipo: "entero", valor: (it) => it.procesos_planificados },
    { titulo: "Sin lugar", tipo: "entero", valor: (it) => it.procesos_excedentes },
    { titulo: "Sin recurso humano", tipo: "entero", valor: (it) => it.sin_asignar },
    { titulo: "Trabas", tipo: "entero", valor: (it) => it.diagnosticos_bloqueantes },
    { titulo: "Avisos", tipo: "entero", valor: (it) => it.diagnosticos_avisos },
    { titulo: "Duración (s)", tipo: "numero", decimales: 1, valor: (it) => (it.duracion_ms == null ? null : it.duracion_ms / 1000) },
    { titulo: "OTs", valor: (it) => it.ordenes_visibles ?? "" },
    { titulo: "Lote guardado", valor: (it) => it.id_planificacion_lote ?? "" },
    { titulo: "Error", valor: (it) => it.error ?? "" },
];

const COLUMNAS_BORRADOS: ColumnaExport<Borrado>[] = [
    { titulo: "Fecha", tipo: "fechaHora", valor: (b) => b.borrado_en },
    { titulo: "Alcance", valor: (b) => (b.alcance === "lote" ? "Lote entero" : "OTs sueltas") },
    { titulo: "Quién", valor: (b) => b.usuario ?? "sin registrar" },
    { titulo: "Filas", tipo: "entero", valor: (b) => b.filas_borradas },
    { titulo: "OTs", tipo: "entero", valor: (b) => b.ots_borradas },
    { titulo: "Planificación", valor: (b) => b.descripcion_lote ?? "" },
    { titulo: "OTs borradas", valor: (b) => b.orden_ids ?? "" },
];

const fmtFecha = (iso: string) =>
    new Date(iso).toLocaleString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
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
    // «Actualizar» recargaba sólo la solapa de planificaciones, que es la que carga
    // esta página. Cambiar esta llave vuelve a montar el historial de pasos, así que el
    // botón hace lo que dice también estando parado ahí.
    const [refresco, setRefresco] = useState(0);

    // RF-24: cada solapa es una sección y el rol puede cerrar algunas. Sólo se muestran
    // (y sólo se piden) las que se pueden leer; abre la primera de ésas.
    const { puedeSeccion } = usePermisos();
    const veTodo = puedeSeccion("auditoria_movimientos");
    const vePasos = puedeSeccion("auditoria_procesos");
    const vePlanificaciones = puedeSeccion("auditoria_planificacion");
    const solapaInicial = veTodo ? "todo" : vePasos ? "procesos" : "planificacion";

    const cargar = useCallback(async () => {
        if (!vePlanificaciones) {
            setCargando(false);
            return;
        }
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
    }, [vePlanificaciones]);

    useEffect(() => {
        cargar();
    }, [cargar]);

    return (
        // Márgenes chicos y cabecera apilada en el teléfono (RF-27). Era la única
        // pantalla del menú sin un solo corte: el botón Actualizar le comía el ancho
        // al título y las solapas se salían de la pantalla por la derecha.
        <div className="container mx-auto py-4 sm:py-8 px-1 sm:px-4 max-w-5xl">
            {/* `pr-12` abajo de `lg`: deja libre la columna de la campana de avisos, que
                flota arriba a la derecha. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 pr-12 lg:pr-0">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <ClipboardList className="h-7 w-7 text-muted-foreground" />
                        Auditoría
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Todo lo que se carga, se cambia y se borra queda registrado: quién, cuándo y qué.
                        Lo que falla también.
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="self-start sm:self-auto shrink-0"
                    onClick={() => { setRefresco((n) => n + 1); cargar(); }}
                    disabled={cargando}
                >
                    <RefreshCw className={cn("h-4 w-4 mr-2", cargando && "animate-spin")} />
                    Actualizar
                </Button>
            </div>

            <Tabs defaultValue={solapaInicial}>
                {/* `flex-wrap h-auto`: «Todo lo que se hizo», «Pasos de las OT» y
                    «Planificaciones» suman ~430px y en un teléfono la tercera quedaba
                    afuera sin forma de llegar. Ahora baja a otra fila; en la computadora
                    entran en una y miden los mismos 40px de siempre. */}
                <TabsList className="mb-4 max-w-full h-auto flex-wrap justify-start">
                    {veTodo && <TabsTrigger value="todo">Todo lo que se hizo</TabsTrigger>}
                    {vePasos && <TabsTrigger value="procesos">Pasos de las OT</TabsTrigger>}
                    {vePlanificaciones && <TabsTrigger value="planificacion">Planificaciones</TabsTrigger>}
                </TabsList>

                {veTodo && (
                    <TabsContent value="todo">
                        <RegistroDeMovimientos />
                    </TabsContent>
                )}

                {/* Los pasos tienen su propia solapa y no se mezclan con el resto: allá
                    se guarda el PEDIDO (la dirección y el cuerpo que mandó el navegador)
                    y acá el CAMBIO ya comparado, fila por fila y campo por campo. Un
                    guardado de OT deja UNA línea allá y una por paso tocado acá. */}
                {vePasos && (
                <TabsContent value="procesos">
                    <p className="text-sm text-muted-foreground mb-3">
                        Cada vez que se agrega, se cambia o se saca un paso de una orden,
                        desde cualquier pantalla: quién, qué cambió y el día y la hora exactos.
                    </p>
                    <HistorialDeProcesos key={refresco} />
                </TabsContent>
                )}

                {vePlanificaciones && (
                <TabsContent value="planificacion">

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
                        <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between gap-2">
                            <h2 className="text-sm font-semibold">Intentos de planificación</h2>
                            <ExportarMenu
                                titulo="Auditoría · Planificaciones"
                                archivo="auditoria_planificaciones"
                                cantidad={intentos.length + borrados.length}
                                secciones={[
                                    { titulo: "Intentos", filas: intentos, columnas: COLUMNAS_INTENTOS },
                                    { titulo: "Borrados", filas: borrados, columnas: COLUMNAS_BORRADOS },
                                ]}
                            />
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
                                                    // `flex-wrap` sólo en el teléfono: fecha, tipo,
                                                    // cuántas OT, quién, trabas y duración no entran en
                                                    // 340px y el renglón se salía por la derecha. Ahí
                                                    // bajan a un segundo renglón.
                                                    "w-full px-3 sm:px-4 py-2 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 text-left transition-colors",
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
                                                {/* Quién lo hizo va antes de las trabas y el reloj:
                                                    es lo primero que se busca cuando algo aparece
                                                    cambiado, no un detalle del final. */}
                                                <Quien usuario={it.usuario} />
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
                                                <div className="px-3 sm:px-4 pb-3 pl-9 sm:pl-11 space-y-1.5 text-sm break-words">
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
                                                            {(it.sin_asignar ?? 0) > 0 && ` · ${it.sin_asignar} sin recurso humano`}
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
                                    <li key={b.id} className="px-3 sm:px-4 py-2 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 text-sm">
                                        <span className="tabular-nums text-muted-foreground shrink-0 w-24">
                                            {fmtFecha(b.borrado_en)}
                                        </span>
                                        <Badge variant="outline" className="text-xs font-normal shrink-0">
                                            {b.alcance === "lote" ? "Lote entero" : "OTs sueltas"}
                                        </Badge>
                                        {/* En el teléfono, la frase en su propio renglón y a todo
                                            el ancho: entre la fecha, el cartel y quién, le quedaban
                                            40px y salía una palabra por renglón. */}
                                        <span className="text-gray-700 min-w-0 order-last basis-full sm:order-none sm:flex-1">
                                            {b.filas_borradas} fila{b.filas_borradas !== 1 ? "s" : ""} de {b.ots_borradas} OT{b.ots_borradas !== 1 ? "s" : ""}
                                            {b.descripcion_lote && (
                                                <span className="text-muted-foreground"> · {b.descripcion_lote}</span>
                                            )}
                                        </span>
                                        <Quien usuario={b.usuario} />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
                </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
