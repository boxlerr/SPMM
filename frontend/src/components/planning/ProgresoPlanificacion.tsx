"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, Database, Save, Search } from "lucide-react";

import { Progress } from "@/components/ui/progress";

/**
 * Lo que se ve mientras el planificador calcula.
 *
 * Antes era un toast con "Calculando planificación..." y un spinner: en un lote de
 * 34 OTs eso son varios minutos sin una sola señal de si avanza, si se colgó o si
 * falta poco. Lucas planifica 35–40 OTs por semana de una sola vez, así que ese
 * rato es la operación normal, no un caso raro.
 *
 * IMPORTANTE, para el que venga después: el porcentaje es una ESTIMACIÓN por tiempo
 * transcurrido, no un dato que mande el servidor. El solver no puede decir "voy por
 * el 60%" —busca hasta que se le acaba el presupuesto o hasta que deja de mejorar—,
 * y la única forma de que el número fuera real sería que el backend transmitiera el
 * avance durante el request. Por eso:
 *
 *  - la barra NUNCA llega sola al 100%: se frena en 92% y ahí espera. El 100% lo
 *    pone la respuesta del servidor. Una barra que se planta en 100% y sigue
 *    girando miente peor que un spinner;
 *  - abajo va el tiempo REAL transcurrido, que sí es un dato y es el que sirve para
 *    saber si algo se colgó;
 *  - los nombres de las etapas son las etapas que el backend hace de verdad.
 */

type Etapa = {
    /** Fracción de la barra que ocupa esta etapa. Suman 1. */
    peso: number;
    titulo: string;
    Icono: typeof Database;
};

const ETAPAS: Etapa[] = [
    { peso: 0.12, titulo: "Leyendo las OTs y los recursos", Icono: Database },
    { peso: 0.13, titulo: "Armando el modelo de la semana", Icono: Cpu },
    { peso: 0.60, titulo: "Buscando la mejor combinación", Icono: Search },
    { peso: 0.15, titulo: "Ordenando el resultado", Icono: Save },
];

/** Hasta acá llega sola. El resto lo completa la respuesta. */
const TECHO = 92;

/**
 * Cuánto suele tardar, en segundos. Sale de las corridas reales: el solver tiene un
 * presupuesto de 60s y corta a los 10s de dejar de mejorar, pero además hay que leer
 * las OTs con sus procesos y volcar el resultado, y eso crece con el tamaño del lote.
 */
function duracionEstimada(cantidadOts: number): number {
    return Math.min(150, 14 + cantidadOts * 1.6);
}

export function ProgresoPlanificacion({
    activo,
    cantidadOts,
    listo = false,
}: {
    activo: boolean;
    cantidadOts: number;
    /** La respuesta llegó: la barra se completa y recién ahí se va. */
    listo?: boolean;
}) {
    const [pct, setPct] = useState(0);
    const [segundos, setSegundos] = useState(0);
    const inicio = useRef<number>(0);

    useEffect(() => {
        if (!activo) {
            setPct(0);
            setSegundos(0);
            return;
        }
        inicio.current = Date.now();
        const total = duracionEstimada(cantidadOts) * 1000;

        const id = window.setInterval(() => {
            const transcurrido = Date.now() - inicio.current;
            setSegundos(Math.floor(transcurrido / 1000));
            // Curva que se va frenando: si la estimación se queda corta, la barra
            // sigue moviéndose de a poco en vez de clavarse, pero nunca pasa el techo.
            const avance = 1 - Math.exp(-transcurrido / (total / 2.5));
            setPct(Math.min(TECHO, avance * TECHO));
        }, 200);

        return () => window.clearInterval(id);
    }, [activo, cantidadOts]);

    useEffect(() => {
        if (listo) setPct(100);
    }, [listo]);

    if (!activo) return null;

    // Qué etapa toca según cuánto lleva la barra.
    let acumulado = 0;
    let etapa = ETAPAS[ETAPAS.length - 1];
    for (const e of ETAPAS) {
        acumulado += e.peso * 100;
        if (pct <= acumulado) {
            etapa = e;
            break;
        }
    }
    const { Icono } = etapa;
    const tarda = segundos >= Math.round(duracionEstimada(cantidadOts));

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]">
            <div className="w-[min(92vw,30rem)] rounded-xl border bg-white p-6 shadow-xl">
                <div className="flex items-center gap-3">
                    <div className="rounded-full bg-blue-50 p-2.5">
                        <Icono className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{etapa.titulo}</p>
                        <p className="text-xs text-slate-500">
                            {cantidadOts} {cantidadOts === 1 ? "orden" : "órdenes"} en cálculo
                        </p>
                    </div>
                    <span className="ml-auto text-2xl font-semibold tabular-nums text-slate-700">
                        {Math.round(pct)}%
                    </span>
                </div>

                <Progress
                    value={pct}
                    className="mt-4 h-2 bg-slate-100"
                    indicatorClassName="bg-blue-600"
                />

                <p className="mt-3 text-xs text-slate-500 tabular-nums">
                    {segundos}s transcurridos
                    {tarda && " · está tardando más de lo habitual, seguí esperando"}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    El porcentaje es una estimación por tiempo; el cálculo termina cuando
                    encuentra la mejor combinación o deja de mejorar.
                </p>
            </div>
        </div>
    );
}
