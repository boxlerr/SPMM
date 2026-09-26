"use client";

/**
 * Panel «Carga de recurso humano» de la vista previa: cuánto le toca a cada persona
 * y cuánto puede trabajar, por semana o en todo el plan, con la cuenta A LA VISTA.
 *
 * Queja 6 de Julián (25/09/2026): la tarjeta decía «109,8h / 173,3h» y la única
 * explicación del 173,3 era un cartelito que en la tablet no aparece. Acá la cuenta va
 * escrita debajo de cada barra («= 5 días × 8,25 h de jornada») y el detalle se abre
 * con un toque (Popover), nunca con el mouse encima.
 *
 * Solo dibuja el contenido del panel abierto (encabezado, lista y pie). El contenedor,
 * el riel plegado, `saltoCarga` y el contador del globito siguen en
 * PlanningPreviewScreen. Las cuentas viven en `lib/cargaDelPlan.ts`, que tiene su test.
 *
 * Es de solo lectura: no recalcula ni asigna nada.
 */

import * as React from "react";
import {
    AlertCircle,
    AlertTriangle,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    Info,
    User,
    Users,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { numeroEs } from "@/lib/diasHabiles";
import {
    armarCargaDelPlan,
    diaCorto,
    diaCortoMayuscula,
    diaYMes,
    diasDeLaPersona,
    horas,
    horasYMinutos,
    listaDeNombres,
    porQueHasta,
    recortesDeLaSemana,
    resumenDelPeriodo,
    sinNadiePorRango,
    type CargaDelPlan,
    type CeldaDia,
    type CeldaSemana,
    type Estado,
    type FilaDeCarga,
    type OperarioDeCarga,
    type ResumenDelPeriodo,
    type ResumenPersona,
    type Tramo,
} from "@/lib/cargaDelPlan";

// ─── Props ────────────────────────────────────────────────────────────────────

type Span = { desde: string; hasta: string; habiles: number };

export interface PanelCargaRecursoHumanoProps {
    filas: FilaDeCarga[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    operarios: any[];
    cargaPrevia: Record<number, number>;
    feriados: string[];
    span: Span | null;
    periodoSinFechas: Span | null;
    diasDelTaller: Set<number>;
    excedentesMin: number;
    rangos: Array<{ id: number; nombre: string }>;
    saltoCarga: { opId: number; antes: number; despues: number } | null;
    completa: boolean;
    onAlternarCompleta: () => void;
    onPlegar: () => void;
    /** Recibe el `orden_id` INTERNO, nunca el número del sistema viejo. */
    onVerOT: (ordenId: number) => void;
    onVerSinNadie?: () => void;
    onIrAAvisos?: () => void;
    /** La «Carga total» del encabezado. Si no cuadra con el desglose, no se dice que es la misma. */
    cargaTotalMin?: number;
}

// ─── Estilos compartidos ──────────────────────────────────────────────────────

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";
const POPOVER = "w-[min(320px,calc(100vw-2rem))] p-3";
const RAYADO = "bg-[repeating-linear-gradient(135deg,#f3f4f6_0_4px,#e5e7eb_4px_8px)] text-gray-400";

/** El número de la OT que la gente conoce; el que se pasa a `onVerOT` es el interno. */
const numeroOT = (f: FilaDeCarga) => f.id_otvieja || f.orden_id;

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** Color de una celda de la tira según cuánto de su capacidad tiene ocupado. */
function colorDeCelda(min: number, cap: number): string {
    if (cap === 0) return min > 0 ? "bg-rose-500 text-white" : RAYADO;
    if (min === 0) return "bg-white border border-gray-200 text-gray-400";
    if (min > cap + 15) return "bg-rose-500 text-white";
    const r = min / cap;
    if (r <= 0.34) return "bg-indigo-100 text-indigo-900";
    if (r <= 0.67) return "bg-indigo-200 text-indigo-900";
    if (r < 0.95) return "bg-indigo-400 text-white";
    return "bg-indigo-600 text-white";
}

/** El número de la celda. Un día lleno escribe la jornada exacta para no parecer pasado. */
function textoDeCelda(min: number, cap: number, feriado: boolean, decimales = 1): string {
    if (cap === 0 && min === 0) return feriado ? "Feriado" : "—";
    if (min === 0) return "0";
    if (cap > 0 && min >= cap - 1 && min <= cap + 15) return numeroEs(cap / 60, decimales === 0 ? 0 : 2);
    const t = numeroEs(min / 60, decimales);
    return min > cap + 15 ? `${t}!` : t;
}

/** Las horas de un día. Un día lleno dice la jornada justa (8,25 h y no 8,3 h). */
const horasDelDia = (min: number, cap: number) =>
    cap > 0 && min >= cap - 1 && min <= cap + 15 ? horas(cap, 2) : horas(min);

const pasadaDelDia = (c: { min: number; cap: number }) => (c.cap === 0 ? c.min > 0 : c.min > c.cap + 15);

/** "Semana del lun 28/9 al vie 2/10" / "Todo el plan: del lun 28/9 al lun 26/10". */
function nombreDelPeriodo(r: ResumenDelPeriodo): string {
    if (r.semana) {
        const d = r.semana.dias;
        return d.length === 1 ? `Semana: solo el ${diaCorto(d[0])}` : `Semana del ${diaCorto(d[0])} al ${diaCorto(d[d.length - 1])}`;
    }
    if (r.desde && r.hasta) return `Todo el plan: del ${diaCorto(r.desde)} al ${diaCorto(r.hasta)}`;
    return "Una semana de 5 días";
}

/** Los feriados cargados entre dos días: «ninguno» o «12/10 y 9/11». */
function feriadosEntre(carga: CargaDelPlan, desde: string | null, hasta: string | null): string {
    const lista = [...carga.feriados].filter(f => (!desde || f >= desde) && (!hasta || f <= hasta)).sort();
    return lista.length === 0 ? "ninguno" : listaDeNombres(lista.map(diaYMes));
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function PanelCargaRecursoHumano(props: PanelCargaRecursoHumanoProps) {
    const {
        filas, operarios, cargaPrevia, feriados, span, periodoSinFechas, diasDelTaller,
        excedentesMin, rangos, saltoCarga, completa, onAlternarCompleta, onPlegar, onVerOT,
        onVerSinNadie, onIrAAvisos, cargaTotalMin,
    } = props;

    // Lo que pide el rango TERCERIZADO y quedó sin persona es trabajo que se manda afuera,
    // no un hueco del taller. La marca `tercerizado` del backend sale del NOMBRE del proceso
    // y no ve el rango, así que el cilindrado de chapa (rango TERCERIZADO) caía en «Sin
    // nadie asignado · Piden TERCERIZADO», mientras el aviso del plan decía lo contrario:
    // «salen del taller, nada que corregir». Mismo criterio que el backend para decidir si
    // un paso lleva máquina (cruce con el rango TERCERIZADO).
    const idsTercerizado = React.useMemo(
        () => new Set(rangos.filter(r => (r.nombre || "").toUpperCase().includes("TERCERIZ")).map(r => r.id)),
        [rangos]
    );
    const filasConTerceros = React.useMemo(
        () => idsTercerizado.size === 0 ? filas : filas.map(f =>
            !f.id_operario && !f.tercerizado && (f.rangos_permitidos_proceso || []).some(id => idsTercerizado.has(id))
                ? { ...f, tercerizado: true }
                : f),
        [filas, idsTercerizado]
    );

    const carga = React.useMemo(
        () => armarCargaDelPlan({
            filas: filasConTerceros,
            operarios: (operarios || []) as OperarioDeCarga[],
            cargaPrevia,
            feriados,
            span,
            periodoSinFechas,
            diasDelTaller,
            excedentesMin,
        }),
        [filasConTerceros, operarios, cargaPrevia, feriados, span, periodoSinFechas, diasDelTaller, excedentesMin]
    );

    // Siempre abre en la primera semana: la del piloto. No se guarda a propósito.
    const primera = carga.semanas.length > 1 ? carga.semanas[0].clave : "todo";
    const [periodo, setPeriodo] = React.useState<string>(primera);
    const [filtroEstado, setFiltroEstado] = React.useState<Estado | null>(null);
    const [abiertas, setAbiertas] = React.useState<Set<number>>(() => new Set());
    const [verSinNadie, setVerSinNadie] = React.useState(false);
    const [verSinTrabajo, setVerSinTrabajo] = React.useState<boolean | null>(null);
    const [verNoDisponibles, setVerNoDisponibles] = React.useState(false);
    const [verDesglose, setVerDesglose] = React.useState(false);
    const sinNadieRef = React.useRef<HTMLDivElement>(null);

    // Plan nuevo (otro arranque): vuelve a la primera semana.
    React.useEffect(() => {
        setPeriodo(primera);
        setFiltroEstado(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [span?.desde]);

    // Si la semana elegida dejó de existir (el plan se acortó), se vuelve a la primera.
    const periodoEfectivo = carga.semanas.length <= 1
        ? "todo"
        : periodo === "todo" || carga.semanas.some(s => s.clave === periodo) ? periodo : primera;

    const resumen = React.useMemo(() => resumenDelPeriodo(carga, periodoEfectivo), [carga, periodoEfectivo]);

    // A quien le saltó la carga se lo trae a la vista.
    React.useEffect(() => {
        if (!saltoCarga) return;
        const el = document.querySelector(`[data-carga-persona="${saltoCarga.opId}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [saltoCarga]);

    const nombreRango = React.useCallback(
        (id: number) => rangos.find(r => r.id === id)?.nombre ?? `#${id}`,
        [rangos]
    );

    const esTodo = resumen.esTodo;
    const enEste = esTodo ? "en todo el plan" : "esta semana";

    // La lista: con trabajo en el período, más la persona del salto mientras dura.
    const lista = React.useMemo(() => {
        const orden = { pasado: 0, lleno: 1, conLugar: 2, sinTrabajo: 3 } as const;
        return resumen.personas
            .filter(r => r.totalMin > 0 || r.op.id === saltoCarga?.opId)
            .filter(r => !filtroEstado || r.estado === filtroEstado)
            .sort((a, b) =>
                (a.estado === "pasado" ? 0 : 1) - (b.estado === "pasado" ? 0 : 1)
                || b.pct - a.pct
                || orden[a.estado] - orden[b.estado]
                || a.nombre.localeCompare(b.nombre, "es"));
    }, [resumen, filtroEstado, saltoCarga]);

    const alternarAbierta = (id: number) =>
        setAbiertas(prev => {
            const s = new Set(prev);
            if (s.has(id)) s.delete(id); else s.add(id);
            return s;
        });

    const sinNadieMin = resumen.desglose.sinNadieMin + resumen.desglose.vacantesMin;
    const sinTrabajoAbierto = verSinTrabajo ?? resumen.conTrabajo.length === 0;
    const pasados = resumen.conteo.pasado;

    return (
        <>
            {/* ── Encabezado: no scrollea ── */}
            <div className="px-4 py-3 border-b border-gray-200 bg-white/50 space-y-2">
                <div className="flex items-center gap-2">
                    <h3 className="min-w-0 flex-1 text-sm font-bold text-gray-800 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                        <User className="w-4 h-4 text-gray-500" />
                        Carga de recurso humano
                        {pasados > 0 && (
                            <span className="rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold px-2 py-0.5 tabular-nums">
                                {pasados} {plural(pasados, "pasado", "pasados")}
                            </span>
                        )}
                    </h3>
                    <button
                        type="button"
                        onClick={onPlegar}
                        title="Plegar el panel y darle el ancho a la tabla"
                        aria-label="Plegar el panel y darle el ancho a la tabla"
                        className={cn("p-1 -mr-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 shrink-0", FOCO)}
                    >
                        {/* Apilado se pliega para arriba; al costado, hacia la derecha. */}
                        <ChevronRight className="w-4 h-4 -rotate-90 lg:rotate-0" />
                    </button>
                </div>

                {carga.semanas.length > 1 && (
                    <SelectorDePeriodo carga={carga} periodo={periodoEfectivo} onElegir={p => { setPeriodo(p); setFiltroEstado(null); }} />
                )}

                <LineaDelPeriodo carga={carga} resumen={resumen} span={span} onVerOT={onVerOT} onIrAAvisos={onIrAAvisos} />
            </div>

            {/* ── Zona que scrollea. Scroll nativo: el Viewport de Radix con `max-h`
                corta la lista (ver el comentario del contenedor en PlanningPreviewScreen). ── */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3">
                {carga.personas.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-[13px] text-gray-600">
                        No se pudieron leer las personas de Recursos. Volvé a abrir la vista previa.
                    </p>
                ) : (
                    <>
                        {/* La caja de ayuda que iba acá («Cada tarjeta dice cuántas horas…
                            un día de trabajo son 8,25 h…») se sacó: Julián, 26/9, «no suma».
                            Cada tarjeta ya escribe su cuenta («= 5 días × 8,25 h de jornada») y
                            el ⓘ de «que puede» abre el detalle del horario. */}

                        {/* Todo el equipo */}
                        <TarjetaEquipo
                            carga={carga}
                            resumen={resumen}
                            onElegirSemana={clave => { setPeriodo(clave); setFiltroEstado(null); }}
                            verDesglose={verDesglose}
                            onAlternarDesglose={() => setVerDesglose(v => !v)}
                            cargaTotalMin={cargaTotalMin}
                        />
                        {carga.span && <Leyenda />}

                        {/* c) Chips de estado */}
                        <ChipsDeEstado resumen={resumen} filtro={filtroEstado} onFiltro={setFiltroEstado} />

                        {/* d) Sin nadie asignado */}
                        {sinNadieMin > 0 && (
                            <div ref={sinNadieRef}>
                                <BloqueSinNadie
                                    resumen={resumen}
                                    enEste={enEste}
                                    abierto={verSinNadie}
                                    onAlternar={() => setVerSinNadie(v => !v)}
                                    nombreRango={nombreRango}
                                    onVerOT={onVerOT}
                                    onVerSinNadie={onVerSinNadie}
                                    onIrAAvisos={onIrAAvisos}
                                />
                            </div>
                        )}

                        {/* e) Las tarjetas */}
                        {resumen.conTrabajo.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-gray-300 bg-white p-3 text-[13px] text-gray-600">
                                {esTodo ? "Nadie tiene trabajo en este plan." : "Nadie tiene trabajo esta semana en este plan."}
                            </p>
                        ) : lista.length === 0 && filtroEstado ? (
                            <p className="rounded-lg border border-dashed border-gray-300 bg-white p-3 text-[13px] text-gray-600">
                                Nadie {filtroEstado === "pasado" ? "pasado" : filtroEstado === "lleno" ? "lleno" : "con lugar"} en este período.{" "}
                                <button type="button" onClick={() => setFiltroEstado(null)} className={cn("font-semibold text-indigo-700 underline", FOCO)}>
                                    Ver todos
                                </button>
                            </p>
                        ) : (
                            <div className={cn(completa ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : "grid grid-cols-1 sm:grid-cols-2 gap-3 lg:flex lg:flex-col")}>
                                {lista.map(r => (
                                    <TarjetaPersona
                                        key={r.op.id}
                                        r={r}
                                        carga={carga}
                                        resumen={resumen}
                                        abierta={abiertas.has(r.op.id)}
                                        onAlternar={() => alternarAbierta(r.op.id)}
                                        salto={saltoCarga?.opId === r.op.id ? saltoCarga : null}
                                        previaTotalMin={Math.max(0, Number(cargaPrevia?.[r.op.id]) || 0)}
                                        nombreRango={nombreRango}
                                        onVerOT={onVerOT}
                                        onElegirSemana={clave => { setPeriodo(clave); setFiltroEstado(null); }}
                                    />
                                ))}
                            </div>
                        )}

                        {/* f) Grupos plegados */}
                        {resumen.sinTrabajo.length > 0 && (
                            <GrupoPlegado
                                titulo={`${esTodo ? "Sin trabajo en este plan" : "Sin trabajo esta semana"} · ${resumen.sinTrabajo.length}`}
                                abierto={sinTrabajoAbierto}
                                onAlternar={() => setVerSinTrabajo(!sinTrabajoAbierto)}
                            >
                                <ul className="divide-y divide-gray-100">
                                    {resumen.sinTrabajo
                                        .slice()
                                        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
                                        .map(r => (
                                            <li key={r.op.id} className="py-1.5 text-[12px] text-gray-700">
                                                <span className="font-medium text-gray-800">{r.nombre}</span>
                                                {r.op.sector && <span className="text-gray-500"> · {r.op.sector}</span>}
                                                <span className="text-gray-500 tabular-nums">
                                                    {r.cap.minutos === 0 ? " · no trabaja estos días" : ` · ${horas(r.cap.minutos, 2)} libres`}
                                                </span>
                                            </li>
                                        ))}
                                </ul>
                            </GrupoPlegado>
                        )}
                        {resumen.noDisponibles.length > 0 && (
                            <GrupoPlegado
                                titulo={`No disponibles en Recursos · ${resumen.noDisponibles.length}`}
                                abierto={verNoDisponibles}
                                onAlternar={() => setVerNoDisponibles(v => !v)}
                            >
                                <p className="text-[12px] text-gray-600 mb-1">
                                    Figuran como no disponibles en Recursos: el plan no les da trabajo.
                                </p>
                                <p className="text-[12px] text-gray-800">
                                    {listaDeNombres(resumen.noDisponibles.map(r => r.nombre).sort((a, b) => a.localeCompare(b, "es")))}.
                                </p>
                            </GrupoPlegado>
                        )}
                    </>
                )}
            </div>

            {/* ── Pie: ensancha el panel y pone las tarjetas de a dos. ── */}
            <div className="p-3 border-t border-gray-200 bg-white/60">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onAlternarCompleta}
                    className="w-full h-8 gap-1.5 text-xs text-gray-600 hover:text-gray-900"
                >
                    <Users className="w-3.5 h-3.5" />
                    {completa ? "Ver compacto" : "Ver carga completa"}
                </Button>
            </div>
        </>
    );
}

export default PanelCargaRecursoHumano;

// ─── Encabezado ───────────────────────────────────────────────────────────────

function SelectorDePeriodo({ carga, periodo, onElegir }: {
    carga: CargaDelPlan;
    periodo: string;
    onElegir: (p: string) => void;
}) {
    return (
        <div
            role="group"
            aria-label="Qué período mirar"
            className="flex gap-1 overflow-x-auto snap-x p-0.5 -m-0.5"
        >
            {carga.semanas.map(s => {
                const eq = carga.equipoPorSemana[s.clave];
                const pct = eq && eq.cap > 0 ? Math.round((eq.min / eq.cap) * 100) : 0;
                const elegido = periodo === s.clave;
                const d = s.dias;
                return (
                    <button
                        key={s.clave}
                        type="button"
                        aria-pressed={elegido}
                        aria-label={`${d.length === 1 ? `Semana: solo el ${diaCorto(d[0])}` : `Semana del ${diaCorto(d[0])} al ${diaCorto(d[d.length - 1])}`}: equipo ocupado ${pct} %`}
                        onClick={() => onElegir(s.clave)}
                        className={cn(
                            "snap-start flex-1 min-w-[40px] h-11 rounded-md px-1.5 flex flex-col items-center justify-center gap-1 transition-colors",
                            elegido ? "bg-white ring-2 ring-indigo-500 text-indigo-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                            FOCO
                        )}
                    >
                        <span className="text-[12px] font-semibold tabular-nums leading-none">{diaYMes(d[0])}</span>
                        <span className="block h-[3px] w-full max-w-[40px] rounded-full bg-indigo-100 overflow-hidden" aria-hidden>
                            <span className="block h-full bg-indigo-600 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                        </span>
                    </button>
                );
            })}
            <button
                type="button"
                aria-pressed={periodo === "todo"}
                onClick={() => onElegir("todo")}
                className={cn(
                    // Separado por un borde: no es una semana más. En dos renglones para
                    // que las cinco semanas y esto entren en los 348 px del panel.
                    "snap-start shrink-0 w-[54px] h-11 rounded-md px-1 text-[12px] font-semibold leading-tight ml-1 relative before:absolute before:-left-1 before:top-1 before:bottom-1 before:w-px before:bg-gray-300",
                    periodo === "todo" ? "bg-white ring-2 ring-indigo-500 text-indigo-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                    FOCO
                )}
            >
                Todo el plan
            </button>
        </div>
    );
}

function LineaDelPeriodo({ carga, resumen, span, onVerOT, onIrAAvisos }: {
    carga: CargaDelPlan;
    resumen: ResumenDelPeriodo;
    span: Span | null;
    onVerOT: (id: number) => void;
    onIrAAvisos?: () => void;
}) {
    if (!carga.span) {
        const p = carga.periodoSinFechas;
        return (
            <p className="text-[12px] text-gray-600">
                {p
                    ? `Sin fechas en el plan: se compara contra lo que trabaja cada uno del ${diaCorto(p.desde)} al ${diaCorto(p.hasta)}, el rango elegido al planificar.`
                    : "Sin fechas en el plan: se compara contra una semana de 5 días con la jornada de cada uno."}
            </p>
        );
    }
    if (resumen.semana) {
        const s = resumen.semana;
        const n = s.dias.length;
        const { arranca, termina } = recortesDeLaSemana(carga, s);
        return (
            <p className="text-[12px] text-gray-600">
                {nombreDelPeriodo(resumen)} · <span className="tabular-nums">{n}</span> {plural(n, "día hábil", "días hábiles")}
                {arranca && ` (el plan arranca el ${diaCorto(arranca)})`}
                {termina && ` (el plan termina el ${diaCorto(termina)})`}
            </p>
        );
    }
    const habiles = span?.habiles ?? carga.diasDelPlan.length;
    return (
        <p className="text-[12px] text-gray-600">
            {nombreDelPeriodo(resumen)} · <span className="tabular-nums">{habiles}</span> {plural(habiles, "día hábil", "días hábiles")} ·{" "}
            <PorQueHasta carga={carga} onVerOT={onVerOT} onIrAAvisos={onIrAAvisos} />
        </p>
    );
}

function PorQueHasta({ carga, onVerOT, onIrAAvisos }: {
    carga: CargaDelPlan;
    onVerOT: (id: number) => void;
    onIrAAvisos?: () => void;
}) {
    const [abierto, setAbierto] = React.useState(false);
    const info = React.useMemo(() => porQueHasta(carga), [carga]);
    if (!carga.span) return null;
    const hasta = carga.span.hasta.slice(0, 10);
    const u = info.ultimo;
    const persona = u?.id_operario != null
        ? [...carga.personas, ...carga.ocultas, ...carga.vacantes].find(p => p.op.id === u.id_operario)?.nombre ?? u.operario_nombre
        : null;
    const hora = info.fin ? `${String(info.fin.getHours()).padStart(2, "0")}:${String(info.fin.getMinutes()).padStart(2, "0")}` : null;
    const n = info.trabajanLaUltimaSemana.length;
    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" className={cn("font-semibold text-indigo-700 underline decoration-dotted underline-offset-2", FOCO)}>
                    ¿Por qué hasta el {diaYMes(hasta)}?
                </button>
            </PopoverTrigger>
            <PopoverContent className={POPOVER} collisionPadding={16} align="start">
                <div className="space-y-2 text-[12px] leading-snug text-gray-700">
                    <p className="text-[13px] font-semibold text-gray-900">Por qué el plan llega hasta el {diaCorto(hasta)}</p>
                    {u && (
                        <p>
                            Lo último que termina es <span className="font-semibold">{u.nombre_proceso}</span> de la OT{" "}
                            <button
                                type="button"
                                onClick={() => { setAbierto(false); onVerOT(u.orden_id); }}
                                className={cn("font-semibold text-indigo-700 underline tabular-nums", FOCO)}
                            >
                                #{numeroOT(u)}
                            </button>
                            {u.maquinaria_nombre && `, en la ${u.maquinaria_nombre}`}
                            {persona && ` (${persona})`}, el {diaCorto(hasta)}{hora && ` a las ${hora}`}.
                        </p>
                    )}
                    {carga.semanas.length > 1 && n >= 1 && n <= 3 && (
                        <p>
                            Esa última semana {n === 1 ? "trabaja 1 persona" : `trabajan ${n} personas`}: {listaDeNombres(info.trabajanLaUltimaSemana)}.
                            El resto del taller ya terminó lo suyo antes.
                        </p>
                    )}
                    <p>
                        Se cuentan los días {info.diasDelTaller}, sin feriados. Feriados cargados entre el{" "}
                        {diaYMes(carga.span.desde)} y el {diaYMes(hasta)}: {info.feriados.length === 0 ? "ninguno" : listaDeNombres(info.feriados.map(diaYMes))}.
                        Si algún día no se trabaja, se carga en Configuración › Disponibilidad.
                    </p>
                    {onIrAAvisos && (
                        <button
                            type="button"
                            onClick={() => { setAbierto(false); onIrAAvisos(); }}
                            className={cn("font-semibold text-indigo-700 hover:underline", FOCO)}
                        >
                            Ver los avisos ›
                        </button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

// ─── Equipo ───────────────────────────────────────────────────────────────────

function TarjetaEquipo({ carga, resumen, onElegirSemana, verDesglose, onAlternarDesglose, cargaTotalMin }: {
    carga: CargaDelPlan;
    resumen: ResumenDelPeriodo;
    onElegirSemana: (clave: string) => void;
    verDesglose: boolean;
    onAlternarDesglose: () => void;
    cargaTotalMin?: number;
}) {
    const eq = resumen.equipo;
    const dz = resumen.desglose;
    const nConTrabajo = eq.conTrabajo.length;
    const hayAyudantes = resumen.esTodo && carga.personas.some(p => p.tramos.some(t => t.fila.slot_extra));
    const cuadra = cargaTotalMin == null || Math.abs(cargaTotalMin - dz.totalMin) <= 1;
    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Todo el equipo</span>
                <span className="text-[11px] text-gray-500">{resumen.esTodo ? "en todo el plan" : "esta semana"}</span>
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-2xl font-bold text-indigo-900 tabular-nums">{eq.pct} %</span>
                <span className="text-[12px] text-gray-600 tabular-nums">
                    ocupado · {numeroEs(eq.ocupadoMin / 60, 0)} h de {numeroEs(eq.capMin / 60, 0)} h que pueden
                </span>
            </div>
            <div className="h-2 w-full rounded-full bg-indigo-100 overflow-hidden" aria-hidden>
                <div
                    className="h-full rounded-full bg-indigo-600 motion-safe:transition-[width] duration-500"
                    style={{ width: `${Math.min(100, eq.pct)}%` }}
                />
            </div>
            {carga.span && (
                <TiraDeDias
                    celdas={resumen.esTodo ? null : eq.celdas}
                    celdasSemana={resumen.esTodo ? eq.celdasSemana : null}
                    decimales={0}
                    onElegirSemana={onElegirSemana}
                />
            )}
            {!resumen.esTodo && nConTrabajo >= 1 && nConTrabajo <= 3 && (
                <p className="text-[12px] text-gray-700">
                    Esta semana {nConTrabajo === 1 ? "trabaja 1 persona" : `trabajan ${nConTrabajo} personas`}: {listaDeNombres(eq.conTrabajo)}.
                </p>
            )}
            {/* Lo que no hace nadie del taller va en el bloque «Sin nadie asignado» de
                abajo, con sus OT: repetirlo acá era decirlo dos veces (Julián, 26/9). */}
            {dz.tercerosMin > 0 && (
                <p className="text-[12px] text-gray-700 tabular-nums">
                    Además: {horas(dz.tercerosMin)} de terceros (trabajo que se manda afuera)
                </p>
            )}
            {resumen.esTodo && (
                <div className="border-t border-gray-100 pt-2">
                    <button
                        type="button"
                        aria-expanded={verDesglose}
                        onClick={onAlternarDesglose}
                        className={cn("w-full min-h-8 flex items-center gap-1 text-left text-[12px] font-semibold text-indigo-700", FOCO)}
                    >
                        <span className="flex-1">¿De dónde salen las {horasYMinutos(dz.totalMin)} de «Carga total»?</span>
                        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 motion-safe:transition-transform", verDesglose ? "rotate-180" : "-rotate-90")} />
                    </button>
                    {verDesglose && (
                        <ul className="mt-1.5 space-y-1 text-[12px] text-gray-700 tabular-nums">
                            <RenglonDesglose color="bg-indigo-600" texto={`${horasYMinutos(dz.conAlguienMin)} las hace alguien del taller`} />
                            {dz.vacantesMin > 0 && <RenglonDesglose color="bg-amber-500" texto={`${horasYMinutos(dz.vacantesMin)} en puestos vacantes (nadie las va a hacer)`} />}
                            {dz.sinNadieMin > 0 && <RenglonDesglose color="bg-amber-300" texto={`${horasYMinutos(dz.sinNadieMin)} sin nadie asignado`} />}
                            {dz.tercerosMin > 0 && <RenglonDesglose color="bg-gray-400" texto={`${horasYMinutos(dz.tercerosMin)} de terceros`} />}
                            {dz.excedentesMin > 0 && <RenglonDesglose color="bg-rose-500" texto={`${horasYMinutos(dz.excedentesMin)} no entraron al plan`} />}
                            <li className="pt-1 border-t border-gray-100 font-semibold text-gray-900">
                                = {horasYMinutos(dz.totalMin)}{cuadra && ", la «Carga total» de arriba."}
                            </li>
                            {hayAyudantes && (
                                <li className="text-[11px] text-gray-500">Los procesos con ayudante cuentan las horas de las dos personas.</li>
                            )}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function RenglonDesglose({ color, texto }: { color: string; texto: string }) {
    return (
        <li className="flex items-start gap-2">
            <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", color)} aria-hidden />
            <span>{texto}</span>
        </li>
    );
}

function Leyenda() {
    const Item = ({ clase, texto }: { clase: string; texto: string }) => (
        <span className="inline-flex items-center gap-1">
            <span className={cn("inline-block w-3 h-3 rounded-sm", clase)} aria-hidden />
            {texto}
        </span>
    );
    return (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600 px-0.5">
            <Item clase="bg-white border border-gray-300" texto="sin trabajo" />
            <span className="inline-flex items-center gap-1">
                <span className="inline-flex" aria-hidden>
                    <span className="w-2 h-3 rounded-l-sm bg-indigo-100" />
                    <span className="w-2 h-3 bg-indigo-200" />
                    <span className="w-2 h-3 rounded-r-sm bg-indigo-400" />
                </span>
                más carga
            </span>
            <Item clase="bg-indigo-600" texto="lleno" />
            <Item clase="bg-rose-500" texto="pasado" />
            <Item clase={RAYADO} texto="no trabaja / feriado" />
        </div>
    );
}

// ─── Chips de estado ──────────────────────────────────────────────────────────

function ChipsDeEstado({ resumen, filtro, onFiltro }: {
    resumen: ResumenDelPeriodo;
    filtro: Estado | null;
    onFiltro: (e: Estado | null) => void;
}) {
    const c = resumen.conteo;
    const chips: Array<{ estado: Estado; n: number; texto: string; clase: string; icono: React.ReactNode }> = [
        { estado: "pasado", n: c.pasado, texto: plural(c.pasado, "pasado", "pasados"), clase: "bg-rose-50 text-rose-700 border-rose-200", icono: <AlertTriangle className="w-3.5 h-3.5" /> },
        { estado: "lleno", n: c.lleno, texto: plural(c.lleno, "lleno", "llenos"), clase: "bg-indigo-50 text-indigo-800 border-indigo-200", icono: <span aria-hidden>●</span> },
        { estado: "conLugar", n: c.conLugar, texto: "con lugar", clase: "bg-emerald-50 text-emerald-800 border-emerald-200", icono: <span aria-hidden>○</span> },
    ];
    const visibles = chips.filter(ch => ch.n > 0);
    if (visibles.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5">
            {visibles.map(ch => {
                const activo = filtro === ch.estado;
                return (
                    <button
                        key={ch.estado}
                        type="button"
                        aria-pressed={activo}
                        onClick={() => onFiltro(activo ? null : ch.estado)}
                        className={cn(
                            "min-h-8 inline-flex items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold tabular-nums",
                            ch.clase,
                            activo && "ring-2 ring-offset-1 ring-indigo-500",
                            FOCO
                        )}
                    >
                        {ch.icono}
                        {ch.n} {ch.texto}
                    </button>
                );
            })}
            {filtro && (
                <button
                    type="button"
                    onClick={() => onFiltro(null)}
                    className={cn("min-h-8 inline-flex items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-200", FOCO)}
                >
                    Ver todos <X className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    );
}

// ─── Sin nadie asignado ───────────────────────────────────────────────────────

function ChipsDeOT({ filas, onVerOT }: { filas: FilaDeCarga[]; onVerOT: (id: number) => void }) {
    const [todas, setTodas] = React.useState(false);
    const unicas = React.useMemo(() => {
        const vistas = new Map<number, FilaDeCarga>();
        for (const f of filas) if (!vistas.has(f.orden_id)) vistas.set(f.orden_id, f);
        return [...vistas.values()];
    }, [filas]);
    const mostradas = todas ? unicas : unicas.slice(0, 6);
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {mostradas.map(f => (
                <button
                    key={f.orden_id}
                    type="button"
                    onClick={() => onVerOT(f.orden_id)}
                    className={cn("min-h-7 rounded border border-amber-300 bg-white px-1.5 text-[11px] font-semibold text-amber-900 tabular-nums hover:bg-amber-100", FOCO)}
                >
                    #{numeroOT(f)}
                </button>
            ))}
            {!todas && unicas.length > 6 && (
                <button
                    type="button"
                    onClick={() => setTodas(true)}
                    className={cn("min-h-7 rounded px-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100", FOCO)}
                >
                    +{unicas.length - 6}
                </button>
            )}
        </div>
    );
}

function BloqueSinNadie({ resumen, enEste, abierto, onAlternar, nombreRango, onVerOT, onVerSinNadie, onIrAAvisos }: {
    resumen: ResumenDelPeriodo;
    enEste: string;
    abierto: boolean;
    onAlternar: () => void;
    nombreRango: (id: number) => string;
    onVerOT: (id: number) => void;
    onVerSinNadie?: () => void;
    onIrAAvisos?: () => void;
}) {
    const grupos = React.useMemo(() => sinNadiePorRango(resumen.sinNadie), [resumen.sinNadie]);
    const total = resumen.desglose.sinNadieMin + resumen.desglose.vacantesMin;
    const piden = (ids: number[]) => {
        if (ids.length === 0) return "El proceso no pide rango";
        const nombres = ids.map(nombreRango);
        return `Piden ${nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} o ${nombres[nombres.length - 1]}`}`;
    };
    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 overflow-hidden">
            <button
                type="button"
                aria-expanded={abierto}
                onClick={onAlternar}
                className={cn("w-full min-h-10 px-3 py-2 flex items-center gap-2 text-left text-[13px] font-semibold", FOCO)}
            >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="flex-1 tabular-nums">Sin nadie asignado · {horas(total)} {enEste}</span>
                <ChevronDown className={cn("w-4 h-4 shrink-0 motion-safe:transition-transform", abierto ? "rotate-180" : "-rotate-90")} />
            </button>
            {abierto && (
                <div className="px-3 pb-3 space-y-2.5 text-[12px]">
                    {grupos.map(g => (
                        <div key={g.rangos.join(",") || "sin-rango"}>
                            <p className="tabular-nums">
                                <span className="font-semibold">{piden(g.rangos)}</span> · {g.filas.length} {plural(g.filas.length, "proceso", "procesos")} · {horas(g.min)}
                            </p>
                            <ChipsDeOT filas={g.filas} onVerOT={onVerOT} />
                        </div>
                    ))}
                    {resumen.vacantes.map(v => {
                        const filasV = [...new Set(v.tramos.map(t => t.fila))];
                        const nombre = [v.persona.op.nombre, v.persona.op.apellido].filter(Boolean).join(" ").toUpperCase();
                        return (
                            <div key={v.persona.op.id}>
                                <p className="tabular-nums">
                                    <span className="font-semibold">{nombre}</span> · {filasV.length} {plural(filasV.length, "proceso", "procesos")} · {horas(v.min)}:
                                    es un puesto sin persona, ese trabajo no lo va a hacer nadie.
                                </p>
                                <ChipsDeOT filas={filasV} onVerOT={onVerOT} />
                            </div>
                        );
                    })}
                    {(onVerSinNadie || onIrAAvisos) && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-amber-200">
                            {onVerSinNadie && (
                                <button type="button" onClick={onVerSinNadie} className={cn("min-h-8 font-semibold text-amber-900 hover:underline", FOCO)}>
                                    Ver en la tabla ›
                                </button>
                            )}
                            {onIrAAvisos && (
                                <button type="button" onClick={onIrAAvisos} className={cn("min-h-8 font-semibold text-amber-900 hover:underline", FOCO)}>
                                    Ver los avisos ›
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Tarjeta de persona ───────────────────────────────────────────────────────

const iniciales = (nombre: string) =>
    nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join("") || "?";

/** Los rangos de la persona: pueden venir como ids o como {id, nombre}. */
function rangosDe(op: OperarioDeCarga, nombreRango: (id: number) => string): string[] {
    return (op.rangos || [])
        .map(r => {
            if (r && typeof r === "object") {
                const o = r as { id?: number; nombre?: string };
                return o.nombre || (o.id != null ? nombreRango(o.id) : "");
            }
            const id = Number(r);
            return Number.isFinite(id) ? nombreRango(id) : "";
        })
        .filter(Boolean);
}

function TarjetaPersona({ r, carga, resumen, abierta, onAlternar, salto, previaTotalMin, nombreRango, onVerOT, onElegirSemana }: {
    r: ResumenPersona;
    carga: CargaDelPlan;
    resumen: ResumenDelPeriodo;
    abierta: boolean;
    onAlternar: () => void;
    salto: { antes: number; despues: number } | null;
    previaTotalMin: number;
    nombreRango: (id: number) => string;
    onVerOT: (id: number) => void;
    onElegirSemana: (clave: string) => void;
}) {
    const op = r.op;
    const rangosNombres = rangosDe(op, nombreRango);
    const subtitulo = op.sector || rangosNombres[0] || "Sin sector";
    const pasado = r.estado === "pasado";
    const lleno = r.estado === "lleno";
    const capH = horas(r.cap.minutos, 2);
    const anchoPrevia = r.cap.minutos > 0 ? Math.min(100, (r.previaMin / r.cap.minutos) * 100) : 0;
    const anchoTotal = pasado ? 100 : r.cap.minutos > 0 ? Math.min(100, (r.totalMin / r.cap.minutos) * 100) : 0;
    const horario = op.hora_inicio && op.hora_fin ? `${String(op.hora_inicio).slice(0, 5)}–${String(op.hora_fin).slice(0, 5)}` : "07:00–16:00";

    return (
        <div
            data-carga-persona={op.id}
            className={cn(
                "bg-white rounded-lg border shadow-sm p-3 transition-colors",
                pasado ? "border-rose-300" : "border-gray-200",
                // A quien le acaba de saltar la carga se lo marca unos segundos.
                salto && "ring-2 ring-indigo-300"
            )}
        >
            {/* Renglón 1: quién es y en qué estado está, en palabras. */}
            <div className="flex items-start gap-2">
                <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold flex items-center justify-center shrink-0" aria-hidden>
                    {iniciales(r.nombre)}
                </span>
                <div className="min-w-0 flex-1">
                    {/* Dos renglones antes que cortar el apellido: al costado el panel mide ~300 px. */}
                    <div className="text-sm font-semibold text-gray-800 leading-tight line-clamp-2 break-words">{r.nombre}</div>
                    <div className={cn("text-[10px] uppercase tracking-wide font-semibold truncate", op.sector || rangosNombres[0] ? "text-gray-500" : "text-gray-400 italic")}>
                        {subtitulo}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    {pasado ? (
                        <span className="inline-flex items-center gap-1 text-[13px] font-bold text-rose-700 tabular-nums">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Pasado por {horas(r.excesoMin)}
                        </span>
                    ) : lleno ? (
                        <>
                            <div className="text-[13px] font-bold text-indigo-800">Lleno</div>
                            {r.libreMin >= 6 && <div className="text-[11px] text-gray-500 tabular-nums">le queda {horas(r.libreMin)}</div>}
                        </>
                    ) : r.estado === "conLugar" ? (
                        <span className="text-[13px] font-semibold text-emerald-700 tabular-nums">{horas(r.libreMin)} libres</span>
                    ) : (
                        <span className="text-[12px] text-gray-500">Sin trabajo</span>
                    )}
                </div>
            </div>

            {/* Barra */}
            <div className="mt-2 h-2 w-full rounded-full bg-indigo-100 overflow-hidden flex" aria-hidden>
                {!pasado && r.previaMin > 0 && (
                    <div className="h-full bg-indigo-300 motion-safe:transition-[width] duration-500" style={{ width: `${anchoPrevia}%` }} />
                )}
                <div
                    className={cn(
                        "h-full motion-safe:transition-[width] duration-500",
                        pasado ? "bg-rose-500" : lleno ? "bg-indigo-700" : "bg-indigo-600",
                        (pasado || r.previaMin === 0) && "rounded-full"
                    )}
                    style={{ width: `${pasado ? 100 : Math.max(0, anchoTotal - (r.previaMin > 0 ? anchoPrevia : 0))}%` }}
                />
            </div>

            {/* Horas, y la cuenta escrita: siempre a la vista. */}
            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[13px] text-gray-800 tabular-nums">
                <span className="min-w-0">
                    {horas(r.totalMin)} de{" "}
                    <PopoverCuenta r={r} carga={carga} resumen={resumen}>
                        {capH} que puede
                    </PopoverCuenta>
                </span>
                <span className="text-[12px] text-gray-500 shrink-0">{r.pct} %</span>
            </div>
            <p className="text-[12px] text-gray-500 tabular-nums">{r.formula}</p>
            {r.cap.minutos === 0 && r.totalMin > 0 && (
                <p className="text-[12px] text-rose-700">Tiene {horas(r.totalMin)} y no trabaja estos días.</p>
            )}

            {/* Carga previa de un plan guardado. */}
            {resumen.esTodo && r.previaMin > 0 && (
                <p className="text-[12px] text-gray-600 tabular-nums">
                    Ya tenía {horas(r.previaMin)} de un plan guardado + {horas(r.cargaMin)} de este.
                </p>
            )}
            {!resumen.esTodo && previaTotalMin > 0 && carga.span && (
                <p className="text-[12px] text-gray-600 tabular-nums">
                    Además tiene {horas(previaTotalMin)} de un plan guardado entre el {diaYMes(carga.span.desde)} y el {diaYMes(carga.span.hasta)}: se suman en «Todo el plan».
                </p>
            )}

            {r.persona.noDisponible && r.totalMin > 0 && (
                <p className="mt-1 rounded bg-rose-50 px-1.5 py-0.5 text-[12px] font-semibold text-rose-700 tabular-nums">
                    No disponible en Recursos y tiene {horas(r.totalMin)} asignadas
                </p>
            )}

            {salto && (
                <div className="mt-1.5 flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-800 tabular-nums">
                    <ArrowUp className="w-3 h-3 shrink-0" />
                    <span className="min-w-0">
                        {numeroEs(salto.antes / 60)} → {numeroEs(salto.despues / 60)} h en todo el plan
                    </span>
                    <span className="shrink-0 font-normal text-indigo-600">· recién agregadas</span>
                </div>
            )}

            {carga.span && (
                <div className="mt-2">
                    <TiraDeDias
                        celdas={resumen.esTodo ? null : r.celdas}
                        celdasSemana={resumen.esTodo ? r.celdasSemana : null}
                        tramos={r.tramos}
                        onVerOT={onVerOT}
                        onElegirSemana={onElegirSemana}
                    />
                </div>
            )}

            {/* Pie: qué le toca, desplegado en el lugar. */}
            <button
                type="button"
                aria-expanded={abierta}
                onClick={onAlternar}
                className={cn("mt-2 w-full h-9 border-t border-gray-100 flex items-center justify-center gap-1 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-50/50", FOCO)}
            >
                {abierta ? (
                    <>Ocultar <ChevronDown className="w-3.5 h-3.5 rotate-180" /></>
                ) : (
                    <>
                        Ver qué le toca · {r.ots} OT, {r.procesos} {plural(r.procesos, "proceso", "procesos")}
                        <ChevronDown className="w-3.5 h-3.5" />
                    </>
                )}
            </button>
            {abierta && (
                <QueLeToca r={r} resumen={resumen} rangosNombres={rangosNombres} horario={horario} nombreRango={nombreRango} onVerOT={onVerOT} />
            )}
        </div>
    );
}

function QueLeToca({ r, resumen, rangosNombres, horario, nombreRango, onVerOT }: {
    r: ResumenPersona;
    resumen: ResumenDelPeriodo;
    rangosNombres: string[];
    horario: string;
    nombreRango: (id: number) => string;
    onVerOT: (id: number) => void;
}) {
    const comoRango = r.porRango.filter(x => x.id != null);
    const conFecha = React.useMemo(() => r.tramos.filter(t => t.dia), [r.tramos]);
    const sinFechaMin = r.tramos.filter(t => !t.dia).reduce((a, t) => a + t.min, 0);

    // En semana: por día. En todo: por OT.
    const porDia = React.useMemo(() => {
        const m = new Map<string, Tramo[]>();
        for (const t of conFecha) {
            if (!m.has(t.dia)) m.set(t.dia, []);
            m.get(t.dia)!.push(t);
        }
        return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    }, [conFecha]);

    const porOT = React.useMemo(() => {
        const m = new Map<number, { fila: FilaDeCarga; min: number; primerDia: string; procesos: Map<FilaDeCarga, { min: number; dias: string[] }> }>();
        for (const t of conFecha) {
            let g = m.get(t.fila.orden_id);
            if (!g) {
                g = { fila: t.fila, min: 0, primerDia: t.dia, procesos: new Map() };
                m.set(t.fila.orden_id, g);
            }
            g.min += t.min;
            if (t.dia < g.primerDia) g.primerDia = t.dia;
            const p = g.procesos.get(t.fila) ?? { min: 0, dias: [] };
            p.min += t.min;
            p.dias.push(t.dia);
            g.procesos.set(t.fila, p);
        }
        return [...m.values()].sort((a, b) => a.primerDia.localeCompare(b.primerDia));
    }, [conFecha]);

    const capDe = (dia: string) => r.celdas.find(c => c.dia === dia)?.cap;

    return (
        <div className="mt-1 space-y-2.5 text-[12px] text-gray-700">
            {comoRango.length > 0 && (
                <p className="tabular-nums">
                    <span className="text-gray-500">Trabaja como: </span>
                    {comoRango.map((x, i) => (
                        <span key={x.id!}>
                            {i > 0 && " · "}
                            <span className="font-semibold">{nombreRango(x.id!)}</span> {horas(x.min)}
                        </span>
                    ))}
                </p>
            )}

            {!resumen.esTodo ? (
                porDia.map(([dia, tramos]) => {
                    const min = tramos.reduce((a, t) => a + t.min, 0);
                    const cap = capDe(dia);
                    return (
                        <div key={dia}>
                            <p className="font-semibold text-gray-900 tabular-nums">
                                {diaCortoMayuscula(dia)} · {cap != null ? `${horasDelDia(min, cap)} de ${horas(cap, 2)}` : horas(min)}
                            </p>
                            <ul className="mt-0.5 space-y-0.5">
                                {tramos.map((t, i) => <RenglonTramo key={i} t={t} onVerOT={onVerOT} />)}
                            </ul>
                        </div>
                    );
                })
            ) : (
                porOT.map(g => (
                    <div key={g.fila.orden_id}>
                        <p className="tabular-nums">
                            <BotonOT fila={g.fila} onVerOT={onVerOT} />{" "}
                            <span className="font-semibold text-gray-900">{g.fila.cliente || "Sin cliente"}</span> · {horas(g.min)} · {g.procesos.size} {plural(g.procesos.size, "proceso", "procesos")}
                        </p>
                        <ul className="mt-0.5 pl-2 space-y-0.5">
                            {[...g.procesos.entries()].map(([fila, p], i) => {
                                const dias = [...new Set(p.dias)].sort();
                                return (
                                    <li key={i} className="tabular-nums">
                                        {fila.nombre_proceso} · {horas(p.min)} · {dias.length === 1 ? diaCorto(dias[0]) : `${diaCorto(dias[0])} a ${diaCorto(dias[dias.length - 1])}`}
                                        {fila.slot_extra && " · como ayudante"}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))
            )}
            {resumen.esTodo && sinFechaMin > 0 && (
                <p className="text-gray-600 tabular-nums">Sin fecha: {horas(sinFechaMin)} (no se pudo ubicar en un día)</p>
            )}

            <p className="text-[11px] text-gray-500">
                {rangosNombres.length > 0 && <>Sus rangos: {rangosNombres.join(" · ")} · </>}
                Horario {horario} · {diasDeLaPersona(r.op)}
            </p>
        </div>
    );
}

function BotonOT({ fila, onVerOT }: { fila: FilaDeCarga; onVerOT: (id: number) => void }) {
    return (
        <button
            type="button"
            onClick={() => onVerOT(fila.orden_id)}
            className={cn("rounded border border-indigo-200 bg-indigo-50 px-1 text-[11px] font-semibold text-indigo-800 tabular-nums hover:bg-indigo-100", FOCO)}
        >
            #{numeroOT(fila)}
        </button>
    );
}

function RenglonTramo({ t, onVerOT }: { t: Tramo; onVerOT: (id: number) => void }) {
    const f = t.fila;
    const parte = t.aprox && t.min < (f.duracion_min || 0);
    return (
        <li className="tabular-nums leading-snug">
            <BotonOT fila={f} onVerOT={onVerOT} /> {f.nombre_proceso} ·{" "}
            {t.aprox ? `≈ ${horas(t.min)}` : horas(t.min)}
            {parte && ` (parte de un proceso de ${horas(f.duracion_min)})`}
            {f.maquinaria_nombre && ` · ${f.maquinaria_nombre}`}
            {f.slot_extra && " · como ayudante"}
        </li>
    );
}

// ─── Tira de días ─────────────────────────────────────────────────────────────

function TiraDeDias({ celdas, celdasSemana, tramos, decimales = 1, onVerOT, onElegirSemana }: {
    celdas: CeldaDia[] | null;
    celdasSemana: CeldaSemana[] | null;
    /** Con tramos, cada día abre su Popover. Sin tramos (la del equipo), solo se mira. */
    tramos?: Tramo[];
    decimales?: number;
    onVerOT?: (id: number) => void;
    onElegirSemana: (clave: string) => void;
}) {
    // `w-full` y no `flex-1`: la celda vive en una columna (rótulo arriba, número
    // abajo) y un flex-1 ahí le pisa el alto de 36 px.
    const base = "w-full h-9 shrink-0 rounded-md text-[11px] font-semibold tabular-nums flex flex-col items-center justify-center motion-safe:transition-colors duration-300";
    if (celdas) {
        return (
            <div className="flex gap-1">
                {celdas.map(c => {
                    const d = new Date(Number(c.dia.slice(0, 4)), Number(c.dia.slice(5, 7)) - 1, Number(c.dia.slice(8, 10)));
                    const rotulo = `${diaCortoMayuscula(c.dia).split(" ")[0]} ${d.getDate()}`;
                    const texto = textoDeCelda(c.min, c.cap, c.feriado, decimales);
                    const aria = c.cap === 0
                        ? `${diaCortoMayuscula(c.dia)}: ${c.feriado ? "feriado" : "no trabaja"}${c.min > 0 ? `, pero tiene ${horas(c.min)}` : ""}`
                        : `${diaCortoMayuscula(c.dia)}: ${horasDelDia(c.min, c.cap)} de ${horas(c.cap, 2)}`;
                    const clase = cn(base, colorDeCelda(c.min, c.cap));
                    return (
                        <div key={c.dia} className="flex-1 min-w-0 flex flex-col items-stretch gap-0.5">
                            <span className="text-[10px] text-gray-500 text-center truncate">{rotulo}</span>
                            {tramos && onVerOT ? (
                                <PopoverDia celda={c} tramos={tramos.filter(t => t.dia === c.dia)} onVerOT={onVerOT} className={clase} aria={aria}>
                                    <span className="truncate max-w-full px-0.5">{texto}</span>
                                </PopoverDia>
                            ) : (
                                <div className={clase} role="img" aria-label={aria}>
                                    <span className="truncate max-w-full px-0.5">{texto}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }
    if (celdasSemana) {
        return (
            <div className="flex gap-1">
                {celdasSemana.map(c => {
                    const s = c.semana;
                    const texto = c.cap === 0 && c.min === 0 ? "—" : c.min === 0 ? "0" : numeroEs(c.min / 60, decimales);
                    const d = s.dias;
                    return (
                        <div key={s.clave} className="flex-1 min-w-0 flex flex-col items-stretch gap-0.5">
                            <span className="text-[10px] text-gray-500 text-center truncate">{diaYMes(d[0])}</span>
                            <button
                                type="button"
                                onClick={() => onElegirSemana(s.clave)}
                                aria-label={`Semana del ${diaCorto(d[0])}: ${horas(c.min)} de ${horas(c.cap, 2)}. Ver esa semana`}
                                className={cn(base, colorDeCelda(c.min, c.cap), FOCO)}
                            >
                                <span className="truncate max-w-full px-0.5">{c.min > c.cap + 15 && c.cap > 0 ? `${texto}!` : texto}</span>
                            </button>
                        </div>
                    );
                })}
            </div>
        );
    }
    return null;
}

function PopoverDia({ celda, tramos, onVerOT, className, aria, children }: {
    celda: CeldaDia;
    tramos: Tramo[];
    onVerOT: (id: number) => void;
    className: string;
    aria: string;
    children: React.ReactNode;
}) {
    const [abierto, setAbierto] = React.useState(false);
    const titulo = celda.cap === 0
        ? `${diaCortoMayuscula(celda.dia)}${celda.min > 0 ? ` · ${horas(celda.min)}` : ""}`
        : `${diaCortoMayuscula(celda.dia)} · ${horasDelDia(celda.min, celda.cap)} de ${horas(celda.cap, 2)}`;
    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" aria-label={aria} className={cn(className, FOCO)}>
                    {children}
                </button>
            </PopoverTrigger>
            <PopoverContent className={POPOVER} collisionPadding={16}>
                <div className="space-y-1.5 text-[12px] text-gray-700">
                    <p className="text-[13px] font-semibold text-gray-900 tabular-nums">{titulo}</p>
                    {celda.cap === 0 && (
                        <p className={celda.min > 0 ? "rounded bg-rose-50 px-1.5 py-1 text-rose-700" : "text-gray-600"}>
                            {celda.feriado ? "Feriado" : "No trabaja este día"}
                            {celda.min > 0 ? `, pero el plan le puso ${horas(celda.min)}.` : "."}
                        </p>
                    )}
                    {celda.cap > 0 && pasadaDelDia(celda) && (
                        <p className="rounded bg-rose-50 px-1.5 py-1 text-rose-700">
                            Tiene más horas que su jornada: le quedaron procesos a la misma hora (cambio a mano).
                        </p>
                    )}
                    {tramos.length === 0 ? (
                        celda.cap > 0 && <p className="text-gray-500">No tiene nada este día.</p>
                    ) : (
                        <ul className="space-y-1">
                            {tramos.map((t, i) => (
                                <RenglonTramo key={i} t={t} onVerOT={id => { setAbierto(false); onVerOT(id); }} />
                            ))}
                        </ul>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

// ─── Popover de la cuenta ─────────────────────────────────────────────────────

const aMin = (v?: string | null) => {
    if (!v) return null;
    const [h, m] = String(v).split(":").map(Number);
    return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

function PopoverCuenta({ r, carga, resumen, children }: {
    r: ResumenPersona;
    carga: CargaDelPlan;
    resumen: ResumenDelPeriodo;
    children: React.ReactNode;
}) {
    const op = r.op;
    const ini = aMin(op.hora_inicio);
    const fin = aMin(op.hora_fin);
    // Si el horario no cierra, `jornadaDelOperario` usa el del taller: se muestra ese.
    const pausas = (Number(op.min_desayuno) || 0) + (Number(op.min_almuerzo) || 0);
    const sinHorario = ini === null || fin === null || fin <= ini || fin - ini - pausas <= 0;
    const hIni = sinHorario ? "07:00" : String(op.hora_inicio).slice(0, 5);
    const hFin = sinHorario ? "16:00" : String(op.hora_fin).slice(0, 5);
    const bruto = sinHorario ? 540 : (fin! - ini!);
    const desayuno = sinHorario ? 15 : Number(op.min_desayuno) || 0;
    const almuerzo = sinHorario ? 30 : Number(op.min_almuerzo) || 0;
    const primerNombre = r.nombre.split(" ")[0];

    const Renglon = ({ izq, der, fuerte }: { izq: React.ReactNode; der: React.ReactNode; fuerte?: boolean }) => (
        <div className={cn("flex justify-between gap-3 tabular-nums", fuerte && "font-semibold text-gray-900")}>
            <span>{izq}</span>
            <span className="text-right">{der}</span>
        </div>
    );

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn("inline-flex items-center gap-0.5 font-semibold text-gray-900 underline decoration-dotted underline-offset-2 hover:text-indigo-800", FOCO)}
                >
                    {children}
                    <Info className="w-3 h-3 text-gray-500" aria-hidden />
                </button>
            </PopoverTrigger>
            <PopoverContent className={POPOVER} collisionPadding={16} align="start">
                <div className="space-y-2 text-[12px] text-gray-700">
                    <div>
                        <p className="text-[13px] font-semibold text-gray-900">Cuánto puede trabajar {primerNombre}</p>
                        <p className="text-gray-500">{nombreDelPeriodo(resumen)}</p>
                    </div>
                    <div className="space-y-0.5">
                        <Renglon izq="Horario" der={`${hIni} a ${hFin} = ${numeroEs(bruto / 60, 2)} h`} />
                        <Renglon izq="− desayuno" der={`${desayuno} min`} />
                        <Renglon izq="− almuerzo" der={`${almuerzo} min`} />
                        <Renglon izq="= jornada" der={horas(r.cap.jornada, 2)} fuerte />
                        <Renglon izq="× días que trabaja" der={r.diasLV} />
                        {r.sabados > 0 && (
                            <Renglon izq="+ sábados" der={`${r.sabados} × ${horas(Math.min(r.cap.jornada, 300), 2)}`} />
                        )}
                        <div className="border-t border-gray-200 pt-0.5">
                            <Renglon izq="= puede trabajar" der={horas(r.cap.minutos, 2)} fuerte />
                        </div>
                    </div>
                    <div className="space-y-0.5 border-t border-gray-100 pt-1.5">
                        {r.previaMin > 0 ? (
                            <>
                                <Renglon izq="Tiene en este plan" der={horas(r.cargaMin)} />
                                <Renglon izq="+ de un plan guardado" der={horas(r.previaMin)} />
                                <Renglon izq="= en total" der={`${horas(r.totalMin)} · ${r.pct} %`} fuerte />
                            </>
                        ) : (
                            <Renglon izq="Tiene en este plan" der={`${horas(r.totalMin)} · ${r.pct} %`} fuerte />
                        )}
                    </div>
                    <p className="text-[11px] text-gray-500 leading-snug">
                        {sinHorario && "Horario: sin cargar, se usa el del taller (07:00 a 16:00). "}
                        Cuenta los días que trabaja ({diasDeLaPersona(op)}) dentro de estas fechas, sin feriados.
                        Feriados cargados en estas fechas: {feriadosEntre(carga, resumen.desde, resumen.hasta)}.
                    </p>
                </div>
            </PopoverContent>
        </Popover>
    );
}

// ─── Grupo plegado ────────────────────────────────────────────────────────────

function GrupoPlegado({ titulo, abierto, onAlternar, children }: {
    titulo: string;
    abierto: boolean;
    onAlternar: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-100/70">
            <button
                type="button"
                aria-expanded={abierto}
                onClick={onAlternar}
                className={cn("w-full h-10 px-3 flex items-center gap-2 text-left text-[13px] font-semibold text-gray-700 tabular-nums", FOCO)}
            >
                <span className="flex-1">{titulo}</span>
                <ChevronDown className={cn("w-4 h-4 shrink-0 motion-safe:transition-transform", abierto ? "rotate-180" : "-rotate-90")} />
            </button>
            {abierto && <div className="px-3 pb-3 bg-white rounded-b-lg pt-2">{children}</div>}
        </div>
    );
}
