/**
 * Las horas de uso de cada máquina y su mantenimiento preventivo (RF-10): tipos y
 * cuentas chicas. Las cuentas de verdad (horas efectivas, próxima fecha) las hace el
 * backend (application/UsoMaquinaService.py y MantenimientoMaquinaService.py): acá sólo
 * se da formato.
 */
import { fechaCorta, fmtMinutos } from "@/lib/asistencia";

// ── El uso ────────────────────────────────────────────────────────────────────

export type MotivoNoSuma = "FUERA_DE_SERVICIO" | "VUELTA_A_PENDIENTE" | "SIN_CIERRE" | "ABIERTO_DE_MAS";

export interface TramoDeUso {
  id: number;
  id_maquinaria: number;
  id_orden_trabajo: number;
  numero_ot: number;
  id_otp: number;
  paso: number | null;
  proceso: string | null;
  operario: string | null;
  /** OT = la eligieron a mano en el paso; PLAN = la del último plan. */
  origen_maquina: "OT" | "PLAN";
  inicio: string;
  fin: string | null;
  en_curso: boolean;
  corrido_min: number;
  efectivo_min: number;
  suma: boolean;
  no_suma: MotivoNoSuma | null;
  no_suma_texto: string | null;
  usuario_inicio: string | null;
  usuario_fin: string | null;
}

export interface ResumenDeUso {
  efectivo_min: number;
  corrido_min: number;
  superpuesto_min: number;
  pasos: number;
  en_curso: number;
  no_suman?: number;
  fuera_de_servicio?: number;
}

export interface UsoDeMaquina {
  id_maquinaria: number;
  maquina: string;
  estado_operativo: string | null;
  periodo: { desde: string | null; hasta: string | null };
  jornada: string;
  pausas_disponibles: boolean;
  resumen: ResumenDeUso;
  recortado: boolean;
  usos: TramoDeUso[];
}

/** Lo corto del «no suma», para el cartelito del renglón. */
export const NO_SUMA_CORTO: Record<MotivoNoSuma, string> = {
  FUERA_DE_SERVICIO: "fuera de servicio",
  VUELTA_A_PENDIENTE: "volvió a pendiente",
  SIN_CIERRE: "sin cierre",
  ABIERTO_DE_MAS: "¿quedó abierto?",
};

export function origenTexto(t: Pick<TramoDeUso, "origen_maquina">): string {
  return t.origen_maquina === "OT" ? "Elegida en la OT" : "Según el plan";
}

/** Las horas para leer en la tabla: «12 h 30 min», o «—» sin dato. */
export const fmtHorasUso = (min: number | null | undefined) => (min ? fmtMinutos(min) : "—");

// ── El mantenimiento ──────────────────────────────────────────────────────────

export type EstadoMantenimiento = "sin_configurar" | "sin_base" | "al_dia" | "proximo" | "vencido";

export interface EstadoDeMantenimiento {
  estado: EstadoMantenimiento;
  estado_texto: string;
  configurado?: boolean;
  base?: string | null;
  base_origen?: "hecho" | "contar_desde" | null;
  frecuencia_dias?: number | null;
  cada_horas?: number | null;
  dias_aviso?: number;
  proxima_fecha: string | null;
  dias_restantes: number | null;
  usado_min?: number | null;
  horas_restantes_min: number | null;
  vencido_por: ("fecha" | "horas")[];
}

export interface Destinatario {
  id_usuario: number;
  nombre: string;
  /** Tapado («j•••@hotmail.com») para quien no ve «Usuarios y permisos». */
  email: string | null;
  activo?: boolean;
  recibe?: boolean;
}

export interface MantenimientoHecho {
  id: number;
  fecha: string;
  hecho_por: string | null;
  nota: string | null;
  cargado_en: string | null;
  usuario_carga: string | null;
  /** Sólo del navegador: se dibujó antes de que contestara el servidor. */
  pendiente?: boolean;
}

export interface AvisoDeMantenimiento {
  id: number;
  motivo: string;
  motivo_texto: string;
  vence: string | null;
  creado_en: string;
  email_estado: string;
  email_enviados: number;
  email_fallidos: number;
  email_detalle: string | null;
}

export interface ConfigMantenimiento {
  frecuencia_dias: number | null;
  cada_horas: number | null;
  dias_aviso: number;
  contar_desde: string | null;
  actualizado_en?: string | null;
  usuario_actualiza?: string | null;
}

export interface MantenimientoDeMaquina {
  id_maquinaria: number;
  maquina: string;
  config: ConfigMantenimiento;
  estado: EstadoDeMantenimiento;
  historial: MantenimientoHecho[];
  destinatarios: Destinatario[];
  avisos: AvisoDeMantenimiento[];
  email_configurado: boolean;
  emails_visibles: boolean;
}

/** Lo que manda la tabla de máquinas (GET /maquinarias-uso). */
export interface ResumenMaquinas {
  periodo: { desde: string | null; hasta: string | null };
  horas: Record<string, ResumenDeUso>;
  /** null = el servidor no pudo leer el mantenimiento (su tabla todavía no está). */
  mantenimiento: Record<string, Pick<EstadoDeMantenimiento,
    "estado" | "estado_texto" | "proxima_fecha" | "dias_restantes" | "vencido_por" | "horas_restantes_min">> | null;
}

export const CHIP_MANTENIMIENTO: Record<EstadoMantenimiento, string> = {
  sin_configurar: "bg-gray-100 text-gray-600 border-gray-200",
  sin_base: "bg-gray-100 text-gray-700 border-gray-300",
  al_dia: "bg-emerald-50 text-emerald-700 border-emerald-200",
  proximo: "bg-amber-50 text-amber-800 border-amber-300",
  vencido: "bg-red-50 text-red-700 border-red-200",
};

/** «Le toca el 01/10 (faltan 3 días)», «Venció el 01/10 (hace 2 días)», «Le toca hoy». */
export function cuandoLeToca(e: Pick<EstadoDeMantenimiento, "proxima_fecha" | "dias_restantes">): string | null {
  if (!e.proxima_fecha || e.dias_restantes === null || e.dias_restantes === undefined) return null;
  const d = e.dias_restantes;
  if (d === 0) return `Le toca hoy (${fechaCorta(e.proxima_fecha)})`;
  if (d < 0) return `Venció el ${fechaCorta(e.proxima_fecha)} (hace ${-d === 1 ? "1 día" : `${-d} días`})`;
  return `Le toca el ${fechaCorta(e.proxima_fecha)} (faltan ${d === 1 ? "1 día" : `${d} días`})`;
}

/** Lo corto para la tabla de máquinas: sólo lo que pide atención. */
export function chipDeLaTabla(e?: { estado: EstadoMantenimiento; proxima_fecha: string | null;
  vencido_por: ("fecha" | "horas")[] } | null): { texto: string; clase: string } | null {
  if (!e) return null;
  if (e.estado === "vencido") {
    return {
      texto: e.vencido_por.includes("fecha") || !e.vencido_por.includes("horas")
        ? "Mantenimiento vencido" : "Mantenimiento vencido (horas)",
      clase: CHIP_MANTENIMIENTO.vencido,
    };
  }
  if (e.estado === "proximo" && e.proxima_fecha) {
    return { texto: `Mantenimiento ${fechaCorta(e.proxima_fecha).slice(0, 5)}`, clase: CHIP_MANTENIMIENTO.proximo };
  }
  return null;
}

export const EMAIL_ESTADO_TEXTO: Record<string, string> = {
  PENDIENTE: "email pendiente",
  ENVIADO: "email enviado",
  PARCIAL: "email a algunos",
  FALLO: "el email no salió",
  SIN_CONFIGURAR: "sin servicio de email",
  SIN_DESTINATARIOS: "sin destinatarios",
};
