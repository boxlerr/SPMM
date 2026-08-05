import type { EstadoSkill, NivelSkill } from "./_components/SkillsEditor";

export const POOL = "pool";
export const LISTA_1 = "nivel-1";
export const LISTA_2 = "nivel-2";

/**
 * Aplica un movimiento (arrastrar o click) sobre el estado de las skills.
 *
 * Función PURA para poder probarla sin arrastrar nada: el drag multi-frame de la
 * librería es incómodo de simular, pero lo que puede romperse de verdad —insertar en
 * el índice correcto y renumerar— vive acá.
 *
 * Renumera SIEMPRE las dos listas de 0..n-1. Si se dejaran los índices viejos, dos
 * skills podrían compartir posición y el desempate del planificador quedaría
 * indefinido (`orden` es lo que lee PlanificacionService para preferir una sobre otra).
 *
 * @param l1Actual ids de SKILLS 1, en el orden en que se ven hoy
 * @param l2Actual ids de SKILLS 2, idem
 * @param indiceDestino posición donde se soltó dentro de la lista destino
 */
export function aplicarMovimientoSkill(
    estados: Record<number, EstadoSkill>,
    l1Actual: number[],
    l2Actual: number[],
    idMovido: number,
    destino: string,
    indiceDestino: number
): Record<number, EstadoSkill> {
    const estadoDe = (id: number): EstadoSkill =>
        estados[id] ?? { nivel: 0, habilitado: true, orden: null };

    const l1 = l1Actual.filter((id) => id !== idMovido);
    const l2 = l2Actual.filter((id) => id !== idMovido);

    // clamp: un índice fuera de rango (lista filtrada, drop al vacío) va al final.
    const insertar = (lista: number[]) => {
        const i = Math.max(0, Math.min(indiceDestino, lista.length));
        lista.splice(i, 0, idMovido);
    };
    if (destino === LISTA_1) insertar(l1);
    else if (destino === LISTA_2) insertar(l2);

    const siguiente = { ...estados };
    const previo = estadoDe(idMovido);

    l1.forEach((id, i) => {
        siguiente[id] = { ...estadoDe(id), nivel: 1 as NivelSkill, orden: i, habilitado: true };
    });
    l2.forEach((id, i) => {
        siguiente[id] = { ...estadoDe(id), nivel: 2 as NivelSkill, orden: i, habilitado: true };
    });
    if (destino === POOL) {
        // Vuelve al pool: pierde prioridad y posición, pero NO su estado de apagado.
        siguiente[idMovido] = { nivel: 0, habilitado: previo.habilitado, orden: null };
    }
    return siguiente;
}
