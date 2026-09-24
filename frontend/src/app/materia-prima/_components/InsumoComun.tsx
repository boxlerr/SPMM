"use client";

/**
 * Piezas chicas que comparten la lista de insumos y su ficha (solapa Insumos de
 * Materia prima): el control segmentado, el rótulo de los campos, el cartel del 409
 * («avisar, no bloquear»), el del servidor sin la sección y los vacíos.
 *
 * Están juntas para que la ficha se vea como UNA cosa: cinco solapas escritas cada una
 * con su propio amarillo de aviso y su propio botón de «Hacerlo igual» terminan
 * pareciendo cinco pantallas distintas.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw, ServerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { AVISO_SIN_SERVIDOR } from "@/lib/materiaPrima";

/** Adónde lleva el número de una OT: la ficha de la OT en Operaciones (la abre `?edit_ot=`). */
export const enlaceOT = (idOrden: number): string => `/operaciones?edit_ot=${idOrden}`;

/** El rótulo de un campo de la ficha: chico, en mayúsculas, como los de la OT. */
export function Rotulo({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
    return (
        <label
            htmlFor={htmlFor}
            className={cn("mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500", className)}
        >
            {children}
        </label>
    );
}

export interface OpcionSegmentada<T extends string> {
    valor: T;
    rotulo: ReactNode;
    titulo?: string;
}

/**
 * Elegir una entre pocas (tipo de insumo, mm/pulgada, unidad, tipo de movimiento): los
 * botones a la vista y no un desplegable, porque son dos a cinco opciones y se eligen
 * de un toque. `valor` null = ninguna elegida (un insumo sin clasificar del viejo).
 */
export function Segmentado<T extends string>({
    opciones,
    valor,
    onCambiar,
    disabled = false,
    className,
    parejo = false,
    "aria-label": ariaLabel,
}: {
    opciones: OpcionSegmentada<T>[];
    valor: T | null;
    onCambiar: (valor: T) => void;
    disabled?: boolean;
    className?: string;
    /** Todas del mismo ancho y ocupando el renglón (el tipo de insumo). */
    parejo?: boolean;
    "aria-label"?: string;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className={cn(
                "rounded-lg bg-gray-100 p-0.5 ring-1 ring-black/[0.03]",
                parejo ? "grid w-full" : "inline-flex flex-wrap",
                className,
            )}
            style={parejo ? { gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` } : undefined}
        >
            {opciones.map((o) => {
                const elegida = valor === o.valor;
                return (
                    <button
                        key={o.valor}
                        type="button"
                        role="radio"
                        aria-checked={elegida}
                        disabled={disabled}
                        title={o.titulo}
                        onClick={() => !elegida && onCambiar(o.valor)}
                        className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium leading-tight transition-all",
                            parejo ? "min-h-8 text-center" : "whitespace-nowrap",
                            elegida
                                ? "bg-white text-red-700 shadow-sm ring-1 ring-black/5"
                                : "text-gray-600 hover:text-gray-900",
                            disabled && "cursor-not-allowed",
                            disabled && !elegida && "opacity-50",
                        )}
                    >
                        {o.rotulo}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * El 409 de la casa: el backend no se negó, avisó. Se muestra el motivo tal cual lo
 * escribió (dice qué se pierde o qué se repite) y la persona decide: «Hacerlo igual»
 * repite el pedido con `?forzar=true`. Va en la misma ficha y no en un diálogo aparte:
 * en el teléfono la ficha ocupa la pantalla entera y un diálogo quedaría debajo.
 */
export function AvisoConfirmacion({
    motivo,
    accion = "Hacerlo igual",
    onConfirmar,
    onCancelar,
    ocupado = false,
    className,
}: {
    motivo: string;
    accion?: string;
    onConfirmar: () => void;
    onCancelar: () => void;
    ocupado?: boolean;
    className?: string;
}) {
    return (
        <div
            role="alert"
            className={cn("rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900", className)}
        >
            <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="min-w-0 flex-1 whitespace-pre-line">{motivo}</p>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancelar}
                    disabled={ocupado}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                >
                    Cancelar
                </button>
                <button
                    type="button"
                    onClick={onConfirmar}
                    disabled={ocupado}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                >
                    {ocupado && <Loader2 className="h-3 w-3 animate-spin" />}
                    {accion}
                </button>
            </div>
        </div>
    );
}

/** El backend todavía no tiene la sección (se deploya a mano): el cartel ámbar, no un error rojo. */
export function CartelSinServidor({ className }: { className?: string }) {
    return (
        <div className={cn("flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900", className)}>
            <ServerOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>{AVISO_SIN_SERVIDOR}</p>
        </div>
    );
}

/** Un pedido que falló, con su motivo y la manera de volver a probar. */
export function CartelError({ mensaje, onReintentar, className }: { mensaje: string; onReintentar?: () => void; className?: string }) {
    return (
        <div className={cn("flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800", className)}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">{mensaje}</p>
            {onReintentar && (
                <button
                    type="button"
                    onClick={onReintentar}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                >
                    <RefreshCw className="h-3 w-3" /> Reintentar
                </button>
            )}
        </div>
    );
}

/** Una lista que no tiene nada: qué no hay y, si se puede, qué hacer. */
export function Vacio({ icono, titulo, children, className }: {
    icono?: ReactNode;
    titulo: string;
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center", className)}>
            {icono && <div className="text-gray-300">{icono}</div>}
            <p className="text-sm font-medium text-gray-600">{titulo}</p>
            {children && <div className="text-xs text-gray-500">{children}</div>}
        </div>
    );
}

/** Renglones grises mientras llega lo primero (lo que viene después no tapa lo que hay). */
export function Esqueleto({ filas = 4, className }: { filas?: number; className?: string }) {
    return (
        <div className={cn("space-y-2", className)} aria-hidden>
            {Array.from({ length: filas }, (_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-gray-100" style={{ opacity: 1 - i * 0.15 }} />
            ))}
        </div>
    );
}

/** Un número grande con su rótulo (las tarjetas de la solapa Stock). */
export function Tarjeta({ titulo, valor, detalle, tono, title }: {
    titulo: string;
    valor: ReactNode;
    detalle?: ReactNode;
    tono?: string;
    title?: string;
}) {
    return (
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2" title={title}>
            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
            <p className={cn("truncate text-xl font-bold tabular-nums text-gray-900", tono)}>{valor}</p>
            {detalle && <p className="truncate text-[11px] text-gray-500">{detalle}</p>}
        </div>
    );
}
