"use client";

/**
 * Lo que comparten las cargas del botón «Nuevo» de Materia prima (NuevoMenu.tsx) y lo
 * que le avisan al resto de la sección.
 *
 * AVISAR QUE SE CARGÓ ALGO (sin recargar la pantalla)
 *
 * Las cargas del botón viven en diálogos arriba de las solapas: un pedido marcado desde
 * «Pedido a proveedor» cambia las líneas que muestra Pendientes; un ingreso de stock o un
 * recorte cambian la lista de Insumos. La solapa que está a la vista tiene que enterarse,
 * pero sin volver a montarse (perdería la semana elegida, los filtros y el scroll) y sin
 * spinner: vuelve a pedir en silencio, como con su botón «Actualizar».
 *
 * Por eso no es una llave que cambia sino un aviso: `avisarCargaMP(["pendientes"])`
 * dispara un evento de la ventana y cada solapa que quiera enterarse lo oye con
 * `useAlCargarMP("pendientes", recargar)`, con SU `recargar` silenciosa. Si nadie lo oye
 * no pasa nada: la próxima vez que la solapa pida, trae lo nuevo.
 *
 * EL MODO PRÁCTICA (prueba piloto)
 *
 * Con el Sistema Integral como dueño de las materias primas (ver ModoEspejo.tsx), quien
 * puede escribir la sección igual puede abrir cada carga y recorrerla entera —es para
 * ver cómo es el proceso antes de que SPMM sea el dueño—, pero al guardar no sale nada:
 * el candado de `mpFetch` (lib/materiaPrima.ts) devuelve la respuesta marcada `practica`
 * (y 423) y él mismo saca el cartelito «Esto no se guarda» (`CartelitoPractica`, en
 * ModoEspejo.tsx). `frenadoPorPractica` es la única pregunta que hacen los diálogos: si
 * es eso, deshacen lo optimista en silencio, NO muestran un toast y quedan abiertos (lo
 * escrito no se pierde).
 */

import { useEffect, useRef } from "react";
import type { MpRespuesta } from "@/lib/materiaPrima";

/** Qué parte de la sección cambió con una carga. */
export type TemaCarga = "pendientes" | "insumos" | "canera";

const EVENTO = "spmm:materia-prima-cargada";

/** Avisa que una carga del botón «Nuevo» cambió algo de estos temas. */
export function avisarCargaMP(temas: TemaCarga[]): void {
    if (typeof window === "undefined" || !temas.length) return;
    window.dispatchEvent(new CustomEvent<TemaCarga[]>(EVENTO, { detail: temas }));
}

/**
 * Llama a `recargar` cada vez que una carga avisa que cambió `tema`. `recargar` tiene que
 * ser silenciosa (dejar lo de antes a la vista hasta que llegue lo nuevo), como las de los
 * hooks de la sección. Se lee de una ref: puede llegar nueva en cada dibujo sin volver a
 * suscribirse.
 */
export function useAlCargarMP(tema: TemaCarga, recargar: () => unknown): void {
    const ref = useRef(recargar);
    ref.current = recargar;
    useEffect(() => {
        const oir = (e: Event) => {
            const temas = (e as CustomEvent<TemaCarga[]>).detail;
            if (Array.isArray(temas) && temas.includes(tema)) void ref.current();
        };
        window.addEventListener(EVENTO, oir);
        return () => window.removeEventListener(EVENTO, oir);
    }, [tema]);
}

/**
 * ¿Este pedido lo frenó el modo práctica? 423 es lo que devuelve el candado de `mpFetch`
 * con el Integral de dueño; `practica` es la marca que puede traer la respuesta (la
 * agrega el modo práctica de lib/materiaPrima.ts): se aceptan las dos para no depender
 * de cuál llegue primero.
 */
export function frenadoPorPractica(r: Pick<MpRespuesta<unknown>, "status"> & { practica?: boolean }): boolean {
    return r.status === 423 || r.practica === true;
}
