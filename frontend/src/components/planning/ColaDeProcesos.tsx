"use client";

/**
 * La cola: lo que se dejó para hacer todo junto.
 *
 * Lucas, 28/10/2026, mirando un amolado que el plan le daba a Gustavo: «acá poner sin
 * asignar y que me quede tipo en cola… en vez de pintar una pieza por vez, la pateamos
 * todo para pintar todos juntos, y ponemos un pasante». Un paso se deja en cola desde la
 * vista previa (el botón de capas de cada paso); acá se ve todo lo que se juntó, por
 * proceso, y se saca:
 *
 *  - «Sacar» un paso: vuelve a entrar al plan como siempre, al recalcular.
 *  - «Planificar juntos»: arma un plan con esos pasos (y lo que les sigue en cada OT), con
 *    la misma persona y uno atrás del otro. Salen de la cola recién al confirmar ese plan.
 *
 * Se esconde sola cuando no hay nada en cola.
 */

import * as React from "react";
import { Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/lib/toast";
import { aplicarPausa, pasosEnCola, reanudar, usePausasActivas, type Pausa } from "@/lib/pausas";

export interface GrupoDeLaCola {
    /** El proceso, como lo dice el paso («PINTURA»). */
    nombre: string;
    pausas: Pausa[];
    minutos: number;
}

/** «PINTURA» y «Pintura» son lo mismo: se agrupa sin mayúsculas ni espacios de más. */
const claveDe = (nombre: string | null) => (nombre ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const horas = (min: number) =>
    min < 60 ? `${min} min` : `${(min / 60).toFixed(1).replace(".", ",").replace(/,0$/, "")} h`;

export function agruparLaCola(pausas: Pausa[], minutosDe: (p: Pausa) => number): GrupoDeLaCola[] {
    const grupos = new Map<string, GrupoDeLaCola>();
    for (const p of pausas) {
        const k = claveDe(p.nombre_proceso) || "SIN NOMBRE";
        const g = grupos.get(k) ?? { nombre: k, pausas: [], minutos: 0 };
        g.pausas.push(p);
        g.minutos += minutosDe(p);
        grupos.set(k, g);
    }
    return [...grupos.values()]
        .map(g => ({ ...g, pausas: [...g.pausas].sort((a, b) => a.desde.localeCompare(b.desde)) }))
        .sort((a, b) => b.pausas.length - a.pausas.length || a.nombre.localeCompare(b.nombre));
}

export function ColaDeProcesos({ minutosDe, onPlanificarJuntos, puedePlanificar }: {
    /** Los minutos de ese paso, de la OT cargada en pantalla (0 si no se sabe). */
    minutosDe: (p: Pausa) => number;
    onPlanificarJuntos: (grupo: GrupoDeLaCola) => void;
    puedePlanificar: boolean;
}) {
    const foto = usePausasActivas();
    const enCola = React.useMemo(() => pasosEnCola(foto), [foto]);
    const grupos = React.useMemo(() => agruparLaCola(enCola, minutosDe), [enCola, minutosDe]);
    const [sacando, setSacando] = React.useState<number | null>(null);
    const [abierto, setAbierto] = React.useState(false);

    if (enCola.length === 0) return null;

    const sacar = async (p: Pausa) => {
        setSacando(p.id);
        try {
            aplicarPausa(await reanudar(p.id_orden_trabajo, p.id_otp));
            toast.success(`${p.nombre_proceso ?? "El paso"} de la OT ${p.numero_ot} salió de la cola. Entra en el próximo plan de esa OT.`);
        } catch (e) {
            toast.error(`No se pudo sacar de la cola: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setSacando(null);
        }
    };

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="border-sky-300 bg-sky-50 text-sky-800 shadow-sm hover:bg-sky-100 flex-1 md:flex-none"
                    title="Lo que se dejó en cola para hacerlo todo junto"
                >
                    <Layers className="h-4 w-4 md:mr-2" />
                    <span className="hidden md:inline">Cola</span>
                    <span className="ml-1.5 rounded-full bg-sky-600 px-1.5 text-[11px] font-semibold text-white">{enCola.length}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" collisionPadding={16} className="w-[min(420px,calc(100vw-2rem))] p-0">
                <div className="border-b bg-sky-50/60 p-3">
                    <div className="text-sm font-semibold text-gray-900">En cola para hacer todo junto</div>
                    <p className="mt-0.5 text-xs text-gray-600">
                        Cada paso en cola y lo que le sigue en su OT quedan fuera del plan. «Planificar juntos» los
                        pone con la misma persona, uno atrás del otro.
                    </p>
                </div>
                <div className="max-h-[min(460px,70vh)] divide-y overflow-y-auto">
                    {grupos.map(g => (
                        <section key={g.nombre} className="p-3">
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-gray-900">{g.nombre}</div>
                                    <div className="text-xs text-gray-500">
                                        {g.pausas.length} {g.pausas.length === 1 ? "paso" : "pasos"}
                                        {g.minutos > 0 && <> · {horas(g.minutos)}</>}
                                    </div>
                                </div>
                                {puedePlanificar && (
                                    <Button
                                        size="sm"
                                        className="h-8 bg-sky-600 text-xs text-white hover:bg-sky-700"
                                        onClick={() => { setAbierto(false); onPlanificarJuntos(g); }}
                                        title={`Arma un plan con ${g.pausas.length === 1 ? "este paso" : `estos ${g.pausas.length} pasos`} y lo que les sigue en cada OT, con la misma persona y uno atrás del otro. Salen de la cola al confirmar ese plan.`}
                                    >
                                        Planificar juntos
                                    </Button>
                                )}
                            </div>
                            <ul className="mt-2 space-y-1">
                                {g.pausas.map(p => (
                                    <li key={p.id} className="flex items-center gap-2 text-xs text-gray-700">
                                        <span className="font-mono font-semibold text-gray-900">OT {p.numero_ot}</span>
                                        <span className="text-gray-500">paso {p.paso ?? "—"}</span>
                                        <span className="min-w-0 flex-1 truncate text-gray-500"
                                            title={`La dejó en cola ${p.usuario_pausa ?? "alguien"} el ${p.desde.slice(8, 10)}/${p.desde.slice(5, 7)}`}>
                                            desde el {Number(p.desde.slice(8, 10))}/{Number(p.desde.slice(5, 7))}
                                            {p.usuario_pausa ? ` · ${p.usuario_pausa}` : ""}
                                        </span>
                                        {puedePlanificar && (
                                            <button
                                                type="button"
                                                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                                                disabled={sacando !== null}
                                                onClick={() => void sacar(p)}
                                                title="Sacarlo de la cola: vuelve a entrar en el plan de su OT, como siempre"
                                            >
                                                {sacando === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sacar"}
                                            </button>
                                        )}
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
