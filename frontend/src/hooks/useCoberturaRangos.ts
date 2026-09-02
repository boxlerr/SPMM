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

export interface ProcesoCobertura {
    id: number;
    nombre: string;
    rangos: RangoRef[];
    /** En qué máquinas se hace, si alguien lo cargó. Vacío = se deduce del nombre. */
    maquinas?: RangoRef[];
    /** Cuántos operarios DISPONIBLES pueden hacerlo (por rango o habilidad manual). */
    habilitados: number;
    por_habilidad_manual: number;
    /** En cuántas líneas de OTs abiertas se usa. 0 = está en el catálogo pero no se usa. */
    lineas_abiertas: number;
}

/** Un proceso "trae problema" si no lo puede hacer nadie o si no tiene rango. */
export function problemaDelProceso(p: ProcesoCobertura): "nadie" | "sin_rango" | null {
    if (p.rangos.length > 0 && p.habilitados === 0) return "nadie";
    if (p.rangos.length === 0) return "sin_rango";
    return null;
}

export interface Cobertura {
    maquinas: MaquinaCobertura[];
    rangos: RangoCobertura[];
    procesos: ProcesoCobertura[];
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
    const [version, setVersion] = useState(0);

    /** Vuelve a pedir la cobertura (después de editar los rangos de algo). */
    const recargar = () => {
        invalidarCobertura();
        setVersion((v) => v + 1);
    };

    useEffect(() => {
        let vivo = true;
        cargar().then((c) => {
            if (vivo) setCobertura(c);
        });
        return () => {
            vivo = false;
        };
    }, [version]);

    // Mientras no haya dato, los mapas quedan vacíos y `listo` en false: la pantalla
    // no muestra ningún aviso en vez de acusar de "sin rango" a todo el taller.
    const listo = cobertura !== null;
    const rangosPorMaquina = new Map<number, RangoRef[]>(
        (cobertura?.maquinas ?? []).map((m) => [m.id, m.rangos])
    );
    const porRango = new Map<number, RangoCobertura>(
        (cobertura?.rangos ?? []).map((r) => [r.id, r])
    );
    const porProceso = new Map<number, ProcesoCobertura>(
        (cobertura?.procesos ?? []).map((p) => [p.id, p])
    );

    // Catálogo para los selectores: cada rango con cuánta gente lo tiene. Ese número
    // es el que decide si agregarlo sirve de algo.
    const catalogoRangos = (cobertura?.rangos ?? []).map((r) => ({
        id: r.id,
        nombre: r.nombre,
        operarios: r.operarios,
    }));

    return { cobertura, listo, rangosPorMaquina, porRango, porProceso, catalogoRangos, recargar };
}
