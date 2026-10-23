"use client";

/**
 * «Qué OT entran» del armador de reportes: la lista de las OT que dejan pasar el período y
 * los filtros, para tildar o destildar una por una.
 *
 * Lucas (23/10/2026): «si filtro las OT de Cañuelas, necesito poder quitar del reporte las
 * que no me interesan. Lo ideal sería filtrar por período y cliente, visualizar las OT,
 * seleccionar cuáles quiero incluir y generar un reporte únicamente con esas órdenes, sin
 * modificar ni eliminar las OT del sistema».
 *
 * Cada tilde cambia la receta al toque (la vista previa se pide sola) y lo elegido viaja como
 * un filtro más del N° de OT (ver conElegidas en lib/reportes): se guarda con el reporte y
 * sale en los criterios del Excel y del PDF.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ListChecks, Loader2, Search, Undo2 } from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
    MAXIMO_ELEGIDAS,
    conElegidas,
    filtroDeElegidas,
    pedirOTDelReporte,
    quedaEnElReporte,
    type ColumnaCatalogo,
    type ConfigReporte,
    type FuenteCatalogo,
    type OTDelReporte,
} from "@/lib/reportes";
import { Flotante } from "./Flotante";

const miles = (n: number) => n.toLocaleString("es-AR");

export function ElegirOT({
    fuente,
    columna,
    receta,
    onCambiar,
}: {
    fuente: FuenteCatalogo;
    columna: ColumnaCatalogo;
    receta: ConfigReporte;
    onCambiar: (r: ConfigReporte) => void;
}) {
    const [abierto, setAbierto] = useState(false);
    const [lista, setLista] = useState<OTDelReporte[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [buscar, setBuscar] = useState("");

    const filtro = filtroDeElegidas(receta);
    // La lista depende de todo MENOS de lo elegido: se vuelve a pedir si cambia otro filtro.
    const claveLista = JSON.stringify({ ...receta, filtros: receta.filtros.filter((f) => f !== filtro), columnas: [], orden: null });

    useEffect(() => {
        if (!abierto) return;
        const ctrl = new AbortController();
        setError(null);
        pedirOTDelReporte(receta, fuente, ctrl.signal)
            .then(setLista)
            .catch((e) => {
                if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo traer la lista de OT.");
            });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto, claveLista]);

    const todas = useMemo(() => (lista ?? []).map((o) => o.numero), [lista]);
    const tildadas = useMemo(
        () => new Set(todas.filter((n) => quedaEnElReporte(filtro, n))),
        [todas, filtro],
    );
    const q = buscar.trim().toLowerCase();
    const visibles = (lista ?? []).filter((o) =>
        !q || String(o.numero).includes(q) || (o.cliente ?? "").toLowerCase().includes(q));

    const poner = (nuevas: Set<number> | null) => {
        if (nuevas && lista) {
            const corta = Math.min(nuevas.size, lista.length - nuevas.size);
            if (corta > MAXIMO_ELEGIDAS) return;
        }
        onCambiar(conElegidas(receta, columna.codigo, todas, nuevas));
    };
    const alternar = (n: number) => {
        const nuevas = new Set(tildadas);
        if (nuevas.has(n)) nuevas.delete(n);
        else nuevas.add(n);
        poner(nuevas);
    };
    const tildarVisibles = (si: boolean) => {
        const nuevas = new Set(tildadas);
        visibles.forEach((o) => (si ? nuevas.add(o.numero) : nuevas.delete(o.numero)));
        poner(nuevas);
    };

    // Lo que se dice sin abrir la lista: sale de la receta, no hace falta pedir nada.
    const valores = (filtro?.valores ?? []).map(String);
    const resumen = !filtro
        ? "Todas las que dejan pasar el período y los filtros."
        : filtro.op === "solo"
            ? valores.length === 0
                ? "Ninguna: tildá las que van."
                : `Sólo ${valores.length === 1 ? "la OT" : `${valores.length} OT`}: ${listar(valores)}`
            : `Todas menos ${valores.length === 1 ? "la OT" : `${valores.length} OT`}: ${listar(valores)}`;

    return (
        <div className="rounded-xl border border-[#1e3a5f]/15 bg-[#1e3a5f]/[0.03] p-2.5">
            <div className="mb-1 flex items-center gap-2">
                <ListChecks className="h-3.5 w-3.5 text-[#DC143C]" />
                <span className="flex-1 text-xs font-semibold text-gray-800">Qué OT entran</span>
                {filtro && (
                    <button
                        type="button"
                        onClick={() => onCambiar({ ...receta, filtros: receta.filtros.filter((f) => f !== filtro) })}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#1e3a5f] hover:bg-[#1e3a5f]/10"
                    >
                        <Undo2 className="h-3 w-3" /> Volver a todas
                    </button>
                )}
            </div>
            <p className="mb-2 text-[11px] leading-snug text-gray-600">{resumen}</p>
            <Popover open={abierto} onOpenChange={setAbierto}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="flex h-9 w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-2.5 text-left text-sm font-medium text-gray-800 shadow-sm hover:border-[#1e3a5f]/40"
                    >
                        Elegir las OT una por una…
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </button>
                </PopoverTrigger>
                <Flotante align="start" className="w-[min(380px,calc(100vw-2rem))] p-0">
                    <div className="space-y-2 border-b border-gray-100 p-2">
                        <label className="relative block">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                            <input
                                autoFocus
                                value={buscar}
                                onChange={(e) => setBuscar(e.target.value)}
                                placeholder="Buscar por número o cliente"
                                className="h-8 w-full rounded-md border border-gray-200 pl-7 pr-2 text-sm focus:border-[#1e3a5f] focus:outline-none"
                            />
                        </label>
                        {lista && lista.length > 0 && (
                            <div className="flex items-center gap-2 text-[11px]">
                                <span className="flex-1 text-gray-500">
                                    {miles(tildadas.size)} de {miles(lista.length)} tildadas
                                </span>
                                <button type="button" onClick={() => tildarVisibles(true)}
                                        className="rounded px-1.5 py-0.5 font-medium text-[#1e3a5f] hover:bg-gray-100">
                                    Tildar {q ? "estas" : "todas"}
                                </button>
                                <button type="button" onClick={() => tildarVisibles(false)}
                                        className="rounded px-1.5 py-0.5 font-medium text-[#1e3a5f] hover:bg-gray-100">
                                    Destildar {q ? "estas" : "todas"}
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="max-h-72 overflow-y-auto p-1">
                        {error && <p className="px-2 py-3 text-xs text-amber-700">{error}</p>}
                        {!error && lista === null && (
                            <p className="flex items-center gap-1.5 px-2 py-3 text-xs text-gray-500">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando las OT…
                            </p>
                        )}
                        {lista && lista.length === 0 && (
                            <p className="px-2 py-3 text-xs text-gray-500">Ninguna OT con el período y los filtros de ahora.</p>
                        )}
                        {visibles.map((o) => {
                            const si = tildadas.has(o.numero);
                            return (
                                <button
                                    key={o.numero}
                                    type="button"
                                    onClick={() => alternar(o.numero)}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                                >
                                    <span className={cn(
                                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                        si ? "border-[#DC143C] bg-[#DC143C] text-white" : "border-gray-300",
                                    )}>
                                        {si && <Check className="h-3 w-3" />}
                                    </span>
                                    <span className={cn("w-12 shrink-0 font-semibold tabular-nums", !si && "text-gray-400")}>{o.numero}</span>
                                    <span className={cn("min-w-0 flex-1 truncate", si ? "text-gray-700" : "text-gray-400")}>
                                        {o.cliente ?? "—"}
                                    </span>
                                    <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                                        {miles(o.filas)} {o.filas === 1 ? "fila" : "filas"}
                                    </span>
                                </button>
                            );
                        })}
                        {lista && lista.length > 0 && visibles.length === 0 && (
                            <p className="px-2 py-2 text-xs text-gray-500">Nada con «{buscar.trim()}».</p>
                        )}
                    </div>
                    <p className="border-t border-gray-100 px-3 py-2 text-[11px] leading-snug text-gray-500">
                        Saca las OT de este reporte nada más: no se tocan ni se borran en el sistema.
                    </p>
                </Flotante>
            </Popover>
        </div>
    );
}

function listar(valores: string[]): string {
    return valores.length <= 6 ? valores.join(", ") : `${valores.slice(0, 6).join(", ")} y ${valores.length - 6} más`;
}
