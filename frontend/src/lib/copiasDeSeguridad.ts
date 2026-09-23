/**
 * Copias de seguridad (RF-19): lo que la solapa calcula sin hablar con nadie.
 *
 * La solapa (components/copias/CopiasDeSeguridad.tsx) no decide nada importante: qué
 * se puede restaurar, qué tabla se toca y qué no lo decide y lo revisa el backend
 * (infrastructure/copias_de_seguridad.py). Acá sólo está cómo se muestra: los nombres
 * de lo que pasa con cada tabla, las fechas y los tamaños, y el nombre del archivo que
 * se baja. Puro y sin imports para poder compilarlo y probarlo solo
 * (backend/tests/test_copias_de_seguridad_front.py).
 */

/** Qué pasa con una tabla al restaurar (lo decide el backend en la revisión). */
export type AccionTabla = "reemplaza" | "vacia" | "conserva" | "sin_copia";
export type GrupoTabla = "datos" | "acceso" | "auditoria";

export interface CopiaAutomaticaDisponible {
  disponible: boolean;
  /** Dónde queda, en castellano: «el almacenamiento de Supabase (…)». */
  donde: string;
}

/** GET /backups/estado */
export interface EstadoCopias {
  version_formato: number;
  limite_subida_mb: number;
  copia_automatica: CopiaAutomaticaDisponible;
  minutos_descarga_manual: number;
}

export interface TablaDeLaVista {
  tabla: string;
  nombre: string;
  grupo: GrupoTabla;
  accion: AccionTabla;
  filas_actuales: number;
  /** null: la copia no trae esa tabla. */
  filas_copia: number | null;
}

/** POST /backups/revisar */
export interface VistaPrevia {
  archivo: { nombre: string; tamano: number; huella: string };
  copia: {
    generada_en: string | null;
    generada_por: string | null;
    version_formato: number | null;
    motivo: string | null;
  };
  tablas: TablaDeLaVista[];
  resumen: { tablas_que_cambian: number; filas_actuales: number; filas_copia: number };
  ignoradas: string[];
  avisos: string[];
  incluir_usuarios: boolean;
  /** Con los usuarios: qué pasa con cada cuenta que cambia, ya en castellano. */
  cambios_de_usuarios?: string[];
  /** Planos de la copia sin archivo en ningún lado, que no vuelven. */
  planos_sin_archivo?: number;
  /**
   * ¿La hizo este servidor y nadie la tocó? Sin firma, nunca con los usuarios, y los
   * datos sólo si se confirma aparte. Un backend sin firma no lo manda: vale como firmada.
   */
  firma?: { valida: boolean; motivo: string | null };
  copia_automatica: CopiaAutomaticaDisponible;
}

/** POST /backups/restauracion */
export interface ResultadoRestauracion {
  restaurada: { archivo: string; generada_en: string | null };
  tablas: { tabla: string; nombre: string; filas: number }[];
  total_filas: number;
  conservadas: string[];
  copia_previa: { nombre?: string | null; donde?: string; filas?: number } | null;
  archivos_conservados: number;
  planos_sin_archivo?: number;
  avisos: string[];
}

/** GET /backups/automaticas */
export interface CopiaAutomatica {
  nombre: string;
  tamano: number | null;
  fecha: string | null;
}

/** Lo que hay que escribir para restaurar. El servidor lo vuelve a exigir. */
export const CONFIRMACION = "RESTAURAR";

export const ACCIONES: Record<AccionTabla, { texto: string; ayuda: string; cambia: boolean }> = {
  reemplaza: {
    texto: "Vuelve a la copia",
    ayuda: "Se borra lo que hay ahora y se carga lo de la copia.",
    cambia: true,
  },
  vacia: {
    texto: "Queda vacía",
    ayuda: "Cuando se hizo la copia no existía: queda sin nada, como estaba en esa fecha.",
    cambia: true,
  },
  conserva: {
    texto: "No se toca",
    ayuda: "Queda como está ahora.",
    cambia: false,
  },
  sin_copia: {
    texto: "No se toca",
    ayuda: "La copia no la trae: queda como está ahora.",
    cambia: false,
  },
};

export function cambia(t: TablaDeLaVista): boolean {
  return ACCIONES[t.accion]?.cambia ?? false;
}

/** ¿La copia tiene la firma de este servidor? Sin el dato (backend viejo), sí. */
export function estaFirmada(vista: Pick<VistaPrevia, "firma"> | null | undefined): boolean {
  return vista?.firma?.valida !== false;
}

/**
 * Los bytes, en hexadecimal y en minúsculas: la forma en que el servidor escribe un
 * sha256. Es la «huella» del archivo que se acaba de bajar: el servidor la compara con
 * la que anotó al mandarlo, para saber que lo que tenés es ESE archivo entero.
 */
export function hexDeBytes(bytes: ArrayBuffer | Uint8Array): string {
  const vista = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = "";
  for (let i = 0; i < vista.length; i += 1) hex += vista[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * El backend las manda en el orden en que las carga (primero las que no dependen de
 * nada), que para leer no dice nada. En pantalla, por nombre.
 */
export function ordenarParaMostrar(tablas: TablaDeLaVista[]): TablaDeLaVista[] {
  return [...tablas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** ¿Lo escrito alcanza para restaurar? Igual que el servidor: sin espacios de más. */
export function confirmacionValida(texto: string): boolean {
  return texto.trim() === CONFIRMACION;
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/**
 * «2026-09-22T15:30:00» -> «22/09/2026 15:30».
 *
 * Se lee el texto tal cual y no con `new Date()`: las fechas del sistema son hora de
 * Argentina sin zona, y pasarlas por Date las corre si el navegador está en otra.
 */
export function fechaLegible(iso: string | null | undefined): string {
  const m = FECHA.exec(iso ?? "");
  if (!m) return "fecha desconocida";
  const [, a, me, d, h, mi] = m;
  return `${d}/${me}/${a} ${h}:${mi}`;
}

/** 1536 -> «1,5 KB»; 3355443 -> «3,2 MB». Con coma, como se escribe acá. */
export function tamanoLegible(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} bytes`;
  const unidades = ["KB", "MB", "GB"];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  const texto = valor >= 100 ? String(Math.round(valor)) : valor.toFixed(1).replace(".", ",");
  return `${texto} ${unidades[i]}`;
}

/** Miles con punto: 12345 -> «12.345». */
export function numero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const NOMBRE_DE_COPIA = /^spmm_backup_[0-9A-Za-z_-]+\.zip$/;

/**
 * El nombre del archivo que manda el servidor en Content-Disposition. Sólo se acepta
 * si tiene la forma de una copia (spmm_backup_….zip): cualquier otra cosa, null.
 */
export function nombreDeLaCabecera(cabecera: string | null | undefined): string | null {
  if (!cabecera) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cabecera);
  if (!m) return null;
  let nombre = m[1].trim();
  try {
    nombre = decodeURIComponent(nombre);
  } catch {
    // quedó como vino
  }
  return NOMBRE_DE_COPIA.test(nombre) ? nombre : null;
}

function dos(n: number): string {
  return String(n).padStart(2, "0");
}

/** Por si el navegador no deja leer la cabecera: el mismo nombre que arma el servidor. */
export function nombrePorDefecto(ahora: Date): string {
  const fecha = `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
  return `spmm_backup_${fecha}_${dos(ahora.getHours())}${dos(ahora.getMinutes())}.zip`;
}

/**
 * Por qué todavía no se puede apretar «Restaurar», o null si se puede. Se dice al
 * lado del botón: un botón apagado sin motivo hace que uno pruebe tres veces y se vaya.
 */
export function motivoParaNoRestaurar(opciones: {
  confirmacion: string;
  hayCopiaAutomatica: boolean;
  yaDescargo: boolean;
  /** La huella de la copia completa que se bajó desde esta pantalla (null: ninguna). */
  huellaDeLaDescarga: string | null;
  /** false: la copia no tiene la firma de este servidor. */
  firmaValida: boolean;
  /** Marcó «restaurar igual» para una copia sin firma. */
  aceptaSinFirma: boolean;
}): string | null {
  if (!opciones.firmaValida && !opciones.aceptaSinFirma) {
    return "Esta copia no tiene la firma de este servidor: si igual querés restaurarla, marcá «Restaurar igual».";
  }
  if (!opciones.hayCopiaAutomatica && !opciones.yaDescargo) {
    return "Primero descargá la copia de cómo está todo ahora y marcá la casilla.";
  }
  if (!opciones.hayCopiaAutomatica && !opciones.huellaDeLaDescarga) {
    return "Descargá la copia de cómo está todo ahora desde esta pantalla: así se comprueba que la tenés entera.";
  }
  if (!confirmacionValida(opciones.confirmacion)) {
    return `Escribí ${CONFIRMACION}, en mayúsculas, para confirmar.`;
  }
  return null;
}
