/**
 * Las piezas que muestran a qué hora termina un paso y con qué se pisa (reunión con
 * Lucas del 28/10/2026). Las usan la vista previa y Planificadas, con los datos de
 * `lib/choquesDelPlan`.
 */
import React from "react";
import { AlertTriangle } from "lucide-react";
import { enPartes, finAlLado, textoDelTramo, type TramoDelPlan } from "@/lib/choquesDelPlan";

/**
 * «→ 11:55» al lado del inicio. Si el paso se hace en partes, lo dice: ese fin no
 * quiere decir que la persona esté ocupada todo ese rato (el fresado de 300 minutos de
 * Alejandro iba de 07:20 a 15:00 con otras cosas metidas en el medio).
 */
export function FinDelPaso({ tramo }: { tramo?: TramoDelPlan | null }) {
    const fin = tramo ? finAlLado(tramo.inicio, tramo.fin) : null;
    if (!tramo || !fin) return null;
    const partes = enPartes(tramo);
    return (
        <span
            className="flex shrink-0 flex-col whitespace-nowrap leading-tight"
            title={partes
                ? `Termina ${fin}. Se hace en partes: de los ${tramo.hasta - tramo.desde} minutos que van del inicio al fin, `
                  + `${tramo.duracion} son de este paso y en el resto se hace otra cosa.`
                : `Termina ${fin}`}
        >
            <span className="text-xs font-semibold tabular-nums text-gray-700">→ {fin}</span>
            {partes && <span className="text-[10px] font-medium text-gray-500">en partes</span>}
        </span>
    );
}

/** Debajo de la persona o de la máquina: qué otra cosa tiene a esa hora. */
export function AvisoOcupado({ quien, tramos, onVerOT }: {
    quien: string;
    tramos: TramoDelPlan[];
    onVerOT?: (ordenId: number) => void;
}) {
    if (tramos.length === 0) return null;
    const primero = tramos[0];
    return (
        <div className="mt-1 flex items-start gap-1 text-[11px] leading-tight text-red-700" role="alert">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
                {quien} ya tiene{" "}
                {onVerOT && primero.orden_id != null ? (
                    <button
                        type="button"
                        className="font-semibold underline underline-offset-2 hover:text-red-900"
                        onClick={() => onVerOT(primero.orden_id!)}
                        title="Ir a ese paso"
                    >
                        {textoDelTramo(primero)}
                    </button>
                ) : (
                    <strong>{textoDelTramo(primero)}</strong>
                )}
                {tramos.length > 1 && ` y ${tramos.length - 1} más`}
            </span>
        </div>
    );
}

/** En la lista de personas (o de máquinas): ocupada a esa hora, y con qué. */
export function OcupadoEnLaLista({ tramos }: { tramos: TramoDelPlan[] }) {
    if (tramos.length === 0) return null;
    return (
        <span className="block text-red-600" title={tramos.map(textoDelTramo).join("\n")}>
            ⛔ Ocupado: {textoDelTramo(tramos[0])}{tramos.length > 1 ? ` y ${tramos.length - 1} más` : ""}
        </span>
    );
}
