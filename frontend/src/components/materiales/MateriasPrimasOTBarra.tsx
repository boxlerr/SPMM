"use client";

/**
 * La barra de carga de la solapa «Materias primas» de la OT: insumo, cantidad, unidad,
 * observación y «Agregar».
 *
 * PENSADA PARA CARGAR DE CORRIDO
 *
 * Carolina carga una OT con doce materias primas: «código, Enter, cantidad, Enter,
 * código, Enter, cantidad, Enter…». Por eso:
 *  · elegir el insumo (Enter en el buscador) lleva el foco a la cantidad, con la unidad
 *    del insumo ya puesta;
 *  · Enter en la cantidad o en la observación agrega, limpia la barra y vuelve el foco
 *    al buscador;
 *  · lo agregado aparece en la grilla al instante (optimista): no se espera al servidor
 *    para seguir cargando. Si el servidor dice que no, la fila se va, sale el aviso y,
 *    si la barra quedó vacía, lo que se había escrito vuelve a la barra.
 *
 * El insumo elegido se muestra como un rótulo (código, descripción, lo libre) en lugar
 * del buscador: así se ve también el que se acaba de dar de alta con «+ Nuevo insumo»,
 * que no pasó por el buscador. Tocar la ✕ vuelve a buscar.
 */

import { useEffect, useRef, useState } from "react";
import { History, Loader2, Plus, PackagePlus, Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtCantidad, fmtPrecio, leerCantidad, unidadLineaDePieza, type InsumoFila } from "@/lib/materiaPrima";
import { SelectorInsumo, type SelectorInsumoHandle } from "@/app/materia-prima/_components/SelectorInsumo";
import { NuevoInsumoDialog } from "@/app/materia-prima/_components/NuevoInsumoDialog";

export interface CargaDeLinea {
    insumo: InsumoFila;
    cantidad: number;
    unidad: string;
    observaciones: string | null;
}

export interface BarraDeCargaProps {
    unidades: readonly string[];
    /** Agrega (optimista). Devuelve si quedó: si no, lo escrito vuelve a la barra. */
    onAgregar: (carga: CargaDeLinea) => Promise<boolean> | boolean;
    onTraerHistorial: () => void;
    /** Por qué «Traer historial» no se puede tocar (falta el producto…). Null = se puede. */
    historialNo: string | null;
    historialCargando: boolean;
    /** Quedó algo escrito sin agregar: el modal lo cuenta como cambio sin guardar. */
    onSuciaChange: (sucia: boolean) => void;
}

const ID_BUSCADOR = "mp-ot-buscador";

export function BarraDeCarga({ unidades, onAgregar, onTraerHistorial, historialNo, historialCargando, onSuciaChange }: BarraDeCargaProps) {
    const buscadorRef = useRef<SelectorInsumoHandle>(null);
    const cantidadRef = useRef<HTMLInputElement>(null);
    const [elegido, setElegido] = useState<InsumoFila | null>(null);
    const [cantidad, setCantidad] = useState("");
    const [unidad, setUnidad] = useState(unidades[0] ?? "Un");
    const [obs, setObs] = useState("");
    const [error, setError] = useState<string | null>(null);
    /** Adónde va el foco después del próximo dibujo (el buscador vuelve a aparecer recién ahí). */
    const [enfocar, setEnfocar] = useState<"buscador" | "cantidad" | null>(null);
    const [nuevoAbierto, setNuevoAbierto] = useState(false);
    const [textoParaAlta, setTextoParaAlta] = useState<string | undefined>(undefined);
    const botonAltaRef = useRef<HTMLButtonElement>(null);
    /**
     * Al cerrar el alta, Radix le devuelve el foco al botón «Nuevo insumo» (el que lo
     * abrió), DESPUÉS de la animación de salida: pisaría el foco que se puso en la
     * cantidad. Con esta marca, ese foco devuelto se redirige a la cantidad.
     */
    const cantidadDespuesDelAlta = useRef(false);

    // Lo que hay en la barra, leído sin esperar al próximo dibujo (ver `agregar`).
    const barra = useRef({ elegido, cantidad, obs });
    barra.current = { elegido, cantidad, obs };

    useEffect(() => {
        if (!enfocar) return;
        if (enfocar === "buscador") buscadorRef.current?.focus();
        else cantidadRef.current?.focus();
        setEnfocar(null);
    }, [enfocar, elegido]);

    const sucia = !!elegido || !!cantidad.trim() || !!obs.trim();
    useEffect(() => {
        onSuciaChange(sucia);
    }, [sucia, onSuciaChange]);

    const elegir = (i: InsumoFila) => {
        setElegido(i);
        setUnidad(unidadLineaDePieza(i.unidad));
        setError(null);
        setEnfocar("cantidad");
    };

    const soltar = () => {
        setElegido(null);
        setError(null);
        setEnfocar("buscador");
    };

    const agregar = async () => {
        if (!elegido) {
            setError("Elegí el insumo: escribí el código o parte de la descripción.");
            setEnfocar("buscador");
            return;
        }
        const n = leerCantidad(cantidad);
        if (n === null || Math.round(n * 1000) <= 0) {
            setError("Poné la cantidad: un número mayor que cero.");
            setEnfocar("cantidad");
            return;
        }
        const carga: CargaDeLinea = {
            insumo: elegido,
            cantidad: Math.round(n * 1000) / 1000,
            unidad,
            observaciones: obs.trim() || null,
        };
        // Se limpia ya: la fila aparece al toque en la grilla y se sigue cargando.
        const antes = { elegido, cantidad, unidad, obs };
        setElegido(null);
        setCantidad("");
        setObs("");
        setError(null);
        setEnfocar("buscador");
        const ok = await onAgregar(carga);
        const b = barra.current;
        if (!ok && !b.elegido && !b.cantidad.trim() && !b.obs.trim()) {
            // Que no haya que escribirlo de nuevo… salvo que ya se esté cargando otro.
            setElegido(antes.elegido);
            setCantidad(antes.cantidad);
            setUnidad(antes.unidad);
            setObs(antes.obs);
        }
    };

    const alEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            // El Enter es de la barra: que no mande el formulario de la OT.
            e.preventDefault();
            void agregar();
        }
    };

    const abrirAlta = () => {
        // Lo que se tipeó en el buscador y no apareció, para no escribirlo dos veces. Sólo
        // si parece una descripción (tiene espacios): un código a medio escribir no lo es.
        const tipeado = (document.getElementById(ID_BUSCADOR) as HTMLInputElement | null)?.value?.trim() ?? "";
        setTextoParaAlta(!elegido && /\s/.test(tipeado) ? tipeado.toUpperCase() : undefined);
        setNuevoAbierto(true);
    };

    // Las unidades que se ofrecen: las de la línea más, si el insumo trae una heredada
    // que no está en la lista, esa (la elige el backend igual si no se manda).
    const opciones = unidades.includes(unidad) ? unidades : [unidad, ...unidades];

    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-2.5">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[16rem] flex-[3_1_18rem]">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Insumo</span>
                    {elegido ? (
                        <div className="flex h-9 items-center gap-2 rounded-md border border-blue-200 bg-white px-2 shadow-sm">
                            <span className="shrink-0 font-mono text-xs font-bold text-gray-900">{elegido.codigo}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-gray-700" title={elegido.descripcion}>
                                {elegido.descripcion}
                            </span>
                            {elegido.recortes_disponibles > 0 && (
                                <span
                                    className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-violet-700"
                                    title={`Hay ${elegido.recortes_disponibles} recorte${elegido.recortes_disponibles === 1 ? "" : "s"} disponible${elegido.recortes_disponibles === 1 ? "" : "s"}: mirá la ficha antes de pedir`}
                                >
                                    <Scissors className="h-3 w-3" />
                                    {elegido.recortes_disponibles}
                                </span>
                            )}
                            <span
                                className={cn("hidden shrink-0 text-[11px] tabular-nums sm:inline", elegido.libre > 0 ? "text-gray-600" : "text-gray-400")}
                                title="Stock libre (no reservado para otra OT)"
                            >
                                {fmtCantidad(elegido.libre, "0")} {elegido.unidad ?? ""} libres
                            </span>
                            <button
                                type="button"
                                onClick={soltar}
                                aria-label="Elegir otro insumo"
                                title="Elegir otro"
                                className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ) : (
                        // El Escape del buscador cierra su lista y NO la OT (ver data-escape-local en el modal).
                        <div data-escape-local>
                            <SelectorInsumo
                                ref={buscadorRef}
                                id={ID_BUSCADOR}
                                onElegir={elegir}
                                alElegir="limpiar"
                                placeholder="Código o descripción del insumo…"
                            />
                        </div>
                    )}
                </div>

                <label className="w-24 shrink-0">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cantidad</span>
                    <input
                        ref={cantidadRef}
                        data-escape-local
                        inputMode="decimal"
                        autoComplete="off"
                        value={cantidad}
                        onChange={(e) => {
                            setCantidad(e.target.value);
                            if (error) setError(null);
                        }}
                        onKeyDown={alEnter}
                        placeholder="0"
                        aria-label="Cantidad"
                        className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-right text-sm font-semibold tabular-nums shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    />
                </label>

                <label className="w-[4.5rem] shrink-0">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Unidad</span>
                    <select
                        value={unidad}
                        onChange={(e) => setUnidad(e.target.value)}
                        aria-label="Unidad"
                        className="h-9 w-full rounded-md border border-gray-200 bg-white px-1 text-sm shadow-sm outline-none focus:border-blue-500"
                    >
                        {opciones.map((u) => (
                            <option key={u} value={u}>{u}</option>
                        ))}
                    </select>
                </label>

                <label className="min-w-[9rem] flex-[2_1_10rem]">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Observación</span>
                    <input
                        data-escape-local
                        autoComplete="off"
                        value={obs}
                        maxLength={2000}
                        onChange={(e) => setObs(e.target.value)}
                        onKeyDown={alEnter}
                        placeholder="Opcional"
                        aria-label="Observación"
                        className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    />
                </label>

                <Button type="button" onClick={() => void agregar()} className="h-9 shrink-0 bg-blue-600 px-4 text-white hover:bg-blue-700">
                    <Plus className="h-4 w-4" />
                    Agregar
                </Button>

                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <Button
                        ref={botonAltaRef}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={abrirAlta}
                        onFocus={() => {
                            if (!cantidadDespuesDelAlta.current) return;
                            cantidadDespuesDelAlta.current = false;
                            cantidadRef.current?.focus();
                        }}
                        className="h-9 gap-1.5"
                        title="Dar de alta un insumo que no está en el catálogo y dejarlo elegido"
                    >
                        <PackagePlus className="h-4 w-4" />
                        Nuevo insumo
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onTraerHistorial}
                        disabled={!!historialNo || historialCargando}
                        className="h-9 gap-1.5"
                        title={historialNo ?? "Traer las materias primas de la última OT de este mismo producto"}
                    >
                        {historialCargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                        Traer historial
                    </Button>
                </div>
            </div>

            {error ? (
                <p className="mt-1.5 text-xs text-rose-700" role="alert">{error}</p>
            ) : elegido ? (
                <p className="mt-1.5 text-[11px] text-gray-500">
                    {elegido.unitario ? `Último precio: ${fmtPrecio(elegido.unitario)} por ${elegido.unidad ?? "unidad"}. ` : ""}
                    Enter en la cantidad agrega y vuelve al buscador.
                </p>
            ) : null}

            <NuevoInsumoDialog
                open={nuevoAbierto}
                onClose={() => setNuevoAbierto(false)}
                descripcionInicial={textoParaAlta}
                onCreado={(ficha) => {
                    // La ficha es un InsumoFila con más cosas: queda elegido como si se
                    // hubiera buscado, y la cantidad espera.
                    buscadorRef.current?.limpiar();
                    elegir(ficha);
                    cantidadDespuesDelAlta.current = true;
                    // Si el navegador no le devuelve el foco al botón (Safari no enfoca
                    // botones al hacer clic), igual que termine en la cantidad.
                    setTimeout(() => {
                        if (!cantidadDespuesDelAlta.current) return;
                        cantidadDespuesDelAlta.current = false;
                        const activo = document.activeElement;
                        if (!activo || activo === document.body || activo === botonAltaRef.current) cantidadRef.current?.focus();
                    }, 400);
                }}
            />
        </div>
    );
}

export default BarraDeCarga;
