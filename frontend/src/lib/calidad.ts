/**
 * Los rechazos y no conformidades (RF-12): tipos, pedidos al servidor y textos.
 *
 * Reunión con Lucas, 23/09: «si algo se rechazó, que quede el registro de que tuviste 10
 * piezas que se rechazaron. Entonces, ¿quién la hizo? Tal empleado». Lo usan tres
 * lugares, y por eso vive acá y no en cada uno:
 *
 *  · la ficha de la OT (components/calidad/ControlDeCalidadOT.tsx): sus no
 *    conformidades, cargar un rechazo y cerrarlo;
 *  · la pantalla No conformidades: la lista, cargar y el agrupado por persona;
 *  · la ficha de la persona (Rendimiento): sus rechazos.
 *
 * Las listas (tipos, gravedades, qué se hace con lo rechazado) las manda el servidor:
 * acá no se repiten. Que el servidor mande `disposiciones` es además cómo se sabe que
 * ya sabe cargar rechazos: con uno de antes (3422285) el botón no aparece, porque
 * guardar un tipo nuevo le daría error y los datos nuevos se perderían sin aviso.
 */
import { API_URL } from "@/config";

// ─────────────────────────── tipos ───────────────────────────

export interface NoConformidad {
  id: number;
  id_orden_trabajo: number;
  nro_ot: number | null;
  cliente: string | null;
  producto: string | null;
  id_proceso: number | null;
  proceso: string | null;
  /** El paso de la OT (la pasada). Ausente con un servidor de antes del 23/09. */
  id_otp?: number | null;
  /** El número de paso dentro de la OT. null si no se dijo o si el paso ya no está. */
  paso?: number | null;
  /** Quién hizo las piezas. */
  id_operario: number | null;
  operario: string | null;
  tipo: string;
  /** null = nadie la evaluó todavía. */
  gravedad: string | null;
  estado: string;
  /** Piezas rechazadas. null = no se dijo (que no es 0). */
  piezas_afectadas: number | null;
  /** De cuántas controladas. null = no se dijo. */
  piezas_controladas?: number | null;
  /** Qué se hace con lo rechazado (clave de `disposiciones`). null = no se decidió. */
  disposicion?: string | null;
  minutos_perdidos: number;
  operarios_extra: number;
  descripcion: string | null;
  accion_correctiva: string | null;
  /** Quién la registró (del token, lo pone el servidor). */
  usuario: string | null;
  fecha_registro: string;
  fecha_cierre: string | null;
  /** Sólo del navegador: se dibujó antes de que contestara el servidor. */
  pendiente?: boolean;
}

export interface ResumenNC {
  total: number;
  abiertas: number;
  cerradas: number;
  minutos_perdidos: number;
  piezas_afectadas: number;
  /** Del 23/09 en adelante. */
  piezas_controladas?: number;
  /** Rechazadas sobre controladas, sólo de las que dicen de cuántas. null = ninguna lo dice. */
  porcentaje_rechazo?: number | null;
  ordenes?: number;
}

export type Lista = Record<string, string>;

export interface Catalogos {
  tipos: Lista;
  gravedades: Lista;
  estados: Lista;
  /** Sólo en un servidor que ya sabe cargar rechazos (23/09). */
  disposiciones?: Lista;
  tipo_del_formulario?: string;
}

export interface Sugerido {
  id_operario: number;
  nombre: string;
  /** «ot» = elegida a mano en la OT; «plan» = según el último plan. */
  origen: "ot" | "plan";
}

export interface PasoParaRegistrar {
  id_otp: number;
  paso: number;
  id_proceso: number | null;
  proceso: string | null;
  estado: string;
  sugeridos: Sugerido[];
}

export interface OrdenParaRegistrar {
  id: number;
  nro_ot: number | null;
  unidades: number | null;
  cliente: string | null;
  producto: string | null;
}

export interface PersonaAgrupada {
  id_operario: number | null;
  operario: string | null;
  no_conformidades: number;
  abiertas: number;
  cerradas: number;
  piezas_rechazadas: number;
  piezas_controladas: number;
  porcentaje_rechazo: number | null;
  ordenes: number;
  ultima: string | null;
}

/** Lo que se manda al registrar. Quién la registra y cuándo NO van: los pone el servidor. */
export interface CuerpoRechazo {
  id_orden_trabajo: number;
  id_otp: number | null;
  id_proceso: number | null;
  id_operario: number | null;
  tipo: string;
  gravedad: string | null;
  disposicion: string | null;
  piezas_afectadas: number | null;
  piezas_controladas: number | null;
  descripcion: string | null;
}

// ─────────────────────────── el servidor ───────────────────────────

export const cabecerasCalidad = (json = false): HeadersInit => {
  const h: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) h.Authorization = `Bearer ${token}`;
  }
  if (json) h["Content-Type"] = "application/json";
  return h;
};

/** El porqué que manda el backend (`errors[0].message`), o uno genérico. */
async function porque(res: Response, generico: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.errors?.[0]?.message || body?.detail || generico;
}

export function sabeCargarRechazos(c: Catalogos | null | undefined): boolean {
  return !!c?.disposiciones && Object.keys(c.disposiciones).length > 0;
}

let catalogosEnMemoria: Catalogos | null = null;
let pedidoDeCatalogos: Promise<Catalogos | null> | null = null;

/**
 * Las listas, pedidas una vez por pestaña (no cambian mientras la app está abierta).
 * null = el servidor no las tiene o no se pudieron traer: quien las usa se comporta como
 * antes (sin botón de cargar).
 */
export function pedirCatalogos(): Promise<Catalogos | null> {
  if (catalogosEnMemoria) return Promise.resolve(catalogosEnMemoria);
  if (!pedidoDeCatalogos) {
    pedidoDeCatalogos = fetch(`${API_URL}/incidencias/tipos`, { headers: cabecerasCalidad() })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = await res.json().catch(() => null);
        const data = body?.data;
        if (!data?.tipos) return null;
        catalogosEnMemoria = data as Catalogos;
        return catalogosEnMemoria;
      })
      .catch(() => null)
      .finally(() => {
        // Si falló, que el próximo lo vuelva a intentar.
        if (!catalogosEnMemoria) pedidoDeCatalogos = null;
      });
  }
  return pedidoDeCatalogos;
}

/** Registrar un rechazo. Devuelve la fila como la muestra la lista (el servidor la manda
 *  completa: OT, paso, proceso, quién la hizo). Si dice que no, el Error trae su porqué. */
export async function registrarRechazo(cuerpo: CuerpoRechazo): Promise<NoConformidad> {
  const res = await fetch(`${API_URL}/incidencias`, {
    method: "POST",
    headers: cabecerasCalidad(true),
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(await porque(res, "No se pudo registrar."));
  const body = await res.json().catch(() => null);
  if (!body?.data?.id) throw new Error("El servidor no devolvió lo que se guardó.");
  return body.data as NoConformidad;
}

/** Corregir (`ruta` vacía) o cerrar (`/cerrar`) una no conformidad. */
export async function guardarNoConformidad(
  id: number, ruta: "" | "/cerrar", cuerpo: Record<string, unknown>,
): Promise<Partial<NoConformidad>> {
  const res = await fetch(`${API_URL}/incidencias/${id}${ruta}`, {
    method: "PUT",
    headers: cabecerasCalidad(true),
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(await porque(res, "No se pudo guardar."));
  const body = await res.json().catch(() => null);
  return (body?.data ?? {}) as Partial<NoConformidad>;
}

/** La OT, sus pasos y quién hizo cada uno. `orden: null` = no hay OT con ese número.
 *  Tira Error si el servidor no tiene la ruta (404) o falló. */
export async function pedirPasos(q: { id_orden?: number; nro_ot?: string | number }): Promise<{
  orden: OrdenParaRegistrar | null;
  pasos: PasoParaRegistrar[];
}> {
  const p = new URLSearchParams();
  if (q.id_orden) p.set("id_orden", String(q.id_orden));
  else if (q.nro_ot) p.set("nro_ot", String(q.nro_ot));
  const res = await fetch(`${API_URL}/incidencias/para-registrar?${p}`, { headers: cabecerasCalidad() });
  if (!res.ok) throw new Error(await porque(res, "No se pudieron traer los pasos de la orden."));
  const body = await res.json().catch(() => null);
  return { orden: body?.data?.orden ?? null, pasos: Array.isArray(body?.data?.pasos) ? body.data.pasos : [] };
}

export interface Persona {
  id: number;
  nombre: string;
}

let personasEnMemoria: Persona[] | null = null;

/** Las personas de Recursos, para elegir quién hizo las piezas (el catálogo es libre). */
export async function pedirPersonas(): Promise<Persona[]> {
  if (personasEnMemoria) return personasEnMemoria;
  try {
    const res = await fetch(`${API_URL}/operarios`, { headers: cabecerasCalidad() });
    if (!res.ok) return [];
    const body = await res.json().catch(() => null);
    const lista: { id: number; nombre?: string; apellido?: string }[] =
      Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    personasEnMemoria = lista
      .map((o) => ({ id: o.id, nombre: nombreDePersona(o.nombre, o.apellido) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return personasEnMemoria;
  } catch {
    return [];
  }
}

// ─────────────────────────── textos ───────────────────────────

const capitalizar = (t?: string | null) =>
  (t ?? "").trim().split(/\s+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

export function nombreDePersona(nombre?: string | null, apellido?: string | null): string {
  return [capitalizar(nombre), capitalizar(apellido)].filter(Boolean).join(" ");
}

/** Un nombre como lo manda el servidor («JUAN PEREZ») como se muestra en la app. */
export function nombreVisible(nombre?: string | null): string {
  return capitalizar(nombre);
}

export const ORIGEN_SUGERIDO: Record<Sugerido["origen"], string> = {
  ot: "elegida en la OT",
  plan: "según el plan",
};

/** «10 de 50», «10», o «—» si no se dijo. */
export function piezasTexto(rechazadas: number | null | undefined, controladas?: number | null): string {
  if (rechazadas === null || rechazadas === undefined) return "—";
  return controladas !== null && controladas !== undefined ? `${rechazadas} de ${controladas}` : String(rechazadas);
}

/** «20 %» o «—». */
export function porcentajeTexto(p: number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  return `${String(p).replace(".", ",")} %`;
}

/** «Paso 2 · TORNO CNC», «TORNO CNC» (sin paso) o «Toda la orden». */
export function pasoTexto(nc: Pick<NoConformidad, "paso" | "proceso">): string {
  if (nc.paso !== null && nc.paso !== undefined) return `Paso ${nc.paso}${nc.proceso ? ` · ${nc.proceso}` : ""}`;
  return nc.proceso || "Toda la orden";
}

/** «23/09/26 14:30». */
export function momentoNC(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/** Las dos puntas del mes en curso, «AAAA-MM-DD», con la fecha local. */
export function mesEnCurso(hoy: Date = new Date()): { desde: string; hasta: string } {
  const dos = (n: number) => String(n).padStart(2, "0");
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  const ultimo = new Date(a, m + 1, 0).getDate();
  return { desde: `${a}-${dos(m + 1)}-01`, hasta: `${a}-${dos(m + 1)}-${dos(ultimo)}` };
}

/** Lo que se mostró antes de que conteste el servidor, con lo que hay a mano. */
export function filaProvisoria(
  cuerpo: CuerpoRechazo,
  extra: { nro_ot?: number | null; paso?: number | null; proceso?: string | null; operario?: string | null; usuario?: string | null },
  id: number,
): NoConformidad {
  return {
    id,
    id_orden_trabajo: cuerpo.id_orden_trabajo,
    nro_ot: extra.nro_ot ?? null,
    cliente: null,
    producto: null,
    id_proceso: cuerpo.id_proceso,
    proceso: extra.proceso ?? null,
    id_otp: cuerpo.id_otp,
    paso: extra.paso ?? null,
    id_operario: cuerpo.id_operario,
    operario: extra.operario ?? null,
    tipo: cuerpo.tipo,
    gravedad: cuerpo.gravedad,
    estado: "ABIERTA",
    piezas_afectadas: cuerpo.piezas_afectadas,
    piezas_controladas: cuerpo.piezas_controladas,
    disposicion: cuerpo.disposicion,
    minutos_perdidos: 0,
    operarios_extra: 0,
    descripcion: cuerpo.descripcion,
    accion_correctiva: null,
    usuario: extra.usuario ?? null,
    fecha_registro: new Date().toISOString(),
    fecha_cierre: null,
    pendiente: true,
  };
}

// ─────────────────────────── el enganche con RF-11 ───────────────────────────
//
// RF-11 (otra rama) agrega la casilla «Controlado» a la OT. Al tildarla, el taller
// quiere que se le pregunte «¿hubo piezas rechazadas?». Para no tocar esa casilla desde
// acá (es de la otra rama), el control de calidad de la ficha ESCUCHA este aviso: RF-11
// sólo tiene que llamar, al tildarla,
//
//     ofrecerRegistrarRechazos(idOrden)
//
// y en la franja «Control de calidad» de esa OT aparece la pregunta con «Sí, cargarlas»
// (abre el formulario) y «No». Si la ficha no está abierta o quien la mira no puede
// cargar no conformidades, no pasa nada.

export const EVENTO_OT_CONTROLADA = "spmm:ot-controlada";

export function ofrecerRegistrarRechazos(idOrden: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO_OT_CONTROLADA, { detail: { idOrden } }));
}
