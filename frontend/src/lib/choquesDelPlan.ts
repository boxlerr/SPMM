/**
 * Quién está ocupado y hasta cuándo: los choques de horario de un plan.
 *
 * Reunión con Lucas del 28/10/2026. Corrigiendo el plan a mano, Lucas puso a Alejandro
 * a las 08:20 en un torneado sin ver que a esa hora estaba en un fresado de 300 minutos,
 * y a Gustavo en un paso de las 10:55 creyendo que estaba libre cuando su torneado de las
 * 09:55 duraba 120 minutos. Faltaban dos cosas en la pantalla:
 *
 *   · a qué hora TERMINA cada paso (sólo se veía el inicio);
 *   · que avise si la persona o la máquina que se elige ya tiene otra cosa a esa hora.
 *
 * El planificador nunca encima a nadie: cada persona y cada máquina hace una cosa por
 * vez. El choque aparece al cambiar a mano la persona, la máquina o el horario, porque
 * el retoque deja el horario donde estaba y no mira lo demás. Así quedó guardado el plan
 * de las 29 OT: Alejandro a las 07:00 del 2/11 en la Fresadora 2 Y en la Van Norman.
 *
 * EL PASO EN PARTES. Un paso largo el planificador lo puede cortar en tramos, y entre
 * un tramo y otro la persona o la máquina hace otra cosa (el FRESADO CNC de la 13028:
 * 3300 minutos repartidos en 11 días, con otras OT metidas en el medio). La fila del
 * plan sólo trae el primer minuto y el último, no los tramos. Comparar «desde-hasta» a
 * secas avisaba choques que no existen —14 en el plan de las 28 OT recién calculado, que
 * no tiene ninguno—. Por eso se cuentan los minutos LIBRES de cada fila (lo que va del
 * desde al hasta menos lo que dura) y sólo es choque lo que no entra en esos huecos: lo
 * que se marca, choca seguro.
 *
 * Las cuentas van en minutos del plan (los de la jornada del taller, los mismos que
 * guarda el planificador), y sólo se comparan filas del mismo plan. Todo sale de lo que
 * la pantalla ya tiene: no se le pide nada al servidor.
 */

import { baseDelPlan, fechaDesdeMinutos, minutosDesdeFecha } from "./plan-fechas";

/** Un paso del plan ubicado en el calendario, con la persona y la máquina que lo hacen. */
export interface TramoDelPlan {
    /** Con qué se identifica la fila en la pantalla que pregunta. */
    clave: string;
    id_operario?: number | null;
    id_maquinaria?: number | null;
    /** De qué plan es (su arranque): los minutos de dos planes no se comparan. */
    plan: string;
    /** Primer y último minuto del paso en el plan, y cuánto trabajo es. */
    desde: number;
    hasta: number;
    duracion: number;
    /** Lo mismo en el calendario, para mostrarlo. */
    inicio: Date | null;
    fin: Date | null;
    /** Número de OT que se muestra (el del sistema viejo cuando lo hay). */
    ot?: number | string | null;
    /** La OT por dentro, para poder ir a ella. */
    orden_id?: number;
    proceso?: string | null;
}

/** Con qué otro paso se pisa una fila, y por qué recurso. */
export interface Choque {
    recurso: "persona" | "maquina";
    con: TramoDelPlan;
}

/** Minutos del desde al hasta en los que la fila no trabaja: los huecos entre tramos. */
export const libres = (t: Pick<TramoDelPlan, "desde" | "hasta" | "duracion">) =>
    Math.max(0, t.hasta - t.desde - Math.max(0, t.duracion));

/** El paso se hace en partes: entre medio, la persona o la máquina hace otra cosa. */
export const enPartes = (t: Pick<TramoDelPlan, "desde" | "hasta" | "duracion">) => libres(t) > 0;

const cruce = (a: TramoDelPlan, b: TramoDelPlan) =>
    Math.max(0, Math.min(a.hasta, b.hasta) - Math.max(a.desde, b.desde));

/**
 * Para cada fila, los otros pasos con los que se pisa por la persona o por la máquina.
 * Las filas sin choques no aparecen en el mapa.
 */
export function choquesDelPlan(tramos: TramoDelPlan[]): Map<string, Choque[]> {
    const salida = new Map<string, Choque[]>();
    const vistos = new Set<string>();
    const anotar = (recurso: Choque["recurso"], a: TramoDelPlan, b: TramoDelPlan) => {
        for (const [de, con] of [[a, b], [b, a]] as const) {
            const marca = `${recurso}|${de.clave}|${con.clave}`;
            if (vistos.has(marca)) continue;
            vistos.add(marca);
            const lista = salida.get(de.clave);
            if (lista) lista.push({ recurso, con });
            else salida.set(de.clave, [{ recurso, con }]);
        }
    };

    const revisar = (recurso: Choque["recurso"], idDe: (t: TramoDelPlan) => number | null | undefined) => {
        const grupos = new Map<string, TramoDelPlan[]>();
        for (const t of tramos) {
            const id = idDe(t);
            if (id == null || !(t.hasta > t.desde) || !(t.duracion > 0)) continue;
            const clave = `${t.plan}|${id}`;
            const lista = grupos.get(clave);
            if (lista) lista.push(t);
            else grupos.set(clave, [t]);
        }
        for (const lista of grupos.values()) {
            lista.sort((a, b) => a.desde - b.desde);
            for (let i = 0; i < lista.length; i++) {
                const a = lista[i];
                // De a pares: se pisan más minutos de los que caben en los huecos de los dos.
                for (let j = i + 1; j < lista.length && lista[j].desde < a.hasta; j++) {
                    const b = lista[j];
                    if (a.clave !== b.clave && cruce(a, b) > libres(a) + libres(b)) anotar(recurso, a, b);
                }
                // Un paso en partes con varios seguidos adentro: cada uno entra en un hueco,
                // pero todos juntos no (el fresado de 300 de Alejandro, con 150 libres,
                // y adentro un fresado de 60 y un torneado de 120).
                if (!enPartes(a)) continue;
                const adentro = lista.filter(b => b !== a && b.clave !== a.clave && !enPartes(b) && cruce(a, b) > 0);
                const usan = adentro.reduce((s, b) => s + cruce(a, b), 0);
                if (usan > libres(a)) for (const b of adentro) anotar(recurso, a, b);
            }
        }
    };
    revisar("persona", t => t.id_operario);
    revisar("maquina", t => t.id_maquinaria);
    // El primero que se lee es el que arranca antes.
    for (const lista of salida.values()) lista.sort((a, b) => a.con.desde - b.con.desde);
    return salida;
}

/**
 * Qué tiene ya una persona (o una máquina) en el horario de una fila, si se la
 * eligiera ahí: para avisar en la lista ANTES de elegir. Se arma el plan como quedaría
 * y se le preguntan los choques a esa fila.
 */
export function ocupadoEn(
    tramos: TramoDelPlan[],
    recurso: Choque["recurso"],
    id: number,
    fila: TramoDelPlan,
): TramoDelPlan[] {
    const campo = recurso === "persona" ? "id_operario" : "id_maquinaria";
    const delRecurso = tramos.filter(t => t.clave !== fila.clave && t[campo] === id && t.plan === fila.plan);
    if (delRecurso.length === 0) return [];
    const propia: TramoDelPlan = { ...fila, id_operario: null, id_maquinaria: null, [campo]: id };
    return (choquesDelPlan([...delRecurso, propia]).get(fila.clave) ?? [])
        .filter(c => c.recurso === recurso)
        .map(c => c.con);
}

/** Lo mínimo de una fila del plan para ubicarla. */
type FilaUbicable = Parameters<typeof baseDelPlan>[0];

/** El arranque del plan como clave, para no comparar minutos de planes distintos. */
export function claveDelPlan(fila: FilaUbicable, feriados: Iterable<string> = []): string {
    return String(baseDelPlan(fila, feriados).getTime());
}

/**
 * El minuto del plan de un inicio escrito a mano, y el fin que le corresponde: la misma
 * cantidad de minutos de trabajo, contados en la jornada del taller (desayuno, almuerzo,
 * fin de semana), igual que lo guarda confirmar (`fin_min = inicio + duracion_min`).
 */
export function horarioEscritoEnMinutos(
    fila: FilaUbicable & { duracion_min?: number | null },
    inicio: Date,
    feriados: Iterable<string> = [],
): { desde: number; hasta: number; fin: Date } {
    const base = baseDelPlan(fila, feriados);
    const desde = minutosDesdeFecha(base, inicio, feriados);
    const hasta = desde + Math.max(0, Number(fila.duracion_min) || 0);
    return { desde, hasta, fin: fechaDesdeMinutos(base, hasta, feriados, true) };
}

const dosDigitos = (n: number) => String(n).padStart(2, "0");
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "09:55". */
export const hora = (f: Date) => `${dosDigitos(f.getHours())}:${dosDigitos(f.getMinutes())}`;

/** "Lun 02/11". */
export const diaCorto = (f: Date) => `${DIAS[f.getDay()]} ${dosDigitos(f.getDate())}/${dosDigitos(f.getMonth() + 1)}`;

const mismoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** El fin al lado del inicio: "11:55" si es el mismo día, "Mar 03/11 08:10" si no. */
export function finAlLado(inicio: Date | null, fin: Date | null): string | null {
    if (!fin) return null;
    return inicio && mismoDia(inicio, fin) ? hora(fin) : `${diaCorto(fin)} ${hora(fin)}`;
}

/** "07:20–12:20", o con el día cuando no es el mismo. */
export function rango(inicio: Date | null, fin: Date | null): string {
    if (!inicio || !fin) return "";
    return mismoDia(inicio, fin)
        ? `${diaCorto(inicio)} ${hora(inicio)}–${hora(fin)}`
        : `${diaCorto(inicio)} ${hora(inicio)} – ${diaCorto(fin)} ${hora(fin)}`;
}

/** "OT 15982 · Fresado convencional, Lun 02/11 07:20–12:20": lo que tiene a esa hora. */
export function textoDelTramo(t: Pick<TramoDelPlan, "ot" | "proceso" | "inicio" | "fin">): string {
    const proceso = t.proceso ? t.proceso.charAt(0).toUpperCase() + t.proceso.slice(1).toLowerCase() : "otro paso";
    const cuando = rango(t.inicio, t.fin);
    return `${t.ot != null ? `OT ${t.ot} · ` : ""}${proceso}${cuando ? `, ${cuando}` : ""}`;
}
