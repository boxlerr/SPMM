/**
 * Auditoría (RF-25): tipos, períodos y pedidos al servidor, compartidos por las solapas
 * «Todo lo que se hizo», «Ingresos» y «Actividad por persona».
 *
 * Desde el 23/09 la búsqueda la hace el SERVIDOR (backend/presentation/AuditoriaAPI.py):
 * cada filtro viaja, la respuesta dice cuántos hay en total y se pide de a páginas.
 * Antes se traían los últimos 300 y se filtraba acá: lo de hace un mes no aparecía.
 *
 * Con el backend viejo (el de producción hasta que se deploye, 3c4dfff) la respuesta no
 * trae `total`: entonces se hace lo de siempre —los últimos 300, filtrados acá— y la
 * pantalla lo avisa en chico. Nada se rompe.
 */

import { API_URL } from "@/config";
import { fechaCorta, isoLocal, sumarDias } from "@/lib/asistencia";

/** El mismo tope que el backend (AuditoriaAPI.TOPE_EXPORTAR). */
export const TOPE_EXPORTAR = 10_000;
/** De a cuántos movimientos se pide la lista. */
export const POR_PAGINA = 100;
/** Lo que traía la pantalla vieja, y lo que se trae contra el backend viejo. */
export const TOPE_VIEJO = 300;

export const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

// ─────────────────────────── lo que contesta el servidor ───────────────────────────

export interface Movimiento {
    id: number;
    cuando: string | null;
    usuario: string | null;
    id_usuario?: number | null;
    accion: string;
    entidad: string;
    id_entidad: string | null;
    descripcion: string;
    metodo: string;
    ruta: string;
    estado: number | null;
    salio_bien: boolean;
    duracion_ms: number | null;
    detalle: string | null;
}

export interface PersonaDelRegistro {
    id_usuario: number;
    nombre: string | null;
    username?: string | null;
    activo?: boolean | null;
}

export interface RespuestaMovimientos {
    movimientos: Movimiento[];
    /** Sólo el backend nuevo. Sin esto, es el viejo: los últimos 300 y nada más. */
    total?: number;
    hay_mas?: boolean;
    entidades?: { entidad: string; cuantos: number }[];
    usuarios?: string[];
    personas?: PersonaDelRegistro[];
}

export interface ActividadDePersona {
    id_usuario: number;
    nombre: string;
    username: string | null;
    activo: boolean | null;
    ultimo_ingreso: string | null;
    /** El último ingreso sale de la ficha: es anterior a que se registraran los ingresos. */
    ultimo_ingreso_de_la_ficha: boolean;
    ultima_accion: string | null;
    ingresos: number;
    acciones: number;
    acciones_fallidas: number;
    intentos_fallidos: number;
    bloqueos: number;
}

export interface RespuestaActividad {
    desde: string | null;
    hasta: string | null;
    personas: ActividadDePersona[];
    intentos_sin_cuenta: number;
    acciones_sin_persona: number;
}

// ─────────────────────────── ingresos ───────────────────────────

/** Las acciones de la vista «Ingresos» (auditoria_movimientos.ACCIONES_DE_ACCESO). */
export const ACCIONES_DE_ACCESO = [
    "ingresó", "salió", "intento fallido", "cambió su clave", "restableció clave",
    "pidió recuperar", "bloqueó", "desbloqueó",
] as const;

export const esDeAcceso = (accion: string) => (ACCIONES_DE_ACCESO as readonly string[]).includes(accion);

/** Los botones de la vista Ingresos: cada uno es una o varias acciones. */
export const GRUPOS_DE_INGRESO: { clave: string; texto: string; acciones: string }[] = [
    { clave: "entradas", texto: "Entradas", acciones: "ingresó" },
    { clave: "fallidos", texto: "Intentos fallidos", acciones: "intento fallido" },
    { clave: "salidas", texto: "Salidas", acciones: "salió" },
    { clave: "bloqueos", texto: "Bloqueos", acciones: "bloqueó,desbloqueó" },
    { clave: "claves", texto: "Contraseñas", acciones: "cambió su clave,restableció clave,pidió recuperar" },
];

/** Lo que el registro guarda de dónde vino un ingreso (IP y navegador), si lo guardó. */
export function origenDelIngreso(m: Movimiento): { ip?: string; navegador?: string } {
    if (!m.detalle || !esDeAcceso(m.accion)) return {};
    try {
        const d = JSON.parse(m.detalle);
        return {
            ip: typeof d?.ip === "string" ? d.ip : undefined,
            navegador: typeof d?.navegador === "string" ? d.navegador : undefined,
        };
    } catch {
        return {};
    }
}

// ─────────────────────────── el período ───────────────────────────

export type ClavePeriodoAuditoria = "todo" | "hoy" | "7d" | "30d" | "rango";

export interface PeriodoAuditoria {
    clave: ClavePeriodoAuditoria;
    /** Sólo para «rango»: «AAAA-MM-DD», los dos incluidos. */
    desde?: string;
    hasta?: string;
}

export const ATAJOS_DE_PERIODO: { clave: ClavePeriodoAuditoria; texto: string }[] = [
    { clave: "todo", texto: "Todo" },
    { clave: "hoy", texto: "Hoy" },
    { clave: "7d", texto: "7 días" },
    { clave: "30d", texto: "30 días" },
    { clave: "rango", texto: "Elegir fechas" },
];

/** Las dos puntas, incluidas, como las pide la API. null = sin límite. */
export function rangoDelPeriodo(p: PeriodoAuditoria, hoy: Date = new Date()): { desde: string | null; hasta: string | null } {
    const h = isoLocal(hoy);
    switch (p.clave) {
        case "todo":
            return { desde: null, hasta: null };
        case "hoy":
            return { desde: h, hasta: h };
        case "7d":
            return { desde: sumarDias(h, -6), hasta: h };
        case "30d":
            return { desde: sumarDias(h, -29), hasta: h };
        case "rango":
            return { desde: p.desde || null, hasta: p.hasta || null };
    }
}

/** Qué le pasa al rango a mano, o null si está bien. */
export function problemaDelRango(desde: string, hasta: string): string | null {
    if (!desde || !hasta) return "Elegí las dos fechas.";
    if (hasta < desde) return "La fecha final es anterior a la inicial.";
    return null;
}

/** «Últimos 7 días (17/09/2026 al 23/09/2026)», para el resumen del Exportar. */
export function textoDelPeriodo(p: PeriodoAuditoria, hoy: Date = new Date()): string {
    const { desde, hasta } = rangoDelPeriodo(p, hoy);
    if (!desde || !hasta) return "Desde que hay registro";
    const fechas = desde === hasta ? `el ${fechaCorta(desde)}` : `del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`;
    const nombre = { hoy: "Hoy", "7d": "Últimos 7 días", "30d": "Últimos 30 días" }[p.clave as "hoy" | "7d" | "30d"];
    return nombre ? `${nombre} (${fechas})` : fechas.charAt(0).toUpperCase() + fechas.slice(1);
}

/** ¿El movimiento cae en el período? Sólo para el backend viejo, que no filtra fechas. */
export function caeEnElPeriodo(cuando: string | null, p: PeriodoAuditoria): boolean {
    const { desde, hasta } = rangoDelPeriodo(p);
    if (!desde && !hasta) return true;
    if (!cuando) return false;
    const dia = cuando.slice(0, 10);
    return (!desde || dia >= desde) && (!hasta || dia <= hasta);
}

// ─────────────────────────── de una solapa a otra ───────────────────────────

/**
 * «Mostrame lo de esta persona»: lo que manda la Actividad por persona a la solapa
 * «Todo lo que se hizo» o «Ingresos» al tocar un renglón. `n` cambia en cada pedido,
 * así la misma persona tocada dos veces vuelve a aplicar el filtro.
 */
export interface PedidoDeFiltro {
    n: number;
    destino: "todo" | "ingresos";
    persona: { id: number; nombre: string } | null;
    periodo: PeriodoAuditoria;
    soloFallidos?: boolean;
    /** Para Ingresos: la clave de GRUPOS_DE_INGRESO. */
    grupo?: string | null;
}

// ─────────────────────────── los pedidos ───────────────────────────

export interface FiltrosDelRegistro {
    modo: "todo" | "ingresos";
    texto: string;
    /** Una acción, o varias separadas por coma. */
    accion: string | null;
    entidad: string | null;
    persona: { id: number; nombre: string } | null;
    soloFallidos: boolean;
    periodo: PeriodoAuditoria;
}

export function parametrosDelRegistro(f: FiltrosDelRegistro): URLSearchParams {
    const q = new URLSearchParams();
    if (f.modo === "ingresos") q.set("tipo", "ingresos");
    if (f.texto.trim()) q.set("buscar", f.texto.trim());
    if (f.accion) q.set("accion", f.accion);
    if (f.entidad) q.set("entidad", f.entidad);
    if (f.persona) q.set("id_usuario", String(f.persona.id));
    if (f.soloFallidos) q.set("solo_fallidos", "true");
    const { desde, hasta } = rangoDelPeriodo(f.periodo);
    if (desde) q.set("desde", desde);
    if (hasta) q.set("hasta", hasta);
    return q;
}

export async function pedirMovimientos(q: URLSearchParams, senal?: AbortSignal): Promise<RespuestaMovimientos> {
    const res = await fetch(`${API_URL}/auditoria/movimientos?${q.toString()}`, {
        headers: getAuthHeaders(),
        signal: senal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return {
        ...data,
        movimientos: Array.isArray(data?.movimientos) ? data.movimientos : [],
    };
}

/** El backend nuevo contesta `total`; el viejo, no. */
export const esBackendNuevo = (r: RespuestaMovimientos) => typeof r.total === "number";

/**
 * Lo que hace el backend viejo con sus 300: los mismos filtros, acá. Sólo se usa contra
 * el de producción hasta que se deploye.
 */
export function filtrarEnElNavegador(movs: Movimiento[], f: FiltrosDelRegistro): Movimiento[] {
    const buscado = f.texto.trim().toLowerCase();
    const acciones = f.accion ? f.accion.split(",") : null;
    return movs.filter((m) => {
        if (f.modo === "ingresos" && !esDeAcceso(m.accion)) return false;
        if (f.entidad && !m.entidad.startsWith(f.entidad)) return false;
        if (acciones && !acciones.includes(m.accion)) return false;
        if (f.persona && m.usuario !== f.persona.nombre) return false;
        if (f.soloFallidos && m.salio_bien) return false;
        if (!caeEnElPeriodo(m.cuando, f.periodo)) return false;
        if (buscado && !m.descripcion.toLowerCase().includes(buscado)
            && !(m.usuario ?? "").toLowerCase().includes(buscado)) return false;
        return true;
    });
}

/** `null` = el servidor todavía no tiene la Actividad por persona (backend viejo: 404). */
export async function pedirActividad(p: PeriodoAuditoria, senal?: AbortSignal): Promise<RespuestaActividad | null> {
    const q = new URLSearchParams();
    const { desde, hasta } = rangoDelPeriodo(p);
    if (desde) q.set("desde", desde);
    if (hasta) q.set("hasta", hasta);
    const res = await fetch(`${API_URL}/auditoria/actividad?${q.toString()}`, {
        headers: getAuthHeaders(),
        signal: senal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return {
        desde: data?.desde ?? null,
        hasta: data?.hasta ?? null,
        personas: Array.isArray(data?.personas) ? data.personas : [],
        intentos_sin_cuenta: Number(data?.intentos_sin_cuenta) || 0,
        acciones_sin_persona: Number(data?.acciones_sin_persona) || 0,
    };
}

// ─────────────────────────── cómo se ven las fechas ───────────────────────────

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * «22/09 10:30», y con el año si no es de este: «22/09/25 10:30». Reloj de 24 horas: con
 * el de 12 el es-AR escribe «10:15 a. m.» y parte el renglón en un teléfono.
 */
export function cuandoCorto(iso: string | null | undefined, hoy: Date = new Date()): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const anio = d.getFullYear() === hoy.getFullYear() ? "" : `/${String(d.getFullYear()).slice(2)}`;
    return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}${anio} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
