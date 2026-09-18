"use client";

/**
 * Editar los procesos de una OT desde la propia vista previa del plan.
 *
 * Julián, 17/09: *"poder agregar procesos desde el planificador, editarlo o
 * eliminarlos o cambiar el orden […] que sean aún más editables"*.
 *
 * Ya se podía, pero atrás de un modal (`EditarProcesosOTModal`): se abría la OT entera,
 * se editaba la lista completa y recién al guardar se veía qué pasó. Esto es lo mismo
 * sobre la fila que ya estás mirando.
 *
 * LOS MINUTOS NO SE TOCAN ACÁ, Y NO ES UN OLVIDO
 *
 * Estuvieron media hora y Julián los sacó el mismo día: *"ya hablamos del tema de los
 * minutos, no se pueden cambiar de ahí, tienen que venir bien desde antes"*. El tiempo
 * de un proceso es un dato de la orden y se carga cuando se carga la OT; el
 * planificador lo muestra y nada más. Lo único que pide minutos es dar de alta un paso
 * nuevo, porque ahí no hay un "antes" de dónde sacarlos.
 *
 * LO QUE SE EDITA ES LA OT, NO EL PLAN
 *
 * Cada cambio se guarda en `orden_trabajo_proceso` por su propio endpoint —no se manda
 * la lista completa, así cambiar un paso no le pisa la máquina ni la persona a nadie—
 * y viaja con `motivo=planificacion`, que es lo que hace que el registro de cambios diga
 * «Planificador» y no «Ficha de la orden» (ver `origen_de` en
 * backend/infrastructure/auditoria_procesos.py).
 *
 * EL PLAN NO SE RECALCULA SOLO: HAY QUE PEDIRLO
 *
 * Agregar, sacar, mover o cambiar un paso deja el plan de abajo viejo, y Julián lo da
 * por sabido: *"si agrego o lo elimino, sí, lo tengo que replanificar, obviamente"*.
 * Recalcular igual es un botón y no algo automático, por dos razones: el recálculo
 * rehace TODAS las asignaciones —se llevaría puestas las máquinas y los horarios que
 * alguien acomodó a mano, que es el motivo por el que esta pantalla tampoco recalcula
 * sola cuando cambia algo en Recursos— y porque así se hacen los cinco cambios de la
 * OT y se recalcula una vez, no cinco. Por eso este hook, además de pegarle al backend,
 * se acuerda de qué se tocó: es lo único que sabe que los horarios de abajo quedaron
 * viejos, y de ahí salen las marcas y el cartel.
 */

import React from "react";
import { toast } from "sonner";
import { API_URL } from "@/config";
import { parseApiError } from "@/lib/utils";

const base = () => API_URL.replace(/\/$/, "");

const cabeceras = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
};

const cabecerasConCuerpo = (): Record<string, string> => ({
    ...cabeceras(),
    "Content-Type": "application/json",
});

/** Lo que hace que el registro de cambios diga «Planificador». Ver el comentario de arriba. */
const MOTIVO = "motivo=planificacion";

async function reventarSiFalla(res: Response, queHacia: string) {
    if (res.ok) return;
    const texto = await res.text().catch(() => "");
    throw new Error(parseApiError(texto) || `No se pudo ${queHacia} (error ${res.status}).`);
}

/** Una pasada de la OT tal como está guardada. */
export interface LineaDeOT {
    /** orden_trabajo_proceso.id */
    id: number;
    idProceso: number;
    nombre: string;
    minutos: number;
    orden: number;
}

/**
 * Las pasadas de la OT, en orden de trabajo.
 *
 * Hace falta para reordenar: el plan muestra sólo las pasadas que entraron, y la OT
 * puede tener más (las que alguien no eligió, las que quedaron afuera del horizonte).
 * Renumerar con la lista a medias le cambiaría el paso a filas que nadie tocó.
 */
async function traerLineas(ordenId: number): Promise<LineaDeOT[]> {
    const res = await fetch(`${base()}/ordenes/${ordenId}`, { headers: cabeceras() });
    await reventarSiFalla(res, "leer los procesos de la OT");
    const json = await res.json();
    const ot = json?.data ?? json;
    return [...(ot?.procesos ?? [])]
        .map((p: any): LineaDeOT => ({
            id: p.id,
            idProceso: p.proceso?.id ?? p.id_proceso,
            nombre: p.proceso?.nombre ?? "",
            minutos: p.tiempo_proceso ?? 0,
            orden: p.orden ?? 0,
        }))
        // El mismo desempate que usa el backend para numerar las pasadas
        // (`_lineas_ordenadas`): `orden` no es único —hay OTs con dos filas en el mismo
        // paso— así que manda el id.
        .sort((a, b) => (a.orden - b.orden) || (a.id - b.id));
}

/**
 * Qué se le cambió a una pasada desde que se calculó el plan.
 *
 * Los MINUTOS no están y no es un olvido: Julián, 17/09, *"no se pueden cambiar de ahí,
 * tienen que venir bien desde antes"*. El tiempo de un proceso es un dato de la orden y
 * se carga cuando se carga la OT; el planificador lo muestra y no lo toca.
 */
export interface CambioDeLinea {
    /** `id` es el proceso que quedó: la fila del plan sigue trayendo el anterior. */
    proceso?: { antes: string; ahora: string; id: number };
}

/** Una pasada agregada desde el plan: está en la OT, pero todavía no tiene horario. */
export interface FilaNueva {
    idOtp: number;
    idProceso: number;
    nombre: string;
    minutos: number;
}

/** Todo lo que se le tocó a UNA OT y el plan todavía no refleja. */
export interface CambiosDeOT {
    /** Por id de pasada. */
    lineas: Record<number, CambioDeLinea>;
    /** Pasadas que se sacaron de la OT. */
    borradas: number[];
    nuevas: FilaNueva[];
    /** id de pasada -> paso, después de reordenar. `null` = nadie tocó el orden. */
    pasos: Record<number, number> | null;
    /**
     * Los ids de la OT en el orden que tenían ANTES de que alguien la tocara.
     *
     * Sin esto, `pasos` era una foto del estado nuevo y de nada más: mover un paso y
     * volverlo a su lugar dejaba el cartel puesto para siempre, porque no había contra
     * qué comparar. Julián, 17/09/2026: *"si devuelvo el proceso a como estaba antes o
     * al tiempo o al lugar o lo que sea, tiene que desaparecer ese cartel"*.
     *
     * Se guarda la PRIMERA vez que se reordena esa OT y no se vuelve a tocar: es el
     * punto cero. Las otras dos marcas ya comparaban solas —`anotarProceso` guarda el
     * `antes` del primer cambio, y agregar+sacar se cancelan entre sí—; esta era la que
     * faltaba.
     */
    ordenOriginal: number[] | null;
}

/**
 * Una acción deshacible, con lo que hace falta para darla vuelta.
 *
 * Es una pila del lado del navegador y NO el "Deshacer" que ya existe en la lista de la
 * OT. Aquél va contra versiones (`/procesos/versiones` + `/procesos/restaurar/{id}`) y
 * esas versiones las escribe sólo el guardado de la lista COMPLETA: los endpoints de a
 * una pasada que usa el planificador no dejan ninguna. Colgarse de ahí restauraría una
 * foto anterior a todo lo que se hizo desde el plan y se llevaría puesto mucho más de lo
 * que la persona quiso deshacer — y parecería que funciona, que es lo peor.
 *
 * Tres de las cuatro vuelven exactas. Sacar un paso no: al volver a agregarlo nace con
 * otro id y sin el avance que tenía, y por eso se avisa al deshacerlo.
 */
type Deshacible =
    | { tipo: "orden"; ordenAntes: number[] }
    | { tipo: "proceso"; idOtp: number; idAntes: number; nombreAntes: string; nombreAhora: string }
    | { tipo: "agregar"; idOtp: number; idProceso: number; nombre: string }
    | { tipo: "borrar"; idOtp: number; idProceso: number; nombre: string; minutos: number };

const SIN_CAMBIOS: CambiosDeOT = { lineas: {}, borradas: [], nuevas: [], pasos: null, ordenOriginal: null };

/** Una OT sin nada tocado se saca del registro: es lo que apaga el cartel y las marcas.
 *  `ordenOriginal` NO cuenta: es la foto de referencia, no un cambio. Si contara, una
 *  OT que se reordenó y se volvió a dejar como estaba quedaría marcada igual. */
const quedaAlgo = (c: CambiosDeOT) =>
    Object.keys(c.lineas).length > 0 || c.borradas.length > 0 || c.nuevas.length > 0 || c.pasos !== null;

/** Cuántas cosas se tocaron, para el cartel.
 *
 *  El reordenamiento cuenta como UNA. Antes no contaba y `resumirCambios` sí lo
 *  nombraba, así que mover un paso mostraba «Cambiaste 0 procesos de esta OT (cambió el
 *  orden de los pasos)»: un cartel contradiciéndose consigo mismo en la misma línea. */
export function contarCambios(c: CambiosDeOT): number {
    return Object.keys(c.lineas).length + c.borradas.length + c.nuevas.length + (c.pasos ? 1 : 0);
}

/** El cartel dicho en castellano: "1 cambiado por otro proceso, 1 sacado". */
export function resumirCambios(c: CambiosDeOT): string {
    const partes: string[] = [];
    const conProceso = Object.values(c.lineas).filter(l => l.proceso).length;
    if (conProceso > 0) partes.push(conProceso === 1 ? "1 cambiado por otro proceso" : `${conProceso} cambiados por otro proceso`);
    if (c.nuevas.length > 0) partes.push(c.nuevas.length === 1 ? "1 agregado" : `${c.nuevas.length} agregados`);
    if (c.borradas.length > 0) partes.push(c.borradas.length === 1 ? "1 sacado" : `${c.borradas.length} sacados`);
    if (c.pasos) partes.push("cambió el orden");
    return partes.join(", ");
}

/**
 * Las filas que se ven en «Procesos planificados» después de los cambios.
 *
 * Saca las pasadas que se borraron —su fila del plan quedó apuntando a algo que ya no
 * existe— y, si alguien cambió el orden, las reacomoda por el paso nuevo. Los horarios
 * NO se tocan: siguen siendo los del último cálculo, y por eso quedan marcados. Un
 * proceso puede quedar arriba de otro que arranca antes: eso es justamente lo que
 * significa que el plan todavía no se rehizo.
 */
export function filasVisiblesDeOT<T extends { id_orden_trabajo_proceso?: number | null }>(
    filas: T[], cambios?: CambiosDeOT,
): T[] {
    if (!cambios) return filas;
    const fuera = new Set(cambios.borradas);
    const vivas = filas.filter(
        f => !(f.id_orden_trabajo_proceso != null && fuera.has(f.id_orden_trabajo_proceso)));
    const pasos = cambios.pasos;
    if (!pasos) return vivas;
    const pasoDe = (f: T) =>
        (f.id_orden_trabajo_proceso != null ? pasos[f.id_orden_trabajo_proceso] : undefined)
        ?? Number.MAX_SAFE_INTEGER;
    // `sort` es estable: las dos filas de un proceso de dos personas no se separan.
    return [...vivas].sort((a, b) => pasoDe(a) - pasoDe(b));
}

/**
 * Los ids de pasada que se ven, en orden y sin repetir.
 *
 * Es contra ESTA lista que las flechitas mueven un paso, y no contra la lista de la
 * OT: si el vecino de al lado en la orden es una pasada que no entró al plan, el botón
 * parecería no hacer nada.
 */
export function pasadasEnOrden(filas: { id_orden_trabajo_proceso?: number | null }[]): number[] {
    const vistas: number[] = [];
    for (const f of filas) {
        const id = f.id_orden_trabajo_proceso;
        if (id != null && !vistas.includes(id)) vistas.push(id);
    }
    return vistas;
}

export function useProcesosEnPlan() {
    const [cambios, setCambios] = React.useState<Record<number, CambiosDeOT>>({});
    /** La OT que tiene un pedido en curso: apaga sus botones mientras tanto. */
    const [trabajando, setTrabajando] = React.useState<number | null>(null);

    /** Lo que se puede deshacer, por OT y en orden. La última de la lista es la próxima. */
    const [pila, setPila] = React.useState<Record<number, Deshacible[]>>({});
    const apilar = React.useCallback((ordenId: number, a: Deshacible) => {
        setPila(p => ({ ...p, [ordenId]: [...(p[ordenId] ?? []), a] }));
    }, []);
    const desapilar = React.useCallback((ordenId: number) => {
        setPila(p => {
            const resto = (p[ordenId] ?? []).slice(0, -1);
            const copia = { ...p };
            if (resto.length > 0) copia[ordenId] = resto;
            else delete copia[ordenId];
            return copia;
        });
    }, []);

    const anotar = React.useCallback((ordenId: number, f: (c: CambiosDeOT) => CambiosDeOT) => {
        setCambios(prev => {
            const nuevo = f(prev[ordenId] ?? SIN_CAMBIOS);
            const copia = { ...prev };
            if (quedaAlgo(nuevo)) copia[ordenId] = nuevo;
            else delete copia[ordenId];
            return copia;
        });
    }, []);

    const correr = React.useCallback(async (ordenId: number, accion: () => Promise<void>) => {
        setTrabajando(ordenId);
        try {
            await accion();
            return true;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "No se pudo guardar el cambio en la OT.");
            return false;
        } finally {
            setTrabajando(null);
        }
    }, []);

    /** Anota que una pasada pasó a ser otro proceso. */
    const anotarProceso = React.useCallback((
        ordenId: number, idOtp: number, antes: string, ahora: string, id: number,
    ) => {
        anotar(ordenId, c => {
            // Una pasada agregada desde acá no lleva marca de campo: ya está marcada
            // como nueva. Se le actualiza el nombre y listo.
            if (c.nuevas.some(n => n.idOtp === idOtp)) {
                return {
                    ...c,
                    nuevas: c.nuevas.map(n => (n.idOtp === idOtp ? { ...n, idProceso: id, nombre: ahora } : n)),
                };
            }
            const previo = c.lineas[idOtp] ?? {};
            // El "antes" es el del PRIMER cambio y no el del anterior: cambiar el proceso
            // tres veces seguidas tiene que seguir diciendo de cuál salió. Y si vuelve al
            // original, la marca se va: no cambió nada.
            const desde = previo.proceso?.antes ?? antes;
            const lineas = { ...c.lineas };
            if (desde === ahora) delete lineas[idOtp];
            else lineas[idOtp] = { ...previo, proceso: { antes: desde, ahora, id } };
            return { ...c, lineas };
        });
    }, [anotar]);

    /** Cambiar QUÉ proceso es esa pasada (el "nombre" de la fila). */
    const cambiarProceso = React.useCallback((
        ordenId: number, idOtp: number, idProceso: number, nombre: string,
        nombreAntes: string, idProcesoAntes: number,
    ) => correr(ordenId, async () => {
        const res = await fetch(`${base()}/ordenes/${ordenId}/procesos/linea/${idOtp}?${MOTIVO}`, {
            method: "PUT",
            headers: cabecerasConCuerpo(),
            body: JSON.stringify({ id_proceso: idProceso }),
        });
        await reventarSiFalla(res, "cambiar el proceso");
        anotarProceso(ordenId, idOtp, nombreAntes, nombre, idProceso);
        apilar(ordenId, { tipo: "proceso", idOtp, idAntes: idProcesoAntes, nombreAntes, nombreAhora: nombre });
        toast.success(`Ahora es «${nombre}»`, {
            description: "La persona y la máquina que muestra el plan son las del proceso anterior.",
        });
    }), [correr, anotarProceso, apilar]);

    /** Sacar una pasada de la OT. Se va también del plan que se está mirando. */
    const borrarLinea = React.useCallback((
        ordenId: number, idProceso: number, idOtp: number, nombre: string, minutos = 0,
    ) => correr(ordenId, async () => {
        const res = await fetch(
            `${base()}/ordenes/${ordenId}/procesos/${idProceso}?id_otp=${idOtp}&${MOTIVO}`,
            { method: "DELETE", headers: cabeceras() },
        );
        await reventarSiFalla(res, "sacar el proceso");
        anotar(ordenId, c => {
            const eraNueva = c.nuevas.some(n => n.idOtp === idOtp);
            const lineas = { ...c.lineas };
            delete lineas[idOtp];
            return {
                ...c,
                lineas,
                nuevas: c.nuevas.filter(n => n.idOtp !== idOtp),
                // Una pasada que se agregó y se sacó acá mismo no dejó nada en el plan:
                // no hay ninguna fila que tapar.
                borradas: eraNueva ? c.borradas : [...c.borradas, idOtp],
            };
        });
        apilar(ordenId, { tipo: "borrar", idOtp, idProceso, nombre, minutos });
        toast.success(`Se sacó «${nombre}» de la OT`);
    }), [correr, anotar, apilar]);

    /** Agregar una pasada al final de la OT. Todavía sin horario: hay que recalcular. */
    const agregarLinea = React.useCallback((
        ordenId: number, idProceso: number, nombre: string, minutos: number,
    ) => correr(ordenId, async () => {
        const res = await fetch(`${base()}/ordenes/${ordenId}/procesos?${MOTIVO}`, {
            method: "POST",
            headers: cabecerasConCuerpo(),
            body: JSON.stringify({ id_proceso: idProceso, tiempo_estimado: minutos }),
        });
        await reventarSiFalla(res, "agregar el proceso");
        let idOtp: number | undefined;
        try {
            const json = await res.json();
            idOtp = (json?.data ?? json)?.id;
        } catch {
            // El cuerpo no importa tanto como el id: si no vino, se pregunta.
        }
        if (!idOtp) {
            const lineas = await traerLineas(ordenId);
            idOtp = lineas[lineas.length - 1]?.id;
        }
        if (!idOtp) throw new Error("El proceso se agregó, pero no se pudo identificar la fila nueva. Recalculá para verla.");
        anotar(ordenId, c => ({ ...c, nuevas: [...c.nuevas, { idOtp: idOtp!, idProceso, nombre, minutos }] }));
        apilar(ordenId, { tipo: "agregar", idOtp: idOtp!, idProceso, nombre });
        toast.success(`Se agregó «${nombre}» a la OT`, {
            description: "Recalculá el plan para que le busque horario, persona y máquina.",
        });
    }), [correr, anotar, apilar]);

    /**
     * Escribir el orden en la base y anotar si la OT quedó o no como estaba.
     *
     * La renumeración va sobre la lista COMPLETA de la OT y no sobre lo que se ve en el
     * plan: el backend guarda la posición en la orden, y el plan puede estar mostrando
     * sólo algunas pasadas.
     */
    const aplicarOrden = React.useCallback(async (
        ordenId: number, ordenada: LineaDeOT[], idsAntes: number[],
    ) => {
        const idsNuevos = ordenada.map(l => l.id);
        if (idsNuevos.join(",") === idsAntes.join(",")) return false;   // no se movió nada

        const res = await fetch(`${base()}/ordenes/${ordenId}/procesos/reorder?${MOTIVO}`, {
            method: "PUT",
            headers: cabecerasConCuerpo(),
            body: JSON.stringify({
                ordenes: ordenada.map((l, i) => ({ id_otp: l.id, id_proceso: l.idProceso, orden: i + 1 })),
            }),
        });
        await reventarSiFalla(res, "cambiar el orden de los pasos");

        anotar(ordenId, c => {
            // El punto cero es el orden que tenía la OT la PRIMERA vez que alguien la
            // tocó. De ahí en más se compara siempre contra ése, nunca contra el de la
            // movida anterior: si no, volver un paso a su lugar se leería como un cambio
            // más en vez de como la vuelta atrás que es.
            const original = c.ordenOriginal ?? idsAntes;
            // La comparación va sobre los ids que siguen existiendo EN LAS DOS listas.
            // Agregar o sacar una pasada cambia el largo, y comparando de punta a punta
            // una OT devuelta a su orden quedaría marcada por culpa de otra cosa.
            const vivos = new Set(idsNuevos);
            const enOriginal = new Set(original);
            const comoEstaba =
                original.filter(id => vivos.has(id)).join(",")
                === idsNuevos.filter(id => enOriginal.has(id)).join(",");
            if (comoEstaba) return { ...c, pasos: null, ordenOriginal: null };
            return {
                ...c,
                pasos: Object.fromEntries(ordenada.map((l, i) => [l.id, i + 1])),
                ordenOriginal: original,
            };
        });
        return true;
    }, [anotar]);

    /**
     * Mover una pasada a la posición que se escribió en la columna «#».
     *
     * Antes esto eran dos flechitas al final de la fila, en la columna PASO. Julián,
     * 17/09/2026: *"el orden del proceso quiero cambiarlo desde el numero a la
     * izquierda no a la derecha"*. Es además el gesto que ya existe en el alta de la OT
     * (ProcesosEditor, columna «#»), así que se escribe el número en los dos lados.
     *
     * `posicion` se cuenta entre las filas QUE SE VEN y no entre las de la OT: el plan
     * puede no mostrar todas las pasadas, y contra la lista completa el número tipeado
     * significaría otra cosa. Es la misma regla que tenían las flechitas, que se movían
     * respecto del vecino visible.
     */
    const moverAPosicion = React.useCallback((
        ordenId: number, idOtp: number, posicion: number, visibles: number[],
    ) => correr(ordenId, async () => {
        const lineas = await traerLineas(ordenId);
        const desde = lineas.findIndex(l => l.id === idOtp);
        if (desde < 0) throw new Error("Ese proceso ya no está en la OT. Recalculá el plan.");

        const otrasVisibles = visibles.filter(id => id !== idOtp);
        // Fuera de rango se lleva al extremo más cercano, como en el alta de la OT:
        // quien escribe "99" en una lista de 8 la quiere al final.
        const k = Math.min(Math.max(Math.round(posicion), 1), otrasVisibles.length + 1) - 1;
        const sinLa = lineas.filter((_, i) => i !== desde);

        let destino: number;
        if (otrasVisibles.length === 0) {
            destino = desde;
        } else if (k >= otrasVisibles.length) {
            destino = sinLa.findIndex(l => l.id === otrasVisibles[otrasVisibles.length - 1]) + 1;
        } else {
            const pos = sinLa.findIndex(l => l.id === otrasVisibles[k]);
            destino = pos < 0 ? Math.min(desde, sinLa.length) : pos;
        }
        const ordenada = [...sinLa.slice(0, destino), lineas[desde], ...sinLa.slice(destino)];
        const idsAntes = lineas.map(l => l.id);
        if (await aplicarOrden(ordenId, ordenada, idsAntes)) {
            apilar(ordenId, { tipo: "orden", ordenAntes: idsAntes });
        }
    }), [correr, aplicarOrden, apilar]);

    /**
     * Deshacer el último cambio hecho en esta OT desde el plan.
     *
     * Cada acción se deshace con su inversa exacta contra los mismos endpoints, y la
     * inversa vuelve a pasar por las mismas anotaciones: por eso la marca se apaga sola
     * cuando la OT queda como estaba (`anotarProceso` borra la entrada si se vuelve al
     * proceso original, `aplicarOrden` borra `pasos` si se vuelve al orden original,
     * y agregar+sacar se cancelan entre sí).
     *
     * La única que no vuelve igual es haber SACADO un paso: al volver a agregarlo nace
     * con otro id, al final de la OT y sin el avance que tuviera. Se hace igual —es
     * mejor que nada— pero el aviso lo dice con todas las letras.
     */
    const deshacer = React.useCallback((ordenId: number) => correr(ordenId, async () => {
        const acciones = pila[ordenId] ?? [];
        const ultima = acciones[acciones.length - 1];
        if (!ultima) return;

        if (ultima.tipo === "orden") {
            const lineas = await traerLineas(ordenId);
            const porId = new Map(lineas.map(l => [l.id, l]));
            // Las pasadas que ya no existen se saltean y las que aparecieron después
            // van al final: deshacer el orden no puede inventar ni perder filas.
            const antes = new Set(ultima.ordenAntes);
            const ordenada = [
                ...ultima.ordenAntes.map(id => porId.get(id)).filter((l): l is LineaDeOT => !!l),
                ...lineas.filter(l => !antes.has(l.id)),
            ];
            await aplicarOrden(ordenId, ordenada, lineas.map(l => l.id));
            toast.success("Volvió el orden que tenía");
        } else if (ultima.tipo === "proceso") {
            const res = await fetch(`${base()}/ordenes/${ordenId}/procesos/linea/${ultima.idOtp}?${MOTIVO}`, {
                method: "PUT",
                headers: cabecerasConCuerpo(),
                body: JSON.stringify({ id_proceso: ultima.idAntes }),
            });
            await reventarSiFalla(res, "volver al proceso anterior");
            // Los nombres van al revés a propósito: lo que "era" ahora es lo que había
            // quedado, y lo que "queda" es el original. Así `anotarProceso` ve que se
            // volvió al punto de partida y borra la marca.
            anotarProceso(ordenId, ultima.idOtp, ultima.nombreAhora, ultima.nombreAntes, ultima.idAntes);
            toast.success(`Volvió a ser «${ultima.nombreAntes}»`);
        } else if (ultima.tipo === "agregar") {
            const res = await fetch(
                `${base()}/ordenes/${ordenId}/procesos/${ultima.idProceso}?id_otp=${ultima.idOtp}&${MOTIVO}`,
                { method: "DELETE", headers: cabeceras() },
            );
            await reventarSiFalla(res, "sacar el proceso que habías agregado");
            anotar(ordenId, c => ({ ...c, nuevas: c.nuevas.filter(n => n.idOtp !== ultima.idOtp) }));
            toast.success(`Se sacó «${ultima.nombre}», que habías agregado`);
        } else {
            const res = await fetch(`${base()}/ordenes/${ordenId}/procesos?${MOTIVO}`, {
                method: "POST",
                headers: cabecerasConCuerpo(),
                body: JSON.stringify({ id_proceso: ultima.idProceso, tiempo_estimado: ultima.minutos }),
            });
            await reventarSiFalla(res, "volver a agregar el proceso");
            let idNuevo: number | undefined;
            try { idNuevo = ((await res.json())?.data ?? {}).id; } catch { /* se pregunta abajo */ }
            if (!idNuevo) {
                const lineas = await traerLineas(ordenId);
                idNuevo = lineas[lineas.length - 1]?.id;
            }
            anotar(ordenId, c => ({
                ...c,
                borradas: c.borradas.filter(id => id !== ultima.idOtp),
                nuevas: idNuevo
                    ? [...c.nuevas, { idOtp: idNuevo, idProceso: ultima.idProceso, nombre: ultima.nombre, minutos: ultima.minutos }]
                    : c.nuevas,
            }));
            toast.success(`Volvió «${ultima.nombre}» a la OT`, {
                description: "Vuelve como paso nuevo: al final de la orden y sin el avance que tenía. Movelo al lugar que iba.",
            });
        }
        desapilar(ordenId);
    }), [correr, pila, aplicarOrden, anotarProceso, anotar, desapilar]);

    /**
     * Un plan nuevo ya trae todo esto adentro: las marcas dejan de tener sentido.
     *
     * Devuelve el MISMO objeto cuando no había nada marcado, así React no vuelve a
     * dibujar la pantalla al pedo. No es teoría: esto corre con cada recálculo, y
     * probando ajustes en el panel de trabas se recalcula cuatro o cinco veces
     * seguidas (lo avisó la sesión que hizo «Solo en este plan»).
     */
    const olvidarTodo = React.useCallback(() => {
        setCambios(prev => (Object.keys(prev).length === 0 ? prev : {}));
        // La pila también: con un plan recién calculado ya no hay nada que deshacer, y
        // un "Deshacer" que siguiera vivo desharía algo que el plan nuevo ya incorporó.
        setPila(prev => (Object.keys(prev).length === 0 ? prev : {}));
    }, []);

    const borradas = React.useMemo(() => {
        const todas = new Set<number>();
        for (const c of Object.values(cambios)) for (const id of c.borradas) todas.add(id);
        return todas;
    }, [cambios]);

    return {
        cambios,
        /** Lo que se le tocó a esta OT, o `undefined` si no se le tocó nada. */
        cambiosDe: (ordenId: number): CambiosDeOT | undefined => cambios[ordenId],
        hayCambios: Object.keys(cambios).length > 0,
        otsCambiadas: Object.keys(cambios).map(Number),
        /** ¿Esta pasada se sacó de la OT? Su fila del plan ya no vale. */
        fueBorrada: (idOtp?: number | null) => idOtp != null && borradas.has(idOtp),
        trabajando,
        cambiarProceso,
        borrarLinea,
        agregarLinea,
        moverAPosicion,
        deshacer,
        /** ¿Hay algo para deshacer en esta OT? Es lo que prende el botón. */
        sePuedeDeshacer: (ordenId: number) => (pila[ordenId]?.length ?? 0) > 0,
        olvidarTodo,
    };
}
