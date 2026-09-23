/**
 * Días hábiles y capacidad de cada persona, contados con el calendario real del taller.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (Julián, 23/09/2026)
 *
 *   «se quedaba trabada en 4,9 cuando en realidad son más, arreglalo que diga los
 *    días reales».
 *
 * El plan de Lucas del 23/9 iba del jueves 24/9 a las 07:00 al martes 6/10 a las
 * 10:00, y la vista previa decía «11 días hábiles». Son 9: la cuenta sólo sacaba los
 * domingos y dejaba los sábados «porque pueden trabajarse», pero hoy todos los
 * operarios tienen cargado de lunes a viernes. Y el panel de carga comparaba TODO lo
 * que el plan le da a cada uno contra 44 h fijas de una semana: Guillermo aparecía
 * con 72,5 h / 44 h en un plan que dura dos semanas, cuando en esos 9 días él trabaja
 * 9 × 8,25 = 74,25 h.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Ojo con la diferencia con `plan-fechas.ts`: aquel es el espejo de la cuenta de
 * minutos del backend y le da 300 minutos a CUALQUIER sábado, trabaje quien trabaje.
 * Esto de acá no ubica procesos en el calendario: cuenta qué días trabaja la gente de
 * verdad, según el `dias_trabajo` de cada operario (lo mismo que mira el backend en
 * `dias_trabajo_de`). Por eso vive aparte y no toca aquel archivo.
 */

import { MIN_LABORAL_DIA, MIN_LABORAL_SABADO } from "./plan-fechas";

/** Códigos con los que se guarda `operario.dias_trabajo`, a `Date.getDay()` (Dom = 0). */
const CODIGOS: Record<string, number> = {
    SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const SABADO = 6;

/** Lo que se da por hecho cuando no hay nada cargado: de lunes a viernes. */
export const LUNES_A_VIERNES: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

/** Lo mínimo que hace falta de un operario para contar sus días y sus horas. */
export interface HorarioDeOperario {
    dias_trabajo?: string | null;
    hora_inicio?: string | null;
    hora_fin?: string | null;
    min_desayuno?: number | string | null;
    min_almuerzo?: number | string | null;
    disponible?: boolean | null;
}

/**
 * "MON,TUE,WED,THU,FRI" → {1,2,3,4,5}. Vacío o ilegible = de lunes a viernes, igual
 * que `dias_trabajo_de` en el backend.
 */
export function diasDeTrabajo(csv?: string | null): Set<number> {
    const dias = new Set<number>();
    for (const codigo of (csv || "").split(",")) {
        const dia = CODIGOS[codigo.trim().toUpperCase()];
        if (dia !== undefined) dias.add(dia);
    }
    return dias.size > 0 ? dias : new Set(LUNES_A_VIERNES);
}

/**
 * Los días de la semana en que trabaja AL MENOS una persona del taller.
 *
 * Es lo que define un «día hábil» del plan: si nadie trabaja los sábados, un sábado
 * en el medio del plan no es un día de trabajo aunque el calendario lo tenga. Se miran
 * sólo los disponibles; sin datos, de lunes a viernes.
 */
export function diasQueTrabajaElTaller(operarios: ReadonlyArray<HorarioDeOperario> = []): Set<number> {
    const dias = new Set<number>();
    for (const op of operarios) {
        if (op?.disponible === false) continue;
        diasDeTrabajo(op?.dias_trabajo).forEach(d => dias.add(d));
    }
    return dias.size > 0 ? dias : new Set(LUNES_A_VIERNES);
}

const NOMBRES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** {1..5} → "de lunes a viernes"; {1..6} → "de lunes a sábado"; si no, la lista. */
export function describirDias(dias: ReadonlySet<number>): string {
    const orden = [1, 2, 3, 4, 5, 6, 0].filter(d => dias.has(d));
    if (orden.length === 0) return "ningún día";
    // Corridos de lunes en adelante: "de lunes a X".
    const corridos = orden.every((d, i) => d === [1, 2, 3, 4, 5, 6, 0][i]);
    if (corridos && orden.length >= 3) return `de lunes a ${NOMBRES[orden[orden.length - 1]]}`;
    const nombres = orden.map(d => NOMBRES[d]);
    return nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

const aMinutos = (hhmm?: string | null): number | null => {
    if (!hhmm || typeof hhmm !== "string") return null;
    const [h, m] = hhmm.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
};

/**
 * Minutos de trabajo efectivo de un día de semana de esa persona: su horario menos el
 * desayuno y el almuerzo. Sin horario cargado (o uno que no cierra), la jornada del
 * taller: 07:00 a 16:00 con las pausas = 495.
 */
export function jornadaDelOperario(op?: HorarioDeOperario | null): number {
    const ini = aMinutos(op?.hora_inicio);
    const fin = aMinutos(op?.hora_fin);
    if (ini === null || fin === null || fin <= ini) return MIN_LABORAL_DIA;
    const pausas = (Number(op?.min_desayuno) || 0) + (Number(op?.min_almuerzo) || 0);
    const neto = fin - ini - pausas;
    return neto > 0 ? neto : MIN_LABORAL_DIA;
}

const clave = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** El día, a las 00:00 locales. Una fecha "YYYY-MM-DD" se lee LOCAL, no UTC. */
function soloElDia(valor: Date | string): Date | null {
    if (valor instanceof Date) {
        if (Number.isNaN(valor.getTime())) return null;
        return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
    }
    const [a, m, d] = String(valor).slice(0, 10).split("-").map(Number);
    if (!a || !m || !d) return null;
    return new Date(a, m - 1, d);
}

/**
 * Los días del calendario, de `desde` a `hasta` (los dos incluidos, aunque el plan
 * arranque o termine a mitad de jornada), que caen en `dias` y no son feriado.
 *
 * Con el plan de Lucas —jue 24/9 07:00 → mar 6/10 10:00, todos de lunes a viernes—
 * da 9: 24, 25, 28, 29, 30, 1, 2, 5 y 6.
 */
export function contarDiasHabiles(
    desde: Date | string,
    hasta: Date | string,
    feriados: Iterable<string> = [],
    dias: ReadonlySet<number> = LUNES_A_VIERNES,
): number {
    const d0 = soloElDia(desde);
    const d1 = soloElDia(hasta);
    if (!d0 || !d1 || d1 < d0) return 0;
    const bloqueados = feriados instanceof Set ? feriados : new Set(feriados);
    let total = 0;
    // Tope de seguridad: tres años. Una fecha corrupta no puede colgar la pantalla.
    for (let d = new Date(d0), i = 0; d <= d1 && i < 1100; d.setDate(d.getDate() + 1), i++) {
        if (dias.has(d.getDay()) && !bloqueados.has(clave(d))) total++;
    }
    return total;
}

export interface CapacidadEnElPeriodo {
    /** Días del período que esa persona trabaja (sus días, sin feriados). */
    dias: number;
    /** Su jornada de lunes a viernes, en minutos. */
    jornada: number;
    /** Lo que puede trabajar en todo el período, en minutos. */
    minutos: number;
}

/**
 * Cuánto puede trabajar una persona entre dos fechas: los días que ELLA trabaja ×
 * su jornada. El sábado, si lo trabaja, cuenta como en el backend: 07:00 a 12:00.
 */
export function capacidadEnElPeriodo(
    op: HorarioDeOperario | null | undefined,
    desde: Date | string,
    hasta: Date | string,
    feriados: Iterable<string> = [],
): CapacidadEnElPeriodo {
    const jornada = jornadaDelOperario(op);
    const suyos = diasDeTrabajo(op?.dias_trabajo);
    const d0 = soloElDia(desde);
    const d1 = soloElDia(hasta);
    if (!d0 || !d1 || d1 < d0) return { dias: 0, jornada, minutos: 0 };
    const bloqueados = feriados instanceof Set ? feriados : new Set(feriados);
    let dias = 0;
    let minutos = 0;
    for (let d = new Date(d0), i = 0; d <= d1 && i < 1100; d.setDate(d.getDate() + 1), i++) {
        if (!suyos.has(d.getDay()) || bloqueados.has(clave(d))) continue;
        dias++;
        minutos += d.getDay() === SABADO ? Math.min(jornada, MIN_LABORAL_SABADO) : jornada;
    }
    return { dias, jornada, minutos };
}

/** 6.93 → "6,9"; 74 → "74"; con `decimales = 2`, 8.25 → "8,25". Coma, como se escribe acá. */
export function numeroEs(n: number, decimales = 1): string {
    if (!Number.isFinite(n)) return "—";
    const redondo = Math.round(n * 10 ** decimales) / 10 ** decimales;
    // Sin ceros de relleno: 7,1 y no 7,10; 74 y no 74,0.
    const texto = redondo.toFixed(decimales);
    return (texto.includes(".") ? texto.replace(/0+$/, "").replace(/\.$/, "") : texto).replace(".", ",");
}
