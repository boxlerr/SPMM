/**
 * La carga de cada persona en la vista previa, repartida por día y por semana.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (Julián, 25/09/2026, queja 6)
 *
 * La tarjeta decía «Guillermo Celiz · 63% · 109,8h / 173,3h · +109,8h nuevas» y no
 * había forma de entender de dónde salía el 173,3: la cuenta (21 días × 8,25 h) vivía
 * en un cartelito que tarda en aparecer y que en la tablet no aparece nunca. Además
 * se comparaba siempre contra TODO el plan (28/9 → 26/10), que lo estira una sola
 * máquina cuello: Guillermo podía estar lleno la semana del piloto y parado las
 * otras tres, y la tarjeta decía 63 %.
 *
 * Esto reparte lo que el plan le da a cada uno en los días del calendario, así el
 * panel puede mirar una semana (la del piloto, por defecto) y escribir la cuenta.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * No toca `plan-fechas.ts` ni `diasHabiles.ts`: esos dos tienen tests espejo contra
 * el backend. Solo se usan. `backend/tests/test_carga_del_plan_front.py` compila este
 * archivo y verifica las cuentas.
 *
 * Todo es de lectura: no ubica procesos, no recalcula nada. Las fechas que manda el
 * backend mandan; lo único que se estima es CÓMO se reparten en los días los
 * procesos que el solver partió en varios tramos (el backend manda el inicio del
 * primero y el fin del último) y los que alguien movió a mano.
 */

import { fechaDeLaApi, minutosDeTrabajoDeLaHora, MIN_LABORAL_DIA, MIN_LABORAL_SABADO } from "./plan-fechas";
import {
    capacidadEnElPeriodo,
    jornadaDelOperario,
    diasDeTrabajo,
    describirDias,
    numeroEs,
    type CapacidadEnElPeriodo,
    type HorarioDeOperario,
} from "./diasHabiles";
import { nombrePersona } from "./nombres";

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Lo que hace falta de una fila del plan. Estructural: sirve cualquier fila efectiva. */
export interface FilaDeCarga {
    orden_id: number;
    id_otvieja?: number | null;
    cliente?: string | null;
    nombre_proceso: string;
    secuencia?: number;
    duracion_min: number;
    fecha_inicio_estimada?: string | null;
    fecha_fin_estimada?: string | null;
    id_operario?: number | null;
    id_rango_operario?: number | null;
    maquinaria_nombre?: string | null;
    operario_nombre?: string | null;
    rangos_permitidos_proceso?: number[] | null;
    tercerizado?: boolean;
    slot_extra?: boolean;
    /** El inicio lo cambió alguien a mano en la tabla: el fin que trae ya no vale. */
    fechaEditada?: boolean;
}

export interface OperarioDeCarga extends HorarioDeOperario {
    id: number;
    nombre?: string;
    apellido?: string;
    sector?: string | null;
    rangos?: unknown[];
}

export type Estado = "pasado" | "lleno" | "conLugar" | "sinTrabajo";

export interface Semana {
    /** El lunes de esa semana, "YYYY-MM-DD". */
    clave: string;
    /** Primer día de la semana que cae dentro del plan. */
    desde: string;
    /** Último día de la semana que cae dentro del plan. */
    hasta: string;
    /** Sus días hábiles (los que trabaja alguien, sin feriados). */
    dias: string[];
    /** "28/9 – 2/10", o "26/10" si es un solo día. */
    etiqueta: string;
}

/** Un pedazo de una fila en un día. `dia` vacío = la fila no tiene fecha. */
export interface Tramo {
    dia: string;
    min: number;
    /** El reparto de ese día es estimado (proceso partido o fecha cambiada a mano). */
    aprox: boolean;
    fila: FilaDeCarga;
}

export interface PersonaDeCarga {
    op: OperarioDeCarga;
    nombre: string;
    noDisponible: boolean;
    porDia: Record<string, number>;
    tramos: Tramo[];
    sinFechaMin: number;
    /** Lo que ya tenía de un plan guardado, en todo el período (no se sabe por día). */
    previaMin: number;
}

export interface Span {
    desde: string;
    hasta: string;
    habiles: number;
}

export interface CargaDelPlan {
    span: Span | null;
    periodoSinFechas: Span | null;
    semanas: Semana[];
    diasDelPlan: string[];
    personas: PersonaDeCarga[];
    /** Sector PRUEBAS: no tienen tarjeta, pero sus horas las hace alguien. */
    ocultas: PersonaDeCarga[];
    /** Puestos «VACANTE … A CUBRIR»: no son personas, ese trabajo no lo hace nadie. */
    vacantes: PersonaDeCarga[];
    sinNadie: Tramo[];
    terceros: Tramo[];
    excedentesMin: number;
    ultimo: FilaDeCarga | null;
    feriadosEnElPlan: string[];
    feriados: Set<string>;
    diasDelTaller: Set<number>;
    /** Minutos de cada fila del plan sumados, tal cual (con los ayudantes). */
    totalFilasMin: number;
    /** Ocupación del equipo por semana: para la barrita del selector. */
    equipoPorSemana: Record<string, { min: number; cap: number }>;
    /** Capacidad de una persona un día. Cacheada. */
    capDia: (op: HorarioDeOperario & { id?: number }, dia: string) => number;
}

// ─── Utilidades de fecha ──────────────────────────────────────────────────────

const SABADO = 6;
const CODIGOS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const clave = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "2026-09-28..." → el día a las 00:00 locales. */
const desdeClave = (valor: string): Date | null => {
    const [a, m, d] = String(valor).slice(0, 10).split("-").map(Number);
    if (!a || !m || !d) return null;
    return new Date(a, m - 1, d);
};

const masDias = (dia: string, n: number): string => {
    const d = desdeClave(dia);
    if (!d) return dia;
    d.setDate(d.getDate() + n);
    return clave(d);
};

const diaDeLaSemana = (dia: string): number => desdeClave(dia)?.getDay() ?? -1;

/** Los días del calendario entre dos claves, las dos incluidas. Tope de un año. */
function diasEntre(desde: string, hasta: string): string[] {
    const salida: string[] = [];
    const d0 = desdeClave(desde);
    const d1 = desdeClave(hasta);
    if (!d0 || !d1 || d1 < d0) return salida;
    for (let d = new Date(d0), i = 0; d <= d1 && i < 400; d.setDate(d.getDate() + 1), i++) {
        salida.push(clave(d));
    }
    return salida;
}

/** "2026-09-28" → "28/9". */
export function diaYMes(dia: string): string {
    const d = desdeClave(dia);
    return d ? `${d.getDate()}/${d.getMonth() + 1}` : dia;
}

/** "2026-09-28" → "lun 28/9". */
export function diaCorto(dia: string): string {
    const d = desdeClave(dia);
    return d ? `${DIAS_CORTOS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}` : dia;
}

/** "2026-09-28" → "Lun 28/9". Para arrancar un renglón. */
export function diaCortoMayuscula(dia: string): string {
    const t = diaCorto(dia);
    return t.charAt(0).toUpperCase() + t.slice(1);
}

/** 34889 → "581h 29m". El mismo formato que la «Carga total» del encabezado. */
export function horasYMinutos(min: number): string {
    if (!(min > 0)) return "0 min";
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h} h` : `${h}h ${m}m`;
}

/** Minutos → "40,5 h" (un decimal) o, con `decimales = 2`, "41,25 h". */
export function horas(min: number, decimales = 1): string {
    return `${numeroEs(min / 60, decimales)} h`;
}

/** Misma regla que `_es_vacante` del backend: los puestos «VACANTE … A CUBRIR». */
export function esVacante(nombre?: string | null): boolean {
    return (nombre || "").toUpperCase().startsWith("VACANTE");
}

const esPruebas = (op: OperarioDeCarga) => (op.sector || "").toUpperCase() === "PRUEBAS";

// ─── Armado ───────────────────────────────────────────────────────────────────

/** Un «balde» de carga: una persona, lo que quedó sin nadie o lo de terceros. */
interface Balde {
    op: HorarioDeOperario & { id?: number };
    /** Solo las personas tienen lugar libre: sin nadie y terceros no se «llenan». */
    respetaLibre: boolean;
    filas: FilaDeCarga[];
    porDia: Record<string, number>;
    tramos: Tramo[];
    sinFechaMin: number;
}

const nuevoBalde = (op: Balde["op"], respetaLibre: boolean): Balde => ({
    op, respetaLibre, filas: [], porDia: {}, tramos: [], sinFechaMin: 0,
});

const mdt = (f: Date) => minutosDeTrabajoDeLaHora(f, f.getDay() === SABADO);

/**
 * Reparte las filas de un balde en los días. Tres pasadas:
 *
 *  1. EXACTAS: empieza y termina el mismo día y nadie la tocó → todo a ese día.
 *     Todo proceso de un solo tramo cae acá: el solver ubica cada tramo entero en
 *     una ventana de un día.
 *  2. CAMBIADAS A MANO (o sin fin, o con el fin antes del inicio): se llena hacia
 *     adelante desde el inicio. NO mira el lugar libre: si alguien encimó trabajo a
 *     mano, el día se tiene que ver pasado.
 *  3. PARTIDAS en varios días: primero donde hay lugar libre, día por día y a la
 *     que termina antes (así un plan sin cambios no muestra días pasados que no
 *     existen), después sin ese límite.
 *
 * El total por balde es siempre exactamente la suma de `duracion_min`.
 */
function repartir(b: Balde, capDia: CargaDelPlan["capDia"], capCalendario: (dia: string) => number) {
    const suma = (dia: string, min: number, aprox: boolean, fila: FilaDeCarga) => {
        if (min <= 0) return;
        b.porDia[dia] = (b.porDia[dia] || 0) + min;
        b.tramos.push({ dia, min, aprox, fila });
    };

    const partidas: Array<{ fila: FilaDeCarga; I: Date; F: Date }> = [];

    for (const fila of b.filas) {
        const dur = Math.max(0, Number(fila.duracion_min) || 0);
        if (dur === 0) continue;
        const I = fechaDeLaApi(fila.fecha_inicio_estimada);
        const F = fechaDeLaApi(fila.fecha_fin_estimada);
        if (!I) {
            b.sinFechaMin += dur;
            b.tramos.push({ dia: "", min: dur, aprox: false, fila });
            continue;
        }
        const dI = clave(I);
        // Pasada 1.
        if (!fila.fechaEditada && F && clave(F) === dI) {
            suma(dI, dur, false, fila);
            continue;
        }
        // Pasada 2. `handleDateChange` solo cambia el inicio: el fin que trae es el
        // viejo y no sirve.
        if (fila.fechaEditada || !F || F < I) {
            let resto = dur;
            let dia = dI;
            const tomado: Record<string, number> = {};
            for (let i = 0; i < 60 && resto > 0; i++) {
                const cap = capDia(b.op, dia);
                const tope = i === 0 ? Math.max(0, cap - mdt(I)) : cap;
                const toma = Math.min(resto, tope);
                if (toma > 0) {
                    tomado[dia] = (tomado[dia] || 0) + toma;
                    resto -= toma;
                }
                dia = masDias(dia, 1);
            }
            if (resto > 0) tomado[dI] = (tomado[dI] || 0) + resto;
            for (const [d, m] of Object.entries(tomado)) suma(d, m, true, fila);
            continue;
        }
        partidas.push({ fila, I, F });
    }

    // Pasada 3. El tope de cada día sale del MISMO calendario con el que el backend
    // pasó los minutos a fechas (`_convertir_minutos_a_fecha`: 495 de lunes a viernes,
    // 300 el sábado), no del de la persona: es lo que dice dónde cayó cada tramo.
    const ps = partidas.map(({ fila, I, F }) => {
        const dias = diasEntre(clave(I), clave(F));
        const topes = dias.map((dia, k) => {
            const cap = capCalendario(dia);
            if (k === 0) return Math.max(0, cap - mdt(I));
            if (k === dias.length - 1) return Math.min(cap, mdt(F));
            return cap;
        });
        return {
            fila, I, F, dias, topes,
            indice: new Map(dias.map((d, k) => [d, k] as const)),
            tomado: dias.map(() => 0),
            resto: Math.max(0, Number(fila.duracion_min) || 0),
        };
    });

    // Primera vuelta: día por día, el lugar libre de ese día va primero a la que
    // termina antes. Con «la que arrancó antes primero», una partida de ventana larga
    // se comía el lugar de otra de ventana corta, y esa segunda aparecía como día
    // pasado sin que nadie hubiera tocado nada (pasaba con el plan real de las 48 OT).
    const todos = [...new Set(ps.flatMap(p => p.dias))].sort();
    for (const dia of todos) {
        let libre = b.respetaLibre ? Math.max(0, capDia(b.op, dia) - (b.porDia[dia] || 0)) : Infinity;
        const activas = ps
            .filter(p => p.resto > 0 && p.indice.has(dia))
            .sort((x, y) => x.F.getTime() - y.F.getTime() || x.I.getTime() - y.I.getTime());
        for (const p of activas) {
            if (libre <= 0) break;
            const k = p.indice.get(dia)!;
            const toma = Math.min(p.resto, p.topes[k] - p.tomado[k], libre);
            if (toma > 0) { p.tomado[k] += toma; p.resto -= toma; libre -= toma; }
        }
    }
    for (const p of ps) {
        // Segunda vuelta: sin el límite del lugar libre, hasta el tope del día. Primero
        // los días que la persona NO trabaja pero en los que el backend ubicó el tramo
        // (un sábado): ahí es donde está ese tiempo según las fechas, y se ve como
        // «trabajo en un día que no trabaja» en vez de inflar un día de semana.
        const orden = p.dias
            .map((dia, k) => k)
            .sort((x, y) => (capDia(b.op, p.dias[x]) === 0 ? 0 : 1) - (capDia(b.op, p.dias[y]) === 0 ? 0 : 1) || x - y);
        for (const k of orden) {
            if (p.resto <= 0) break;
            const toma = Math.min(p.resto, p.topes[k] - p.tomado[k]);
            if (toma > 0) { p.tomado[k] += toma; p.resto -= toma; }
        }
        if (p.resto > 0 && p.dias.length > 0) p.tomado[0] += p.resto;
        p.dias.forEach((dia, k) => suma(dia, p.tomado[k], true, p.fila));
    }
}

export interface ArmarCargaArgs {
    filas: FilaDeCarga[];
    operarios: OperarioDeCarga[];
    cargaPrevia?: Record<number, number>;
    feriados?: Iterable<string>;
    span: Span | null;
    periodoSinFechas?: Span | null;
    diasDelTaller: ReadonlySet<number>;
    excedentesMin?: number;
}

export function armarCargaDelPlan({
    filas,
    operarios,
    cargaPrevia = {},
    feriados = [],
    span,
    periodoSinFechas = null,
    diasDelTaller,
    excedentesMin = 0,
}: ArmarCargaArgs): CargaDelPlan {
    const feriadosSet = feriados instanceof Set ? (feriados as Set<string>) : new Set(feriados);
    const taller = new Set(diasDelTaller);

    // Capacidad de una persona en un día, cacheada: se pide miles de veces.
    const cache = new Map<string, number>();
    const capDia: CargaDelPlan["capDia"] = (op, dia) => {
        const k = `${op.id ?? "taller"}|${dia}`;
        let v = cache.get(k);
        if (v === undefined) {
            v = capacidadEnElPeriodo(op, dia, dia, feriadosSet).minutos;
            cache.set(k, v);
        }
        return v;
    };

    // Quien no tiene persona se mide con el taller: sus días y la jornada de 495.
    const opTaller: HorarioDeOperario = {
        dias_trabajo: [...taller].map(d => CODIGOS[d]).join(","),
    };

    // ── Días y semanas del plan ──
    const diasDelPlan: string[] = [];
    const semanas: Semana[] = [];
    if (span) {
        const primero = span.desde.slice(0, 10);
        const ultimoDia = span.hasta.slice(0, 10);
        for (const dia of diasEntre(primero, ultimoDia)) {
            if (taller.has(diaDeLaSemana(dia)) && !feriadosSet.has(dia)) diasDelPlan.push(dia);
        }
        const porLunes = new Map<string, string[]>();
        for (const dia of diasDelPlan) {
            const d = desdeClave(dia)!;
            const lunes = masDias(dia, -((d.getDay() + 6) % 7));
            if (!porLunes.has(lunes)) porLunes.set(lunes, []);
            porLunes.get(lunes)!.push(dia);
        }
        for (const [lunes, dias] of porLunes) {
            const domingo = masDias(lunes, 6);
            semanas.push({
                clave: lunes,
                desde: lunes > primero ? lunes : primero,
                hasta: domingo < ultimoDia ? domingo : ultimoDia,
                dias,
                etiqueta: dias.length === 1
                    ? diaYMes(dias[0])
                    : `${diaYMes(dias[0])} – ${diaYMes(dias[dias.length - 1])}`,
            });
        }
    }

    // ── A qué balde va cada fila ──
    const porId = new Map<number, OperarioDeCarga>();
    for (const op of operarios || []) if (op && typeof op.id === "number") porId.set(op.id, op);

    const baldes = new Map<number, Balde>();
    const sinNadie = nuevoBalde({ ...opTaller }, false);
    const terceros = nuevoBalde({ ...opTaller }, false);
    let totalFilasMin = 0;
    let ultimo: FilaDeCarga | null = null;

    for (const fila of filas || []) {
        totalFilasMin += Math.max(0, Number(fila.duracion_min) || 0);
        if (fila.fecha_fin_estimada && (!ultimo || String(fila.fecha_fin_estimada) > String(ultimo.fecha_fin_estimada))) {
            ultimo = fila;
        }
        const id = fila.id_operario;
        if (id != null) {
            let b = baldes.get(id);
            if (!b) {
                // Si la persona no vino en la lista de Recursos, igual es alguien: se la
                // arma con el nombre de la fila y el horario del taller, para no perder horas.
                const op = porId.get(id) ?? { id, nombre: fila.operario_nombre || `#${id}` };
                if (!porId.has(id)) porId.set(id, op);
                b = nuevoBalde(op, true);
                baldes.set(id, b);
            }
            b.filas.push(fila);
        } else if (fila.tercerizado) {
            terceros.filas.push(fila);
        } else {
            sinNadie.filas.push(fila);
        }
    }

    // El calendario del backend: 495 de lunes a viernes, 300 el sábado, nada el domingo
    // ni los feriados. Es la regla de `capacidadDelDia` de plan-fechas (que no se exporta).
    const capCalendario = (dia: string): number => {
        if (feriadosSet.has(dia)) return 0;
        const d = diaDeLaSemana(dia);
        if (d === 0) return 0;
        return d === SABADO ? MIN_LABORAL_SABADO : MIN_LABORAL_DIA;
    };

    for (const b of baldes.values()) repartir(b, capDia, capCalendario);
    repartir(sinNadie, capDia, capCalendario);
    repartir(terceros, capDia, capCalendario);

    // ── Personas, ocultas y vacantes ──
    const personas: PersonaDeCarga[] = [];
    const ocultas: PersonaDeCarga[] = [];
    const vacantes: PersonaDeCarga[] = [];
    for (const op of porId.values()) {
        const b = baldes.get(op.id);
        const persona: PersonaDeCarga = {
            op,
            nombre: nombrePersona(op.nombre, op.apellido) || `#${op.id}`,
            noDisponible: op.disponible === false,
            porDia: b?.porDia ?? {},
            tramos: b?.tramos ?? [],
            sinFechaMin: b?.sinFechaMin ?? 0,
            previaMin: Math.max(0, Number(cargaPrevia[op.id]) || 0),
        };
        if (esVacante([op.nombre, op.apellido].filter(Boolean).join(" "))) vacantes.push(persona);
        else if (esPruebas(op)) ocultas.push(persona);
        else personas.push(persona);
    }

    const carga: CargaDelPlan = {
        span,
        periodoSinFechas,
        semanas,
        diasDelPlan,
        personas,
        ocultas,
        vacantes: vacantes.filter(v => v.tramos.length > 0),
        sinNadie: sinNadie.tramos,
        terceros: terceros.tramos,
        excedentesMin: Math.max(0, excedentesMin || 0),
        ultimo,
        feriadosEnElPlan: span
            ? [...feriadosSet].filter(f => f >= span.desde.slice(0, 10) && f <= span.hasta.slice(0, 10)).sort()
            : [],
        feriados: feriadosSet,
        diasDelTaller: taller,
        totalFilasMin,
        equipoPorSemana: {},
        capDia,
    };

    for (const s of semanas) {
        const r = resumenDelPeriodo(carga, s.clave);
        carga.equipoPorSemana[s.clave] = { min: r.equipo.ocupadoMin, cap: r.equipo.capMin };
    }
    return carga;
}

// ─── Por período ──────────────────────────────────────────────────────────────

export interface CeldaDia {
    dia: string;
    min: number;
    cap: number;
    feriado: boolean;
    aprox: boolean;
}

export interface CeldaSemana {
    semana: Semana;
    min: number;
    cap: number;
}

export interface ResumenPersona {
    persona: PersonaDeCarga;
    op: OperarioDeCarga;
    nombre: string;
    /** De este plan, en el período. */
    cargaMin: number;
    /** De un plan guardado: solo en «todo el plan» (no se sabe por día). */
    previaMin: number;
    totalMin: number;
    cap: CapacidadEnElPeriodo;
    sabados: number;
    diasLV: number;
    /** «= 5 días × 8,25 h de jornada». */
    formula: string;
    estado: Estado;
    libreMin: number;
    excesoMin: number;
    pct: number;
    /** En semana: un día por celda. En «todo»: vacío (va `celdasSemana`). */
    celdas: CeldaDia[];
    celdasSemana: CeldaSemana[];
    /** Los tramos del período, ordenados por día. */
    tramos: Tramo[];
    ots: number;
    procesos: number;
    porRango: Array<{ id: number | null; min: number }>;
}

export interface ResumenDelPeriodo {
    periodo: string;
    esTodo: boolean;
    semana: Semana | null;
    desde: string | null;
    hasta: string | null;
    dias: string[];
    /** Los días de la tira: los que trabaja el taller, feriados incluidos (se ven rayados). */
    diasDeLaTira: string[];
    personas: ResumenPersona[];
    conTrabajo: ResumenPersona[];
    sinTrabajo: ResumenPersona[];
    noDisponibles: ResumenPersona[];
    conteo: Record<Estado, number>;
    equipo: {
        capMin: number;
        ocupadoMin: number;
        pct: number;
        celdas: CeldaDia[];
        celdasSemana: CeldaSemana[];
        conTrabajo: string[];
    };
    desglose: {
        conAlguienMin: number;
        vacantesMin: number;
        sinNadieMin: number;
        tercerosMin: number;
        excedentesMin: number;
        totalMin: number;
    };
    sinNadie: Tramo[];
    terceros: Tramo[];
    vacantes: Array<{ persona: PersonaDeCarga; tramos: Tramo[]; min: number }>;
    /** Horario distinto del taller en alguien con trabajo: la ayuda lo avisa. */
    hayOtroHorario: boolean;
}

const HORA_TALLER_INI = "07:00";
const HORA_TALLER_FIN = "16:00";

const hhmm = (v?: string | null) => (v ? String(v).slice(0, 5) : null);

/** «(entra 08:00)» si su horario no es el del taller; vacío si es el mismo o no hay. */
export function aclaracionDeHorario(op: HorarioDeOperario): string {
    const ini = hhmm(op.hora_inicio);
    const fin = hhmm(op.hora_fin);
    if (ini && ini !== HORA_TALLER_INI) return ` (entra ${ini})`;
    if (fin && fin !== HORA_TALLER_FIN) return ` (sale ${fin})`;
    return "";
}

function formulaDe(op: HorarioDeOperario, cap: CapacidadEnElPeriodo, sabados: number, sinFechas: boolean): string {
    if (cap.dias === 0) return "= 0 días: no trabaja en estas fechas";
    const diasLV = cap.dias - sabados;
    const jornada = numeroEs(cap.jornada / 60, 2);
    const partes: string[] = [];
    if (diasLV > 0) partes.push(`${diasLV} ${diasLV === 1 ? "día" : "días"} × ${jornada} h`);
    if (sabados > 0) {
        partes.push(`${sabados} ${sabados === 1 ? "sábado" : "sábados"} × ${numeroEs(Math.min(cap.jornada, 300) / 60, 2)} h`);
    }
    const sufijo = sabados > 0 ? "" : " de jornada";
    return `= ${partes.join(" + ")}${sufijo}${aclaracionDeHorario(op)}${sinFechas ? " (una semana: el plan no tiene fechas)" : ""}`;
}

const enRango = (dia: string, desde: string | null, hasta: string | null) =>
    !!dia && (!desde || dia >= desde) && (!hasta || dia <= hasta);

/**
 * Todo lo que el panel muestra para un período: una semana (su clave) o "todo".
 */
export function resumenDelPeriodo(
    carga: CargaDelPlan,
    periodo: string,
    feriadosSet: Set<string> = carga.feriados,
): ResumenDelPeriodo {
    const semana = periodo === "todo" ? null : carga.semanas.find(s => s.clave === periodo) ?? null;
    const esTodo = !semana;
    const periodoBase = carga.span ?? carga.periodoSinFechas;
    const desde = semana ? semana.desde : periodoBase ? periodoBase.desde.slice(0, 10) : null;
    const hasta = semana ? semana.hasta : periodoBase ? periodoBase.hasta.slice(0, 10) : null;
    const dias = semana ? semana.dias : carga.diasDelPlan;
    // Los días del taller, y además cualquier otro día de la semana en que el plan le
    // puso trabajo a alguien (un sábado que nadie trabaja): tiene que verse, no perderse.
    const diasDeLaTira = semana
        ? diasEntre(semana.desde, semana.hasta).filter(d =>
            carga.diasDelTaller.has(diaDeLaSemana(d))
            || carga.personas.some(p => (p.porDia[d] || 0) > 0))
        : [];

    /** Los tramos de un balde que caen en el período. En «todo» entran todos, con los sin fecha. */
    const delPeriodo = (tramos: Tramo[]) =>
        esTodo ? tramos : tramos.filter(t => enRango(t.dia, desde, hasta));
    const sumar = (tramos: Tramo[]) => tramos.reduce((a, t) => a + t.min, 0);

    const capacidad = (op: OperarioDeCarga): CapacidadEnElPeriodo => {
        if (semana) return capacidadEnElPeriodo(op, semana.desde, semana.hasta, feriadosSet);
        if (periodoBase) return capacidadEnElPeriodo(op, periodoBase.desde, periodoBase.hasta, feriadosSet);
        // Sin fechas: una semana de cinco días con su jornada, como hasta hoy.
        const jornada = jornadaDelOperario(op);
        return { dias: 5, jornada, minutos: 5 * jornada };
    };

    const resumirPersona = (p: PersonaDeCarga): ResumenPersona => {
        const op = p.op;
        // Por día y, dentro del día, por la hora en que arranca: así se lee como la jornada.
        const tramos = delPeriodo(p.tramos).slice().sort((a, b) =>
            (a.dia || "9999").localeCompare(b.dia || "9999")
            || String(a.fila.fecha_inicio_estimada || "").localeCompare(String(b.fila.fecha_inicio_estimada || "")));
        const cargaMin = sumar(tramos);
        const previaMin = esTodo ? p.previaMin : 0;
        const totalMin = cargaMin + previaMin;
        const cap = capacidad(op);
        const sabados = desde && hasta && (semana || carga.span || carga.periodoSinFechas)
            ? diasEntre(desde, hasta).filter(d => diaDeLaSemana(d) === SABADO && carga.capDia(op, d) > 0).length
            : 0;
        let estado: Estado;
        if (totalMin === 0) estado = "sinTrabajo";
        else if (cap.minutos === 0) estado = "pasado";
        else if (totalMin > cap.minutos) estado = "pasado";
        else if (totalMin / cap.minutos >= 0.95) estado = "lleno";
        else estado = "conLugar";

        const celdas: CeldaDia[] = diasDeLaTira.map(dia => ({
            dia,
            min: p.porDia[dia] || 0,
            cap: carga.capDia(op, dia),
            feriado: feriadosSet.has(dia),
            aprox: p.tramos.some(t => t.dia === dia && t.aprox),
        }));
        const celdasSemana: CeldaSemana[] = esTodo
            ? carga.semanas.map(s => ({
                semana: s,
                min: diasEntre(s.desde, s.hasta).reduce((a, d) => a + (p.porDia[d] || 0), 0),
                cap: capacidadEnElPeriodo(op, s.desde, s.hasta, feriadosSet).minutos,
            }))
            : [];

        const rangos = new Map<number | null, number>();
        for (const t of tramos) {
            const id = t.fila.id_rango_operario ?? null;
            rangos.set(id, (rangos.get(id) || 0) + t.min);
        }
        const filasUnicas = new Set(tramos.map(t => t.fila));

        return {
            persona: p,
            op,
            nombre: p.nombre,
            cargaMin,
            previaMin,
            totalMin,
            cap,
            sabados,
            diasLV: cap.dias - sabados,
            formula: formulaDe(op, cap, sabados, !periodoBase && !semana),
            estado,
            libreMin: Math.max(0, cap.minutos - totalMin),
            excesoMin: Math.max(0, totalMin - cap.minutos),
            pct: cap.minutos > 0 ? Math.round((totalMin / cap.minutos) * 100) : (totalMin > 0 ? 100 : 0),
            celdas,
            celdasSemana,
            tramos,
            ots: new Set(tramos.map(t => t.fila.orden_id)).size,
            procesos: filasUnicas.size,
            porRango: [...rangos.entries()]
                .map(([id, min]) => ({ id, min }))
                .sort((a, b) => b.min - a.min),
        };
    };

    const personas = carga.personas.map(resumirPersona);
    const conTrabajo = personas.filter(r => r.totalMin > 0);
    const sinTrabajo = personas.filter(r => r.totalMin === 0 && !r.persona.noDisponible);
    const noDisponibles = personas.filter(r => r.totalMin === 0 && r.persona.noDisponible);
    const conteo: Record<Estado, number> = { pasado: 0, lleno: 0, conLugar: 0, sinTrabajo: 0 };
    for (const r of personas) conteo[r.estado]++;

    // Equipo: las personas visibles que Recursos da por disponibles.
    const delEquipo = personas.filter(r => !r.persona.noDisponible);
    const capMin = delEquipo.reduce((a, r) => a + r.cap.minutos, 0);
    const ocupadoMin = delEquipo.reduce((a, r) => a + r.cargaMin, 0);
    const equipoCeldas: CeldaDia[] = diasDeLaTira.map(dia => ({
        dia,
        min: delEquipo.reduce((a, r) => a + (r.persona.porDia[dia] || 0), 0),
        cap: delEquipo.reduce((a, r) => a + carga.capDia(r.op, dia), 0),
        feriado: feriadosSet.has(dia),
        aprox: false,
    }));
    const equipoSemanas: CeldaSemana[] = esTodo
        ? carga.semanas.map((s, i) => ({
            semana: s,
            min: delEquipo.reduce((a, r) => a + (r.celdasSemana[i]?.min || 0), 0),
            cap: delEquipo.reduce((a, r) => a + (r.celdasSemana[i]?.cap || 0), 0),
        }))
        : [];

    // Desglose de la carga del período.
    const conAlguienMin = [...carga.personas, ...carga.ocultas].reduce((a, p) => a + sumar(delPeriodo(p.tramos)), 0);
    const vacantes = carga.vacantes
        .map(p => {
            const tramos = delPeriodo(p.tramos);
            return { persona: p, tramos, min: sumar(tramos) };
        })
        .filter(v => v.min > 0);
    const vacantesMin = vacantes.reduce((a, v) => a + v.min, 0);
    const sinNadie = delPeriodo(carga.sinNadie);
    const terceros = delPeriodo(carga.terceros);
    const sinNadieMin = sumar(sinNadie);
    const tercerosMin = sumar(terceros);
    const excedentesMin = esTodo ? carga.excedentesMin : 0;

    return {
        periodo: semana ? semana.clave : "todo",
        esTodo,
        semana,
        desde,
        hasta,
        dias,
        diasDeLaTira,
        personas,
        conTrabajo,
        sinTrabajo,
        noDisponibles,
        conteo,
        equipo: {
            capMin,
            ocupadoMin,
            pct: capMin > 0 ? Math.round((ocupadoMin / capMin) * 100) : 0,
            celdas: equipoCeldas,
            celdasSemana: equipoSemanas,
            conTrabajo: delEquipo.filter(r => r.cargaMin > 0).map(r => r.nombre),
        },
        desglose: {
            conAlguienMin,
            vacantesMin,
            sinNadieMin,
            tercerosMin,
            excedentesMin,
            totalMin: conAlguienMin + vacantesMin + sinNadieMin + tercerosMin + excedentesMin,
        },
        sinNadie,
        terceros,
        vacantes,
        hayOtroHorario: conTrabajo.some(r => r.cap.jornada !== 495),
    };
}

/** Agrupa los tramos sin nadie por los rangos que pide el proceso, de más horas a menos. */
export function sinNadiePorRango(tramos: Tramo[]): Array<{ rangos: number[]; filas: FilaDeCarga[]; min: number }> {
    const grupos = new Map<string, { rangos: number[]; filas: Set<FilaDeCarga>; min: number }>();
    for (const t of tramos) {
        const rangos = [...(t.fila.rangos_permitidos_proceso || [])].sort((a, b) => a - b);
        const k = rangos.join(",");
        if (!grupos.has(k)) grupos.set(k, { rangos, filas: new Set(), min: 0 });
        const g = grupos.get(k)!;
        g.filas.add(t.fila);
        g.min += t.min;
    }
    return [...grupos.values()]
        .map(g => ({ rangos: g.rangos, filas: [...g.filas], min: g.min }))
        .sort((a, b) => b.min - a.min);
}

export interface PorQueHasta {
    ultimo: FilaDeCarga | null;
    fin: Date | null;
    /** Quienes tienen trabajo en la última semana del plan. */
    ultimaSemana: Semana | null;
    trabajanLaUltimaSemana: string[];
    feriados: string[];
    diasDelTaller: string;
}

/** Por qué el plan llega hasta su último día: qué es lo último y quiénes quedan. */
export function porQueHasta(carga: CargaDelPlan): PorQueHasta {
    const ultimaSemana = carga.semanas[carga.semanas.length - 1] ?? null;
    const trabajan = ultimaSemana
        ? resumenDelPeriodo(carga, ultimaSemana.clave).conTrabajo.map(r => r.nombre)
        : [];
    return {
        ultimo: carga.ultimo,
        fin: fechaDeLaApi(carga.ultimo?.fecha_fin_estimada),
        ultimaSemana,
        trabajanLaUltimaSemana: trabajan,
        feriados: carga.feriadosEnElPlan,
        diasDelTaller: describirDias(carga.diasDelTaller),
    };
}

/**
 * Si la semana la corta el arranque o el final del plan: el día en que arranca o
 * termina, cuando hay días del taller de esa semana que quedan afuera.
 */
export function recortesDeLaSemana(carga: CargaDelPlan, semana: Semana): { arranca: string | null; termina: string | null } {
    const esPrimera = carga.semanas[0]?.clave === semana.clave;
    const esUltima = carga.semanas[carga.semanas.length - 1]?.clave === semana.clave;
    const delTaller = (d: string) => carga.diasDelTaller.has(diaDeLaSemana(d)) && !carga.feriados.has(d);
    const antes = semana.desde > semana.clave ? diasEntre(semana.clave, masDias(semana.desde, -1)) : [];
    const domingo = masDias(semana.clave, 6);
    const despues = semana.hasta < domingo ? diasEntre(masDias(semana.hasta, 1), domingo) : [];
    return {
        arranca: esPrimera && antes.some(delTaller) ? semana.dias[0] : null,
        termina: esUltima && despues.some(delTaller) ? semana.dias[semana.dias.length - 1] : null,
    };
}

/** "de lunes a viernes" para una persona. */
export function diasDeLaPersona(op: HorarioDeOperario): string {
    return describirDias(diasDeTrabajo(op.dias_trabajo));
}

/** "Juan Pérez", "Juan Pérez y Ana Gómez", "A, B y C". */
export function listaDeNombres(nombres: string[]): string {
    if (nombres.length <= 1) return nombres[0] || "";
    return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}
