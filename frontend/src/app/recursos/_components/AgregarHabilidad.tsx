"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Plus, Loader2, CornerDownLeft } from "lucide-react";

export interface ProcesoItem {
    id: number;
    nombre: string;
}

interface Props {
    /** Catálogo completo de procesos. */
    catalogo: ProcesoItem[];
    /** Ids que el operario ya tiene (nativas + manuales): no se ofrecen. */
    yaTiene: Set<number>;
    onAgregar: (item: ProcesoItem) => void;
    /** Alta de un proceso que no existe en el catálogo. */
    onCrearProceso?: (nombre: string) => Promise<ProcesoItem | null>;
    disabled?: boolean;
    /**
     * Los tres de abajo existen para que el mismo buscador sirva en el editor del
     * operario y en el del rango, que dicen cosas distintas aunque el mecanismo sea
     * idéntico. Los defaults son los textos del operario, que fue el caso original.
     */
    etiqueta?: string;
    /** Aclaración al pie del menú: el alcance de lo que se está por agregar. */
    nota?: string;
    /** Singular de lo que se busca, para los mensajes ("proceso", "maquinaria"). */
    sustantivo?: string;
}

const normalizar = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * El menú se portalea al modal (o al body si no hay) por dos razones: el editor vive
 * dentro de contenedores con overflow que lo recortarían, y salirse del Dialog de
 * Radix rompería su focus-trap. Mismo criterio que SearchableSelect.
 */
function portalTarget(el: HTMLElement | null): HTMLElement | null {
    if (typeof document === "undefined") return null;
    return (el?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
}

/**
 * Buscador para sumarle al operario una habilidad que su rango no le da.
 *
 * Busca sobre el catálogo COMPLETO de procesos —el punto es justamente lo que no
 * está en sus nativas— y, si no existe en ningún lado, lo da de alta en el momento:
 * sin eso habría que irse a la pantalla de Procesos y volver.
 */
export default function AgregarHabilidad({
    catalogo,
    yaTiene,
    onAgregar,
    onCrearProceso,
    disabled = false,
    etiqueta = "Agregar habilidad",
    nota = "Queda solo para este operario, sin tocarle el rango.",
    sustantivo = "proceso",
}: Props) {
    const [abierto, setAbierto] = useState(false);
    const [texto, setTexto] = useState("");
    const [marcado, setMarcado] = useState(0);
    const [creando, setCreando] = useState(false);
    const [error, setError] = useState("");
    const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listaRef = useRef<HTMLDivElement>(null);

    const disponibles = useMemo(() => {
        const q = normalizar(texto.trim());
        return catalogo
            // Hay procesos con el nombre vacío en la base: sin esto se listan como
            // una fila en blanco imposible de interpretar.
            .filter((p) => p.nombre && p.nombre.trim())
            .filter((p) => !yaTiene.has(p.id))
            .filter((p) => !q || normalizar(p.nombre).includes(q))
            .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }, [catalogo, yaTiene, texto]);

    const nombreNuevo = texto.trim();
    const hayExacto = useMemo(
        () => catalogo.some((p) => normalizar(p.nombre || "") === normalizar(nombreNuevo)),
        [catalogo, nombreNuevo]
    );
    const puedeCrear = !!onCrearProceso && nombreNuevo.length >= 3 && !hayExacto;

    const ubicar = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const destino = portalTarget(el);
        const esBody = !destino || destino === document.body;
        const caja = esBody ? null : destino!.getBoundingClientRect();
        const offLeft = caja ? caja.left : 0;
        const offTop = caja ? caja.top : 0;
        const bordeInferior = caja ? caja.bottom : window.innerHeight;

        const ANCHO = Math.max(r.width, 340);
        const abajo = window.innerHeight - r.bottom - 12;
        const arriba = r.top - 12;
        const haciaArriba = abajo < 260 && arriba > abajo;
        const maxHeight = Math.max(200, Math.min(380, haciaArriba ? arriba : abajo));

        setPos({
            left: Math.min(r.left - offLeft, (caja ? caja.width : window.innerWidth) - ANCHO - 8),
            width: ANCHO,
            maxHeight,
            ...(haciaArriba
                ? { bottom: bordeInferior - r.top + 6 }
                : { top: r.bottom - offTop + 6 }),
        });
    }, []);

    useEffect(() => {
        if (!abierto) return;
        ubicar();
        inputRef.current?.focus();

        const afuera = (e: MouseEvent) => {
            const t = e.target as Node;
            if (
                triggerRef.current && !triggerRef.current.contains(t) &&
                menuRef.current && !menuRef.current.contains(t)
            ) {
                cerrar();
            }
        };
        const reubicar = () => ubicar();
        document.addEventListener("mousedown", afuera);
        window.addEventListener("resize", reubicar);
        window.addEventListener("scroll", reubicar, true);
        return () => {
            document.removeEventListener("mousedown", afuera);
            window.removeEventListener("resize", reubicar);
            window.removeEventListener("scroll", reubicar, true);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto, ubicar]);

    // El marcado se resetea con cada búsqueda: si no, queda apuntando a un índice de
    // la lista anterior y Enter agrega cualquier cosa.
    useEffect(() => setMarcado(0), [texto]);

    useEffect(() => {
        const fila = listaRef.current?.querySelector<HTMLElement>(`[data-idx="${marcado}"]`);
        fila?.scrollIntoView({ block: "nearest" });
    }, [marcado]);

    const cerrar = () => {
        setAbierto(false);
        setTexto("");
        setError("");
    };

    const agregar = (item: ProcesoItem) => {
        onAgregar(item);
        // Se deja abierto y se limpia: cargar varias seguidas es el caso normal, y
        // reabrir el menú por cada una es una fricción al pedo.
        setTexto("");
        inputRef.current?.focus();
    };

    const crear = async () => {
        if (!onCrearProceso || !puedeCrear || creando) return;
        setCreando(true);
        setError("");
        try {
            const creado = await onCrearProceso(nombreNuevo);
            if (creado) agregar(creado);
            else setError("No se pudo crear el proceso.");
        } catch {
            setError("No se pudo crear el proceso.");
        } finally {
            setCreando(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            // Que no burbujee al Dialog de Radix: cerraría el modal entero.
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            cerrar();
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setMarcado((i) => Math.min(i + 1, disponibles.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setMarcado((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (disponibles[marcado]) agregar(disponibles[marcado]);
            else if (puedeCrear) crear();
        }
    };

    const destino = abierto ? portalTarget(triggerRef.current) : null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => (abierto ? cerrar() : setAbierto(true))}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors ${
                    abierto
                        ? "border-slate-400 bg-slate-100 text-slate-900"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                } disabled:opacity-50`}
            >
                <Plus className="h-3.5 w-3.5" />
                {etiqueta}
            </button>

            {abierto && pos && destino &&
                createPortal(
                    <div
                        ref={menuRef}
                        onKeyDown={onKeyDown}
                        className="z-[9999] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5"
                        style={{
                            position: "fixed",
                            left: pos.left,
                            width: pos.width,
                            maxHeight: pos.maxHeight,
                            ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
                        }}
                    >
                        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
                            <Search className="h-4 w-4 shrink-0 text-slate-400" />
                            <input
                                ref={inputRef}
                                value={texto}
                                onChange={(e) => {
                                    setTexto(e.target.value);
                                    setError("");
                                }}
                                placeholder={`Buscar ${sustantivo}...`}
                                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                            />
                        </div>

                        <div ref={listaRef} className="flex-1 overflow-y-auto p-1">
                            {disponibles.map((p, i) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    data-idx={i}
                                    onMouseEnter={() => setMarcado(i)}
                                    onClick={() => agregar(p)}
                                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                                        i === marcado ? "bg-slate-100 text-slate-900" : "text-slate-700"
                                    }`}
                                >
                                    <span className="truncate">{p.nombre}</span>
                                    {i === marcado && (
                                        <Plus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    )}
                                </button>
                            ))}

                            {disponibles.length === 0 && (
                                <p className="px-2.5 py-3 text-[13px] text-slate-500">
                                    {nombreNuevo
                                        ? <>Ningún {sustantivo} se llama <span className="font-medium text-slate-700">«{nombreNuevo}»</span>.</>
                                        : `No queda ningún ${sustantivo} para agregar.`}
                                </p>
                            )}

                            {puedeCrear && (
                                <button
                                    type="button"
                                    onClick={crear}
                                    disabled={creando}
                                    className="mt-0.5 flex w-full items-center gap-2 rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-left text-[13px] text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60"
                                >
                                    {creando
                                        ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                        : <Plus className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                                    <span className="truncate">
                                        Crear <span className="font-medium text-slate-800">«{nombreNuevo}»</span>
                                    </span>
                                </button>
                            )}
                            {error && <p className="px-2.5 py-1.5 text-[12px] text-red-700">{error}</p>}
                        </div>

                        <div className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-500">
                            <CornerDownLeft className="h-3 w-3 shrink-0" />
                            {nota}
                        </div>
                    </div>,
                    destino
                )}
        </>
    );
}
