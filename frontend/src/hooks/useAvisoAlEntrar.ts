"use client";

/**
 * El estado del aviso que sale al entrar (AVISO_AL_ENTRAR, en lib/novedades.ts),
 * compartido entre el cartel (components/AvisoAlEntrar.tsx) y el megáfono del menú
 * (components/BotonAviso.tsx).
 *
 * Por qué existe: pedido de Julián (25/09/2026), «poder abrir el pop-up si lo cerré y no
 * lo leí». El cartel sale una sola vez y se cierra con Escape o con un click afuera: el
 * que lo cerraba de un manotazo al entrar —pasa, está apurado, lo tapa algo que quería
 * mirar— se quedaba sin el aviso y sin manera de volver a verlo. Justo con el de materia
 * prima, que dice DÓNDE se cargan las cosas durante la prueba piloto.
 *
 * DOS MARCAS EN EL NAVEGADOR, LAS DOS CON EL `id` DEL AVISO
 *  · `spmm_aviso_visto` (la de siempre): ya se le abrió solo. Decide que no se vuelva a
 *    abrir SOLO. Se anota al cerrarlo, se cierre como se cierre (ver AvisoAlEntrar).
 *  · `spmm_aviso_leido`: lo leyó. Decide el puntito del megáfono.
 * Son dos porque son dos preguntas: cerrarlo de un manotazo lo saca de encima —no tiene
 * que volver a saltar, eso sería el estorbo que la cabecera del cartel quiere evitar—,
 * pero no quiere decir que se leyó. Con el `id` y no con un «sí»: un aviso nuevo (otro
 * `id`) vuelve a prender el puntito sin que nadie borre nada.
 *
 * QUÉ CUENTA COMO LEÍDO
 *  · Tocar «Entendido» (el botón dice justamente eso) o «Ver todas las novedades».
 *  · O haberlo tenido abierto un rato (MS_PARA_LEIDO), se cierre como se cierre: el que
 *    lo leyó entero y después apretó Escape lo leyó igual.
 * Cerrarlo antes de eso con la cruz, Escape o un click afuera NO cuenta: el puntito sigue.
 * El que ya lo había cerrado antes de que existiera esta marca arranca con el puntito
 * prendido: no se sabe si lo leyó, y un puntito es barato.
 *
 * SIN MEMORIA EN EL NAVEGADOR (modo privado, permisos)
 * El megáfono abre el aviso igual, pero el puntito no se prende: la misma regla que el
 * cartel, mejor perderse un aviso que tener uno que no se apaga nunca. Si se puede leer
 * pero no escribir, se apaga en la memoria de la pestaña hasta que se recargue.
 *
 * Es un almacén chico fuera de React (useSyncExternalStore) y no un contexto: el cartel
 * vive en <main> y el megáfono en el menú, dos ramas distintas del layout, y así ninguno
 * de los dos tiene que envolver al otro.
 */

import { useSyncExternalStore } from "react";
import { AVISO_AL_ENTRAR } from "@/lib/novedades";

const CLAVE_VISTO = "spmm_aviso_visto";
const CLAVE_LEIDO = "spmm_aviso_leido";

/**
 * Cuánto tiene que quedar abierto para contar como leído. El de materia prima son seis
 * renglones: 15 segundos alcanzan para leerlo por arriba y son más que lo que dura un
 * manotazo para sacarlo de encima.
 */
export const MS_PARA_LEIDO = 15_000;

export type EstadoAviso = {
    /** El cartel está abierto (solo, al entrar, o desde el megáfono). */
    abierto: boolean;
    /** Hay un aviso que todavía no se leyó: prende el puntito del megáfono. */
    sinLeer: boolean;
};

/** Lo que se dibuja en el servidor y antes de leer el navegador: sin puntito. */
const SIN_NADA: EstadoAviso = { abierto: false, sinLeer: false };

/** `undefined` = el navegador no dejó leer. */
function leer(clave: string): string | null | undefined {
    try {
        return localStorage.getItem(clave);
    } catch {
        return undefined;
    }
}

function anotar(clave: string, valor: string) {
    try {
        localStorage.setItem(clave, valor);
    } catch {
        /* sin memoria: vale para esta pestaña nomás (ver la cabecera) */
    }
}

/** Se arma recién la primera vez que se pide en el navegador: en el servidor no hay localStorage. */
let estado: EstadoAviso | null = null;
let abiertoDesde = 0;
const oyentes = new Set<() => void>();

function sinLeerSegunElNavegador(): boolean {
    const aviso = AVISO_AL_ENTRAR;
    if (!aviso) return false;
    const leido = leer(CLAVE_LEIDO);
    return leido !== undefined && leido !== aviso.id;
}

function actual(): EstadoAviso {
    if (!estado) estado = { ...SIN_NADA, sinLeer: sinLeerSegunElNavegador() };
    return estado;
}

function cambiar(parcial: Partial<EstadoAviso>) {
    estado = { ...actual(), ...parcial };
    oyentes.forEach((f) => f());
}

/** Si lo leyó en otra pestaña, el puntito se apaga también en esta. */
function alCambiarOtraPestana(e: StorageEvent) {
    if (e.key !== null && e.key !== CLAVE_LEIDO) return;
    const sinLeer = sinLeerSegunElNavegador();
    if (sinLeer !== actual().sinLeer) cambiar({ sinLeer });
}

function suscribir(oyente: () => void) {
    oyentes.add(oyente);
    if (oyentes.size === 1) window.addEventListener("storage", alCambiarOtraPestana);
    return () => {
        oyentes.delete(oyente);
        if (oyentes.size === 0) window.removeEventListener("storage", alCambiarOtraPestana);
    };
}

export function useAvisoAlEntrar(): EstadoAviso {
    return useSyncExternalStore(suscribir, actual, () => SIN_NADA);
}

/**
 * ¿Le toca abrirse solo al entrar? Sólo si hay aviso, el navegador deja leer y no se le
 * abrió antes. Sin memoria no se abre solo (la regla de la cabecera del cartel).
 */
export function tocaAbrirseSolo(): boolean {
    const aviso = AVISO_AL_ENTRAR;
    if (!aviso) return false;
    const visto = leer(CLAVE_VISTO);
    return visto !== undefined && visto !== aviso.id;
}

/** Lo abre igual se abra solo al entrar o desde el megáfono: es el mismo cartel. */
export function abrirAviso() {
    if (!AVISO_AL_ENTRAR || actual().abierto) return;
    abiertoDesde = Date.now();
    cambiar({ abierto: true });
}

/**
 * Cómo se cerró: con uno de los dos botones de abajo (que cuentan como leído) o de
 * cualquier otra forma (cruz, Escape, click afuera), que cuenta sólo si estuvo abierto
 * un rato.
 */
export type ComoSeCerro = "entendido" | "novedades" | "afuera";

export function cerrarAviso(como: ComoSeCerro) {
    const aviso = AVISO_AL_ENTRAR;
    if (!aviso || !actual().abierto) return;
    // Se anota al CERRARLO y no al mostrarlo: ver el porqué en AvisoAlEntrar.
    anotar(CLAVE_VISTO, aviso.id);
    const leyo = como !== "afuera" || Date.now() - abiertoDesde >= MS_PARA_LEIDO;
    if (leyo) anotar(CLAVE_LEIDO, aviso.id);
    cambiar({ abierto: false, sinLeer: actual().sinLeer && !leyo });
}
