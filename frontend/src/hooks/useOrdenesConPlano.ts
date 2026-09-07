import { useEffect, useState } from "react";
import { API_URL } from "@/config";

/**
 * Qué OTs tienen un plano REALMENTE adjunto.
 *
 * `orden_trabajo.tiene_plano` viene del legacy y está en 1 en casi todas las OTs
 * aunque no haya ningún archivo cargado. El planificador usa la interpretación de
 * planos como filtro duro, así que esa diferencia decide quién puede agarrar la
 * tarea: con archivo cargado solo la agarran los que saben leer planos.
 *
 * Se cachea a nivel de módulo porque las tablas de planificación se montan varias
 * veces en la misma pantalla y todas necesitan lo mismo.
 */
// `null` = todavía no se sabe (cargando, o el backend no tiene el endpoint). No es
// lo mismo que "ninguna OT tiene plano": si tratáramos los dos casos igual, con el
// backend viejo TODAS las OTs aparecerían como "sin archivo". El backend se deploya
// a mano y el front sale por Vercel, así que ese desfasaje existe de verdad.
let cache: Promise<Set<number> | null> | null = null;

const authHeaders = (): HeadersInit => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
};

const base = () => API_URL.replace(/\/$/, "");

function cargar(): Promise<Set<number> | null> {
    if (cache) return cache;

    cache = fetch(`${base()}/planos/ordenes-con-plano`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (Array.isArray(d?.ordenes_con_plano) ? new Set<number>(d.ordenes_con_plano) : null))
        .catch(() => null);

    return cache;
}

/**
 * Qué OT tienen un plano PARA MIRAR, venga de donde venga.
 *
 * Es otra pregunta que la de arriba, y por eso es otro endpoint. Hoy en producción hay
 * más de mil planos y TODOS cuelgan del artículo, ninguno de una orden: por eso la
 * columna Plano decía "Sin archivo" o "No" en absolutamente todas las filas, aunque el
 * plano del producto que esa OT fabrica esté cargado y se pueda abrir.
 *
 * Lo que NO se puede hacer es mezclarlas: `/planos/ordenes-con-plano` alimenta un filtro
 * duro del planificador (solo quien sabe leer planos agarra esos procesos) y sumarle 198
 * OT de golpe es una decisión del taller, no de la pantalla. Acá se mira, allá se
 * restringe.
 */
export interface PlanosDisponibles {
    /** El plano está pegado a la orden. */
    propios: Set<number>;
    /** El plano cuelga del artículo que la orden fabrica y se ve igual desde la OT. */
    delProducto: Set<number>;
    /**
     * Cuánto y de qué tipo tiene cada orden: {planos, fotos, deLaOrden}.
     *
     * No alcanza con saber que "hay algo". De las 198 órdenes que muestran algo, 130
     * tienen solo dibujo, 46 solo fotos y 22 las dos cosas: decirles "Del producto" a
     * todas no le sirve a nadie. Y el número importa —"15 fotos" no es "1 foto"— porque
     * el que planifica decide si vale la pena abrir.
     */
    porOrden: Map<number, { planos: number; fotos: number; deLaOrden: number }>;
}

let cacheDisponibles: Promise<PlanosDisponibles | null> | null = null;

function cargarDisponibles(): Promise<PlanosDisponibles | null> {
    if (cacheDisponibles) return cacheDisponibles;

    cacheDisponibles = fetch(`${base()}/planos/ordenes-con-plano-disponible`, {
        headers: authHeaders(),
    })
        // Con el backend viejo esta ruta no existe y la URL cae en `/planos/{id}`, que
        // contesta 422 porque "ordenes-con-plano-disponible" no es un número (o 404,
        // según cómo esté armada la ruta). Los dos casos son lo mismo para nosotros:
        // "todavía no se sabe" -> `null`, y la pantalla sigue como hasta hoy.
        .then((r) => (r.ok ? r.json() : null))
        .then((d) =>
            Array.isArray(d?.propios) && Array.isArray(d?.del_producto)
                ? {
                      propios: new Set<number>(d.propios),
                      delProducto: new Set<number>(d.del_producto),
                      // El backend viejo no manda el detalle: sin él no se puede decir
                      // si es dibujo o foto, y el cartel se queda en el rótulo genérico.
                      porOrden: new Map<number, { planos: number; fotos: number; deLaOrden: number }>(
                          Object.entries(d.ordenes ?? {}).map(([id, v]: [string, any]) => [
                              Number(id),
                              {
                                  planos: Number(v?.planos ?? 0),
                                  fotos: Number(v?.fotos ?? 0),
                                  deLaOrden: Number(v?.de_la_orden ?? 0),
                              },
                          ])
                      ),
                  }
                : null
        )
        .catch(() => null);

    return cacheDisponibles;
}

/** Fuerza a releer en la próxima consulta (al subir o borrar un plano). */
export function invalidarOrdenesConPlano() {
    cache = null;
    // Las dos respuestas cambian con el mismo hecho —apareció o se fue un archivo—, así
    // que se tiran juntas: si solo tiráramos una, el badge y el planificador quedarían
    // contando cosas distintas sobre la misma OT.
    cacheDisponibles = null;
}

export function useOrdenesConPlano(): Set<number> | null {
    const [ordenes, setOrdenes] = useState<Set<number> | null>(null);

    useEffect(() => {
        let vivo = true;
        cargar().then((s) => {
            if (vivo) setOrdenes(s);
        });
        return () => {
            vivo = false;
        };
    }, []);

    return ordenes;
}

/** Igual que el de arriba pero para MOSTRAR: incluye el plano heredado del producto. */
export function usePlanosDisponibles(): PlanosDisponibles | null {
    const [disponibles, setDisponibles] = useState<PlanosDisponibles | null>(null);

    useEffect(() => {
        let vivo = true;
        cargarDisponibles().then((d) => {
            if (vivo) setDisponibles(d);
        });
        return () => {
            vivo = false;
        };
    }, []);

    return disponibles;
}

/** Los estados posibles de la columna Plano, del que más tiene al que no tiene nada. */
/**
 * Los estados de la columna Plano.
 *
 * "marcado_sin_archivo" y "sin_plano" se ven IGUAL en pantalla a propósito. Antes eran
 * dos carteles distintos ("Sin archivo" y "No") y Julián preguntó por qué: la diferencia
 * es que el sistema viejo marcó la OT con plano, un dato interno que no cambia nada para
 * el que trabaja. Las dos cosas significan lo mismo donde importa: no hay nada para
 * mirar. Se conservan separadas acá porque el orden de la columna las usa.
 */
export type EstadoPlano = "adjunto" | "del_producto" | "marcado_sin_archivo" | "sin_plano";

export function estadoPlano(
    ordenId: number,
    tienePlano: unknown,
    conPlano: Set<number> | null,
    /**
     * Lo que hay para mirar. Es opcional porque las tablas que todavía no lo pasan
     * tienen que seguir comportándose exactamente como hoy.
     */
    disponibles?: PlanosDisponibles | null
): EstadoPlano {
    const marcada = Number(tienePlano) === 1;

    // Prioridad: el archivo de la orden le gana al del producto, porque el de la orden
    // es el que alguien cargó a propósito para ESTA orden (una modificación, un croquis
    // del taller), y el del producto es el genérico.
    if (disponibles?.propios.has(ordenId)) return "adjunto";
    if (conPlano?.has(ordenId)) return "adjunto";
    if (disponibles?.delProducto.has(ordenId)) return "del_producto";

    // Sin ninguna de las dos respuestas no se puede afirmar que falte el archivo: se
    // muestra lo de siempre (la bandera del legacy) en vez de rotular todo como vacío.
    if (!disponibles && !conPlano) return marcada ? "adjunto" : "sin_plano";

    return marcada ? "marcado_sin_archivo" : "sin_plano";
}

/** Ranking para ordenar: primero lo que falta (igual criterio que Material y Entrega). */
export function rankPlano(estado: EstadoPlano): number {
    // Lo que se puede abrir de verdad va arriba de lo que solo está marcado, y el plano
    // propio arriba del heredado: quien ordena por esta columna está buscando con qué
    // trabajar, no la bandera del legacy.
    if (estado === "adjunto") return 3;
    if (estado === "del_producto") return 2;
    if (estado === "marcado_sin_archivo") return 1;
    return 0;
}
