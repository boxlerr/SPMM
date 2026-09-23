import { API_URL } from '@/config';

/**
 * Un pedido a la API con el token de la sesión, para la pantalla «Usuarios y permisos».
 *
 * Nunca tira: devuelve qué pasó. `red` es que ni llegó (sin conexión); `ok` es 2xx con
 * `status` distinto de false en el cuerpo. El 401 y el 403 los atiende además el
 * interceptor de AuthContext (sesión vencida, «No tenés permiso para esto»).
 */
export interface Respuesta {
  ok: boolean;
  status: number;
  // El cuerpo tal cual vino: lo leen las funciones de lib/permisosAdmin.ts, que no le
  // creen nada sin mirarlo.
  cuerpo: unknown;
  red: boolean;
}

export async function pedir(
  ruta: string,
  opciones: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<Respuesta> {
  let token: string | null = null;
  try {
    token = localStorage.getItem('access_token');
  } catch {
    /* sin storage: el pedido va sin token y el backend contesta 401 */
  }
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opciones.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${API_URL}${ruta}`, {
      method: opciones.method ?? 'GET',
      headers,
      body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
      cache: 'no-store',
    });
    const cuerpo: unknown = await res.json().catch(() => null);
    const status = (cuerpo as { status?: unknown } | null)?.status;
    return { ok: res.ok && status !== false, status: res.status, cuerpo, red: false };
  } catch {
    return { ok: false, status: 0, cuerpo: null, red: true };
  }
}

/** El `data` de un ResponseDTO. */
export function datos(r: Respuesta): unknown {
  const c = r.cuerpo as { data?: unknown } | null;
  return c && typeof c === 'object' ? c.data : undefined;
}

/** El `message` de un ResponseDTO que salió bien (la frase que armó el servidor). */
export function mensajeOk(r: Respuesta, porDefecto: string): string {
  const c = r.cuerpo as { message?: unknown } | null;
  return c && typeof c.message === 'string' && c.message ? c.message : porDefecto;
}

/** Una fila de GET /auth/usuarios. */
export interface UsuarioFila {
  id_usuario: number;
  username: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  activo: boolean;
  fecha_creacion?: string | null;
  ultimo_login: string | null;
  // RF-26. Opcionales: el backend viejo no los manda y la tabla queda como siempre.
  /** Lo decide el servidor con su reloj, no el navegador. */
  bloqueado?: boolean;
  /** Hora local del taller, sin zona: «2026-09-22T21:04:00». */
  bloqueado_hasta?: string | null;
  intentos_fallidos?: number;
  // RF-24. True/False, o null/ausente si no se sabe (backend o base viejos): sin candado.
  admin_permanente?: boolean | null;
}

/** Un rol para elegir (de la matriz). */
export interface RolElegible {
  codigo: string;
  nombre: string;
}
