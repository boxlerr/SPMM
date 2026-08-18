"use client";

/**
 * Qué traba este plan y cómo se destraba.
 *
 * Tercera pasada de diseño. La primera eran cajas anidadas con párrafos ("marea
 * tanto texto" — Lucas); la segunda comprimió todo a líneas de 11px grises y un
 * solo item abierto a la vez, y Julián la devolvió: "me marea que esté todo en
 * gris y tan chiquito, y si abro una se cierra otra". Esta versión:
 *
 *  - Cada línea abre y cierra POR SU CUENTA (Set de abiertos, no un único id).
 *  - Texto a 14px con jerarquía real: título oscuro, etiqueta traba/aviso con
 *    color, detalle legible. El gris clarito queda solo para lo accesorio.
 *  - El encabezado dice qué significa cada color, porque "2 trabas" solo no
 *    le decía nada a nadie.
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, Info, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Resalta lo que viene entre **dobles asteriscos** desde el backend.
 *
 * Los avisos nombran máquinas, rangos, personas y fechas — los datos que hay que
 * ir a tocar — y en un párrafo plano se pierden. El backend los marca y acá se
 * dibujan en negrita. No es Markdown: solo negritas, que es lo único que hace
 * falta y lo único que no puede romper nada.
 */
function conNegritas(texto: string) {
    return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
        parte.startsWith("**") && parte.endsWith("**") && parte.length > 4 ? (
            <strong key={i} className="font-semibold text-gray-900">{parte.slice(2, -2)}</strong>
        ) : (
            parte
        )
    );
}

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

    if (items.length === 0) return null;

    const toggle = (id: string) =>
        setAbiertos((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const hayBloqueantes = bloqueantes.length > 0;
    const resumenHeader = [
        bloqueantes.length > 0 && `${bloqueantes.length} ${bloqueantes.length === 1 ? "traba" : "trabas"}`,
        avisos.length > 0 && `${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"}`,
    ].filter(Boolean).join(" y ");

    return (
        <div className="mx-4 mt-4 mb-2 rounded-lg border bg-white overflow-hidden">
            <button
                type="button"
                aria-expanded={!colapsado}
                onClick={() => setColapsado((c) => !c)}
                className={cn(
                    "w-full px-4 py-2.5 flex items-center gap-2.5 text-left transition-colors",
                    hayBloqueantes ? "bg-rose-50/70 hover:bg-rose-50" : "bg-amber-50/60 hover:bg-amber-50"
                )}
            >
                {hayBloqueantes ? (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                ) : (
                    <Info className="w-4 h-4 text-amber-500 shrink-0" />
                )}
                <span className="text-sm font-semibold text-gray-900">{resumenHeader}</span>
                <span className="text-[13px] text-gray-600 hidden sm:inline truncate">
                    {hayBloqueantes
                        ? "— lo rojo quedó sin resolver en el plan; tocá la línea para ver cómo se arregla"
                        : "— el plan sale igual; tocá cada línea para el detalle"}
                </span>
                <span className="flex-1" />
                <ChevronDown
                    className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform", colapsado && "-rotate-90")}
                />
            </button>

            {!colapsado && (
                <ul className="divide-y border-t">
                    {[...bloqueantes, ...avisos].map((d) => {
                        const activo = abiertos.has(d.id);
                        const esBloq = d.severidad === "bloqueante";
                        return (
                            <li key={d.id} className={cn(activo && "bg-slate-50/60")}>
                                <button
                                    type="button"
                                    aria-expanded={activo}
                                    onClick={() => toggle(d.id)}
                                    className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors"
                                >
                                    <span
                                        className={cn(
                                            // amber-700 y no 600: a 11px el 600 sobre blanco no
                                            // llega al contraste AA y era ilegible — justo lo
                                            // que este rediseño vino a arreglar.
                                            "text-[11px] font-semibold uppercase tracking-wide shrink-0 w-11",
                                            esBloq ? "text-rose-600" : "text-amber-700"
                                        )}
                                    >
                                        {esBloq ? "Traba" : "Aviso"}
                                    </span>
                                    <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
                                        {d.titulo}
                                    </span>
                                    <span
                                        className="hidden sm:inline-flex items-center rounded-full bg-slate-100 text-slate-600 text-xs px-2 py-0.5 tabular-nums shrink-0"
                                        title={`OTs: ${d.impacto.ots.map((n) => `#${n}`).join(", ")}`}
                                    >
                                        {d.impacto.resumen}
                                    </span>
                                    <ChevronDown
                                        className={cn(
                                            "w-4 h-4 text-gray-400 shrink-0 transition-transform",
                                            activo && "rotate-180"
                                        )}
                                    />
                                </button>

                                {activo && (
                                    <div className="px-4 pb-3.5 pl-[4.25rem] space-y-2.5">
                                        <p className="text-sm text-gray-700 leading-relaxed max-w-[80ch]">
                                            {conNegritas(d.detalle)}
                                        </p>
                                        {d.soluciones.length > 0 && (
                                            <div className="space-y-1.5">
                                                {d.soluciones.map((s, i) => (
                                                    <div key={i} className="flex items-start gap-2 text-sm">
                                                        <Wrench className="w-3.5 h-3.5 mt-[3px] shrink-0 text-emerald-600" />
                                                        <span className="text-gray-800 leading-relaxed">
                                                            {conNegritas(s.texto)}{" "}
                                                            <span className="inline-block rounded bg-slate-100 text-slate-600 text-xs px-1.5 py-px whitespace-nowrap align-baseline">
                                                                {s.donde}
                                                            </span>
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <p className="text-xs text-gray-500">
                                            {/* En mobile el chip del resumen no entra en la fila,
                                                así que acá es el único lugar donde se ve. */}
                                            <span className="sm:hidden">
                                                {d.impacto.resumen}
                                                {d.impacto.ots.length > 0 ? " — " : ""}
                                            </span>
                                            {d.impacto.ots.length > 0 && (
                                                <>OTs: {d.impacto.ots.map((n) => `#${n}`).join(", ")}</>
                                            )}
                                        </p>
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
