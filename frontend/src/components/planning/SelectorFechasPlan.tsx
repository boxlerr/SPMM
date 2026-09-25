"use client";

/**
 * El selector de fechas del planificador: para qué días es el plan.
 *
 * Julián, 25/09/2026: «al momento de planificar y elegir las OT, que aparezca el
 * calendario y te haga elegir para qué fechas las querés […] además de que estén
 * arriba en el planificador, porque se olvida de seleccionarlas».
 *
 * Se usa en tres lugares con el mismo diálogo, para que elegir fechas se aprenda
 * una sola vez:
 *   • «planificar»: al tocar Planificar en el Paso 1 sin fechas elegidas. Confirmar
 *     elige las fechas Y arranca el cálculo, así que el botón lo dice con las fechas
 *     escritas («Planificar del lun 28/9 al vie 9/10»).
 *   • «elegir»: desde el chip del período, arriba del Paso 1. Sólo elige.
 *   • «recalcular»: desde la celda del período de la vista previa. Confirmar vuelve a
 *     calcular el plan con el rango nuevo: es un recálculo pedido a propósito.
 *
 * Los atajos van primero y grandes porque son lo que se usa casi siempre; el
 * calendario queda para lo que no entra en un atajo. Abajo, en vivo, la cuenta rápida
 * del backend (`/planificacion/estimar`) dice cuánto de lo tildado entra en esas
 * fechas: elegir el rango a ciegas era justamente lo que no servía.
 */

import React from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { es } from "date-fns/locale";
import type { Matcher } from "react-day-picker";
import {
    CalendarCheck2, CalendarDays, CalendarRange, CalendarClock, Infinity as InfinityIcon,
    Loader2, Pencil, Sparkles, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { inicioDelPlan } from "@/lib/plan-fechas";
import { LUNES_A_VIERNES } from "@/lib/diasHabiles";
import {
    diaCorto, pedirEstimacion, rangoSinDias, servidorSinEstimacion, textoDeDias, textoDelRango,
    type EstimacionDelPlan,
} from "@/lib/estimarPlan";
import {
    atajosDeFechas, diasHabilesDe, fechaDeIso, fechasRecordadas, fechasVigentes, isoDia, mismasFechas,
    rangoParaElPlan, recordarFechas, resumenDelPeriodo, textoDelPeriodo,
    type AtajoDeFechas, type FechasDelPlan, type PrometidaDeOT,
} from "@/lib/fechasDelPlan";

export type ModoSelectorFechas = "planificar" | "elegir" | "recalcular";

interface SelectorFechasPlanProps {
    abierto: boolean;
    onAbiertoChange: (abierto: boolean) => void;
    modo: ModoSelectorFechas;
    /** Lo elegido ahora. `null` = nada todavía: se ofrece lo último de la sesión. */
    valor: FechasDelPlan | null;
    onConfirmar: (fechas: FechasDelPlan) => void;
    /** Días no laborables de Disponibilidad, "YYYY-MM-DD". */
    feriados: string[];
    /** Las OT que entran en la cuenta rápida. */
    ordenesIds: number[];
    /** Para el atajo «hasta la prometida más lejana». */
    prometidas: PrometidaDeOT[];
    /** Qué días de la semana trabaja alguien; sin dato, de lunes a viernes. */
    diasDelTaller?: ReadonlySet<number>;
    /** Una línea al pie, al lado de los botones (cuánto tarda el recálculo, etc.). */
    nota?: React.ReactNode;
}

const ICONO_DE_ATAJO: Record<AtajoDeFechas, React.ComponentType<{ className?: string }>> = {
    "semana": CalendarCheck2,
    "dos-semanas": CalendarRange,
    "prometida": CalendarClock,
    "sin-tope": InfinityIcon,
};

/** «Del lun 28/9 al vie 9/10» → «del lun 28/9 al vie 9/10», para ir detrás de un verbo. */
const enMinuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** ¿La elección ya se puede confirmar? Un rango a medio marcar (sólo el primer día) no. */
const estaCompleta = (f: FechasDelPlan | null): f is FechasDelPlan =>
    !!f && (!!f.hasta || f.atajo === "sin-tope");

/** Dos meses a la vista sólo si entran al lado de los atajos; en el teléfono, uno. */
function useDosMeses(): boolean {
    const [dos, setDos] = React.useState(false);
    React.useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mq = window.matchMedia("(min-width: 1024px)");
        const cambiar = () => setDos(mq.matches);
        cambiar();
        mq.addEventListener?.("change", cambiar);
        return () => mq.removeEventListener?.("change", cambiar);
    }, []);
    return dos;
}

/**
 * Qué mes se ve primero. Con dos meses a la vista, el del primer día. Con uno solo
 * (teléfono), el que tiene más días del rango: «dos semanas» desde el lun 28/9 son
 * 3 días de septiembre y 9 de octubre, y abrir en septiembre mostraba un mes entero
 * apagado con tres días elegidos al final.
 */
function mesParaMostrar(f: FechasDelPlan | null, arranqueIso: string, dosMeses: boolean): Date {
    const desde = fechaDeIso(f?.desde ?? arranqueIso);
    const primero = new Date(desde.getFullYear(), desde.getMonth(), 1);
    if (dosMeses || !f?.hasta) return primero;
    const hasta = fechaDeIso(f.hasta);
    if (hasta.getFullYear() === desde.getFullYear() && hasta.getMonth() === desde.getMonth()) return primero;
    const finDelPrimerMes = new Date(desde.getFullYear(), desde.getMonth() + 1, 0).getDate();
    const diasEnElPrimero = finDelPrimerMes - desde.getDate() + 1;
    return hasta.getDate() > diasEnElPrimero ? new Date(hasta.getFullYear(), hasta.getMonth(), 1) : primero;
}

type Cuenta =
    | { estado: "nada" }
    | { estado: "sin-servidor" }
    | { estado: "error" }
    | { estado: "ok"; clave: string; datos: EstimacionDelPlan };

export function SelectorFechasPlan({
    abierto,
    onAbiertoChange,
    modo,
    valor,
    onConfirmar,
    feriados,
    ordenesIds,
    prometidas,
    diasDelTaller = LUNES_A_VIERNES,
    nota,
}: SelectorFechasPlanProps) {
    const idLayout = React.useId();
    const dosMeses = useDosMeses();

    // El primer día en que puede arrancar el plan, con la regla del backend: si la
    // jornada de hoy ya empezó, el próximo día hábil. Se calcula en cada render a
    // propósito (con el diálogo abierto a las 06:59, a las 07:00 hoy ya no vale).
    const arranque = inicioDelPlan(new Date(), feriados);
    const arranqueIso = isoDia(arranque);
    const inicioDelDia = fechaDeIso(arranqueIso);

    const feriadosClave = feriados.join(",");
    const prometidasClave = prometidas.map(p => `${p.numero}:${p.fecha ?? ""}`).join(",");
    const diasClave = Array.from(diasDelTaller).sort().join("");
    const atajos = React.useMemo(
        () => atajosDeFechas(fechaDeIso(arranqueIso), feriados, prometidas, new Date(), diasDelTaller),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [arranqueIso, feriadosClave, prometidasClave, diasClave],
    );

    // ---- Lo que se está eligiendo (se confirma recién con el botón) ----
    const [borrador, setBorrador] = React.useState<FechasDelPlan | null>(null);
    const [mes, setMes] = React.useState<Date>(inicioDelDia);
    const [sobre, setSobre] = React.useState<Date | null>(null);

    // Al abrir: lo que ya estaba elegido, o lo último que se eligió en la sesión. Así
    // la segunda tanda del día es abrir y apretar Enter.
    const abiertoAntes = React.useRef(false);
    React.useEffect(() => {
        if (abierto && !abiertoAntes.current) {
            const inicial = fechasVigentes(valor, arranque) ?? fechasRecordadas(atajos, arranque);
            setBorrador(inicial);
            setSobre(null);
            setMes(mesParaMostrar(inicial, arranqueIso, dosMeses));
        }
        abiertoAntes.current = abierto;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto]);

    const completa = estaCompleta(borrador);

    /** Un click en el calendario: primero el primer día, después el último. */
    const elegirDia = (dia: Date) => {
        const iso = isoDia(dia);
        setBorrador(prev => {
            // Hay un primer día esperando su último: éste lo cierra (o, si es
            // anterior, pasa a ser el primero).
            if (prev?.desde && !prev.hasta && !prev.atajo) {
                return iso < prev.desde ? { desde: iso } : { desde: prev.desde, hasta: iso };
            }
            // Con un rango ya armado, o sin nada, un click empieza uno nuevo: es lo
            // que hace cualquier calendario de reservas y nadie tiene que aprenderlo.
            return { desde: iso };
        });
    };

    const elegirAtajo = (f: FechasDelPlan) => {
        setBorrador(f);
        setSobre(null);
        if (f.desde) setMes(mesParaMostrar(f, arranqueIso, dosMeses));
    };

    /** Qué atajo queda marcado: el de la elección, o el que da las mismas fechas. */
    const atajoActivo: AtajoDeFechas | null = (() => {
        if (!completa) return null;
        if (!borrador.hasta) return "sin-tope";
        const propio = atajos.find(a => a.atajo === borrador.atajo && a.fechas && mismasFechas(a.fechas, borrador, arranque));
        if (propio) return propio.atajo;
        return atajos.find(a => a.fechas?.hasta && mismasFechas(a.fechas, borrador, arranque))?.atajo ?? null;
    })();

    // ---- La cuenta rápida, en vivo ----
    const idsClave = [...ordenesIds].sort((a, b) => a - b).join(",");
    const rango = completa ? rangoParaElPlan(borrador, arranque) : null;
    const claveCuenta = rango ? `${rango.fecha_desde ?? ""}|${rango.fecha_hasta ?? ""}` : null;
    const [cuenta, setCuenta] = React.useState<Cuenta>({ estado: "nada" });
    const [calculando, setCalculando] = React.useState(false);

    React.useEffect(() => {
        if (!abierto || !idsClave || claveCuenta === null) {
            setCalculando(false);
            return;
        }
        // El servidor ya dijo que no tiene la cuenta: ni se pregunta.
        if (servidorSinEstimacion()) {
            setCuenta({ estado: "sin-servidor" });
            setCalculando(false);
            return;
        }
        setCalculando(true);
        const control = new AbortController();
        let porTiempo = false;
        let tope: ReturnType<typeof setTimeout> | undefined;
        const [desde, hasta] = claveCuenta.split("|");
        // Un respiro corto: pasar de atajo en atajo con el teclado no manda un pedido
        // por cada uno.
        const espera = setTimeout(async () => {
            tope = setTimeout(() => { porTiempo = true; control.abort(); }, 20_000);
            const respuesta = await pedirEstimacion(
                idsClave.split(",").map(Number), desde || null, control.signal, hasta || null);
            clearTimeout(tope);
            if (control.signal.aborted && !porTiempo) return;
            if (respuesta.ok) setCuenta({ estado: "ok", clave: claveCuenta, datos: respuesta.datos });
            else setCuenta({ estado: respuesta.motivo === "sin-ruta" ? "sin-servidor" : "error" });
            setCalculando(false);
        }, 300);
        return () => {
            clearTimeout(espera);
            clearTimeout(tope);
            control.abort();
        };
    }, [abierto, idsClave, claveCuenta]);

    const datos = cuenta.estado === "ok" ? cuenta.datos : null;
    const cuentaVieja = cuenta.estado === "ok" && cuenta.clave !== claveCuenta;
    const finEstimado = datos?.fin_estimado?.slice(0, 10) ?? null;

    // ---- El calendario ----
    const desdeFecha = borrador?.desde ? fechaDeIso(borrador.desde) : null;
    const hastaFecha = borrador?.hasta ? fechaDeIso(borrador.hasta) : null;
    const esperandoFin = !!borrador?.desde && !borrador.hasta && !borrador.atajo;
    const previaHasta = esperandoFin && sobre && desdeFecha && sobre > desdeFecha ? sobre : null;
    const feriadosFechas = React.useMemo(() => feriados.map(fechaDeIso), [feriadosClave]); // eslint-disable-line react-hooks/exhaustive-deps

    const modificadores: Record<string, Matcher | Matcher[]> = {
        finde: { dayOfWeek: [0, 6] },
        feriado: feriadosFechas,
    };
    const clasesModificadores: Record<string, string> = {
        // Especificidad doble (`[&.finde]`) para ganarle al color base del día, y el finde
        // adentro del rango queda en azul claro: se ve que está en el período pero que
        // no se trabaja.
        finde: "finde [&.finde]:text-slate-400 [&.finde.rango-medio]:text-blue-900/45",
        feriado: "!text-rose-400 line-through decoration-rose-300",
        rangoPunta: "!bg-blue-600 !text-white shadow-sm shadow-blue-600/30 hover:!bg-blue-700",
        rangoMedio: "rango-medio [&.rango-medio]:text-blue-900 hover:!bg-blue-100",
        rangoAbre: "rango-abre",
        rangoCierra: "rango-cierra",
        previaMedio: "previa-medio",
        previaCierra: "previa-cierra !bg-blue-100 !text-blue-800",
        previaAbre: "previa-abre",
        finEstimado: "after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-indigo-500",
    };
    if (desdeFecha) modificadores.rangoPunta = hastaFecha ? [desdeFecha, hastaFecha] : [desdeFecha];
    if (desdeFecha && hastaFecha && hastaFecha > desdeFecha) {
        modificadores.rangoMedio = { after: desdeFecha, before: hastaFecha };
        modificadores.rangoAbre = desdeFecha;
        modificadores.rangoCierra = hastaFecha;
    }
    if (desdeFecha && previaHasta) {
        modificadores.previaMedio = { after: desdeFecha, before: previaHasta };
        modificadores.previaAbre = desdeFecha;
        modificadores.previaCierra = previaHasta;
    }
    if (finEstimado && !cuentaVieja) modificadores.finEstimado = fechaDeIso(finEstimado);

    // La franja de color del rango la pinta la CELDA, no el botón redondo del día: así
    // los días del medio quedan unidos en una sola banda, y las puntas la cortan a la
    // mitad (media celda de color hacia adentro del rango).
    const clasesCalendario = {
        months: "flex flex-col lg:flex-row gap-4 lg:gap-8",
        month: "space-y-3",
        caption: "relative flex h-8 items-center justify-center",
        caption_label: "text-sm font-semibold capitalize text-slate-800",
        nav: "flex items-center gap-1",
        nav_button: "inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-25",
        nav_button_previous: "absolute left-0",
        nav_button_next: "absolute right-0",
        table: "w-full border-collapse",
        head_row: "flex",
        head_cell: "w-10 text-[11px] font-medium uppercase tracking-wide text-slate-400",
        row: "mt-1 flex w-full",
        cell: cn(
            "relative h-10 w-10 p-0 text-center text-sm",
            "has-[.rango-medio]:bg-blue-50",
            "has-[.rango-abre]:bg-linear-to-r has-[.rango-abre]:from-transparent has-[.rango-abre]:from-50% has-[.rango-abre]:to-blue-50 has-[.rango-abre]:to-50%",
            "has-[.rango-cierra]:bg-linear-to-l has-[.rango-cierra]:from-transparent has-[.rango-cierra]:from-50% has-[.rango-cierra]:to-blue-50 has-[.rango-cierra]:to-50%",
            "has-[.previa-medio]:bg-slate-100",
            "has-[.previa-abre]:bg-linear-to-r has-[.previa-abre]:from-transparent has-[.previa-abre]:from-50% has-[.previa-abre]:to-slate-100 has-[.previa-abre]:to-50%",
            "has-[.previa-cierra]:bg-linear-to-l has-[.previa-cierra]:from-transparent has-[.previa-cierra]:from-50% has-[.previa-cierra]:to-slate-100 has-[.previa-cierra]:to-50%",
        ),
        day: "relative h-10 w-10 rounded-full p-0 font-normal tabular-nums text-slate-700 transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-slate-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 motion-reduce:transition-none",
        day_today: "font-semibold ring-1 ring-inset ring-blue-300",
        day_outside: "invisible",
        day_disabled: "!text-slate-300 cursor-not-allowed hover:!bg-transparent active:scale-100",
        day_selected: "",
        day_range_start: "",
        day_range_end: "",
        day_range_middle: "",
        day_hidden: "invisible",
    };

    // ---- Textos ----
    const resumen = completa ? resumenDelPeriodo(borrador, arranque, feriados, diasDelTaller) : null;
    const habiles = completa ? diasHabilesDe(borrador, arranque, feriados, diasDelTaller) : null;
    const sinCambios = modo === "recalcular" && completa && (
        mismasFechas(borrador, valor, arranque)
        || (!borrador.hasta && !!valor && !valor.hasta
            && rangoParaElPlan(borrador, arranque).fecha_desde === rangoParaElPlan(valor, arranque).fecha_desde)
    );
    const verbo = modo === "planificar" ? "Planificar" : modo === "recalcular" ? "Recalcular" : "Usar";
    const textoBoton = !borrador
        ? "Elegí las fechas"
        : esperandoFin
            ? "Tocá el último día"
            : sinCambios
                ? "Son las fechas del plan de ahora"
                : `${verbo} ${enMinuscula(textoDelPeriodo(borrador, arranque))}`;
    // En el teléfono el botón no tiene lugar para los días de la semana: «Planificar
    // del 30/9 al 14/10» entra; «Planificar del mié 30/9 al mié 14/10» se cortaba.
    const diaNumerico = (iso?: string) => {
        if (!iso) return "";
        const f = fechaDeIso(iso);
        return `${f.getDate()}/${f.getMonth() + 1}`;
    };
    const desdeParaBoton = borrador?.desde ?? arranqueIso;
    const textoBotonCorto = !completa || sinCambios || esperandoFin
        ? textoBoton
        : !borrador.hasta
            ? (borrador.desde && borrador.desde > arranqueIso
                ? `${verbo} desde el ${diaNumerico(borrador.desde)}`
                : `${verbo} sin tope`)
            : desdeParaBoton === borrador.hasta
                ? `${verbo} sólo el ${diaNumerico(borrador.hasta)}`
                : `${verbo} del ${diaNumerico(desdeParaBoton)} al ${diaNumerico(borrador.hasta)}`;
    const pista = !borrador
        ? "Tocá el primer día del plan, o elegí un atajo."
        : esperandoFin
            ? `Arranca el ${diaCorto(borrador.desde)}. Ahora tocá el último día.`
            : !borrador.hasta
                ? "Sin tope: el plan termina cuando termina lo último. Tocá un día para ponerle fechas."
                : `${resumen?.periodo} · ${resumen?.dias}`;

    const confirmar = () => {
        if (!completa || sinCambios) return;
        recordarFechas(borrador);
        onAbiertoChange(false);
        onConfirmar(borrador);
    };

    // Con algo ya elegido al abrir, el foco va al botón principal: Enter y listo.
    // Sin nada, al primer atajo.
    const botonRef = React.useRef<HTMLButtonElement>(null);
    // Los atajos se buscan por el grupo y no con un ref por botón: el primero puede
    // estar apagado, y el ref de un `motion.button` no llegaba a tiempo al abrir.
    const grupoAtajosRef = React.useRef<HTMLDivElement>(null);

    // ---- La cuenta, en palabras ----
    const titularCuenta = ((): { titular: string; bajada: string; pct: number | null; tono: "ok" | "ambar" | "neutro" } | null => {
        if (ordenesIds.length === 0) {
            return { titular: "Tildá OT para ver cuánto entra", bajada: "La cuenta rápida sale de lo que está tildado.", pct: null, tono: "neutro" };
        }
        if (!completa) {
            return { titular: "Elegí hasta qué día", bajada: "Con el primer y el último día se ve cuánto de lo tildado entra.", pct: null, tono: "neutro" };
        }
        if (cuenta.estado === "sin-servidor") {
            return { titular: "Qué entra lo vas a ver al planificar", bajada: "El servidor todavía no tiene la cuenta rápida.", pct: null, tono: "neutro" };
        }
        if (cuenta.estado === "error") {
            return { titular: "No se pudo hacer la cuenta rápida", bajada: "Igual podés seguir: el plan te dice qué entra al calcular.", pct: null, tono: "neutro" };
        }
        if (!datos) {
            return { titular: "Calculando cuánto entra…", bajada: "Es una cuenta rápida, tarda unos segundos.", pct: null, tono: "neutro" };
        }
        const fin = datos.fin_estimado ? diaCorto(datos.fin_estimado) : "";
        const todo = `Todo lo tildado lleva ${textoDeDias(datos)}${fin ? ` y terminaría cerca del ${fin}` : ""}.`;
        if (datos.rango && borrador.hasta) {
            const r = datos.rango;
            const entraTodo = !rangoSinDias(r) && r.ots_total > 0 && r.ots_entran >= r.ots_total;
            return {
                titular: textoDelRango(r),
                bajada: entraTodo ? todo : `${todo} Es una estimación: el reparto fino lo hace el planificador.`,
                pct: r.ots_total > 0 ? Math.round((100 * r.ots_entran) / r.ots_total) : 0,
                tono: entraTodo ? "ok" : "ambar",
            };
        }
        return {
            titular: fin ? `Terminaría cerca del ${fin}` : textoDeDias(datos),
            bajada: `Sin tope entra todo: ${textoDeDias(datos)} con la gente que hay y quién sabe hacer cada paso.`,
            pct: 100,
            tono: "neutro",
        };
    })();

    const titulo = modo === "recalcular" ? "Cambiar las fechas del plan" : "¿Para qué fechas es el plan?";
    const cuantas = ordenesIds.length;

    return (
        <Dialog open={abierto} onOpenChange={onAbiertoChange}>
            <DialogContent
                showCloseButton={false}
                onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    // Se espera un momento: el borrador inicial se arma en el efecto de
                    // apertura y el botón recién se prende en el render siguiente. Al
                    // recalcular arranca con las fechas del plan y el botón apagado (son las
                    // mismas): ahí el foco va a los atajos.
                    setTimeout(() => {
                        const conAlgo = modo !== "recalcular"
                            && (fechasVigentes(valor, arranque) ?? fechasRecordadas(atajos, arranque));
                        const primerAtajo = grupoAtajosRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
                        (conAlgo && botonRef.current && !botonRef.current.disabled ? botonRef.current : primerAtajo)?.focus();
                    }, 50);
                }}
                className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[640px] lg:max-w-[900px]"
            >
                <MotionConfig reducedMotion="user">
                    {/* Cabecera */}
                    <div className="flex items-start gap-3 border-b border-slate-100 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                            <CalendarDays className="h-[18px] w-[18px]" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="text-base font-semibold text-slate-900 sm:text-lg">{titulo}</DialogTitle>
                            <DialogDescription className="mt-1 text-[13px] leading-snug text-slate-500">
                                {cuantas > 0 && <>{cuantas} OT {modo === "recalcular" ? "en el plan" : cuantas === 1 ? "tildada" : "tildadas"}. </>}
                                Lo más temprano que puede arrancar es el <span className="font-medium text-slate-700">{diaCorto(arranqueIso)}</span>.
                                <span className="hidden sm:inline"> Elegí un atajo o marcá el primer y el último día.</span>
                            </DialogDescription>
                        </div>
                        <button
                            type="button"
                            onClick={() => onAbiertoChange(false)}
                            className="-mr-1 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            aria-label="Cerrar sin cambiar las fechas"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <div className="grid lg:grid-cols-[250px_1fr]">
                            {/* Atajos: grandes, a la izquierda (arriba en el teléfono). */}
                            <div
                                ref={grupoAtajosRef}
                                role="group"
                                aria-label="Atajos de fechas"
                                className="grid grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50/70 p-3 sm:p-4 lg:grid-cols-1 lg:content-start lg:border-b-0 lg:border-r"
                            >
                                {atajos.map((a, i) => {
                                    const Icono = ICONO_DE_ATAJO[a.atajo];
                                    const activo = atajoActivo === a.atajo;
                                    const deshabilitado = !a.fechas;
                                    return (
                                        <motion.button
                                            key={a.atajo}
                                            type="button"
                                            disabled={deshabilitado}
                                            aria-pressed={activo}
                                            onClick={() => a.fechas && elegirAtajo(a.fechas)}
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.22, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }}
                                            className={cn(
                                                "group relative flex min-h-[60px] items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                                                activo
                                                    ? "border-transparent"
                                                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-white hover:shadow-sm",
                                                deshabilitado && "cursor-not-allowed opacity-55 hover:border-slate-200 hover:shadow-none",
                                            )}
                                        >
                                            {/* El marco del atajo elegido se desliza de uno a otro. */}
                                            {activo && (
                                                <motion.span
                                                    layoutId={`atajo-activo-${idLayout}`}
                                                    className="absolute inset-0 rounded-xl bg-blue-50 ring-2 ring-blue-500"
                                                    transition={{ type: "spring", stiffness: 520, damping: 40 }}
                                                    aria-hidden
                                                />
                                            )}
                                            {/* Sin ícono en el teléfono: ahí los dos atajos por fila
                                                necesitan el ancho para el texto. */}
                                            <span className={cn(
                                                "relative mt-0.5 hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                                activo ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 group-hover:text-slate-700",
                                            )}>
                                                <Icono className="h-4 w-4" />
                                            </span>
                                            <span className="relative min-w-0">
                                                <span className={cn("block text-[13px] font-semibold leading-tight", activo ? "text-blue-900" : "text-slate-800")}>
                                                    {a.titulo}
                                                </span>
                                                <span className={cn("mt-0.5 block text-[12px] leading-snug", activo ? "text-blue-700" : "text-slate-500")}>
                                                    {a.detalle}
                                                </span>
                                            </span>
                                        </motion.button>
                                    );
                                })}
                            </div>

                            {/* Calendario */}
                            <div className="flex flex-col items-center px-2 py-3 sm:px-4 sm:py-4">
                                <div className="mb-1 flex min-h-[20px] w-full items-center justify-center px-2 text-center text-[12.5px] text-slate-600" aria-live="polite">
                                    <AnimatePresence mode="wait" initial={false}>
                                        <motion.span
                                            key={pista}
                                            initial={{ opacity: 0, y: 3 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -3 }}
                                            transition={{ duration: 0.15 }}
                                            className={cn(esperandoFin && "font-medium text-blue-700")}
                                        >
                                            {pista}
                                        </motion.span>
                                    </AnimatePresence>
                                </div>
                                <div onMouseLeave={() => setSobre(null)}>
                                    <CalendarUI
                                        mode="range"
                                        selected={desdeFecha ? { from: desdeFecha, to: hastaFecha ?? undefined } : undefined}
                                        onSelect={(_rango, dia) => elegirDia(dia)}
                                        month={mes}
                                        onMonthChange={setMes}
                                        fromMonth={inicioDelDia}
                                        numberOfMonths={dosMeses ? 2 : 1}
                                        locale={es}
                                        showOutsideDays={false}
                                        disabled={[{ before: inicioDelDia }, ...feriadosFechas]}
                                        modifiers={modificadores}
                                        modifiersClassNames={clasesModificadores}
                                        onDayMouseEnter={(dia) => setSobre(dia)}
                                        onDayFocus={(dia) => setSobre(dia)}
                                        classNames={clasesCalendario}
                                        className="p-1"
                                    />
                                </div>
                                {/* Qué es cada cosa del calendario. */}
                                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 text-[11px] text-slate-500">
                                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Elegido</span>
                                    <span className="inline-flex items-center gap-1.5"><span className="text-rose-400 line-through">17</span>No laborable</span>
                                    <span className="inline-flex items-center gap-1.5"><span className="text-slate-400">sá do</span>Fin de semana</span>
                                    {finEstimado && !cuentaVieja && (
                                        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />Fin estimado de lo tildado</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* La cuenta rápida, en vivo, para las fechas que se están mirando. */}
                        {titularCuenta && (
                            <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-6" aria-live="polite" aria-busy={calculando}>
                                <div className="flex items-start gap-3">
                                    <div className={cn(
                                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-300",
                                        titularCuenta.tono === "ok" ? "bg-emerald-100 text-emerald-600"
                                            : titularCuenta.tono === "ambar" ? "bg-amber-100 text-amber-600"
                                                : "bg-indigo-100 text-indigo-600",
                                    )}>
                                        {calculando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                    </div>
                                    <div className={cn("min-w-0 flex-1 transition-opacity duration-200", (calculando || cuentaVieja) && datos && "opacity-60")}>
                                        <AnimatePresence mode="wait" initial={false}>
                                            <motion.p
                                                key={titularCuenta.titular}
                                                initial={{ opacity: 0, y: 4 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -4 }}
                                                transition={{ duration: 0.16 }}
                                                className="text-sm font-semibold text-slate-800"
                                            >
                                                {titularCuenta.titular}
                                            </motion.p>
                                        </AnimatePresence>
                                        <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{titularCuenta.bajada}</p>
                                        {titularCuenta.pct !== null && (
                                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
                                                <div
                                                    className={cn(
                                                        "h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none",
                                                        titularCuenta.tono === "ok" ? "bg-emerald-500"
                                                            : titularCuenta.tono === "ambar" ? "bg-amber-500" : "bg-indigo-500",
                                                    )}
                                                    style={{ width: `${Math.max(3, titularCuenta.pct)}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Pie: siempre a la vista, aunque el cuerpo scrollee en el teléfono. */}
                    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                        <div className="min-w-0 text-[12px] leading-snug text-slate-500">
                            {nota ?? (habiles !== null
                                ? <>{habiles} {habiles === 1 ? "día hábil" : "días hábiles"}: sin fines de semana ni feriados.</>
                                : null)}
                        </div>
                        <div className="flex min-w-0 items-center justify-end gap-2 sm:shrink-0">
                            <Button variant="ghost" onClick={() => onAbiertoChange(false)} className="shrink-0 px-3 text-slate-600">
                                Cancelar
                            </Button>
                            <Button
                                ref={botonRef}
                                onClick={confirmar}
                                disabled={!completa || sinCambios}
                                className="min-w-0 flex-1 gap-2 bg-blue-600 shadow-sm shadow-blue-600/20 hover:bg-blue-700 sm:min-w-[12rem] sm:flex-none"
                            >
                                <CalendarCheck2 className="h-4 w-4 shrink-0" />
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.span
                                        key={textoBoton}
                                        initial={{ opacity: 0, y: 3 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -3 }}
                                        transition={{ duration: 0.14 }}
                                        className="truncate"
                                    >
                                        <span className="sm:hidden">{textoBotonCorto}</span>
                                        <span className="hidden sm:inline">{textoBoton}</span>
                                    </motion.span>
                                </AnimatePresence>
                            </Button>
                        </div>
                    </div>
                </MotionConfig>
            </DialogContent>
        </Dialog>
    );
}

/**
 * El chip del período, arriba del Paso 1: siempre a la vista y es la puerta al
 * selector. Sin fechas elegidas va en ámbar, que es lo que se olvidaba.
 */
export function ChipPeriodoPlan({
    fechas,
    feriados,
    onClick,
    className,
}: {
    /** Ya puestas al día (`fechasVigentes`). `null` = sin fechas elegidas. */
    fechas: FechasDelPlan | null;
    feriados: string[];
    onClick: () => void;
    className?: string;
}) {
    const arranque = inicioDelPlan(new Date(), feriados);
    const resumen = fechas ? resumenDelPeriodo(fechas, arranque, feriados) : null;
    const clave = resumen ? `${resumen.periodo}|${resumen.dias}` : "nada";

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={resumen
                ? `Período del plan: ${resumen.periodo}, ${resumen.dias}. Cambiar las fechas`
                : "Sin fechas elegidas. Elegir las fechas del plan"}
            className={cn(
                "group inline-flex h-8 max-w-full items-center gap-2 rounded-full border pl-2.5 pr-3 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                !fechas
                    ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    : !fechas.hasta
                        ? "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                        : "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100",
                className,
            )}
        >
            {!fechas ? (
                // El puntito que late es lo único que se mueve en la cabecera: dice
                // «falta esto» sin gritar. Quieto para quien pidió menos movimiento.
                <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                </span>
            ) : !fechas.hasta ? (
                <InfinityIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            ) : (
                <CalendarRange className="h-3.5 w-3.5 shrink-0 text-blue-600" />
            )}
            <AnimatePresence mode="wait" initial={false}>
                <motion.span
                    key={clave}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.15 }}
                    className="min-w-0 truncate"
                >
                    {resumen ? (
                        <>
                            <span className="font-semibold">{resumen.periodo}</span>
                            <span className="font-normal opacity-75"> · {resumen.dias}</span>
                        </>
                    ) : (
                        <>
                            <span className="font-semibold">Sin fechas elegidas</span>
                            <span className="font-normal"> · </span>
                            <span className="font-semibold underline decoration-amber-400 underline-offset-2">Elegir fechas</span>
                        </>
                    )}
                </motion.span>
            </AnimatePresence>
            {fechas && (
                <Pencil className="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-90" aria-hidden />
            )}
        </button>
    );
}
