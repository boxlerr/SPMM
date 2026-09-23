import { toast as sonner } from "sonner";

/**
 * El aviso de «no tenés permiso» (RF-24), uno solo para toda la app.
 *
 * Lo dispara el interceptor de fetch de AuthContext ante CUALQUIER 403 de la API: el
 * backend bloquea cada escritura que el rol no permite aunque la pantalla haya dejado
 * el botón a la vista (permisos que cambiaron recién, un botón que se escapó). Sin esto
 * cada pantalla mostraba su error de siempre —«No se pudo guardar, revisá la conexión»—,
 * que manda a buscar un problema de red que no existe.
 *
 * Por eso, además, `huboSinPermisoReciente` deja que los avisos de error genéricos de
 * las pantallas se callen unos segundos después de un 403 (lib/toast.ts y el
 * ToastProvider propio lo miran): el que explica qué pasó es este, no «Error al guardar».
 */

export const AVISO_SIN_PERMISO = "No tenés permiso para esto";

/** Cuánto dura el silencio de los errores genéricos después de un 403. */
const SILENCIO_MS = 4000;

let ultimoRechazo = 0;

/**
 * Anota que la API acaba de contestar 403. Va aparte del aviso y se llama ANTES de
 * devolverle la respuesta a la pantalla: el aviso espera a leer el cuerpo (para decir
 * qué faltó) y, si el silencio dependiera de eso, la pantalla podría llegar a mostrar su
 * error genérico antes.
 */
export function marcarSinPermiso(): void {
  ultimoRechazo = Date.now();
}

export function avisarSinPermiso(detalle?: string | null): void {
  ultimoRechazo = Date.now();
  const texto = (detalle || "").trim();
  sonner.error(AVISO_SIN_PERMISO, {
    // Un id fijo: diez pedidos rechazados juntos son UN aviso, no diez.
    id: "sin-permiso",
    description: texto && texto !== AVISO_SIN_PERMISO
      ? `${texto} Si lo necesitás, pedíselo a un administrador.`
      : "Si lo necesitás, pedíselo a un administrador.",
    duration: 6000,
  });
}

export function huboSinPermisoReciente(ms: number = SILENCIO_MS): boolean {
  return ultimoRechazo > 0 && Date.now() - ultimoRechazo < ms;
}
