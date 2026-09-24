"use client";

/**
 * Elegir el proveedor: del catálogo, dar uno de alta en el momento o (si se permite)
 * dejar escrito un nombre suelto.
 *
 * DOS CLASES DE PROVEEDOR
 *
 * Las materias primas del sistema viejo guardan el proveedor como TEXTO en cada línea
 * («SIDERAR», «Siderar S.A.», «siderar sa»), y las facturas del viejo lo siguen haciendo.
 * SPMM tiene ahora un catálogo de proveedores, pero las líneas que vinieron del viejo
 * traen el texto, y no todo texto se pudo emparejar con uno del catálogo (sólo cuando
 * la coincidencia era exacta). Por eso una línea de OT guarda las dos cosas —el id y el
 * texto— y este selector sirve para las dos:
 *
 *  · se busca en el catálogo (lo hace el servidor, por razón social, fantasía o CUIT);
 *  · si no está, «Dar de alta» lo crea con la razón social que se escribió (el backend
 *    avisa con un 409 si ya hay uno con el mismo nombre normalizado, y se puede crear
 *    igual);
 *  · con `permitirTextoLibre`, «Usar sin darlo de alta» deja el nombre escrito tal cual
 *    (id null): Maxi a veces encarga a alguien que no va a volver a aparecer, y darlo de
 *    alta sería llenar el catálogo de basura.
 *
 * Un texto suelto se muestra con una marquita («sin alta») para que se note que no es
 * del catálogo.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, Plus, Search, Type, X } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
    consulta,
    mpGet,
    mpPost,
    type Proveedor,
    type ProveedorElegido,
    type ProveedorIn,
} from "@/lib/materiaPrima";
import { MenuFlotante, useEscapeCierraLaLista } from "./SelectorInsumo";

export interface SelectorProveedorProps {
    valor: ProveedorElegido;
    onCambiar: (valor: ProveedorElegido) => void;
    /** Deja usar un nombre que no está en el catálogo (líneas de OT). En la ficha del insumo, no. */
    permitirTextoLibre?: boolean;
    /** Ofrecer «Dar de alta». Por defecto sí; apagarlo cuando la persona no puede escribir el catálogo. */
    permitirAlta?: boolean;
    disabled?: boolean;
    placeholder?: string;
    /** Va al envoltorio (ancho, márgenes). */
    className?: string;
    /** Va al botón (alto, letra): en una grilla densa, `h-7 text-xs`. */
    triggerClassName?: string;
    id?: string;
}

const ESPERA_MS = 250;

/** Para comparar lo escrito con lo que hay: sin mayúsculas ni espacios de más. */
const normal = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

type Accion = { tipo: "alta" | "texto"; nombre: string };

export function SelectorProveedor({
    valor,
    onCambiar,
    permitirTextoLibre = false,
    permitirAlta = true,
    disabled = false,
    placeholder = "Proveedor…",
    className,
    triggerClassName,
    id,
}: SelectorProveedorProps) {
    const envoltorioRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listaRef = useRef<HTMLDivElement>(null);

    const [abierto, setAbierto] = useState(false);
    const [texto, setTexto] = useState("");
    const [resultados, setResultados] = useState<Proveedor[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);
    const [activo, setActivo] = useState(0);
    const [creando, setCreando] = useState(false);
    /** El 409 del alta: ya hay uno con ese nombre. Se muestra el motivo y «Crear igual». */
    const [avisoAlta, setAvisoAlta] = useState<{ nombre: string; motivo: string } | null>(null);

    const ultimo = useRef(0);
    const controlador = useRef<AbortController | null>(null);

    const cerrar = useCallback(() => {
        setAbierto(false);
        setTexto("");
        setAvisoAlta(null);
    }, []);

    // Con el menú abierto, su Escape no cierra el diálogo de afuera (el «+ Nuevo insumo»,
    // la OT). El foco está en el buscador del menú, que va en un portal: por eso la zona
    // es el menú además del botón.
    useEscapeCierraLaLista(abierto, [envoltorioRef, menuRef]);

    // La búsqueda: al abrir (con el texto vacío trae los primeros, para elegir sin
    // escribir) y con cada cambio del texto, esperando un poco y descartando las viejas.
    useEffect(() => {
        if (!abierto) return;
        setCargando(true);
        const espera = setTimeout(async () => {
            const n = ++ultimo.current;
            controlador.current?.abort();
            const c = new AbortController();
            controlador.current = c;
            const r = await mpGet<Proveedor[]>(
                `${API_URL}/materia-prima/proveedores?${consulta({ search: texto.trim(), limit: 30 })}`,
                { signal: c.signal },
            );
            if (n !== ultimo.current || r.abortado) return;
            setCargando(false);
            setSinServidor(r.sinServidor);
            if (!r.ok) {
                setResultados([]);
                setError(r.error);
                return;
            }
            setError(null);
            setResultados(Array.isArray(r.data) ? r.data : []);
            setActivo(0);
        }, texto ? ESPERA_MS : 0);
        return () => clearTimeout(espera);
    }, [abierto, texto]);

    useEffect(() => () => controlador.current?.abort(), []);

    // Click afuera (ni el botón ni el menú): cerrar sin cambiar nada.
    useEffect(() => {
        if (!abierto) return;
        const alTocar = (e: MouseEvent) => {
            const t = e.target as Node;
            if (envoltorioRef.current?.contains(t) || menuRef.current?.contains(t)) return;
            cerrar();
        };
        document.addEventListener("mousedown", alTocar);
        return () => document.removeEventListener("mousedown", alTocar);
    }, [abierto, cerrar]);

    const escrito = texto.trim();
    const yaEsta = resultados.some((p) => normal(p.razon_social) === normal(escrito) || normal(p.fantasia) === normal(escrito));
    // Las acciones van al final de la lista y se recorren con las flechas como un
    // renglón más: sin resultados, Enter hace la primera (usar el texto, si se permite).
    const acciones: Accion[] = escrito && !yaEsta
        ? [
            ...(permitirTextoLibre ? [{ tipo: "texto" as const, nombre: escrito }] : []),
            ...(permitirAlta ? [{ tipo: "alta" as const, nombre: escrito }] : []),
        ]
        : [];
    const renglones = resultados.length + acciones.length;

    useEffect(() => {
        const fila = listaRef.current?.querySelector<HTMLElement>(`[data-indice="${activo}"]`);
        fila?.scrollIntoView({ block: "nearest" });
    }, [activo]);

    const elegir = (p: Proveedor) => {
        onCambiar({ id: p.id, nombre: p.razon_social });
        cerrar();
    };

    const darDeAlta = async (nombre: string, forzar = false) => {
        setCreando(true);
        const cuerpo: ProveedorIn = { razon_social: nombre };
        const r = await mpPost<Proveedor>(`${API_URL}/materia-prima/proveedores`, cuerpo, { forzar });
        setCreando(false);
        if (r.requiereConfirmacion) {
            setAvisoAlta({ nombre, motivo: r.error ?? "Ya hay un proveedor con ese nombre." });
            return;
        }
        if (!r.ok || !r.data) {
            toast.error(r.error ?? "No se pudo dar de alta el proveedor.");
            return;
        }
        toast.success(`Proveedor «${r.data.razon_social}» dado de alta`);
        onCambiar({ id: r.data.id, nombre: r.data.razon_social });
        cerrar();
    };

    const hacer = (a: Accion) => {
        if (a.tipo === "texto") {
            onCambiar({ id: null, nombre: a.nombre });
            cerrar();
        } else {
            void darDeAlta(a.nombre);
        }
    };

    const alTeclear = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!renglones) return;
            e.preventDefault();
            const paso = e.key === "ArrowDown" ? 1 : -1;
            setActivo((a) => (a + paso + renglones) % renglones);
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (creando) return;
            if (activo < resultados.length) {
                if (resultados[activo]) elegir(resultados[activo]);
            } else if (acciones[activo - resultados.length]) {
                hacer(acciones[activo - resultados.length]);
            }
            return;
        }
        if (e.key === "Escape") {
            // Que cierre el menú y nada más: no el modal de abajo.
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            cerrar();
        }
        if (e.key === "Tab") cerrar();
    };

    const esTextoSuelto = valor.id === null && !!valor.nombre;

    return (
        <div ref={envoltorioRef} className={cn("relative w-full min-w-0", className)}>
            <div
                id={id}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-haspopup="listbox"
                aria-expanded={abierto}
                aria-disabled={disabled}
                onClick={() => {
                    if (disabled) return;
                    if (abierto) cerrar();
                    else setAbierto(true);
                }}
                onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
                        e.preventDefault();
                        setAbierto(true);
                    }
                }}
                title={
                    esTextoSuelto
                        ? `«${valor.nombre}» está escrito a mano: no es un proveedor del catálogo.`
                        : (valor.nombre ?? undefined)
                }
                className={cn(
                    "flex h-9 w-full items-center justify-between gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-sm transition-colors",
                    disabled ? "cursor-not-allowed bg-gray-100 text-gray-400" : "cursor-pointer hover:border-blue-400",
                    abierto && "border-blue-500 ring-2 ring-blue-500/20",
                    triggerClassName,
                )}
            >
                <span className={cn("min-w-0 truncate", !valor.nombre && "text-gray-400")}>
                    {valor.nombre || placeholder}
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                    {esTextoSuelto && (
                        <span className="rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-500">sin alta</span>
                    )}
                    {valor.nombre && !disabled && (
                        <span
                            role="button"
                            tabIndex={-1}
                            aria-label="Quitar el proveedor"
                            title="Quitar el proveedor"
                            onClick={(e) => {
                                e.stopPropagation();
                                onCambiar({ id: null, nombre: null });
                            }}
                            className="rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500"
                        >
                            <X className="h-3 w-3" />
                        </span>
                    )}
                    <ChevronDown className={cn("h-3.5 w-3.5 opacity-50 transition-transform", abierto && "rotate-180")} />
                </span>
            </div>

            <MenuFlotante ref={menuRef} anclaRef={envoltorioRef} abierto={abierto} anchoMin={300}>
                <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/80 px-3 py-2">
                    <Search className="h-4 w-4 shrink-0 text-gray-400" />
                    {/* `autoFocus` y no un efecto al abrir: el menú aparece un momento
                        después (cuando calcula dónde va), y un efecto que corre al abrir
                        todavía no encuentra el campo. */}
                    <input
                        ref={inputRef}
                        autoFocus
                        className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                        placeholder="Buscar por nombre o CUIT…"
                        value={texto}
                        onChange={(e) => {
                            setTexto(e.target.value);
                            setAvisoAlta(null);
                        }}
                        onKeyDown={alTeclear}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {cargando && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" />}
                </div>

                <div ref={listaRef} role="listbox" className="flex-1 overflow-y-auto p-1">
                    {error && (
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
                    )}

                    {resultados.map((p, n) => (
                        <div
                            key={p.id}
                            role="option"
                            aria-selected={n === activo}
                            data-indice={n}
                            onClick={() => elegir(p)}
                            onMouseEnter={() => setActivo(n)}
                            className={cn(
                                "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm",
                                n === activo ? "bg-blue-50" : "hover:bg-gray-50",
                                p.inactivo && "opacity-60",
                            )}
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-gray-800">{p.razon_social}</span>
                                {(p.fantasia || p.cuit) && (
                                    <span className="block truncate text-[11px] text-gray-500">
                                        {[p.fantasia, p.cuit ? `CUIT ${p.cuit}` : null].filter(Boolean).join(" · ")}
                                    </span>
                                )}
                            </span>
                            {valor.id === p.id && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                        </div>
                    ))}

                    {!error && !cargando && resultados.length === 0 && !acciones.length && (
                        <div className="px-3 py-4 text-center text-sm italic text-gray-400">
                            {escrito ? "No hay proveedores con ese nombre." : "Todavía no hay proveedores cargados."}
                        </div>
                    )}

                    {acciones.map((a, k) => {
                        const n = resultados.length + k;
                        return (
                            <button
                                key={a.tipo}
                                type="button"
                                data-indice={n}
                                disabled={creando}
                                onClick={() => hacer(a)}
                                onMouseEnter={() => setActivo(n)}
                                className={cn(
                                    "mt-0.5 flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-60",
                                    n === activo ? "bg-blue-50" : "hover:bg-gray-50",
                                    a.tipo === "alta" ? "text-blue-700" : "text-gray-700",
                                )}
                            >
                                {a.tipo === "alta"
                                    ? (creando ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <Plus className="mt-0.5 h-4 w-4 shrink-0" />)
                                    : <Type className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />}
                                <span className="min-w-0">
                                    <span className="font-semibold">
                                        {a.tipo === "alta" ? "Dar de alta" : "Usar sin darlo de alta"}
                                    </span>{" "}
                                    <span className="text-gray-600">«{a.nombre}»</span>
                                    <span className="mt-0.5 block text-[11px] text-gray-400">
                                        {a.tipo === "alta"
                                            ? "Queda en el catálogo de proveedores y se puede elegir en cualquier compra."
                                            : "Queda escrito en esta línea nada más, como hacía el sistema viejo."}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                {avisoAlta && (
                    <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <p>{avisoAlta.motivo}</p>
                        <div className="mt-1.5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setAvisoAlta(null)}
                                className="rounded px-2 py-1 font-medium text-amber-800 hover:bg-amber-100"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={creando}
                                onClick={() => void darDeAlta(avisoAlta.nombre, true)}
                                className="rounded bg-amber-600 px-2 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                            >
                                Crear igual
                            </button>
                        </div>
                    </div>
                )}
            </MenuFlotante>
        </div>
    );
}

export default SelectorProveedor;
