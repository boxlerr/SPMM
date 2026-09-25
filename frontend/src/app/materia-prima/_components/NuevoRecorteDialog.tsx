"use client";

/**
 * «Nuevo › Recorte»: anotar un tramo que sobró sin abrir la ficha del insumo.
 *
 * Los recortes viven en la ficha (solapa Recortes, FichaRecortes.tsx), con su alta rápida
 * «largo, Enter». Pero el que anota un recorte está parado al lado de la sierra con el
 * tramo en la mano: sabe el código, no quiere navegar el catálogo. Esto es la misma alta
 * rápida con el buscador de insumos arriba: se elige el insumo, se anota el largo (y el
 * ancho si es chapa, la cantidad si son varios iguales) y queda listo para el siguiente
 * del MISMO insumo (lo normal es que de un corte sobren dos o tres tramos).
 *
 * El mismo `POST /materia-prima/insumos/{id}/recortes` y las mismas validaciones que la
 * ficha: largo > 0, ancho opcional, cantidad entera ≥ 1.
 *
 * Modo práctica (prueba piloto): se recorre entero; al anotar, el candado de `mpFetch`
 * lo frena y sale su cartelito («Esto no se guarda»). Lo escrito queda para seguir probando.
 */

import { useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Plus, Scissors } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtCantidad, leerCantidad, mpPost, type InsumoFila, type Recorte, type RecorteIn } from "@/lib/materiaPrima";
import { Rotulo } from "./InsumoComun";
import { SelectorInsumo, type SelectorInsumoHandle } from "./SelectorInsumo";
import { avisarCargaMP, frenadoPorPractica } from "./NuevoAvisos";
import { PildoraPractica, TarjetaInsumo } from "./NuevoComun";

/** Un largo de barra entera: el viejo anotaba «6000» para las barras sin empezar (el mismo de FichaRecortes). */
const BARRA_ENTERA_MM = 6000;

interface Anotado {
    clave: number;
    codigo: string;
    medida: string;
    cantidad: number;
}

const medidaDe = (largo: number, ancho: number | null) =>
    ancho !== null ? `${fmtCantidad(largo)} × ${fmtCantidad(ancho)} mm` : `${fmtCantidad(largo)} mm`;

export interface NuevoRecorteDialogProps {
    open: boolean;
    onClose: () => void;
    practica: boolean;
}

export function NuevoRecorteDialog({ open, onClose, practica }: NuevoRecorteDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0">
                {/* `pr-12`: que el título (con la píldora de modo práctica) no se meta abajo de la X en el teléfono. */}
                <DialogHeader className="shrink-0 border-b border-gray-100 py-3 pl-5 pr-12 text-left">
                    <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
                        Recorte
                        {practica && <PildoraPractica />}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Un tramo que sobró: el insumo y el largo. Antes de comprar una barra entera, aparece en la ficha.
                    </DialogDescription>
                </DialogHeader>
                {/* Se monta con el contenido del diálogo: cada apertura arranca vacía. */}
                <FormularioRecorte onClose={onClose} />
            </DialogContent>
        </Dialog>
    );
}

function FormularioRecorte({ onClose }: { onClose: () => void }) {
    const selector = useRef<SelectorInsumoHandle>(null);
    const refLargo = useRef<HTMLInputElement>(null);

    const [insumo, setInsumo] = useState<InsumoFila | null>(null);
    const [largo, setLargo] = useState("");
    const [ancho, setAncho] = useState("");
    const [cantidad, setCantidad] = useState("1");
    const [obs, setObs] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [anotados, setAnotados] = useState<Anotado[]>([]);

    const vLargo = leerCantidad(largo);
    const vAncho = leerCantidad(ancho);
    const vCantidad = leerCantidad(cantidad);
    const largoMalo = largo.trim() !== "" && (vLargo === null || vLargo <= 0);
    const anchoMalo = ancho.trim() !== "" && (vAncho === null || vAncho <= 0);
    const cantidadMala = vCantidad === null || vCantidad < 1 || !Number.isInteger(vCantidad);
    const valido = !!insumo && vLargo !== null && vLargo > 0 && !anchoMalo && !cantidadMala;

    const elegir = (i: InsumoFila) => {
        setInsumo(i);
        window.setTimeout(() => refLargo.current?.focus(), 0);
    };

    const anotar = async () => {
        if (!valido || !insumo || vLargo === null || guardando) return;
        const cuerpo: RecorteIn = {
            largo_mm: vLargo,
            ancho_mm: ancho.trim() ? vAncho : null,
            cantidad: vCantidad ?? 1,
            observaciones: obs.trim() || null,
        };
        setGuardando(true);
        const r = await mpPost<Recorte>(`${API_URL}/materia-prima/insumos/${insumo.id}/recortes`, cuerpo);
        setGuardando(false);
        // Modo práctica: el cartelito ya salió (lo muestra el candado). Lo escrito queda.
        if (frenadoPorPractica(r)) return;
        if (!r.ok || !r.data) {
            toast.error(`No se anotó el recorte: ${r.error ?? "error desconocido"}`);
            return;
        }
        const medida = medidaDe(cuerpo.largo_mm, cuerpo.ancho_mm ?? null);
        toast.success(`Recorte anotado en ${insumo.codigo}`, { description: `${cuerpo.cantidad ?? 1} × ${medida}` });
        // El numerito de la tijera de la lista de Insumos y el de Pendientes.
        avisarCargaMP(["insumos", "pendientes"]);
        setAnotados((a) => [{ clave: Date.now(), codigo: insumo.codigo, medida, cantidad: cuerpo.cantidad ?? 1 }, ...a]);
        // Queda el insumo: de un corte suelen sobrar varios tramos del mismo.
        setInsumo((i) => (i ? { ...i, recortes_disponibles: i.recortes_disponibles + (cuerpo.cantidad ?? 1) } : i));
        setLargo("");
        setAncho("");
        setCantidad("1");
        setObs("");
        window.setTimeout(() => refLargo.current?.focus(), 0);
    };

    const enter = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void anotar();
        }
    };

    return (
        <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div>
                    <Rotulo htmlFor="nuevo-recorte-insumo">Insumo</Rotulo>
                    {insumo && (
                        <TarjetaInsumo
                            insumo={insumo}
                            onCambiar={() => {
                                setInsumo(null);
                                window.setTimeout(() => selector.current?.focus(), 0);
                            }}
                            detalle={
                                <span className="inline-flex items-center gap-1">
                                    <Scissors className="h-3 w-3" />
                                    {insumo.recortes_disponibles
                                        ? `${insumo.recortes_disponibles} recorte${insumo.recortes_disponibles === 1 ? "" : "s"} disponible${insumo.recortes_disponibles === 1 ? "" : "s"}`
                                        : "Sin recortes anotados"}
                                </span>
                            }
                        />
                    )}
                    <div className={cn(insumo && "hidden")}>
                        <SelectorInsumo ref={selector} id="nuevo-recorte-insumo" autoFocus onElegir={elegir} />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Largo mm</span>
                        <Input
                            ref={refLargo}
                            inputMode="decimal"
                            value={largo}
                            onChange={(e) => setLargo(e.target.value)}
                            onKeyDown={enter}
                            placeholder="2777"
                            className={cn("h-9 bg-white tabular-nums", largoMalo && "border-rose-300")}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ancho mm</span>
                        <Input
                            inputMode="decimal"
                            value={ancho}
                            onChange={(e) => setAncho(e.target.value)}
                            onKeyDown={enter}
                            placeholder="Opcional"
                            className={cn("h-9 bg-white tabular-nums", anchoMalo && "border-rose-300")}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Cantidad</span>
                        <Input
                            inputMode="numeric"
                            value={cantidad}
                            onChange={(e) => setCantidad(e.target.value.replace(/[^\d]/g, ""))}
                            onKeyDown={enter}
                            className={cn("h-9 bg-white tabular-nums", cantidadMala && cantidad !== "" && "border-rose-300")}
                        />
                    </label>
                    <label className="col-span-3 block">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Observaciones</span>
                        <Input value={obs} onChange={(e) => setObs(e.target.value)} onKeyDown={enter} placeholder="Pintado, con rebaba…" className="h-9 bg-white" />
                    </label>
                </div>
                <p className="text-[11px] text-gray-500">
                    {fmtCantidad(BARRA_ENTERA_MM)} mm = una barra entera.
                    {vLargo !== null && vLargo >= BARRA_ENTERA_MM && " Si es una barra sin empezar, conviene cargarla como ingreso de stock."}
                </p>

                {anotados.length > 0 && (
                    <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            Anotados ahora ({anotados.length})
                        </p>
                        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-xs">
                            {anotados.map((a) => (
                                <li key={a.clave} className="flex items-center gap-2 px-3 py-1.5">
                                    <Scissors className="h-3 w-3 shrink-0 text-gray-400" />
                                    <span className="min-w-0 flex-1 truncate font-mono font-semibold text-gray-800">{a.codigo}</span>
                                    <span className="shrink-0 tabular-nums text-gray-700">
                                        {a.cantidad > 1 && `${a.cantidad} × `}
                                        {a.medida}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div className="shrink-0 space-y-2 border-t border-gray-100 bg-white px-5 py-3">
                <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={guardando}>
                        {anotados.length ? "Listo" : "Cancelar"}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => void anotar()}
                        disabled={!valido || guardando}
                        className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                    >
                        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Anotar recorte
                    </Button>
                </div>
            </div>
        </>
    );
}

export default NuevoRecorteDialog;
