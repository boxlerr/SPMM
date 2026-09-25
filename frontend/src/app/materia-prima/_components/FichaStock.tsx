"use client";

/**
 * Solapa Stock de la ficha de un insumo: cuánto hay, cómo se llegó a eso y quién lo
 * tiene apartado.
 *
 * EL STOCK ES LA SUMA DE LOS MOVIMIENTOS
 *
 * Desde el 23/09 el stock de SPMM no es un número que alguien pisa: es la suma de los
 * movimientos de esta solapa (ingresos, egresos, ajustes y los retiros que genera pasar
 * a «Disponible» una línea reservada de una OT). Es lo mismo que mostraba la solapa
 * Stock del sistema viejo, y por eso se importaron sus 161 movimientos. Un movimiento
 * equivocado no se borra: se ANULA con un motivo y queda tachado, así el saldo de hoy
 * se puede explicar renglón por renglón.
 *
 *  · Físico    = la suma de los movimientos no anulados.
 *  · Reservado = lo que tienen apartado las OT (reservas que todavía no se retiraron).
 *  · Libre     = físico − reservado: lo que de verdad se puede usar.
 *
 * Los números los calcula el backend; acá se muestran. Al cargar o anular, la tabla y
 * las tarjetas cambian al instante con la cuenta hecha acá (optimista) y después se
 * reemplazan por la respuesta del backend, que es la que vale; si falla, vuelven a como
 * estaban y se avisa.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ban, Loader2, PackagePlus, Undo2, X } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    ahoraISO,
    fmtCantidad,
    fmtFechaHora,
    frenarPorPractica,
    leerCantidad,
    mpGet,
    mpPost,
    mpPut,
    ROTULO_MOVIMIENTO,
    usuarioActual,
    type AnularIn,
    type InsumoFicha,
    type Movimiento,
    type MovimientoIn,
    type Movimientos,
    type TipoMovimientoManual,
} from "@/lib/materiaPrima";
import { AvisoConfirmacion, CartelError, CartelSinServidor, Esqueleto, Rotulo, Segmentado, Tarjeta, Vacio, enlaceOT } from "./InsumoComun";

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * El 409 de «el stock queda en negativo», con el saldo escrito como en la pantalla.
 *
 * El backend arma el número con el formato de las medidas de la descripción, que va con
 * punto («queda en -3.64»), y acá todo se lee con coma («-3,64»): en el mismo formulario
 * decía una cosa arriba y otra en la pregunta (E2E del 24/09). Se deja el texto del
 * backend (el saldo es el de la base, que puede no ser el que ve esta pantalla si alguien
 * movió stock recién) y sólo se reescribe ese número. Si el texto cambia y no aparece, va
 * tal cual. No se tocan los otros números del mensaje: una descripción («38.1mm») se
 * escribe con punto a propósito.
 */
const conSaldoLegible = (motivo: string) =>
    motivo.replace(/(queda en )(-?\d+(?:\.\d+)?)(?![\d.,])/, (_m, antes: string, n: string) => antes + fmtCantidad(Number(n)));

/**
 * Vuelve a hacer la cuenta de los saldos y del físico sobre la lista (para mostrar un
 * cambio antes de que conteste el backend). Es la misma cuenta del backend: saldo
 * acumulado de los no anulados, del más viejo al más nuevo.
 */
function recontar(d: Movimientos): Movimientos {
    let saldo = 0;
    const movimientos = d.movimientos.map((m) => {
        if (m.anulado) return { ...m, saldo: null };
        saldo = redondear3(saldo + (m.ingreso ?? 0) - (m.egreso ?? 0));
        return { ...m, saldo };
    });
    return { ...d, movimientos, fisico: saldo, libre: redondear3(saldo - d.reservado) };
}

export interface FichaStockProps {
    ficha: InsumoFicha;
    edita: boolean;
    /** El stock cambió (cargar o anular): para la fila de la lista y la cabecera de la ficha. */
    onCambio: (d: Movimientos) => void;
}

export function FichaStock({ ficha, edita, onCambio }: FichaStockProps) {
    const [datos, setDatos] = useState<Movimientos | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);
    const [formAbierto, setFormAbierto] = useState(false);
    /** El movimiento que se está anulando (se pide el motivo en su renglón). */
    const [anulando, setAnulando] = useState<number | null>(null);

    const alCambio = useRef(onCambio);
    useEffect(() => {
        alCambio.current = onCambio;
    });

    const cargar = useCallback(async (signal?: AbortSignal) => {
        setCargando(true);
        const r = await mpGet<Movimientos>(`${API_URL}/materia-prima/insumos/${ficha.id}/movimientos`, { signal });
        if (r.abortado) return;
        setCargando(false);
        setSinServidor(r.sinServidor);
        if (!r.ok || !r.data) {
            setError(r.error ?? "No se pudieron traer los movimientos.");
            return;
        }
        setError(null);
        setDatos({ ...r.data, movimientos: r.data.movimientos ?? [], reservas: r.data.reservas ?? [] });
    }, [ficha.id]);

    useEffect(() => {
        const c = new AbortController();
        void cargar(c.signal);
        return () => c.abort();
    }, [cargar]);

    /** Pone la respuesta del backend (o la cuenta optimista) y avisa afuera. */
    const poner = (d: Movimientos) => {
        setDatos(d);
        alCambio.current(d);
    };

    // ─────────────── anular ───────────────

    const anular = async (m: Movimiento, motivo: string) => {
        if (!datos) return;
        // Modo práctica: la pregunta de anular queda abierta con el motivo escrito.
        if (frenarPorPractica()) return;
        const antes = datos;
        setAnulando(null);
        poner(recontar({
            ...datos,
            movimientos: datos.movimientos.map((x) => (x.id === m.id ? { ...x, anulado: true, motivo_anulacion: motivo || null } : x)),
        }));
        const cuerpo: AnularIn = { motivo: motivo.trim() || null };
        const r = await mpPut<Movimientos>(`${API_URL}/materia-prima/movimientos/${m.id}/anular`, cuerpo);
        if (!r.ok || !r.data) {
            poner(antes);
            if (!r.practica) toast.error(`No se anuló el movimiento: ${r.error ?? "error desconocido"}`);
            return;
        }
        poner({ ...r.data, movimientos: r.data.movimientos ?? [], reservas: r.data.reservas ?? [] });
        toast.success("Movimiento anulado");
    };

    // Del más nuevo al más viejo: lo que se busca casi siempre es lo último. El saldo de
    // cada renglón sigue siendo el acumulado hasta ese momento.
    const renglones = useMemo(() => (datos ? [...datos.movimientos].reverse() : []), [datos]);
    const minimo = ficha.stock_minimo;
    const unidad = ficha.unidad ?? "";

    if (sinServidor) return <CartelSinServidor className="m-4" />;
    if (error && !datos) return <CartelError className="m-4" mensaje={error} onReintentar={() => void cargar()} />;

    return (
        // `@container`: se acomoda al ancho del panel de la ficha, no al de la ventana.
        <div className="@container space-y-4 px-4 py-4">
            {/* Tarjetas */}
            {!datos ? (
                <div className="grid grid-cols-2 gap-2 @md:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => <div key={i} className="h-[58px] animate-pulse rounded-lg bg-gray-100" />)}
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2 @md:grid-cols-4">
                    <Tarjeta
                        titulo="Físico"
                        valor={fmtCantidad(datos.fisico, "0")}
                        detalle={unidad}
                        tono={minimo != null && datos.fisico < minimo ? "text-red-700" : undefined}
                        title="La suma de los movimientos no anulados."
                    />
                    <Tarjeta
                        titulo="Reservado"
                        valor={fmtCantidad(datos.reservado, "0")}
                        detalle={datos.reservas.length ? `${datos.reservas.length} OT` : "ninguna OT"}
                        tono={datos.reservado > 0 ? "text-amber-700" : "text-gray-400"}
                        title="Apartado por OT que todavía no lo retiraron."
                    />
                    <Tarjeta
                        titulo="Libre"
                        valor={fmtCantidad(datos.libre, "0")}
                        detalle={unidad}
                        tono={datos.libre < 0 ? "text-red-700" : "text-emerald-700"}
                        title="Físico menos reservado: lo que se puede usar."
                    />
                    <Tarjeta
                        titulo="Punto crítico"
                        valor={minimo != null ? fmtCantidad(minimo) : "—"}
                        detalle={minimo == null ? "no se vigila" : datos.fisico < minimo ? "abajo del mínimo" : "bien"}
                        tono={minimo == null ? "text-gray-400" : undefined}
                        title="Se cambia en la solapa General."
                    />
                </div>
            )}

            {/* Reservas vigentes */}
            {datos && datos.reservas.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Reservado para</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                        {datos.reservas.map((r) => (
                            <li key={r.id_linea}>
                                <Link
                                    href={enlaceOT(r.id_orden_trabajo)}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-2 py-0.5 text-xs text-amber-900 hover:border-amber-400"
                                    title="Abrir la OT"
                                >
                                    <span className="font-semibold">OT {r.numero_ot ?? r.id_orden_trabajo}</span>
                                    <span className="tabular-nums text-amber-700">{fmtCantidad(r.cantidad_reservada)} {unidad}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Registrar */}
            {edita && datos && (
                formAbierto ? (
                    <FormMovimiento
                        idPieza={ficha.id}
                        datos={datos}
                        unidad={unidad}
                        onCerrar={() => setFormAbierto(false)}
                        onOptimista={(d) => poner(d)}
                        onRespuesta={(d) => poner(d)}
                    />
                ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setFormAbierto(true)}>
                        <PackagePlus className="h-4 w-4" />
                        Registrar movimiento
                    </Button>
                )
            )}

            {/* Movimientos */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Movimientos</h3>
                    {cargando && datos && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
                </div>
                {!datos ? (
                    <Esqueleto filas={5} />
                ) : renglones.length === 0 ? (
                    <Vacio titulo="Todavía no tiene movimientos">
                        El stock es la suma de los movimientos: {edita ? "registrá un ingreso cuando entre material." : "cuando alguien registre un ingreso aparece acá."}
                    </Vacio>
                ) : (
                    // `@container`: el renglón de «Anular» mide su ancho contra esta caja
                    // (100cqw) y va fijo a la izquierda, así queda a la vista aunque la tabla
                    // se desplace de costado (ver FilaMovimiento).
                    <div className="@container overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full min-w-[520px] text-xs">
                            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-2 py-1.5 text-left font-semibold">Fecha</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Comentario</th>
                                    <th className="px-2 py-1.5 text-right font-semibold">Ingreso</th>
                                    <th className="px-2 py-1.5 text-right font-semibold">Egreso</th>
                                    <th className="px-2 py-1.5 text-right font-semibold">Saldo</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">OT</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Usuario</th>
                                    {edita && <th className="w-8" aria-label="Acciones" />}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {renglones.map((m) => (
                                    <FilaMovimiento
                                        key={m.id}
                                        m={m}
                                        edita={edita}
                                        anulando={anulando === m.id}
                                        onPedirAnular={() => setAnulando(m.id)}
                                        onCancelarAnular={() => setAnulando(null)}
                                        onAnular={(motivo) => void anular(m, motivo)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function FilaMovimiento({ m, edita, anulando, onPedirAnular, onCancelarAnular, onAnular }: {
    m: Movimiento;
    edita: boolean;
    anulando: boolean;
    onPedirAnular: () => void;
    onCancelarAnular: () => void;
    onAnular: (motivo: string) => void;
}) {
    const [motivo, setMotivo] = useState("");
    const temporal = m.id < 0;
    const tachado = m.anulado ? "text-gray-400 line-through decoration-gray-400" : "";
    const esRetiro = m.tipo === "retiro_ot";
    return (
        <>
            <tr className={cn(m.anulado && "bg-gray-50/70", temporal && "opacity-60")}>
                <td className={cn("whitespace-nowrap px-2 py-1.5 tabular-nums text-gray-600", tachado)}>{fmtFechaHora(m.fecha)}</td>
                <td className="px-2 py-1.5">
                    <span className={cn("mr-1.5 inline-block rounded px-1 py-px text-[10px] font-semibold uppercase",
                        m.anulado ? "bg-gray-100 text-gray-400"
                            : m.tipo === "ingreso" ? "bg-emerald-50 text-emerald-700"
                                : m.tipo === "ajuste" ? "bg-blue-50 text-blue-700"
                                    : "bg-orange-50 text-orange-700")}
                    >
                        {ROTULO_MOVIMIENTO[m.tipo] ?? m.tipo}
                    </span>
                    <span className={cn("text-gray-700", tachado)}>{m.comentario}</span>
                    {m.origen === "legacy" && <span className="ml-1 text-[10px] text-gray-400">(viejo)</span>}
                    {m.anulado && (
                        <span className="mt-0.5 block text-[11px] text-gray-500">
                            Anulado{m.motivo_anulacion ? `: ${m.motivo_anulacion}` : ""}
                        </span>
                    )}
                </td>
                <td className={cn("px-2 py-1.5 text-right tabular-nums text-emerald-700", tachado)}>{m.ingreso ? fmtCantidad(m.ingreso) : ""}</td>
                <td className={cn("px-2 py-1.5 text-right tabular-nums text-orange-700", tachado)}>{m.egreso ? fmtCantidad(m.egreso) : ""}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900">{m.saldo === null ? "" : fmtCantidad(m.saldo)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">
                    {m.id_orden_trabajo ? (
                        <Link href={enlaceOT(m.id_orden_trabajo)} className="font-medium text-blue-700 hover:underline" title="Abrir la OT">
                            {m.numero_ot ?? m.id_orden_trabajo}
                        </Link>
                    ) : m.numero_ot ? (
                        <span className="text-gray-600">{m.numero_ot}</span>
                    ) : null}
                </td>
                <td className="max-w-[7rem] truncate px-2 py-1.5 text-gray-500" title={m.usuario ?? undefined}>{m.usuario}</td>
                {edita && (
                    <td className="px-1 py-1 text-right">
                        {!m.anulado && !temporal && (
                            <button
                                type="button"
                                onClick={esRetiro ? undefined : onPedirAnular}
                                disabled={esRetiro}
                                title={esRetiro
                                    ? "Lo generó marcar «Disponible» una línea reservada: se anula desmarcándola en la OT."
                                    : "Anular este movimiento (queda tachado; no se borra)"}
                                aria-label="Anular movimiento"
                                className="rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                            >
                                <Ban className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </td>
                )}
            </tr>
            {anulando && (
                <tr className="bg-rose-50/60">
                    <td colSpan={8} className="p-0">
                        {/* Fijo a la izquierda y del ancho de lo que se ve: la tabla mide
                            520 px y, con la ficha angosta (1024 px con la lista al lado), el
                            botón «Anular» quedaba afuera, a la derecha; sólo se podía
                            confirmar con Enter (E2E del 24/09). */}
                        <div className="sticky left-0 flex w-[100cqw] flex-wrap items-center gap-2 px-2 py-2">
                            <span className="text-xs text-rose-900">Anular el {ROTULO_MOVIMIENTO[m.tipo]?.toLowerCase()} del {fmtFechaHora(m.fecha)}:</span>
                            <Input
                                autoFocus
                                value={motivo}
                                onChange={(e) => setMotivo(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        onAnular(motivo);
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onCancelarAnular();
                                    }
                                }}
                                placeholder="Motivo (se carga dos veces, cantidad mal…)"
                                className="h-8 min-w-[12rem] flex-1 bg-white text-xs"
                            />
                            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onCancelarAnular}>
                                <X className="h-3.5 w-3.5" /> No
                            </Button>
                            <Button type="button" size="sm" className="h-8 bg-rose-600 text-white hover:bg-rose-700" onClick={() => onAnular(motivo)}>
                                <Undo2 className="h-3.5 w-3.5" /> Anular
                            </Button>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

const TIPOS_MANUALES: { valor: TipoMovimientoManual; rotulo: string; titulo: string }[] = [
    { valor: "ingreso", rotulo: "Ingreso", titulo: "Entró material (compra, devolución, pase desde otro código)." },
    { valor: "egreso", rotulo: "Egreso", titulo: "Salió material (se usó, se tiró, pase a otro código)." },
    { valor: "ajuste", rotulo: "Ajuste a un saldo", titulo: "Se contó lo que hay: se escribe el saldo real y queda la diferencia." },
];

/** El formulario de «Registrar movimiento», en la misma solapa (en el teléfono la ficha es la pantalla entera: nada de diálogos). */
function FormMovimiento({ idPieza, datos, unidad, onCerrar, onOptimista, onRespuesta }: {
    idPieza: number;
    datos: Movimientos;
    unidad: string;
    onCerrar: () => void;
    onOptimista: (d: Movimientos) => void;
    onRespuesta: (d: Movimientos) => void;
}) {
    const [tipo, setTipo] = useState<TipoMovimientoManual>("ingreso");
    const [cantidad, setCantidad] = useState("");
    const [comentario, setComentario] = useState("");
    const [numeroOt, setNumeroOt] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);

    const valor = leerCantidad(cantidad);
    const esAjuste = tipo === "ajuste";
    const diferencia = esAjuste && valor !== null ? redondear3(valor - datos.fisico) : null;
    const valido = esAjuste ? valor !== null && valor >= 0 && diferencia !== 0 : valor !== null && valor > 0;
    const queda = valor === null ? null : esAjuste ? valor : redondear3(datos.fisico + (tipo === "ingreso" ? valor : -valor));

    const registrar = async (forzar = false) => {
        if (!valido || valor === null || guardando) return;
        const antes = datos;
        const delta = esAjuste ? (diferencia ?? 0) : tipo === "ingreso" ? valor : -valor;
        const ot = numeroOt.trim() ? Number(numeroOt.trim()) : null;
        setGuardando(true);
        setAviso(null);
        // Se ve ya en la tabla, con la cuenta hecha acá; la del backend la reemplaza.
        onOptimista(recontar({
            ...datos,
            movimientos: [
                ...datos.movimientos,
                {
                    id: -Date.now(),
                    fecha: ahoraISO(),
                    tipo,
                    comentario: comentario.trim() || null,
                    ingreso: delta > 0 ? delta : null,
                    egreso: delta < 0 ? -delta : null,
                    saldo: null,
                    id_orden_trabajo: null,
                    numero_ot: ot,
                    usuario: usuarioActual(),
                    anulado: false,
                    motivo_anulacion: null,
                    origen: "spmm",
                },
            ],
        }));
        const cuerpo: MovimientoIn = esAjuste
            ? { tipo, saldo_nuevo: valor, comentario: comentario.trim() || null, numero_ot: ot }
            : { tipo, cantidad: valor, comentario: comentario.trim() || null, numero_ot: ot };
        const r = await mpPost<Movimientos>(`${API_URL}/materia-prima/insumos/${idPieza}/movimientos`, cuerpo, { forzar });
        setGuardando(false);
        if (r.requiereConfirmacion) {
            onRespuesta(antes);
            setAviso(r.error ? conSaldoLegible(r.error) : "El stock quedaría en negativo.");
            return;
        }
        if (!r.ok || !r.data) {
            onRespuesta(antes);
            // Modo práctica: el cartelito ya salió y el formulario queda abierto, con lo cargado.
            if (!r.practica) toast.error(`No se registró el movimiento: ${r.error ?? "error desconocido"}`);
            return;
        }
        onRespuesta({ ...r.data, movimientos: r.data.movimientos ?? [], reservas: r.data.reservas ?? [] });
        toast.success(`${TIPOS_MANUALES.find((t) => t.valor === tipo)?.rotulo ?? "Movimiento"} registrado`);
        onCerrar();
    };

    return (
        <div
            className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3"
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.stopPropagation();
                    onCerrar();
                }
            }}
        >
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">Registrar movimiento</p>
                <button type="button" onClick={onCerrar} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Cerrar">
                    <X className="h-4 w-4" />
                </button>
            </div>
            <Segmentado
                aria-label="Tipo de movimiento"
                opciones={TIPOS_MANUALES}
                valor={tipo}
                onCambiar={(t) => {
                    setTipo(t);
                    setAviso(null);
                }}
            />
            <div className="grid grid-cols-1 gap-3 @md:grid-cols-[10rem_minmax(0,1fr)_7rem]">
                <div>
                    <Rotulo htmlFor="mov-cantidad">{esAjuste ? "Saldo real" : "Cantidad"}</Rotulo>
                    <div className="relative">
                        <Input
                            id="mov-cantidad"
                            autoFocus
                            inputMode="decimal"
                            value={cantidad}
                            onChange={(e) => {
                                setCantidad(e.target.value);
                                setAviso(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    void registrar();
                                }
                            }}
                            placeholder={esAjuste ? fmtCantidad(datos.fisico, "0") : "0"}
                            className="h-9 bg-white pr-12 tabular-nums"
                        />
                        {unidad && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unidad}</span>}
                    </div>
                </div>
                <div className="min-w-0">
                    <Rotulo htmlFor="mov-comentario">Comentario</Rotulo>
                    <Input
                        id="mov-comentario"
                        value={comentario}
                        onChange={(e) => setComentario(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                void registrar();
                            }
                        }}
                        placeholder={esAjuste ? "Inventario del…" : tipo === "ingreso" ? "Remito, proveedor…" : "Para qué salió"}
                        className="h-9 bg-white"
                    />
                </div>
                <div>
                    <Rotulo htmlFor="mov-ot">N° OT</Rotulo>
                    <Input
                        id="mov-ot"
                        inputMode="numeric"
                        value={numeroOt}
                        onChange={(e) => setNumeroOt(e.target.value.replace(/\D/g, ""))}
                        placeholder="Opcional"
                        className="h-9 bg-white tabular-nums"
                    />
                </div>
            </div>
            <p className="text-xs text-gray-500">
                Hoy hay <span className="font-semibold tabular-nums text-gray-700">{fmtCantidad(datos.fisico, "0")} {unidad}</span>
                {queda !== null && (
                    <>
                        {" "}→ queda{" "}
                        <span className={cn("font-semibold tabular-nums", queda < 0 ? "text-red-700" : "text-gray-900")}>
                            {fmtCantidad(queda, "0")} {unidad}
                        </span>
                        {esAjuste && diferencia !== null && diferencia !== 0 && (
                            <span className="text-gray-400"> (se registra {diferencia > 0 ? "+" : ""}{fmtCantidad(diferencia)})</span>
                        )}
                    </>
                )}
                {esAjuste && diferencia === 0 && <span className="text-amber-700"> · ya es el saldo: no hay nada que ajustar</span>}
            </p>
            {aviso && (
                <AvisoConfirmacion
                    motivo={aviso}
                    ocupado={guardando}
                    onCancelar={() => setAviso(null)}
                    onConfirmar={() => void registrar(true)}
                />
            )}
            {!aviso && (
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={onCerrar} disabled={guardando}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => void registrar()}
                        disabled={!valido || guardando}
                        className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                    >
                        {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                        Registrar
                    </Button>
                </div>
            )}
        </div>
    );
}

export default FichaStock;
