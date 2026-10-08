/**
 * Los feriados de Argentina y si el taller trabaja cada uno.
 *
 * El backend los trae solo de ArgentinaDatos (FeriadoRepository) y el planificador saltea
 * los que «bloquean». Acá sólo se piden y se elige. Sin elegir: un feriado no se trabaja y
 * un día no laborable («puente») sí, porque es optativo para el empleador.
 */
import { API_URL } from "@/config";

export type TipoFeriado = "inamovible" | "trasladable" | "puente";

export interface Feriado {
    /** "YYYY-MM-DD". */
    fecha: string;
    nombre: string;
    tipo: TipoFeriado;
    /** Lo que eligió el taller; `null` = nadie eligió (vale lo de siempre). */
    se_trabaja: boolean | null;
    /** Si el planificador saltea ese día. */
    bloquea: boolean;
    decidido_por: string | null;
    decidido_en: string | null;
}

const cabeceras = (): Record<string, string> => {
    const salida: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof window === "undefined") return salida;
    try {
        const token = localStorage.getItem("access_token");
        if (token) salida.Authorization = `Bearer ${token}`;
    } catch { /* sin token: el backend dirá 401 */ }
    return salida;
};

const soloDias = (dias: unknown): string[] =>
    (Array.isArray(dias) ? dias : [])
        .map(d => String(d).slice(0, 10))
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

/** La regla de siempre, para pintar al toque antes de que conteste el servidor. */
export function bloqueaFeriado(tipo: TipoFeriado, seTrabaja: boolean | null): boolean {
    if (seTrabaja !== null) return !seTrabaja;
    return tipo !== "puente";
}

/** Los feriados desde `desde` (y los días que el planificador saltea). `null` si falló. */
export async function pedirFeriados(
    desde: string,
    hasta?: string | null,
): Promise<{ feriados: Feriado[]; bloqueados: string[] } | null> {
    try {
        const q = new URLSearchParams({ desde });
        if (hasta) q.set("hasta", hasta);
        const res = await fetch(`${API_URL}/config/feriados?${q}`, { headers: cabeceras() });
        if (!res.ok) return null;
        const datos = await res.json();
        return {
            feriados: Array.isArray(datos?.feriados) ? datos.feriados : [],
            bloqueados: soloDias(datos?.blocked_dates),
        };
    } catch {
        return null;
    }
}

/** Guarda si se trabaja ese feriado. Devuelve cómo quedó y los días bloqueados, o `null` si falló. */
export async function elegirFeriado(
    fecha: string,
    seTrabaja: boolean | null,
): Promise<{ feriado: Feriado; bloqueados: string[] } | null> {
    try {
        const res = await fetch(`${API_URL}/config/feriados/${fecha}`, {
            method: "PUT",
            headers: cabeceras(),
            body: JSON.stringify({ se_trabaja: seTrabaja }),
        });
        if (!res.ok) return null;
        const datos = await res.json();
        if (!datos?.feriado) return null;
        return { feriado: datos.feriado, bloqueados: soloDias(datos.blocked_dates) };
    } catch {
        return null;
    }
}

/** Los feriados que caen entre dos días "YYYY-MM-DD" (inclusive). Sin `hasta`, desde `desde` en adelante. */
export function feriadosEntre(feriados: Feriado[], desde: string, hasta?: string | null): Feriado[] {
    return feriados.filter(f => f.fecha >= desde && (!hasta || f.fecha <= hasta));
}

/** «Feriado» o «Día no laborable», para la etiqueta de cada renglón. */
export function textoDelTipo(tipo: TipoFeriado): string {
    return tipo === "puente" ? "Día no laborable" : "Feriado";
}
