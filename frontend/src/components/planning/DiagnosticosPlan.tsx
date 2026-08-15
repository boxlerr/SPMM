"use client";

/**
 * Qué traba este plan y cómo se destraba.
 *
 * La primera versión era una tarjeta grande con cajas anidadas y párrafos: Lucas
 * lo dijo directo — "marea tanto texto". Esta es la versión legible: cada aviso es
 * UNA línea (punto de color + título + impacto), y el detalle aparece recién al
 * tocarla. Las soluciones son una línea cada una con el lugar donde se hacen.
 *
 * Lo que bloquea va arriba; los avisos abajo. Nada arranca expandido: la lista
 * entera se tiene que poder barrer de un vistazo.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
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

    const [abierto, setAbierto] = useState<string | null>(null);
    const [colapsado, setColapsado] = useState(false);

    if (items.length === 0) return null;

    const hayBloqueantes = bloqueantes.length > 0;
    const resumenHeader = [
        bloqueantes.length > 0 && `${bloqueantes.length} ${bloqueantes.length === 1 ? "traba" : "trabas"}`,
        avisos.length > 0 && `${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"}`,
    ].filter(Boolean).join(" · ");

    return (
        <div className="mx-4 mt-4 mb-2 rounded-lg border bg-white overflow-hidden">
            <button
                type="button"
                onClick={() => setColapsado((c) => !c)}
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40 transition-colors"
            >
                <span className={cn("w-2 h-2 rounded-full shrink-0", hayBloqueantes ? "bg-rose-500" : "bg-amber-400")} />
                <span className="text-sm font-semibold text-gray-800">{resumenHeader}</span>
                <span className="text-xs text-gray-500 hidden sm:inline">
                    {hayBloqueantes ? "— lo marcado en rojo no lo va a hacer nadie" : "— nada impide guardar"}
                </span>
                <span className="flex-1" />
                {colapsado ? (
                    <ChevronRight className="w-4 h-4 opacity-50" />
                ) : (
                    <ChevronDown className="w-4 h-4 opacity-50" />
                )}
            </button>

            {!colapsado && (
                <ul className="divide-y border-t">
                    {[...bloqueantes, ...avisos].map((d) => {
                        const activo = abierto === d.id;
                        const esBloq = d.severidad === "bloqueante";
                        return (
                            <li key={d.id}>
                                <button
                                    type="button"
                                    onClick={() => setAbierto(activo ? null : d.id)}
                                    className={cn(
                                        "w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors",
                                        activo ? "bg-muted/40" : "hover:bg-muted/30"
                                    )}
                                >
                                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", esBloq ? "bg-rose-500" : "bg-amber-400")} />
                                    <span className="text-[13px] text-gray-800 truncate">{d.titulo}</span>
                                    <span className="flex-1" />
                                    <span className="text-[11px] text-gray-400 tabular-nums shrink-0" title={`OTs: ${d.impacto.ots.join(", ")}`}>
                                        {d.impacto.resumen}
                                    </span>
                                    {activo ? (
                                        <ChevronDown className="w-3.5 h-3.5 opacity-40 shrink-0" />
                                    ) : (
                                        <ChevronRight className="w-3.5 h-3.5 opacity-40 shrink-0" />
                                    )}
                                </button>

                                {activo && (
                                    <div className="px-3 pb-2.5 pl-7 space-y-1.5">
                                        <p className="text-xs text-gray-600 leading-relaxed">{d.detalle}</p>
                                        {d.soluciones.map((s, i) => (
                                            <p key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                                                <Wrench className="w-3 h-3 mt-0.5 shrink-0 text-emerald-600" />
                                                <span>
                                                    {s.texto}{" "}
                                                    <span className="text-gray-400">· {s.donde}</span>
                                                </span>
                                            </p>
                                        ))}
                                        {d.impacto.ots.length > 0 && (
                                            <p className="text-[11px] text-gray-400">OTs: {d.impacto.ots.join(", ")}</p>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
