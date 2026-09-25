"use client";

/**
 * «Nuevo › Pedido a proveedor»: armar un pedido como lo arma Maxi.
 *
 * En la reunión con Lucas quedó claro que en el sistema viejo «hacer un pedido» no es un
 * documento aparte: es tildar PEDIDO en las líneas de las OT que faltan, con el proveedor
 * al que se le encargó y la fecha que prometió. Maxi llama a un proveedor, le dicta lo que
 * le falta de varias OT, y marca esas líneas. Eso mismo hace este diálogo, sin salir a
 * buscar las líneas por la grilla de Pendientes:
 *
 *  1. Se elige el proveedor (o se dejan todos). Se ven las líneas que FALTAN PEDIR de
 *     todas las OT abiertas (`estadoLinea` = «falta pedir»: ni pedidas, ni disponibles, ni
 *     cubiertas por una reserva) que ya son de ese proveedor o no tienen ninguno. Las de
 *     otros proveedores se pueden sumar (a veces se le compra a otro).
 *  2. Se tildan las que se le encargaron, la fecha que prometió y, si hace falta, una nota.
 *  3. «Marcar pedido» las marca en UN pedido (`PUT /materia-prima/lineas/lote`, todas o
 *     ninguna, como la barra de acciones de Pendientes) con `pedido`, el proveedor y la
 *     fecha. Salen de la lista al instante; si el servidor no las acepta, vuelven.
 *  4. «Imprimir» saca la lista para dictar o mandar: la hoja «por proveedor» de Pendientes
 *     (PendientesImprimir.ts) con las tildadas (o todas las que se ven), con la nota y la
 *     fecha arriba. Imprimir no escribe nada: anda también en modo práctica.
 *
 * La NOTA va sólo en la hoja: el lote no tiene observaciones (cada línea tiene la suya, de
 * Carolina, y pisarla con la del pedido borraría lo que ella anotó).
 *
 * El diálogo queda abierto después de marcar: lo normal es seguir con el próximo
 * proveedor. Modo práctica (prueba piloto): se recorre entero; al marcar, el candado de
 * `mpFetch` lo frena y saca su cartelito («Esto no se guarda»), y las líneas vuelven a
 * su lugar, tildadas.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Search, Truck, X } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    consulta,
    estadoLinea,
    fmtCantidad,
    fmtFecha,
    fmtFechaCorta,
    mpGet,
    mpPut,
    type CambiosDeLote,
    type CambiosLoteIn,
    type Linea,
    type LineaPendiente,
    type Pendientes,
    type ProveedorElegido,
} from "@/lib/materiaPrima";
import { CartelError, CartelSinServidor, Esqueleto, Rotulo, Vacio } from "./InsumoComun";
import { SelectorProveedor } from "./SelectorProveedor";
import { useConfirmarForzar } from "./PendientesForzar";
import { imprimirPorProveedor } from "./PendientesImprimir";
import { textoCortes } from "./PendientesCortes";
import { avisarCargaMP, frenadoPorPractica } from "./NuevoAvisos";
import { PildoraPractica } from "./NuevoComun";

/** Para comparar proveedores escritos a mano: sin mayúsculas ni espacios de más (el mismo criterio de Pendientes). */
const normal = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Una línea que no tiene proveedor: ni del catálogo ni escrito a mano. */
const sinProveedor = (l: LineaPendiente) => l.id_proveedor == null && !normal(l.proveedor);

type Grupo = { clave: string; titulo: string; lineas: LineaPendiente[] };

export interface NuevoPedidoDialogProps {
    open: boolean;
    onClose: () => void;
    practica: boolean;
}

export function NuevoPedidoDialog({ open, onClose, practica }: NuevoPedidoDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="flex h-[92dvh] w-[calc(100%-1rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
                {/* `pr-12`: que el título (con la píldora de modo práctica) no se meta abajo de la X en el teléfono. */}
                <DialogHeader className="shrink-0 border-b border-gray-100 py-3 pl-5 pr-12 text-left">
                    <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
                        Pedido a proveedor
                        {practica && <PildoraPractica />}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Lo que falta pedir de las OT abiertas: tildá lo que le encargaste, la fecha que prometió, y «Marcar pedido».
                    </DialogDescription>
                </DialogHeader>
                {/* Se monta con el contenido del diálogo: cada apertura vuelve a pedir lo que falta. */}
                <ArmadoDelPedido onClose={onClose} />
            </DialogContent>
        </Dialog>
    );
}

function ArmadoDelPedido({ onClose }: { onClose: () => void }) {
    const { confirmar, dialogo } = useConfirmarForzar();

    const [lineas, setLineas] = useState<LineaPendiente[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);
    const [cargando, setCargando] = useState(true);

    const [proveedor, setProveedor] = useState<ProveedorElegido>({ id: null, nombre: null });
    const [otros, setOtros] = useState(false);
    const [texto, setTexto] = useState("");
    const [elegidas, setElegidas] = useState<Set<number>>(() => new Set());
    /** Las que se acaban de marcar: fuera de la lista ya, antes de que conteste el servidor. */
    const [ocultas, setOcultas] = useState<Set<number>>(() => new Set());
    const [fecha, setFecha] = useState("");
    const [nota, setNota] = useState("");
    const [guardando, setGuardando] = useState(false);

    // Todas las OT abiertas y no la semana: el que compra le encarga al proveedor todo lo
    // que le falta, sea de esta semana o de la que viene. «pendientes» ya deja afuera lo
    // disponible; lo pedido y lo reservado entero se sacan acá (ver `faltan`).
    const cargar = useCallback(async (signal?: AbortSignal) => {
        setCargando(true);
        const r = await mpGet<Pendientes>(
            `${API_URL}/materia-prima/pendientes?${consulta({ todas_abiertas: true, filtro: "pendientes" })}`,
            { signal },
        );
        if (r.abortado) return;
        setCargando(false);
        setSinServidor(r.sinServidor);
        if (!r.ok || !r.data) {
            setError(r.error ?? "No se pudieron traer las líneas que faltan pedir.");
            return;
        }
        setError(null);
        setLineas(Array.isArray(r.data.lineas) ? r.data.lineas.map((l) => ({ ...l, cortes: l.cortes ?? [], celdas: l.celdas ?? [] })) : []);
    }, []);

    useEffect(() => {
        const c = new AbortController();
        void cargar(c.signal);
        return () => c.abort();
    }, [cargar]);

    const hayProveedor = !!proveedor.nombre;
    const esDelProveedor = useCallback(
        (l: LineaPendiente) =>
            hayProveedor &&
            ((proveedor.id !== null && l.id_proveedor === proveedor.id) || normal(l.proveedor) === normal(proveedor.nombre)),
        [hayProveedor, proveedor.id, proveedor.nombre],
    );

    /** Lo que falta pedir, sin lo recién marcado. */
    const faltan = useMemo(
        () => (lineas ?? []).filter((l) => estadoLinea(l) === "falta_pedir" && !ocultas.has(l.id)),
        [lineas, ocultas],
    );

    /** Los grupos que se ven: por proveedor, con el elegido arriba. */
    const grupos = useMemo<Grupo[]>(() => {
        const tokens = normal(texto).split(" ").filter(Boolean);
        const pasa = (l: LineaPendiente) => {
            if (!tokens.length) return true;
            const heno = normal([l.numero_ot, l.codigo, l.descripcion, l.proveedor, l.observaciones].join(" "));
            return tokens.every((t) => heno.includes(t));
        };
        const porOT = (a: LineaPendiente, b: LineaPendiente) =>
            (a.numero_ot ?? Infinity) - (b.numero_ot ?? Infinity) || (a.orden ?? 0) - (b.orden ?? 0) || a.id - b.id;
        const visibles = faltan.filter(pasa);

        if (hayProveedor) {
            const del = visibles.filter(esDelProveedor).sort(porOT);
            const sin = visibles.filter((l) => !esDelProveedor(l) && sinProveedor(l)).sort(porOT);
            const resto = otros ? visibles.filter((l) => !esDelProveedor(l) && !sinProveedor(l)).sort(porOT) : [];
            return [
                { clave: "del", titulo: `De ${proveedor.nombre}`, lineas: del },
                { clave: "sin", titulo: "Sin proveedor", lineas: sin },
                { clave: "otros", titulo: "De otros proveedores (se le pasan a éste)", lineas: resto },
            ].filter((g) => g.lineas.length > 0);
        }
        // Todos: un grupo por proveedor, alfabético, y «Sin proveedor» al final.
        const mapa = new Map<string, Grupo>();
        for (const l of visibles) {
            const clave = normal(l.proveedor) || "~";
            let g = mapa.get(clave);
            if (!g) {
                g = { clave, titulo: l.proveedor?.trim() || "Sin proveedor", lineas: [] };
                mapa.set(clave, g);
            }
            g.lineas.push(l);
        }
        return [...mapa.values()]
            .map((g) => ({ ...g, lineas: g.lineas.sort(porOT) }))
            .sort((a, b) => (a.clave === "~" ? 1 : b.clave === "~" ? -1 : a.titulo.localeCompare(b.titulo, "es")));
    }, [faltan, texto, hayProveedor, esDelProveedor, otros, proveedor.nombre]);

    const visibles = useMemo(() => grupos.flatMap((g) => g.lineas), [grupos]);
    // Las de otros proveedores que no se ven (para ofrecer sumarlas).
    const deOtros = hayProveedor ? faltan.filter((l) => !esDelProveedor(l) && !sinProveedor(l)).length : 0;

    // Lo elegido que dejó de verse (se cambió de proveedor o de búsqueda) no se marca: se
    // marca lo que se ve tildado, nada escondido.
    const elegidasVisibles = visibles.filter((l) => elegidas.has(l.id));
    const otsElegidas = new Set(elegidasVisibles.map((l) => l.id_orden_trabajo)).size;

    const alternar = (ids: number[], si: boolean) =>
        setElegidas((e) => {
            const n = new Set(e);
            ids.forEach((id) => (si ? n.add(id) : n.delete(id)));
            return n;
        });

    const marcar = async () => {
        const ids = elegidasVisibles.map((l) => l.id);
        if (!ids.length || guardando) return;
        const cambios: CambiosDeLote = { pedido: true };
        if (proveedor.nombre) {
            cambios.id_proveedor = proveedor.id;
            cambios.proveedor = proveedor.nombre;
        }
        if (esFecha(fecha)) cambios.fecha_proveedor = fecha;
        const url = `${API_URL}/materia-prima/lineas/lote`;
        const cuerpo: CambiosLoteIn = { ids, cambios };

        // Optimista: salen de la lista ya; si el servidor no las acepta, vuelven tildadas.
        const volver = () => {
            setOcultas((o) => {
                const n = new Set(o);
                ids.forEach((id) => n.delete(id));
                return n;
            });
            alternar(ids, true);
        };
        setOcultas((o) => new Set([...o, ...ids]));
        alternar(ids, false);
        setGuardando(true);
        try {
            let r = await mpPut<Linea[]>(url, cuerpo);
            if (r.requiereConfirmacion) {
                const si = await confirmar({
                    titulo: `Marcar pedido (${ids.length} línea${ids.length === 1 ? "" : "s"})`,
                    motivo: r.error ?? "",
                });
                if (!si) {
                    volver();
                    return;
                }
                r = await mpPut<Linea[]>(url, cuerpo, { forzar: true });
            }
            // Modo práctica: el cartelito ya salió (lo muestra el candado); las líneas vuelven
            // tildadas, en silencio, para seguir probando.
            if (frenadoPorPractica(r)) {
                volver();
                return;
            }
            if (!r.ok) {
                volver();
                toast.error(`Marcar pedido: no se guardó ninguna. ${r.error ?? "El servidor no contestó."}`);
                return;
            }
            toast.success(
                `${ids.length === 1 ? "1 línea marcada pedida" : `${ids.length} líneas marcadas pedidas`}${proveedor.nombre ? ` a ${proveedor.nombre}` : ""}`,
                { description: esFecha(fecha) ? `Prometió el ${fmtFecha(fecha)}` : undefined },
            );
            avisarCargaMP(["pendientes"]);
        } finally {
            setGuardando(false);
        }
    };

    const imprimir = () => {
        const salen = elegidasVisibles.length ? elegidasVisibles : visibles;
        if (!salen.length) return;
        // Las que se le encargan a este proveedor salen bajo su nombre, aunque hoy digan
        // otro o ninguno: es la lista de lo que se le pide a él.
        const filas = salen.map((l) => ({
            linea: proveedor.nombre ? { ...l, proveedor: proveedor.nombre } : l,
            celdas: l.celdas ?? [],
        }));
        const nOts = new Set(salen.map((l) => l.id_orden_trabajo)).size;
        const subtitulo =
            `${salen.length} línea${salen.length === 1 ? "" : "s"} de ${nOts} OT` +
            (esFecha(fecha) ? ` · prometido para el ${fmtFecha(fecha)}` : "");
        const filtros = [nota.trim() ? `Nota: ${nota.trim()}` : "", elegidasVisibles.length ? "" : "Todas las que faltan pedir"].filter(Boolean);
        imprimirPorProveedor(filas, proveedor.nombre ? `Pedido a ${proveedor.nombre}` : "Lista para pedir", subtitulo, filtros, {
            soloFalta: true,
        });
    };

    const todasTildadas = visibles.length > 0 && visibles.every((l) => elegidas.has(l.id));

    return (
        <>
            {dialogo}
            {/* Arriba: a quién se le pide y qué se busca. */}
            <div className="shrink-0 space-y-2 border-b border-gray-100 px-5 py-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                    <div className="min-w-0">
                        <Rotulo htmlFor="nuevo-pedido-proveedor">Proveedor</Rotulo>
                        <SelectorProveedor
                            id="nuevo-pedido-proveedor"
                            valor={proveedor}
                            onCambiar={setProveedor}
                            permitirTextoLibre
                            placeholder="Todos los proveedores"
                        />
                    </div>
                    <div className="min-w-0">
                        <Rotulo htmlFor="nuevo-pedido-buscar">Buscar</Rotulo>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <Input
                                id="nuevo-pedido-buscar"
                                value={texto}
                                onChange={(e) => setTexto(e.target.value)}
                                placeholder="N° OT, código o descripción…"
                                className="h-9 bg-white pl-8"
                            />
                            {texto && (
                                <button
                                    type="button"
                                    onClick={() => setTexto("")}
                                    aria-label="Vaciar la búsqueda"
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                {hayProveedor && deOtros > 0 && (
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-600">
                        <input
                            type="checkbox"
                            checked={otros}
                            onChange={(e) => setOtros(e.target.checked)}
                            className="h-3.5 w-3.5 accent-[#DC143C]"
                        />
                        Mostrar también {deOtros === 1 ? "la de otro proveedor" : `las ${deOtros} de otros proveedores`}
                    </label>
                )}
            </div>

            {/* La lista */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                {sinServidor ? (
                    <CartelSinServidor />
                ) : error && !lineas ? (
                    <CartelError mensaje={error} onReintentar={() => void cargar()} />
                ) : !lineas ? (
                    <Esqueleto filas={6} />
                ) : visibles.length === 0 ? (
                    <Vacio titulo={texto ? "Nada con esa búsqueda" : hayProveedor ? `No falta pedir nada a ${proveedor.nombre}` : "No falta pedir nada"}>
                        {texto
                            ? "Probá con otro número de OT, código o descripción."
                            : hayProveedor && deOtros > 0 && !otros
                              ? `Hay ${deOtros} línea${deOtros === 1 ? "" : "s"} de otros proveedores: tildá «Mostrar también» para pasárselas a éste.`
                              : "Todas las líneas de las OT abiertas están pedidas, reservadas o disponibles."}
                    </Vacio>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full min-w-[640px] text-xs">
                            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="w-8 px-2 py-1.5">
                                        <input
                                            type="checkbox"
                                            aria-label="Tildar todas"
                                            checked={todasTildadas}
                                            onChange={(e) => alternar(visibles.map((l) => l.id), e.target.checked)}
                                            className="h-3.5 w-3.5 align-middle accent-[#DC143C]"
                                        />
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-semibold">OT</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Código</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Descripción</th>
                                    <th className="px-2 py-1.5 text-right font-semibold">Falta</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Proveedor</th>
                                </tr>
                            </thead>
                            {grupos.map((g) => {
                                const ids = g.lineas.map((l) => l.id);
                                const todas = ids.every((id) => elegidas.has(id));
                                return (
                                    <tbody key={g.clave} className="divide-y divide-gray-100">
                                        <tr className="bg-gray-50/70">
                                            <td className="px-2 py-1">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`Tildar las de ${g.titulo}`}
                                                    checked={todas}
                                                    onChange={(e) => alternar(ids, e.target.checked)}
                                                    className="h-3.5 w-3.5 align-middle accent-[#DC143C]"
                                                />
                                            </td>
                                            <td colSpan={5} className="px-2 py-1 text-[11px] font-semibold text-gray-700">
                                                {g.titulo} <span className="font-normal text-gray-400">· {g.lineas.length}</span>
                                            </td>
                                        </tr>
                                        {g.lineas.map((l) => (
                                            <FilaPedido
                                                key={l.id}
                                                linea={l}
                                                elegida={elegidas.has(l.id)}
                                                onAlternar={(si) => alternar([l.id], si)}
                                            />
                                        ))}
                                    </tbody>
                                );
                            })}
                        </table>
                    </div>
                )}
                {cargando && lineas && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
                        <Loader2 className="h-3 w-3 animate-spin" /> Actualizando…
                    </p>
                )}
            </div>

            {/* Abajo: la fecha, la nota y los botones. */}
            <div className="shrink-0 space-y-2 border-t border-gray-100 bg-white px-5 py-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <div>
                        <Rotulo htmlFor="nuevo-pedido-fecha">Fecha que prometió</Rotulo>
                        <Input
                            id="nuevo-pedido-fecha"
                            type="date"
                            value={fecha}
                            onChange={(e) => setFecha(e.target.value)}
                            className="h-9 bg-white"
                        />
                    </div>
                    <div className="min-w-0">
                        <Rotulo htmlFor="nuevo-pedido-nota">
                            Nota <span className="font-normal normal-case tracking-normal text-gray-400">(opcional, sale en la hoja impresa)</span>
                        </Rotulo>
                        <Input
                            id="nuevo-pedido-nota"
                            value={nota}
                            onChange={(e) => setNota(e.target.value)}
                            placeholder="Retira el flete el jueves, pedir cortado…"
                            className="h-9 bg-white"
                        />
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <p className="mr-auto text-xs text-gray-500">
                        {elegidasVisibles.length
                            ? `${elegidasVisibles.length} línea${elegidasVisibles.length === 1 ? "" : "s"} de ${otsElegidas} OT`
                            : "Tildá las líneas que le encargaste"}
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={guardando}>
                        Cerrar
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={imprimir}
                        disabled={!visibles.length}
                        title={elegidasVisibles.length ? "Imprimir las tildadas" : "Imprimir todas las que se ven"}
                    >
                        <Printer className="h-4 w-4" />
                        Imprimir
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => void marcar()}
                        disabled={!elegidasVisibles.length || guardando}
                        className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                    >
                        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                        Marcar pedido{elegidasVisibles.length ? ` (${elegidasVisibles.length})` : ""}
                    </Button>
                </div>
            </div>
        </>
    );
}

function FilaPedido({ linea: l, elegida, onAlternar }: { linea: LineaPendiente; elegida: boolean; onAlternar: (si: boolean) => void }) {
    const cortes = textoCortes(l.cortes);
    const parcial = l.reserva && l.falta < l.cantidad;
    return (
        <tr
            onClick={() => onAlternar(!elegida)}
            className={cn("cursor-pointer transition-colors hover:bg-red-50/40", elegida && "bg-red-50/60")}
        >
            <td className="px-2 py-1.5 align-top">
                <input
                    type="checkbox"
                    aria-label={`Tildar ${l.codigo} de la OT ${l.numero_ot ?? ""}`}
                    checked={elegida}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onAlternar(e.target.checked)}
                    className="h-3.5 w-3.5 align-middle accent-[#DC143C]"
                />
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 align-top">
                <span className="font-semibold text-gray-900">{l.numero_ot ?? "—"}</span>
                {l.fecha_requerida && <span className="block text-[10px] text-gray-400">nec. {fmtFechaCorta(l.fecha_requerida)}</span>}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 align-top font-mono font-semibold text-gray-800">{l.codigo}</td>
            <td className="px-2 py-1.5 align-top text-gray-800">
                {l.descripcion}
                {cortes && <span className="block text-[10px] text-violet-700">✂ {cortes}</span>}
                {l.observaciones && <span className="block text-[10px] italic text-gray-500">{l.observaciones}</span>}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right align-top tabular-nums">
                <span className="font-semibold text-red-700">{fmtCantidad(l.falta)}</span> <span className="text-gray-500">{l.unidad ?? ""}</span>
                {parcial && <span className="block text-[10px] text-gray-400">de {fmtCantidad(l.cantidad)} (resto reservado)</span>}
            </td>
            <td className="px-2 py-1.5 align-top text-gray-600">{l.proveedor ?? <span className="text-gray-300">—</span>}</td>
        </tr>
    );
}

export default NuevoPedidoDialog;
