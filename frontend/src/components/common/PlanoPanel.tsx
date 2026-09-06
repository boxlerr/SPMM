"use client";

import React from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatearBytes, type Plano } from "@/lib/planos";
import { PlanoThumb } from "./PlanoThumb";
import { FileViewerModal } from "./FileViewerModal";

interface PlanoPanelProps {
    planos: Plano[];
    cargando?: boolean;
    /** Encabezado de la columna. Por defecto, "Planos". */
    titulo?: string;
    /** Qué decir cuando no hay ninguno. */
    vacioTexto?: string;
    className?: string;
    /** Tarjetas más chicas, para cuando el panel va en una columna angosta. */
    compacto?: boolean;
}

/**
 * La columna de planos, pensada para ir AL LADO de la carga de procesos y no encima.
 *
 * Quien carga los pasos de una orden está leyendo el plano mientras lo hace: si el
 * plano se abre en un modal que tapa la pantalla, la cuenta la tiene que hacer de
 * memoria. Por eso la miniatura vive al costado, siempre visible, y el modal aparece
 * solo cuando hace falta mirar el detalle.
 */
export const PlanoPanel = ({
    planos,
    cargando = false,
    titulo = "Planos",
    vacioTexto = "Todavía no hay planos cargados.",
    className,
    compacto = false,
}: PlanoPanelProps) => {
    const [abierto, setAbierto] = React.useState<number | null>(null);

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Paperclip className="w-3 h-3" />
                    {titulo}
                    {!cargando && planos.length > 0 && (
                        <span className="text-gray-400 font-normal ml-0.5">({planos.length})</span>
                    )}
                </h4>
            </div>

            {cargando ? (
                <div className={cn("grid gap-3", compacto ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
                    {[0, 1].map((i) => (
                        <div key={i} className="rounded-xl border border-gray-200 bg-white p-2 animate-pulse">
                            <div className={cn("w-full bg-slate-100 rounded-lg", compacto ? "h-16" : "h-24")} />
                            <div className="h-2.5 w-3/4 bg-slate-100 rounded mt-2" />
                        </div>
                    ))}
                </div>
            ) : planos.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-4 py-6 text-center">
                    <p className="text-[11px] text-gray-400">{vacioTexto}</p>
                </div>
            ) : (
                <div className={cn("grid gap-3", compacto ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
                    {planos.map((plano, i) => {
                        const delProducto = plano.origen === "articulo";
                        return (
                            <button
                                key={plano.id}
                                type="button"
                                onClick={() => setAbierto(i)}
                                title={`Ver ${plano.nombre}`}
                                className="text-left p-2 rounded-xl border border-gray-200 bg-white shadow-sm hover:border-blue-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                            >
                                <PlanoThumb
                                    plano={plano}
                                    className={cn("border-slate-100", compacto ? "h-16" : "h-24")}
                                />
                                <div className="mt-2 min-w-0">
                                    <p
                                        className={cn(
                                            "font-bold text-gray-700 truncate",
                                            compacto ? "text-[10px]" : "text-xs"
                                        )}
                                    >
                                        {plano.nombre}
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <span
                                            className={cn(
                                                "text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap",
                                                delProducto
                                                    ? "bg-indigo-50 text-indigo-600"
                                                    : "bg-slate-100 text-slate-500"
                                            )}
                                        >
                                            {delProducto ? "Del producto" : "De esta orden"}
                                        </span>
                                        {!compacto && plano.bytes != null && (
                                            <span className="text-[9px] text-gray-400 whitespace-nowrap">
                                                {formatearBytes(plano.bytes)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            <FileViewerModal
                isOpen={abierto !== null}
                onClose={() => setAbierto(null)}
                file={abierto !== null ? planos[abierto] ?? null : null}
                planos={planos}
                indice={abierto ?? 0}
                onIndiceChange={setAbierto}
            />
        </div>
    );
};
