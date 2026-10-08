"use client";

/**
 * Los feriados de un período, cada uno con «No se trabaja / Se trabaja».
 *
 * Julián, 8/10/2026: «automatizalo de alguna forma el tema de los feriados en argentina y
 * que lo muestre al momento de planificar si quiere elegirlo o no». Los feriados los trae
 * el backend solo; acá se ven en el selector de fechas del plan (el que sale SIEMPRE al
 * tocar Planificar) y en «Configurar feriados». Elegir se ve al toque y se revierte si el
 * servidor no lo guarda: nada de recargar la pantalla.
 */

import React from "react";
import { CalendarOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { diaCorto } from "@/lib/estimarPlan";
import {
    bloqueaFeriado, elegirFeriado, pedirFeriados, textoDelTipo, type Feriado,
} from "@/lib/feriados";

/**
 * Los feriados desde `desde`, y elegir si se trabaja uno. `onBloqueados` recibe los días
 * que el planificador saltea cada vez que cambian, para que la pantalla que lo usa
 * cuente con los mismos días que el backend.
 */
export function useFeriadosDelPais(
    activo: boolean,
    desde: string,
    onBloqueados?: (bloqueados: string[]) => void,
) {
    const [feriados, setFeriados] = React.useState<Feriado[] | null>(null);
    const [guardando, setGuardando] = React.useState<ReadonlySet<string>>(new Set());
    const avisar = React.useRef(onBloqueados);
    avisar.current = onBloqueados;

    React.useEffect(() => {
        if (!activo) return;
        let vigente = true;
        pedirFeriados(desde).then(r => {
            if (!vigente || !r) return;
            setFeriados(r.feriados);
            avisar.current?.(r.bloqueados);
        });
        return () => { vigente = false; };
    }, [activo, desde]);

    const elegir = React.useCallback(async (f: Feriado, seTrabaja: boolean) => {
        const antes = f;
        const ahora: Feriado = { ...f, se_trabaja: seTrabaja, bloquea: bloqueaFeriado(f.tipo, seTrabaja) };
        setFeriados(prev => prev?.map(x => (x.fecha === f.fecha ? ahora : x)) ?? prev);
        setGuardando(prev => new Set(prev).add(f.fecha));
        const r = await elegirFeriado(f.fecha, seTrabaja);
        setGuardando(prev => {
            const s = new Set(prev);
            s.delete(f.fecha);
            return s;
        });
        if (!r) {
            setFeriados(prev => prev?.map(x => (x.fecha === f.fecha ? antes : x)) ?? prev);
            toast.error("No se pudo guardar", { description: `${diaCorto(f.fecha)}: quedó como estaba.` });
            return;
        }
        setFeriados(prev => prev?.map(x => (x.fecha === f.fecha ? r.feriado : x)) ?? prev);
        avisar.current?.(r.bloqueados);
    }, []);

    return { feriados, guardando, elegir };
}

interface ListaFeriadosProps {
    feriados: Feriado[];
    guardando: ReadonlySet<string>;
    onElegir: (f: Feriado, seTrabaja: boolean) => void;
    /** Lo que se dice arriba de la lista. */
    titulo?: React.ReactNode;
    className?: string;
}

export function ListaFeriados({ feriados, guardando, onElegir, titulo, className }: ListaFeriadosProps) {
    if (feriados.length === 0) return null;
    return (
        <div className={cn("space-y-1.5", className)}>
            {titulo && (
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
                    <CalendarOff className="h-3.5 w-3.5 text-rose-400" />
                    {titulo}
                </p>
            )}
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {feriados.map(f => {
                    const seTrabaja = !f.bloquea;
                    const ocupado = guardando.has(f.fecha);
                    return (
                        <li key={f.fecha} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                            <div className="min-w-0 flex-1">
                                <p className="text-[13px] leading-snug text-slate-800">
                                    <span className="font-semibold capitalize">{diaCorto(f.fecha)}</span>
                                    <span className="text-slate-400"> · </span>
                                    <span>{f.nombre}</span>
                                </p>
                                <p className="text-[11px] text-slate-500">
                                    {textoDelTipo(f.tipo)}
                                    {f.tipo === "puente" && " (optativo)"}
                                    {f.se_trabaja !== null && f.decidido_por && <> · lo eligió {f.decidido_por}</>}
                                </p>
                            </div>
                            <div
                                role="radiogroup"
                                aria-label={`¿Se trabaja el ${diaCorto(f.fecha)}?`}
                                className={cn(
                                    "inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-[12px] font-medium transition-opacity",
                                    ocupado && "opacity-60",
                                )}
                            >
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={!seTrabaja}
                                    disabled={ocupado}
                                    onClick={() => seTrabaja && onElegir(f, false)}
                                    className={cn(
                                        "rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                                        !seTrabaja ? "bg-white text-rose-700 shadow-sm" : "text-slate-500 hover:text-slate-800",
                                    )}
                                >
                                    No se trabaja
                                </button>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={seTrabaja}
                                    disabled={ocupado}
                                    onClick={() => !seTrabaja && onElegir(f, true)}
                                    className={cn(
                                        "rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                                        seTrabaja ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-800",
                                    )}
                                >
                                    Se trabaja
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
