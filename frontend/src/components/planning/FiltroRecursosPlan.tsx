"use client";

/**
 * RF-29. Los dos filtros de lo planificado —recurso humano y máquina— y la franja que
 * dice qué está puesto.
 *
 * La lógica (qué paso cuenta, cómo se combinan) vive en lib/filtroRecursos: esto es
 * sólo cómo se eligen y cómo se sacan. Lo usa la tabla de Planificadas; en el modo
 * compacto del planificador no va (ahí todavía no hay nadie asignado).
 */

import React from "react";
import { Check, ChevronsUpDown, Cog, Search, User, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FiltroRecursos, OpcionRecurso } from "@/lib/filtroRecursos";

interface SelectorProps {
    rotulo: string;
    Icono: typeof User;
    opciones: OpcionRecurso[];
    elegidos: number[];
    onChange: (ids: number[]) => void;
    /** Qué decir cuando nadie tiene pasos en esta lista. */
    vacio: string;
    className?: string;
}

/**
 * Un desplegable con casillas: se pueden tildar varios. Al lado de cada uno, cuántos
 * pasos tiene en la lista; con cero se ve apagado pero se puede tildar igual (en otra
 * solapa puede tener).
 */
function SelectorMultiple({ rotulo, Icono, opciones, elegidos, onChange, vacio, className }: SelectorProps) {
    const [texto, setTexto] = React.useState("");
    const elegidosSet = React.useMemo(() => new Set(elegidos), [elegidos]);
    const visibles = React.useMemo(() => {
        const t = texto.trim().toLowerCase();
        return t ? opciones.filter((o) => o.nombre.toLowerCase().includes(t)) : opciones;
    }, [opciones, texto]);

    const alternar = (id: number) =>
        onChange(elegidosSet.has(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);

    const valor = elegidos.length === 0
        ? "Todos"
        : elegidos.length === 1
            ? (opciones.find((o) => o.id === elegidos[0])?.nombre ?? "1 elegido")
            : `${elegidos.length} elegidos`;

    return (
        <Popover onOpenChange={(abierto) => { if (!abierto) setTexto(""); }}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className={cn(
                        "h-10 justify-between gap-1.5 bg-white px-2.5 text-xs font-normal",
                        elegidos.length > 0 ? "border-red-300 ring-1 ring-red-200" : "border-gray-300",
                        className,
                    )}
                    title={`Mostrar sólo los pasos de ${rotulo === "Máquina" ? "esta máquina" : "esta persona"} (se pueden elegir varias)`}
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        <Icono className={cn("h-3.5 w-3.5 shrink-0", elegidos.length > 0 ? "text-red-600" : "text-gray-400")} />
                        <span className="truncate">
                            <span className="text-gray-500">{rotulo}: </span>
                            <span className={elegidos.length > 0 ? "font-semibold text-gray-900" : "text-gray-500"}>{valor}</span>
                        </span>
                    </span>
                    <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(300px,calc(100vw-2rem))] p-0">
                <div className="flex items-center border-b px-2.5 py-2">
                    <Search className="mr-2 h-3.5 w-3.5 shrink-0 opacity-40" />
                    <input
                        className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
                        placeholder={`Buscar ${rotulo === "Máquina" ? "máquina" : "persona"}…`}
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                    />
                </div>
                <div className="max-h-[280px] overflow-auto p-1.5">
                    {elegidos.length > 0 && (
                        <button
                            type="button"
                            onClick={() => onChange([])}
                            className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                            <X className="h-3.5 w-3.5" />
                            Mostrar todos
                        </button>
                    )}
                    {visibles.length === 0 ? (
                        <p className="px-2 py-3 text-center text-xs text-gray-500">
                            {opciones.length === 0 ? vacio : "No hay coincidencias."}
                        </p>
                    ) : (
                        visibles.map((o) => {
                            const tildado = elegidosSet.has(o.id);
                            return (
                                <button
                                    key={o.id}
                                    type="button"
                                    role="menuitemcheckbox"
                                    aria-checked={tildado}
                                    onClick={() => alternar(o.id)}
                                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100"
                                >
                                    <span className={cn(
                                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                                        tildado ? "border-red-600 bg-red-600 text-white" : "border-gray-300 text-transparent",
                                    )}>
                                        <Check className="h-3 w-3" />
                                    </span>
                                    <span className={cn("min-w-0 flex-1 truncate", o.pasos === 0 && !tildado && "text-gray-400")}>
                                        {o.nombre}
                                    </span>
                                    <span
                                        className="shrink-0 tabular-nums text-[10px] text-gray-400"
                                        title={`${o.pasos} paso${o.pasos === 1 ? "" : "s"} en esta lista`}
                                    >
                                        {o.pasos}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export interface SelectoresDeRecursosProps {
    filtro: FiltroRecursos;
    onChange: (f: FiltroRecursos) => void;
    opciones: { operarios: OpcionRecurso[]; maquinas: OpcionRecurso[] };
    /** Uno abajo del otro y de todo el ancho (el panel del teléfono). */
    apilados?: boolean;
}

/** Los dos desplegables. */
export function SelectoresDeRecursos({ filtro, onChange, opciones, apilados = false }: SelectoresDeRecursosProps) {
    const ancho = apilados ? "w-full" : "w-[210px] xl:w-[240px]";
    return (
        <>
            <SelectorMultiple
                rotulo="Recurso humano"
                Icono={User}
                opciones={opciones.operarios}
                elegidos={filtro.operarios}
                onChange={(operarios) => onChange({ ...filtro, operarios })}
                vacio="Ningún paso de esta lista tiene recurso humano asignado."
                className={ancho}
            />
            <SelectorMultiple
                rotulo="Máquina"
                Icono={Cog}
                opciones={opciones.maquinas}
                elegidos={filtro.maquinas}
                onChange={(maquinas) => onChange({ ...filtro, maquinas })}
                vacio="Ningún paso de esta lista tiene máquina asignada."
                className={ancho}
            />
        </>
    );
}

export interface FranjaDeRecursosProps {
    filtro: FiltroRecursos;
    onChange: (f: FiltroRecursos) => void;
    opciones: { operarios: OpcionRecurso[]; maquinas: OpcionRecurso[] };
    pasos: number;
    ordenes: number;
    /** «esta semana», «este día»: se agrega al contador para que se lea completo. */
    rotuloVentana?: string;
    /** Hay demasiadas OT para abrirlas todas solas (ver la tabla). */
    sinDesplegar?: boolean;
}

/**
 * Lo que está puesto, a la vista: un chip por persona o máquina con su cruz, el
 * contador y «Sacar filtros». Va abajo del buscador, así no hay forma de mirar una
 * lista filtrada sin darse cuenta de que lo está.
 */
export function FranjaDeRecursos({ filtro, onChange, opciones, pasos, ordenes, rotuloVentana, sinDesplegar }: FranjaDeRecursosProps) {
    const nombre = (lista: OpcionRecurso[], id: number) => lista.find((o) => o.id === id)?.nombre ?? `#${id}`;
    const chip = (key: string, Icono: typeof User, texto: string, sacar: () => void) => (
        <span
            key={key}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-red-200 bg-white py-0.5 pl-2 pr-0.5 text-xs font-medium text-red-900 shadow-sm"
        >
            <Icono className="h-3 w-3 shrink-0 text-red-500" />
            <span className="truncate">{texto}</span>
            <button
                type="button"
                onClick={sacar}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-red-400 hover:bg-red-100 hover:text-red-700"
                aria-label={`Sacar el filtro ${texto}`}
                title="Sacar este filtro"
            >
                <X className="h-3 w-3" />
            </button>
        </span>
    );

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-red-100 bg-rose-50/60 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-red-900/60">Filtrando</span>
                {filtro.operarios.map((id) =>
                    chip(`op-${id}`, User, nombre(opciones.operarios, id),
                        () => onChange({ ...filtro, operarios: filtro.operarios.filter((x) => x !== id) })))}
                {filtro.maquinas.map((id) =>
                    chip(`maq-${id}`, Cog, nombre(opciones.maquinas, id),
                        () => onChange({ ...filtro, maquinas: filtro.maquinas.filter((x) => x !== id) })))}
                <button
                    type="button"
                    onClick={() => onChange({ operarios: [], maquinas: [] })}
                    className="px-1 text-xs font-medium text-red-700/70 underline-offset-2 hover:text-red-900 hover:underline"
                >
                    Sacar filtros
                </button>
            </div>
            <p className="text-xs text-red-950/80">
                <span className="font-semibold tabular-nums">{pasos}</span> paso{pasos === 1 ? "" : "s"} en{" "}
                <span className="font-semibold tabular-nums">{ordenes}</span> OT
                {rotuloVentana ? ` ${rotuloVentana}` : ""}
                {sinDesplegar && <span className="text-red-900/60"> · desplegá una OT para ver cuáles</span>}
            </p>
        </div>
    );
}
