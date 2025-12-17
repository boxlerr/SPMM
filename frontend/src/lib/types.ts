export type Priority = 'normal' | 'urgente' | 'critica';
export type Status = 'nuevo' | 'en_proceso' | 'pausado' | 'finalizado_parcial' | 'finalizado_total';

export interface GanttTask {
    id: string;
    workOrderId: number;
    workOrderNumber: string;
    resourceId: string;
    resourceName: string;
    resourceType: "operario" | "maquina";
    process: string;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    startTime: string; // HH:MM
    endTime: string; // HH:MM
    duration: number; // hours
    priority: Priority;
    status: Status;
    progress: number;
    client?: string;
    sector?: string;
    subsector?: string;
    quantity?: number;
    materials?: string[];
    notes?: string;
    isDelayed: boolean;
    // Original fields for reference/updates
    originalInicioMin?: number;
    originalFinMin?: number;
    dbId?: number;
    allowedRanges?: number[];
}

export interface Resource {
    id: string;
    name: string;
    type: "operario" | "maquina";
    skills?: string[];
    ranges?: number[];
}

export interface WorkOrder {
    id: number;
    id_otvieja?: number;
    observaciones?: string;
    id_prioridad?: number;
    id_sector?: number;
    id_articulo?: number;
    unidades?: number;
    fecha_orden?: string;
    fecha_entrada?: string;
    fecha_prometida?: string;
    fecha_entrega?: string;

    prioridad?: {
        id?: number;
        descripcion?: string;
    };
    sector?: {
        id?: number;
        nombre?: string;
    };
    cliente?: {
        id?: number;
        nombre?: string;
    };
    articulo?: {
        id?: number;
        cod_articulo?: string;
        descripcion?: string;
    };
    procesos: {
        orden: number;
        tiempo_proceso: number;
        observaciones?: string;
        proceso: {
            id: number;
            nombre: string;
            descripcion?: string;
        };
        estado_proceso: {
            id: number;
            descripcion: string;
        };
        operario_nombre?: string;
        inicio_real?: string;
        fin_real?: string;
    }[];
}

export interface PlanificacionItem {
    id: number;
    orden_id: number;
    proceso_id: number;
    nombre_proceso: string;
    inicio_min: number;
    fin_min: number;
    creado_en: string;
    id_operario?: number;
    id_maquinaria?: number;
    nombre_maquinaria?: string;
    nombre_operario?: string;
    apellido_operario?: string;
    fecha_prometida?: string;
    prioridad_peso?: number;
    cod_articulo?: string;
    descripcion_articulo?: string;
    abreviatura_articulo?: string;
    observaciones_ot?: string;
    estado?: string;
    id_estado?: number;
    observaciones_proceso?: string;
    rangos_permitidos?: number[];
    fecha_entrada?: string;
    id_prioridad?: number;
    id_articulo?: number;
    cantidad?: number;
    sector?: string;
    pedido_externo?: number | string;
    cliente?: string;
    id_planificacion_lote?: string;
    descripcion_lote?: string;
    inicio_real?: string;
    fin_real?: string;
}
