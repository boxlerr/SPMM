/**
 * Lo que se está armando en el armador de reportes, SIN la parte visual del armador.
 *
 * Separado de ArmadorDeReportes.tsx a propósito (20/10/2026): el bloque del Dashboard
 * (BloqueReportes) necesita esto desde que se abre la pantalla, pero el armador —un modal
 * con sus pasos y su vista previa— recién al tocar «Armar un reporte». En el mismo archivo,
 * importar estas cuatro cosas traía el armador entero al JavaScript inicial del Dashboard.
 * ArmadorDeReportes.tsx las reexporta.
 */
import { completarReceta, type ConfigReporte, type Ejemplo, type ReporteGuardado } from "@/lib/reportes";

/** Lo que se está armando. Vive en el bloque del Dashboard: cerrar y volver a abrir sigue
 *  donde estaba. */
export interface TrabajoDeReporte {
    receta: ConfigReporte | null;
    nombre: string;
    descripcion: string;
    compartido: boolean;
    /** El guardado que se está editando (si es propio, «Guardar» lo pisa). */
    guardadoId: number | null;
    /** Para saber si hay cambios sin guardar. */
    base: { receta: ConfigReporte | null; nombre: string } | null;
}

export const TRABAJO_VACIO: TrabajoDeReporte = {
    receta: null, nombre: "", descripcion: "", compartido: false, guardadoId: null, base: null,
};

export function trabajoDesdeGuardado(g: ReporteGuardado): TrabajoDeReporte {
    const receta = g.config ? completarReceta(g.config) : null;
    return {
        receta,
        nombre: g.nombre,
        descripcion: g.descripcion ?? "",
        compartido: g.compartido,
        guardadoId: g.es_mio ? g.id : null,
        base: { receta, nombre: g.nombre },
    };
}

export function trabajoDesdeEjemplo(e: Ejemplo): TrabajoDeReporte {
    return { ...TRABAJO_VACIO, receta: completarReceta(e.config), nombre: e.nombre, descripcion: e.descripcion };
}

export type EstadoCatalogo = "cargando" | "listo" | "viejo" | "error";
