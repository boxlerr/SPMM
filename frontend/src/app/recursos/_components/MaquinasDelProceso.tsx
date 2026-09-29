"use client";

/**
 * La celda «Recurso maquinaria» de Recursos › Procesos.
 *
 * Pedido de Julián (29/9/2026, en la reunión con Lucas): la fila de «FRESADORA F6» decía
 * quién puede hacerla pero no en qué máquina, y «no sabemos para qué máquina está
 * asignado». No lo estaba: de 415 procesos sólo 8 tienen la máquina cargada, y el resto
 * lo resuelve el planificador deduciendo del nombre —F6 va a FRESADORA 1, FRESADORA 2 y
 * FRESADORA VAN NORMAN; ninguna se llama F6—. Esa deducción no se veía en ningún lado.
 *
 * Qué se dibuja, según de dónde sale la lista (el backend lo resuelve con las mismas
 * reglas que el planificador; ver `lib/maquinasDelProceso`):
 *
 *   · cargada  → alguien la eligió: etiquetas de trazo firme. Una que el rango del
 *                proceso no acepta sale en amarillo, porque el planificador la descarta.
 *   · nombre   → nadie la cargó: etiquetas de trazo punteado y la leyenda «por el nombre»,
 *                para que no se lea como un dato confirmado.
 *   · a mano   → «No usa máquina».
 *   · ninguna  → «Sin máquina», que es la traba que después aparece en el plan.
 *
 * Tocar la celda abre el mismo panel que la de «Quién puede hacerlo», donde se cargan las
 * máquinas y los rangos: la respuesta y el lugar donde se cambia están en la misma fila.
 */

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProcesoCobertura } from "@/hooks/useCoberturaRangos";
import { resumenDeMaquinas } from "@/lib/maquinasDelProceso";

interface Props {
    cob: ProcesoCobertura | undefined;
    /** ¿Ya llegó la cobertura? Antes de eso no se sabe nada de nadie. */
    listo: boolean;
    /** ¿Se usa en alguna OT abierta? Un problema en un proceso que no se usa no grita. */
    enUso: boolean;
    /** Abre el panel de edición de la fila. Sin esto la celda es sólo de lectura. */
    onAbrir?: () => void;
}

export default function MaquinasDelProceso({ cob, listo, enUso, onAbrir }: Props) {
    // `!cob` además de `!listo`: la cobertura se cachea, así que un proceso creado
    // después de esa consulta no está en el mapa.
    if (!listo || !cob) return <span className="text-muted-foreground text-xs">—</span>;

    const r = resumenDeMaquinas(cob);
    const sinRango = new Set(r.sinRango.map((m) => m.id));
    const ningunaLaAcepta = r.origen === "cargada" && r.maquinas.length > 0 && r.maquinas.every((m) => sinRango.has(m.id));

    if (r.origen === "sin_dato") {
        return (
            <span
                className="text-muted-foreground text-xs italic"
                title="Nadie cargó la máquina de este proceso: el planificador la deduce del nombre."
            >
                Por el nombre del proceso
            </span>
        );
    }

    if (r.origen === "a_mano") {
        const n = r.cargadasSinUso.length;
        return (
            <span
                className="text-muted-foreground text-xs"
                title="Se hace a mano o se manda afuera: el planificador no le reserva ninguna máquina."
            >
                No usa máquina
                {n > 0 && (
                    <span
                        className="italic ml-1"
                        title="Tiene recurso maquinaria cargado, pero como el proceso va a mano el planificador no lo usa."
                    >
                        ({n === 1 ? "tiene 1 cargada" : `tiene ${n} cargadas`}, no se usa)
                    </span>
                )}
            </span>
        );
    }

    if (r.origen === "ninguna") {
        const porRango = r.motivo === "rango";
        const etiqueta = porRango ? "Ninguna acepta su rango" : onAbrir ? "Sin máquina — asignar" : "Sin máquina";
        const explicacion =
            r.motivo === "rango"
                ? "Hay máquinas de ese tipo, pero ninguna acepta el rango que pide el proceso: el planificador lo agenda sin reservar ninguna."
                : r.motivo === "sin_maquina"
                    ? "El nombre apunta a un tipo de máquina que el taller no tiene cargada: el planificador lo agenda sin reservar ninguna."
                    : "El nombre no dice en qué máquina se hace: el planificador lo agenda sin reservar ninguna.";
        const uso = enUso ? "Se usa en OTs abiertas." : "Hoy no se usa en ninguna OT abierta.";
        const colores = enUso
            ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
            : "text-muted-foreground hover:bg-muted";

        if (!onAbrir) {
            return (
                <span
                    className={`text-xs font-semibold ${enUso ? "text-amber-800" : "text-muted-foreground"}`}
                    title={`${explicacion} ${uso}`}
                >
                    {etiqueta}
                </span>
            );
        }
        return (
            <Button
                variant="outline"
                size="sm"
                onClick={onAbrir}
                className={`h-6 text-xs font-semibold ${colores}`}
                title={`${explicacion} ${uso} Clic para resolverlo acá mismo.`}
            >
                {enUso && <AlertTriangle className="h-3 w-3 mr-1" />}
                {etiqueta}
            </Button>
        );
    }

    // cargada / nombre: las etiquetas.
    const deducida = r.origen === "nombre";
    const contenido = (
        <>
            {r.maquinas.map((m) => {
                const noLaAcepta = sinRango.has(m.id);
                return (
                    <Badge
                        key={m.id}
                        variant="outline"
                        className={
                            noLaAcepta
                                ? "text-xs font-normal bg-amber-50 text-amber-800 border-amber-300"
                                : deducida
                                    ? "text-xs font-normal border-dashed text-muted-foreground"
                                    : "text-xs font-normal"
                        }
                        title={
                            noLaAcepta
                                ? "El rango que pide el proceso no acepta esta máquina: el planificador no la usa."
                                : undefined
                        }
                    >
                        {noLaAcepta && <AlertTriangle />}
                        {m.nombre}
                    </Badge>
                );
            })}
            {deducida && <span className="text-[11px] italic text-muted-foreground ml-0.5">por el nombre</span>}
            {ningunaLaAcepta && (
                <span className="text-[11px] font-semibold text-amber-800 ml-0.5">ninguna la acepta</span>
            )}
        </>
    );

    const titulo = deducida
        ? "Nadie cargó la máquina de este proceso: el planificador la deduce del nombre y elige una de estas."
        : ningunaLaAcepta
            ? "Ninguna de las máquinas cargadas acepta el rango que pide el proceso: el planificador lo agenda sin reservar ninguna."
            : "Recurso maquinaria cargado para este proceso.";

    if (!onAbrir) {
        return (
            <span className="flex flex-wrap items-center gap-1" title={titulo}>
                {contenido}
            </span>
        );
    }
    return (
        <button
            type="button"
            onClick={onAbrir}
            className="flex flex-wrap items-center gap-1 text-left hover:opacity-70 transition-opacity"
            title={`${titulo} Clic para cargarlas o cambiarlas.`}
        >
            {contenido}
        </button>
    );
}
