"use client";

/**
 * El cartel de arriba cuando a Recursos se llega desde un aviso del plan.
 *
 * El aviso dice QUÉ hacer ("dale el rango TERCERIZADO", "decile en qué máquinas se
 * hace") y el botón "Ir a arreglarlo" trae hasta acá, pero se abre en otra pestaña:
 * al llegar, el aviso quedó en la otra y lo único que había era una lista. Con la
 * solución que traía a una lista de personas no había forma de saber a quién ni para
 * qué, y con un filtro que no encontraba nada no había forma de saber qué estaba
 * filtrando (Lucas, 23/09/2026: tocó el botón y "le quedaba vacía la pantalla").
 *
 * Por eso repite el aviso y la solución, dice qué se está mostrando y deja sacar el
 * filtro con un botón. Un filtro que no se ve es lo que hace que una lista vacía
 * parezca una pantalla rota.
 */

import { ArrowUpRight, Eye, X } from "lucide-react";

interface Props {
    /** El título del aviso, tal cual se leía en el plan. */
    titulo?: string | null;
    /** La solución que se vino a aplicar. */
    hacer?: string | null;
    /** Dónde se toca eso en esta solapa, o que con este usuario no se puede. */
    como?: string | null;
    /** Los nombres de lo que se está mostrando por el aviso (vacío = todo). */
    mostrando?: string[];
    /** Cuántos hay en total en la solapa, para que "ver todos" diga cuántos son. */
    total?: number;
    onVerTodos?: () => void;
    onCerrar: () => void;
    /** La solapa a la que apuntaba el aviso, cuando quien mira no la puede ver (RF-24). */
    sinAccesoA?: string | null;
}

export default function DesdeAviso({ titulo, hacer, como, mostrando = [], total, onVerTodos, onCerrar, sinAccesoA }: Props) {
    return (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sky-950 sm:px-4">
            <div className="flex items-start gap-2.5">
                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 rotate-180 text-sky-600" />
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">
                        Venís de un aviso del plan
                    </p>
                    {titulo && <p className="text-sm font-semibold leading-snug">{titulo}</p>}
                    {hacer && (
                        <p className="text-sm leading-snug">
                            <span className="font-semibold">Qué hacer: </span>
                            {hacer}
                        </p>
                    )}
                    {como && !sinAccesoA && <p className="text-xs leading-snug text-sky-900/80">{como}</p>}
                    {sinAccesoA && (
                        <p className="text-sm leading-snug text-amber-900">
                            Esto se hace en <strong>{sinAccesoA}</strong>, y tu usuario no tiene acceso
                            a esa solapa. Pedíselo a quien administra los usuarios.
                        </p>
                    )}
                    {mostrando.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs">
                            <span className="inline-flex items-center gap-1 text-sky-800">
                                <Eye className="h-3.5 w-3.5 shrink-0" />
                                Mostrando solo {mostrando.length === 1 ? "el del aviso" : `los ${mostrando.length} del aviso`}:
                            </span>
                            <span className="font-medium">{mostrando.join(", ")}</span>
                            {onVerTodos && (
                                <button
                                    type="button"
                                    onClick={onVerTodos}
                                    className="rounded border border-sky-300 bg-white px-1.5 py-0.5 font-medium text-sky-800 hover:bg-sky-100 transition-colors"
                                >
                                    Ver {total ? `los ${total}` : "todos"}
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={onCerrar}
                    className="shrink-0 rounded p-1 text-sky-700 hover:bg-sky-100 transition-colors"
                    title="Cerrar el cartel y ver la lista entera"
                    aria-label="Cerrar el cartel del aviso"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
