"use client";

import React from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { NOVEDADES, TIPO_META, formatFechaNovedad, novedadesOrdenadas, type NovedadTipo } from "@/lib/novedades";
import { cn } from "@/lib/utils";

/**
 * El historial de novedades del sistema: todo lo que fue cambiando, de lo más
 * nuevo a lo más viejo. Es para el que estuvo de vacaciones o el que quiere
 * buscar cuándo cambió algo que hoy no reconoce.
 */
export default function NovedadesPage() {
    const [filtro, setFiltro] = React.useState<"todas" | NovedadTipo>("todas");

    const items = novedadesOrdenadas(NOVEDADES).filter(n => filtro === "todas" || n.tipo === filtro);

    // Agrupadas por fecha para que se lea como una línea de tiempo y no como
    // una lista suelta de renglones.
    const porFecha = items.reduce((acc, n) => {
        (acc[n.fecha] ||= []).push(n);
        return acc;
    }, {} as Record<string, typeof items>);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            <div className="w-full px-2 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-8 space-y-4">
                {/* Header */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-100 rounded-lg">
                            <Sparkles className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Novedades</h1>
                            <p className="text-sm text-gray-500">
                                Todo lo que fue cambiando en el sistema, de lo más nuevo a lo más viejo
                            </p>
                        </div>
                    </div>

                    {/* Filtro por tipo */}
                    <div className="mt-4 flex flex-wrap items-center gap-1.5">
                        {([
                            ["todas", "Todas"],
                            ["nuevo", "Nuevo"],
                            ["mejora", "Mejoras"],
                            ["arreglo", "Arreglos"],
                        ] as const).map(([valor, label]) => (
                            <button
                                key={valor}
                                onClick={() => setFiltro(valor)}
                                className={cn(
                                    "px-3 py-1 rounded-md text-xs font-semibold border transition-colors",
                                    filtro === valor
                                        ? "bg-red-600 text-white border-red-600"
                                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Línea de tiempo */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
                    {items.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-10">
                            No hay novedades de ese tipo todavía.
                        </p>
                    ) : (
                        <div className="space-y-8">
                            {Object.entries(porFecha).map(([fecha, novedades]) => (
                                <section key={fecha}>
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                                        {formatFechaNovedad(fecha)}
                                    </h2>
                                    <ul className="space-y-3 border-l-2 border-gray-100 pl-4 sm:pl-5">
                                        {novedades.map(n => {
                                            const meta = TIPO_META[n.tipo];
                                            return (
                                                <li key={n.id} className="relative">
                                                    {/* Punto de la línea de tiempo */}
                                                    <span
                                                        className={cn(
                                                            "absolute -left-[22px] sm:-left-[26px] top-2 h-2.5 w-2.5 rounded-full ring-4 ring-white",
                                                            meta.dot
                                                        )}
                                                    />
                                                    <div className="rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition-all p-3.5">
                                                        <div className="flex items-start justify-between gap-3 flex-wrap">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className={cn("text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border", meta.cls)}>
                                                                        {meta.label}
                                                                    </span>
                                                                    <span className="text-[11px] font-medium text-gray-400">{n.seccion}</span>
                                                                </div>
                                                                <h3 className="font-bold text-gray-900 mt-1.5 leading-snug">{n.titulo}</h3>
                                                                {n.detalle && (
                                                                    <p className="text-sm text-gray-600 mt-1 leading-relaxed">{n.detalle}</p>
                                                                )}
                                                            </div>
                                                            {n.href && (
                                                                <Link
                                                                    href={n.href}
                                                                    className="shrink-0 text-xs font-semibold text-red-600 hover:text-red-700 hover:underline flex items-center gap-1"
                                                                >
                                                                    Ir <ArrowRight className="w-3 h-3" />
                                                                </Link>
                                                            )}
                                                        </div>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </section>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
