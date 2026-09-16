/**
 * Las fechas de un plan, contadas UNA sola vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL BUG QUE LO TRAJO (Julián, 16/09/2026)
 *
 *   «recién hice una planificación miércoles 11am y me pone procesos para el día
 *    de hoy pero a las 9am, no tiene sentido».
 *
 * La pantalla mostraba, para una planificación hecha el miércoles a las 11:00:
 *
 *      PREPARACION DE TORNO ......... Mié 16/09 09:00
 *      PROGRAMACION TORNO CNC ....... Mié 16/09 09:06
 *      TORNO T1 ..................... Mié 16/09 13:45
 *      AGUJEREADO EN FRESADORA ...... Jue 17/09 16:20
 *
 * Tres cosas imposibles en esos cuatro renglones: son horas YA PASADAS, las 09:06
 * caen en el desayuno (09:00–09:15) y las 16:20 son después de que el taller cerró.
 *
 * El backend nunca dijo eso. El backend ya calcula la fecha de cada proceso con la
 * jornada real del taller y con el arranque del plan —que, planificando un miércoles
 * a las 11, es el JUEVES a las 07:00, porque la jornada del miércoles ya había
 * empezado— y la manda hecha en `fecha_inicio_estimada`.
 *
 * El frontend la tiraba a la basura y la recalculaba solo, con dos datos equivocados:
 *
 *   1. la base: `creado_en` puesto a las 09:00 — o sea el día en que se apretó
 *      "Planificar", que es justo el día que el plan NO usa; y
 *   2. la jornada: 09:00 a 18:00 de corrido (540 minutos, sin desayuno ni almuerzo),
 *      que no es la del taller (07:00 a 16:00 con pausas = 495 minutos).
 *
 * Esa cuenta estaba copiada en seis lugares distintos.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ESTE ARCHIVO ES EL ÚNICO LUGAR donde el frontend traduce entre los minutos del
 * planificador y una fecha de calendario. La regla de oro es corta:
 *
 *   - PARA MOSTRAR: se usa la fecha que mandó el backend. Punto. No se recalcula.
 *   - PARA VOLVER ATRÁS (alguien arrastra un proceso en el Gantt o le escribe otro
 *     horario a mano): ahí sí hay que convertir fecha → minutos, y se hace con la
 *     MISMA jornada y el MISMO arranque que usó el backend.
 *
 * Las constantes de acá abajo son un espejo de `backend/application/PlanificacionService.py`
 * y no pueden separarse: `backend/tests/test_jornada_front_y_back_no_se_separan.py`
 * corre las dos implementaciones y las compara minuto a minuto.
 */

import type { PlanificacionItem } from "./types";

/** El taller abre a las 07:00. Es el T=0 de cualquier día del plan. */
export const HORA_APERTURA = 7;

/** Desayuno: 09:00 a 09:15. */
export const MIN_DESAYUNO = 15;
/** Almuerzo: 12:00 a 12:30. */
export const MIN_ALMUERZO = 30;

/**
 * (inicio, fin) en minutos TRABAJADOS del día. Los cortes son las pausas:
 *   07:00–09:00 (120) · desayuno · 09:15–12:00 (165) · almuerzo · 12:30–16:00 (210)
 */
export const TRAMOS_LV: ReadonlyArray<readonly [number, number]> = [
    [0, 120],
    [120, 285],
    [285, 495],
];

/** Sábado: 07:00 a 12:00 de corrido. */
export const TRAMOS_SABADO: ReadonlyArray<readonly [number, number]> = [[0, 300]];

/** 495 minutos de trabajo efectivo de lunes a viernes. */
export const MIN_LABORAL_DIA = TRAMOS_LV[TRAMOS_LV.length - 1][1];
/** 300 el sábado. */
export const MIN_LABORAL_SABADO = TRAMOS_SABADO[TRAMOS_SABADO.length - 1][1];

/** Domingo en `Date.getDay()`. Ojo: JS numera Dom=0 y Python Lun=0. */
const DOMINGO = 0;
const SABADO = 6;

const unDia = (fecha: Date, dias: number): Date => {
    const salida = new Date(fecha);
    salida.setDate(salida.getDate() + dias);
    return salida;
};

const aClave = (fecha: Date): string =>
    `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(
        fecha.getDate()
    ).padStart(2, "0")}`;

/** Cuánto se trabaja ese día del calendario. Domingo y feriado: nada. */
const capacidadDelDia = (fecha: Date, feriados: Set<string>): number => {
    if (feriados.has(aClave(fecha))) return 0;
    const dia = fecha.getDay();
    if (dia === DOMINGO) return 0;
    if (dia === SABADO) return MIN_LABORAL_SABADO;
    return MIN_LABORAL_DIA;
};

/**
 * Pausas acumuladas antes de llegar a ese minuto de trabajo del día.
 *
 * Es lo que hay que sumarle a un "minuto trabajado" para llegar a la hora de reloj:
 * el minuto 285 de trabajo no son las 11:45 sino las 12:00, porque en el medio hubo
 * un desayuno.
 */
export function minutosMuertosDelDia(minutosTrabajados: number, esSabado = false): number {
    if (esSabado) return 0;
    let muertos = 0;
    if (minutosTrabajados > TRAMOS_LV[0][1]) muertos += MIN_DESAYUNO;
    if (minutosTrabajados > TRAMOS_LV[1][1]) muertos += MIN_ALMUERZO;
    return muertos;
}

/**
 * Pasa una hora de reloj al minuto de TRABAJO del día que le corresponde.
 *
 * Es la vuelta de `minutosMuertosDelDia`: las 09:00 de un día de semana son el minuto
 * 120, las 12:30 el 285. Una hora que cae dentro de una pausa se resuelve al borde del
 * tramo anterior (las 09:07 son el minuto 120, igual que las 09:00): durante el
 * desayuno no se trabajó nada.
 */
export function minutosDeTrabajoDeLaHora(fecha: Date, esSabado = false): number {
    const tramos = esSabado ? TRAMOS_SABADO : TRAMOS_LV;
    const reloj = fecha.getHours() * 60 + fecha.getMinutes() - HORA_APERTURA * 60;
    if (reloj <= 0) return 0;
    for (const [ini, fin] of tramos) {
        const muertos = minutosMuertosDelDia(ini + 1, esSabado);
        if (reloj <= fin + muertos) return Math.min(fin, Math.max(ini, reloj - muertos));
    }
    return tramos[tramos.length - 1][1];
}

/** El primer día en que se puede trabajar, de esa fecha en adelante. */
function avanzarADiaValido(fecha: Date, feriados: Set<string>): Date {
    let cursor = new Date(fecha);
    // Tope de seguridad: un año. Sin él, un set de feriados mal cargado colgaría la
    // pantalla en un while infinito.
    for (let i = 0; i < 366 && capacidadDelDia(cursor, feriados) === 0; i++) {
        cursor = unDia(cursor, 1);
        cursor.setHours(HORA_APERTURA, 0, 0, 0);
    }
    return cursor;
}

/**
 * Minutos del planificador → fecha real de calendario.
 *
 * Espejo exacto de `_convertir_minutos_a_fecha` del backend. Se usa SOLO cuando el
 * backend no mandó la fecha hecha (datos viejos, o una fila que todavía no pasó por
 * la API): mientras venga `fecha_inicio_estimada`, esa manda.
 */
export function fechaDesdeMinutos(
    base: Date,
    minutos: number,
    feriados: Iterable<string> = [],
    esFin = false
): Date {
    const dias = feriados instanceof Set ? feriados : new Set(feriados);

    const arranque = new Date(base);
    arranque.setHours(HORA_APERTURA, 0, 0, 0);

    let cursor = avanzarADiaValido(arranque, dias);
    let restantes = Math.max(0, Math.round(minutos));

    // Tope de seguridad: 5 años de jornadas. Un `fin_min` corrupto no puede colgar
    // la pantalla.
    for (let vueltas = 0; restantes > 0 && vueltas < 2000; vueltas++) {
        const capacidad = capacidadDelDia(cursor, dias);
        if (capacidad === 0) {
            cursor = avanzarADiaValido(unDia(cursor, 1), dias);
            continue;
        }
        // En el borde exacto de la jornada, un FIN se queda en el cierre de este día y
        // un inicio pasa a la apertura del siguiente: el minuto 495 es las dos cosas a
        // la vez. Sin la distinción, un proceso que cierra la jornada figuraba
        // terminando al otro día a las 07:00 y se colaba un día de más en la Diaria.
        if (esFin ? restantes > capacidad : restantes >= capacidad) {
            restantes -= capacidad;
            cursor = avanzarADiaValido(unDia(cursor, 1), dias);
            continue;
        }
        const esSabado = cursor.getDay() === SABADO;
        cursor = new Date(
            cursor.getTime() + (restantes + minutosMuertosDelDia(restantes, esSabado)) * 60_000
        );
        restantes = 0;
    }

    return cursor;
}

/**
 * Fecha real → minutos del planificador. La vuelta del ovillo.
 *
 * La necesitan las dos pantallas donde alguien MUEVE un proceso a mano: arrastrarlo
 * en el Gantt y escribirle otro «Inicio Estimado». Lo que se guarda no es la fecha
 * sino el minuto, así que esta cuenta tiene que ser la inversa exacta de
 * `fechaDesdeMinutos` — si no, mover un proceso un centímetro lo corre un día.
 */
export function minutosDesdeFecha(
    base: Date,
    fecha: Date,
    feriados: Iterable<string> = []
): number {
    const dias = feriados instanceof Set ? feriados : new Set(feriados);

    const arranque = new Date(base);
    arranque.setHours(HORA_APERTURA, 0, 0, 0);

    let cursor = avanzarADiaValido(arranque, dias);
    if (fecha <= cursor) return 0;

    let total = 0;
    for (let vueltas = 0; vueltas < 2000; vueltas++) {
        const capacidad = capacidadDelDia(cursor, dias);
        if (capacidad === 0) {
            cursor = avanzarADiaValido(unDia(cursor, 1), dias);
            continue;
        }
        if (aClave(cursor) === aClave(fecha)) {
            return total + minutosDeTrabajoDeLaHora(fecha, cursor.getDay() === SABADO);
        }
        if (fecha < cursor) {
            // La fecha pedida cayó un domingo o un feriado: se resuelve al arranque
            // del primer día hábil que le sigue, que es justo `total`.
            return total;
        }
        total += capacidad;
        cursor = avanzarADiaValido(unDia(cursor, 1), dias);
    }
    return total;
}

/**
 * "2026-10-05" como día LOCAL, no como UTC.
 *
 * `new Date("2026-10-05")` se lee como medianoche UTC, que en Argentina es el 4 a las
 * 21: un rango pedido "desde el 5" arrancaría el 4. Las fechas de esta base van sin
 * zona y se leen locales; ver [[fechas-todas-sin-zona]].
 */
function fechaLocalDesdeIso(valor: string): Date | null {
    const [y, m, d] = valor.slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

/**
 * Lee una fecha de la API. Vienen SIEMPRE sin zona ("2026-09-17T07:00:00"), porque
 * toda esta base guarda hora local de Argentina; `new Date` de un string así lo
 * interpreta como local, que es lo que queremos.
 */
export function fechaDeLaApi(valor: string | Date | null | undefined): Date | null {
    if (!valor) return null;
    const fecha = valor instanceof Date ? valor : new Date(valor);
    return isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Desde cuándo arranca un plan. Espejo de `inicio_del_plan` del backend.
 *
 * EL PLAN NUNCA EMPIEZA EN EL PASADO: si la jornada ya arrancó, el plan es para
 * mañana. Sólo se usa para planes viejos que no tienen guardado su arranque; los
 * nuevos lo traen en `inicio_base` y no hay nada que adivinar.
 */
export function inicioDelPlan(
    ahora: Date,
    feriados: Iterable<string> = [],
    fechaDesde?: string | null
): Date {
    const dias = feriados instanceof Set ? feriados : new Set(feriados);
    let inicio: Date;

    // Una fecha pedida a futuro MANDA: si alguien pidió planificar desde el mes que
    // viene, el plan arranca a la apertura de ese día. Es la primera rama de
    // `inicio_del_plan` en el backend, y acá faltaba: un plan pedido con rango a futuro
    // se leía como si arrancara mañana, o sea semanas antes de lo que dice el plan.
    const pedida = fechaDesde ? fechaLocalDesdeIso(fechaDesde) : null;
    if (pedida && pedida > new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())) {
        inicio = new Date(pedida.getFullYear(), pedida.getMonth(), pedida.getDate(),
                          HORA_APERTURA, 0, 0, 0);
    } else {
        inicio = new Date(ahora);
        const jornadaEmpezada = ahora.getHours() >= HORA_APERTURA;
        inicio.setHours(HORA_APERTURA, 0, 0, 0);
        if (jornadaEmpezada) inicio = unDia(inicio, 1);
    }
    // Acá, a diferencia del resto del archivo, el sábado TAMPOCO sirve de arranque:
    // un plan no empieza un fin de semana.
    for (let i = 0; i < 366; i++) {
        const dia = inicio.getDay();
        if (dia !== DOMINGO && dia !== SABADO && !dias.has(aClave(inicio))) break;
        inicio = unDia(inicio, 1);
        inicio.setHours(HORA_APERTURA, 0, 0, 0);
    }
    return inicio;
}

/** Lo mínimo que hace falta de una fila del plan para ubicarla en el calendario. */
type FilaDePlan = Pick<PlanificacionItem, "inicio_min" | "fin_min"> &
    Partial<Pick<PlanificacionItem, "creado_en" | "inicio_base" | "fecha_inicio_estimada" | "fecha_fin_estimada">>;

/**
 * El arranque con el que se armó ESTE plan.
 *
 * Cada plan se lee con el suyo, nunca con el de hoy: un plan guardado el viernes
 * tiene que seguir diciendo lo mismo el lunes.
 */
export function baseDelPlan(item: FilaDePlan, feriados: Iterable<string> = []): Date {
    const guardado = fechaDeLaApi(item.inicio_base);
    if (guardado) return guardado;
    const creado = fechaDeLaApi(item.creado_en);
    return inicioDelPlan(creado || new Date(), feriados);
}

/**
 * Cuándo empieza este proceso. LA función que debería usar toda la UI.
 *
 * Primero mira la fecha que mandó el backend —que es la buena, la que sale de la
 * jornada real y del arranque de ese plan— y recién si no está la calcula.
 */
export function inicioDeLaFila(item: FilaDePlan, feriados: Iterable<string> = []): Date | null {
    const delBackend = fechaDeLaApi(item.fecha_inicio_estimada);
    if (delBackend) return delBackend;
    if (typeof item.inicio_min !== "number") return null;
    return fechaDesdeMinutos(baseDelPlan(item, feriados), item.inicio_min, feriados);
}

/** Cuándo termina. Misma regla que `inicioDeLaFila`. */
export function finDeLaFila(item: FilaDePlan, feriados: Iterable<string> = []): Date | null {
    const delBackend = fechaDeLaApi(item.fecha_fin_estimada);
    if (delBackend) return delBackend;
    const minutos =
        typeof item.fin_min === "number" && item.fin_min > item.inicio_min
            ? item.fin_min
            : item.inicio_min;
    if (typeof minutos !== "number") return null;
    return fechaDesdeMinutos(baseDelPlan(item, feriados), minutos, feriados, true);
}

const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "Jue 17/09 07:00" — el formato que se ve en la columna «Inicio Estimado». */
export function formatoCorto(fecha: Date): string {
    const dd = String(fecha.getDate()).padStart(2, "0");
    const mm = String(fecha.getMonth() + 1).padStart(2, "0");
    const hh = String(fecha.getHours()).padStart(2, "0");
    const mi = String(fecha.getMinutes()).padStart(2, "0");
    return `${DIAS_CORTOS[fecha.getDay()]} ${dd}/${mm} ${hh}:${mi}`;
}

/** "2026-09-17T07:00" — lo que espera un `<input type="datetime-local">`. */
export function paraInputDatetimeLocal(fecha: Date): string {
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, "0");
    const dd = String(fecha.getDate()).padStart(2, "0");
    const hh = String(fecha.getHours()).padStart(2, "0");
    const mi = String(fecha.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
