"use client";

/**
 * La línea de tiempo del historial de una OT o de una persona (RF-17), en Auditoría.
 *
 * Lo último primero, agrupado por día. Cada renglón es una frase que se entiende de una
 * pasada («Lucas Longchamps editó los datos de la OT 15300») y, abajo, qué cambió
 * («fecha prometida: 30/09/2026 → 05/10/2026»). Lo que no tiene autor registrado va sin
 * autor —«Se cerró sola la pausa…»—: nunca uno inventado. Lo que se dedujo comparando
 * con el guardado anterior (filas de antes del 23/09) lo dice.
 *
 * `VistaDeHistorial` es el marco común de las dos solapas («Por orden» y «Por persona»):
 * el filtro de fechas (que va al servidor), los botones por tipo (acá, sobre lo que llegó),
 * el Exportar (sale lo filtrado) y los avisos de lo que no se muestra.
 */

import { useMemo, useState } from "react";
import {
    AlertTriangle, Award, Boxes, CalendarRange, CalendarX, Circle, FileText, Info, ListChecks,
    ListOrdered, Package, PauseCircle, Pencil, PlusCircle, Truck, UserCheck, Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import type { ColumnaExport } from "@/lib/exportar";
import { FiltroDeFechas } from "@/components/auditoria/FiltroDeFechas";
import { fechaCorta } from "@/lib/asistencia";
import { textoDelPeriodo, type PeriodoAuditoria } from "@/lib/auditoria";
import {
    diaDe,
    fraseCompleta,
    horaDe,
    tituloDelDia,
    type EventoHistorial,
    type HistorialDeOrden,
    type HistorialDePersona,
} from "@/lib/historial";

// ─────────────────────────── cómo se ve cada tipo ───────────────────────────

const ICONO: Record<string, typeof Circle> = {
    alta: PlusCircle,
    cabecera: Pencil,
    ficha: Pencil,
    estado: ListChecks,
    pasos: ListOrdered,
    plan: CalendarRange,
    pausas: PauseCircle,
    consumos: Package,
    materia_prima: Boxes,
    no_conformidades: AlertTriangle,
    planos: FileText,
    entregas: Truck,
    habilidades: Award,
    ausencias: CalendarX,
    asignaciones: UserCheck,
    trabajo: Wrench,
};

const COLOR: Record<string, string> = {
    alta: "text-emerald-600 bg-emerald-50 ring-emerald-100",
    cabecera: "text-sky-600 bg-sky-50 ring-sky-100",
    ficha: "text-sky-600 bg-sky-50 ring-sky-100",
    estado: "text-indigo-600 bg-indigo-50 ring-indigo-100",
    pasos: "text-violet-600 bg-violet-50 ring-violet-100",
    plan: "text-blue-600 bg-blue-50 ring-blue-100",
    pausas: "text-amber-600 bg-amber-50 ring-amber-100",
    consumos: "text-teal-600 bg-teal-50 ring-teal-100",
    materia_prima: "text-cyan-700 bg-cyan-50 ring-cyan-100",
    no_conformidades: "text-rose-600 bg-rose-50 ring-rose-100",
    planos: "text-slate-600 bg-slate-100 ring-slate-200",
    entregas: "text-green-700 bg-green-50 ring-green-100",
    habilidades: "text-violet-600 bg-violet-50 ring-violet-100",
    ausencias: "text-amber-600 bg-amber-50 ring-amber-100",
    asignaciones: "text-blue-600 bg-blue-50 ring-blue-100",
    trabajo: "text-emerald-700 bg-emerald-50 ring-emerald-100",
};

/** Cuántas líneas de detalle se ven sin abrir el renglón. */
const LINEAS_A_LA_VISTA = 4;

// ─────────────────────────── un renglón ───────────────────────────

function Renglon({ e, onVerOT }: {
    e: EventoHistorial;
    /** En la línea de tiempo de una persona: tocar la OT la abre en «Por orden». */
    onVerOT?: (ot: { id: number; numero: number }) => void;
}) {
    const [abierto, setAbierto] = useState(false);
    const Icono = ICONO[e.tipo] ?? Circle;
    const lineas = abierto ? e.lineas : e.lineas.slice(0, LINEAS_A_LA_VISTA);
    const resto = e.lineas.length - LINEAS_A_LA_VISTA;
    // La frase del registro ya dice «(no se pudo: error 409)»; el cartel va sólo si no.
    const cartelNoSePudo = !e.salio_bien && !e.titulo.includes("no se pudo");

    return (
        <li className={cn("flex gap-2.5 sm:gap-3 px-3 sm:px-4 py-2", !e.salio_bien && "bg-rose-50/60")}>
            <span className="w-10 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{horaDe(e)}</span>
            <span className={cn("mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full ring-1",
                COLOR[e.tipo] ?? "text-gray-500 bg-gray-50 ring-gray-200")}>
                <Icono className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
                <p className={cn("text-sm break-words", e.salio_bien ? "text-gray-800" : "text-rose-700")}
                   title={e.fuente ? `Sale de: ${e.fuente}` : undefined}>
                    {e.quien ? (
                        <>
                            <span className="font-medium">{e.quien}</span> {e.titulo}
                        </>
                    ) : fraseCompleta(e)}
                    {cartelNoSePudo && (
                        <Badge variant="outline" className="ml-1.5 text-[10px] font-normal border-rose-200 text-rose-700">
                            no se pudo
                        </Badge>
                    )}
                </p>
                {lineas.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5 text-xs text-gray-600">
                        {lineas.map((l, i) => (
                            <li key={i} className="break-words">{l}</li>
                        ))}
                    </ul>
                )}
                {resto > 0 && (
                    <button
                        type="button"
                        onClick={() => setAbierto(!abierto)}
                        className="mt-0.5 text-xs text-sky-700 underline-offset-2 hover:underline"
                    >
                        {abierto ? "Ver menos" : `Ver ${resto} más`}
                    </button>
                )}
                {(e.ot || e.deducido || e.nota) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        {e.ot && (onVerOT ? (
                            <button
                                type="button"
                                onClick={() => onVerOT(e.ot!)}
                                title={`Ver todo lo que pasó con la OT ${e.ot.numero}`}
                                className="rounded-full border px-2 py-px text-gray-700 hover:bg-muted"
                            >
                                OT {e.ot.numero}
                            </button>
                        ) : (
                            <span className="rounded-full border px-2 py-px">OT {e.ot.numero}</span>
                        ))}
                        {e.deducido && (
                            <Badge variant="outline" className="text-[10px] font-normal border-amber-200 text-amber-700">
                                deducido
                            </Badge>
                        )}
                        {e.nota && <span className="italic">{e.nota}</span>}
                    </div>
                )}
            </div>
        </li>
    );
}

export function LineaDeTiempo({ eventos, onVerOT, className }: {
    eventos: EventoHistorial[];
    onVerOT?: (ot: { id: number; numero: number }) => void;
    className?: string;
}) {
    // Agrupados por día, en el orden en que llegan (lo último primero).
    const dias = useMemo(() => {
        const grupos: { dia: string; eventos: EventoHistorial[] }[] = [];
        for (const e of eventos) {
            const dia = diaDe(e);
            const ultimo = grupos[grupos.length - 1];
            if (ultimo && ultimo.dia === dia) ultimo.eventos.push(e);
            else grupos.push({ dia, eventos: [e] });
        }
        return grupos;
    }, [eventos]);

    return (
        <ul className={cn("divide-y", className)}>
            {dias.map((g) => (
                <li key={g.dia || "sin-fecha"}>
                    <div className="px-3 sm:px-4 py-1.5 bg-muted/30 text-xs font-medium text-gray-600 flex items-center justify-between gap-2">
                        <span>{tituloDelDia(g.dia)}</span>
                        <span className="tabular-nums text-muted-foreground font-normal">
                            {g.eventos.length} {g.eventos.length === 1 ? "cosa" : "cosas"}
                        </span>
                    </div>
                    <ul className="divide-y divide-gray-100">
                        {g.eventos.map((e) => <Renglon key={e.id} e={e} onVerOT={onVerOT} />)}
                    </ul>
                </li>
            ))}
        </ul>
    );
}

// ─────────────────────────── el marco: filtros, exportar, avisos ───────────────────────────

type Datos = HistorialDeOrden | HistorialDePersona;

function columnasDeExport(catalogo: Record<string, string>, conOT: boolean): ColumnaExport<EventoHistorial>[] {
    return [
        { titulo: "Fecha", tipo: "fechaHora", valor: (e) => e.cuando },
        { titulo: "Tipo", valor: (e) => catalogo[e.tipo] ?? e.tipo },
        { titulo: "Quién", valor: (e) => e.quien ?? "" },
        { titulo: "Qué pasó", valor: (e) => e.titulo },
        { titulo: "Detalle", valor: (e) => e.lineas.join(" · ") },
        ...(conOT ? [{ titulo: "OT", tipo: "id" as const, valor: (e: EventoHistorial) => e.ot?.numero ?? null }] : []),
        { titulo: "Resultado", valor: (e) => (e.salio_bien ? "Bien" : "No se pudo") },
        { titulo: "Aclaración", valor: (e) => [e.deducido ? "Deducido" : "", e.nota ?? ""].filter(Boolean).join(". ") },
        { titulo: "Sale de", valor: (e) => e.fuente },
    ];
}

export function VistaDeHistorial({
    datos, actualizando, periodo, onPeriodo, tituloExport, archivoExport, filtrosExport,
    onVerOT, vacio,
}: {
    datos: Datos;
    actualizando: boolean;
    periodo: PeriodoAuditoria;
    onPeriodo: (p: PeriodoAuditoria) => void;
    tituloExport: string;
    archivoExport: string;
    /** Qué se está mirando («OT 15300 — ACME S.A.»), para el encabezado del archivo. */
    filtrosExport: string[];
    onVerOT?: (ot: { id: number; numero: number }) => void;
    /** Qué decir si no hay nada en el período. */
    vacio: string;
}) {
    const [tipo, setTipo] = useState<string | null>(null);
    // tipo -> cómo se llama («no_conformidades» -> «No conformidades»): lo manda el servidor.
    const catalogo = useMemo(
        () => Object.fromEntries(datos.tipos.map((t) => [t.tipo, t.texto])) as Record<string, string>,
        [datos.tipos],
    );
    // Si el tipo elegido ya no tiene renglones en el período nuevo, se suelta.
    const tipoVigente = tipo && datos.tipos.some((t) => t.tipo === tipo) ? tipo : null;
    const eventos = useMemo(
        () => (tipoVigente ? datos.eventos.filter((e) => e.tipo === tipoVigente) : datos.eventos),
        [datos.eventos, tipoVigente],
    );
    const conOT = datos.eventos.some((e) => e.ot);
    const columnas = useMemo(() => columnasDeExport(catalogo, conOT), [catalogo, conOT]);
    const desdeRegistro = datos.desde_cuando?.registro;

    return (
        <div className="space-y-3">
            <div className="rounded-lg border bg-card p-3 space-y-2">
                <FiltroDeFechas periodo={periodo} onCambiar={onPeriodo} />
                {datos.tipos.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {datos.tipos.map((t) => {
                            const activo = tipoVigente === t.tipo;
                            return (
                                <button
                                    key={t.tipo}
                                    type="button"
                                    onClick={() => setTipo(activo ? null : t.tipo)}
                                    aria-pressed={activo}
                                    className={cn(
                                        "text-xs px-2 py-1 rounded-full border transition-colors",
                                        activo ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted text-muted-foreground",
                                    )}
                                >
                                    {t.texto} <span className="tabular-nums opacity-60">{t.cuantos}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <section className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/40 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2 min-w-0">
                        <span className="truncate">
                            {eventos.length.toLocaleString("es-AR")} {eventos.length === 1 ? "cosa" : "cosas"}
                            <span className="font-normal text-muted-foreground">
                                {" "}· {tipoVigente ? `${catalogo[tipoVigente] ?? tipoVigente} · ` : ""}{textoDelPeriodo(periodo)}
                            </span>
                        </span>
                        {actualizando && <Spinner className="h-3.5 w-3.5 shrink-0" />}
                    </h3>
                    <ExportarMenu
                        titulo={tituloExport}
                        archivo={archivoExport}
                        filas={eventos}
                        columnas={columnas}
                        filtros={() => [
                            ...filtrosExport,
                            `Período: ${textoDelPeriodo(periodo)}`,
                            ...(tipoVigente ? [`Tipo: ${catalogo[tipoVigente] ?? tipoVigente}`] : []),
                            ...(datos.recortado ? [`Los ${datos.tope.toLocaleString("es-AR")} más recientes de ${datos.total.toLocaleString("es-AR")}`] : []),
                        ]}
                    />
                </div>
                {eventos.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">{vacio}</p>
                ) : (
                    <LineaDeTiempo
                        eventos={eventos}
                        onVerOT={onVerOT}
                        className={cn("transition-opacity", actualizando && "opacity-60")}
                    />
                )}
            </section>

            {(datos.recortado || datos.ocultos.length > 0 || datos.avisos.length > 0 || desdeRegistro) && (
                <div className="space-y-1.5 text-xs">
                    {datos.recortado && (
                        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                            <Info className="h-3.5 w-3.5 mt-px shrink-0" />
                            Hay {datos.total.toLocaleString("es-AR")} cosas en este período: se muestran las{" "}
                            {datos.tope.toLocaleString("es-AR")} más recientes. Para ver el resto, acotá las fechas.
                        </p>
                    )}
                    {datos.avisos.map((a) => (
                        <p key={a} className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                            {a}
                        </p>
                    ))}
                    {datos.ocultos.map((o) => (
                        <p key={o.que} className="flex items-start gap-1.5 text-muted-foreground">
                            <Info className="h-3.5 w-3.5 mt-px shrink-0" />
                            {o.texto}
                        </p>
                    ))}
                    {desdeRegistro && (
                        <p className="flex items-start gap-1.5 text-muted-foreground">
                            <Info className="h-3.5 w-3.5 mt-px shrink-0" />
                            El registro de quién hizo qué empieza el {fechaCorta(desdeRegistro)}: lo anterior no quedó
                            guardado. Las pausas, los consumos, las no conformidades y lo trabajado salen de sus
                            propias tablas y pueden ser anteriores.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
