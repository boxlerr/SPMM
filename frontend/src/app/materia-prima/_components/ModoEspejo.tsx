"use client";

/**
 * El MODO ESPEJO de las materias primas: la prueba piloto con el Sistema Integral.
 *
 * POR QUÉ EXISTE
 *
 * El 24/09 Lucas pidió que la semana del 28/09 SPMM se pruebe EN PARALELO con el sistema
 * viejo («Sistema Integral»). Durante la prueba el Integral sigue siendo el dueño de todo,
 * materia prima incluida: Carolina y Maxi cargan allá, el sync lo trae con las marcas
 * reales (pedido, reserva, disponible…) y SPMM lo MUESTRA. Recién después de la prueba
 * SPMM pasa a ser el dueño (la sección editable que se armó para eso).
 *
 * Si durante la prueba se pudiera escribir acá, lo escrito duraría hasta la próxima
 * pasada del sync (que lo pisa con lo del Integral) y, mientras tanto, habría dos
 * verdades. Por eso con el dueño en «integral» la sección entera y la solapa de la OT
 * quedan en sólo lectura, con un cartel que dice por qué y dónde se carga.
 *
 * QUIÉN LO DECIDE
 *
 * El backend, en `GET /materia-prima/catalogos` (`dueno` y `aviso_dueno`): pasar de la
 * prueba a la operación normal no pide un deploy del front. Se lee del MISMO almacén que
 * los catálogos (InsumoCatalogos.ts): un pedido para todas las pantallas, y cuando llega
 * prende también el candado de los pedidos de escritura (`fijarModoEspejoMP` en
 * lib/materiaPrima.ts), la red de abajo por si algún camino quedó sin tapar.
 *
 *  · Mientras no llegó (`sabido = false`) nadie edita: es un instante (los catálogos se
 *    piden una vez por sesión) y es mejor que mostrar casillas que después se traban.
 *  · Si el backend no manda `dueno` (uno de antes de la prueba), o el pedido falla, es
 *    «spmm»: así andaba ese backend, y trabar la sección por un error de red la dejaría
 *    inservible después de la prueba. Un error se vuelve a probar solo cada tanto, así
 *    un tropiezo al entrar no deja la pantalla editable durante la prueba.
 *
 * «SE ACTUALIZAN SOLAS»
 *
 * Lo dice el cartel y tiene que ser cierto también con la pantalla abierta: en modo
 * espejo `useRefrescoEspejo` vuelve a pedir lo que se ve cada 90 segundos (si la
 * pestaña está a la vista) y al volver a la pestaña, que es lo que pasa cuando alguien
 * carga en el Integral y vuelve a mirar SPMM. Sin spinner ni pantalla en blanco: los
 * datos nuevos reemplazan a los viejos cuando llegan. De paso se vuelven a pedir los
 * catálogos, así al terminar la prueba las pantallas abiertas se destraban solas.
 */

import { useEffect, useRef } from "react";
import { Eye, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AVISO_ESPEJO, type DuenoMP } from "@/lib/materiaPrima";
import { cargarCatalogos, useCatalogosMP } from "./InsumoCatalogos";

export interface EstadoDueno {
    /** Null = todavía no se sabe (los catálogos no llegaron). */
    dueno: DuenoMP | null;
    /** El dueño es el Integral: sólo lectura, con el cartel. */
    espejo: boolean;
    /** Ya se sabe quién es el dueño. Mientras no, nadie edita. */
    sabido: boolean;
    /** El texto del cartel (el del backend, o el de la pantalla). */
    aviso: string;
}

/** Cada cuánto se vuelve a probar un pedido de catálogos que falló. */
const REINTENTO_MS = 15_000;

/**
 * Quién es el dueño de las materias primas. Usa (y si hace falta dispara) el pedido de
 * catálogos compartido: montarlo en varias pantallas a la vez no pide nada de más.
 */
export function useDuenoMP(): EstadoDueno {
    const { catalogos, error, sinServidor } = useCatalogosMP();
    const fallo = !catalogos && (!!error || sinServidor);

    // El pedido falló (y no porque falte la sección): se vuelve a probar solo.
    useEffect(() => {
        if (!fallo || sinServidor) return;
        const t = window.setInterval(() => void cargarCatalogos(), REINTENTO_MS);
        return () => window.clearInterval(t);
    }, [fallo, sinServidor]);

    const dueno: DuenoMP | null = catalogos ? catalogos.dueno : fallo ? "spmm" : null;
    return {
        dueno,
        espejo: dueno === "integral",
        sabido: dueno !== null,
        aviso: catalogos?.aviso_dueno ?? AVISO_ESPEJO,
    };
}

/**
 * El cartel de arriba de la sección y de la solapa de la OT. Si el texto arranca con un
 * «algo:» (el «Prueba piloto:» de siempre), ese pedazo va en negrita.
 */
export function CartelEspejo({ aviso, className }: { aviso: string; className?: string }) {
    const dosPuntos = aviso.indexOf(":");
    const titulo = dosPuntos > 0 && dosPuntos <= 40 ? aviso.slice(0, dosPuntos + 1) : null;
    const resto = titulo ? aviso.slice(dosPuntos + 1).trim() : aviso;
    return (
        <div
            role="status"
            className={cn(
                "flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-3 text-sm text-sky-950 sm:px-4",
                className,
            )}
        >
            <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 ring-1 ring-sky-200">
                <RefreshCw className="h-3.5 w-3.5" />
            </span>
            <p className="min-w-0 flex-1 leading-relaxed">
                {titulo && <b className="font-semibold text-sky-900">{titulo} </b>}
                {resto}
            </p>
        </div>
    );
}

/**
 * La marca chica de «sólo lectura» del modo espejo, al lado del título. Es la hermana de
 * `MarcaSoloLectura`, pero ésa dice «pedíselo a un administrador» y acá no es un tema de
 * permisos: nadie puede escribir, ni el administrador.
 */
export function MarcaEspejo({ aviso }: { aviso: string }) {
    return (
        <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200"
            title={aviso}
        >
            <Eye className="h-3 w-3" />
            Solo lectura
        </span>
    );
}

/** Cada cuánto se refresca lo que se ve en modo espejo. */
const REFRESCO_MS = 90_000;
/** Lo mínimo entre dos refrescos (volver a la pestaña dos veces seguidas no pide dos veces). */
const MINIMO_ENTRE_MS = 15_000;

/**
 * En modo espejo, vuelve a pedir lo que se ve: cada 90 s con la pestaña a la vista, y al
 * volver a ella. `recargar` tiene que ser silenciosa (dejar los datos viejos a la vista
 * hasta que lleguen los nuevos), como las `recargar` de los hooks de la sección.
 */
export function useRefrescoEspejo(activo: boolean, recargar: () => unknown) {
    const recargarRef = useRef(recargar);
    recargarRef.current = recargar;

    useEffect(() => {
        if (!activo) return;
        let ultimo = Date.now();
        const refrescar = () => {
            if (document.visibilityState !== "visible") return;
            if (Date.now() - ultimo < MINIMO_ENTRE_MS) return;
            ultimo = Date.now();
            void recargarRef.current();
            // El dueño también puede cambiar (fin de la prueba): que se entere sin F5.
            void cargarCatalogos(true);
        };
        const reloj = window.setInterval(refrescar, REFRESCO_MS);
        document.addEventListener("visibilitychange", refrescar);
        window.addEventListener("focus", refrescar);
        return () => {
            window.clearInterval(reloj);
            document.removeEventListener("visibilitychange", refrescar);
            window.removeEventListener("focus", refrescar);
        };
    }, [activo]);
}
