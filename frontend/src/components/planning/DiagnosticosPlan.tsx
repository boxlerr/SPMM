"use client";

/**
 * Qué traba este plan y cómo se destraba.
 *
 * El planificador siempre devolvió un resultado; lo que no podía asignar salía como
 * "sin asignar" o "sin máquina" y el motivo quedaba en los logs del servidor. Desde
 * la pantalla era imposible distinguir "falta cargar un rango" de "hay una sola
 * máquina para dos semanas de trabajo", que se arreglan de maneras opuestas.
 *
 * Decisiones de la vista:
 *  - Lo que BLOQUEA va arriba y abierto; lo que es aviso va abajo y cerrado. Si hay
 *    siete cosas, el usuario tiene que poder leer las dos que importan sin scrollear.
 *  - Cada ítem dice a cuánto trabajo afecta. Sin eso no se puede priorizar: no es lo
 *    mismo un proceso de 1 minuto que seis jornadas de torno.
 *  - Las soluciones van numeradas y con la pantalla donde se hacen. Son opciones, no
 *    pasos de un instructivo: la primera suele ser la más barata, pero cuál conviene
 *    lo sabe el taller.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Info, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface DiagnosticoSolucion {
    texto: string;
    donde: string;
}

export interface Diagnostico {
    id: string;
    tipo: string;
    severidad: "bloqueante" | "advertencia";
    titulo: string;
    detalle: string;
    impacto: {
        procesos: number;
        ots: number[];
        minutos: number;
        resumen: string;
    };
    soluciones: DiagnosticoSolucion[];
}

export function DiagnosticosPlan({ diagnosticos }: { diagnosticos?: Diagnostico[] }) {
    const items = diagnosticos ?? [];
    const bloqueantes = items.filter((d) => d.severidad === "bloqueante");
    const avisos = items.filter((d) => d.severidad !== "bloqueante");

    const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
    const [colapsado, setColapsado] = useState(false);

    // El primer bloqueante arranca abierto para que se vea de entrada el detalle y el
    // "cómo se arregla"; el resto queda en una línea, que es lo que hace que la lista
    // se pueda barrer de un vistazo.
    //
    // Va en un efecto y no en el estado inicial porque el modal se monta ANTES de que
    // llegue la respuesta del planificador: en el primer render `diagnosticos` está
    // vacío, así que calcularlo ahí dejaba todo cerrado para siempre.
    const claves = items.map((d) => d.id).join("|");
    useEffect(() => {
        setAbiertos(new Set(bloqueantes.slice(0, 1).map((d) => d.id)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claves]);

    if (items.length === 0) return null;

    const toggle = (id: string) =>
        setAbiertos((prev) => {
            const s = new Set(prev);
            s.has(id) ? s.delete(id) : s.add(id);
            return s;
        });

    const hayBloqueantes = bloqueantes.length > 0;

    return (
        <div
            className={cn(
                "m-4 rounded-lg border-2 overflow-hidden shadow-sm",
                hayBloqueantes ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50"
            )}
        >
            <button
                type="button"
                onClick={() => setColapsado((c) => !c)}
                className={cn(
                    "w-full px-4 py-3 flex items-start gap-3 text-left transition-colors",
                    hayBloqueantes ? "bg-rose-100/70 hover:bg-rose-100" : "bg-amber-100/70 hover:bg-amber-100"
                )}
            >
                <AlertTriangle
                    className={cn("w-5 h-5 mt-0.5 shrink-0", hayBloqueantes ? "text-rose-700" : "text-amber-700")}
                />
                <div className="flex-1 min-w-0">
                    <div className={cn("font-semibold text-sm", hayBloqueantes ? "text-rose-900" : "text-amber-900")}>
                        {hayBloqueantes
                            ? `${bloqueantes.length} ${bloqueantes.length === 1 ? "cosa traba" : "cosas traban"} este plan`
                            : `${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"} sobre este plan`}
                        {hayBloqueantes && avisos.length > 0 && (
                            <span className="font-normal"> · {avisos.length} aviso(s) más</span>
                        )}
                    </div>
                    <div className={cn("text-xs mt-0.5", hayBloqueantes ? "text-rose-800" : "text-amber-800")}>
                        {hayBloqueantes
                            ? "El plan se puede guardar igual, pero eso que falta no lo va a hacer nadie. Cada uno dice cómo se arregla."
                            : "Nada impide guardar el plan. Son cosas para mirar cuando puedas."}
                    </div>
                </div>
                {colapsado ? (
                    <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />
                ) : (
                    <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />
                )}
            </button>

            {!colapsado && (
                <div className="divide-y divide-black/5 bg-white/60">
                    {[...bloqueantes, ...avisos].map((d) => {
                        const abierto = abiertos.has(d.id);
                        const esBloqueante = d.severidad === "bloqueante";
                        return (
                            <div key={d.id} className="px-4 py-3">
                                <button
                                    type="button"
                                    onClick={() => toggle(d.id)}
                                    className="w-full flex items-start gap-2.5 text-left group"
                                >
                                    {esBloqueante ? (
                                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
                                    ) : (
                                        <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="text-sm font-semibold text-gray-900 group-hover:underline">
                                                {d.titulo}
                                            </span>
                                            <Badge
                                                variant="outline"
                                                className="shrink-0 text-[11px] font-normal bg-white text-gray-600"
                                                title={`OTs afectadas: ${d.impacto.ots.join(", ")}`}
                                            >
                                                {d.impacto.resumen}
                                            </Badge>
                                        </div>
                                        {!abierto && (
                                            <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">{d.detalle}</p>
                                        )}
                                    </div>
                                    {abierto ? (
                                        <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 opacity-50" />
                                    ) : (
                                        <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 opacity-50" />
                                    )}
                                </button>

                                {abierto && (
                                    <div className="mt-2 ml-6.5 pl-0.5 space-y-2.5">
                                        <p className="text-xs text-gray-700 leading-relaxed">{d.detalle}</p>

                                        {d.soluciones.length > 0 && (
                                            <div className="rounded-md border border-gray-200 bg-white p-3">
                                                <div className="flex items-center gap-1.5 mb-2">
                                                    <Wrench className="w-3.5 h-3.5 text-emerald-700" />
                                                    <span className="text-xs font-semibold text-emerald-800">
                                                        Cómo se arregla
                                                    </span>
                                                </div>
                                                <ol className="space-y-2">
                                                    {d.soluciones.map((s, i) => (
                                                        <li key={i} className="flex gap-2 text-xs text-gray-700">
                                                            <span className="shrink-0 w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold flex items-center justify-center mt-px">
                                                                {i + 1}
                                                            </span>
                                                            <span className="flex-1 leading-relaxed">
                                                                {s.texto}
                                                                <Badge
                                                                    variant="outline"
                                                                    className="ml-1.5 align-middle text-[10px] font-normal bg-gray-50 text-gray-600"
                                                                >
                                                                    {s.donde}
                                                                </Badge>
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ol>
                                            </div>
                                        )}

                                        {d.impacto.ots.length > 0 && (
                                            <p className="text-[11px] text-gray-500">
                                                OTs afectadas: {d.impacto.ots.join(", ")}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
