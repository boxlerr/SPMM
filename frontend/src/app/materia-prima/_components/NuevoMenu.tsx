"use client";

/**
 * El botón «Nuevo ▾» de la cabecera de Materia prima: las cargas del sistema viejo, a un
 * clic, sin tener que saber en qué solapa (o en qué pantalla) vive cada una.
 *
 * Julián lo pidió así: «quiero el botón para poder generar una nueva compra o pedido o
 * carga de materia prima como está en el sistema legacy». En el viejo cada carga tenía su
 * entrada en el menú; en SPMM estaban todas, pero repartidas: la materia prima de una OT
 * adentro de la OT (Operaciones), el pedido tildando en la grilla de Pendientes, el stock
 * y los recortes adentro de la ficha de cada insumo. El botón junta las cinco:
 *
 *  · Materia prima para una OT → la carga de Carolina (NuevoMateriaPrimaOTDialog).
 *  · Pedido a proveedor        → el pedido de Maxi (NuevoPedidoDialog).
 *  · Insumo                    → el alta del catálogo (NuevoInsumoDialog, el de la OT).
 *  · Movimiento de stock       → el pañol: ingreso, egreso o ajuste (NuevoMovimientoDialog).
 *  · Recorte                   → un tramo que sobró (NuevoRecorteDialog).
 *
 * Cada carga reusa lo que ya había (el componente de la solapa de la OT, el formulario del
 * insumo, los selectores, la hoja impresa de Pendientes): son otras puertas a lo mismo, no
 * otra implementación. Al guardar avisan a las solapas (NuevoAvisos.ts) para que se pongan
 * al día en silencio.
 *
 * Lo ve quien puede escribir la sección. En la prueba piloto (dueño «integral») también:
 * es MODO PRÁCTICA, se recorre todo y al guardar sale el cartelito del candado. El menú es
 * `modal={false}`, como los de la ficha: un menú modal de Radix que abre un diálogo deja
 * a veces la página sin clics (`pointer-events: none` en el body) al cerrarse los dos.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, ChevronDown, ClipboardList, PackagePlus, Plus, Scissors, Truck } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NuevoInsumoDialog } from "./NuevoInsumoDialog";
import { NuevoMateriaPrimaOTDialog } from "./NuevoMateriaPrimaOTDialog";
import { NuevoPedidoDialog } from "./NuevoPedidoDialog";
import { NuevoMovimientoDialog } from "./NuevoMovimientoDialog";
import { NuevoRecorteDialog } from "./NuevoRecorteDialog";
import { avisarCargaMP } from "./NuevoAvisos";
import { PildoraPractica } from "./NuevoComun";

type Carga = "ot" | "pedido" | "insumo" | "movimiento" | "recorte";

export interface BotonNuevoProps {
    /** Prueba piloto con permiso de escribir: todo se recorre y nada se guarda. */
    practica: boolean;
    /**
     * Cambia cuando la página siguió un enlace (la campanita, «Ver en Pendientes» desde la
     * OT): el diálogo abierto se cierra, así se ve adónde llevó el enlace.
     */
    cerrarCon?: number;
}

export function BotonNuevo({ practica, cerrarCon = 0 }: BotonNuevoProps) {
    const [abierta, setAbierta] = useState<Carga | null>(null);
    const cerrar = () => setAbierta(null);
    /**
     * La carga elegida se abre recién cuando el menú terminó de irse (su
     * `onCloseAutoFocus`), no en el `onSelect`. Si el diálogo se abría enseguida, el menú
     * —todavía desvaneciéndose— le robaba el foco al diálogo (al irse el puntero del
     * renglón, Radix enfoca el menú; y al cerrarse, devuelve el foco al botón «Nuevo», que
     * queda detrás del diálogo): el foco terminaba en el body y había que hacer clic en el
     * buscador para empezar a escribir.
     */
    const elegida = useRef<Carga | null>(null);
    const abrir = (c: Carga) => {
        elegida.current = c;
    };

    useEffect(() => {
        setAbierta(null);
    }, [cerrarCon]);

    return (
        <>
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#DC143C] px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#B01030] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 data-[state=open]:bg-[#B01030]"
                        aria-label="Nueva carga de materia prima"
                    >
                        <Plus className="h-4 w-4" />
                        Nuevo
                        {/* En el teléfono, ícono + «Nuevo»: la flecha es lo primero que sobra. */}
                        <ChevronDown className="hidden h-3.5 w-3.5 opacity-80 sm:block" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="end"
                    sideOffset={6}
                    className="w-[min(20rem,calc(100vw-2rem))] p-1.5"
                    onCloseAutoFocus={(e) => {
                        const c = elegida.current;
                        if (!c) return;
                        // El foco no vuelve al botón: va al diálogo que se abre ahora.
                        e.preventDefault();
                        elegida.current = null;
                        setAbierta(c);
                    }}
                >
                    <DropdownMenuLabel className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Cargar
                    </DropdownMenuLabel>
                    <Opcion
                        icono={<ClipboardList className="h-4 w-4" />}
                        titulo="Materia prima para una OT"
                        detalle="Lo que lleva una OT: código, cantidad, cortes"
                        onSelect={() => abrir("ot")}
                    />
                    <Opcion
                        icono={<Truck className="h-4 w-4" />}
                        titulo="Pedido a proveedor"
                        detalle="Marcar pedido lo que falta, con su fecha"
                        onSelect={() => abrir("pedido")}
                    />
                    <DropdownMenuSeparator />
                    <Opcion
                        icono={<PackagePlus className="h-4 w-4" />}
                        titulo="Insumo"
                        detalle="Un código nuevo en el catálogo"
                        onSelect={() => abrir("insumo")}
                    />
                    <Opcion
                        icono={<ArrowLeftRight className="h-4 w-4" />}
                        titulo="Movimiento de stock (pañol)"
                        detalle="Ingreso, egreso o ajuste de un insumo"
                        onSelect={() => abrir("movimiento")}
                    />
                    <Opcion
                        icono={<Scissors className="h-4 w-4" />}
                        titulo="Recorte"
                        detalle="Un tramo que sobró de un insumo"
                        onSelect={() => abrir("recorte")}
                    />
                </DropdownMenuContent>
            </DropdownMenu>

            <NuevoMateriaPrimaOTDialog open={abierta === "ot"} onClose={cerrar} practica={practica} />
            <NuevoPedidoDialog open={abierta === "pedido"} onClose={cerrar} practica={practica} />
            <NuevoInsumoDialog
                open={abierta === "insumo"}
                onClose={cerrar}
                descripcion={
                    practica ? (
                        <>
                            <PildoraPractica className="mr-1.5 align-middle" />
                            Recorré el alta para ver cómo es: el código y la descripción se arman solos con la regla del sistema viejo, pero no se guarda.
                        </>
                    ) : (
                        "Queda en el catálogo de materia prima. El código y la descripción se arman solos con la regla del sistema viejo."
                    )
                }
                // El «Insumo … dado de alta» lo muestra el formulario (FormularioInsumo): acá
                // sólo se avisa a la lista de Insumos, que lo trae en silencio. Un segundo
                // toast con «Ver ficha» salía apilado con el mismo texto.
                onCreado={() => avisarCargaMP(["insumos"])}
            />
            <NuevoMovimientoDialog open={abierta === "movimiento"} onClose={cerrar} practica={practica} />
            <NuevoRecorteDialog open={abierta === "recorte"} onClose={cerrar} practica={practica} />
        </>
    );
}

function Opcion({ icono, titulo, detalle, onSelect }: { icono: ReactNode; titulo: string; detalle: string; onSelect: () => void }) {
    return (
        <DropdownMenuItem onSelect={onSelect} className="cursor-pointer items-start gap-2.5 rounded-md px-2 py-2">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-50 text-[#DC143C] ring-1 ring-red-100">
                {icono}
            </span>
            <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{titulo}</span>
                <span className="block text-[11px] leading-snug text-gray-500">{detalle}</span>
            </span>
        </DropdownMenuItem>
    );
}

export default BotonNuevo;
