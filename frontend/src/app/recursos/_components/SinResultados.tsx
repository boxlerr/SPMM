"use client";

/**
 * Una lista que quedó vacía POR UN FILTRO, dicha como tal.
 *
 * "No se encontraron procesos" solo, en el medio de la pantalla, es lo que vio Lucas
 * al llegar desde un aviso del plan (23/09/2026): el buscador venía cargado con un
 * nombre escrito con tilde que el catálogo tiene sin tilde, y nada en la pantalla
 * decía que había un filtro puesto. Se lee como "se rompió" o "no hay nada".
 *
 * Acá cada filtro se nombra, con su botón para sacarlo, y si hay más de uno, uno
 * para sacarlos todos. Si no hay ningún filtro puesto, se dice que la lista está
 * vacía de verdad.
 */

import { SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FiltroPuesto {
    /** Qué filtra, en castellano: «la búsqueda «pintura»», «solo los que frenan un plan». */
    etiqueta: string;
    onSacar: () => void;
}

interface Props {
    /** «procesos», «recurso maquinaria»… */
    que: string;
    filtros: FiltroPuesto[];
    /** Un motivo más concreto, si se sabe (p.ej. «el proceso del aviso ya no está en el catálogo»). */
    motivo?: string | null;
}

export default function SinResultados({ que, filtros, motivo }: Props) {
    if (filtros.length === 0) {
        return (
            <div className="py-12 text-center text-muted-foreground">
                <p className="text-lg">No hay {que} para mostrar</p>
            </div>
        );
    }
    return (
        <div className="px-4 py-10 text-center">
            <SearchX className="mx-auto h-8 w-8 text-muted-foreground/70" />
            <p className="mt-2 text-base font-medium text-foreground">
                No hay {que} que cumplan {filtros.length === 1 ? "con este filtro" : "con estos filtros"}
            </p>
            {motivo && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{motivo}</p>}
            <ul className="mx-auto mt-3 flex max-w-xl flex-wrap justify-center gap-2">
                {filtros.map((f) => (
                    <li key={f.etiqueta}>
                        <button
                            type="button"
                            onClick={f.onSacar}
                            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 transition-colors"
                            title="Sacar este filtro"
                        >
                            {f.etiqueta}
                            <X className="h-3 w-3" />
                        </button>
                    </li>
                ))}
            </ul>
            {filtros.length > 1 && (
                <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => filtros.forEach((f) => f.onSacar())}
                >
                    Sacar todos los filtros
                </Button>
            )}
        </div>
    );
}
