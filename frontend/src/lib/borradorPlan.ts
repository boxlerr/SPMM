/**
 * Borradores de planificación: el plan calculado y todavía NO confirmado.
 *
 * Antes la vista previa era pura ida y vuelta. Cerrar el modal sin querer tiraba a
 * la basura un cálculo de varios minutos —con 34 OTs son minutos de verdad— y con
 * él todos los retoques hechos a mano (cambiar de máquina, de operario, correr un
 * horario).
 *
 * Hay DOS copias y hacen cosas distintas. No es redundancia:
 *
 *  - **El navegador (`localStorage`)** es la caja negra. Escribe sincrónico, sin
 *    red, en cada cambio. Es lo único que puede cubrir un corte de luz o un cierre
 *    accidental de la pestaña, porque no depende de que llegue un request.
 *  - **La base** es el borrador compartido: lo que hace que Lucas lo abra desde su
 *    máquina y Julián desde la suya. Va debounceada, porque un write a Supabase por
 *    cada vez que alguien toca un desplegable es plata y latencia al pedo.
 *
 * El hueco que queda —y es a propósito— es de unos pocos segundos: si se corta la
 * luz y después abrís en OTRA máquina, podés perder las últimas ediciones que
 * todavía no se sincronizaron. En la misma máquina no se pierde nada.
 */

import { API_URL } from "@/config";

const CLAVE_LOCAL = "spmm_borrador_plan";

/** Cuánto espera la base después del último cambio. */
export const DEBOUNCE_BASE_MS = 3000;

/** El estado completo de la vista previa: lo que hace falta para reabrirla igual. */
export type BorradorPlan = {
    /** id en la base. Ausente mientras solo existe en el navegador. */
    id?: number;
    ordenesIds: number[];
    rango: { fecha_desde?: string; fecha_hasta?: string };
    /** El plan tal cual lo devolvió el backend, ya enriquecido para la pantalla. */
    resultados: any[];
    excedentes: any[];
    diagnosticos: any[];
    /** Los retoques a mano, indexados igual que en el modal. */
    ediciones: Record<string, any>;
    /** OTs excedentes que el usuario decidió forzar. */
    forzarOrdenIds: number[];
    /** Cuándo se calculó. Es lo que permite avisar que puede haber quedado viejo. */
    guardadoEn: string;
};

export type BorradorResumen = {
    id: number;
    nombre_usuario?: string | null;
    cantidad_ots: number;
    cantidad_procesos: number;
    fecha_desde?: string | null;
    fecha_hasta?: string | null;
    creado_en: string;
    actualizado_en: string;
};

const headers = (): Record<string, string> => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
};

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

export function guardarLocal(borrador: BorradorPlan): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(CLAVE_LOCAL, JSON.stringify(borrador));
    } catch (e) {
        // Cuota llena: un plan grande puede no entrar. No es fatal —queda la copia
        // de la base— pero sí conviene no dejar una versión vieja haciéndose pasar
        // por la actual, porque el usuario la retomaría creyendo que es la última.
        console.warn("No se pudo guardar el borrador en el navegador:", e);
        try { localStorage.removeItem(CLAVE_LOCAL); } catch { /* nada que hacer */ }
    }
}

export function leerLocal(): BorradorPlan | null {
    if (typeof window === "undefined") return null;
    try {
        const crudo = localStorage.getItem(CLAVE_LOCAL);
        if (!crudo) return null;
        const b = JSON.parse(crudo);
        // Un borrador sin plan no sirve para nada y solo ensucia el botón.
        if (!b || !Array.isArray(b.resultados) || b.resultados.length === 0) return null;
        return b as BorradorPlan;
    } catch {
        return null;
    }
}

export function limpiarLocal(): void {
    if (typeof window === "undefined") return;
    try { localStorage.removeItem(CLAVE_LOCAL); } catch { /* nada que hacer */ }
}

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/**
 * Sube el borrador. Devuelve el id para seguir pisando el mismo en vez de dejar un
 * reguero de copias.
 *
 * Nunca tira: esto corre en un autosave y un fallo de red no puede cortarle el
 * trabajo a nadie. Si falla, queda la copia del navegador y el próximo cambio
 * reintenta.
 */
export async function guardarEnBase(
    borrador: BorradorPlan,
    opciones: { automatico?: boolean } = {},
): Promise<number | null> {
    try {
        const res = await fetch(`${API_URL}/planificacion/borradores`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
                id: borrador.id ?? null,
                contenido: borrador,
                ordenes_ids: borrador.ordenesIds,
                cantidad_procesos: borrador.resultados.length,
                fecha_desde: borrador.rango?.fecha_desde ?? null,
                fecha_hasta: borrador.rango?.fecha_hasta ?? null,
                automatico: opciones.automatico ?? true,
            }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data?.id === "number" ? data.id : null;
    } catch {
        return null;
    }
}

export async function listarBorradores(): Promise<BorradorResumen[]> {
    try {
        const res = await fetch(`${API_URL}/planificacion/borradores`, { headers: headers() });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

export async function obtenerBorrador(id: number): Promise<BorradorPlan | null> {
    try {
        const res = await fetch(`${API_URL}/planificacion/borradores/${id}`, { headers: headers() });
        if (!res.ok) return null;
        const data = await res.json();
        const contenido = data?.contenido;
        if (!contenido || !Array.isArray(contenido.resultados)) return null;
        return { ...contenido, id: data.id } as BorradorPlan;
    } catch {
        return null;
    }
}

export async function borrarBorrador(id: number): Promise<boolean> {
    try {
        const res = await fetch(`${API_URL}/planificacion/borradores/${id}`, {
            method: "DELETE",
            headers: headers(),
        });
        return res.ok;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Vejez
// ---------------------------------------------------------------------------

/**
 * Hace cuánto se guardó, en criollo. El borrador se abre siempre —la decisión de si
 * todavía sirve es del que planifica, no nuestra— pero tiene que quedar claro de
 * cuándo es: entre que se calculó y ahora pudieron cambiar OTs, rangos o skills, y
 * el plan quedaría dibujado sobre datos que ya no son.
 */
export function antiguedadTexto(iso?: string): string {
    if (!iso) return "";
    const t = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`).getTime();
    if (Number.isNaN(t)) return "";
    const min = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (min < 1) return "recién";
    if (min < 60) return `hace ${min} min`;
    const hs = Math.floor(min / 60);
    if (hs < 24) return `hace ${hs} ${hs === 1 ? "hora" : "horas"}`;
    const dias = Math.floor(hs / 24);
    return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

/** A partir de acá se avisa fuerte que los datos pudieron cambiar. */
export const VIEJO_MINUTOS = 60;

export function estaViejo(iso?: string): boolean {
    if (!iso) return false;
    const t = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() - t > VIEJO_MINUTOS * 60000;
}
