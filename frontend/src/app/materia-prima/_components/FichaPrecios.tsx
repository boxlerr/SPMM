"use client";

/**
 * Solapa Precios de la ficha: el historial de lo que se pagó, el más nuevo primero.
 *
 * El precio de un insumo sigue saliendo de las FACTURAS del sistema viejo (que queda
 * para facturas y remitos): el sync trae el último precio de compra y lo anota acá como
 * «Factura». Además se puede cargar uno a mano (una cotización, una compra que no pasó
 * por el viejo). El precio que se ve en la ficha y en la lista es el de la fecha más
 * nueva: cargar uno con fecha vieja lo deja en el historial sin cambiar el vigente (la
 * misma regla que aplica el backend).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, ReceiptText, X } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    fmtFecha,
    fmtPrecio,
    hoyISO,
    leerCantidad,
    mpGet,
    mpPost,
    ROTULO_ORIGEN_PRECIO,
    usuarioActual,
    type InsumoFicha,
    type OrigenPrecio,
    type Precio,
    type PrecioIn,
    type ProveedorElegido,
} from "@/lib/materiaPrima";
import { SelectorProveedor } from "./SelectorProveedor";
import { CartelError, CartelSinServidor, Esqueleto, Rotulo, Vacio } from "./InsumoComun";

const ESTILO_ORIGEN: Record<OrigenPrecio, string> = {
    compra: "bg-blue-50 text-blue-700 border-blue-200",
    manual: "bg-violet-50 text-violet-700 border-violet-200",
    import: "bg-gray-100 text-gray-600 border-gray-200",
};

/** Por fecha y, el mismo día, el último cargado arriba (el que se está guardando, con id provisorio negativo, es el último). */
const orden = (p: Precio) => (p.id < 0 ? Number.MAX_SAFE_INTEGER : p.id);
const masNuevoPrimero = (a: Precio, b: Precio) => b.fecha.localeCompare(a.fecha) || orden(b) - orden(a);

export interface FichaPreciosProps {
    ficha: InsumoFicha;
    edita: boolean;
    /** Cambió el precio vigente (se cargó uno con fecha igual o más nueva, o volvió atrás porque falló). */
    onPrecioVigente: (unitario: number | null, fecha: string | null) => void;
}

export function FichaPrecios({ ficha, edita, onPrecioVigente }: FichaPreciosProps) {
    const [lista, setLista] = useState<Precio[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);
    const [formAbierto, setFormAbierto] = useState(false);

    const alVigente = useRef(onPrecioVigente);
    useEffect(() => {
        alVigente.current = onPrecioVigente;
    });

    const cargar = useCallback(async (signal?: AbortSignal) => {
        const r = await mpGet<Precio[]>(`${API_URL}/materia-prima/insumos/${ficha.id}/precios`, { signal });
        if (r.abortado) return;
        setSinServidor(r.sinServidor);
        if (!r.ok) {
            setError(r.error ?? "No se pudieron traer los precios.");
            return;
        }
        setError(null);
        setLista((Array.isArray(r.data) ? r.data : []).sort(masNuevoPrimero));
    }, [ficha.id]);

    useEffect(() => {
        const c = new AbortController();
        void cargar(c.signal);
        return () => c.abort();
    }, [cargar]);

    const cargarPrecio = async (cuerpo: PrecioIn & { proveedorNombre: string | null }): Promise<boolean> => {
        if (!lista) return false;
        const antes = lista;
        const fecha = cuerpo.fecha ?? hoyISO();
        const temporal: Precio = {
            id: -Date.now(),
            fecha,
            precio: cuerpo.precio,
            origen: "manual",
            proveedor: cuerpo.proveedorNombre,
            usuario: usuarioActual(),
        };
        setLista([temporal, ...lista].sort(masNuevoPrimero));
        // La regla del backend: sólo pasa a ser el vigente si su fecha no es más vieja que la del vigente.
        const pasaAVigente = !ficha.fecha_ultimo_precio || fecha >= ficha.fecha_ultimo_precio;
        const vigenteAntes = { unitario: ficha.unitario, fecha: ficha.fecha_ultimo_precio };
        if (pasaAVigente) alVigente.current(cuerpo.precio, fecha);

        const envio: PrecioIn = { precio: cuerpo.precio, fecha: cuerpo.fecha ?? null, id_proveedor: cuerpo.id_proveedor ?? null };
        const r = await mpPost<Precio[]>(`${API_URL}/materia-prima/insumos/${ficha.id}/precios`, envio);
        if (!r.ok) {
            setLista(antes);
            if (pasaAVigente) alVigente.current(vigenteAntes.unitario, vigenteAntes.fecha);
            toast.error(`No se cargó el precio: ${r.error ?? "error desconocido"}`);
            return false;
        }
        if (Array.isArray(r.data)) setLista([...r.data].sort(masNuevoPrimero));
        toast.success(pasaAVigente ? "Precio cargado: es el vigente" : "Precio cargado en el historial (hay uno más nuevo)");
        return true;
    };

    if (sinServidor) return <CartelSinServidor className="m-4" />;
    if (error && !lista) return <CartelError className="m-4" mensaje={error} onReintentar={() => void cargar()} />;

    return (
        // `@container`: se acomoda al ancho del panel de la ficha, no al de la ventana.
        <div className="@container space-y-4 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Precio vigente</p>
                    <p className="text-lg font-bold tabular-nums text-gray-900">
                        {fmtPrecio(ficha.unitario, "Sin precio")}
                        {ficha.unidad && ficha.unitario != null && <span className="ml-1 text-xs font-normal text-gray-500">por {ficha.unidad}</span>}
                    </p>
                    {ficha.fecha_ultimo_precio && <p className="text-[11px] text-gray-500">desde el {fmtFecha(ficha.fecha_ultimo_precio)}</p>}
                </div>
                {edita && lista && !formAbierto && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setFormAbierto(true)}>
                        <Plus className="h-4 w-4" />
                        Cargar precio
                    </Button>
                )}
            </div>

            {edita && formAbierto && (
                <FormPrecio
                    proveedorInicial={ficha.proveedor_preferido ? { id: ficha.proveedor_preferido.id, nombre: ficha.proveedor_preferido.razon_social } : { id: null, nombre: null }}
                    onCerrar={() => setFormAbierto(false)}
                    onCargar={cargarPrecio}
                />
            )}

            <div>
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Historial</h3>
                {!lista ? (
                    <Esqueleto filas={4} />
                ) : lista.length === 0 ? (
                    <Vacio icono={<ReceiptText className="h-6 w-6" />} titulo="Todavía no tiene precios">
                        Llegan solos con las facturas del sistema viejo{edita ? ", o se cargan a mano." : "."}
                    </Vacio>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full min-w-[440px] text-xs">
                            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-2 py-1.5 text-left font-semibold">Fecha</th>
                                    <th className="px-2 py-1.5 text-right font-semibold">Precio</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Origen</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Proveedor</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Cargó</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {lista.map((p, i) => (
                                    <tr key={p.id} className={cn(p.id < 0 && "opacity-60", i === 0 && "bg-emerald-50/40")}>
                                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-gray-700">{fmtFecha(p.fecha)}</td>
                                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900">{fmtPrecio(p.precio)}</td>
                                        <td className="px-2 py-1.5">
                                            <span className={cn("rounded-full border px-1.5 py-px text-[10px] font-medium", ESTILO_ORIGEN[p.origen] ?? ESTILO_ORIGEN.import)}>
                                                {ROTULO_ORIGEN_PRECIO[p.origen] ?? p.origen}
                                            </span>
                                        </td>
                                        <td className="max-w-[10rem] truncate px-2 py-1.5 text-gray-600" title={p.proveedor ?? undefined}>{p.proveedor ?? "—"}</td>
                                        <td className="max-w-[8rem] truncate px-2 py-1.5 text-gray-500" title={p.usuario ?? undefined}>{p.usuario ?? ""}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function FormPrecio({ proveedorInicial, onCerrar, onCargar }: {
    proveedorInicial: ProveedorElegido;
    onCerrar: () => void;
    onCargar: (c: PrecioIn & { proveedorNombre: string | null }) => Promise<boolean>;
}) {
    const [precio, setPrecio] = useState("");
    const [fecha, setFecha] = useState(hoyISO());
    const [proveedor, setProveedor] = useState<ProveedorElegido>(proveedorInicial);
    const [guardando, setGuardando] = useState(false);

    const valor = leerCantidad(precio);
    // Las mismas reglas que el backend (si no, un 422 después de escribir): el precio es
    // mayor que cero y la fecha no puede ser de más adelante.
    const futura = fecha > hoyISO();
    const valido = valor !== null && valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !futura;

    const cargar = async () => {
        if (!valido || valor === null || guardando) return;
        setGuardando(true);
        const ok = await onCargar({
            precio: valor,
            // Hoy no se manda: el backend pone hoy con su reloj (hora de acá), así no depende del de esta computadora.
            fecha: fecha === hoyISO() ? null : fecha,
            id_proveedor: proveedor.id,
            proveedorNombre: proveedor.nombre,
        });
        setGuardando(false);
        if (ok) onCerrar();
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
            <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Cargar precio</p>
                <button type="button" onClick={onCerrar} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Cerrar">
                    <X className="h-4 w-4" />
                </button>
            </div>
            <div className="grid grid-cols-1 gap-3 @md:grid-cols-[9rem_10rem_minmax(0,1fr)]">
                <div>
                    <Rotulo htmlFor="precio-nuevo">Precio</Rotulo>
                    <div className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                        <Input
                            id="precio-nuevo"
                            autoFocus
                            inputMode="decimal"
                            value={precio}
                            onChange={(e) => setPrecio(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    void cargar();
                                }
                            }}
                            placeholder="0,00"
                            className="h-9 bg-white pl-6 tabular-nums"
                        />
                    </div>
                </div>
                <div>
                    <Rotulo htmlFor="precio-fecha">Fecha</Rotulo>
                    <Input
                        id="precio-fecha"
                        type="date"
                        value={fecha}
                        max={hoyISO()}
                        onChange={(e) => setFecha(e.target.value)}
                        className="h-9 bg-white"
                    />
                </div>
                <div className="min-w-0">
                    <Rotulo>Proveedor</Rotulo>
                    <SelectorProveedor valor={proveedor} onCambiar={setProveedor} placeholder="Opcional" className="bg-white" />
                </div>
            </div>
            {futura && <p className="text-[11px] text-rose-600">La fecha no puede ser de más adelante que hoy.</p>}
            {precio.trim() !== "" && (valor === null || valor <= 0) && (
                <p className="text-[11px] text-rose-600">El precio tiene que ser un número mayor que cero.</p>
            )}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCerrar} disabled={guardando}>
                    Cancelar
                </Button>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => void cargar()}
                    disabled={!valido || guardando}
                    className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                >
                    {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                    Cargar
                </Button>
            </div>
        </div>
    );
}

export default FichaPrecios;
