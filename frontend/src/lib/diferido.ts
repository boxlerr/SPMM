"use client";

/**
 * Lo pesado que se abre con un click (modales, el planificador, editores con arrastre)
 * se carga recién cuando hace falta, con `next/dynamic`. Esto son las dos piezas que
 * hacen que eso no se note:
 *
 *  · `useMontarAlAbrir(abierto)`: el componente se monta la PRIMERA vez que se abre y
 *    después queda montado. Así el modal conserva su animación de cierre y lo que
 *    tenía adentro entre una apertura y otra, igual que cuando estaba siempre montado;
 *    lo único que cambia es que, mientras nadie lo abrió, ni se baja ni se dibuja.
 *
 *  · `precargarCuandoEsteLibre(() => import("..."))`: baja el código cuando el
 *    navegador no tiene nada que hacer, después de que la pantalla ya se dibujó. El
 *    primer click no espera la descarga, y el arranque de la pantalla no paga por
 *    algo que a lo mejor no se usa.
 *
 * Por qué (20/10/2026): Operaciones bajaba 657 KB comprimidos de JavaScript al abrir,
 * casi toda la app (el planificador, el modal de la OT, el Gantt apagado, el detalle de
 * una persona), y la PC del taller tenía que leerlo entero antes de poder usar la lista.
 */

import { useEffect, useState } from "react";

export function useMontarAlAbrir(abierto: boolean): boolean {
    const [montado, setMontado] = useState(abierto);
    useEffect(() => {
        if (abierto) setMontado(true);
    }, [abierto]);
    return montado || abierto;
}

type ConIdle = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

/** Pide el código cuando el navegador está libre (o a los 2 s, si no avisa nunca). Un fallo no importa: se vuelve a pedir al abrir. */
export function precargarCuandoEsteLibre(...cargas: Array<() => Promise<unknown>>): void {
    if (typeof window === "undefined") return;
    const correr = () => cargas.forEach((c) => c().catch(() => { /* se reintenta al usarlo */ }));
    const w = window as ConIdle;
    if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(correr, { timeout: 4000 });
    else window.setTimeout(correr, 2000);
}
