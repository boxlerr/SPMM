"use client";

/**
 * Piezas chicas de las cargas del botón «Nuevo» (NuevoMenu.tsx): la marca de «Modo
 * práctica» de la cabecera, la píldora de los diálogos y la tarjeta del insumo elegido.
 *
 * Están juntas para que las cinco cargas se vean como UNA cosa (la misma píldora, la
 * misma tarjeta), igual que InsumoComun.tsx hace con la ficha. El «no se guardó» del modo
 * práctica NO está acá: es el cartelito único del candado (`CartelitoPractica`, en
 * ModoEspejo.tsx), el mismo en toda la sección.
 */

import { useState, type ReactNode } from "react";
import { FlaskConical, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtCantidad, type InsumoFila } from "@/lib/materiaPrima";

/** Lo que explica la marca de la cabecera. Corto: es un tooltip. */
const EXPLICACION_PRACTICA =
    "Durante la prueba piloto no se guarda nada acá: las materias primas se siguen cargando " +
    "en el Sistema Integral. Podés abrir y recorrer todas las cargas para ver cómo es el " +
    "proceso; al guardar sale un aviso y todo queda como estaba.";

/**
 * «Modo práctica», al lado del título de la sección: el Integral es el dueño (prueba
 * piloto) y quien la mira PUEDE escribir la sección. Es la misma píldora celeste que
 * `MarcaEspejo` en modo práctica (ModoEspejo.tsx), pero con el tooltip de Radix en vez
 * de un `title`: la cabecera es donde se la ve primero, y un `title` no se lee en el
 * teléfono.
 *
 * El tooltip se abre también con un toque: en el teléfono no hay «pasar el mouse», y el
 * que ve «Modo práctica» sin saber qué es va a querer tocarlo.
 */
export function MarcaPractica() {
    const [abierto, setAbierto] = useState(false);
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip open={abierto} onOpenChange={setAbierto}>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={() => setAbierto((a) => !a)}
                        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200 transition-colors hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                        aria-label="Modo práctica: no se guarda nada durante la prueba piloto"
                    >
                        <FlaskConical className="h-3 w-3" />
                        Modo práctica
                    </button>
                </TooltipTrigger>
                <TooltipContent
                    side="bottom"
                    align="end"
                    // Colores explícitos: el `bg-popover` del componente no está en el tema de
                    // la casa y el globo salía transparente, con el texto encima del cartel.
                    className="max-w-[18rem] border-sky-200 bg-white text-xs leading-relaxed text-gray-700 shadow-lg"
                >
                    <b className="mb-0.5 block font-semibold text-sky-900">Modo práctica</b>
                    {EXPLICACION_PRACTICA}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

/**
 * La píldora de «Modo práctica» en la cabecera de un diálogo: que se sepa ANTES de
 * llenar el formulario que no se va a guardar.
 */
export function PildoraPractica({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800 ring-1 ring-sky-200",
                className,
            )}
            title={EXPLICACION_PRACTICA}
        >
            <FlaskConical className="h-3 w-3" />
            Modo práctica
        </span>
    );
}

/**
 * El insumo elegido, en una tarjeta: código, descripción y lo que hace falta para decidir
 * (stock, recortes). `detalle` es lo que cada carga quiere mostrar abajo (el saldo de
 * hoy, los recortes que ya tiene).
 */
export function TarjetaInsumo({ insumo, detalle, onCambiar, className }: {
    insumo: InsumoFila;
    detalle?: ReactNode;
    onCambiar?: () => void;
    className?: string;
}) {
    return (
        <div className={cn("flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2.5", className)}>
            <div className="min-w-0 flex-1">
                <p className="text-sm">
                    <span className="font-mono font-semibold text-gray-900">{insumo.codigo}</span>
                    <span className="text-gray-400"> — </span>
                    <span className="text-gray-800">{insumo.descripcion}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                    {detalle ?? (
                        <>
                            <span>
                                Libre <b className="tabular-nums text-gray-700">{fmtCantidad(insumo.libre, "0")}</b> {insumo.unidad ?? ""}
                            </span>
                            {insumo.recortes_disponibles > 0 && (
                                <span className="inline-flex items-center gap-1">
                                    <Scissors className="h-3 w-3" />
                                    {insumo.recortes_disponibles} recorte{insumo.recortes_disponibles === 1 ? "" : "s"}
                                </span>
                            )}
                        </>
                    )}
                </p>
            </div>
            {onCambiar && (
                <button
                    type="button"
                    onClick={onCambiar}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                >
                    Cambiar
                </button>
            )}
        </div>
    );
}
