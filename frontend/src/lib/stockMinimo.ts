/**
 * Stock mínimo por insumo (RF-14), del lado de la pantalla.
 *
 * El mínimo es un dato NUEVO de SPMM sobre una materia prima que sigue siendo del
 * sistema viejo (decisión del 11/09): el stock lo trae el sync y acá sólo se lee; el
 * mínimo lo carga el pañol en la solapa Materia Prima y el sync no lo toca. El aviso
 * lo escribe el backend solo (POST /internal/alertas) y llega a la campanita.
 */

/**
 * ¿Está abajo del mínimo? Espejo EXACTO de `Pieza.bajo_minimo` del backend
 * (backend/domain/Pieza.py), que es la que decide el aviso y el filtro de la solapa.
 * Acá se usa sólo para pintar la fila al instante mientras se edita, antes de que
 * vuelva la respuesta; si se cambia una, se cambia la otra.
 *
 *   · sin mínimo            → no se vigila
 *   · sin stock conocido    → tampoco: null es «no sabemos», no «cero» (el mismo
 *                             cuidado que la columna Material, ver materialOT.ts)
 *   · estrictamente menor   → el SRS dice «por debajo»: 10 de 10 está en el mínimo
 */
export const estaBajoMinimo = (
    stock: number | null | undefined,
    minimo: number | null | undefined,
): boolean =>
    minimo !== null && minimo !== undefined &&
    stock !== null && stock !== undefined &&
    stock < minimo;

/** Adónde lleva el aviso de stock bajo: la solapa Materia Prima, parada en esa pieza. */
export const enlaceAPieza = (idPieza: number): string =>
    `/operaciones?tab=materia_prima&pieza=${idPieza}`;

/**
 * Lo que escribió la persona en la celda, como número. `null` = vacío (quitar el
 * mínimo). `undefined` = no es un número que se pueda guardar.
 *
 * Acepta coma decimal, que es como se escribe acá: «2,5» es dos y medio, no 25.
 */
export const leerMinimo = (texto: string): number | null | undefined => {
    const limpio = texto.trim().replace(",", ".");
    if (limpio === "") return null;
    const n = Number(limpio);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return n;
};

/** Un número como lo escribe el taller: sin «.0» de más y con coma decimal. */
export const formatearCantidad = (valor: number | null | undefined): string => {
    if (valor === null || valor === undefined) return "-";
    return Number(valor.toFixed(3)).toLocaleString("es-AR", { maximumFractionDigits: 3 });
};
