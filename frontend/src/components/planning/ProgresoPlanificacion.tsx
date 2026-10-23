"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, Database, Save, Search } from "lucide-react";
import { cn } from "@/lib/utils";

import { Progress } from "@/components/ui/progress";
import { textoDeSegundos, tiempoDelCalculo } from "@/lib/tiempoDelCalculo";

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

/** Guardar ya NO vuelve a calcular: escribe el plan que está en pantalla, que es
 *  el que se aprobó. Una sola etapa, y corta. */
const ETAPAS_GUARDAR: Etapa[] = [
    { peso: 1, titulo: "Guardando el plan", Icono: Save },
];

/** Hasta acá llega sola. El resto lo completa la respuesta. */
const TECHO = 92;

/**
 * Cuánto suele tardar, en segundos.
 *
 * Hasta el 23/10/2026 salía de medir corridas por OT (3,8 s cada una, con el techo de 240 s
 * del solver). Ese día el techo bajó a 90 s y el solver corta cuando deja de mejorar de
 * verdad (ver MEJORA_RELEVANTE en el backend): la cuenta pasó a lib/tiempoDelCalculo, por
 * procesos, con las mismas constantes del presupuesto del solver.
 */
export function duracionEstimada(cantidadOts: number, modo: "calcular" | "guardar" = "calcular", cantidadProcesos?: number): number {
    // Guardar es una escritura, no un cálculo: desde que dejó de pasar por el solver
    // son segundos, no minutos. Con la estimación vieja la barra se arrastraba al 3%
    // mientras la pantalla ya se había cerrado.
    if (modo === "guardar") return Math.max(2, 1 + cantidadOts * 0.15);
    // 23/10/2026: con los procesos se usa la cuenta del presupuesto del solver
    // (lib/tiempoDelCalculo), que es la que decide cuánto tarda. Lo de abajo queda para
    // cuando no se sabe cuántos procesos son.
    if (cantidadProcesos && cantidadProcesos > 0) return tiempoDelCalculo(cantidadProcesos).estimado;
    // Sin los procesos, con el promedio de las tandas reales: 7,27 procesos por OT (ver
    // presupuesto_solver en el backend). Antes era 3,8 s por OT, del techo de 240 s.
    return tiempoDelCalculo(Math.round(cantidadOts * 7.27)).estimado;
}

export function ProgresoPlanificacion({
    activo,
    cantidadOts,
    cantidadProcesos,
    listo = false,
    modo = "calcular",
}: {
    activo: boolean;
    cantidadOts: number;
    /** Los procesos que entran al cálculo: con eso sale el tiempo estimado. */
    cantidadProcesos?: number;
    /** La respuesta llegó: la barra se completa y recién ahí se va. */
    listo?: boolean;
    /** "guardar" = se está confirmando el plan, no sólo mirándolo. */
    modo?: "calcular" | "guardar";
}) {
    const etapas = modo === "guardar" ? ETAPAS_GUARDAR : ETAPAS;
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
        const total = duracionEstimada(cantidadOts, modo, cantidadProcesos) * 1000;

        const id = window.setInterval(() => {
            const transcurrido = Date.now() - inicio.current;
            setSegundos(Math.floor(transcurrido / 1000));
            // Curva que se va frenando: si la estimación se queda corta, la barra
            // sigue moviéndose de a poco en vez de clavarse, pero nunca pasa el techo.
            const avance = 1 - Math.exp(-transcurrido / (total / 2.5));
            setPct(Math.min(TECHO, avance * TECHO));
        }, 200);

        return () => window.clearInterval(id);
    }, [activo, cantidadOts, modo, cantidadProcesos]);

    useEffect(() => {
        if (listo) setPct(100);
    }, [listo]);

    if (!activo) return null;

    // Qué etapa toca según cuánto lleva la barra.
    let acumulado = 0;
    let etapa = etapas[etapas.length - 1];
    for (const e of etapas) {
        acumulado += e.peso * 100;
        if (pct <= acumulado) {
            etapa = e;
            break;
        }
    }
    const { Icono } = etapa;
    /**
     * Cuándo se avisa que está tardando más de la cuenta.
     *
     * El triple de la estimación era un número que ya no puede pasar: con una tanda
     * de 60 OT serían 12 minutos y el navegador corta antes, así que el aviso no
     * aparecía nunca justo en las corridas largas, que son las únicas en las que
     * hace falta. Vez y media alcanza para que signifique algo.
     *
     * OJO CON PONERLE UN TOPE. La primera versión de esto llevaba `min(240, ...)` y
     * lo rompía: con 60 OT la estimación es 242 s, vez y media son 363, el tope lo
     * bajaba a 240 — y la corrida tarda 244. O sea que el cartel "está tardando más
     * de lo habitual" salía en los últimos segundos de TODA tanda grande, que es
     * justo cuando todo va bien. Un aviso que aparece siempre deja de avisar.
     *
     * Queda sólo el piso de 20 segundos, para que en un lote chico no salte apenas
     * empezó. Sin techo: si la estimación crece, el umbral crece con ella.
     */
    const estimado = duracionEstimada(cantidadOts, modo, cantidadProcesos);
    const maximo = modo === "calcular" && cantidadProcesos ? tiempoDelCalculo(cantidadProcesos).maximo : null;
    const tarda = segundos >= Math.max(20, Math.round((maximo ?? estimado * 1.5)));
    // Lo que falta, contra lo que suele tardar; pasado eso, contra el tope.
    const falta = segundos < estimado ? estimado - segundos : maximo !== null && segundos < maximo ? maximo - segundos : null;

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
                            {cantidadOts} {cantidadOts === 1 ? "orden" : "órdenes"}
                            {modo === "guardar" ? " · guardando la planificación" : " en cálculo"}
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

                {modo === "calcular" && (
                    <p className="mt-3 text-sm text-slate-700">
                        Tiempo estimado: <span className="font-semibold">~{textoDeSegundos(estimado)}</span>
                        {maximo !== null && maximo > estimado + 10 && (
                            <span className="text-slate-500"> (como mucho {textoDeSegundos(maximo)})</span>
                        )}
                    </p>
                )}
                <p className={cn("text-xs text-slate-500 tabular-nums", modo === "calcular" ? "mt-1" : "mt-3")}>
                    {segundos < 60 ? `${segundos} s` : `${Math.floor(segundos / 60)} min ${String(segundos % 60).padStart(2, "0")} s`} transcurridos
                    {falta !== null && !tarda && ` · faltan ~${textoDeSegundos(falta)}`}
                    {falta === null && !tarda && segundos > 5 && " · terminando"}
                    {tarda && " · está tardando más de lo habitual, seguí esperando"}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {modo === "guardar"
                        ? "Se guarda el plan tal como lo ves; no se vuelve a calcular."
                        : "El porcentaje es una estimación por tiempo; el cálculo termina cuando encuentra la mejor combinación o deja de mejorar."}
                </p>
            </div>
        </div>
    );
}
