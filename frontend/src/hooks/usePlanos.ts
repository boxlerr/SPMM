import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/config";
import type { Plano, PlanoOrigen } from "@/lib/planos";

export type { Plano, PlanoOrigen };

export interface EstadoPlanos {
    planos: Plano[];
    cargando: boolean;
    error: string | null;
    /** Volver a pedirlos (después de subir, borrar o reimportar de Drive). */
    recargar: () => void;
}

const VACIO: Plano[] = [];

/**
 * Los planos de una orden vienen mezclados: los que alguien adjuntó a esa OT y los que
 * cuelgan del producto que fabrica. El backend ya los junta y marca cuál es cuál en
 * `origen`; acá solo se protege el campo, porque el backend se deploya a mano y el
 * front sale por Vercel: existe la ventana en la que la pantalla nueva habla con la
 * API vieja, y sin `origen` todas las tarjetas dirían lo mismo.
 */
function normalizar(fila: Record<string, unknown>): Plano {
    const idArticulo = fila.id_articulo as number | null | undefined;
    const origen = (fila.origen as PlanoOrigen | undefined) ?? (idArticulo ? "articulo" : "ot");
    return { ...(fila as unknown as Plano), origen };
}

function usePlanosDe(recurso: "orden" | "articulo", id?: number): EstadoPlanos {
    const [planos, setPlanos] = useState<Plano[]>(VACIO);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [intento, setIntento] = useState(0);

    const recargar = useCallback(() => setIntento((n) => n + 1), []);

    useEffect(() => {
        if (!id) {
            // Sin id no hay nada que pedir, y tampoco hay que quedar "cargando" para
            // siempre: la ficha se monta antes de que se elija la orden.
            setPlanos(VACIO);
            setCargando(false);
            setError(null);
            return;
        }

        let vivo = true;
        setCargando(true);
        setError(null);

        const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

        fetch(`${API_URL}/planos/${recurso}/${id}`, { headers })
            .then(async (res) => {
                if (!res.ok) throw new Error(`error ${res.status}`);
                const json = await res.json();
                return Array.isArray(json?.data) ? json.data.map(normalizar) : VACIO;
            })
            .then((lista) => {
                if (!vivo) return;
                setPlanos(lista);
                setCargando(false);
            })
            .catch(() => {
                if (!vivo) return;
                setPlanos(VACIO);
                setError("No se pudieron cargar los planos.");
                setCargando(false);
            });

        return () => {
            vivo = false;
        };
    }, [recurso, id, intento]);

    return { planos, cargando, error, recargar };
}

/** Planos de una OT: los suyos más los del producto que fabrica. */
export function usePlanosDeOrden(orderId?: number): EstadoPlanos {
    return usePlanosDe("orden", orderId);
}

/** Planos de un producto: los que van a ver todas las OTs que lo fabriquen. */
export function usePlanosDeArticulo(articuloId?: number): EstadoPlanos {
    return usePlanosDe("articulo", articuloId);
}
