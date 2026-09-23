import React from "react";
import { Loader2 } from "lucide-react";

/**
 * El pie de una lista que se dibuja de a tandas (`useDeATandas`).
 *
 * Es también el centinela: cuando entra en la vista, se agrega la tanda siguiente. El
 * botón «mostrar más» queda por las dudas —un navegador sin IntersectionObserver, o
 * alguien que prefiere tocar—, pero lo normal es no tener que tocar nada.
 */
export function PieDeTandas({
    mostradas,
    total,
    hayMas,
    centinela,
    verMas,
}: {
    mostradas: number;
    total: number;
    hayMas: boolean;
    centinela: (el: HTMLElement | null) => void;
    verMas: () => void;
}) {
    if (!hayMas) return null;
    return (
        <div
            ref={centinela}
            className="flex items-center justify-center gap-2 py-4 text-xs text-gray-500"
        >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
            <span>
                Mostrando {mostradas} de {total}
            </span>
            <span aria-hidden>·</span>
            <button type="button" onClick={verMas} className="font-medium text-blue-600 hover:underline">
                mostrar más
            </button>
        </div>
    );
}
