"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dibujar una lista larga DE A TANDAS, a medida que se baja.
 *
 * Lucas, 23/09/2026: «cuando voy a historial, tarda y como que se traba, y tenemos un
 * año de OT, ¿qué va a pasar cuando tengamos 2/3?». En la Mac de Julián abría al toque,
 * y no era exageración: cuando se toca la solapa los datos YA están en el navegador
 * (por eso dice «Historial (1102)» antes de abrirla). Lo que tardaba era armar las 1102
 * filas de una —y dos veces, la tabla y las tarjetas del celular escondidas—, cada una
 * con sus chips. En una PC de oficina eso son segundos con la pantalla congelada, y se
 * repetía con cada letra del buscador.
 *
 * Ahora se dibujan las primeras `tanda` y, cuando el final de la lista se acerca a la
 * pantalla, se agregan otras tantas solas. No hay páginas ni botones: se baja y aparecen.
 * Lo que se dibuja al abrir no crece con los años —son siempre las primeras 60—.
 *
 * Medido con 1102 OT (23/09, modo desarrollo): armar la lista pasó de ~1,1 s y 78.000
 * nodos a ~0,2 s y 4.300. Cada fila cuesta ~2 ms, por eso la tanda es de 60 y no de
 * más: al 70% de zoom entran unas 25 en pantalla, y el resto se arma mientras se baja.
 *
 * Lo que NO cambia: el buscador, los filtros, el orden y el Exportar siguen trabajando
 * sobre TODAS las filas. Este hook recibe la lista ya filtrada y ordenada y sólo decide
 * cuántas se pintan.
 *
 * `reinicio`: cuando cambia (otra búsqueda, otro filtro, otro orden) se vuelve a las
 * primeras. A propósito NO se reinicia cuando cambian los datos: después de editar una
 * OT la lista se refresca en silencio, y volver a las primeras te sacaba del lugar
 * donde estabas parado.
 */
export const TANDA_DE_FILAS = 60;

export function useDeATandas<T>(filas: T[], reinicio: string, tanda: number = TANDA_DE_FILAS) {
    // El reinicio se resuelve EN EL MISMO RENDER que trae la lista nueva, no en un
    // efecto. Con un efecto, el render que reordena u filtra todavía usaba la cantidad
    // vieja: si habías bajado hasta el fondo, reordenaba las 1102 filas y recién
    // después bajaba a 60 — la misma traba que se quería sacar.
    const [estado, setEstado] = useState({ clave: reinicio, cuantas: tanda });
    if (estado.clave !== reinicio) setEstado({ clave: reinicio, cuantas: tanda });
    const cuantas = estado.clave === reinicio ? estado.cuantas : tanda;
    const setCuantas = useCallback(
        (f: (c: number) => number) => setEstado((e) => ({ ...e, cuantas: f(e.cuantas) })),
        []
    );

    const hayMas = cuantas < filas.length;

    // El centinela es un elemento al pie de la lista. Se vuelve a observar cada vez que
    // cambia `cuantas` (la función cambia y React la vuelve a enganchar): un
    // IntersectionObserver avisa sólo cuando algo ENTRA o SALE de la vista, así que si
    // después de una tanda el pie sigue a la vista —pantalla alta, zoom al 70%— no
    // volvería a avisar y la lista quedaba cortada hasta mover la rueda. Al observar de
    // nuevo, la primera respuesta dice cómo está ahora y, si sigue cerca, trae otra.
    const observador = useRef<IntersectionObserver | null>(null);
    const centinela = useCallback(
        (el: HTMLElement | null) => {
            observador.current?.disconnect();
            observador.current = null;
            if (!el || !hayMas || typeof IntersectionObserver === "undefined") return;

            observador.current = new IntersectionObserver(
                (entradas) => {
                    if (entradas.some((e) => e.isIntersecting)) {
                        observador.current?.disconnect();
                        setCuantas((c) => c + tanda);
                    }
                },
                // Con el contenedor que scrollea de verdad (el <main> del layout) la
                // tanda siguiente se arma un poco antes de llegar al final y no se ve
                // el corte. Contra la ventana, el margen no alcanzaría: un contenedor
                // con scroll recorta lo que está fuera de su caja.
                { root: contenedorConScroll(el), rootMargin: "0px 0px 800px 0px" }
            );
            observador.current.observe(el);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `cuantas` va a propósito: ver arriba
        [cuantas, hayMas, tanda, setCuantas]
    );

    useEffect(() => () => observador.current?.disconnect(), []);

    const total = filas.length;
    return {
        mostradas: Math.min(cuantas, total),
        total,
        tanda,
        hayMas,
        centinela,
        verMas: () => setCuantas((c) => c + tanda),
        verTodas: () => setCuantas(() => total),
    };
}

/**
 * El primer ancestro que scrollea en vertical, o `null` (= la ventana).
 *
 * Tiene que scrollear DE VERDAD, no sólo tener `overflow: auto`: la caja del scroll
 * horizontal de la tabla también lo tiene (poner `overflow-x` fuerza el vertical a
 * `auto`), pero crece con el contenido y nunca se desplaza. Tomarla como raíz daría
 * el pie siempre "a la vista" y se dibujaría todo de a tandas, que es justo lo que se
 * quiere evitar.
 */
function contenedorConScroll(el: HTMLElement): Element | null {
    let actual = el.parentElement;
    while (actual && actual !== document.body) {
        const { overflowY } = getComputedStyle(actual);
        if (/(auto|scroll|overlay)/.test(overflowY) && actual.scrollHeight > actual.clientHeight + 1) {
            return actual;
        }
        actual = actual.parentElement;
    }
    return null;
}

/**
 * ¿Se está viendo la versión de tarjetas (debajo de `md`)?
 *
 * Las listas de OT tenían las dos versiones dibujadas siempre —tarjetas para el
 * celular y tabla para la compu— y escondían una con CSS. Escondida o no, el
 * navegador la arma igual: era el doble de trabajo. Con esto se dibuja sólo la que se
 * ve. Arranca en `false` (la compu) y se corrige al montar.
 *
 * Pregunta EXACTAMENTE lo mismo que Tailwind (`md` = 48rem), en rem y no en píxeles: el
 * rem de una media query es la letra que eligió la persona en el navegador. Con la
 * letra en «Grande» (20px), `md` pasa a 960px; si acá se preguntara por 768px, entre
 * 768 y 960 el JS armaba la tabla y el CSS la escondía: lista en blanco.
 */
export function useVistaDeTarjetas(): boolean {
    const [tarjetas, setTarjetas] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia("(min-width: 48rem)");
        const actualizar = () => setTarjetas(!mq.matches);
        actualizar();
        mq.addEventListener("change", actualizar);
        return () => mq.removeEventListener("change", actualizar);
    }, []);

    return tarjetas;
}
