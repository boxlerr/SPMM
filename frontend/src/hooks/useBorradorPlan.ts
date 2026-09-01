"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
    BorradorPlan,
    DEBOUNCE_BASE_MS,
    guardarEnBase,
    guardarLocal,
    leerLocal,
    limpiarLocal,
} from "@/lib/borradorPlan";

/**
 * Autoguardado del plan sin confirmar, en dos capas.
 *
 * El navegador escribe en cada cambio y sincrónico —es lo único que sobrevive a un
 * corte de luz—; la base va debounceada, porque un write por cada toque de un
 * desplegable es plata y latencia al pedo. Ver `lib/borradorPlan.ts` para el
 * reparto de responsabilidades.
 *
 * Momentos en los que la base se escribe SIN esperar el debounce:
 *  - apenas termina el cálculo (`guardarYa`): es lo caro, no se puede perder;
 *  - al cerrar la vista previa sin confirmar (`guardarYa`);
 *  - cuando la pestaña se oculta o se descarga (`visibilitychange` / `pagehide`),
 *    que es lo más cerca que se puede estar de "cerró la ventana".
 */
export function useBorradorPlan() {
    const [borradorLocal, setBorradorLocal] = useState<BorradorPlan | null>(null);
    const idEnBase = useRef<number | null>(null);
    const pendiente = useRef<BorradorPlan | null>(null);
    const timer = useRef<number | null>(null);

    // Lo que haya quedado de la sesión anterior, para poder ofrecer "retomar".
    useEffect(() => {
        const b = leerLocal();
        if (b) {
            setBorradorLocal(b);
            if (typeof b.id === "number") idEnBase.current = b.id;
        }
    }, []);

    const subir = useCallback(async (b: BorradorPlan, automatico: boolean) => {
        const id = await guardarEnBase({ ...b, id: idEnBase.current ?? undefined }, { automatico });
        if (id) {
            idEnBase.current = id;
            // El id se guarda también en la copia local: así, si el navegador se
            // reabre, el autosave sigue pisando el mismo borrador de la base en
            // vez de crear uno nuevo por sesión.
            guardarLocal({ ...b, id });
        }
    }, []);

    const descargar = useCallback(() => {
        if (timer.current) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
        const b = pendiente.current;
        pendiente.current = null;
        return b;
    }, []);

    /** Cada cambio de la vista previa. Local ya; base en unos segundos. */
    const registrarCambio = useCallback((b: BorradorPlan) => {
        const conId = { ...b, id: idEnBase.current ?? undefined };
        guardarLocal(conId);
        setBorradorLocal(conId);
        pendiente.current = conId;

        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            const p = descargar();
            if (p) void subir(p, true);
        }, DEBOUNCE_BASE_MS);
    }, [descargar, subir]);

    /** Sin esperar el debounce: cálculo recién terminado, o cierre del modal. */
    const guardarYa = useCallback(async (b?: BorradorPlan) => {
        const objetivo = b ?? descargar() ?? pendiente.current;
        if (!objetivo) return;
        descargar();
        const conId = { ...objetivo, id: idEnBase.current ?? undefined };
        guardarLocal(conId);
        setBorradorLocal(conId);
        await subir(conId, false);
    }, [descargar, subir]);

    /** El plan se confirmó (o el usuario descartó el borrador): deja de existir. */
    const olvidar = useCallback(() => {
        descargar();
        limpiarLocal();
        idEnBase.current = null;
        setBorradorLocal(null);
    }, [descargar]);

    /**
     * Arranca un borrador NUEVO: el próximo guardado va a INSERTAR una fila en vez
     * de pisar la anterior.
     *
     * Sin esto, `idEnBase` sobrevivía a todo —incluso a cerrar el navegador, porque
     * se restaura desde `localStorage` al montar— y el POST estampaba SIEMPRE ese
     * id, que en la base es un `UPDATE ... SET contenido`. O sea: calcular un plan
     * nuevo pisaba el borrador anterior con el nuevo contenido y el viejo se perdía
     * sin dejar rastro. Fue exactamente lo que pasó el 31/08: un borrador de 8 OT
     * quedó convertido en uno de 1 OT al planificar de nuevo.
     *
     * Se llama al EMPEZAR un cálculo nuevo. Los recálculos de la vista previa y las
     * ediciones a mano NO lo llaman: esos sí tienen que seguir pisando el mismo.
     */
    const empezarNuevo = useCallback(() => {
        // Lo que quedó en el debounce todavía es del borrador VIEJO: se manda CON su
        // id antes de soltarlo. Si solo se descartara, los últimos retoques a mano
        // —los de los 3 segundos previos a apretar Planificar— se perderían.
        const pendiente = descargar();
        if (pendiente) void subir(pendiente, true);
        idEnBase.current = null;
    }, [descargar, subir]);

    /** Un borrador traído de la base pasa a ser el que el autosave sigue pisando. */
    const adoptar = useCallback((b: BorradorPlan) => {
        idEnBase.current = typeof b.id === "number" ? b.id : null;
        guardarLocal(b);
        setBorradorLocal(b);
    }, []);

    // La pestaña se va: se manda lo que haya quedado pendiente. `keepalive` en el
    // fetch permite que el request sobreviva a la descarga de la página; no está
    // garantizado, pero la copia local ya se escribió y esa nunca se pierde.
    useEffect(() => {
        const alIrse = () => {
            const p = pendiente.current;
            if (p) void subir(p, true);
        };
        const alOcultarse = () => {
            if (document.visibilityState === "hidden") alIrse();
        };
        window.addEventListener("pagehide", alIrse);
        document.addEventListener("visibilitychange", alOcultarse);
        return () => {
            window.removeEventListener("pagehide", alIrse);
            document.removeEventListener("visibilitychange", alOcultarse);
        };
    }, [subir]);

    return { borradorLocal, registrarCambio, guardarYa, olvidar, adoptar, empezarNuevo };
}
