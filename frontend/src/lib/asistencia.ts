/**
 * La asistencia y el tiempo efectivo de cada persona (RF-06): tipos y cuentas chicas.
 *
 * Las cuentas de verdad (días laborables, tiempo efectivo) las hace el backend: acá no
 * hay una segunda jornada ni un segundo calendario. Esto sólo da formato y arma los
 * períodos que se eligen en la ficha.
 */

export interface MotivoAusencia {
  codigo: string;
  texto: string;
}

export interface Ausencia {
  id: number;
  id_operario: number;
  /** Primer día que faltó, «AAAA-MM-DD». */
  desde: string;
  /** Último día que faltó (incluido). null si sigue ausente o volvió el mismo día. */
  hasta: string | null;
  /** Primer día de vuelta. null = sigue ausente. */
  vuelve: string | null;
  abierta: boolean;
  /** Ausente y Activo el mismo día: queda el registro, suma cero. */
  mismo_dia: boolean;
  /** Empieza más adelante (unas vacaciones cargadas a futuro). */
  programada: boolean;
  /** Días corridos de la ausencia entera (una abierta, hasta hoy). */
  dias: number;
  motivo: string | null;
  motivo_texto: string | null;
  observacion: string | null;
  /** ESTADO = la abrió el Activo / Ausente; CARGA = la cargó alguien a mano. */
  origen: "ESTADO" | "CARGA";
  cargada_en: string | null;
  usuario_carga: string | null;
  cerrada_en: string | null;
  usuario_cierre: string | null;
  /** Sólo del navegador: se dibujó antes de que contestara el servidor. */
  pendiente?: boolean;
}

export interface HistorialAusencias {
  id_operario: number;
  periodo: { desde: string; hasta: string };
  disponible: boolean;
  /** Está Ausente desde antes de que se guardara la fecha: no hay nada abierto. */
  ausente_sin_fecha: boolean;
  abierta: Ausencia | null;
  resumen: {
    dias: number;
    dias_laborables: number;
    por_motivo: { motivo: string; texto: string; dias: number }[];
  };
  motivos: MotivoAusencia[];
  ausencias: Ausencia[];
}

export interface TareaConTiempo {
  id_otp: number;
  id_orden_trabajo: number;
  numero_ot: number;
  articulo: string | null;
  proceso: string | null;
  paso: number | null;
  id_estado: number;
  estado: string;
  inicio_real: string;
  fin_real: string | null;
  en_curso: boolean;
  /** Terminado sin fin registrado (o con el fin antes del arranque): no se mide. */
  sin_datos: boolean;
  /** «ot» = la persona elegida a mano en la OT; «plan» = según el último plan. */
  origen: "ot" | "plan";
  estimado_min: number | null;
  corrido_min: number | null;
  fuera_de_jornada_min: number | null;
  pausa_min: number | null;
  efectivo_min: number | null;
}

export interface TiemposOperario {
  id_operario: number;
  periodo: { desde: string | null; hasta: string | null };
  jornada: string;
  /** false = el servidor no tiene las pausas (RF-03): el efectivo no las descuenta. */
  pausas_disponibles: boolean;
  recortado: boolean;
  resumen: {
    tareas: number;
    terminadas: number;
    en_curso: number;
    estimado_min: number;
    corrido_min: number;
    pausa_min: number;
    fuera_de_jornada_min: number;
    efectivo_min: number;
  };
  tareas: TareaConTiempo[];
}

/**
 * «no» = este backend no tiene la ruta (se deploya a mano y puede ir atrás del front):
 * la solapa ni aparece. «error» = la tiene pero no pudo contestar (por ejemplo, la tabla
 * todavía no se creó): la solapa aparece y lo dice.
 */
export type EstadoSeccion = "cargando" | "si" | "no" | "error";

// ── Fechas: días del taller, sin zona ─────────────────────────────────────────

const dos = (n: number) => String(n).padStart(2, "0");

/** Un Date a «AAAA-MM-DD» con la fecha LOCAL (no la UTC de toISOString). */
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** «AAAA-MM-DD» a Date local. `new Date("2026-09-14")` es UTC y en Argentina daría el 13. */
export function fechaLocal(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(a, (m || 1) - 1, d || 1);
}

/** «14/09/2026». */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** «14/09», sin el año, para los renglones. */
export function diaCorto(iso: string | null | undefined): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** «22/09 10:30», reloj de 24 h: «10:30 a. m.» parte el renglón en un teléfono. */
export function momentoCorto(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

export function sumarDias(iso: string, n: number): string {
  const d = fechaLocal(iso);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

// ── Períodos ──────────────────────────────────────────────────────────────────

export type ClavePeriodo = "30d" | "mes" | "mes_pasado" | "anio" | "anio_pasado";

export const PERIODOS: { clave: ClavePeriodo; texto: string }[] = [
  { clave: "30d", texto: "Últimos 30 días" },
  { clave: "mes", texto: "Este mes" },
  { clave: "mes_pasado", texto: "Mes pasado" },
  { clave: "anio", texto: "Este año" },
  { clave: "anio_pasado", texto: "Año pasado" },
];

/** Las dos puntas del período, incluidas, como las pide la API. */
export function rangoDePeriodo(clave: ClavePeriodo, hoy: Date = new Date()): { desde: string; hasta: string } {
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  switch (clave) {
    case "30d": {
      const desde = new Date(a, m, hoy.getDate() - 29);
      return { desde: isoLocal(desde), hasta: isoLocal(hoy) };
    }
    case "mes":
      return { desde: isoLocal(new Date(a, m, 1)), hasta: isoLocal(new Date(a, m + 1, 0)) };
    case "mes_pasado":
      return { desde: isoLocal(new Date(a, m - 1, 1)), hasta: isoLocal(new Date(a, m, 0)) };
    case "anio":
      return { desde: `${a}-01-01`, hasta: `${a}-12-31` };
    case "anio_pasado":
      return { desde: `${a - 1}-01-01`, hasta: `${a - 1}-12-31` };
  }
}

// ── Duraciones ────────────────────────────────────────────────────────────────

/** «45 min», «2 h», «2 h 15 min». null = no se pudo medir. */
export function fmtMinutos(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return "—";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

/** «1 día», «3 días». */
export function fmtDias(n: number): string {
  return n === 1 ? "1 día" : `${n} días`;
}

/** Cuántos días corridos hay entre dos fechas incluidas (para el alta en línea). */
export function diasEntre(desde: string, hasta: string): number {
  const ms = fechaLocal(hasta).getTime() - fechaLocal(desde).getTime();
  return Math.round(ms / 86_400_000) + 1;
}
