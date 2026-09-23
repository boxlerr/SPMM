/**
 * El historial de UNA orden y de UNA persona, dentro de Auditoría (RF-17, 23/09).
 *
 * Julián: «¿esto podríamos mostrarlo en la sección de Auditoría? No meterlo dentro de
 * planificación». Así que vive sólo ahí, en dos solapas («Por orden» y «Por persona»):
 * ni la ficha de la OT, ni la de la persona, ni Operaciones ni el planificador suman nada.
 *
 * La línea de tiempo la arma el SERVIDOR (backend/application/HistorialService.py) con el
 * registro central buscado por entidad y número, completado con las tablas que guardan
 * cada hecho (pasos, pausas, consumos, no conformidades, planos, plan, ausencias). Acá
 * sólo se pide, se filtra por tipo y se dibuja.
 *
 * Contra el backend viejo (el de producción hasta que se deploye, 3c4dfff) las rutas no
 * existen y contestan 404 «Not Found»: la pantalla lo dice en chico y no se rompe nada.
 */

import { API_URL } from "@/config";
import { getAuthHeaders, rangoDelPeriodo, type PeriodoAuditoria } from "@/lib/auditoria";

// ─────────────────────────── lo que contesta el servidor ───────────────────────────

/** Un renglón de la línea de tiempo. `quien` null = no hay autor registrado (nunca uno inventado). */
export interface EventoHistorial {
    id: string;
    cuando: string | null;
    tipo: string;
    /** La frase SIN el autor: «editó los datos de la OT 15300». */
    titulo: string;
    quien: string | null;
    id_usuario?: number | null;
    /** El detalle: «fecha prometida: 30/09/2026 → 05/10/2026», «Motivo: Falta material». */
    lineas: string[];
    salio_bien: boolean;
    /** De qué tabla salió: «Registro», «Pausas», «Registro y pasos»... */
    fuente: string;
    nota: string | null;
    /** Lo que cambió se dedujo comparando con el guardado anterior (filas de antes del 23/09). */
    deducido: boolean;
    /** En la línea de tiempo de una persona: de qué OT es. */
    ot: { id: number; numero: number } | null;
}

export interface TipoDeEvento {
    tipo: string;
    texto: string;
    cuantos: number;
}

interface RespuestaComun {
    desde: string | null;
    hasta: string | null;
    eventos: EventoHistorial[];
    total: number;
    /** Hay más de `tope` renglones en el período: se mandan los más recientes. */
    recortado: boolean;
    tope: number;
    tipos: TipoDeEvento[];
    /** Lo que no se muestra porque es de una sección que la persona no tiene. */
    ocultos: { que: string; texto: string }[];
    /** Lo que no se pudo leer (una tabla que todavía no existe): sale sin eso. */
    avisos: string[];
    /** Desde cuándo hay registro: lo anterior no quedó guardado. */
    desde_cuando: { registro: string | null; pasos: string | null } | null;
}

export interface OrdenDelHistorial {
    id: number;
    numero: number;
    cliente: string | null;
    articulo: string | null;
    unidades?: number | null;
    cantidad_entregada?: number | null;
    fecha_orden?: string | null;
    fecha_prometida: string | null;
    fecha_entrega?: string | null;
    terminada: boolean;
}

export interface PersonaDelHistorial {
    id: number;
    nombre: string;
    categoria: string | null;
    sector: string | null;
    activo: boolean;
}

export interface HistorialDeOrden extends RespuestaComun {
    orden: OrdenDelHistorial;
}

export interface HistorialDePersona extends RespuestaComun {
    persona: PersonaDelHistorial;
}

// ─────────────────────────── los pedidos ───────────────────────────

/** El servidor todavía no tiene el historial (backend viejo): la ruta no existe. */
export class HistorialNoDisponible extends Error {
    constructor() {
        super("historial-no-disponible");
    }
}

/** La OT o la persona no existe (se borró, o el número es de otra base). */
export class NoExiste extends Error {
    constructor(detalle: string) {
        super(detalle);
    }
}

const base = () => API_URL.replace(/\/$/, "");

async function pedir<T>(camino: string, q: URLSearchParams | null, senal?: AbortSignal): Promise<T> {
    const res = await fetch(`${base()}${camino}${q && q.toString() ? `?${q.toString()}` : ""}`, {
        headers: getAuthHeaders(),
        signal: senal,
    });
    if (res.status === 404) {
        // FastAPI contesta «Not Found» cuando la RUTA no existe (backend viejo) y el
        // endpoint dice «No existe la orden…» cuando lo que no existe es la OT.
        let detalle = "";
        try {
            detalle = (await res.json())?.detail ?? "";
        } catch {
            /* sin cuerpo */
        }
        if (!detalle || detalle === "Not Found") throw new HistorialNoDisponible();
        throw new NoExiste(String(detalle));
    }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
}

function conPeriodo(p: PeriodoAuditoria): URLSearchParams {
    const q = new URLSearchParams();
    const { desde, hasta } = rangoDelPeriodo(p);
    if (desde) q.set("desde", desde);
    if (hasta) q.set("hasta", hasta);
    return q;
}

/** Lo que falta de una respuesta, relleno: un campo ausente no rompe la pantalla. */
function comun(data: any): RespuestaComun {
    const eventos: EventoHistorial[] = Array.isArray(data?.eventos)
        ? data.eventos.map((e: any) => ({
            ...e,
            titulo: String(e?.titulo ?? ""),
            lineas: Array.isArray(e?.lineas) ? e.lineas.map(String) : [],
            salio_bien: e?.salio_bien !== false,
            deducido: !!e?.deducido,
            quien: e?.quien ?? null,
            nota: e?.nota ?? null,
            ot: e?.ot ?? null,
            fuente: e?.fuente ?? "",
        }))
        : [];
    return {
        desde: data?.desde ?? null,
        hasta: data?.hasta ?? null,
        eventos,
        total: typeof data?.total === "number" ? data.total : eventos.length,
        recortado: !!data?.recortado,
        tope: typeof data?.tope === "number" ? data.tope : eventos.length,
        tipos: Array.isArray(data?.tipos) ? data.tipos : [],
        ocultos: Array.isArray(data?.ocultos) ? data.ocultos : [],
        avisos: Array.isArray(data?.avisos) ? data.avisos : [],
        desde_cuando: data?.desde_cuando ?? null,
    };
}

export async function buscarOrdenes(texto: string, senal?: AbortSignal): Promise<OrdenDelHistorial[]> {
    const q = new URLSearchParams();
    if (texto.trim()) q.set("buscar", texto.trim());
    const data = await pedir<any>("/auditoria/historial/ordenes", q, senal);
    return Array.isArray(data?.ordenes) ? data.ordenes : [];
}

export async function historialDeOrden(id: number, p: PeriodoAuditoria, senal?: AbortSignal): Promise<HistorialDeOrden> {
    const data = await pedir<any>(`/auditoria/historial/ordenes/${id}`, conPeriodo(p), senal);
    return { ...comun(data), orden: data?.orden };
}

export async function buscarPersonas(senal?: AbortSignal): Promise<PersonaDelHistorial[]> {
    const data = await pedir<any>("/auditoria/historial/personas", null, senal);
    return Array.isArray(data?.personas) ? data.personas : [];
}

export async function historialDePersona(id: number, p: PeriodoAuditoria, senal?: AbortSignal): Promise<HistorialDePersona> {
    const data = await pedir<any>(`/auditoria/historial/personas/${id}`, conPeriodo(p), senal);
    return { ...comun(data), persona: data?.persona };
}

// ─────────────────────────── para leer ───────────────────────────

/** «Lucas Longchamps editó la OT…» o, sin autor, «Se cerró sola la pausa…». */
export function fraseCompleta(e: EventoHistorial): string {
    if (e.quien) return `${e.quien} ${e.titulo}`;
    return e.titulo ? e.titulo.charAt(0).toUpperCase() + e.titulo.slice(1) : "";
}

/** El día del renglón, «AAAA-MM-DD» (las fechas vienen sin zona, en hora del taller). */
export const diaDe = (e: EventoHistorial) => (e.cuando ? e.cuando.slice(0, 10) : "");

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** «Martes 22/09/2026». */
export function tituloDelDia(dia: string): string {
    if (!dia) return "Sin fecha";
    const [a, m, d] = dia.split("-").map(Number);
    const fecha = new Date(a, (m || 1) - 1, d || 1);
    const nombre = DIAS[fecha.getDay()] ?? "";
    return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${a}`;
}

/** «10:30». */
export function horaDe(e: EventoHistorial): string {
    if (!e.cuando) return "";
    return e.cuando.slice(11, 16);
}
