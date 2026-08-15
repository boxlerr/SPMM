import { useEffect, useState } from "react";
import { API_URL } from "@/config";

/**
 * Cobertura cruzada rango ↔ maquinaria.
 *
 * Los huecos de acá no se ven en ninguna pantalla y se pagan callados en el
 * planificador: una máquina sin rango queda fuera del dominio de cualquier proceso
 * que exija rangos (o sea, no la usa nadie), y un rango sin operarios deja sin
 * candidatos a todo lo que solo él habilita.
 */
export interface RangoRef {
    id: number;
    nombre: string;
}

export interface MaquinaCobertura {
    id: number;
    nombre: string;
    cod_maquina?: string | null;
    rangos: RangoRef[];
}

export interface RangoCobertura {
    id: number;
    nombre: string;
    maquinas: RangoRef[];
    operarios: number;
}

export interface Cobertura {
    maquinas: MaquinaCobertura[];
    rangos: RangoCobertura[];
}

// `null` = todavía no se sabe. Distinguirlo de "no hay nada" es lo que evita que,
// contra un backend sin este endpoint, TODAS las máquinas aparezcan como "sin rango".
let cache: Promise<Cobertura | null> | null = null;

function cargar(): Promise<Cobertura | null> {
    if (cache) return cache;

    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    cache = fetch(`${API_URL.replace(/\/$/, "")}/rangos/cobertura`, { headers })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.status && d?.data ? (d.data as Cobertura) : null))
        .catch(() => null);

    return cache;
}

/** Fuerza a releer (después de editar los rangos de una máquina). */
export function invalidarCobertura() {
    cache = null;
}

export function useCoberturaRangos() {
    const [cobertura, setCobertura] = useState<Cobertura | null>(null);

    useEffect(() => {
        let vivo = true;
        cargar().then((c) => {
            if (vivo) setCobertura(c);
        });
        return () => {
            vivo = false;
        };
    }, []);

    // Mientras no haya dato, los mapas quedan vacíos y `listo` en false: la pantalla
    // no muestra ningún aviso en vez de acusar de "sin rango" a todo el taller.
    const listo = cobertura !== null;
    const rangosPorMaquina = new Map<number, RangoRef[]>(
        (cobertura?.maquinas ?? []).map((m) => [m.id, m.rangos])
    );
    const porRango = new Map<number, RangoCobertura>(
        (cobertura?.rangos ?? []).map((r) => [r.id, r])
    );

    return { cobertura, listo, rangosPorMaquina, porRango };
}
