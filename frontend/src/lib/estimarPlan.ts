/**
 * Cuántos días va a tardar lo que está tildado en «Planificar órdenes · Paso 1».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL BUG (Julián, 23/09/2026): «se quedaba trabada en 4,9 cuando en realidad son más».
 *
 * El cartel decía «≈ 4.9 días con 12 operarios» y no se movía al sumar OT. Era el
 * mayor de dos números: la OT más larga (2360 min en fila / 485 = 4,9) y la carga
 * repartida entre TODOS los operarios, como si cualquiera pudiera hacer cualquier
 * paso. Con 39 OT la segunda daba menos que la primera, así que mandaba siempre la OT
 * más larga y el número quedaba clavado. El plan real de esas 39 OT fue del 24/9 al
 * 6/10: 9 días hábiles. Lo que faltaba era mirar QUIÉN puede hacer cada paso: una
 * persona o una máquina que es la única que sabe hacer algo marca el ritmo de todo.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Esa cuenta la hace el backend (`POST /planificacion/estimar`) con la misma
 * elegibilidad que usa el planificador. Acá sólo se la pide y se la cuenta en
 * castellano.
 *
 * Si el backend no la tiene (la producción se actualiza a mano y puede estar atrás) o
 * falla, la pantalla no se rompe ni inventa: muestra lo único que se sabe sin él —el
 * piso que pone la OT más larga— y dice que es un piso. Nunca vuelve al «≈ N días con
 * 12 operarios», que era justamente el que engañaba.
 */

import { API_URL } from "@/config";
import { MIN_LABORAL_DIA } from "./plan-fechas";
import { nombreLindo } from "./nombres";
import { numeroEs } from "./diasHabiles";

/** El recurso que no da abasto, en el orden en que frena el plan. */
export interface CuelloDelPlan {
    tipo: "persona" | "maquina";
    nombre: string;
    /** Jornadas de trabajo que tiene encima con lo tildado. */
    jornadas: number;
    /** De esas, las que SÓLO ese recurso puede hacer. */
    exclusivas: number;
}

/** Lo que devuelve `POST /planificacion/estimar`. */
export interface EstimacionDelPlan {
    carga_min: number;
    /** El piso: ni con el reparto perfecto baja de esto. */
    jornadas_minimas: number;
    /** Un reparto rápido que respeta quién puede hacer cada paso, el orden y las máquinas. */
    jornadas_estimadas: number;
    dias_habiles_minimos: number;
    dias_habiles_estimados: number;
    /** Arranque del plan, sin zona: "2026-09-24T07:00:00". */
    inicio: string;
    fin_estimado: string | null;
    cuellos: CuelloDelPlan[];
    /** Trabajo que nadie del taller puede hacer (tercerizado, sin nadie con el rango). */
    sin_asignar_min: number;
    ots_sin_procesos: number;
    procesos_sin_tiempo: number;
    calculado_en_ms: number;
    /** Sólo si se eligió una fecha «hasta»: qué entra en ese rango. */
    rango: RangoDelPlan | null;
}

/** Qué entra hasta la fecha «hasta» del rango elegido en el Paso 1. */
export interface RangoDelPlan {
    hasta: string;
    /** Días hábiles entre el arranque del plan y `hasta`. `null` si el servidor no lo mandó. */
    dias_habiles: number | null;
    ots_total: number;
    /** OT que quedan TERMINADAS dentro del rango (lo más urgente primero, como el planificador). */
    ots_entran: number;
    /** Trabajo que entra, contando también el de OT que quedan a medias. */
    carga_entra_min: number;
    /** Números de OT que no llegan a terminarse. */
    no_entran: number[];
    /**
     * El día en que arranca de verdad el plan, "YYYY-MM-DD". Lo manda el servidor
     * nuevo; con uno viejo sale del `inicio` de la respuesta, que es lo mismo.
     */
    arranca: string | null;
}

/** Por qué no hubo cuenta del backend. */
export type MotivoSinEstimacion = "sin-ruta" | "error" | "red" | "tiempo";

export type RespuestaEstimacion =
    | { ok: true; datos: EstimacionDelPlan }
    | { ok: false; motivo: MotivoSinEstimacion; status?: number };

const numero = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Lee la respuesta sin confiar en ella: si falta un número que se muestra, es como si
 * no hubiera respuesta. Mejor el piso honesto que un «NaN días hábiles».
 */
export function leerEstimacion(crudo: unknown): EstimacionDelPlan | null {
    if (!crudo || typeof crudo !== "object") return null;
    const r = crudo as Record<string, unknown>;
    const minimos = numero(r.dias_habiles_minimos);
    const estimados = numero(r.dias_habiles_estimados);
    if (minimos === null || estimados === null) return null;
    const cuellos = Array.isArray(r.cuellos)
        ? (r.cuellos as unknown[])
            .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
            .map(c => ({
                tipo: (c.tipo === "maquina" ? "maquina" : "persona") as CuelloDelPlan["tipo"],
                nombre: typeof c.nombre === "string" ? c.nombre : "",
                jornadas: numero(c.jornadas) ?? 0,
                exclusivas: numero(c.exclusivas) ?? 0,
            }))
            .filter(c => c.nombre)
        : [];
    const inicio = typeof r.inicio === "string" ? r.inicio : "";
    return {
        carga_min: numero(r.carga_min) ?? 0,
        jornadas_minimas: numero(r.jornadas_minimas) ?? 0,
        jornadas_estimadas: numero(r.jornadas_estimadas) ?? 0,
        dias_habiles_minimos: Math.round(minimos),
        dias_habiles_estimados: Math.round(estimados),
        inicio,
        fin_estimado: typeof r.fin_estimado === "string" ? r.fin_estimado : null,
        cuellos,
        sin_asignar_min: numero(r.sin_asignar_min) ?? 0,
        ots_sin_procesos: numero(r.ots_sin_procesos) ?? 0,
        procesos_sin_tiempo: numero(r.procesos_sin_tiempo) ?? 0,
        calculado_en_ms: numero(r.calculado_en_ms) ?? 0,
        rango: leerRango(r.rango, inicio),
    };
}

/** "2026-09-28" o "2026-09-28T07:00:00" → "2026-09-28"; cualquier otra cosa → null. */
const soloElDia = (v: unknown): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

function leerRango(crudo: unknown, inicio: string): RangoDelPlan | null {
    if (!crudo || typeof crudo !== "object") return null;
    const r = crudo as Record<string, unknown>;
    const total = numero(r.ots_total);
    const entran = numero(r.ots_entran);
    if (total === null || entran === null || typeof r.hasta !== "string") return null;
    return {
        hasta: r.hasta,
        dias_habiles: numero(r.dias_habiles),
        ots_total: total,
        ots_entran: entran,
        carga_entra_min: numero(r.carga_entra_min) ?? 0,
        no_entran: Array.isArray(r.no_entran) ? (r.no_entran as unknown[]).filter((n): n is number => typeof n === "number") : [],
        // `arranca` es opcional: los servidores de antes del 23/9 no lo mandan, y el
        // `inicio` de la respuesta es el mismo arranque con la hora pegada.
        arranca: soloElDia(r.arranca) ?? soloElDia(inicio),
    };
}

/**
 * ¿El rango elegido termina antes de que arranque el plan?
 *
 * Pasa más de lo que parece: un viernes a las 10 elegís «sólo el viernes», pero la
 * jornada de hoy ya empezó y el plan arranca el lunes. El rango no tiene ni un día
 * hábil y el cartel decía «Entran 0 de 39 OT hasta el 25/9» con un detalle de «en los
 * 0 días hábiles del rango»: parecía que el taller no daba abasto, cuando lo que
 * pasaba es que el rango no existe.
 */
export function rangoSinDias(r: RangoDelPlan): boolean {
    return (r.dias_habiles !== null && r.dias_habiles <= 0) || terminaAntesDeArrancar(r);
}

/** El «hasta» cae antes del día en que arranca el plan. */
function terminaAntesDeArrancar(r: RangoDelPlan): boolean {
    const hasta = soloElDia(r.hasta);
    return !!(hasta && r.arranca && hasta < r.arranca);
}

const cabeceras = (): Record<string, string> => {
    const salida: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof window === "undefined") return salida;
    try {
        const token = localStorage.getItem("access_token");
        if (token) salida.Authorization = `Bearer ${token}`;
    } catch { /* sin token: el backend dirá 401 y se cae al piso */ }
    return salida;
};

/**
 * El servidor ya dijo una vez que no tiene esta cuenta: no se le vuelve a preguntar.
 *
 * Vive a nivel de módulo, o sea lo que dura la pestaña abierta. Sin esto, con el
 * servidor viejo cada tilde del Paso 1 mandaba un POST que daba 405 —cuarenta tildes,
 * cuarenta errores en la consola del servidor— para enterarse cada vez de lo mismo.
 * Si en el medio se actualiza el servidor, alcanza con recargar la página.
 */
let sinRutaEnElServidor: { status?: number } | null = null;

/** `true` si ya se sabe que el servidor no tiene la cuenta: no tiene sentido esperarla. */
export function servidorSinEstimacion(): boolean {
    return sinRutaEnElServidor !== null;
}

/**
 * Pide la cuenta. Nunca tira: cualquier cosa que no sea una respuesta buena vuelve
 * como `{ ok: false }` con el motivo. Si el pedido se cancela (porque cambió la
 * selección), vuelve como "red": el que llamó sabe que lo canceló y lo ignora.
 */
export async function pedirEstimacion(
    ordenesIds: number[],
    fechaDesde: string | null,
    signal: AbortSignal,
    fechaHasta: string | null = null,
): Promise<RespuestaEstimacion> {
    if (sinRutaEnElServidor) return { ok: false, motivo: "sin-ruta", status: sinRutaEnElServidor.status };
    try {
        const res = await fetch(`${API_URL}/planificacion/estimar`, {
            method: "POST",
            headers: cabeceras(),
            signal,
            body: JSON.stringify({ ordenes_ids: ordenesIds, fecha_desde: fechaDesde, fecha_hasta: fechaHasta }),
        });
        // 404/405/422: el backend que está andando todavía no tiene esta cuenta (en el
        // viejo, POST /planificacion/estimar cae en PUT /planificacion/{id} y da 405;
        // un 422 es un backend que no entiende este pedido, que para acá es lo mismo).
        if (res.status === 404 || res.status === 405 || res.status === 422) {
            sinRutaEnElServidor = { status: res.status };
            return { ok: false, motivo: "sin-ruta", status: res.status };
        }
        if (!res.ok) return { ok: false, motivo: "error", status: res.status };
        const datos = leerEstimacion(await res.json().catch(() => null));
        return datos ? { ok: true, datos } : { ok: false, motivo: "error", status: res.status };
    } catch {
        return { ok: false, motivo: "red" };
    }
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/**
 * "2026-10-06T10:00:00" → "mar 6/10". Sin zona: se lee hora local, como toda la base.
 *
 * Un día pelado ("2026-09-28") se arma a mano: `new Date("2026-09-28")` lo lee como
 * medianoche UTC, que en Argentina es el 27 a las 21, y el cartel diría «dom 27/9».
 */
export function diaCorto(iso?: string | null): string {
    if (!iso) return "";
    const pelado = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const f = pelado ? new Date(Number(pelado[1]), Number(pelado[2]) - 1, Number(pelado[3])) : new Date(iso);
    if (Number.isNaN(f.getTime())) return "";
    return `${DIAS[f.getDay()]} ${f.getDate()}/${f.getMonth() + 1}`;
}

const dias = (n: number) => `${n} ${n === 1 ? "día hábil" : "días hábiles"}`;
const jornadas = (n: number) => `${numeroEs(n)} ${numeroEs(n) === "1" ? "jornada" : "jornadas"}`;

/** El número del cartel: «≈ 9 días hábiles» o «entre 7 y 9 días hábiles». */
export function textoDeDias(e: EstimacionDelPlan): string {
    const bajo = Math.min(e.dias_habiles_minimos, e.dias_habiles_estimados);
    const alto = Math.max(e.dias_habiles_minimos, e.dias_habiles_estimados);
    if (alto <= 0) return "sin días estimados";
    if (bajo <= 0 || bajo === alto) return `≈ ${dias(alto)}`;
    return `entre ${bajo} y ${dias(alto)}`;
}

/** Quién marca el ritmo, en una frase. */
function fraseDelCuello(c: CuelloDelPlan): string {
    const nombre = nombreLindo(c.nombre);
    const quien = c.tipo === "maquina" ? `la máquina ${nombre}` : nombre;
    if (c.exclusivas >= 0.05) {
        const solo = c.tipo === "maquina"
            ? "que no se pueden hacer en otra"
            : "que nadie más del taller puede hacer";
        const total = c.jornadas - c.exclusivas >= 0.05 ? ` (${jornadas(c.jornadas)} en total)` : "";
        return `El ritmo lo marca ${quien}: ${jornadas(c.exclusivas)} de trabajo ${solo}${total}.`;
    }
    return `El ritmo lo marca ${quien}, con ${jornadas(c.jornadas)} de trabajo encima.`;
}

/** El detalle del cartel (va en el `title`): de dónde sale el número y qué lo frena. */
export function detalleDeDias(e: EstimacionDelPlan): string {
    const partes: string[] = [];
    const bajo = Math.min(e.dias_habiles_minimos, e.dias_habiles_estimados);
    const alto = Math.max(e.dias_habiles_minimos, e.dias_habiles_estimados);

    if (alto > 0) {
        const desde = diaCorto(e.inicio);
        const hasta = diaCorto(e.fin_estimado);
        if (desde && hasta) partes.push(`Arrancaría el ${desde} y terminaría cerca del ${hasta}.`);
        partes.push(bajo > 0 && bajo !== alto
            ? `Ni con el reparto perfecto baja de ${dias(bajo)} (${jornadas(e.jornadas_minimas)}); repartiendo como se puede —quién sabe hacer cada paso, los pasos de cada OT en orden y una máquina a la vez— da ${dias(alto)}.`
            : `Contando quién sabe hacer cada paso, los pasos de cada OT en orden y una máquina a la vez: ${jornadas(e.jornadas_estimadas)} de trabajo.`);
    } else {
        partes.push("No hay trabajo que el taller pueda hacer en lo tildado, así que no hay días que contar.");
    }

    const [primero, ...resto] = e.cuellos;
    if (primero) partes.push(fraseDelCuello(primero));
    if (resto.length > 0) {
        partes.push(`Después vienen ${resto
            .map(c => `${c.tipo === "maquina" ? "la máquina " : ""}${nombreLindo(c.nombre)} (${jornadas(c.jornadas)})`)
            .join(" y ")}.`);
    }

    if (e.sin_asignar_min > 0) {
        partes.push(`${numeroEs(e.sin_asignar_min / 60)} hs no las puede hacer nadie del taller (tercerizado o sin nadie con el rango): no entran en los días.`);
    }
    if (e.ots_sin_procesos > 0) {
        partes.push(e.ots_sin_procesos === 1
            ? "1 OT tildada no tiene procesos cargados."
            : `${e.ots_sin_procesos} OT tildadas no tienen procesos cargados.`);
    }
    if (e.procesos_sin_tiempo > 0) {
        partes.push(e.procesos_sin_tiempo === 1
            ? "1 paso no tiene minutos cargados: no suma, así que puede tardar más."
            : `${e.procesos_sin_tiempo} pasos no tienen minutos cargados: no suman, así que puede tardar más.`);
    }

    partes.push("Días hábiles: los que trabaja alguien del taller, sin feriados. Es una cuenta rápida; el reparto fino lo hace el planificador.");
    return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Sin el backend: el piso
// ---------------------------------------------------------------------------

/** El piso que pone la OT más larga, contado en jornadas y en días. */
export function pisoDeLaOTMasLarga(cadenaMin: number): { jornadas: number; dias: number } {
    const j = cadenaMin / MIN_LABORAL_DIA;
    return { jornadas: j, dias: Math.max(1, Math.ceil(j - 1e-9)) };
}

/** «mín. 5 días (la OT más larga)» */
export function textoDelPiso(cadenaMin: number): string {
    const { dias: d } = pisoDeLaOTMasLarga(cadenaMin);
    return `mín. ${d} ${d === 1 ? "día" : "días"} (la OT más larga)`;
}

const MOTIVOS: Record<MotivoSinEstimacion, string> = {
    "sin-ruta": "el servidor todavía no tiene esta cuenta",
    "error": "el servidor respondió con un error",
    "red": "no hubo respuesta del servidor",
    "tiempo": "el servidor tardó demasiado",
};

/**
 * El detalle del piso. Con una fecha «hasta» elegida, además dice que qué entra en
 * el rango se ve recién al planificar: sin la cuenta del servidor el Paso 1 no puede
 * adelantarlo, y callarse dejaba creer que entraba todo.
 */
export function detalleDelPiso(
    cadenaMin: number,
    otMasLarga: string | null,
    motivo: MotivoSinEstimacion,
    hasta: string | null = null,
): string {
    const { jornadas: j, dias: d } = pisoDeLaOTMasLarga(cadenaMin);
    return [
        `No se pudo calcular el reparto por persona (${MOTIVOS[motivo]}), así que acá va sólo el piso.`,
        `La OT más larga${otMasLarga ? ` (${otMasLarga})` : ""} son ${numeroEs(cadenaMin / 60)} hs de procesos que van uno atrás del otro: ${jornadas(j)} de ${numeroEs(MIN_LABORAL_DIA / 60, 2)} hs, o sea no menos de ${d} ${d === 1 ? "día" : "días"} aunque sobre gente.`,
        "Con todo lo tildado seguramente tarda más: depende de quién puede hacer cada paso, y eso esta cuenta no lo mira.",
        hasta
            ? `Qué entra hasta el ${fechaCorta(hasta)} lo vas a ver al planificar: ${motivo === "sin-ruta"
                ? "el servidor todavía no tiene esta cuenta"
                : "sin la cuenta del servidor no se puede adelantar"}.`
            : "",
    ].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Los otros dos números del Paso 1
// ---------------------------------------------------------------------------

/** «= 43 jornadas»: las horas de trabajo pasadas a días de UNA persona. Sube con cada OT. */
export function textoDeJornadas(cargaMin: number): string {
    return `= ${numeroEs(cargaMin / MIN_LABORAL_DIA)} jornadas`;
}

export function detalleDeJornadas(cargaMin: number): string {
    return `Las ${numeroEs(cargaMin / 60)} hs de trabajo de lo tildado, contadas en jornadas de ${numeroEs(MIN_LABORAL_DIA / 60, 2)} hs: lo que tardaría una sola persona haciéndolo todo. Sirve para comparar tandas —sube con cada OT que sumás—. Cuántos días lleva de verdad, con la gente que hay y quién sabe hacer cada paso, lo dice el cartel de los días hábiles.`;
}

const fechaCorta = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return y && m && d ? `${d}/${m}` : iso;
};

/**
 * «Entra todo hasta el 30/9», «Entran 26 de 39 OT hasta el 30/9» o, si el rango
 * termina antes de que arranque el plan, «El rango no tiene días hábiles: el plan
 * arranca el lun 28/9».
 */
export function textoDelRango(r: RangoDelPlan): string {
    if (rangoSinDias(r)) {
        const arranca = terminaAntesDeArrancar(r) ? diaCorto(r.arranca) : "";
        return arranca
            ? `El rango no tiene días hábiles: el plan arranca el ${arranca}`
            : "El rango no tiene días hábiles";
    }
    if (r.ots_total > 0 && r.ots_entran >= r.ots_total) return `Entra todo hasta el ${fechaCorta(r.hasta)}`;
    return `Entran ${r.ots_entran} de ${r.ots_total} OT hasta el ${fechaCorta(r.hasta)}`;
}

/**
 * El detalle del cartel del rango (va en el `title`).
 *
 * Es una ESTIMACIÓN y lo dice. Hasta el 23/9 prometía «esas quedan afuera del plan y en
 * la vista previa podés forzarlas», y no es así: la lista sale de una cuenta rápida,
 * el planificador puede dejar una OT a medias —los primeros pasos adentro del rango y
 * el resto afuera— y forzar UNA OT en la vista previa le saca la fecha «hasta» a TODO
 * el plan (el planificador recalcula sin tope), no sólo a esa.
 */
export function detalleDelRango(r: RangoDelPlan, cargaMin: number): string {
    if (rangoSinDias(r)) {
        const hasta = diaCorto(soloElDia(r.hasta)) || fechaCorta(r.hasta);
        const arranca = diaCorto(r.arranca);
        return [
            terminaAntesDeArrancar(r) || !arranca
                ? `El rango termina el ${hasta}${arranca ? ` y el plan recién arranca el ${arranca}` : " y el plan arranca después"}: el plan nunca empieza en el pasado, y si la jornada de hoy ya empezó arranca el próximo día hábil.`
                // Arranca adentro del rango y aun así no hay días: ninguno de esos días
                // lo trabaja nadie del taller.
                : `Entre el ${arranca} y el ${hasta} no trabaja nadie del taller.`,
            r.ots_total === 1 ? "Así no entra la OT tildada."
                : r.ots_total > 1 ? `Así no entra ninguna de las ${r.ots_total} OT tildadas.` : "",
            arranca && terminaAntesDeArrancar(r)
                ? `Elegí un «hasta» del ${arranca} en adelante, o sacá el rango.`
                : "Elegí un «hasta» más adelante, o sacá el rango.",
        ].filter(Boolean).join(" ");
    }
    const enElRango = r.dias_habiles !== null
        ? `en los ${r.dias_habiles} ${r.dias_habiles === 1 ? "día hábil" : "días hábiles"} del rango`
        : "en el rango";
    const partes = [
        `Según una cuenta rápida, ${enElRango} quedarían terminadas ${r.ots_entran} de ${r.ots_total === 1 ? "1 OT tildada" : `las ${r.ots_total} OT tildadas`}, empezando por las más urgentes (como las ordena el planificador).`,
    ];
    if (cargaMin > 0) {
        partes.push(`Entraría el ${Math.round((100 * r.carga_entra_min) / cargaMin)}% del trabajo (${numeroEs(r.carga_entra_min / 60)} de ${numeroEs(cargaMin / 60)} hs), contando lo que queda a medias.`);
    }
    if (r.no_entran.length > 0) {
        const muestra = r.no_entran.slice(0, 12).map(n => `#${n}`).join(", ");
        partes.push(`No llegarían: ${muestra}${r.no_entran.length > 12 ? ` y ${r.no_entran.length - 12} más` : ""}.`);
        partes.push("Es una estimación: el reparto de verdad lo hace el planificador, que puede dejar una OT a medias —los primeros pasos adentro del rango y el resto afuera—.");
        partes.push("Ojo en la vista previa: forzar aunque sea una OT recalcula TODO el plan sin la fecha «hasta», así que las demás también pueden pasarse del rango.");
    } else {
        partes.push("Es una estimación: el reparto de verdad lo hace el planificador.");
    }
    return partes.join(" ");
}
