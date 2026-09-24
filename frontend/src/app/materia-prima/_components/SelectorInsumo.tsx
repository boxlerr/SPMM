"use client";

/**
 * El buscador de insumos: se escribe el código o un pedazo de la descripción y se elige.
 *
 * Lo usan la barra de carga de la solapa Materias primas de la OT («código, cantidad,
 * Enter, código, cantidad, Enter…») y cualquier pantalla que tenga que elegir una pieza.
 *
 * POR QUÉ NO ES UN SearchableSelect
 *
 * El SearchableSelect de la casa filtra en el navegador una lista que ya tiene entera.
 * El catálogo de insumos son unas 17.800 piezas: no se bajan enteras para elegir una.
 * Acá la búsqueda la hace el servidor (`/materia-prima/insumos?search=`, de a 15), con
 * una espera corta después de tipear y descartando las respuestas viejas: si «AB» tarda
 * más que «ABC», la de «AB» llega última y NO pisa la lista (el mismo cuidado que la
 * lista de piezas de Operaciones, con su `ultimoPedido`).
 *
 * Y es un campo de texto, no un botón que abre un menú: el que carga una OT con doce
 * materias primas no quiere un click de más por renglón. El foco queda en el campo, las
 * flechas recorren la lista, Enter elige y Escape la cierra. Si se tipea el código
 * entero y se aprieta Enter antes de que llegue la respuesta, se elige solo cuando
 * llega (el código exacto, o el único resultado): así se carga a la velocidad a la que
 * se escribe.
 *
 * Cada resultado muestra lo que hace falta para decidir sin abrir la ficha: código,
 * descripción, el stock LIBRE (lo que no está reservado para otra OT) y si hay recortes.
 */

import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type ReactNode,
    type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Scissors, Search, X } from "lucide-react";
import { API_URL } from "@/config";
import { cn } from "@/lib/utils";
import {
    consulta,
    fmtCantidad,
    mpGet,
    type InsumoFila,
    type Paginado,
} from "@/lib/materiaPrima";

// ═══════════════════════════ el menú flotante ═══════════════════════════
//
// Lo comparten este buscador y el de proveedores (SelectorProveedor.tsx).
//
// Va en un portal, y no colgado del campo, porque los dos se usan adentro de tablas con
// scroll de costado (Pendientes) y de la ficha de la OT: un menú hijo de la celda queda
// recortado por el `overflow` del contenedor. El portal va al modal si hay uno (el
// `[role=dialog]` más cercano) y si no al body: fuera del modal, el focus-trap de Radix
// no dejaría tocar la lista. Es la misma cuenta que hace SearchableSelect.

interface PosicionMenu {
    left: number;
    width: number;
    /** El menú abre para arriba: abajo no había lugar. */
    arriba: boolean;
    maxHeight: number;
    /** `top` si abre para abajo, `bottom` si abre para arriba; relativo al contenedor del portal. */
    ancla: number;
}

/** Adónde va el portal: el modal más cercano o, si no hay, el body. */
function destinoDelPortal(el: HTMLElement | null): HTMLElement {
    return (el?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
}

function calcularPosicion(ancla: HTMLElement, anchoMin: number): PosicionMenu {
    const rect = ancla.getBoundingClientRect();
    const destino = destinoDelPortal(ancla);
    // Adentro de un modal (que tiene `transform`), `position: fixed` queda relativo a la
    // caja del modal y no a la ventana: hay que restarle su origen.
    const caja = destino === document.body ? null : destino.getBoundingClientRect();
    const offLeft = caja ? caja.left : 0;
    const offTop = caja ? caja.top : 0;
    const bordeInferior = caja ? caja.bottom : window.innerHeight;

    const MAXIMO = 340;
    const MARGEN = 4;
    const abajo = window.innerHeight - rect.bottom - 8;
    const arribaDisp = rect.top - 8;
    const arriba = abajo < Math.min(MAXIMO, 220) && arribaDisp > abajo;
    const maxHeight = Math.max(160, Math.min(MAXIMO, arriba ? arribaDisp : abajo));
    // Más ancho que el campo si hace falta (una descripción de insumo no entra en 200px),
    // pero nunca más que la ventana: en el teléfono se corre para adentro.
    const width = Math.min(Math.max(rect.width, anchoMin), window.innerWidth - 16);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    return {
        left: left - offLeft,
        width,
        arriba,
        maxHeight,
        ancla: arriba ? bordeInferior - rect.top + MARGEN : rect.bottom - offTop + MARGEN,
    };
}

/**
 * La lista que flota debajo (o arriba) de un campo. No maneja el foco ni el teclado:
 * eso es de quien la usa. Se reubica sola si se mueve la ventana o cualquier
 * contenedor con scroll.
 */
export const MenuFlotante = forwardRef<HTMLDivElement, {
    anclaRef: RefObject<HTMLElement | null>;
    abierto: boolean;
    /** Ancho mínimo en px; por defecto, el del campo. */
    anchoMin?: number;
    className?: string;
    children: ReactNode;
    onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}>(function MenuFlotante({ anclaRef, abierto, anchoMin = 0, className, children, onKeyDown }, ref) {
    const [pos, setPos] = useState<PosicionMenu | null>(null);

    useEffect(() => {
        if (!abierto) {
            setPos(null);
            return;
        }
        const recalcular = () => {
            if (anclaRef.current) setPos(calcularPosicion(anclaRef.current, anchoMin));
        };
        recalcular();
        window.addEventListener("resize", recalcular);
        // capture: el scroll de CUALQUIER contenedor de arriba (la tabla, el modal).
        window.addEventListener("scroll", recalcular, true);
        return () => {
            window.removeEventListener("resize", recalcular);
            window.removeEventListener("scroll", recalcular, true);
        };
    }, [abierto, anclaRef, anchoMin]);

    if (!abierto || !pos || typeof document === "undefined") return null;
    const estilo: CSSProperties = {
        position: "fixed",
        pointerEvents: "auto",
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        ...(pos.arriba ? { bottom: pos.ancla } : { top: pos.ancla }),
    };
    return createPortal(
        <div
            ref={ref}
            style={estilo}
            onKeyDown={onKeyDown}
            className={cn(
                "z-[9999] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5",
                "animate-in fade-in-0 zoom-in-95 duration-100",
                className,
            )}
        >
            {children}
        </div>,
        destinoDelPortal(anclaRef.current),
    );
});

/**
 * Escape con la lista abierta cierra la lista y NADA más, también adentro de un diálogo
 * o un popover de Radix.
 *
 * Por qué hace falta: Radix escucha el Escape en el `document`, en la fase de CAPTURA,
 * o sea ANTES de que el evento llegue al campo. El `stopPropagation` del `onKeyDown`
 * del campo llega tarde: para entonces Radix ya cerró el diálogo entero (en la OT,
 * preguntando si descartar los cambios). Hasta ahora cada diálogo tenía que acordarse
 * de marcar el campo (`data-escape-local`) y de frenarlo en su `onEscapeKeyDown`; el
 * «+ Nuevo insumo» no lo hacía.
 *
 * Acá se resuelve en el campo mismo: mientras la lista está a la vista, un oyente en la
 * `window` (la captura pasa por la `window` antes que por el `document`) marca el Escape
 * que sale de estas zonas con `preventDefault`, y Radix no cierra lo que ya viene
 * atajado (`DismissableLayer` mira `defaultPrevented`). El evento sigue su camino: el
 * `onKeyDown` del campo es el que cierra la lista. Con la lista cerrada no se toca nada
 * y Escape vuelve a cerrar el diálogo, como siempre.
 */
export function useEscapeCierraLaLista(abierta: boolean, zonas: RefObject<HTMLElement | null>[]) {
    const zonasRef = useRef(zonas);
    zonasRef.current = zonas;
    useEffect(() => {
        if (!abierta) return;
        const atajar = (e: globalThis.KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target instanceof Node ? e.target : null;
            if (t && zonasRef.current.some((z) => z.current?.contains(t))) e.preventDefault();
        };
        window.addEventListener("keydown", atajar, true);
        return () => window.removeEventListener("keydown", atajar, true);
    }, [abierta]);
}

// ═══════════════════════════ el buscador ═══════════════════════════

/** Lo que se puede hacer desde afuera: volver el foco al campo (después de «Agregar») y vaciarlo. */
export interface SelectorInsumoHandle {
    focus: () => void;
    limpiar: () => void;
}

export interface SelectorInsumoProps {
    onElegir: (insumo: InsumoFila) => void;
    autoFocus?: boolean;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    /**
     * Qué queda escrito después de elegir: el insumo elegido («COD — descripción»,
     * por defecto) o nada («limpiar», para cargar uno detrás de otro).
     */
    alElegir?: "mostrar" | "limpiar";
    /** Buscar también los inactivos. Por defecto no: un insumo dado de baja no se carga en una OT nueva. */
    incluirInactivos?: boolean;
    id?: string;
    "aria-label"?: string;
}

/** Con menos que esto no se busca: «A» trae media base y no ayuda a elegir. */
const MINIMO_PARA_BUSCAR = 2;
/** Cuánto se espera después de la última tecla. Corto: el que tipea un código sabe lo que busca. */
const ESPERA_MS = 250;
const CUANTOS = 15;

const normal = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

const textoDe = (i: InsumoFila) => `${i.codigo} — ${i.descripcion}`;

export const SelectorInsumo = forwardRef<SelectorInsumoHandle, SelectorInsumoProps>(function SelectorInsumo(
    {
        onElegir,
        autoFocus,
        placeholder = "Código o descripción…",
        disabled = false,
        className,
        alElegir = "mostrar",
        incluirInactivos = false,
        id,
        "aria-label": ariaLabel,
    },
    ref,
) {
    const inputRef = useRef<HTMLInputElement>(null);
    const envoltorioRef = useRef<HTMLDivElement>(null);
    const listaRef = useRef<HTMLDivElement>(null);

    const [texto, setTexto] = useState("");
    /** Lo que se busca: sólo cambia cuando la persona TIPEA (elegir escribe en el campo y no tiene que buscar). */
    const [busqueda, setBusqueda] = useState("");
    const [abierto, setAbierto] = useState(false);
    const [resultados, setResultados] = useState<InsumoFila[]>([]);
    const [total, setTotal] = useState(0);
    const [activo, setActivo] = useState(0);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);

    // Para descartar respuestas viejas: cada búsqueda lleva su número y sólo la última
    // escribe. Además se cancela la anterior, para no dejar pedidos colgados.
    const ultimo = useRef(0);
    const controlador = useRef<AbortController | null>(null);
    // Se apretó Enter antes de que llegara la respuesta: elegir apenas llegue.
    const elegirAlLlegar = useRef(false);

    useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
        limpiar: () => {
            setTexto("");
            setBusqueda("");
            setResultados([]);
            setAbierto(false);
        },
    }), []);

    // `onElegir` llega nuevo en cada render de quien lo usa; si `elegir` dependiera de
    // él, la búsqueda (que lo usa para el Enter anticipado) se volvería a disparar con
    // cada tecla de CUALQUIER campo de la pantalla. Se lee de una ref.
    const alElegirRef = useRef({ onElegir, alElegir });
    useEffect(() => {
        alElegirRef.current = { onElegir, alElegir };
    }, [onElegir, alElegir]);

    const elegir = useCallback((i: InsumoFila) => {
        elegirAlLlegar.current = false;
        setAbierto(false);
        setResultados([]);
        setBusqueda("");
        setTexto(alElegirRef.current.alElegir === "limpiar" ? "" : textoDe(i));
        alElegirRef.current.onElegir(i);
    }, []);

    useEffect(() => {
        const t = busqueda.trim();
        if (t.length < MINIMO_PARA_BUSCAR) {
            controlador.current?.abort();
            ultimo.current++;
            setResultados([]);
            setTotal(0);
            setCargando(false);
            setError(null);
            return;
        }
        setCargando(true);
        const espera = setTimeout(async () => {
            const n = ++ultimo.current;
            controlador.current?.abort();
            const c = new AbortController();
            controlador.current = c;
            const r = await mpGet<Paginado<InsumoFila>>(
                `${API_URL}/materia-prima/insumos?${consulta({ search: t, size: CUANTOS, page: 1, inactivos: incluirInactivos ? true : null })}`,
                { signal: c.signal },
            );
            if (n !== ultimo.current || r.abortado) return;
            setCargando(false);
            setSinServidor(r.sinServidor);
            if (!r.ok) {
                setResultados([]);
                setTotal(0);
                setError(r.error);
                elegirAlLlegar.current = false;
                return;
            }
            const filas = Array.isArray(r.data?.data) ? r.data!.data : [];
            setError(null);
            setResultados(filas);
            setTotal(r.data?.total_count ?? filas.length);
            setActivo(0);
            if (elegirAlLlegar.current) {
                elegirAlLlegar.current = false;
                const exacto = filas.find((f) => normal(f.codigo) === normal(t));
                const unico = filas.length === 1 ? filas[0] : null;
                if (exacto ?? unico) {
                    elegir((exacto ?? unico)!);
                    return;
                }
            }
            setAbierto(true);
        }, ESPERA_MS);
        return () => clearTimeout(espera);
    }, [busqueda, incluirInactivos, elegir]);

    // Al desmontar, que no quede un pedido volando que después escriba en la nada.
    useEffect(() => () => controlador.current?.abort(), []);

    // Que el renglón elegido con las flechas quede a la vista dentro de la lista.
    useEffect(() => {
        if (!abierto) return;
        const fila = listaRef.current?.querySelector<HTMLElement>(`[data-indice="${activo}"]`);
        fila?.scrollIntoView({ block: "nearest" });
    }, [activo, abierto]);

    const alTeclear = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!resultados.length) return;
            e.preventDefault();
            if (!abierto) {
                setAbierto(true);
                return;
            }
            const paso = e.key === "ArrowDown" ? 1 : -1;
            setActivo((a) => (a + paso + resultados.length) % resultados.length);
            return;
        }
        if (e.key === "Enter") {
            // Enter siempre es de este campo: que no mande el formulario de afuera ni
            // dispare el «Agregar» de la barra con el campo a medio escribir.
            e.preventDefault();
            e.stopPropagation();
            if (abierto && resultados[activo]) {
                elegir(resultados[activo]);
                return;
            }
            // Todavía no llegó la respuesta (o la espera no terminó): elegir cuando llegue.
            if (busqueda.trim().length >= MINIMO_PARA_BUSCAR && cargando) {
                elegirAlLlegar.current = true;
                return;
            }
            if (resultados.length) setAbierto(true);
            return;
        }
        if (e.key === "Escape") {
            // Si la lista está abierta, Escape la cierra y NADA más: que no llegue al
            // modal de la OT, que lo toma como «cerrar» y pregunta si descartar. (Al
            // diálogo de Radix lo frena `useEscapeCierraLaLista`: esto llega tarde para él.)
            if (abierto) {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setAbierto(false);
            }
            return;
        }
        if (e.key === "Tab") setAbierto(false);
    };

    const hayQueMostrar =
        abierto && busqueda.trim().length >= MINIMO_PARA_BUSCAR && (resultados.length > 0 || !!error || !cargando);
    // Con la lista a la vista, su Escape no cierra el diálogo de afuera. El foco vive en
    // el campo (el menú no lo toma), así que alcanza con la zona del campo.
    useEscapeCierraLaLista(hayQueMostrar, [envoltorioRef]);

    return (
        <div ref={envoltorioRef} className={cn("relative w-full", className)}>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
                ref={inputRef}
                id={id}
                type="text"
                role="combobox"
                aria-expanded={hayQueMostrar}
                aria-autocomplete="list"
                aria-label={ariaLabel ?? "Buscar insumo por código o descripción"}
                autoComplete="off"
                spellCheck={false}
                autoFocus={autoFocus}
                disabled={disabled}
                placeholder={placeholder}
                value={texto}
                onChange={(e) => {
                    setTexto(e.target.value);
                    setBusqueda(e.target.value);
                    elegirAlLlegar.current = false;
                    setAbierto(true);
                }}
                onFocus={(e) => {
                    // Al volver a un campo con un insumo ya elegido, se selecciona todo:
                    // lo normal es escribir otro encima, no editar el texto del elegido.
                    e.currentTarget.select();
                    if (resultados.length) setAbierto(true);
                }}
                // El menú usa `onMouseDown` + preventDefault, así que tocar un renglón no
                // saca el foco del campo: si se pierde el foco es porque se fue a otro lado.
                onBlur={() => setAbierto(false)}
                onKeyDown={alTeclear}
                className={cn(
                    "h-9 w-full rounded-md border border-gray-200 bg-white pl-8 pr-8 text-sm shadow-sm outline-none transition-colors",
                    "placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20",
                    "disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400",
                )}
            />
            {cargando ? (
                <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
            ) : texto && !disabled ? (
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Vaciar el buscador"
                    title="Vaciar"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                        setTexto("");
                        setBusqueda("");
                        setResultados([]);
                        inputRef.current?.focus();
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            ) : null}

            <MenuFlotante anclaRef={envoltorioRef} abierto={hayQueMostrar} anchoMin={460}>
                {/* `onMouseDown` + preventDefault en toda la lista (renglones, barra de
                    scroll, el pie): tocarla no le saca el foco al campo, y el campo
                    cierra la lista al perder el foco. */}
                <div
                    ref={listaRef}
                    role="listbox"
                    onMouseDown={(e) => e.preventDefault()}
                    className="flex-1 overflow-y-auto p-1"
                >
                    {error ? (
                        <div
                            className={cn(
                                "m-1 flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                                sinServidor
                                    ? "border-amber-200 bg-amber-50 text-amber-900"
                                    : "border-rose-200 bg-rose-50 text-rose-800",
                            )}
                        >
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {error}
                        </div>
                    ) : resultados.length === 0 ? (
                        <div className="px-3 py-4 text-center text-sm italic text-gray-400">
                            No hay insumos con «{busqueda.trim()}»{incluirInactivos ? "" : " (activos)"}.
                        </div>
                    ) : (
                        resultados.map((i, n) => (
                            <div
                                key={i.id}
                                role="option"
                                aria-selected={n === activo}
                                data-indice={n}
                                onClick={() => elegir(i)}
                                onMouseEnter={() => setActivo(n)}
                                className={cn(
                                    "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-sm",
                                    n === activo ? "bg-blue-50" : "hover:bg-gray-50",
                                )}
                            >
                                <span className="w-[5.5rem] shrink-0 truncate font-mono text-xs font-bold text-gray-900">
                                    {i.codigo}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-gray-700" title={i.descripcion}>
                                    {i.descripcion}
                                    {i.inactivo && (
                                        <span className="ml-1.5 rounded bg-gray-100 px-1 py-px text-[10px] font-semibold uppercase text-gray-500">
                                            inactivo
                                        </span>
                                    )}
                                </span>
                                {i.recortes_disponibles > 0 && (
                                    <span
                                        className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-violet-700"
                                        title={`Hay ${i.recortes_disponibles} recorte${i.recortes_disponibles === 1 ? "" : "s"} disponible${i.recortes_disponibles === 1 ? "" : "s"} de este insumo`}
                                    >
                                        <Scissors className="h-3 w-3" />
                                        {i.recortes_disponibles}
                                    </span>
                                )}
                                <span
                                    className={cn(
                                        "w-20 shrink-0 text-right text-xs tabular-nums",
                                        i.libre > 0 ? "text-gray-600" : "text-gray-300",
                                    )}
                                    title={`Stock libre (no reservado para otra OT). Físico: ${fmtCantidad(i.stock)}${i.reservado ? `, reservado: ${fmtCantidad(i.reservado)}` : ""}`}
                                >
                                    {fmtCantidad(i.libre, "0")} {i.unidad ?? ""}
                                </span>
                            </div>
                        ))
                    )}
                </div>
                {!error && total > resultados.length && (
                    <div
                        onMouseDown={(e) => e.preventDefault()}
                        className="border-t border-gray-100 bg-gray-50/80 px-3 py-1.5 text-[11px] text-gray-500"
                    >
                        Se ven {resultados.length} de {total}. Seguí escribiendo para achicar la lista.
                    </div>
                )}
            </MenuFlotante>
        </div>
    );
});

export default SelectorInsumo;
