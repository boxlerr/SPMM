"use client";

/**
 * El marco de las dos pantallas de planificar: elegir OTs y revisar el plan.
 *
 * Antes esto eran dos modales de 95vw × 90vh, uno arriba del otro. Julián el
 * 19/08: "no quiero que sea un modal flotando, es incómodo de trabajar; que al
 * hacer click en Planificar se abra el planificador entero y la preview también,
 * que ocupe toda la pantalla y sea una ventana única todo el proceso".
 *
 * Un modal de ese tamaño no es un diálogo: es una pantalla con un borde gris
 * alrededor, sin barra lateral para navegar, que se cierra si el navegador
 * estornuda y que obliga a bloquear el click de afuera y la tecla Escape para no
 * perder media hora de trabajo. Todo eso desaparece siendo una pantalla.
 *
 * Por qué la altura es `calc(100vh - 3rem)`: el layout de la app (LayoutWrapper)
 * mete el contenido de cada página dentro de un `p-6`, o sea 24px arriba y 24px
 * abajo. Descontando esos 48px, la pantalla llega justo hasta el borde de la
 * ventana sin generar scroll del documento — el único scroll queda adentro, que es
 * lo que hace que la cabecera y el pie estén SIEMPRE a la vista.
 *
 * Por qué `hidden` en vez de no renderizar: las dos pantallas conviven montadas.
 * Yendo de la vista previa a "Volver" y de nuevo a planificar, desmontar perdería
 * el rango de fechas elegido, los filtros y lo tildado; con `display:none` el
 * estado sigue vivo y volver es instantáneo.
 */

import { cn } from "@/lib/utils";

export function PantallaPlanificador({
    visible,
    cabecera,
    pie,
    children,
    className,
}: {
    visible: boolean;
    /** Barra de arriba, fija: título, acciones, contadores. */
    cabecera: React.ReactNode;
    /** Barra de abajo, fija: Volver / Confirmar. */
    pie?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "h-[calc(100vh-3rem)] flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden",
                !visible && "hidden",
                className,
            )}
        >
            <div className="shrink-0 border-b border-gray-100 bg-white">{cabecera}</div>
            <div className="relative flex-1 min-h-0 flex">{children}</div>
            {pie && <div className="shrink-0 border-t border-gray-200 bg-white">{pie}</div>}
        </div>
    );
}

/**
 * Una de las cuatro cifras de arriba del plan: OTs, procesos, carga, trabas.
 *
 * Estaban como badges chiquitos apretados contra el título y no se leían de un
 * vistazo — que es exactamente para lo que sirven: mirar el plan y saber si tiene
 * el tamaño que uno esperaba antes de ponerse a revisarlo fila por fila.
 */
export function CifraPlan({
    icono,
    valor,
    etiqueta,
    tono = "neutral",
    accion,
    title,
}: {
    icono: React.ReactNode;
    valor: React.ReactNode;
    etiqueta: string;
    /** "fecha" = la celda del período del plan: mismo peso que las otras cifras,
     *  acento azul para que se lea como el dato que ordena todo lo demás. */
    tono?: "neutral" | "alerta" | "ok" | "fecha";
    accion?: React.ReactNode;
    title?: string;
}) {
    return (
        // Sin flex-1 ni min-w: el ancho lo reparte la grilla del riel, y el fondo
        // blanco es lo que deja ver los separadores (el gap-px del contenedor).
        // La tarjeta redondeada con ring de la celda "alerta" era la que flotaba
        // en medio de una tira sin fondo: ahora pinta la celda entera, de borde a
        // borde, y sigue igual de roja.
        <div
            title={title}
            className={cn(
                "min-w-0 flex items-center gap-2.5 px-3 py-2",
                tono === "alerta" ? "bg-rose-50" : "bg-white",
            )}
        >
            <div
                className={cn(
                    "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                    tono === "alerta" ? "bg-rose-100 text-rose-600"
                        : tono === "ok" ? "bg-emerald-100 text-emerald-600"
                            : tono === "fecha" ? "bg-blue-100 text-blue-700"
                                : "bg-slate-100 text-slate-500",
                )}
            >
                {icono}
            </div>
            <div className="min-w-0">
                <div className={cn(
                    "text-lg font-bold leading-tight tabular-nums truncate",
                    tono === "alerta" ? "text-rose-600" : "text-gray-900",
                )}>
                    {valor}
                </div>
                <div className="text-[12px] text-gray-500 truncate">{etiqueta}</div>
            </div>
            {accion && <div className="ml-auto shrink-0">{accion}</div>}
        </div>
    );
}
