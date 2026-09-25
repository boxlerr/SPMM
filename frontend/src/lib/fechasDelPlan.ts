/**
 * Para qué fechas es el plan: lo que se elige en el selector de fechas del
 * planificador y lo que muestra el chip del período arriba del Paso 1.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (Julián, 25/09/2026): «al momento de planificar y elegir las OT,
 * que aparezca el calendario y te haga elegir para qué fechas las querés […] además
 * de que estén arriba en el planificador, porque se olvida de seleccionarlas».
 *
 * El rango era un botón «Rango de fechas» opcional, perdido entre los chips de la
 * cabecera. Nadie lo tocaba, y sin fecha «hasta» el plan no tiene tope: 48 OT
 * tildadas se estiraron hasta el 26/10 cuando lo que se quería mirar era la semana.
 * Ahora planificar sin fechas elegidas abre el selector antes de calcular, y «sin
 * tope» pasa a ser una elección explícita en vez de lo que pasa por olvido.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Todo en días pelados "YYYY-MM-DD" y hora local, como el resto del sistema
 * ([[fechas-todas-sin-zona]]): nada de `toISOString()`, que pasa a UTC y en
 * Argentina resta un día a la noche.
 */

import { diaCorto } from "./estimarPlan";
import { contarDiasHabiles, LUNES_A_VIERNES } from "./diasHabiles";

/** De qué atajo salió la elección. Sin atajo = se eligió a mano en el calendario. */
export type AtajoDeFechas = "semana" | "dos-semanas" | "prometida" | "sin-tope";

export interface FechasDelPlan {
    /** Primer día, "YYYY-MM-DD". Sin `desde`, el plan arranca lo antes posible. */
    desde?: string;
    /** Último día, "YYYY-MM-DD". Sin `hasta`, el plan no tiene tope: dura lo que tarde. */
    hasta?: string;
    atajo?: AtajoDeFechas;
}

/** Lo que viaja al backend: el mismo `PlanningRange` de siempre. */
export interface RangoParaElPlan {
    fecha_desde?: string;
    fecha_hasta?: string;
}

// ---------------------------------------------------------------------------
// Días
// ---------------------------------------------------------------------------

/** Date → "2026-09-28", en hora local. */
export function isoDia(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-09-28" → Date a la medianoche LOCAL (no UTC: ver el encabezado). */
export function fechaDeIso(iso: string): Date {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

const sumarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** El viernes de la semana de `d` (semana de lunes a domingo). */
function viernesDeLaSemana(d: Date): Date {
    // getDay: 0 domingo … 6 sábado. Llevado a lunes = 0 … domingo = 6.
    const desdeLunes = (d.getDay() + 6) % 7;
    return sumarDias(d, 4 - desdeLunes);
}

/**
 * Si el tope cae en un día que no se trabaja (finde o feriado), se corre para atrás
 * hasta el último que sí, sin pasar de `piso`. «Hasta el vie 9/10» con el 9 feriado
 * sería un «hasta» que no aporta ni un día.
 */
function ultimoDiaDeTrabajo(tope: Date, piso: Date, bloqueados: ReadonlySet<string>, dias: ReadonlySet<number>): Date {
    let d = tope;
    for (let i = 0; i < 14 && d > piso; i++) {
        if (dias.has(d.getDay()) && !bloqueados.has(isoDia(d))) return d;
        d = sumarDias(d, -1);
    }
    return d < piso ? piso : d;
}

// ---------------------------------------------------------------------------
// Atajos
// ---------------------------------------------------------------------------

export interface OpcionDeAtajo {
    atajo: AtajoDeFechas;
    titulo: string;
    /** La segunda línea: las fechas escritas, o por qué no se puede. */
    detalle: string;
    /** `null` = el atajo no aplica (p. ej. ninguna OT tildada tiene fecha prometida). */
    fechas: FechasDelPlan | null;
}

/** Una OT con su fecha prometida, para el atajo «hasta la prometida más lejana». */
export interface PrometidaDeOT {
    numero: string;
    fecha?: string | null;
}

/**
 * Los cuatro atajos del selector, ya con sus fechas.
 *
 * `arranque` es el primer día en que puede arrancar el plan (ver `inicioDelPlan`):
 * los atajos cuentan desde ahí y no desde hoy. Un viernes a las 10 la jornada ya
 * empezó y el plan arranca el lunes, así que «esta semana» es la del lunes.
 */
export function atajosDeFechas(
    arranque: Date,
    feriados: Iterable<string>,
    prometidas: PrometidaDeOT[],
    hoy: Date = new Date(),
    dias: ReadonlySet<number> = LUNES_A_VIERNES,
): OpcionDeAtajo[] {
    const bloqueados = new Set(feriados);
    const desde = isoDia(arranque);

    // Una semana: del arranque al viernes de esa semana. Se llama «esta semana» si
    // el arranque cae en la semana de hoy; si no (un viernes a la tarde), es la que
    // viene, y decir «esta» confundía con fechas de la semana siguiente al lado.
    const finSemana = ultimoDiaDeTrabajo(viernesDeLaSemana(arranque), arranque, bloqueados, dias);
    const mismaSemana = isoDia(viernesDeLaSemana(hoy)) === isoDia(viernesDeLaSemana(arranque));
    const finDos = ultimoDiaDeTrabajo(sumarDias(viernesDeLaSemana(arranque), 7), arranque, bloqueados, dias);

    // La prometida más lejana de lo tildado. La marca 1950 del sistema viejo («sin
    // fecha») no cuenta, y una prometida que ya pasó no sirve de tope.
    let masLejana: PrometidaDeOT | null = null;
    let conFecha = 0;
    for (const p of prometidas) {
        const dia = p.fecha?.slice(0, 10);
        if (!dia || dia < "2000-01-01") continue;
        conFecha++;
        if (!masLejana || dia > (masLejana.fecha ?? "").slice(0, 10)) masLejana = { numero: p.numero, fecha: dia };
    }
    const diaPrometida = masLejana?.fecha?.slice(0, 10) ?? null;
    let prometida: OpcionDeAtajo;
    if (!diaPrometida) {
        prometida = {
            atajo: "prometida",
            titulo: "Hasta la prometida más lejana",
            detalle: prometidas.length === 0
                ? "Tildá alguna OT primero"
                : "Ninguna OT tildada tiene fecha prometida",
            fechas: null,
        };
    } else if (diaPrometida < desde) {
        prometida = {
            atajo: "prometida",
            titulo: "Hasta la prometida más lejana",
            detalle: conFecha === 1 ? "La prometida ya pasó" : "Todas las prometidas ya pasaron",
            fechas: null,
        };
    } else {
        prometida = {
            atajo: "prometida",
            titulo: "Hasta la prometida más lejana",
            detalle: `hasta el ${diaCorto(diaPrometida)} · OT ${masLejana!.numero}`,
            fechas: { desde, hasta: diaPrometida, atajo: "prometida" },
        };
    }

    return [
        {
            atajo: "semana",
            titulo: mismaSemana ? "Esta semana" : "La semana que viene",
            detalle: isoDia(finSemana) === desde
                ? `sólo el ${diaCorto(desde)}`
                : `${diaCorto(desde)} – ${diaCorto(isoDia(finSemana))}`,
            fechas: { desde, hasta: isoDia(finSemana), atajo: "semana" },
        },
        {
            atajo: "dos-semanas",
            titulo: "Dos semanas",
            detalle: `hasta el ${diaCorto(isoDia(finDos))}`,
            fechas: { desde, hasta: isoDia(finDos), atajo: "dos-semanas" },
        },
        prometida,
        {
            atajo: "sin-tope",
            titulo: "Sin tope",
            detalle: "que dure lo que tarde",
            fechas: { atajo: "sin-tope" },
        },
    ];
}

// ---------------------------------------------------------------------------
// Vigencia, textos y lo que va al backend
// ---------------------------------------------------------------------------

/**
 * La elección, puesta al día con el arranque real. `null` si ya no sirve.
 *
 * La pantalla queda abierta horas: lo elegido a las 06:50 con «desde hoy» a las
 * 07:05 ya arranca mañana. El `desde` se sube al arranque; si el `hasta` quedó
 * antes del arranque, el rango no tiene ningún día y hay que volver a elegir.
 */
export function fechasVigentes(f: FechasDelPlan | null | undefined, arranque: Date): FechasDelPlan | null {
    if (!f) return null;
    const inicio = isoDia(arranque);
    if (f.hasta && f.hasta < inicio) return null;
    // Con tope, el `desde` queda escrito (el chip dice «del … al …»); sin tope sólo
    // importa si es un arranque a futuro.
    const desde = f.desde && f.desde > inicio ? f.desde : (f.hasta ? inicio : undefined);
    return { ...f, desde };
}

/**
 * Lo que se le manda al planificador.
 *
 * El `desde` va sólo si es POSTERIOR al arranque: si es el mismo día, mandarlo no
 * cambia el plan, pero la vista previa lo leía como «arranca ese día porque elegiste
 * arrancar ese día» cuando el motivo real era que la jornada de hoy ya había empezado.
 */
export function rangoParaElPlan(f: FechasDelPlan | null | undefined, arranque: Date): RangoParaElPlan {
    const v = fechasVigentes(f, arranque);
    if (!v) return {};
    const inicio = isoDia(arranque);
    return {
        fecha_desde: v.desde && v.desde > inicio ? v.desde : undefined,
        fecha_hasta: v.hasta,
    };
}

/** Días hábiles de la elección (los dos extremos incluidos). `null` = sin tope. */
export function diasHabilesDe(
    f: FechasDelPlan,
    arranque: Date,
    feriados: Iterable<string>,
    dias: ReadonlySet<number> = LUNES_A_VIERNES,
): number | null {
    if (!f.hasta) return null;
    return contarDiasHabiles(f.desde ?? isoDia(arranque), f.hasta, feriados, dias);
}

const textoDias = (n: number) => `${n} ${n === 1 ? "día hábil" : "días hábiles"}`;

/**
 * El período en palabras: «Del lun 28/9 al vie 9/10», «Sólo el lun 28/9»,
 * «Desde el lun 5/10, sin tope» o «Sin tope».
 */
export function textoDelPeriodo(f: FechasDelPlan, arranque: Date): string {
    const desde = f.desde ?? isoDia(arranque);
    if (!f.hasta) {
        return f.desde && f.desde > isoDia(arranque)
            ? `Desde el ${diaCorto(f.desde)}, sin tope`
            : "Sin tope";
    }
    if (desde === f.hasta) return `Sólo el ${diaCorto(desde)}`;
    return `Del ${diaCorto(desde)} al ${diaCorto(f.hasta)}`;
}

/** «Del lun 28/9 al vie 9/10 · 10 días hábiles» o «Sin tope · dura lo que tarde». */
export function resumenDelPeriodo(
    f: FechasDelPlan,
    arranque: Date,
    feriados: Iterable<string>,
    dias: ReadonlySet<number> = LUNES_A_VIERNES,
): { periodo: string; dias: string } {
    const n = diasHabilesDe(f, arranque, feriados, dias);
    return {
        periodo: textoDelPeriodo(f, arranque),
        dias: n === null ? "dura lo que tarde" : textoDias(n),
    };
}

/** Dos elecciones dicen lo mismo (el atajo no importa: son las mismas fechas). */
export function mismasFechas(a: FechasDelPlan | null | undefined, b: FechasDelPlan | null | undefined, arranque: Date): boolean {
    const ra = rangoParaElPlan(a, arranque);
    const rb = rangoParaElPlan(b, arranque);
    return !!a && !!b && ra.fecha_desde === rb.fecha_desde && ra.fecha_hasta === rb.fecha_hasta;
}

// ---------------------------------------------------------------------------
// La última elección, recordada en la sesión
// ---------------------------------------------------------------------------

const CLAVE = "spmm:planificador:fechas";

/**
 * Se recuerda en `sessionStorage`: lo que dura la pestaña. Alcanza para no volver a
 * elegir lo mismo en cada tanda del día, y no arrastra a mañana un «hasta» que ya
 * pasó. Todo va en try/catch: en una ventana privada o con el almacenamiento
 * bloqueado, simplemente no se recuerda.
 */
export function recordarFechas(f: FechasDelPlan): void {
    try {
        sessionStorage.setItem(CLAVE, JSON.stringify(f));
    } catch { /* sin almacenamiento: no se recuerda y listo */ }
}

/**
 * La última elección de la sesión, rehecha para HOY: un atajo se vuelve a calcular
 * (el «esta semana» de ayer no es el de hoy) y un rango a mano se pone al día o se
 * descarta si ya pasó.
 */
export function fechasRecordadas(atajos: OpcionDeAtajo[], arranque: Date): FechasDelPlan | null {
    let crudo: unknown = null;
    try {
        const texto = sessionStorage.getItem(CLAVE);
        crudo = texto ? JSON.parse(texto) : null;
    } catch {
        return null;
    }
    if (!crudo || typeof crudo !== "object") return null;
    const r = crudo as Record<string, unknown>;
    const esDia = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const atajo = typeof r.atajo === "string" ? (r.atajo as AtajoDeFechas) : undefined;
    if (atajo) {
        const opcion = atajos.find(a => a.atajo === atajo);
        if (opcion?.fechas) return opcion.fechas;
    }
    // Un rango a mano necesita su «hasta»: sin él no hay nada que recordar.
    if (!esDia(r.hasta)) return null;
    return fechasVigentes({ desde: esDia(r.desde) ? r.desde : undefined, hasta: r.hasta }, arranque);
}
