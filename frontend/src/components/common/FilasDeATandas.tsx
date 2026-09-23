import React from "react";

/**
 * Las filas de una lista dibujada de a tandas (`useDeATandas`), agrupadas por tanda.
 *
 * Cada tanda es un bloque aparte que sólo se vuelve a dibujar si cambia algo SUYO: la
 * lista (otro orden, otro filtro), su tramo, o la función que arma cada fila (una OT
 * desplegada, un permiso). Si no, React la saltea entera.
 *
 * Sin esto, llegar a la tanda 10 volvía a dibujar las 540 filas de antes para agregar
 * 60, y cada letra del buscador redibujaba todo lo que se había bajado. Ahora una tanda
 * nueva cuesta sus 60 filas y una tecla no cuesta ninguna.
 *
 * `render` tiene que ser estable (`useCallback`) y devolver cada fila con su `key`.
 */
export function FilasDeATandas<T>({
    filas,
    mostradas,
    tanda,
    render,
}: {
    filas: T[];
    mostradas: number;
    tanda: number;
    render: (fila: T, indice: number) => React.ReactNode;
}) {
    const bloques: React.ReactNode[] = [];
    for (let desde = 0; desde < mostradas; desde += tanda) {
        bloques.push(
            <Tanda
                key={desde}
                fuente={filas as unknown[]}
                desde={desde}
                hasta={Math.min(desde + tanda, mostradas)}
                render={render as (fila: unknown, indice: number) => React.ReactNode}
            />
        );
    }
    return <>{bloques}</>;
}

const Tanda = React.memo(function Tanda({
    fuente,
    desde,
    hasta,
    render,
}: {
    fuente: unknown[];
    desde: number;
    hasta: number;
    render: (fila: unknown, indice: number) => React.ReactNode;
}) {
    const filas: React.ReactNode[] = [];
    for (let i = desde; i < hasta; i++) filas.push(render(fuente[i], i));
    return <>{filas}</>;
});
