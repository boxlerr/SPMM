"use client";

/**
 * El megáfono del menú: vuelve a abrir el aviso que sale al entrar (AvisoAlEntrar).
 *
 * Pedido de Julián (25/09/2026): poder abrir el cartel si se cerró sin leerlo, «de una
 * forma bonita que se vea en el sidebar» y «no tan invasiva como si fuese una sección».
 * Por eso no es un renglón más del menú —el menú son pantallas, y esto no lleva a
 * ninguna— sino un botoncito pegado al nombre de la persona, abajo, que es donde se mira
 * lo que es de uno. Con el menú achicado queda arriba de la inicial.
 *
 * Mientras el aviso no se leyó, el megáfono se pone rojo y lleva un puntito (que late
 * tres veces y se queda quieto: un aviso no es una alarma). Leído, queda gris y sigue
 * ahí por si se lo quiere volver a mirar. Qué cuenta como leído: hooks/useAvisoAlEntrar.ts.
 * Sin aviso (AVISO_AL_ENTRAR = null) no se dibuja: Novedades ya está en el menú.
 *
 * El cartelito de al lado es CSS y no el Tooltip de Radix: ese se abre también cuando el
 * botón recibe el foco, y el cartel del aviso, al cerrarse, le devuelve el foco al botón
 * que lo abrió; quedaba colgado encima del menú justo después de leerlo.
 */

import { Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { AVISO_AL_ENTRAR } from "@/lib/novedades";
import { abrirAviso, useAvisoAlEntrar } from "@/hooks/useAvisoAlEntrar";

type Props = {
    /** Menú achicado: el botón es del tamaño de los íconos del menú y el cartelito sale a la derecha. */
    compacto?: boolean;
    /** Lo que hay que hacer antes de abrir el cartel (en el teléfono, cerrar el menú). */
    alAbrir?: () => void;
};

export default function BotonAviso({ compacto = false, alAbrir }: Props) {
    const { sinLeer } = useAvisoAlEntrar();
    const aviso = AVISO_AL_ENTRAR;
    if (!aviso) return null;

    const rotulo = sinLeer ? "Tenés un aviso sin leer" : "Volver a ver el último aviso";

    return (
        <div className="group/aviso relative shrink-0">
            <button
                type="button"
                onClick={() => {
                    alAbrir?.();
                    abrirAviso();
                }}
                aria-label={`${rotulo}: ${aviso.titulo}`}
                data-sin-leer={sinLeer || undefined}
                className={cn(
                    "peer relative flex items-center justify-center border transition-all duration-200",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DC143C]/30",
                    compacto ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-lg",
                    sinLeer
                        ? "bg-red-50 border-red-200 text-[#DC143C] shadow-sm hover:bg-red-100 hover:border-red-300"
                        : "bg-white border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300 hover:shadow-sm"
                )}
            >
                <Megaphone
                    className={cn(
                        compacto ? "h-5 w-5" : "h-4 w-4",
                        "transition-transform duration-200",
                        sinLeer && "-rotate-12"
                    )}
                />
                {sinLeer && (
                    <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5" aria-hidden>
                        <span className="absolute inline-flex h-full w-full rounded-full bg-[#DC143C] opacity-60 motion-safe:animate-ping [animation-iteration-count:3]" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#DC143C] ring-2 ring-white" />
                    </span>
                )}
            </button>

            <div
                aria-hidden
                className={cn(
                    "pointer-events-none absolute z-50 w-max max-w-[200px] rounded-lg bg-gray-900 px-3 py-2 text-left shadow-lg",
                    "opacity-0 transition-opacity duration-150 group-hover/aviso:opacity-100 peer-focus-visible:opacity-100",
                    compacto ? "left-full top-1/2 ml-3 -translate-y-1/2" : "bottom-full right-0 mb-2"
                )}
            >
                <p className="text-xs font-semibold text-white">{rotulo}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-300">{aviso.titulo}</p>
            </div>
        </div>
    );
}
