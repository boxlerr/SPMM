"use client";

/**
 * Lo que explica el estado de un paso en Planificadas: quién lo arrancó o lo cerró, y
 * por qué un paso de una OT planificada no tiene persona ni máquina.
 *
 * Lucas, 28/10/2026, en la 15869: el paso 1 decía «Finalizado», no tenía a nadie y no
 * había forma de saber por qué. Lo había cerrado un usuario de SPMM el 23/9 y, como el
 * plan deja afuera lo terminado, al planificar quedó sin fila del plan. Las dos cosas
 * estaban en la base; la pantalla no decía ninguna.
 */

import { fechaDeLaApi } from "@/lib/plan-fechas";

export interface EstadoMarcado {
    /** null = el cambio no dejó autor (un script, una corrida a mano). */
    por: string | null;
    en: string | null;
}

/** «agustin blAs bonnaluc» → «Agustin Blas Bonnaluc»: el registro guarda el nombre
 *  como se cargó la cuenta. */
function nombre(texto: string): string {
    return texto.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

function cuando(en: string | null): string {
    const f = fechaDeLaApi(en);
    if (!f) return "";
    const hh = String(f.getHours()).padStart(2, "0");
    const mm = String(f.getMinutes()).padStart(2, "0");
    return `${f.getDate()}/${f.getMonth() + 1} ${hh}:${mm}`;
}

/** «Lo cerró el 23/9 15:13 / Fulano», debajo del estado. Sólo para En curso y Finalizado. */
export function QuienLoMarco({ marcado, estado }: { marcado?: EstadoMarcado | null; estado?: number }) {
    if (!marcado || (estado !== 2 && estado !== 3)) return null;
    const verbo = estado === 3 ? "Lo cerró" : "Lo arrancó";
    const quien = marcado.por ? nombre(marcado.por) : "sin registrar quién";
    const fecha = cuando(marcado.en);
    return (
        <span
            className="mt-0.5 block text-[10px] leading-tight text-gray-500"
            title={`${verbo} ${quien}${fecha ? ` el ${fecha}` : ""}`}
        >
            {/* La columna del estado es angosta: la fecha arriba y el nombre entero
                abajo, en hasta dos renglones, en vez de «Agustin Blas B…». */}
            <span className="block">{verbo}{fecha ? ` el ${fecha}` : ""}</span>
            <span className="line-clamp-2 break-words font-medium text-gray-600">{quien}</span>
        </span>
    );
}

/** En lugar de «Sin asignar» cuando el paso no tiene fila en el plan de su OT. */
export function FueraDelPlan({ terminado }: { terminado: boolean }) {
    if (terminado) {
        return (
            <span
                className="block truncate text-xs italic text-gray-500"
                title="El plan deja afuera los pasos que ya están terminados: por eso no tiene persona ni máquina."
            >
                Ya estaba terminado al planificar
            </span>
        );
    }
    return (
        <span
            className="block rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
            title="Se cargó o se volvió a abrir después de planificar, así que el plan guardado no lo tiene. Al recalcular la OT le busca persona, máquina y horario."
        >
            <span className="block font-semibold">Fuera del plan</span>
            <span className="block text-[10px]">Entra al recalcular la OT</span>
        </span>
    );
}
