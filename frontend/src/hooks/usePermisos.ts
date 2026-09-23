"use client";

import { useAuth } from "@/contexts/AuthContext";

/**
 * Los permisos de quien está usando la app (RF-24), para decidir qué mostrar.
 *
 *     const { puede, puedeSeccion } = usePermisos();
 *     const puedeEditar = puedeSeccion("operaciones_ordenes", "write");
 *     {puedeEditar && <Button>Nueva orden</Button>}
 *
 * - `puede(area, nivel = "read")` y `puedeSeccion(seccion, nivel = "read")` son hasArea
 *   y hasSeccion de Don Joaquín. Los niveles: none < read < write < admin.
 * - Sin permisos (el backend todavía no los manda) todo da `true`: la pantalla se
 *   comporta como antes de RF-24. Nunca se esconde todo porque falte un campo.
 * - Esconder un botón es comodidad: el que bloquea es el backend (403). Si algo se
 *   escapa, el aviso «No tenés permiso para esto» sale solo (AuthContext).
 *
 * La lógica pura vive en lib/permisos.ts, que es lo que se prueba.
 */
export function usePermisos() {
  const { permisos, puede, puedeSeccion, rutaDeInicio, refrescarPermisos } = useAuth();
  return {
    permisos,
    puede,
    puedeSeccion,
    rutaDeInicio,
    refrescarPermisos,
    /** Admin, o sin permisos (backend viejo): puede todo. */
    esAdmin: !permisos || permisos.es_admin,
  };
}
