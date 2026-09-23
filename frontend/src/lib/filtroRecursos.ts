/**
 * RF-29. Filtrar lo PLANIFICADO por recurso humano y por máquina.
 *
 * Julián, sobre el SRS: «metele estos filtros en los planes planificados, antes no nos
 * sirve porque no sabemos qué operario o máquina hay». Antes de planificar un paso no
 * tiene a nadie; después sí, y la pregunta del taller es «¿qué tiene Juan?» o «¿qué
 * pasa por el torno CNC?». La lista de Planificadas no lo contestaba: había que
 * desplegar OT por OT y leer la columna.
 *
 * Todo sale de lo que la pantalla YA tiene (el plan y las OT): no hace falta pedirle
 * nada nuevo al servidor, así que anda igual con el backend que está en producción.
 *
 * QUÉ CUENTA COMO «TIENE A JUAN» (o «usa el torno»). Un paso cuenta si la persona o la
 * máquina aparece en cualquiera de estos dos lados:
 *   · el PLAN: la fila del plan de esa pasada, y también las filas de los acompañantes
 *     (un paso que pide dos personas se guarda en dos filas: la principal con la
 *     máquina y otra sin máquina para el segundo). Sin mirar las dos, el que ayuda no
 *     encontraba nunca el paso en el que ayuda.
 *   · lo ELEGIDO A MANO en la OT (la persona o la máquina forzada en el paso, que el
 *     planificador respeta). Casi siempre coincide con el plan; cuando no —se cambió la
 *     OT después de planificar—, cuenta igual y la pantalla dice que viene de ahí.
 * Lo que está a medio cambiar en la pantalla (el desplegable en ámbar que todavía no
 * se aceptó) NO cuenta: el filtro mira lo guardado. Si contara, al cambiar el
 * recurso humano de un paso con el filtro puesto, la fila se esfumaba debajo del
 * mouse antes de apretar «Aceptar cambios».
 *
 * CÓMO SE COMBINAN. Dentro de un mismo filtro, cualquiera (Juan O Pedro). Entre los
 * dos, los dos a la vez (Juan Y el torno): es lo que hace cualquier lista con filtros,
 * y así sumar un filtro nunca muestra MÁS que antes. Con la búsqueda, la solapa y la
 * fecha también se suman: en Semanal y en Diaria sólo cuentan los pasos de esa semana
 * o de ese día (un paso de Juan de la semana que viene no trae la OT a «esta semana»).
 */

import type { PlanificacionItem, WorkOrder } from "@/lib/types";
import { nombreLindo, nombrePersona } from "@/lib/nombres";

export interface FiltroRecursos {
    /** ids de operario (recurso humano). Vacío = no filtra por persona. */
    operarios: number[];
    /** ids de maquinaria. Vacío = no filtra por máquina. */
    maquinas: number[];
}

export const FILTRO_RECURSOS_VACIO: FiltroRecursos = { operarios: [], maquinas: [] };

export function hayFiltroRecursos(f?: FiltroRecursos | null): boolean {
    return !!f && (f.operarios.length > 0 || f.maquinas.length > 0);
}

export type PasoDeOrden = WorkOrder["procesos"][number];

/**
 * Lo elegido a mano en el paso. El backend lo manda en cada pasada de la OT (desde
 * antes de la versión que está en producción), pero el tipo del front no lo declara:
 * se lee con cuidado y, si no viene, es como si no hubiera nada elegido.
 */
interface Preseleccion {
    id_operario?: number | null;
    id_maquinaria?: number | null;
}

/** Las filas del plan, indexadas una vez para no recorrer el plan entero por cada paso. */
export interface IndicePlan {
    porPasada: Map<number, PlanificacionItem[]>;
    porOrdenYProceso: Map<string, PlanificacionItem[]>;
}

export function indexarPlan(planificacion: PlanificacionItem[]): IndicePlan {
    const porPasada = new Map<number, PlanificacionItem[]>();
    const porOrdenYProceso = new Map<string, PlanificacionItem[]>();
    for (const fila of planificacion) {
        if (fila.id_orden_trabajo_proceso) {
            const lista = porPasada.get(fila.id_orden_trabajo_proceso);
            if (lista) lista.push(fila);
            else porPasada.set(fila.id_orden_trabajo_proceso, [fila]);
        }
        const clave = `${fila.orden_id}-${fila.proceso_id}`;
        const lista = porOrdenYProceso.get(clave);
        if (lista) lista.push(fila);
        else porOrdenYProceso.set(clave, [fila]);
    }
    return { porPasada, porOrdenYProceso };
}

/**
 * Las filas del plan de UN paso: la principal y las de sus acompañantes.
 *
 * Mismo criterio que usa la tabla para mostrar el paso (`filaDelPlan`): primero por la
 * pasada exacta y, si no hay, por (orden, proceso), que es como quedaron los planes
 * guardados antes de que la pasada existiera. La primera fila es la que la tabla
 * muestra, y sólo se juntan las de su MISMA planificación: con «Todas las
 * planificaciones» elegida, una OT planificada en mayo y otra vez en septiembre tiene
 * filas de los dos planes, y la de mayo no puede hacer que el paso «sea de Juan»
 * cuando la pantalla muestra a Pedro.
 */
export function filasDelPaso(indice: IndicePlan, ordenId: number, paso: PasoDeOrden): PlanificacionItem[] {
    const exactas = paso.id ? indice.porPasada.get(paso.id) : undefined;
    const filas = exactas && exactas.length > 0
        ? exactas
        : indice.porOrdenYProceso.get(`${ordenId}-${paso.proceso?.id}`) ?? [];
    if (filas.length <= 1) return filas;
    const lote = filas[0].id_planificacion_lote ?? null;
    return filas.filter((f) => (f.id_planificacion_lote ?? null) === lote);
}

export interface RecursosDelPaso {
    /** Todas las personas del paso: las del plan y la elegida a mano. */
    operarios: Set<number>;
    /** Todas las máquinas del paso: la del plan y la elegida a mano. */
    maquinas: Set<number>;
    /** Lo elegido a mano que el plan NO tiene (para decir de dónde sale la coincidencia). */
    soloAMano: { operario?: number; maquina?: number };
}

const esId = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export function recursosDelPaso(filas: PlanificacionItem[], paso: PasoDeOrden): RecursosDelPaso {
    const operarios = new Set<number>();
    const maquinas = new Set<number>();
    for (const f of filas) {
        if (esId(f.id_operario)) operarios.add(f.id_operario);
        if (esId(f.id_maquinaria)) maquinas.add(f.id_maquinaria);
    }
    const aMano = paso as PasoDeOrden & Preseleccion;
    const soloAMano: RecursosDelPaso["soloAMano"] = {};
    if (esId(aMano.id_operario) && !operarios.has(aMano.id_operario)) {
        operarios.add(aMano.id_operario);
        soloAMano.operario = aMano.id_operario;
    }
    if (esId(aMano.id_maquinaria) && !maquinas.has(aMano.id_maquinaria)) {
        maquinas.add(aMano.id_maquinaria);
        soloAMano.maquina = aMano.id_maquinaria;
    }
    return { operarios, maquinas, soloAMano };
}

const cumpleOperario = (r: RecursosDelPaso, f: FiltroRecursos) =>
    f.operarios.length === 0 || f.operarios.some((id) => r.operarios.has(id));
const cumpleMaquina = (r: RecursosDelPaso, f: FiltroRecursos) =>
    f.maquinas.length === 0 || f.maquinas.some((id) => r.maquinas.has(id));

/** ¿El paso tiene alguna de las personas elegidas Y alguna de las máquinas elegidas? */
export function cumpleFiltro(r: RecursosDelPaso, f: FiltroRecursos): boolean {
    return cumpleOperario(r, f) && cumpleMaquina(r, f);
}

/** Cómo se reconoce un paso adentro de su OT, aunque la tabla lo reordene. */
export function claveDelPaso(paso: PasoDeOrden): string {
    return paso.id ? String(paso.id) : `${paso.proceso?.id}-${paso.orden}`;
}

/** ¿El paso cae en la fecha de la solapa? Sin fila de plan no cae en ninguna. */
function enVentana(filas: PlanificacionItem[], ventana?: (fila: PlanificacionItem) => boolean): boolean {
    if (!ventana) return true;
    return filas.length > 0 && ventana(filas[0]);
}

/**
 * Qué pasos de cada OT cumplen el filtro. Las OT sin ninguno no aparecen.
 * `ventana` es la regla de fecha de la solapa (Semanal, Diaria); sin ella, todos.
 */
export function pasosQueCoinciden(
    ordenes: WorkOrder[],
    indice: IndicePlan,
    filtro: FiltroRecursos,
    ventana?: (fila: PlanificacionItem) => boolean,
): Map<number, Set<string>> {
    const salida = new Map<number, Set<string>>();
    for (const o of ordenes) {
        for (const paso of o.procesos ?? []) {
            const filas = filasDelPaso(indice, o.id, paso);
            if (!enVentana(filas, ventana)) continue;
            if (!cumpleFiltro(recursosDelPaso(filas, paso), filtro)) continue;
            const claves = salida.get(o.id);
            if (claves) claves.add(claveDelPaso(paso));
            else salida.set(o.id, new Set([claveDelPaso(paso)]));
        }
    }
    return salida;
}

export interface OpcionRecurso {
    id: number;
    nombre: string;
    /** Cuántos pasos de la lista tiene, con el OTRO filtro ya aplicado. */
    pasos: number;
}

interface PersonaConNombre { id: number; nombre?: string | null; apellido?: string | null }
interface MaquinaConNombre { id: number; nombre?: string | null }

/**
 * Las opciones de los dos desplegables, con cuántos pasos tiene cada una EN ESTA LISTA.
 *
 * Salen de lo planificado y no del padrón entero: la pregunta es «qué personas y qué
 * máquinas hay en este plan» (Julián: «no sabemos qué operario o máquina hay»), y un
 * desplegable con los 40 del taller no la contesta. El número de al lado cuenta con el
 * otro filtro ya puesto: con el torno elegido, al lado de Juan dice cuántos pasos tiene
 * Juan EN el torno, que es lo que se va a ver si lo tildás.
 *
 * Lo ya elegido aparece siempre (aunque en esta solapa tenga cero), para poder sacarlo.
 * Un id sin nombre en ningún lado es el «sin asignar» del planificador: no se ofrece.
 */
export function opcionesDeRecursos(
    ordenes: WorkOrder[],
    indice: IndicePlan,
    filtro: FiltroRecursos,
    catalogo: { operarios: PersonaConNombre[]; maquinas: MaquinaConNombre[] },
    ventana?: (fila: PlanificacionItem) => boolean,
): { operarios: OpcionRecurso[]; maquinas: OpcionRecurso[] } {
    const nombreOperario = new Map<number, string>();
    for (const op of catalogo.operarios) {
        const n = nombrePersona(op.nombre, op.apellido);
        if (n) nombreOperario.set(op.id, n);
    }
    const nombreMaquina = new Map<number, string>();
    for (const m of catalogo.maquinas) {
        const n = nombreLindo(m.nombre);
        if (n) nombreMaquina.set(m.id, n);
    }
    // El plan también trae los nombres: sirven para quien ya no está en la lista de
    // recursos (se dio de baja después de planificar).
    for (const filas of indice.porOrdenYProceso.values()) {
        for (const f of filas) {
            if (esId(f.id_operario) && !nombreOperario.has(f.id_operario)) {
                const n = nombrePersona(f.nombre_operario, f.apellido_operario);
                if (n) nombreOperario.set(f.id_operario, n);
            }
            if (esId(f.id_maquinaria) && !nombreMaquina.has(f.id_maquinaria)) {
                const n = nombreLindo(f.nombre_maquinaria);
                if (n) nombreMaquina.set(f.id_maquinaria, n);
            }
        }
    }

    const pasosOperario = new Map<number, number>();
    const pasosMaquina = new Map<number, number>();
    for (const o of ordenes) {
        for (const paso of o.procesos ?? []) {
            const filas = filasDelPaso(indice, o.id, paso);
            if (!enVentana(filas, ventana)) continue;
            const r = recursosDelPaso(filas, paso);
            if (cumpleMaquina(r, filtro)) {
                r.operarios.forEach((id) => pasosOperario.set(id, (pasosOperario.get(id) ?? 0) + 1));
            }
            if (cumpleOperario(r, filtro)) {
                r.maquinas.forEach((id) => pasosMaquina.set(id, (pasosMaquina.get(id) ?? 0) + 1));
            }
        }
    }

    const armar = (
        conteo: Map<number, number>,
        nombres: Map<number, string>,
        elegidos: number[],
        rotulo: string,
    ): OpcionRecurso[] => {
        const ids = new Set<number>([...conteo.keys()].filter((id) => nombres.has(id)));
        elegidos.forEach((id) => ids.add(id));
        return [...ids]
            .map((id) => ({ id, nombre: nombres.get(id) ?? `${rotulo} #${id}`, pasos: conteo.get(id) ?? 0 }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
    };

    return {
        operarios: armar(pasosOperario, nombreOperario, filtro.operarios, "Recurso humano"),
        maquinas: armar(pasosMaquina, nombreMaquina, filtro.maquinas, "Máquina"),
    };
}

/** Los renglones que el archivo exportado lleva arriba, uno por filtro. */
export function filtrosParaExportar(
    filtro: FiltroRecursos,
    opciones: { operarios: OpcionRecurso[]; maquinas: OpcionRecurso[] },
): string[] {
    const nombre = (lista: OpcionRecurso[], id: number) => lista.find((o) => o.id === id)?.nombre ?? `#${id}`;
    const renglones: string[] = [];
    if (filtro.operarios.length > 0) {
        renglones.push(`Recurso humano: ${filtro.operarios.map((id) => nombre(opciones.operarios, id)).join(", ")}`);
    }
    if (filtro.maquinas.length > 0) {
        renglones.push(`Máquina: ${filtro.maquinas.map((id) => nombre(opciones.maquinas, id)).join(", ")}`);
    }
    return renglones;
}
