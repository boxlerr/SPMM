// Shared TypeScript interfaces for dashboard components

export interface EstadisticasOrdenes {
    completadas: number
    en_proceso: number
    pendientes: number
    retrasadas: number
    porcentaje_completadas: number
    porcentaje_en_proceso: number
    porcentaje_pendientes: number
    porcentaje_retrasadas: number
}

export interface OrdenCritica {
    id: number
    /** El N° de OT con el que la conoce el taller (id_otvieja). `id` es la clave interna.
     *  Lo manda el backend desde RF-02; con el viejo no viene y se muestra `id`. */
    numero?: number
    articulo: string
    fecha_entrega: string | null
    dias_restantes: number
    prioridad: string
    estado: string
}


export interface TimelineItem {
    fecha: string
    ordenes: number
}

export interface TopCliente {
    cliente: string
    cantidad: number
}

export interface DistribucionPrioridad {
    prioridad: string
    cantidad: number
    porcentaje: number
}

export interface TiempoPromedio {
    dias: number
    horas: number
}

export interface TopArticulo {
    articulo: string
    cantidad: number
}

export interface OrdenPrioridad {
    id: number
    numero?: number
    articulo: string
    fecha_entrega: string | null
    estado: string
    sector: string
    /** null = la OT no tiene las unidades cargadas (antes el backend inventaba un 1). */
    cantidad: number | null
}

export interface OrdenEstado {
    id: number
    numero?: number
    articulo: string // Now used as Description
    cod_articulo?: string
    fecha_entrada?: string | null
    fecha_entrega: string | null
    fecha_prometida?: string | null
    estado: string
    /** completadas | en_curso | pendientes | retrasadas (backend de RF-02 en adelante). */
    estado_codigo?: string
    sector: string
    cliente: string
    prioridad: string
    cantidad: number | null
    proceso_actual?: string
    procesos_totales?: number

    procesos_pendientes?: number
}

export interface ProcesoUtilizado {
    proceso: string
    cantidad: number
}

export interface OcupacionSector {
    sector: string
    porcentaje: number
    ordenes_activas: number
}
