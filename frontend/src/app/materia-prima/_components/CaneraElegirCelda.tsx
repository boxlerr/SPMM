"use client";

/**
 * Elegir un casillero de la cañera: para «Ubicar» una OT desde Pendientes y para
 * «Mover a…» desde la grilla.
 *
 * Una grilla chiquita con los 135 casilleros (A..O × 1..9): los libres, en blanco y a
 * un toque; los ocupados, en gris con su número. Los ocupados también se pueden tocar
 * —«avisar, no bloquear»—: el backend contesta que ahí está la OT tal y la persona
 * decide si la desplaza. Y para el que ya sabe adónde va, un campo donde se escribe
 * «E4» y Enter.
 *
 * El primer libre queda sugerido (con borde azul): en el taller se llena de arriba a la
 * izquierda, y Enter en el campo vacío lo toma.
 */

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
    COLUMNAS_CANERA,
    FILAS_CANERA,
    armarCelda,
    normalizarCelda,
    numeroDeOcupacion,
    type Canera,
} from "@/lib/materiaPrima";
import { ocupacionesPorCelda } from "./CaneraDatos";

export interface CaneraElegirCeldaProps {
    canera: Canera | null;
    onElegir: (celda: string) => void;
    /** El casillero de donde sale (al mover): se marca y no se ofrece. */
    desde?: string | null;
    /** Qué dice arriba («Ubicar la OT 15692»). */
    titulo?: string;
    ocupado?: boolean;
}

export function CaneraElegirCelda({ canera, onElegir, desde, titulo, ocupado = false }: CaneraElegirCeldaProps) {
    const [texto, setTexto] = useState("");
    const porCelda = useMemo(() => ocupacionesPorCelda(canera), [canera]);

    const sugerida = useMemo(() => {
        for (const col of COLUMNAS_CANERA) {
            for (const f of FILAS_CANERA) {
                const c = armarCelda(col, f);
                if (c !== desde && !porCelda.has(c)) return c;
            }
        }
        return null;
    }, [porCelda, desde]);

    const escrita = normalizarCelda(texto);
    const elegir = (c: string | null) => {
        if (!c || ocupado) return;
        onElegir(c);
    };

    return (
        <div className="space-y-2">
            {titulo && <p className="text-xs font-semibold text-gray-700">{titulo}</p>}
            <div className="flex items-center gap-2">
                <input
                    autoFocus
                    value={texto}
                    onChange={(e) => setTexto(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            elegir(texto.trim() ? escrita : sugerida);
                        }
                    }}
                    placeholder={sugerida ? `Casillero (Enter = ${sugerida})` : "Casillero, p. ej. E4"}
                    maxLength={3}
                    className={cn(
                        "h-8 w-full min-w-0 rounded-md border px-2 text-sm uppercase outline-none placeholder:normal-case focus:ring-2",
                        texto && !escrita
                            ? "border-rose-300 focus:ring-rose-200"
                            : "border-gray-200 focus:border-blue-400 focus:ring-blue-100",
                    )}
                    aria-label="Casillero"
                    autoComplete="off"
                    spellCheck={false}
                />
                <button
                    type="button"
                    disabled={ocupado || (texto.trim() ? !escrita : !sugerida)}
                    onClick={() => elegir(texto.trim() ? escrita : sugerida)}
                    className="h-8 shrink-0 rounded-md bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                    Ubicar
                </button>
            </div>
            {texto && !escrita && (
                <p className="text-[11px] text-rose-600">Una letra de la A a la O y un número del 1 al 9.</p>
            )}

            <div className="overflow-x-auto">
                <div
                    className="grid gap-[3px]"
                    style={{ gridTemplateColumns: `0.9rem repeat(${COLUMNAS_CANERA.length}, minmax(1.25rem, 1fr))` }}
                >
                    <div />
                    {COLUMNAS_CANERA.map((c) => (
                        <div key={c} className="text-center text-[9px] font-bold text-gray-400">{c}</div>
                    ))}
                    {FILAS_CANERA.map((f) => (
                        <Fila key={f} fila={f}>
                            {COLUMNAS_CANERA.map((col) => {
                                const celda = armarCelda(col, f);
                                const ocs = porCelda.get(celda);
                                const esDesde = celda === desde;
                                const esSugerida = celda === sugerida;
                                const esEscrita = celda === escrita;
                                return (
                                    <button
                                        key={celda}
                                        type="button"
                                        disabled={esDesde || ocupado}
                                        onClick={() => elegir(celda)}
                                        title={
                                            esDesde
                                                ? `${celda}: de acá sale`
                                                : ocs?.length
                                                    ? `${celda}: ocupado por la OT ${ocs.map(numeroDeOcupacion).join(", ")}. Si lo elegís, te pregunta antes de desplazarla.`
                                                    : `${celda}: libre`
                                        }
                                        className={cn(
                                            "h-6 rounded-[3px] border text-[8px] font-semibold leading-none tabular-nums transition-colors",
                                            esDesde
                                                ? "border-blue-400 bg-blue-100 text-blue-700"
                                                : ocs?.length
                                                    ? "border-gray-300 bg-gray-200 text-gray-500 hover:bg-gray-300"
                                                    : "border-gray-200 bg-white text-transparent hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700",
                                            esSugerida && !esEscrita && "ring-1 ring-blue-400",
                                            esEscrita && "ring-2 ring-blue-600",
                                        )}
                                    >
                                        {esDesde ? "•" : ocs?.length ? String(numeroDeOcupacion(ocs[0])).slice(-3) : celda}
                                    </button>
                                );
                            })}
                        </Fila>
                    ))}
                </div>
            </div>
            <p className="text-[10px] text-gray-400">
                Blanco = libre · gris = ocupado (muestra las últimas cifras de la OT).
            </p>
        </div>
    );
}

function Fila({ fila, children }: { fila: number; children: ReactNode }) {
    return (
        <>
            <div className="flex items-center justify-center text-[9px] font-bold text-gray-400">{fila}</div>
            {children}
        </>
    );
}
