import { toast as sonner } from "sonner";
import { huboSinPermisoReciente } from "./sinPermiso";

/**
 * El `toast` de sonner, igual en todo, salvo `toast.error`: si la API acaba de contestar
 * 403, el error genérico de la pantalla («No se pudo guardar el cambio… revisá la
 * conexión») no sale, porque ya está a la vista el aviso que dice lo que pasó de verdad:
 * «No tenés permiso para esto» (lib/sinPermiso.ts).
 *
 * Se usa en vez del `toast` de "sonner" en toda la app. El <Toaster /> sigue
 * siendo el de sonner: esto sólo le pasa los avisos.
 */
type Sonner = typeof sonner;

const error: Sonner["error"] = (mensaje, datos) => {
  if (huboSinPermisoReciente()) return "";
  return sonner.error(mensaje, datos);
};

const basico = ((mensaje: Parameters<Sonner>[0], datos?: Parameters<Sonner>[1]) => sonner(mensaje, datos)) as Sonner;

export const toast: Sonner = Object.assign(basico, sonner, { error });
