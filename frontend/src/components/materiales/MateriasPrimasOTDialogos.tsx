"use client";

/**
 * Los dos diálogos de la solapa «Materias primas» de la OT: los CORTES de una línea y
 * «TRAER HISTORIAL».
 *
 * Van en diálogos (y no desplegados en la fila) porque los dos son un rato de trabajo
 * aparte: los cortes se cargan mirando el plano, renglón por renglón; el historial se
 * lee antes de aceptar. Son diálogos de Radix adentro del de la OT: su Escape cierra
 * sólo esta capa, no la OT.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, History, Loader2, Plus, Scissors, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    enMetros,
    fmtCantidad,
    fmtFecha,
    leerCantidad,
    metrosQueSeMuestran,
    type CorteIn,
    type HistorialOT,
    type LineaHistorial,
    type MpRespuesta,
} from "@/lib/materiaPrima";
import { sugerenciaMetros, textoCorte, type FilaMP } from "./MateriasPrimasOTDatos";
import { aEditable } from "./MateriasPrimasOTFila";

// ═══════════════════════════ cortes ═══════════════════════════

interface RenglonCorte {
    clave: number;
    cantidad: string;
    largo: string;
    ancho: string;
    /** Lo que decía el viejo cuando no se pudo leer como medida. */
    textoOriginal: string | null;
}

let proximaClave = 1;
const renglonVacio = (): RenglonCorte => ({ clave: proximaClave++, cantidad: "", largo: "", ancho: "", textoOriginal: null });

/** Un renglón leído: `null` = vacío (se ignora); `error` = escrito mal. */
function leerRenglon(r: RenglonCorte): { corte: CorteIn | null; error: string | null } {
    const vacio = !r.cantidad.trim() && !r.largo.trim() && !r.ancho.trim();
    if (vacio && !r.textoOriginal) return { corte: null, error: null };
    const cantidad = leerCantidad(r.cantidad);
    if (cantidad === null || cantidad <= 0 || !Number.isInteger(cantidad)) {
        return { corte: null, error: "La cantidad de piezas es un número entero mayor que cero." };
    }
    const largo = r.largo.trim() ? leerCantidad(r.largo) : null;
    const ancho = r.ancho.trim() ? leerCantidad(r.ancho) : null;
    if ((r.largo.trim() && (largo === null || largo <= 0)) || (r.ancho.trim() && (ancho === null || ancho <= 0))) {
        return { corte: null, error: "El largo y el ancho van en milímetros y mayores que cero." };
    }
    return { corte: { cantidad, largo_mm: largo, ancho_mm: ancho }, error: null };
}

export interface DialogoCortesProps {
    /** La línea; null = cerrado. */
    fila: FilaMP | null;
    edita: boolean;
    /** Lo que se come la sierra por corte (sale de `catalogos`). */
    espesorSierraMm: number;
    onCerrar: () => void;
    /**
     * Guardar: los cortes (null = no cambiaron, no se mandan) y, si se tocó «Usar
     * sugerencia», la cantidad nueva de la línea.
     */
    onGuardar: (cortes: CorteIn[] | null, cantidad: { cantidad: number; unidad: string } | null) => void;
}

/**
 * Los cortes de una línea: cuántas piezas de qué largo (y ancho, en chapa). Con todos los
 * largos, sugiere cuántos metros pedir —sumando la sierra— y «Usar sugerencia» pone esa
 * cantidad en la línea. No la cambia sola: el que carga decide (a veces se compra la
 * barra entera).
 *
 * Los metros se sugieren sólo si dicen algo (`metrosQueSeMuestran`, la regla de
 * Pendientes y del botón de la fila): la línea va en metros, o ningún corte tiene ancho.
 * Con cortes de chapa en una línea en Kg no hay «Usar sugerencia»: pasarla a metros
 * sería cambiarle la unidad a una chapa.
 */
export function DialogoCortes({ fila, edita, espesorSierraMm, onCerrar, onGuardar }: DialogoCortesProps) {
    const [renglones, setRenglones] = useState<RenglonCorte[]>([]);
    const [usarSugerencia, setUsarSugerencia] = useState(false);
    const inicial = useRef<string>("");
    const contenedor = useRef<HTMLDivElement>(null);
    const [enfocarUltimo, setEnfocarUltimo] = useState(false);

    // Cada vez que se abre, con los cortes de ESA línea.
    useEffect(() => {
        if (!fila) return;
        const desdeLinea: RenglonCorte[] = fila.cortes.map((c) => ({
            clave: proximaClave++,
            cantidad: String(c.cantidad),
            largo: c.largo_mm !== null && c.largo_mm !== undefined ? aEditable(c.largo_mm) : "",
            ancho: c.ancho_mm !== null && c.ancho_mm !== undefined ? aEditable(c.ancho_mm) : "",
            textoOriginal: c.largo_mm === null || c.largo_mm === undefined ? (c.texto_original ?? null) : null,
        }));
        const lista = edita ? [...desdeLinea, renglonVacio()] : desdeLinea;
        setRenglones(lista);
        setUsarSugerencia(false);
        inicial.current = JSON.stringify(desdeLinea.map((r) => leerRenglon(r).corte));
        // Sólo al abrir (cambia la línea que se mira), no con cada dibujo de la grilla.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fila?.clave]);

    useEffect(() => {
        if (!enfocarUltimo) return;
        setEnfocarUltimo(false);
        const campos = contenedor.current?.querySelectorAll<HTMLInputElement>('input[data-campo="cantidad"]');
        campos?.[campos.length - 1]?.focus();
    }, [enfocarUltimo, renglones]);

    const leidos = renglones.map(leerRenglon);
    const error = leidos.find((x) => x.error)?.error ?? null;
    const cortes = leidos.map((x) => x.corte).filter((c): c is CorteIn => c !== null);
    const calculada = error ? null : sugerenciaMetros(cortes.map((c) => ({ cantidad: c.cantidad, largo_mm: c.largo_mm })), espesorSierraMm);
    // Con los cortes como están escritos: agregar un ancho a una línea en Kg la apaga.
    const sugerencia = metrosQueSeMuestran({ unidad: fila?.unidad, sugerido_m: calculada, cortes });
    const deChapa = calculada !== null && sugerencia === null;
    const cambiaron = JSON.stringify(cortes) !== inicial.current;
    const hayHeredados = renglones.some((r) => r.textoOriginal);
    const vaEnMetros = enMetros({ unidad: fila?.unidad });
    const cantidadNueva = usarSugerencia && sugerencia !== null ? sugerencia : null;
    const hayQueGuardar = cambiaron || (cantidadNueva !== null && (cantidadNueva !== fila?.cantidad || !vaEnMetros));

    const cambiar = (clave: number, campo: "cantidad" | "largo" | "ancho", valor: string) =>
        setRenglones((rs) => {
            const nuevos = rs.map((r) => (r.clave === clave ? { ...r, [campo]: valor } : r));
            // Escribir en el último renglón abre otro abajo: se cargan de corrido.
            const ultimo = nuevos[nuevos.length - 1];
            if (ultimo && (ultimo.cantidad || ultimo.largo || ultimo.ancho)) nuevos.push(renglonVacio());
            return nuevos;
        });

    const guardar = () => {
        if (!fila || error) return;
        onGuardar(cambiaron ? cortes : null, cantidadNueva !== null ? { cantidad: cantidadNueva, unidad: "Mts" } : null);
        onCerrar();
    };

    return (
        <Dialog open={!!fila} onOpenChange={(v) => !v && onCerrar()}>
            <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 p-0" onKeyDown={(e) => e.stopPropagation()}>
                <DialogHeader className="shrink-0 border-b border-gray-100 px-5 py-3 text-left">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Scissors className="h-4 w-4 text-violet-600" />
                        Cortes de {fila?.codigo}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        {fila?.descripcion} · la línea lleva <b>{fmtCantidad(fila?.cantidad)} {fila?.unidad ?? ""}</b>
                    </DialogDescription>
                </DialogHeader>

                <div ref={contenedor} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                    {renglones.length === 0 ? (
                        <p className="py-6 text-center text-sm text-gray-400">Esta línea no tiene cortes cargados.</p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    <th className="pb-1 pr-2 font-semibold">Piezas</th>
                                    <th className="pb-1 pr-2 font-semibold">Largo (mm)</th>
                                    <th className="pb-1 pr-2 font-semibold">Ancho (mm, opcional)</th>
                                    <th className="w-8 pb-1" />
                                </tr>
                            </thead>
                            <tbody>
                                {renglones.map((r, i) => {
                                    const esElUltimoVacio = edita && i === renglones.length - 1 && !r.cantidad && !r.largo && !r.ancho && !r.textoOriginal;
                                    if (!edita) {
                                        const c = leerRenglon(r).corte;
                                        return (
                                            <tr key={r.clave} className="border-t border-gray-100">
                                                <td colSpan={4} className="py-1.5 text-gray-700">
                                                    {c ? textoCorte({ cantidad: c.cantidad, largo_mm: c.largo_mm ?? null, ancho_mm: c.ancho_mm ?? null, texto_original: r.textoOriginal }) : r.textoOriginal}
                                                </td>
                                            </tr>
                                        );
                                    }
                                    const campo = (nombre: "cantidad" | "largo" | "ancho", placeholder: string) => (
                                        <input
                                            data-campo={nombre}
                                            inputMode={nombre === "cantidad" ? "numeric" : "decimal"}
                                            autoComplete="off"
                                            value={r[nombre]}
                                            placeholder={placeholder}
                                            onChange={(e) => cambiar(r.clave, nombre, e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    // Enter pasa al renglón de abajo (el que se abrió solo).
                                                    setEnfocarUltimo(true);
                                                }
                                            }}
                                            aria-label={`${nombre === "cantidad" ? "Piezas" : nombre === "largo" ? "Largo en mm" : "Ancho en mm"}, renglón ${i + 1}`}
                                            className="h-8 w-full rounded-md border border-gray-200 px-2 text-right tabular-nums outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                        />
                                    );
                                    return (
                                        <tr key={r.clave} className="align-top">
                                            <td className="w-24 py-1 pr-2">{campo("cantidad", "0")}</td>
                                            <td className="py-1 pr-2">
                                                {campo("largo", r.textoOriginal ? `(viejo: ${r.textoOriginal})` : "")}
                                            </td>
                                            <td className="py-1 pr-2">{campo("ancho", "")}</td>
                                            <td className="py-1 text-right">
                                                {!esElUltimoVacio && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setRenglones((rs) => rs.filter((x) => x.clave !== r.clave))}
                                                        aria-label={`Sacar el renglón ${i + 1}`}
                                                        title="Sacar este corte"
                                                        className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}

                    {hayHeredados && edita && (
                        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                            Hay cortes que vinieron escritos del sistema viejo y no se pudieron leer como medida. Si
                            cambiás los cortes, poneles el largo: el texto viejo no se guarda de nuevo.
                        </p>
                    )}
                    {error && <p className="text-xs text-rose-700" role="alert">{error}</p>}

                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                        {sugerencia !== null ? (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <span>
                                    Sugerido: <b className="text-sm tabular-nums">{fmtCantidad(sugerencia)} m</b>{" "}
                                    <span className="text-gray-500">
                                        (cada corte + {fmtCantidad(espesorSierraMm)} mm de sierra, redondeado para arriba)
                                    </span>
                                </span>
                                {edita && (
                                    usarSugerencia ? (
                                        <span className="inline-flex items-center gap-2 text-green-700">
                                            La línea pasa a {fmtCantidad(sugerencia)} Mts
                                            <button type="button" onClick={() => setUsarSugerencia(false)} className="text-gray-500 underline hover:text-gray-700">
                                                deshacer
                                            </button>
                                        </span>
                                    ) : (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs"
                                            disabled={vaEnMetros && sugerencia === fila?.cantidad}
                                            onClick={() => setUsarSugerencia(true)}
                                            title={vaEnMetros ? "Poner esta cantidad en la línea" : `La línea va en ${fila?.unidad ?? "otra unidad"}: pasa a metros con esta cantidad`}
                                        >
                                            Usar sugerencia{vaEnMetros ? "" : " (pasa a Mts)"}
                                        </Button>
                                    )
                                )}
                            </div>
                        ) : (
                            <span className="text-gray-500">
                                {deChapa
                                    ? `Son cortes de chapa (con ancho) y la línea va en ${fila?.unidad?.trim() || "unidades"}, no en metros: no se sugieren metros.`
                                    : cortes.length
                                        ? "Para sugerir cuántos metros pedir, todos los cortes tienen que tener largo."
                                        : "Cargá los cortes (piezas × largo) y te sugiere cuántos metros pedir."}
                            </span>
                        )}
                    </div>
                </div>

                <DialogFooter className="shrink-0 gap-2 border-t border-gray-100 px-5 py-3">
                    <Button type="button" variant="outline" onClick={onCerrar}>
                        {edita ? "Cancelar" : "Cerrar"}
                    </Button>
                    {edita && (
                        <Button type="button" onClick={guardar} disabled={!!error || !hayQueGuardar} className="bg-blue-600 text-white hover:bg-blue-700">
                            Guardar
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ═══════════════════════════ traer historial ═══════════════════════════

export interface DialogoHistorialProps {
    abierto: boolean;
    onCerrar: () => void;
    /** Pide la vista previa (no escribe nada). */
    cargar: () => Promise<MpRespuesta<HistorialOT>>;
    /** Cuántas líneas tiene ya la OT (las del historial se SUMAN). */
    yaHay: number;
    /** Agrega las elegidas. Devuelve si quedaron (si no, el diálogo sigue abierto). */
    onAgregar: (lineas: LineaHistorial[]) => Promise<boolean> | boolean;
}

/**
 * «Traer historial»: las materias primas de la última OT del mismo producto, ya
 * multiplicadas por el factor (unidades de ésta / unidades de aquélla). Se leen ANTES de
 * aceptar —de qué OT salen, con qué factor, qué líneas— y se puede sacar alguna. Se
 * SUMAN a las que ya hay (no las reemplazan: acá no se pierde nada). Marcas y
 * observaciones no se copian: son de aquella compra.
 */
export function DialogoHistorial({ abierto, onCerrar, cargar, yaHay, onAgregar }: DialogoHistorialProps) {
    const [datos, setDatos] = useState<HistorialOT | null>(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fuera, setFuera] = useState<Set<number>>(new Set());
    const [agregando, setAgregando] = useState(false);
    const cargarRef = useRef(cargar);
    cargarRef.current = cargar;

    useEffect(() => {
        if (!abierto) return;
        let vigente = true;
        setDatos(null);
        setError(null);
        setFuera(new Set());
        setCargando(true);
        void cargarRef.current().then((r) => {
            if (!vigente) return;
            setCargando(false);
            if (!r.ok || !r.data) {
                setError(r.error ?? "No se pudo traer el historial.");
                return;
            }
            setDatos({ ...r.data, lineas: Array.isArray(r.data.lineas) ? r.data.lineas : [] });
        });
        return () => {
            vigente = false;
        };
    }, [abierto]);

    const elegidas = useMemo(() => (datos?.lineas ?? []).filter((_, i) => !fuera.has(i)), [datos, fuera]);

    const agregar = async () => {
        if (!elegidas.length) return;
        setAgregando(true);
        const ok = await onAgregar(elegidas);
        setAgregando(false);
        if (ok) onCerrar();
    };

    const o = datos?.origen ?? null;
    const factor = datos?.factor ?? 1;

    return (
        <Dialog open={abierto} onOpenChange={(v) => !v && !agregando && onCerrar()}>
            <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-3xl flex-col gap-0 p-0" onKeyDown={(e) => e.stopPropagation()}>
                <DialogHeader className="shrink-0 border-b border-gray-100 px-5 py-3 text-left">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <History className="h-4 w-4 text-blue-600" />
                        Traer historial de materias primas
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Las de la última OT de este mismo producto, escaladas a las unidades de ésta.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {cargando ? (
                        <p className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Buscando la última OT de este producto…
                        </p>
                    ) : error ? (
                        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
                    ) : !o ? (
                        <p className="py-10 text-center text-sm text-gray-500">
                            No hay otra OT de este producto con materias primas cargadas.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-900">
                                <span>
                                    De la <b>OT N° {o.numero_ot ?? o.id}</b>
                                    {o.fecha_ot ? ` del ${fmtFecha(o.fecha_ot)}` : ""}
                                    {o.unidades ? ` (${fmtCantidad(o.unidades)} unidades)` : ""}
                                </span>
                                <span>
                                    Factor <b className="tabular-nums">×{fmtCantidad(factor)}</b>
                                    {factor === 1 ? " (se copian las cantidades tal cual)" : " (las cantidades ya están multiplicadas)"}
                                </span>
                            </div>
                            {datos!.lineas.length === 0 ? (
                                <p className="py-6 text-center text-sm text-gray-500">Esa OT no tiene líneas con cantidad para copiar.</p>
                            ) : (
                                <div className="overflow-x-auto rounded-lg border border-gray-200">
                                    <table className="w-full min-w-[560px] text-xs">
                                        <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
                                            <tr>
                                                <th className="w-8 px-2 py-1.5">
                                                    <input
                                                        type="checkbox"
                                                        checked={fuera.size === 0}
                                                        onChange={(e) => setFuera(e.target.checked ? new Set() : new Set(datos!.lineas.map((_, i) => i)))}
                                                        aria-label="Todas"
                                                        className="h-4 w-4"
                                                    />
                                                </th>
                                                <th className="px-2 py-1.5">Código</th>
                                                <th className="px-2 py-1.5">Descripción</th>
                                                <th className="px-2 py-1.5 text-right">Cant.</th>
                                                <th className="px-2 py-1.5">Un.</th>
                                                <th className="px-2 py-1.5">Proveedor</th>
                                                <th className="px-2 py-1.5">Cortes</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {datos!.lineas.map((l, i) => {
                                                const va = !fuera.has(i);
                                                return (
                                                    <tr key={i} className={cn("border-t border-gray-100", !va && "text-gray-400 line-through")}>
                                                        <td className="px-2 py-1.5">
                                                            <input
                                                                type="checkbox"
                                                                checked={va}
                                                                onChange={() =>
                                                                    setFuera((f) => {
                                                                        const n = new Set(f);
                                                                        if (n.has(i)) n.delete(i);
                                                                        else n.add(i);
                                                                        return n;
                                                                    })
                                                                }
                                                                aria-label={`Traer ${l.codigo}`}
                                                                className="h-4 w-4"
                                                            />
                                                        </td>
                                                        <td className="px-2 py-1.5 font-mono font-bold">{l.codigo}</td>
                                                        <td className="max-w-[240px] truncate px-2 py-1.5" title={l.descripcion}>{l.descripcion}</td>
                                                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtCantidad(l.cantidad)}</td>
                                                        <td className="px-2 py-1.5">{l.unidad ?? "—"}</td>
                                                        <td className="max-w-[140px] truncate px-2 py-1.5" title={l.proveedor ?? ""}>{l.proveedor ?? "—"}</td>
                                                        <td className="px-2 py-1.5 text-gray-600" title={(l.cortes ?? []).map((c) => textoCorte({ cantidad: c.cantidad, largo_mm: c.largo_mm ?? null, ancho_mm: c.ancho_mm ?? null })).join("\n")}>
                                                            {(l.cortes ?? []).length ? `${l.cortes.length} corte${l.cortes.length === 1 ? "" : "s"}` : "—"}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <p className="text-[11px] text-gray-500">
                                {yaHay > 0
                                    ? `Se SUMAN a las ${yaHay} que ya tiene esta OT (no las reemplazan). `
                                    : ""}
                                Pedido, reserva, disponible y observaciones no se copian: son de aquella compra.
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter className="shrink-0 gap-2 border-t border-gray-100 px-5 py-3">
                    <Button type="button" variant="outline" onClick={onCerrar} disabled={agregando}>
                        Cancelar
                    </Button>
                    {o && elegidas.length > 0 && (
                        <Button type="button" onClick={() => void agregar()} disabled={agregando} className="bg-blue-600 text-white hover:bg-blue-700">
                            {agregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Agregar {elegidas.length === 1 ? "esta línea" : `estas ${elegidas.length} líneas`}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
