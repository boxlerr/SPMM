"use client";

/**
 * Qué clase de trabajo es la OT: Fabricación, Reparación o Sin Cargo.
 *
 * POR QUÉ EXISTE UN COMPONENTE PARA ESTO
 *
 * Camilo, 14/09: «cuando abrís la OT no dice si es fabricación o reparación o sin
 * cargo. Esa info con una tilde se podría poner, para cuando abrís saber qué tipo de
 * OT es. Eso me ayuda de mucho al momento de poner los procesos».
 *
 * El cartelito ya existía, pero copiado a mano en UNA sola pantalla (la solapa Todas) y
 * con dos opciones de tres. Las otras dos listas —las que el taller usa todo el día—
 * no lo mostraban en ninguna columna. Copiarlo una tercera vez era garantizar que
 * mañana los tres digan cosas distintas, así que vive acá.
 *
 * En la base son TRES banderas del sistema viejo (`fabricacion`, `reparacion`,
 * `sin_cargo`) que pueden estar varias prendidas o ninguna. Acá se muestra UNA cosa
 * sola, que es como se lee; el backend ya resuelve esa cuenta en `tipo_trabajo`.
 *
 * `null` no se dibuja como "ninguno": se dibuja como raya. No saber de qué tipo es una
 * OT es un dato —hay 1.246 así, todas heredadas del sistema viejo— y confundirlo con
 * "no es de ningún tipo" haría pensar que alguien lo contestó.
 */

import { cn } from "@/lib/utils";

export type TipoTrabajo = "fabricacion" | "reparacion" | "sin_cargo" | "ambas" | null;

/** El mismo texto y el mismo color en toda la app. */
const ESTILOS: Record<Exclude<TipoTrabajo, null>, { texto: string; clase: string }> = {
    fabricacion: { texto: "Fabricación", clase: "bg-sky-100 text-sky-800" },
    reparacion: { texto: "Reparación", clase: "bg-violet-100 text-violet-800" },
    sin_cargo: { texto: "Sin Cargo", clase: "bg-amber-100 text-amber-800" },
    // "Las dos" es el caso raro en que quedaron dos banderas prendidas juntas. No es un
    // error a esconder: es una OT que alguien tiene que mirar.
    ambas: { texto: "Las dos", clase: "bg-gray-100 text-gray-600" },
};

/** El mismo texto que el cartel, para los archivos exportados. Vacío si no tiene tipo. */
export function textoTipoTrabajo(tipo: TipoTrabajo): string {
    return (tipo && ESTILOS[tipo]?.texto) || "";
}

export function TipoTrabajoBadge({ tipo, className }: { tipo: TipoTrabajo; className?: string }) {
    if (!tipo) return <span className="text-gray-300">—</span>;
    const e = ESTILOS[tipo];
    if (!e) return <span className="text-gray-300">—</span>;
    return (
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", e.clase, className)}>
            {e.texto}
        </span>
    );
}

/**
 * El mismo cálculo que hace el backend para `tipo_trabajo`, para las pantallas que
 * reciben la OT entera (con las tres banderas) en vez del resumen ya resuelto.
 */
export function tipoDeTrabajoDe(o: {
    fabricacion?: number | boolean | null;
    reparacion?: number | boolean | null;
    sin_cargo?: number | boolean | null;
}): TipoTrabajo {
    const prendida = (v: number | boolean | null | undefined) => v === 1 || v === true;
    const fab = prendida(o.fabricacion), rep = prendida(o.reparacion), sc = prendida(o.sin_cargo);
    if ([fab, rep, sc].filter(Boolean).length > 1) return "ambas";
    if (fab) return "fabricacion";
    if (rep) return "reparacion";
    if (sc) return "sin_cargo";
    return null;
}
