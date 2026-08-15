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

function cargar(): Promise<Set<number> | null> {
    if (cache) return cache;

    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    cache = fetch(`${API_URL.replace(/\/$/, "")}/planos/ordenes-con-plano`, { headers })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (Array.isArray(d?.ordenes_con_plano) ? new Set<number>(d.ordenes_con_plano) : null))
        .catch(() => null);

    return cache;
}

/** Fuerza a releer en la próxima consulta (al subir o borrar un plano). */
export function invalidarOrdenesConPlano() {
    cache = null;
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

/** Los tres estados posibles de la columna Plano. */
export type EstadoPlano = "adjunto" | "marcado_sin_archivo" | "sin_plano";

export function estadoPlano(
    ordenId: number,
    tienePlano: unknown,
    conPlano: Set<number> | null
): EstadoPlano {
    // Sin el dato real, se muestra lo de siempre (la bandera del legacy) en vez de
    // afirmar que falta el archivo.
    if (!conPlano) return Number(tienePlano) === 1 ? "adjunto" : "sin_plano";
    if (conPlano.has(ordenId)) return "adjunto";
    if (Number(tienePlano) === 1) return "marcado_sin_archivo";
    return "sin_plano";
}

/** Ranking para ordenar: primero lo que falta (igual criterio que Material y Entrega). */
export function rankPlano(estado: EstadoPlano): number {
    return estado === "adjunto" ? 2 : estado === "marcado_sin_archivo" ? 1 : 0;
}
