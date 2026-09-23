/**
 * Qué tan urgente es una prioridad, para ORDENAR listas (RF-02: «ordenadas por
 * prioridad, fechas y estado»).
 *
 * Por qué por el nombre y no por el id: el catálogo vino del sistema viejo y el id no
 * dice nada del orden (en unas pantallas el 2 es «Urgente», en otras el 4). El nombre es
 * lo que usan el planificador (PlanificacionService: urgente 1, urgente 2, normal, baja) y
 * el cuadro «Órdenes por prioridad» del Dashboard (Urgente, Reclamo, Normal). Esto sigue
 * ese mismo orden, así una lista ordenada por prioridad no contradice al tablero.
 *
 * Más chico = más urgente. Una prioridad que no está en la lista va después de las
 * conocidas; sin prioridad, al final.
 */
export function rangoPrioridad(descripcion?: string | null): number {
    const p = (descripcion ?? "").trim().toLowerCase()
    if (!p) return 7
    if (p.startsWith("crít") || p.startsWith("crit")) return 0
    if (p === "urgente 2") return 2
    if (p.startsWith("urgente")) return 1
    if (p === "reclamo") return 3
    if (p === "normal") return 4
    if (p === "baja") return 5
    return 6
}
