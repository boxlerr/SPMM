import type { WorkOrder, GanttTask, Priority, PlanificacionItem } from "./types"

export const WORK_HOURS = {
  start: 7,
  end: 16,
  total: 9,
}

export const WORK_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]

export const PRIORITY_COLORS: Record<Priority, string> = {
  normal: "bg-primary",
  urgente: "bg-warning",
  critica: "bg-destructive",
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  normal: "Normal",
  urgente: "Urgente",
  critica: "Crítica",
}

export const STATUS_COLORS = {
  nuevo: "bg-muted",
  en_proceso: "bg-accent",
  pausado: "bg-warning",
  finalizado_parcial: "bg-chart-2",
  finalizado_total: "bg-chart-3",
}

export const STATUS_LABELS = {
  nuevo: "Nuevo",
  en_proceso: "En Proceso",
  pausado: "Pausado",
  finalizado_parcial: "Finalizado Parcial",
  finalizado_total: "Finalizado Total",
}

export const PROCESS_LABELS = {
  torneado: "Torneado",
  fresado: "Fresado",
  soldadura: "Soldadura",
  rectificado: "Rectificado",
  corte: "Corte",
  pulido: "Pulido",
}

export function getWeekDates(weekOffset = 0): Date[] {
  const today = new Date()
  const currentDay = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - currentDay + 1 + weekOffset * 7)

  const dates: Date[] = []
  for (let i = 0; i < 5; i++) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    dates.push(date)
  }
  return dates
}

export function getMonthDates(weekOffset = 0): Date[] {
  const dates: Date[] = []
  for (let week = 0; week < 4; week++) {
    dates.push(...getWeekDates(weekOffset + week))
  }
  return dates
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]
}

export function formatTime(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`
}

export function calculateResourceLoad(tasks: GanttTask[], resourceId: string, date: string): number {
  const resourceTasks = tasks.filter((task) => task.resourceId === resourceId && task.startDate === date)
  return resourceTasks.reduce((total, task) => total + task.duration, 0)
}

export function isOverloaded(load: number): boolean {
  return load > WORK_HOURS.total
}

export function convertWorkOrdersToGanttTasks(workOrders: WorkOrder[]): GanttTask[] {
  const tasks: GanttTask[] = []

  workOrders.forEach((wo) => {
    wo.employeeAssignments.forEach((assignment) => {
      tasks.push({
        id: assignment.id,
        workOrderId: wo.id,
        workOrderNumber: wo.orderNumber,
        resourceId: assignment.employeeId,
        resourceName: assignment.employeeName,
        resourceType: "operario",
        process: assignment.process,
        startDate: assignment.date,
        endDate: assignment.date,
        startTime: assignment.startTime,
        endTime: assignment.endTime,
        duration: assignment.totalHours,
        priority: wo.priority,
        status: wo.status,
        progress: assignment.progress,
        client: wo.client,
        sector: wo.sector,
        subsector: wo.subsector,
        quantity: wo.quantity,
        materials: wo.materials,
        notes: assignment.notes || wo.notes1,
        isDelayed: (wo.delayHours || 0) > 0,
      })
    })
  })

  return tasks
}

export function convertPlanificacionToGanttTasks(
  data: PlanificacionItem[],
  baseDate: Date = new Date()
): GanttTask[] {
  const normalizedBaseDate = new Date(baseDate);
  normalizedBaseDate.setHours(9, 0, 0, 0);

  return data.map((item) => {
    const start = new Date(normalizedBaseDate.getTime() + item.inicio_min * 60000);
    const end = new Date(normalizedBaseDate.getTime() + item.fin_min * 60000);

    const startDate = formatDate(start);
    const endDate = formatDate(end);
    const startTime = formatTimeFromDate(start);
    const endTime = formatTimeFromDate(end);

    const durationHours = (item.fin_min - item.inicio_min) / 60;

    // Determine priority based on weight if available, or default
    let priority: Priority = "normal";
    if (item.prioridad_peso && item.prioridad_peso > 10) priority = "urgente";
    if (item.prioridad_peso && item.prioridad_peso > 20) priority = "critica";

    return {
      id: `task-${item.orden_id}-${item.proceso_id}-${item.id}`,
      dbId: item.id,
      workOrderId: item.orden_id,
      workOrderNumber: item.orden_id.toString(),
      resourceId: item.id_operario ? item.id_operario.toString() : "unassigned",
      resourceName: item.nombre_operario ? `${item.nombre_operario} ${item.apellido_operario || ''}`.trim() : "Sin Asignar",
      resourceType: "operario",
      process: item.nombre_proceso,
      startDate,
      endDate,
      startTime,
      endTime,
      duration: Number(durationHours.toFixed(2)),
      priority: priority,
      status: "en_proceso", // Default as we don't have status in PlanificacionItem yet
      progress: 0,
      isDelayed: false,
      originalInicioMin: item.inicio_min,
      originalFinMin: item.fin_min,
      client: "Cliente Generico", // Placeholder
      sector: "Sector Generico", // Placeholder
      subsector: "Subsector Generico", // Placeholder
      quantity: 1, // Placeholder
      materials: [], // Placeholder
    };
  });
}

function formatTimeFromDate(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}
