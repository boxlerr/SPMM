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
    articulo: string
    fecha_entrega: string | null
    estado: string
    sector: string
    cantidad: number
}

export interface OrdenEstado {
    id: number
    articulo: string
    fecha_entrega: string | null
    estado: string
    sector: string
    cliente: string
    prioridad: string
    cantidad: number
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
