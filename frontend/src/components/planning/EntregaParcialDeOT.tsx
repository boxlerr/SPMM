"use client";

import React from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { diaCorto, mismaEntrega, textoDeEntrega, type EntregaParcial } from "@/lib/entregaParcial";

/**
 * «Entrega parcial» de una OT en la vista previa: cuántas piezas se fabrican en este plan
 * y para cuándo (Lucas, 27/10/2026: «son 66 piezas total pero tengo que entregar 24 para
 * el jueve»). Ver `lib/entregaParcial`.
 *
 * No recalcula: marca, y el botón del pie junta todo lo marcado en un solo recálculo,
 * como los ajustes del panel de avisos. Mientras tanto el chip dice «sin calcular».
 *
 * `variante`: «tarjeta» es el botón al lado de Descartar/Forzar en «Fuera del plan»;
 * «celda» va debajo de la cantidad en la tabla de OT planificadas, y corta el click para
 * no abrir la fila.
 */
export function EntregaParcialDeOT({
    numero, faltan, prometida, marcada, calculada, onCambiar, disabled, variante,
}: {
    /** El número de OT que ve el taller. */
    numero: number | string;
    /** Las piezas que faltan de la OT: el máximo que tiene sentido pedir es una menos. */
    faltan: number;
    /** La fecha prometida de la OT (para decir qué vale si no se pone fecha). */
    prometida?: string | null;
    /** Lo marcado para el próximo recálculo. */
    marcada?: EntregaParcial;
    /** Con lo que salió el plan de la pantalla. */
    calculada?: EntregaParcial;
    onCambiar: (entrega: EntregaParcial | undefined) => void;
    disabled?: boolean;
    variante: "tarjeta" | "celda";
}) {
    const [abierto, setAbierto] = React.useState(false);
    const [piezas, setPiezas] = React.useState("");
    const [fecha, setFecha] = React.useState("");

    // Cada vez que se abre arranca de lo marcado, no de lo que quedó escrito y no se usó.
    React.useEffect(() => {
        if (!abierto) return;
        setPiezas(marcada ? String(marcada.unidades) : "");
        setFecha(marcada?.fecha || "");
    }, [abierto, marcada]);

    const n = Number(piezas);
    const entero = piezas.trim() !== "" && Number.isInteger(n);
    const error = !entero
        ? null
        : n < 1
            ? "Tiene que ser al menos 1 pieza."
            : n >= faltan
                ? `Faltan ${faltan.toLocaleString("es-AR")}: con eso se planifica la OT entera, no hace falta entrega parcial.`
                : null;
    const valida = entero && !error;
    const pendiente = !mismaEntrega(marcada, calculada);

    const marcar = () => {
        if (!valida) return;
        onCambiar({ unidades: n, fecha: fecha || null });
        setAbierto(false);
    };
    const quitar = () => {
        onCambiar(undefined);
        setAbierto(false);
    };

    const prometidaTexto = prometida && !prometida.startsWith("19") ? diaCorto(prometida) : null;

    const disparador = marcada ? (
        <button
            type="button"
            disabled={disabled}
            title={`Entrega parcial: ${textoDeEntrega(marcada, faltan)}. ${pendiente ? "Se aplica al recalcular." : "El plan de la pantalla ya la tiene."} Click para cambiarla o sacarla.`}
            className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors disabled:opacity-60",
                pendiente
                    ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                    : "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100",
            )}
        >
            <PackageCheck className="h-3 w-3 shrink-0" />
            {variante === "celda"
                ? `Entrega ${marcada.unidades.toLocaleString("es-AR")}${marcada.fecha ? ` · ${diaCorto(marcada.fecha)}` : ""}`
                : `Entrega parcial: ${marcada.unidades.toLocaleString("es-AR")} de ${faltan.toLocaleString("es-AR")}${marcada.fecha ? ` · ${diaCorto(marcada.fecha)}` : ""}`}
            {pendiente && <span className="font-normal text-amber-700">· sin calcular</span>}
        </button>
    ) : variante === "tarjeta" ? (
        <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            className="h-8 border-sky-300 text-sky-800 hover:bg-sky-50"
            title="Fabricar en este plan sólo una parte de las piezas"
        >
            <PackageCheck className="mr-1 h-3.5 w-3.5" />
            Entrega parcial
        </Button>
    ) : (
        <button
            type="button"
            disabled={disabled}
            className="text-[10.5px] text-sky-700/80 hover:text-sky-900 hover:underline underline-offset-2 disabled:opacity-60"
            title="Fabricar en este plan sólo una parte de las piezas"
        >
            Entrega parcial
        </button>
    );

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                {disparador}
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-80 p-0"
                onClick={(e) => e.stopPropagation()}
            >
                <form
                    onSubmit={(e) => { e.preventDefault(); marcar(); }}
                    className="flex flex-col gap-3 p-4"
                >
                    <div>
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                            <PackageCheck className="h-4 w-4 text-sky-600" />
                            Entrega parcial · OT #{numero}
                        </div>
                        <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                            El plan fabrica sólo estas piezas. Lo que sobra queda para el próximo plan.
                        </p>
                    </div>

                    <div className="flex flex-col gap-1">
                        <Label htmlFor={`entrega-piezas-${numero}`} className="text-xs text-gray-700">Piezas para esta entrega</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id={`entrega-piezas-${numero}`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={Math.max(1, faltan - 1)}
                                autoFocus
                                value={piezas}
                                onChange={(e) => setPiezas(e.target.value)}
                                className="h-8 w-24 text-sm tabular-nums"
                                placeholder="Ej: 24"
                            />
                            <span className="text-xs text-gray-500">de {faltan.toLocaleString("es-AR")} que faltan</span>
                        </div>
                        {error && <p className="text-[11px] text-red-600">{error}</p>}
                    </div>

                    <div className="flex flex-col gap-1">
                        <Label htmlFor={`entrega-fecha-${numero}`} className="text-xs text-gray-700">
                            Para cuándo <span className="font-normal text-gray-400">(opcional)</span>
                        </Label>
                        <Input
                            id={`entrega-fecha-${numero}`}
                            type="date"
                            value={fecha}
                            onChange={(e) => setFecha(e.target.value)}
                            className="h-8 w-40 text-sm"
                        />
                        <p className="text-[11px] text-gray-500">
                            {fecha
                                ? "El plan apunta a tenerlas ese día en vez de la fecha prometida."
                                : prometidaTexto
                                    ? `Sin fecha vale la prometida de la OT (${prometidaTexto}).`
                                    : "Sin fecha, el plan las hace lo antes que pueda."}
                        </p>
                    </div>

                    <p className="rounded-md bg-gray-50 px-2.5 py-2 text-[11px] text-gray-600 leading-relaxed">
                        Se achica la producción a esas piezas; las preparaciones y programaciones
                        van enteras. Vale para este plan nomás: la OT no cambia. Se aplica al recalcular.
                    </p>

                    <div className="flex items-center justify-between gap-2">
                        {marcada ? (
                            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs text-gray-600" onClick={quitar}>
                                Planificar la OT entera
                            </Button>
                        ) : <span />}
                        <div className="flex gap-2">
                            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setAbierto(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" size="sm" className="h-8 bg-sky-600 hover:bg-sky-700 text-white" disabled={!valida}>
                                Marcar
                            </Button>
                        </div>
                    </div>
                </form>
            </PopoverContent>
        </Popover>
    );
}
