"use client";

/**
 * Qué quiere decir cada color del planificador, a mano y no siempre a la vista.
 *
 * Lucas, 28/10/2026, viendo las máquinas en amarillo de la vista previa: «un glosario de
 * colorcitos en algún lado, no que no esté siempre, pero que se pueda». El sistema viejo
 * lo tenía escrito al pie del plan semanal; acá es un botón que abre la lista.
 *
 * Cada pantalla tiene el suyo porque las filas de OT no se pintan igual: la vista previa
 * sigue los colores del plan semanal del sistema viejo (violeta = terminada) y las listas
 * de Operaciones los de la etapa de la OT (violeta = tercerizada). Si cambia un color en
 * `getRowColor` (vista previa), en `getWorkOrderRowColor` (lib/utils) o en las filas de
 * pasos, cambia acá también.
 */

import * as React from "react";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Color {
    /** Cómo se ve la muestra: las mismas clases que usa la pantalla. */
    muestra: string;
    texto: string;
}

interface Grupo {
    titulo: string;
    colores: Color[];
}

const FILA = "h-3.5 w-6 rounded-sm border border-black/5";
const BARRA = "h-3.5 w-6 rounded-[2px] border border-black/5";
const CUADRO = "h-3.5 w-6 rounded border";

const VISTA_PREVIA: Grupo[] = [
    {
        titulo: "La fila de cada OT",
        colores: [
            { muestra: cn(FILA, "bg-green-100"), texto: "Programada" },
            { muestra: cn(FILA, "bg-orange-200"), texto: "En producción: algún paso ya arrancó" },
            { muestra: cn(FILA, "bg-gray-200"), texto: "Entregada en parte" },
            { muestra: cn(FILA, "bg-purple-200"), texto: "Terminada toda" },
        ],
    },
    {
        titulo: "Los pasos de adentro",
        colores: [
            { muestra: cn(BARRA, "bg-red-100 shadow-[inset_3px_0_0_#dc2626]"), texto: "La persona o la máquina ya tiene otra cosa a esa hora" },
            { muestra: cn(BARRA, "bg-[#DC143C]/10 shadow-[inset_3px_0_0_#DC143C]"), texto: "Lo cambiaste a mano (persona, máquina, horario, proceso o lugar)" },
            { muestra: cn(BARRA, "bg-indigo-50 shadow-[inset_3px_0_0_#6366f1]"), texto: "Lo agregaste vos al plan" },
            { muestra: cn(BARRA, "bg-emerald-50 shadow-[inset_3px_0_0_#10b981]"), texto: "Paso nuevo: el plan le busca lugar al recalcular" },
            { muestra: cn(FILA, "bg-gray-300 opacity-45"), texto: "No es de la persona, máquina o sector del filtro" },
        ],
    },
    {
        titulo: "Los cuadros",
        colores: [
            { muestra: cn(CUADRO, "border-amber-300 bg-amber-50"), texto: "Máquina con una limitación (pasá el mouse para leerla)" },
            { muestra: cn(CUADRO, "border-red-500 bg-red-50"), texto: "Ocupada a esa hora" },
            { muestra: cn(CUADRO, "border-orange-400 bg-orange-50"), texto: "Horario viejo: cambiaste pasos, recalculá" },
        ],
    },
    {
        titulo: "Los avisos",
        colores: [
            { muestra: cn(CUADRO, "border-rose-200 bg-rose-50"), texto: "Alta: algo del plan salió mal" },
            { muestra: cn(CUADRO, "border-amber-200 bg-amber-50"), texto: "Media o pausa: el plan sale igual" },
            { muestra: cn(CUADRO, "border-blue-200 bg-blue-50"), texto: "Lo hace alguien de afuera" },
            { muestra: cn(CUADRO, "border-emerald-200 bg-emerald-50"), texto: "Listo: no hace falta tocar nada" },
        ],
    },
];

const LISTA_DE_OT: Grupo[] = [
    {
        titulo: "La fila de cada OT",
        colores: [
            { muestra: cn(FILA, "bg-emerald-300/60"), texto: "Programada" },
            { muestra: cn(FILA, "bg-orange-200/60"), texto: "En producción" },
            { muestra: cn(FILA, "bg-purple-200/60"), texto: "Tercerizada (toda o una parte)" },
            { muestra: cn(FILA, "bg-green-100"), texto: "Material disponible, o no lleva" },
            { muestra: cn(FILA, "bg-yellow-100"), texto: "Material pedido al proveedor" },
            { muestra: cn(FILA, "bg-gray-100"), texto: "Falta material o no se cargó" },
        ],
    },
    {
        titulo: "Los pasos de adentro",
        colores: [
            { muestra: cn(BARRA, "bg-red-100 shadow-[inset_3px_0_0_#dc2626]"), texto: "La persona o la máquina ya tiene otra cosa a esa hora" },
            { muestra: cn(BARRA, "bg-red-50 shadow-[inset_3px_0_0_#DC143C]"), texto: "Es de la persona o máquina del filtro" },
            { muestra: cn(CUADRO, "border-amber-400 bg-amber-50"), texto: "Cambio sin aceptar todavía" },
            { muestra: cn(CUADRO, "border-amber-400 bg-amber-100"), texto: "Inicio: arranca ese día" },
            { muestra: cn(CUADRO, "border-blue-300 bg-blue-50"), texto: "Inicio: viene de antes y sigue ese día" },
        ],
    },
    {
        titulo: "El estado del paso",
        colores: [
            { muestra: cn(CUADRO, "border-gray-200 bg-gray-100"), texto: "Pendiente" },
            { muestra: cn(CUADRO, "border-blue-200 bg-blue-100"), texto: "En proceso" },
            { muestra: cn(CUADRO, "border-green-200 bg-green-100"), texto: "Finalizado" },
        ],
    },
];

export function GlosarioDeColores({ pantalla, align = "end", className }: {
    pantalla: "vista-previa" | "lista";
    align?: "start" | "end";
    className?: string;
}) {
    const grupos = pantalla === "vista-previa" ? VISTA_PREVIA : LISTA_DE_OT;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-8 gap-1.5 text-xs", className)}
                    title="Qué quiere decir cada color"
                >
                    <Palette className="h-3.5 w-3.5" />
                    Colores
                </Button>
            </PopoverTrigger>
            <PopoverContent align={align} collisionPadding={16} className="w-[min(340px,calc(100vw-2rem))] p-0">
                <div className="border-b bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-gray-800">Qué quiere decir cada color</div>
                </div>
                <div className="max-h-[min(460px,70vh)] space-y-3 overflow-y-auto p-3">
                    {grupos.map(g => (
                        <section key={g.titulo}>
                            <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">{g.titulo}</h4>
                            <ul className="space-y-1">
                                {g.colores.map(c => (
                                    <li key={c.texto} className="flex items-center gap-2 text-xs text-gray-700">
                                        <span className={cn("shrink-0", c.muestra)} aria-hidden />
                                        {c.texto}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
