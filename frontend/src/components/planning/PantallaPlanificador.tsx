"use client";

/**
 * El marco de las dos pantallas de planificar: elegir OTs y revisar el plan.
 *
 * Antes esto eran dos modales de 95vw × 90vh, uno arriba del otro. Julián el
 * 19/08: "no quiero que sea un modal flotando, es incómodo de trabajar; que al
 * hacer click en Planificar se abra el planificador entero y la preview también,
 * que ocupe toda la pantalla y sea una ventana única todo el proceso".
 *
 * Un modal de ese tamaño no es un diálogo: es una pantalla con un borde gris
 * alrededor, sin barra lateral para navegar, que se cierra si el navegador
 * estornuda y que obliga a bloquear el click de afuera y la tecla Escape para no
 * perder media hora de trabajo. Todo eso desaparece siendo una pantalla.
 *
 * Por qué la altura es `calc(100svh - 2 × --pad-app)`: el layout de la app
 * (LayoutWrapper) mete el contenido de cada página dentro de un margen que mide
 * `--pad-app` arriba y otro abajo (24px en la computadora, 12 en el teléfono).
 * Descontando los dos, la pantalla llega justo hasta el borde de la ventana sin
 * generar scroll del documento — el único scroll queda adentro, que es lo que hace
 * que la cabecera y el pie estén SIEMPRE a la vista. Antes decía `3rem` a mano, que
 * eran los 48px del `p-6` fijo; con el margen que achica en el teléfono (RF-27) ese
 * número sobraba y el pie quedaba 24px más abajo de la ventana. El `1.5rem` de
 * respaldo es el de siempre, por si esto se monta fuera del layout.
 *
 * Por qué `hidden` en vez de no renderizar: las dos pantallas conviven montadas.
 * Yendo de la vista previa a "Volver" y de nuevo a planificar, desmontar perdería
 * el rango de fechas elegido, los filtros y lo tildado; con `display:none` el
 * estado sigue vivo y volver es instantáneo.
 *
 * `pantallaCompleta` (26/09/2026), desde `lg`: la pantalla deja de ser una tarjeta
 * y pasa a ser la ventana. Ver el comentario del contenedor, abajo.
 */

import React from "react";

import { cn } from "@/lib/utils";

export function PantallaPlanificador({
    visible,
    cabecera,
    pie,
    children,
    className,
    pantallaCompleta = false,
}: {
    visible: boolean;
    /** Barra de arriba, fija: título, acciones, contadores. */
    cabecera: React.ReactNode;
    /** Barra de abajo, fija: Volver / Confirmar. */
    pie?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    /**
     * Desde `lg`, ocupar la ventana entera: sin el margen del layout, sin tarjeta, y
     * con alto fijo (cabecera arriba, pie abajo, el cuerpo en el medio). En ese modo
     * el que scrollea NO es la página: son los hijos del cuerpo, cada uno el suyo, y
     * para eso el cuerpo les da un alto definido (se pueden estirar o usar `h-full`).
     * Abajo de `lg` no cambia nada: la tarjeta que crece y scrollea con la página.
     * `false` (el default) es el marco de siempre, idéntico.
     */
    pantallaCompleta?: boolean;
}) {
    // El alto REAL de la cabecera, publicado como variable CSS para que lo que tenga que
    // quedar pegado abajo de ella, o esquivarla al traer algo a la vista, no dependa de un
    // número escrito a mano. Estaba en `top-[136px]` y la cabecera no siempre mide 136:
    // crece cuando el título envuelve o cuando aparece una fila más de chips, y ahí el
    // panel se despegaba de arriba al scrollear (Julián, 27/08).
    // Hoy lo usa el `scroll-mt` de los saltos de la vista previa entre `md` y `lg`, donde
    // la cabecera va pegada arriba de la página. Hasta el 26/09/2026 también el panel de
    // Carga de recurso humano, que era sticky; en pantalla completa ya no le hace falta.
    // Se sigue publicando en los dos modos: es barato y otras pantallas lo pueden usar.
    const cabeceraRef = React.useRef<HTMLDivElement | null>(null);
    const [altoCabecera, setAltoCabecera] = React.useState(136);
    React.useEffect(() => {
        const el = cabeceraRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => setAltoCabecera(el.getBoundingClientRect().height));
        ro.observe(el);
        setAltoCabecera(el.getBoundingClientRect().height);
        return () => ro.disconnect();
    }, [visible]);

    return (
        <div
            style={{ "--alto-cabecera": `${Math.round(altoCabecera)}px` } as React.CSSProperties}
            className={cn(
                // `min-h` y no `h`: la pantalla ARRANCA ocupando el alto disponible pero CRECE
                // con el contenido. Con altura fija, la lista quedaba encerrada en un scroll
                // interno adentro de otro scroll interno y Julián lo dijo así: "me incomoda
                // estar encerrado ahí con tantos scroll dentro de modales, me gustaría que se
                // haga más larga la lista y me acompañe el side de la derecha".
                //
                // El patrón es el de UIAB Conecta (src/app/perfil/layout.tsx): el contenedor
                // usa min-h, la página scrollea de una sola manera, y lo que tiene que quedar
                // a la vista se resuelve con `sticky` en vez de con alturas fijas.
                //
                // `svh` y no `vh`: en iOS la barra de Safari hace que 100vh no entre en
                // pantalla. Mismo motivo que allá.
                "min-h-[calc(100svh-2*var(--pad-app,1.5rem))] flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm",
                // ── Pantalla completa, desde `lg` (26/09/2026) ──
                //
                // Julián: «me incomodó scrollear y que se mueva todo tipo modal flotante…
                // hay espacios que podemos aprovechar bastante más». Con el `min-h` de
                // arriba la página entera scrollea, y lo que se mueve es ESTA tarjeta
                // —redondeada, con borde y sombra, flotando sobre el gris del layout con
                // 24px de margen—: a la vista es un modal que se desliza, aunque ya no lo
                // sea. Y el margen gris son 48px de ancho y 48 de alto que no muestran
                // nada.
                //
                // Acá la pantalla pasa a ser la ventana: se come el margen del layout con
                // un margen negativo del mismo tamaño (LayoutWrapper pone `--pad-app` en
                // los cuatro lados desde `lg`) y mide EXACTO el alto de <main>, que es
                // el alto de la ventana (`h-screen` / `h-dvh`, el mismo par que usa
                // LayoutWrapper para su contenedor). Así <main> no tiene nada que
                // scrollear. Sin redondeo, sin borde, sin sombra: no hay tarjeta.
                // Cabecera y pie quedan quietos porque son filas de un contenedor de
                // alto fijo, no porque estén pegados con `sticky`; el cuerpo toma lo que
                // sobra y cada columna de adentro scrollea sola, una vez.
                //
                // ¿Y el pedido del 27/08 del comentario de arriba («me incomoda estar
                // encerrado ahí con tantos scroll dentro de modales»)? Aquello eran
                // scrolls ANIDADOS —la lista adentro del shell, el shell adentro de un
                // modal de 90vh— y se peleaba con tres barras a la vez. Esto es una
                // pantalla de trabajo: la lista tiene UN scroll, que es el único que se
                // usa, y el panel de al lado el suyo; nada scrollea adentro de otra cosa
                // que también scrollea. Es como una planilla: la barra de fórmulas no se
                // va cuando bajás.
                //
                // `overflow-hidden` de seguro: si algo de adentro se pasara del alto, que
                // se corte acá y no vuelva a hacer scrollear la página (que es justo el
                // efecto que se quiere sacar). Los menús y globitos van en portal y no
                // los toca.
                //
                // Abajo de `lg` no se toca nada (RF-27): en el teléfono y la tableta la
                // cabecera baja de renglones y el panel de carga va apilado debajo de la
                // tabla; ahí sirve que la página scrollee entera.
                pantallaCompleta && "lg:-m-[var(--pad-app)] lg:h-screen supports-[height:100dvh]:lg:h-dvh lg:min-h-0 lg:overflow-hidden lg:rounded-none lg:border-0 lg:shadow-none",
                !visible && "hidden",
                className,
            )}
        >
            {/* Sticky y no shrink-0: la cabecera queda a la vista mientras la lista corre por
                abajo, sin necesidad de que el contenedor tenga alto fijo. z-30 para pasarle
                por encima a los encabezados sticky de las tablas, que están en z-10/z-20.

                Pegada recién desde `md` (RF-27). En un teléfono los botones y los filtros
                bajan de renglón y la cabecera pasa a medir 300px o más: fija, se comía la
                mitad de la pantalla y la lista quedaba en una ranura. Ahí se va con el
                scroll como cualquier página; el pie con Confirmar sí queda pegado abajo.
                El alto se sigue midiendo igual (ResizeObserver de arriba), así que cuando
                la cabecera cambia de renglones la variable `--alto-cabecera` acompaña.

                En pantalla completa, desde `lg`, deja de ser sticky: es la primera fila de
                un contenedor de alto fijo y ya está quieta sola (`shrink-0` para que el
                cuerpo no la aplaste). `--alto-cabecera` se sigue publicando igual. */}
            <div
                ref={cabeceraRef}
                className={cn(
                    "md:sticky md:top-0 z-30 border-b border-gray-100 bg-white rounded-t-xl",
                    pantallaCompleta && "lg:static lg:shrink-0 lg:rounded-none",
                )}
            >
                {cabecera}
            </div>
            {/* `min-w-0`: sin eso, este flex item no puede achicarse por debajo del
                ancho mínimo de lo que tiene adentro (min-width de un flex item es `auto`,
                no 0) y cualquier tabla ancha termina scrolleando la página entera de
                costado en vez de scrollear ella sola.

                En pantalla completa, desde `lg`, el cuerpo es lo que sobra entre la
                cabecera y el pie: `min-h-0` para que pueda medir MENOS que su contenido
                (si no, el `min-height: auto` de un flex item lo estira hasta el alto de
                la tabla y vuelve a scrollear la página), e `items-stretch` para que los
                hijos reciban ese alto entero y cada uno scrollee el suyo. */}
            <div
                className={cn(
                    "relative flex-1 min-w-0 flex items-start",
                    pantallaCompleta && "lg:min-h-0 lg:items-stretch lg:overflow-hidden",
                )}
            >
                {children}
            </div>
            {/* El pie se pega abajo: Confirmar y Volver siempre alcanzables sin scrollear
                hasta el final de 11 OTs.
                `pl-16` abajo de `lg`: ahí el menú de la app es un botón redondo flotante
                abajo a la izquierda (Sidebar), y se sentaba justo encima de «Volver» — el
                toque abría el menú en vez de volver. Desde `lg` el menú es la barra
                lateral y el pie queda como siempre.
                En pantalla completa, desde `lg`, es la última fila del contenedor de alto
                fijo: quieto sin `sticky`, y sin redondeo porque ya no hay tarjeta. */}
            {pie && (
                <div
                    className={cn(
                        "sticky bottom-0 z-30 border-t border-gray-200 bg-white rounded-b-xl pl-16 lg:pl-0",
                        pantallaCompleta && "lg:static lg:shrink-0 lg:rounded-none",
                    )}
                >
                    {pie}
                </div>
            )}
        </div>
    );
}

/**
 * Una de las cuatro cifras de arriba del plan: OTs, procesos, carga, trabas.
 *
 * Estaban como badges chiquitos apretados contra el título y no se leían de un
 * vistazo — que es exactamente para lo que sirven: mirar el plan y saber si tiene
 * el tamaño que uno esperaba antes de ponerse a revisarlo fila por fila.
 */
export function CifraPlan({
    icono,
    valor,
    etiqueta,
    tono = "neutral",
    accion,
    title,
    className,
}: {
    icono: React.ReactNode;
    valor: React.ReactNode;
    /** Texto; un nodo sólo para teñirlo (la fecha, cuando el plan se pasó del tope). */
    etiqueta: React.ReactNode;
    /** "fecha" = la celda del período del plan: mismo peso que las otras cifras,
     *  acento azul para que se lea como el dato que ordena todo lo demás. */
    tono?: "neutral" | "alerta" | "ok" | "fecha";
    accion?: React.ReactNode;
    title?: string;
    /** Para que el riel reparta las celdas (p. ej. `col-span-2` en el teléfono). */
    className?: string;
}) {
    return (
        // Sin flex-1 ni min-w: el ancho lo reparte la grilla del riel, y el fondo
        // blanco es lo que deja ver los separadores (el gap-px del contenedor).
        // La tarjeta redondeada con ring de la celda "alerta" era la que flotaba
        // en medio de una tira sin fondo: ahora pinta la celda entera, de borde a
        // borde, y sigue igual de roja.
        // Más bajo desde el 26/09/2026 (mockup de Julián): `py-1.5`, caja del ícono de
        // 28px y el número en 16px. La grilla es la misma; lo que se gana son unos
        // 20px de alto que pasan a la lista, en una pantalla donde el alto es lo que
        // falta. Se sigue leyendo de un vistazo: el número es lo único en negrita.
        <div
            title={title}
            className={cn(
                "min-w-0 flex items-center gap-2.5 px-3 py-1.5",
                tono === "alerta" ? "bg-rose-50" : "bg-white",
                className,
            )}
        >
            <div
                className={cn(
                    "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                    tono === "alerta" ? "bg-rose-100 text-rose-600"
                        : tono === "ok" ? "bg-emerald-100 text-emerald-600"
                            : tono === "fecha" ? "bg-blue-100 text-blue-700"
                                : "bg-slate-100 text-slate-500",
                )}
            >
                {icono}
            </div>
            <div className="min-w-0">
                <div className={cn(
                    "text-[16px] font-bold leading-tight tabular-nums truncate",
                    tono === "alerta" ? "text-rose-600" : "text-gray-900",
                )}>
                    {valor}
                </div>
                <div className="text-[12px] text-gray-500 truncate">{etiqueta}</div>
            </div>
            {accion && <div className="ml-auto shrink-0">{accion}</div>}
        </div>
    );
}
