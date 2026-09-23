"use client";

/**
 * «Actividad por persona» (RF-25): cada usuario, cuándo entró por última vez y, en el
 * período, cuántas veces entró, cuántas cosas hizo y cuántas veces se equivocaron la
 * contraseña de su cuenta. Tocar a alguien lleva al registro filtrado por esa persona.
 *
 * Es la pregunta de control que el registro de a un renglón no contesta de un vistazo:
 * «¿quién usa el sistema y quién no?», «¿alguien está probando claves en la cuenta de
 * Lucas?». Los números salen del servidor (GET /auditoria/actividad), que cuenta sobre
 * TODO el registro del período, no sobre lo que haya en pantalla.
 *
 * Contra el backend viejo (404) dice en chico que llega con la próxima actualización.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Info, ShieldAlert, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import type { ColumnaExport } from "@/lib/exportar";
import { FiltroDeFechas } from "@/components/auditoria/FiltroDeFechas";
import {
    cuandoCorto,
    pedirActividad,
    textoDelPeriodo,
    type ActividadDePersona,
    type PedidoDeFiltro,
    type PeriodoAuditoria,
    type RespuestaActividad,
} from "@/lib/auditoria";

type Orden = "acciones" | "ultimo" | "fallidos" | "nombre";

const ORDENES: { clave: Orden; texto: string }[] = [
    { clave: "acciones", texto: "Más acciones" },
    { clave: "ultimo", texto: "Último ingreso" },
    { clave: "fallidos", texto: "Más intentos fallidos" },
    { clave: "nombre", texto: "Nombre" },
];

function ordenar(personas: ActividadDePersona[], orden: Orden): ActividadDePersona[] {
    const porNombre = (a: ActividadDePersona, b: ActividadDePersona) => a.nombre.localeCompare(b.nombre, "es");
    const copia = [...personas];
    switch (orden) {
        case "acciones":
            return copia.sort((a, b) => b.acciones - a.acciones || porNombre(a, b));
        case "fallidos":
            return copia.sort((a, b) => b.intentos_fallidos - a.intentos_fallidos || b.bloqueos - a.bloqueos || porNombre(a, b));
        case "ultimo":
            return copia.sort((a, b) => (b.ultimo_ingreso ?? "").localeCompare(a.ultimo_ingreso ?? "") || porNombre(a, b));
        case "nombre":
            return copia.sort(porNombre);
    }
}

const COLUMNAS: ColumnaExport<ActividadDePersona>[] = [
    { titulo: "Persona", valor: (p) => p.nombre },
    { titulo: "Usuario", valor: (p) => p.username ?? "" },
    { titulo: "Tiene acceso", valor: (p) => (p.activo === false ? "No" : "Sí") },
    { titulo: "Último ingreso", tipo: "fechaHora", valor: (p) => p.ultimo_ingreso },
    { titulo: "Último ingreso sale de", valor: (p) => (p.ultimo_ingreso ? (p.ultimo_ingreso_de_la_ficha ? "la ficha (antes del registro)" : "el registro") : "") },
    { titulo: "Entradas en el período", tipo: "entero", valor: (p) => p.ingresos },
    { titulo: "Acciones en el período", tipo: "entero", valor: (p) => p.acciones },
    { titulo: "Acciones que no se pudieron", tipo: "entero", valor: (p) => p.acciones_fallidas },
    { titulo: "Intentos fallidos en su cuenta", tipo: "entero", valor: (p) => p.intentos_fallidos },
    { titulo: "Bloqueos", tipo: "entero", valor: (p) => p.bloqueos },
    { titulo: "Última acción", tipo: "fechaHora", valor: (p) => p.ultima_accion },
];

function Numero({ n, rotulo, tono }: { n: number; rotulo: string; tono?: "rosa" }) {
    return (
        <span className="flex flex-col items-start sm:items-end leading-tight">
            <span className={cn("text-sm tabular-nums font-medium",
                n === 0 ? "text-gray-300" : tono === "rosa" ? "text-rose-700" : "text-gray-800")}>
                {n.toLocaleString("es-AR")}
            </span>
            <span className="text-[10px] text-muted-foreground sm:hidden">{rotulo}</span>
        </span>
    );
}

export function ActividadPorPersona({ onVerPersona }: {
    /** Tocar a alguien: el registro filtrado por esa persona (o sus intentos fallidos). */
    onVerPersona: (pedido: Omit<PedidoDeFiltro, "n">) => void;
}) {
    const [periodo, setPeriodo] = useState<PeriodoAuditoria>({ clave: "30d" });
    const [orden, setOrden] = useState<Orden>("acciones");
    const [datos, setDatos] = useState<RespuestaActividad | null>(null);
    const [estado, setEstado] = useState<"cargando" | "listo" | "error" | "no-disponible">("cargando");
    const [actualizando, setActualizando] = useState(false);

    const cargar = useCallback(async (senal: AbortSignal) => {
        setActualizando(true);
        try {
            const r = await pedirActividad(periodo, senal);
            if (senal.aborted) return;
            if (r === null) {
                setEstado("no-disponible");
                return;
            }
            setDatos(r);
            setEstado("listo");
        } catch {
            if (!senal.aborted) setEstado((e) => (e === "listo" ? "listo" : "error"));
        } finally {
            if (!senal.aborted) setActualizando(false);
        }
    }, [periodo]);

    useEffect(() => {
        const c = new AbortController();
        void cargar(c.signal);
        return () => c.abort();
    }, [cargar]);

    const personas = useMemo(() => ordenar(datos?.personas ?? [], orden), [datos, orden]);

    if (estado === "cargando") {
        return (
            <div className="flex items-center justify-center py-16">
                <Spinner className="h-8 w-8" />
            </div>
        );
    }
    if (estado === "no-disponible") {
        return (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Info className="h-3.5 w-3.5 mt-px shrink-0" />
                La actividad por persona llega con la próxima actualización del servidor.
            </p>
        );
    }

    const ver = (p: ActividadDePersona, destino: "todo" | "ingresos") => onVerPersona({
        destino,
        persona: { id: p.id_usuario, nombre: p.nombre },
        periodo,
        grupo: destino === "ingresos" ? "fallidos" : null,
    });

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Cuántas veces entró cada uno, cuántas cosas cargó, cambió o borró, y cuántas veces
                se equivocaron la contraseña de su cuenta. Tocá a una persona para ver todo lo que hizo.
            </p>

            {estado === "error" && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    No se pudo cargar la actividad. Probá actualizar.
                </div>
            )}

            <div className="rounded-lg border bg-card p-3 flex flex-wrap items-center justify-between gap-2">
                <FiltroDeFechas periodo={periodo} onCambiar={setPeriodo} />
                <select
                    value={orden}
                    onChange={(e) => setOrden(e.target.value as Orden)}
                    aria-label="Ordenar por"
                    className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                    {ORDENES.map((o) => <option key={o.clave} value={o.clave}>{o.texto}</option>)}
                </select>
            </div>

            <section className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/40 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold flex items-center gap-2 min-w-0">
                        <span className="truncate">
                            {personas.length} {personas.length === 1 ? "persona" : "personas"}
                            <span className="font-normal text-muted-foreground"> · {textoDelPeriodo(periodo)}</span>
                        </span>
                        {actualizando && <Spinner className="h-3.5 w-3.5 shrink-0" />}
                    </h2>
                    <ExportarMenu
                        titulo="Auditoría · Actividad por persona"
                        archivo="auditoria_actividad_por_persona"
                        filas={personas}
                        columnas={COLUMNAS}
                        filtros={() => [
                            `Período: ${textoDelPeriodo(periodo)}`,
                            `Orden: ${ORDENES.find((o) => o.clave === orden)?.texto ?? orden}`,
                            ...(datos?.intentos_sin_cuenta
                                ? [`Intentos con usuarios que no existen: ${datos.intentos_sin_cuenta}`] : []),
                        ]}
                    />
                </div>

                {/* Encabezado de las columnas: sólo desde `sm`. En el teléfono cada número
                    lleva su rótulo abajo (Numero). */}
                <div className="hidden sm:grid grid-cols-[1fr_7.5rem_4.5rem_4.5rem_6rem_1rem] gap-3 px-4 py-1.5 border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <span>Persona</span>
                    <span>Último ingreso</span>
                    <span className="text-right">Entradas</span>
                    <span className="text-right">Acciones</span>
                    <span className="text-right">Intentos fallidos</span>
                    <span />
                </div>

                {personas.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No hay nadie con actividad en este período.
                    </p>
                ) : (
                    <ul className={cn("divide-y transition-opacity", actualizando && "opacity-60")}>
                        {personas.map((p) => (
                            <li key={p.id_usuario}>
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => ver(p, "todo")}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ver(p, "todo"); } }}
                                    title={`Ver todo lo que hizo ${p.nombre}`}
                                    className="w-full cursor-pointer px-3 sm:px-4 py-2 grid grid-cols-3 sm:grid-cols-[1fr_7.5rem_4.5rem_4.5rem_6rem_1rem] items-center gap-x-3 gap-y-1 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:bg-muted/40"
                                >
                                    <span className="min-w-0 col-span-3 sm:col-span-1">
                                        <span className="flex items-center gap-1.5 text-sm text-gray-800 truncate">
                                            {p.activo === false && (
                                                <UserX className="h-3.5 w-3.5 text-gray-400 shrink-0" aria-label="Sin acceso" />
                                            )}
                                            <span className="truncate">{p.nombre}</span>
                                            {p.bloqueos > 0 && (
                                                <Badge variant="outline" className="text-[10px] font-normal border-amber-200 text-amber-700 shrink-0">
                                                    {p.bloqueos === 1 ? "1 bloqueo" : `${p.bloqueos} bloqueos`}
                                                </Badge>
                                            )}
                                        </span>
                                        {/* En el teléfono, el último ingreso va abajo del nombre. */}
                                        <span className="block sm:hidden text-xs text-muted-foreground">
                                            Último ingreso: {p.ultimo_ingreso ? cuandoCorto(p.ultimo_ingreso) : "nunca"}
                                            {p.ultimo_ingreso_de_la_ficha && " *"}
                                        </span>
                                    </span>
                                    <span className="hidden sm:block text-sm tabular-nums text-muted-foreground"
                                          title={p.ultimo_ingreso_de_la_ficha
                                              ? "Sale de la ficha del usuario: todavía no entró desde que se registran los ingresos."
                                              : undefined}>
                                        {p.ultimo_ingreso ? cuandoCorto(p.ultimo_ingreso) : "nunca"}
                                        {p.ultimo_ingreso_de_la_ficha && " *"}
                                    </span>
                                    <Numero n={p.ingresos} rotulo="entradas" />
                                    <Numero n={p.acciones} rotulo="acciones" />
                                    {p.intentos_fallidos > 0 ? (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); ver(p, "ingresos"); }}
                                            title="Ver los intentos fallidos de su cuenta"
                                            className="justify-self-start sm:justify-self-end inline-flex flex-col items-start sm:items-end leading-tight rounded sm:px-1 hover:bg-rose-50"
                                        >
                                            <span className="inline-flex items-center gap-1 text-sm tabular-nums font-medium text-rose-700">
                                                <ShieldAlert className="h-3.5 w-3.5" />
                                                {p.intentos_fallidos.toLocaleString("es-AR")}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground sm:hidden">fallidos</span>
                                        </button>
                                    ) : (
                                        <Numero n={0} rotulo="fallidos" />
                                    )}
                                    <ChevronRight className="hidden sm:block h-4 w-4 opacity-40" />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {datos && (datos.intentos_sin_cuenta > 0 || datos.acciones_sin_persona > 0 || personas.some((p) => p.ultimo_ingreso_de_la_ficha)) && (
                <div className="space-y-1 text-xs text-muted-foreground">
                    {datos.intentos_sin_cuenta > 0 && (
                        <p>
                            Además hubo {datos.intentos_sin_cuenta.toLocaleString("es-AR")}{" "}
                            {datos.intentos_sin_cuenta === 1 ? "intento" : "intentos"} de entrar con usuarios que no existen.{" "}
                            <button
                                type="button"
                                className="text-rose-700 underline underline-offset-2"
                                onClick={() => onVerPersona({ destino: "ingresos", persona: null, periodo, grupo: "fallidos" })}
                            >
                                Ver los intentos fallidos
                            </button>
                        </p>
                    )}
                    {datos.acciones_sin_persona > 0 && (
                        <p>
                            {datos.acciones_sin_persona.toLocaleString("es-AR")}{" "}
                            {datos.acciones_sin_persona === 1 ? "movimiento no tiene" : "movimientos no tienen"} persona:
                            los hizo el sistema, o son de antes del 10/09, cuando todavía no se guardaba quién.
                        </p>
                    )}
                    {personas.some((p) => p.ultimo_ingreso_de_la_ficha) && (
                        <p>* Sale de la ficha del usuario: todavía no entró desde que se registran los ingresos.</p>
                    )}
                </div>
            )}
        </div>
    );
}
