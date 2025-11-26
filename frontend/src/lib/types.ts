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
}

export interface Resource {
    id: string;
    name: string;
    type: "operario" | "maquina";
    skills?: string[];
}

export interface WorkOrder {
    id: number;
    orderNumber: string;
    priority: Priority;
    status: Status;
    client: string;
    sector: string;
    subsector: string;
    quantity: number;
    materials: string[];
    notes1: string;
    delayHours: number;
    employeeAssignments: {
        id: string;
        employeeId: string;
        employeeName: string;
        process: string;
        date: string;
        startTime: string;
        endTime: string;
        totalHours: number;
        progress: number;
        notes: string;
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
}
