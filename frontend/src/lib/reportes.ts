/**
 * El armador de reportes personalizados del Dashboard (RF-23): tipos, pedidos al servidor y
 * las cuentas chicas que no dependen de React.
 *
 * QUÉ SE ARMA ACÁ Y QUÉ NO
 *
 * La pantalla arma una RECETA (`ConfigReporte`): de qué fuente, qué columnas, qué filtros,
 * cómo agrupar y ordenar. Viaja al servidor como códigos del catálogo y nada más; el
 * servidor la valida contra su catálogo cerrado (backend/application/ReportesCatalogo.py)
 * y contra los permisos de quien pide, arma la consulta y la corre. Acá no se filtra ni se
 * suma nada: lo que se ve es lo que contestó el servidor.
 *
 * CONTRA EL BACKEND VIEJO
 *
 * El de producción hasta que se deploye (3422285) no tiene /reportes/personalizados: el
 * catálogo contesta 404 y la pantalla lo dice en chico («se activa con la próxima
 * actualización»). Nada se rompe.
 */

import { API_URL } from "@/config";
import type { ColumnaExport, SeccionExport, TipoColumna } from "@/lib/exportar";
import type { Atajo } from "./reportesPeriodo";

export type { Atajo } from "./reportesPeriodo";

export const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

// ─────────────────────────── lo que contesta el catálogo ───────────────────────────

export type TipoDato =
    | "texto" | "entero" | "numero" | "id" | "porcentaje" | "fecha" | "fechaHora" | "booleano" | "mes";
export type TipoFiltro = "opciones" | "texto" | "numero" | "fecha" | "booleano";
export type Funcion = "conteo" | "suma" | "promedio" | "minimo" | "maximo";


export interface ColumnaCatalogo {
    codigo: string;
    nombre: string;
    tipo: TipoDato;
    ayuda: string | null;
    filtro: TipoFiltro | null;
    opciones: string | null;
    agrupable: boolean;
    funciones: Funcion[];
    totaliza: boolean;
    decimales: number | null;
    por_defecto: boolean;
}

export interface FuenteCatalogo {
    codigo: string;
    nombre: string;
    descripcion: string;
    icono: string;
    columnas: ColumnaCatalogo[];
    /** Las fechas por las que se acota el período; la primera es la de siempre. */
    periodo: string[];
    /** El período no filtra filas: se usa adentro de las cuentas (personas). */
    periodo_interno: string | null;
    filtros_iniciales: FiltroReporte[];
    orden_inicial: [string, "asc" | "desc"] | null;
    nota: string | null;
}

export interface Ejemplo {
    codigo: string;
    nombre: string;
    descripcion: string;
    config: ConfigReporte;
}

export interface Catalogo {
    version: number;
    fuentes: FuenteCatalogo[];
    atajos: { codigo: Atajo; nombre: string }[];
    funciones: { codigo: Funcion; nombre: string }[];
    tope_filas: number;
    filas_vista_previa: number;
    ejemplos: Ejemplo[];
}

// ─────────────────────────── la receta ───────────────────────────

export type ValorOpcion = string | number | null;

export interface FiltroReporte {
    columna: string;
    op: "en" | "contiene" | "entre" | "es";
    valores?: ValorOpcion[];
    valor?: string | boolean;
    desde?: string | number | null;
    hasta?: string | number | null;
}

export interface PeriodoReporte {
    columna?: string | null;
    atajo?: Atajo | null;
    desde?: string | null;
    hasta?: string | null;
}

export interface MedidaReporte {
    funcion: Funcion;
    columna?: string | null;
}

export interface ConfigReporte {
    version?: 1;
    fuente: string;
    columnas: string[];
    filtros: FiltroReporte[];
    periodo?: PeriodoReporte | null;
    agrupar: string[];
    medidas: MedidaReporte[];
    orden?: { por: string; direccion: "asc" | "desc" } | null;
}

export interface Opcion {
    valor: string | number;
    texto: string;
}

// ─────────────────────────── lo que contesta un reporte ───────────────────────────

export interface ColumnaResultado {
    clave: string;
    nombre: string;
    tipo: TipoDato;
    decimales: number | null;
    totaliza: boolean;
}

export interface ResultadoReporte {
    fuente: string;
    fuente_nombre: string;
    modo: "filas" | "grupos";
    columnas: ColumnaResultado[];
    filas: Record<string, unknown>[];
    totales: Record<string, unknown>;
    total_filas: number;
    total_grupos: number | null;
    recortado: boolean;
    vista_previa: boolean;
    tope: number;
    aviso: string | null;
    periodo: { desde: string; hasta: string; atajo: Atajo | null; columna: string | null } | null;
    criterios: { lineas: string[]; periodo: string | null; agrupacion: string | null };
    generado: string;
}

export interface ReporteGuardado {
    id: number;
    nombre: string;
    descripcion: string | null;
    fuente: string;
    config: ConfigReporte | null;
    compartido: boolean;
    es_mio: boolean;
    autor: string | null;
    creado_en: string | null;
    modificado_en: string | null;
    disponible: boolean;
    motivo: string | null;
}

// ─────────────────────────── los pedidos ───────────────────────────

/** Un error que se puede mostrar tal cual: el mensaje que mandó el servidor. */
export class ErrorDeReporte extends Error {
    /** El Exportar muestra este mensaje tal cual en vez del genérico. */
    readonly paraMostrar = true;

    constructor(message: string, public status: number) {
        super(message);
    }
}

async function leerError(res: Response, porDefecto: string): Promise<ErrorDeReporte> {
    let mensaje = porDefecto;
    try {
        const j = await res.json();
        mensaje = j?.errors?.[0]?.message || j?.detail || mensaje;
        if (typeof mensaje !== "string") mensaje = porDefecto;
    } catch {
        /* sin cuerpo: queda el de por defecto */
    }
    return new ErrorDeReporte(mensaje, res.status);
}

/** `null` = el servidor todavía no tiene el armador (backend viejo: 404). */
export async function pedirCatalogo(senal?: AbortSignal): Promise<Catalogo | null> {
    const res = await fetch(`${API_URL}/reportes/personalizados/catalogo`, { headers: getAuthHeaders(), signal: senal });
    if (res.status === 404) return null;
    if (!res.ok) throw await leerError(res, "No se pudo cargar el armador de reportes.");
    const j = await res.json();
    const c = j?.data;
    return {
        ...c,
        fuentes: Array.isArray(c?.fuentes) ? c.fuentes : [],
        atajos: Array.isArray(c?.atajos) ? c.atajos : [],
        funciones: Array.isArray(c?.funciones) ? c.funciones : [],
        ejemplos: Array.isArray(c?.ejemplos) ? c.ejemplos : [],
        tope_filas: Number(c?.tope_filas) || 20000,
        filas_vista_previa: Number(c?.filas_vista_previa) || 50,
    };
}

export async function pedirOpciones(fuente: string, senal?: AbortSignal): Promise<Record<string, Opcion[]>> {
    const q = new URLSearchParams({ fuente });
    const res = await fetch(`${API_URL}/reportes/personalizados/opciones?${q}`, { headers: getAuthHeaders(), signal: senal });
    if (!res.ok) throw await leerError(res, "No se pudieron cargar las listas para filtrar.");
    const j = await res.json();
    return j?.data && typeof j.data === "object" ? j.data : {};
}

export async function correrReporte(config: ConfigReporte, vistaPrevia: boolean, senal?: AbortSignal): Promise<ResultadoReporte> {
    const q = new URLSearchParams({ config: JSON.stringify(limpiarConfig(config)) });
    if (vistaPrevia) q.set("vista_previa", "true");
    const res = await fetch(`${API_URL}/reportes/personalizados/datos?${q}`, { headers: getAuthHeaders(), signal: senal });
    if (!res.ok) throw await leerError(res, "No se pudo armar el reporte. Probá de nuevo en unos segundos.");
    const j = await res.json();
    const r = j?.data ?? {};
    return {
        ...r,
        columnas: Array.isArray(r.columnas) ? r.columnas : [],
        filas: Array.isArray(r.filas) ? r.filas : [],
        totales: r.totales && typeof r.totales === "object" ? r.totales : {},
        criterios: r.criterios ?? { lineas: [], periodo: null, agrupacion: null },
    };
}

export async function pedirGuardados(senal?: AbortSignal): Promise<ReporteGuardado[] | null> {
    const res = await fetch(`${API_URL}/reportes/personalizados/guardados`, { headers: getAuthHeaders(), signal: senal });
    if (res.status === 404) return null;
    if (!res.ok) throw await leerError(res, "No se pudieron cargar tus reportes guardados.");
    const j = await res.json();
    return Array.isArray(j?.data) ? j.data : [];
}

export interface DatosParaGuardar {
    nombre: string;
    descripcion?: string | null;
    config: ConfigReporte;
    compartido?: boolean | null;
}

export async function guardarReporte(datos: DatosParaGuardar, id?: number): Promise<ReporteGuardado> {
    const url = id
        ? `${API_URL}/reportes/personalizados/guardados/${id}`
        : `${API_URL}/reportes/personalizados/guardados`;
    const res = await fetch(url, {
        method: id ? "PUT" : "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...datos, config: limpiarConfig(datos.config) }),
    });
    if (!res.ok) throw await leerError(res, "No se pudo guardar el reporte.");
    return (await res.json()).data;
}

export async function borrarReporte(id: number): Promise<void> {
    const res = await fetch(`${API_URL}/reportes/personalizados/guardados/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
    });
    if (!res.ok) throw await leerError(res, "No se pudo borrar el reporte.");
}

// ─────────────────────────── la receta: armar, limpiar, comparar ───────────────────────────

/** La receta sin nada vacío: lo que viaja y lo que se guarda. */
export function limpiarConfig(c: ConfigReporte): ConfigReporte {
    const salida: ConfigReporte = {
        version: 1,
        fuente: c.fuente,
        columnas: [...c.columnas],
        filtros: c.filtros.filter(filtroCompleto).map((f) => {
            const x: FiltroReporte = { columna: f.columna, op: f.op };
            if (f.op === "en") x.valores = f.valores ?? [];
            if (f.op === "contiene") x.valor = String(f.valor ?? "").trim();
            if (f.op === "es") x.valor = Boolean(f.valor);
            if (f.op === "entre") {
                if (f.desde !== undefined && f.desde !== null && f.desde !== "") x.desde = f.desde;
                if (f.hasta !== undefined && f.hasta !== null && f.hasta !== "") x.hasta = f.hasta;
            }
            return x;
        }),
        agrupar: [...c.agrupar],
        medidas: c.agrupar.length ? c.medidas.map((m) => (m.funcion === "conteo" ? { funcion: "conteo" } : { ...m })) : [],
    };
    const p = c.periodo;
    if (p && (p.atajo || (p.desde && p.hasta))) {
        salida.periodo = p.atajo
            ? { ...(p.columna ? { columna: p.columna } : {}), atajo: p.atajo }
            : { ...(p.columna ? { columna: p.columna } : {}), desde: p.desde, hasta: p.hasta };
    }
    // Un orden que quedó de antes de agrupar (o de desagrupar) no viaja: el servidor lo
    // rechazaría. Agrupado se ordena por lo agrupado o por una cuenta («m0», «m1»...).
    const por = c.orden?.por;
    if (por) {
        const esCuenta = /^m\d+$/.test(por);
        const vale = salida.agrupar.length
            ? salida.agrupar.includes(por) || (esCuenta && Number(por.slice(1)) < Math.max(1, salida.medidas.length))
            : !esCuenta;
        if (vale) salida.orden = { por, direccion: c.orden!.direccion };
    }
    return salida;
}

/** Un filtro a medio cargar (sin valores todavía) no viaja: se ve en la pantalla y listo. */
export function filtroCompleto(f: FiltroReporte): boolean {
    if (f.op === "en") return (f.valores ?? []).length > 0;
    if (f.op === "contiene") return String(f.valor ?? "").trim().length > 0;
    if (f.op === "es") return typeof f.valor === "boolean";
    const hay = (v: unknown) => v !== undefined && v !== null && v !== "";
    return hay(f.desde) || hay(f.hasta);
}

export const mismaReceta = (a: ConfigReporte | null, b: ConfigReporte | null) =>
    JSON.stringify(a ? limpiarConfig(a) : null) === JSON.stringify(b ? limpiarConfig(b) : null);

/** La receta con la que arranca una fuente: sus columnas de siempre, este mes y su orden. */
export function recetaInicial(f: FuenteCatalogo): ConfigReporte {
    const conPeriodo = f.periodo.length > 0 || !!f.periodo_interno;
    return {
        version: 1,
        fuente: f.codigo,
        columnas: f.columnas.filter((c) => c.por_defecto).map((c) => c.codigo),
        filtros: (f.filtros_iniciales ?? []).filter((x) => f.columnas.some((c) => c.codigo === x.columna)),
        periodo: conPeriodo ? { columna: f.periodo[0] ?? null, atajo: "este_mes" } : null,
        agrupar: [],
        medidas: [{ funcion: "conteo" }],
        orden: f.orden_inicial && f.columnas.some((c) => c.codigo === f.orden_inicial![0])
            ? { por: f.orden_inicial[0], direccion: f.orden_inicial[1] }
            : null,
    };
}

/** Una receta que viene de afuera (un guardado, un ejemplo), con todo lo que la pantalla espera. */
export function completarReceta(c: Partial<ConfigReporte> & { fuente: string }): ConfigReporte {
    return {
        version: 1,
        fuente: c.fuente,
        columnas: Array.isArray(c.columnas) ? c.columnas : [],
        filtros: Array.isArray(c.filtros) ? c.filtros : [],
        periodo: c.periodo ?? null,
        agrupar: Array.isArray(c.agrupar) ? c.agrupar : [],
        medidas: Array.isArray(c.medidas) && c.medidas.length ? c.medidas : [{ funcion: "conteo" }],
        orden: c.orden ?? null,
    };
}

// ─────────────────────────── el período ───────────────────────────
//
// En su propio archivo (lib/reportesPeriodo.ts, sin imports): así un test lo compila solo
// y lo compara con el del servidor.

export { ATAJOS, fechaCorta, isoDia, rangoDelAtajo, textoDelPeriodo } from "./reportesPeriodo";

// ─────────────────────────── los valores ───────────────────────────

/** El tipo de una columna del reporte, como lo entiende el Exportar (lib/exportar.ts). */
export function tipoParaExportar(t: TipoDato): TipoColumna {
    return t === "mes" ? "texto" : t;
}

/** «2026-09» → «09/2026». */
export function mesLegible(v: unknown): string {
    const s = String(v ?? "");
    const m = /^(\d{4})-(\d{2})$/.exec(s);
    return m ? `${m[2]}/${m[1]}` : s;
}

export function nombreDeArchivo(nombre: string): string {
    const limpio = (nombre || "reporte")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase();
    return `reporte_${limpio || "personalizado"}`.slice(0, 80);
}

/** Las columnas del resultado, para el Exportar. */
export function columnasParaExportar(r: ResultadoReporte): ColumnaExport<Record<string, unknown>>[] {
    return r.columnas.map((c) => ({
        titulo: c.nombre,
        tipo: tipoParaExportar(c.tipo),
        decimales: c.decimales ?? undefined,
        valor: (fila: Record<string, unknown>) => (c.tipo === "mes" ? mesLegible(fila[c.clave]) : fila[c.clave]),
    }));
}

/**
 * Las tablas del archivo: los datos y, aparte, los totales (una hoja propia en el Excel
 * y una tabla aparte en el PDF: mezclados con los datos, un autofiltro del Excel los
 * sumaría dos veces).
 */
export function seccionesParaExportar(r: ResultadoReporte, titulo: string): SeccionExport[] {
    const secciones: SeccionExport[] = [{
        titulo: titulo || "Datos",
        filas: r.filas,
        columnas: columnasParaExportar(r),
    }];
    const conTotal = r.columnas.filter((c) => r.totales[c.clave] !== undefined);
    const totales: Record<string, unknown> = { __rotulo: "Total" };
    conTotal.forEach((c) => { totales[c.clave] = r.totales[c.clave]; });
    // Agrupado, «Cantidad» ya dice cuántas filas son: van los grupos y las cuentas.
    const filasTotal: ColumnaExport<Record<string, unknown>>[] = [
        { titulo: "", valor: (f) => f.__rotulo },
        {
            titulo: r.modo === "grupos" ? "Grupos" : "Filas",
            tipo: "entero",
            valor: () => (r.modo === "grupos" ? r.total_grupos : r.total_filas),
        },
        ...conTotal.map((c) => ({
            titulo: c.nombre,
            tipo: tipoParaExportar(c.tipo),
            decimales: c.decimales ?? undefined,
            valor: (f: Record<string, unknown>) => f[c.clave],
        })),
    ];
    secciones.push({ titulo: "Totales", filas: [totales], columnas: filasTotal });
    return secciones;
}

/** «13 grupos de 17 filas» / «1.234 filas»: lo que dice el PDF debajo del título. */
export function subtituloParaExportar(r: ResultadoReporte): string {
    const n = (x: number, uno: string, varios: string) => `${x.toLocaleString("es-AR")} ${x === 1 ? uno : varios}`;
    const base = r.modo === "grupos"
        ? `${n(r.total_grupos ?? 0, "grupo", "grupos")} de ${n(r.total_filas, "fila", "filas")}`
        : n(r.total_filas, "fila", "filas");
    return r.recortado ? `${base} (el archivo trae las primeras ${r.filas.length.toLocaleString("es-AR")})` : base;
}

/** Los renglones de «Filtros» del archivo: la receta dicha en castellano, y el tope. */
export function criteriosParaExportar(r: ResultadoReporte): string[] {
    const lineas = [...(r.criterios?.lineas ?? [])];
    if (r.recortado) {
        const total = r.modo === "grupos" ? r.total_grupos ?? 0 : r.total_filas;
        lineas.push(`Atención: el archivo trae las primeras ${r.filas.length.toLocaleString("es-AR")} de ${total.toLocaleString("es-AR")} ${r.modo === "grupos" ? "filas agrupadas" : "filas"} (tope de un reporte)`);
    }
    return lineas;
}
