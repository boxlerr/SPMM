"use client";

import { useEffect, useState } from "react";
import { FileClock, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    BorradorPlan,
    BorradorResumen,
    antiguedadTexto,
    borrarBorrador,
    estaViejo,
    listarBorradores,
    obtenerBorrador,
} from "@/lib/borradorPlan";

/**
 * "Retomar borrador": los planes calculados y todavía sin confirmar.
 *
 * Existe porque el cálculo es caro —con 34 OTs son varios minutos— y hasta ahora
 * cerrar la vista previa lo tiraba entero, junto con cada retoque hecho a mano.
 *
 * El botón no aparece si no hay nada guardado: un botón que casi siempre abre una
 * lista vacía enseña a ignorarlo.
 */
export function BorradoresPlan({
    onAbrir,
    refrescar = 0,
}: {
    onAbrir: (borrador: BorradorPlan) => void;
    /** Cambiá este número para que vuelva a pedir la lista. */
    refrescar?: number;
}) {
    const [borradores, setBorradores] = useState<BorradorResumen[]>([]);
    const [abierto, setAbierto] = useState(false);
    const [cargando, setCargando] = useState<number | null>(null);

    useEffect(() => {
        let vigente = true;
        listarBorradores().then(bs => { if (vigente) setBorradores(bs); });
        return () => { vigente = false; };
    }, [refrescar, abierto]);

    if (borradores.length === 0) return null;

    const abrir = async (id: number) => {
        setCargando(id);
        const b = await obtenerBorrador(id);
        setCargando(null);
        if (!b) {
            // Se lo llevó otro: sacarlo de la lista en vez de dejar una fila que no
            // hace nada al tocarla.
            setBorradores(bs => bs.filter(x => x.id !== id));
            return;
        }
        setAbierto(false);
        onAbrir(b);
    };

    const eliminar = async (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (await borrarBorrador(id)) {
            setBorradores(bs => bs.filter(x => x.id !== id));
        }
    };

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2 text-xs">
                    <FileClock className="h-4 w-4 text-amber-600" />
                    Retomar borrador
                    <span className="rounded bg-amber-100 px-1.5 py-px text-[11px] font-semibold text-amber-700">
                        {borradores.length}
                    </span>
                </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-[26rem] p-0">
                <div className="border-b px-4 py-3">
                    <p className="text-sm font-semibold text-slate-800">Planes sin confirmar</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                        Se abren sin recalcular, con los cambios que hayas hecho a mano.
                    </p>
                </div>

                <div className="max-h-80 overflow-auto">
                    {borradores.map(b => {
                        const viejo = estaViejo(b.actualizado_en);
                        return (
                            <button
                                key={b.id}
                                onClick={() => abrir(b.id)}
                                disabled={cargando === b.id}
                                className="group flex w-full items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-60"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-slate-800">
                                        {b.cantidad_ots} {b.cantidad_ots === 1 ? "orden" : "órdenes"}
                                        <span className="font-normal text-slate-500">
                                            {" · "}{b.cantidad_procesos} procesos
                                        </span>
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        {antiguedadTexto(b.actualizado_en)}
                                        {b.nombre_usuario ? ` · ${b.nombre_usuario}` : ""}
                                    </p>
                                    {viejo && (
                                        <p className="mt-1 text-[11px] leading-snug text-amber-700">
                                            Puede haber quedado viejo: desde entonces pudieron cambiar
                                            OTs, rangos o habilidades. Se abre igual y podés recalcular.
                                        </p>
                                    )}
                                </div>
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    onClick={(e) => eliminar(e, b.id)}
                                    className="mt-0.5 rounded p-1 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
                                    title="Descartar este borrador"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </span>
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
