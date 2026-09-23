/**
 * Las pausas de las OT (RF-03): tipos, motivos y lo que está pausado ahora.
 *
 * Las reglas son del backend (application/PausaService.py): qué se puede pausar, qué no,
 * quién y cuándo. Acá sólo se pide, se pinta y se avisa.
 *
 * LO QUE ESTÁ PAUSADO AHORA vive en UN lugar para toda la pantalla: las listas de
 * Operaciones (el cartel de «Pausada»), la ficha de la OT y el planificador lo leen del
 * mismo store. Una sola llamada a `/ordenes-pausadas`, y cuando alguien pausa o reanuda
 * desde la ficha, el cartel de la lista cambia en el momento sin volver a pedir nada.
 *
 * Con un backend de antes de RF-03 (se deploya a mano y puede ir atrás del front), la
 * ruta no existe: el store queda en «no» y todo lo de pausas se oculta.
 */
import { useEffect, useSyncExternalStore } from "react";

import { API_URL } from "@/config";
import { parseApiError } from "@/lib/utils";

export type MotivoPausa = "FALTA_MATERIAL" | "MAQUINA_ROTA" | "ESPERA_CLIENTE" | "CAMBIO_PRIORIDAD" | "OTRO";

/** Los mismos de domain/PausaOrden.py (el backend los valida igual). */
export const MOTIVOS_PAUSA: { codigo: MotivoPausa; texto: string }[] = [
  { codigo: "FALTA_MATERIAL", texto: "Falta material" },
  { codigo: "MAQUINA_ROTA", texto: "Máquina rota" },
  { codigo: "ESPERA_CLIENTE", texto: "Espera del cliente" },
  { codigo: "CAMBIO_PRIORIDAD", texto: "Cambió la prioridad" },
  { codigo: "OTRO", texto: "Otro" },
];

export interface Pausa {
  id: number;
  id_orden_trabajo: number;
  /** El número que conoce el taller (id_otvieja). */
  numero_ot: number;
  alcance: "ot" | "paso";
  id_otp: number | null;
  paso: number | null;
  nombre_proceso: string | null;
  motivo: string;
  motivo_texto: string;
  observacion: string | null;
  /** Sin zona: hora del taller. */
  desde: string;
  hasta: string | null;
  abierta: boolean;
  cierre: string | null;
  cierre_texto: string | null;
  usuario_pausa: string | null;
  usuario_reanuda: string | null;
  /** Lo que duró, o lo que lleva si sigue abierta. */
  minutos: number;
  /** Sólo al pausar la OT entera: los pasos que estaban en proceso (siguen en proceso). */
  pasos_en_proceso?: number[];
  /** Sólo al reanudar la OT: los pasos que tienen su propia pausa y siguen parados. */
  pasos_que_siguen_pausados?: number[];
  /** Sólo del navegador: se dibujó antes de que contestara el servidor. */
  pendiente?: boolean;
}

export const cabecerasPausas = (json = false): HeadersInit => {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (typeof window === "undefined") return h;
  const token = localStorage.getItem("access_token");
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
};

async function motivoDelError(res: Response): Promise<string> {
  const motivo = parseApiError(await res.text().catch(() => ""));
  return motivo || `El servidor contestó ${res.status}`;
}

/** «la OT» / «el paso 3 — Torno CNC». */
export function queSePauso(p: Pick<Pausa, "alcance" | "paso" | "nombre_proceso">): string {
  if (p.alcance === "ot") return "la OT";
  const paso = p.paso != null ? `el paso ${p.paso}` : "un paso";
  return p.nombre_proceso ? `${paso} — ${p.nombre_proceso}` : paso;
}

// ── Lo que está pausado ahora (el store) ─────────────────────────────────────

export type EstadoPausas = "cargando" | "si" | "no";

interface Foto {
  estado: EstadoPausas;
  /** Las pausas abiertas de cada OT (por id interno). */
  porOt: ReadonlyMap<number, Pausa[]>;
}

const VACIA: Foto = { estado: "cargando", porOt: new Map() };
let foto: Foto = VACIA;
let pedidoEnCurso: Promise<void> | null = null;
let pedidoEn = 0;
const oyentes = new Set<() => void>();

// Cada cuánto se vuelve a preguntar cuando una lista se monta de nuevo. No hay aviso en
// vivo desde el servidor: lo que pausa otra persona aparece al volver a la pantalla.
const VIGENCIA_MS = 60_000;

function publicar(nueva: Foto) {
  foto = nueva;
  oyentes.forEach((o) => o());
}

function agrupar(lista: Pausa[]): Map<number, Pausa[]> {
  const porOt = new Map<number, Pausa[]>();
  for (const p of lista) {
    if (!p?.abierta) continue;
    const de = porOt.get(p.id_orden_trabajo) ?? [];
    de.push(p);
    porOt.set(p.id_orden_trabajo, de);
  }
  return porOt;
}

/** Vuelve a pedir lo pausado. Una sola llamada a la vez para toda la pantalla. */
export function refrescarPausas(): Promise<void> {
  if (pedidoEnCurso) return pedidoEnCurso;
  pedidoEn = Date.now();
  pedidoEnCurso = (async () => {
    try {
      const res = await fetch(`${API_URL}/ordenes-pausadas`, { headers: cabecerasPausas() });
      // 404/405: backend de antes de RF-03. 401/403: sin sesión o sin permiso (de eso se
      // encarga el resto de la app). En los dos casos, como si no existiera.
      if ([401, 403, 404, 405].includes(res.status)) {
        publicar({ estado: "no", porOt: new Map() });
        return;
      }
      if (!res.ok) return; // se queda con lo que tenía
      const body = await res.json().catch(() => null);
      const lista = body && typeof body === "object" && "data" in body ? body.data : body;
      if (!Array.isArray(lista)) return;
      publicar({ estado: "si", porOt: agrupar(lista as Pausa[]) });
    } catch {
      // Sin red: se queda con lo que tenía.
    } finally {
      pedidoEnCurso = null;
    }
  })();
  return pedidoEnCurso;
}

/** Una pausa que se acaba de abrir o cerrar desde la pantalla: el cartel cambia ya. */
export function aplicarPausa(p: Pausa) {
  if (foto.estado === "no") return;
  const porOt = new Map(foto.porOt);
  const otras = (porOt.get(p.id_orden_trabajo) ?? []).filter((x) => x.id !== p.id);
  const quedan = p.abierta ? [...otras, p] : otras;
  if (quedan.length) porOt.set(p.id_orden_trabajo, quedan);
  else porOt.delete(p.id_orden_trabajo);
  publicar({ estado: "si", porOt });
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

/** Lo pausado ahora. La primera lista que lo usa lo pide; después, cada un minuto. */
export function usePausasActivas(): Foto {
  const actual = useSyncExternalStore(suscribir, () => foto, () => VACIA);
  useEffect(() => {
    if (foto.estado === "no") return;
    if (!pedidoEn || Date.now() - pedidoEn > VIGENCIA_MS) void refrescarPausas();
  }, []);
  return actual;
}

// ── Pausar y reanudar ────────────────────────────────────────────────────────

export async function pausar(idOrden: number, cuerpo: {
  motivo: MotivoPausa; observacion: string | null; id_otp: number | null;
}): Promise<Pausa> {
  const res = await fetch(`${API_URL}/ordenes/${idOrden}/pausar`, {
    method: "POST",
    headers: cabecerasPausas(true),
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(await motivoDelError(res));
  const body = await res.json();
  const p = body?.data as Pausa | undefined;
  if (!p || typeof p.id !== "number") throw new Error("Respuesta inesperada del servidor");
  return p;
}

export async function reanudar(idOrden: number, idOtp: number | null): Promise<Pausa> {
  const res = await fetch(`${API_URL}/ordenes/${idOrden}/reanudar`, {
    method: "POST",
    headers: cabecerasPausas(true),
    body: JSON.stringify({ id_otp: idOtp }),
  });
  if (!res.ok) throw new Error(await motivoDelError(res));
  const body = await res.json();
  const p = body?.data as Pausa | undefined;
  if (!p || typeof p.id !== "number") throw new Error("Respuesta inesperada del servidor");
  return p;
}

/** «Los pasos 2 y 3», «El paso 2». */
export function listaDePasos(pasos: number[]): string {
  if (pasos.length === 1) return `el paso ${pasos[0]}`;
  return `los pasos ${pasos.slice(0, -1).join(", ")} y ${pasos[pasos.length - 1]}`;
}
