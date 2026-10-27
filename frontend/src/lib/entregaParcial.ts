/**
 * Entrega parcial: fabricar en este plan SÓLO una parte de la OT.
 *
 * Lucas (27/10/2026), con la 15984 fuera del plan: *"Debo poder indicar si en vez del
 * total del pedido, puedo hacer una entrega parcial. En este caso por ejemplo, son 66
 * piezas total pero tengo que entregar 24 para el jueve"*.
 *
 * Es un ajuste «solo para este plan» (ver `lib/ajustesPlan`): no se escribe en la OT,
 * viaja en `ajustes_del_plan.entregas_parciales` de `/planificar` y por eso llega a todos
 * los recálculos. El backend achica la producción a esas piezas (las preparaciones van
 * enteras), usa la fecha de la entrega en lugar de la prometida y le pega a cada fila de
 * la OT `entrega_parcial`: de ahí sale con qué entregas se calculó el plan de la pantalla.
 *
 * Como los ajustes, se marcan de a varias y se recalcula una vez (Julián, 25/09/2026:
 * *"tendría que dejarme terminar de verlas y ahí se replanifique"*). Lo marcado que el
 * plan todavía no tiene es lo que `entregasPendientes` cuenta para el botón del pie.
 */
import type { AjustesDelPlanPayload } from "./ajustesPlan";

export type EntregaParcial = {
    /** Piezas a fabricar en este plan. */
    unidades: number;
    /** Para cuándo (YYYY-MM-DD). Sin fecha, vale la prometida de la OT. */
    fecha?: string | null;
};

/** orden_id → entrega parcial. */
export type EntregasParciales = Record<number, EntregaParcial>;

/** Lo que el backend le pega a cada fila de una OT con entrega parcial. */
export type EntregaParcialDeLaFila = EntregaParcial & {
    /** Las piezas que faltaban de la OT cuando se calculó (66 en la 15984). */
    faltan: number;
};

type FilaDelPlan = { orden_id: number; entrega_parcial?: EntregaParcialDeLaFila | null };

/** Con qué entregas parciales salió el plan de la pantalla: lo dicen sus filas. */
export function entregasDeLasFilas(filas: FilaDelPlan[]): EntregasParciales {
    const acc: EntregasParciales = {};
    for (const f of filas ?? []) {
        const e = f?.entrega_parcial;
        if (e && e.unidades > 0 && !(f.orden_id in acc)) {
            acc[f.orden_id] = { unidades: e.unidades, fecha: e.fecha || null };
        }
    }
    return acc;
}

export const mismaEntrega = (a?: EntregaParcial, b?: EntregaParcial): boolean =>
    (!a && !b) || (!!a && !!b && a.unidades === b.unidades && (a.fecha || null) === (b.fecha || null));

/**
 * Las OT donde lo marcado no es con lo que salió el plan de la pantalla: una entrega
 * nueva, una cambiada o una que se sacó. Ordenadas por OT, para que el botón del pie
 * no las cuente en otro orden en cada render.
 */
export function entregasPendientes(
    marcadas: EntregasParciales,
    calculadas: EntregasParciales,
): { orden_id: number; marcada?: EntregaParcial; calculada?: EntregaParcial }[] {
    const ids = new Set([...Object.keys(marcadas ?? {}), ...Object.keys(calculadas ?? {})].map(Number));
    return Array.from(ids)
        .sort((a, b) => a - b)
        .filter((id) => !mismaEntrega(marcadas?.[id], calculadas?.[id]))
        .map((id) => ({ orden_id: id, marcada: marcadas?.[id], calculada: calculadas?.[id] }));
}

/**
 * Los ajustes que viajan a `/planificar`, con las entregas parciales adentro.
 *
 * Sin entregas devuelve los ajustes tal cual —`undefined` si no hay ninguno—: el request
 * tiene que ser exactamente el de antes, igual que en `payloadDeAjustes`.
 */
export function conEntregasParciales(
    ajustes: AjustesDelPlanPayload | undefined,
    entregas: EntregasParciales,
): AjustesDelPlanPayload | undefined {
    const ids = Object.keys(entregas ?? {}).map(Number).sort((a, b) => a - b);
    if (ids.length === 0) return ajustes;
    const entregas_parciales: Record<number, { unidades: number; fecha: string | null }> = {};
    for (const id of ids) {
        entregas_parciales[id] = { unidades: entregas[id].unidades, fecha: entregas[id].fecha || null };
    }
    return {
        ...(ajustes ?? { procesos: {}, maquinarias: {}, skills_nativas: [] }),
        entregas_parciales,
    };
}

/** «jue 29/10», como se habla en el taller. */
export function diaCorto(fecha: string): string {
    const [a, m, d] = fecha.slice(0, 10).split("-").map(Number);
    if (!a || !m || !d) return fecha;
    const dia = new Date(a, m - 1, d);
    const nombre = dia.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
    return `${nombre} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** «24 de 66 piezas · para el jue 29/10». `faltan` es lo que falta de la OT. */
export function textoDeEntrega(e: EntregaParcial, faltan?: number): string {
    const piezas = faltan
        ? `${e.unidades.toLocaleString("es-AR")} de ${faltan.toLocaleString("es-AR")} piezas`
        : `${e.unidades.toLocaleString("es-AR")} ${e.unidades === 1 ? "pieza" : "piezas"}`;
    return e.fecha ? `${piezas} · para el ${diaCorto(e.fecha)}` : piezas;
}
