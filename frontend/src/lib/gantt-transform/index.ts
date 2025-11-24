import { Task } from "gantt-task-react";
import { getProcessColor } from "../gantt-utils";

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
}

export interface Operario {
    id: number;
    nombre: string;
    apellido: string;
}

export const calculateCargas = (planificacionItems: PlanificacionItem[]) => {
    const map: Record<string, { totalMinutos: number; porcentaje: number }> = {};
    const horasTrabajo = 8 * 60;

    const minutosPorOperario: Record<string, number> = {};

    planificacionItems.forEach((item) => {
        const opId = item.id_operario ? `op-${item.id_operario}` : "op-none";
        const duracion = item.fin_min - item.inicio_min;
        minutosPorOperario[opId] = (minutosPorOperario[opId] || 0) + duracion;
    });

    Object.keys(minutosPorOperario).forEach((opId) => {
        const totalMinutos = minutosPorOperario[opId];
        const porcentaje = Math.min((totalMinutos / horasTrabajo) * 100, 100);
        map[opId] = { totalMinutos, porcentaje };
    });

    return map;
};

export const transformToGanttTasks = (
    data: PlanificacionItem[],
    baseDate: Date = new Date()
): { tasks: Task[]; startDate: Date } => {
    if (data.length === 0) {
        return { tasks: [], startDate: new Date() };
    }

    // Normalizar baseDate a las 9:00 AM si no se pasa una específica
    const normalizedBaseDate = new Date(baseDate);
    normalizedBaseDate.setHours(9, 0, 0, 0);

    const operariosMap = new Map<string, { id: string; name: string }>();

    data.forEach((item) => {
        const opId = item.id_operario ? `op-${item.id_operario}` : "op-none";
        let opName = "Sin Operario Asignado";
        if (item.nombre_operario) {
            opName = `${item.nombre_operario} ${item.apellido_operario || ""}`.trim();
        }

        if (!operariosMap.has(opId)) {
            operariosMap.set(opId, { id: opId, name: opName });
        }
    });

    const operarios = Array.from(operariosMap.values()).sort((a, b) => {
        if (a.id === "op-none") return 1;
        if (b.id === "op-none") return -1;
        return a.name.localeCompare(b.name);
    });

    const ganttTasks: Task[] = [];

    operarios.forEach((op) => {
        ganttTasks.push({
            start: normalizedBaseDate,
            end: normalizedBaseDate,
            name: "",
            id: op.id,
            type: "project",
            progress: 0,
            isDisabled: true,
            hideChildren: true,
            styles: {
                backgroundColor: "#f3f4f6",
                backgroundSelectedColor: "#e5e7eb",
                progressColor: "#f3f4f6",
                progressSelectedColor: "#e5e7eb",
            },
        });

        const tareasOperario = data.filter((item) => {
            const itemOpId = item.id_operario ? `op-${item.id_operario}` : "op-none";
            return itemOpId === op.id;
        });

        tareasOperario.forEach((item, index) => {
            const originalStart = new Date(
                normalizedBaseDate.getTime() + item.inicio_min * 60000
            );

            const start = new Date(originalStart);
            start.setHours(0, 0, 0, 0);

            const end = new Date(start);
            end.setTime(start.getTime() + 24 * 60 * 60 * 1000 - 1000);

            const color = getProcessColor(item.nombre_proceso || "default");

            ganttTasks.push({
                start: start,
                end: end,
                name: `${item.nombre_proceso || "Proceso"} (OT: ${item.orden_id})`,
                id: `task-${item.orden_id}-${item.proceso_id}-${index}-${item.id}`,
                type: "task",
                project: op.id,
                progress: 0,
                isDisabled: false,
                styles: {
                    progressColor: color,
                    progressSelectedColor: color,
                    backgroundColor: color,
                    backgroundSelectedColor: color,
                },
            });
        });
    });

    let minDate = new Date();
    if (ganttTasks.length > 0) {
        minDate = ganttTasks.reduce(
            (min, t) => (t.start < min ? t.start : min),
            ganttTasks[0].start
        );
    } else {
        minDate = normalizedBaseDate;
    }

    return { tasks: ganttTasks, startDate: minDate };
};
