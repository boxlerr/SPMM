"use client";

/**
 * «Nuevo › Movimiento de stock (pañol)»: registrar un ingreso, un egreso o un ajuste sin
 * ir a buscar la ficha del insumo.
 *
 * En el sistema viejo el pañol cargaba el stock desde un formulario suelto: el código, la
 * cantidad y listo, uno detrás de otro (un remito trae varias cosas). En SPMM el stock
 * vive en la ficha de cada insumo (solapa Stock, FichaStock.tsx), y para cargar un
 * remito de cinco renglones había que buscar, abrir la ficha, ir a Stock, cargar, cerrar
 * y buscar el siguiente. Esto es el formulario suelto: elegir el insumo, cargar y queda
 * listo para el siguiente, con la lista de lo cargado a la vista.
 *
 * Las reglas son las de la ficha, a propósito: el mismo `POST /materia-prima/insumos/{id}/
 * movimientos`, el mismo «Ajuste a un saldo» (se escribe lo que se contó y el backend
 * guarda la diferencia) y el mismo 409 de «el stock queda en negativo» con «Registrar
 * igual». Para mostrar «hoy hay → queda» se piden los movimientos del insumo elegido (el
 * físico de la base, no el de la lista que puede tener un rato).
 *
 * Modo práctica (prueba piloto): se recorre entero; al registrar, el candado de `mpFetch`
 * lo frena y sale su cartelito («Esto no se guarda»). Lo escrito queda para seguir probando.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, PackagePlus } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    fmtCantidad,
    leerCantidad,
    mpGet,
    mpPost,
    ROTULO_MOVIMIENTO,
    type InsumoFila,
    type MovimientoIn,
    type Movimientos,
    type TipoMovimientoManual,
} from "@/lib/materiaPrima";
import { AvisoConfirmacion, Rotulo, Segmentado } from "./InsumoComun";
import { SelectorInsumo, type SelectorInsumoHandle } from "./SelectorInsumo";
import { avisarCargaMP, frenadoPorPractica } from "./NuevoAvisos";
import { PildoraPractica, TarjetaInsumo } from "./NuevoComun";

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

const TIPOS: { valor: TipoMovimientoManual; rotulo: string; titulo: string }[] = [
    { valor: "ingreso", rotulo: "Ingreso", titulo: "Entró material (compra, devolución, pase desde otro código)." },
    { valor: "egreso", rotulo: "Egreso", titulo: "Salió material (se usó, se tiró, pase a otro código)." },
    { valor: "ajuste", rotulo: "Ajuste a un saldo", titulo: "Se contó lo que hay: se escribe el saldo real y queda la diferencia." },
];

/**
 * El 409 de «queda en negativo» con el saldo escrito con coma, como el resto de la
 * pantalla (la misma cuenta que FichaStock: el backend lo escribe con punto).
 */
const conSaldoLegible = (motivo: string) =>
    motivo.replace(/(queda en )(-?\d+(?:\.\d+)?)(?![\d.,])/, (_m, antes: string, n: string) => antes + fmtCantidad(Number(n)));

/** Lo que se registró en esta apertura: la lista de abajo, para no perder la cuenta de un remito largo. */
interface Hecho {
    clave: number;
    codigo: string;
    tipo: TipoMovimientoManual;
    /** Con signo: lo que cambió el físico. */
    delta: number;
    queda: number;
    unidad: string;
}

export interface NuevoMovimientoDialogProps {
    open: boolean;
    onClose: () => void;
    /** Prueba piloto con permiso de escribir: se recorre todo y no se guarda. */
    practica: boolean;
}

export function NuevoMovimientoDialog({ open, onClose, practica }: NuevoMovimientoDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0">
                {/* `pr-12`: que el título (con la píldora de modo práctica) no se meta abajo de la X en el teléfono. */}
                <DialogHeader className="shrink-0 border-b border-gray-100 py-3 pl-5 pr-12 text-left">
                    <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
                        Movimiento de stock
                        {practica && <PildoraPractica />}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        La carga del pañol: el insumo, cuánto entró o salió, y queda listo para el siguiente.
                    </DialogDescription>
                </DialogHeader>
                {/* Adentro del contenido del diálogo, que Radix monta al abrir y desmonta al
                    terminar de cerrarse: cada apertura arranca vacía (una carga a medio hacer
                    que se cerró no vuelve) y el formulario no desaparece durante el fundido. */}
                <FormularioMovimiento onClose={onClose} />
            </DialogContent>
        </Dialog>
    );
}

function FormularioMovimiento({ onClose }: { onClose: () => void }) {
    const selector = useRef<SelectorInsumoHandle>(null);
    const refCantidad = useRef<HTMLInputElement>(null);

    const [insumo, setInsumo] = useState<InsumoFila | null>(null);
    /** El físico de la base del insumo elegido (null mientras llega; si falla, el de la lista). */
    const [fisico, setFisico] = useState<number | null>(null);
    const [tipo, setTipo] = useState<TipoMovimientoManual>("ingreso");
    const [cantidad, setCantidad] = useState("");
    const [comentario, setComentario] = useState("");
    const [numeroOt, setNumeroOt] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);
    const [hechos, setHechos] = useState<Hecho[]>([]);

    // El físico del elegido: de la base (los movimientos), que es lo que usa el backend
    // para el 409 y para el ajuste. Mientras llega, el de la lista del buscador.
    useEffect(() => {
        if (!insumo) {
            setFisico(null);
            return;
        }
        const c = new AbortController();
        setFisico(null);
        void mpGet<Movimientos>(`${API_URL}/materia-prima/insumos/${insumo.id}/movimientos`, { signal: c.signal }).then((r) => {
            if (r.abortado) return;
            setFisico(r.ok && r.data ? r.data.fisico : insumo.stock);
        });
        return () => c.abort();
    }, [insumo]);

    const hoy = fisico ?? insumo?.stock ?? 0;
    const unidad = insumo?.unidad ?? "";
    const valor = leerCantidad(cantidad);
    const esAjuste = tipo === "ajuste";
    const diferencia = esAjuste && valor !== null ? redondear3(valor - hoy) : null;
    const valido = !!insumo && (esAjuste ? valor !== null && valor >= 0 && diferencia !== 0 : valor !== null && valor > 0);
    const queda = valor === null ? null : esAjuste ? valor : redondear3(hoy + (tipo === "ingreso" ? valor : -valor));

    const limpiarAviso = () => setAviso(null);

    const elegir = (i: InsumoFila) => {
        setInsumo(i);
        limpiarAviso();
        // Elegido el insumo, lo que sigue es la cantidad.
        window.setTimeout(() => refCantidad.current?.focus(), 0);
    };

    const registrar = async (forzar = false) => {
        if (!valido || !insumo || valor === null || guardando) return;
        const ot = numeroOt.trim() ? Number(numeroOt.trim()) : null;
        const delta = esAjuste ? (diferencia ?? 0) : tipo === "ingreso" ? valor : -valor;
        setGuardando(true);
        limpiarAviso();
        const cuerpo: MovimientoIn = esAjuste
            ? { tipo, saldo_nuevo: valor, comentario: comentario.trim() || null, numero_ot: ot }
            : { tipo, cantidad: valor, comentario: comentario.trim() || null, numero_ot: ot };
        const r = await mpPost<Movimientos>(`${API_URL}/materia-prima/insumos/${insumo.id}/movimientos`, cuerpo, { forzar });
        setGuardando(false);
        // Modo práctica: el cartelito ya salió (lo muestra el candado, ModoEspejo.tsx). Sin
        // toast y sin limpiar: el formulario queda como estaba, con lo cargado a la vista.
        if (frenadoPorPractica(r)) return;
        if (r.requiereConfirmacion) {
            setAviso(r.error ? conSaldoLegible(r.error) : "El stock quedaría en negativo.");
            return;
        }
        if (!r.ok || !r.data) {
            toast.error(`No se registró el movimiento: ${r.error ?? "error desconocido"}`);
            return;
        }
        const nuevo = r.data.fisico;
        toast.success(`${ROTULO_MOVIMIENTO[tipo]} registrado en ${insumo.codigo}`, {
            description: `Queda ${fmtCantidad(nuevo, "0")} ${unidad}`.trim(),
        });
        // La lista de Insumos (stock, libre) y Pendientes (el stock libre de cada línea).
        avisarCargaMP(["insumos", "pendientes"]);
        setHechos((h) => [{ clave: Date.now(), codigo: insumo.codigo, tipo, delta, queda: nuevo, unidad }, ...h]);
        // Listo para el siguiente renglón del remito: el tipo y la OT suelen repetirse.
        setInsumo(null);
        setCantidad("");
        setComentario("");
        selector.current?.limpiar();
        window.setTimeout(() => selector.current?.focus(), 0);
    };

    const enter = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void registrar();
        }
    };

    return (
        <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div>
                    <Rotulo htmlFor="nuevo-mov-insumo">Insumo</Rotulo>
                    {insumo ? (
                        <TarjetaInsumo
                            insumo={insumo}
                            onCambiar={() => {
                                setInsumo(null);
                                limpiarAviso();
                                window.setTimeout(() => selector.current?.focus(), 0);
                            }}
                            detalle={
                                <span>
                                    Hoy hay{" "}
                                    {fisico === null ? (
                                        <Loader2 className="inline h-3 w-3 animate-spin align-[-2px]" />
                                    ) : (
                                        <b className="tabular-nums text-gray-700">{fmtCantidad(hoy, "0")}</b>
                                    )}{" "}
                                    {unidad}
                                    {insumo.reservado > 0 && (
                                        <span className="text-amber-700"> · {fmtCantidad(insumo.reservado)} reservado para OT</span>
                                    )}
                                </span>
                            }
                        />
                    ) : null}
                    {/* El buscador queda montado (escondido) con un insumo elegido: así «Cambiar»
                        y el siguiente renglón vuelven al mismo campo, con su foco. */}
                    <div className={cn(insumo && "hidden")}>
                        <SelectorInsumo ref={selector} id="nuevo-mov-insumo" autoFocus onElegir={elegir} />
                    </div>
                </div>

                <div>
                    <Rotulo>Qué pasó</Rotulo>
                    <Segmentado
                        aria-label="Tipo de movimiento"
                        opciones={TIPOS}
                        valor={tipo}
                        onCambiar={(t) => {
                            setTipo(t);
                            limpiarAviso();
                        }}
                    />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_6.5rem]">
                    <div>
                        <Rotulo htmlFor="nuevo-mov-cantidad">{esAjuste ? "Saldo real" : "Cantidad"}</Rotulo>
                        <div className="relative">
                            <Input
                                ref={refCantidad}
                                id="nuevo-mov-cantidad"
                                inputMode="decimal"
                                value={cantidad}
                                onChange={(e) => {
                                    setCantidad(e.target.value);
                                    limpiarAviso();
                                }}
                                onKeyDown={enter}
                                placeholder={esAjuste && insumo ? fmtCantidad(hoy, "0") : "0"}
                                className="h-9 bg-white pr-12 tabular-nums"
                            />
                            {unidad && (
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unidad}</span>
                            )}
                        </div>
                    </div>
                    <div className="order-last col-span-2 min-w-0 sm:order-none sm:col-span-1">
                        <Rotulo htmlFor="nuevo-mov-comentario">Comentario</Rotulo>
                        <Input
                            id="nuevo-mov-comentario"
                            value={comentario}
                            onChange={(e) => setComentario(e.target.value)}
                            onKeyDown={enter}
                            placeholder={esAjuste ? "Inventario del…" : tipo === "ingreso" ? "Remito, proveedor…" : "Para qué salió"}
                            className="h-9 bg-white"
                        />
                    </div>
                    <div>
                        <Rotulo htmlFor="nuevo-mov-ot">N° OT</Rotulo>
                        <Input
                            id="nuevo-mov-ot"
                            inputMode="numeric"
                            value={numeroOt}
                            onChange={(e) => setNumeroOt(e.target.value.replace(/\D/g, ""))}
                            onKeyDown={enter}
                            placeholder="Opcional"
                            className="h-9 bg-white tabular-nums"
                        />
                    </div>
                </div>

                {/* Lo que queda, con la cuenta hecha acá (el saldo de hoy está en la tarjeta). */}
                {insumo && (queda !== null || (esAjuste && diferencia === 0)) && (
                    <p className="text-xs text-gray-500">
                        {queda !== null && (
                            <>
                                Queda{" "}
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
                )}

                {hechos.length > 0 && (
                    <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            Registrados ahora ({hechos.length})
                        </p>
                        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-xs">
                            {hechos.map((h) => (
                                <li key={h.clave} className="flex items-center gap-2 px-3 py-1.5">
                                    <span className="w-16 shrink-0 text-gray-500">{ROTULO_MOVIMIENTO[h.tipo]}</span>
                                    <span className="min-w-0 flex-1 truncate font-mono font-semibold text-gray-800">{h.codigo}</span>
                                    <span className={cn("shrink-0 tabular-nums font-semibold", h.delta < 0 ? "text-rose-700" : "text-emerald-700")}>
                                        {h.delta > 0 ? "+" : ""}
                                        {fmtCantidad(h.delta)} {h.unidad}
                                    </span>
                                    <span className="shrink-0 tabular-nums text-gray-500">→ {fmtCantidad(h.queda, "0")}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div className="shrink-0 space-y-2 border-t border-gray-100 bg-white px-5 py-3">
                {aviso ? (
                    <AvisoConfirmacion
                        motivo={aviso}
                        accion="Registrar igual"
                        ocupado={guardando}
                        onCancelar={() => setAviso(null)}
                        onConfirmar={() => void registrar(true)}
                    />
                ) : (
                    <div className="flex items-center justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={guardando}>
                            {hechos.length ? "Listo" : "Cancelar"}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => void registrar()}
                            disabled={!valido || guardando}
                            className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                        >
                            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                            Registrar
                        </Button>
                    </div>
                )}
            </div>
        </>
    );
}

export default NuevoMovimientoDialog;
