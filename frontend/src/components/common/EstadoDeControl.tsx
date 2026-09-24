"use client";

/**
 * «Estado y control» de la OT (RF-11), en la ficha y en las listas.
 *
 *   · `EstadoYControl` → el recuadro de la ficha con las ocho casillas del sistema viejo,
 *     en su orden, y el «Cant.» al lado de Finalizado parcial.
 *   · `ChipsDeControl` → en una fila de lista, las etapas de control y terminación que
 *     tiene la OT (Controlada, Para pintar, Terc. intermedia, Terc. final). Nada si no
 *     tiene ninguna, así las listas se ven como siempre.
 *
 * Lo que significa cada casilla y el orden están en lib/estadoControlOT.ts.
 */

import { ShieldCheck, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
    CASILLAS_DE_ESTADO,
    CASILLAS_NUEVAS,
    etapasDe,
    cuandoLegible,
    type CasillaDeEstado,
    type ConEstadoDeControl,
} from "@/lib/estadoControlOT";

export type ValoresDeEstado = Record<CasillaDeEstado, boolean> & { cantidad_finalizada_parcial: string };

interface EstadoYControlProps {
    valores: ValoresDeEstado;
    onCasilla: (clave: CasillaDeEstado, marcada: boolean) => void;
    onCantidad: (texto: string) => void;
    /** Sin permiso de escribir OT (o el modo legacy): todo se ve y nada se cambia. */
    bloqueado: boolean;
    /** false = el backend todavía no guarda las casillas nuevas: se ven y no se tocan. */
    conoceNuevas: boolean;
    /** Lo que dice la OT GUARDADA (no el formulario): quién la controló y cuándo. */
    guardada?: { controlado: boolean; por?: string | null; en?: string | null } | null;
    /** Las unidades de la OT, para avisar si el «Cant.» terminado es más que eso. */
    unidades?: number | null;
}

const NUEVA = new Set<string>(CASILLAS_NUEVAS);

export function EstadoYControl({
    valores, onCasilla, onCantidad, bloqueado, conoceNuevas, guardada, unidades,
}: EstadoYControlProps) {
    const cant = valores.cantidad_finalizada_parcial.trim();
    const cantNum = /^\d+$/.test(cant) ? Number(cant) : null;
    const cantInvalida = cant !== "" && cantNum === null;
    const cantDeMas = cantNum !== null && !!unidades && cantNum > unidades;

    /** Lo que se lee debajo de Controlado. Nunca un autor inventado: si no se sabe, no se dice. */
    const notaControl = (() => {
        if (!conoceNuevas) return null;
        if (valores.controlado && guardada?.controlado) {
            if (!guardada.por && !guardada.en) return "No quedó registrado quién la controló.";
            return [guardada.por ? `Por ${guardada.por}` : null, cuandoLegible(guardada.en)]
                .filter(Boolean).join(" · ");
        }
        if (valores.controlado) return "Al guardar queda registrado que la controlaste vos.";
        if (guardada?.controlado) return "Al guardar se borra quién la controló.";
        return null;
    })();

    return (
        <section
            aria-labelledby="estado-y-control-titulo"
            className="md:col-span-4 xl:col-span-6 rounded-xl border border-gray-100 bg-gray-50/30 p-2.5 mt-1"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1 pb-1.5">
                <h4 id="estado-y-control-titulo" className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">
                    Estado y control
                </h4>
                {!conoceNuevas && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                        <Info className="h-3 w-3 shrink-0" />
                        Controlado, pintura, tercerización y «Cant.» se van a poder cargar cuando se actualice el servidor.
                    </span>
                )}
            </div>

            {/* El orden es el de la ficha vieja, y se lee igual en el teléfono (una
                columna), en la tablet (de a dos) y en la compu (las dos tandas de cuatro:
                el avance arriba, el control y las terminaciones abajo). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-1.5">
                {CASILLAS_DE_ESTADO.map(({ clave, rotulo, ayuda }) => {
                    const marcadaAhora = !!valores[clave];
                    const deshabilitada = bloqueado || (NUEVA.has(clave) && !conoceNuevas);
                    const id = `estado-${clave}`;
                    const esParcial = clave === "finalizadoparcial";
                    const esControl = clave === "controlado";
                    return (
                        <div
                            key={clave}
                            title={ayuda}
                            className={cn(
                                "rounded border px-2 py-1 transition-colors min-h-8",
                                marcadaAhora
                                    ? clave === "finalizadototal"
                                        ? "bg-green-50 border-green-200"
                                        : esControl
                                            ? "bg-blue-50 border-blue-200"
                                            : "bg-white border-gray-300"
                                    : "bg-white/60 border-transparent",
                                !deshabilitada && "hover:bg-gray-100/50",
                            )}
                        >
                            <div className="flex items-center gap-2 min-h-6">
                                <Checkbox
                                    id={id}
                                    disabled={deshabilitada}
                                    checked={marcadaAhora}
                                    onCheckedChange={(c) => onCasilla(clave, !!c)}
                                    className={cn(
                                        clave === "finalizadototal" && "border-green-600 data-[state=checked]:bg-green-600",
                                        esControl && "border-blue-600 data-[state=checked]:bg-blue-600",
                                    )}
                                />
                                <label
                                    htmlFor={id}
                                    className={cn(
                                        "text-xs font-medium leading-tight flex-1 min-w-0",
                                        deshabilitada ? "cursor-not-allowed text-gray-400" : "cursor-pointer text-gray-700",
                                        marcadaAhora && clave === "finalizadototal" && "text-green-700 font-bold",
                                        marcadaAhora && esControl && "text-blue-700 font-bold",
                                    )}
                                >
                                    {esControl && <ShieldCheck className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
                                    {rotulo}
                                </label>
                                {/* El «Cant.» va al lado de Finalizado parcial, como en la
                                    ficha vieja. No se ata a la casilla: se puede cargar y
                                    borrar aunque la casilla esté sin marcar, así nunca se
                                    pierde un número por destildar sin querer. */}
                                {esParcial && (
                                    <div className="flex items-center gap-1 shrink-0">
                                        <label htmlFor="cantidad_finalizada_parcial" className="text-[11px] font-semibold text-gray-500">
                                            Cant.
                                        </label>
                                        <Input
                                            id="cantidad_finalizada_parcial"
                                            type="number"
                                            inputMode="numeric"
                                            min={0}
                                            step={1}
                                            disabled={bloqueado || !conoceNuevas}
                                            value={valores.cantidad_finalizada_parcial}
                                            onChange={(e) => onCantidad(e.target.value)}
                                            aria-invalid={cantInvalida || undefined}
                                            className={cn("h-7 w-20 px-1.5 text-xs text-right", cantInvalida && "border-red-400")}
                                        />
                                    </div>
                                )}
                            </div>
                            {esParcial && (cantInvalida || cantDeMas) && (
                                <p className={cn("mt-0.5 text-[11px] leading-tight", cantInvalida ? "text-red-600" : "text-amber-700")}>
                                    {cantInvalida
                                        ? "Tiene que ser un número entero de unidades."
                                        : `Es más que las ${unidades} unidades de la OT.`}
                                </p>
                            )}
                            {esControl && notaControl && (
                                <p className="mt-0.5 pl-6 text-[11px] leading-tight text-gray-500">{notaControl}</p>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

/** Las etapas de control y terminación de una fila de lista. Nada si no tiene ninguna. */
export function ChipsDeControl({ orden, className }: { orden: ConEstadoDeControl; className?: string }) {
    const etapas = etapasDe(orden);
    if (etapas.length === 0) return null;
    return (
        <span className={cn("inline-flex flex-wrap gap-1", className)}>
            {etapas.map((e) => (
                <span
                    key={e.clave}
                    title={e.clave === "controlado"
                        ? [orden.controlado_por ? `Controlada por ${orden.controlado_por}` : "Controlada",
                           cuandoLegible(orden.controlado_en)].filter(Boolean).join(" · ")
                        : undefined}
                    className={cn(
                        // Con borde y fondo blanco: la tarjeta de la OT en el teléfono es gris
                        // (el color de su estado) y un chip gris claro sobre gris no se leía.
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                        e.clave === "controlado"
                            ? "border-blue-300 bg-blue-100 text-blue-900"
                            : "border-slate-400 bg-white text-slate-800",
                    )}
                >
                    {e.clave === "controlado" && <ShieldCheck className="h-3 w-3" />}
                    {e.corto}
                </span>
            ))}
        </span>
    );
}
