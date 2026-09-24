"use client";

/**
 * La barra que aparece abajo cuando hay líneas elegidas: lo mismo a muchas de una vez.
 *
 * Es cómo compra Maxi: llama a un proveedor, le encarga seis cosas de cuatro OT, y
 * marca las seis como pedidas con el proveedor y la fecha que le prometió. Uno por uno
 * eran seis tildes, seis proveedores y seis fechas.
 *
 *  · «Marcar pedido…»   → pedido, y si se eligen, proveedor y fecha del proveedor.
 *  · «Marcar disponible»→ llegó (a las reservadas les retira el stock).
 *  · «Reservar de stock»→ lo que haya libre de cada pieza, hasta su cantidad.
 *  · «Quitar marcas»    → vuelve a cero pedido, reserva y disponible (pregunta antes).
 *
 * Todo va en UN pedido (`PUT /materia-prima/lineas/lote`): o quedan todas o ninguna,
 * como las guarda el backend. Si queda, la selección se suelta.
 */

import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CheckCheck, Loader2, PackageCheck, PackagePlus, Truck, Undo2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CambiosDeLote, FechaISO, ProveedorElegido } from "@/lib/materiaPrima";
import { SelectorProveedor } from "./SelectorProveedor";

export interface BarraDeAccionesProps {
    cantidad: number;
    /** Cuántas de las elegidas ya están pedidas / disponibles, para decir qué cambia. */
    yaPedidas: number;
    yaDisponibles: number;
    ocupado: boolean;
    onAplicar: (cambios: CambiosDeLote, que: string) => void;
    onQuitarMarcas: () => void;
    onSoltar: () => void;
}

export function BarraDeAcciones({
    cantidad,
    yaPedidas,
    yaDisponibles,
    ocupado,
    onAplicar,
    onQuitarMarcas,
    onSoltar,
}: BarraDeAccionesProps) {
    const [pedidoAbierto, setPedidoAbierto] = useState(false);
    const [proveedor, setProveedor] = useState<ProveedorElegido>({ id: null, nombre: null });
    const [fecha, setFecha] = useState<FechaISO>("");

    const marcarPedido = () => {
        const cambios: CambiosDeLote = { pedido: true };
        if (proveedor.nombre) {
            cambios.id_proveedor = proveedor.id;
            cambios.proveedor = proveedor.nombre;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) cambios.fecha_proveedor = fecha;
        setPedidoAbierto(false);
        onAplicar(cambios, "Marcar pedido");
    };

    return (
        <div
            className={cn(
                "fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-fit flex-wrap items-center gap-1.5 rounded-2xl border border-gray-200 bg-white/95 px-2.5 py-2 shadow-2xl ring-1 ring-black/5 backdrop-blur",
                "lg:bottom-6",
            )}
            role="toolbar"
            aria-label="Acciones para las líneas elegidas"
        >
            <span className="px-1.5 text-xs font-semibold text-gray-800">
                {cantidad} elegida{cantidad === 1 ? "" : "s"}
            </span>
            <span className="h-5 w-px bg-gray-200" />

            <Popover open={pedidoAbierto} onOpenChange={setPedidoAbierto}>
                <PopoverTrigger asChild>
                    <Accion icono={<Truck className="h-3.5 w-3.5" />} disabled={ocupado} titulo="Marcarlas pedidas al proveedor">
                        Marcar pedido…
                    </Accion>
                </PopoverTrigger>
                <PopoverContent side="top" className="w-80 p-3">
                    <p className="text-xs font-semibold text-gray-800">
                        Marcar {cantidad} línea{cantidad === 1 ? "" : "s"} como pedida{cantidad === 1 ? "" : "s"}
                    </p>
                    {yaPedidas > 0 && (
                        <p className="mt-0.5 text-[11px] text-gray-500">
                            {yaPedidas} ya estaba{yaPedidas === 1 ? "" : "n"} pedida{yaPedidas === 1 ? "" : "s"}: se les cambia el proveedor y la fecha si los elegís.
                        </p>
                    )}
                    <label className="mt-2.5 block text-[11px] font-medium text-gray-600">
                        Proveedor <span className="font-normal text-gray-400">(opcional: vacío no toca el que tengan)</span>
                    </label>
                    <SelectorProveedor
                        valor={proveedor}
                        onCambiar={setProveedor}
                        permitirTextoLibre
                        className="mt-1"
                        triggerClassName="h-8 text-xs"
                    />
                    <label className="mt-2.5 block text-[11px] font-medium text-gray-600">
                        Fecha que prometió <span className="font-normal text-gray-400">(opcional)</span>
                    </label>
                    <input
                        type="date"
                        value={fecha}
                        onChange={(e) => setFecha(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                marcarPedido();
                            }
                        }}
                        className="mt-1 h-8 w-full rounded-md border border-gray-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setPedidoAbierto(false)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={marcarPedido}
                            className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                        >
                            Marcar pedido
                        </button>
                    </div>
                </PopoverContent>
            </Popover>

            <Accion
                icono={<PackageCheck className="h-3.5 w-3.5" />}
                disabled={ocupado || yaDisponibles === cantidad}
                onClick={() => onAplicar({ disponible: true }, "Marcar disponible")}
                titulo="Llegó: marcarlas disponibles para producción (a las reservadas les retira el stock)"
            >
                Marcar disponible
            </Accion>
            <Accion
                icono={<PackagePlus className="h-3.5 w-3.5" />}
                disabled={ocupado}
                onClick={() => onAplicar({ reserva: true }, "Reservar de stock")}
                titulo="Apartar del stock lo que haya libre de cada pieza, hasta la cantidad de la línea"
            >
                Reservar de stock
            </Accion>
            <Accion
                icono={<Undo2 className="h-3.5 w-3.5" />}
                disabled={ocupado}
                onClick={onQuitarMarcas}
                titulo="Volver a cero Pedido, Reserva y Disponible"
            >
                Quitar marcas
            </Accion>

            <span className="h-5 w-px bg-gray-200" />
            {ocupado ? (
                <Loader2 className="mx-1 h-4 w-4 animate-spin text-gray-400" />
            ) : (
                <CheckCheck className="mx-1 hidden h-4 w-4 text-gray-300 sm:block" />
            )}
            <button
                type="button"
                onClick={onSoltar}
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                title="Soltar la selección (Esc)"
                aria-label="Soltar la selección"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

/** Un botón de la barra. Con `forwardRef`: «Marcar pedido…» va adentro de `PopoverTrigger asChild`. */
const Accion = forwardRef<
    HTMLButtonElement,
    { icono: ReactNode; titulo: string } & ButtonHTMLAttributes<HTMLButtonElement>
>(function Accion({ children, icono, titulo, className, ...resto }, ref) {
    return (
        <button
            ref={ref}
            type="button"
            title={titulo}
            {...resto}
            className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50",
                className,
            )}
        >
            {icono}
            <span className="whitespace-nowrap">{children}</span>
        </button>
    );
});
