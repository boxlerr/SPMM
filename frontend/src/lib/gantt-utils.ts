import type { WorkOrder, GanttTask, Priority, PlanificacionItem } from "./types"

export const WORK_HOURS = {
  start: 9,
  end: 18,
  total: 9,
}

export const WORK_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]

export const PRIORITY_COLORS: Record<Priority, string> = {
  normal: "bg-blue-600",
  urgente: "bg-orange-500",
  critica: "bg-red-600",
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
  // Calculate Monday as the start of the week (Sunday = 0, Monday = 1)
  const daysFromMonday = currentDay === 0 ? -6 : 1 - currentDay
  const monday = new Date(today)
  monday.setDate(today.getDate() + daysFromMonday + weekOffset * 7)

  const dates: Date[] = []
  // Generate 5 days (Monday to Friday)
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
  const resourceTasks = tasks.filter((task) => task.resourceId === resourceId)

  const targetDate = new Date(date)
  const targetDateStr = formatDate(targetDate)

  return resourceTasks.reduce((total, task) => {
    // Check if task overlaps with this day
    const taskStart = new Date(`${task.startDate}T${task.startTime}`)

    // Calculate task end date based on duration if not explicitly provided or if it differs
    // For simplicity in this context, we'll rely on the task's start/end dates and times if they are consistent
    // But since we know we have issues with multi-day tasks, let's be precise.

    // However, the current data structure might have startDate and endDate.
    // Let's assume task.startDate and task.endDate are correct "YYYY-MM-DD" strings.

    if (task.startDate > targetDateStr || task.endDate < targetDateStr) {
      return total
    }

    // Calculate overlap for this specific day
    // Work hours for the day
    const workStart = new Date(`${targetDateStr}T${WORK_HOURS.start.toString().padStart(2, '0')}:00:00`)
    const workEnd = new Date(`${targetDateStr}T${WORK_HOURS.end.toString().padStart(2, '0')}:00:00`)

    // Task start/end for this specific day
    // If task starts before today, effective start is workStart
    // If task starts today, effective start is task.startTime
    let effectiveStart = workStart
    if (task.startDate === targetDateStr) {
      const [h, m] = task.startTime.split(':').map(Number)
      effectiveStart = new Date(`${targetDateStr}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`)
      if (effectiveStart < workStart) effectiveStart = workStart
    }

    // If task ends after today, effective end is workEnd
    // If task ends today, effective end is task.endTime
    let effectiveEnd = workEnd
    if (task.endDate === targetDateStr) {
      const [h, m] = task.endTime.split(':').map(Number)
      effectiveEnd = new Date(`${targetDateStr}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`)
      if (effectiveEnd > workEnd) effectiveEnd = workEnd
    }

    if (effectiveStart >= effectiveEnd) return total

    const durationMs = effectiveEnd.getTime() - effectiveStart.getTime()
    const durationHours = durationMs / (1000 * 60 * 60)

    return total + durationHours
  }, 0)
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
        resourceType: "operario" as const,
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
  data: PlanificacionItem[]
): GanttTask[] {
  const initialTasks = data.map((item) => {
    // Use creado_en as the base date, defaulting to now if missing (though it should be there)
    const baseDate = item.creado_en ? new Date(item.creado_en) : new Date();
    const normalizedBaseDate = new Date(baseDate);
    normalizedBaseDate.setHours(9, 0, 0, 0);

    const start = addWorkMinutes(normalizedBaseDate, item.inicio_min);
    const end = addWorkMinutes(normalizedBaseDate, item.fin_min);

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
      resourceType: "operario" as const,
      process: item.nombre_proceso,
      startDate,
      endDate,
      startTime,
      endTime,
      duration: Number(durationHours.toFixed(2)),
      priority: priority,
      status: "en_proceso" as const, // Default as we don't have status in PlanificacionItem yet
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

  return levelResources(initialTasks);
}

export function levelResources(tasks: GanttTask[]): GanttTask[] {
  // Group tasks by resource
  const tasksByResource: Record<string, GanttTask[]> = {};
  tasks.forEach(task => {
    if (!tasksByResource[task.resourceId]) {
      tasksByResource[task.resourceId] = [];
    }
    tasksByResource[task.resourceId].push(task);
  });

  const leveledTasks: GanttTask[] = [];

  // Process each resource
  Object.values(tasksByResource).forEach(resourceTasks => {
    // Sort tasks by their original start time (and then by ID to be deterministic)
    resourceTasks.sort((a, b) => {
      const dateA = new Date(`${a.startDate}T${a.startTime}`);
      const dateB = new Date(`${b.startDate}T${b.startTime}`);
      if (dateA.getTime() !== dateB.getTime()) {
        return dateA.getTime() - dateB.getTime();
      }
      return a.id.localeCompare(b.id);
    });

    let nextAvailableTime: Date | null = null;

    resourceTasks.forEach(task => {
      let start = new Date(`${task.startDate}T${task.startTime}`);

      // If this task starts before the previous one ends, push it forward
      if (nextAvailableTime && start < nextAvailableTime) {
        start = new Date(nextAvailableTime);
      }

      // Calculate end time based on duration (in minutes)
      // We need the original duration in minutes to be precise
      // But we only have duration in hours in the task object (and it might be rounded)
      // Ideally we should carry the duration in minutes.
      // Let's use the original duration if available, or estimate from hours.
      // In convertPlanificacionToGanttTasks we have originalInicioMin and originalFinMin.
      // We can use (originalFinMin - originalInicioMin)

      let durationMinutes = 0;
      if (task.originalFinMin !== undefined && task.originalInicioMin !== undefined) {
        durationMinutes = task.originalFinMin - task.originalInicioMin;
      } else {
        durationMinutes = task.duration * 60;
      }

      // Recalculate end time using addWorkMinutes logic (but relative to the new start)
      // Wait, addWorkMinutes adds minutes to a base date.
      // Here we have a start date and we want to add duration minutes *respecting work hours*.

      // We can reuse addWorkMinutes logic but we need to adapt it.
      // addWorkMinutes assumes we are adding to a base date.
      // Actually, addWorkMinutes logic is: given a date, add N minutes of work time.
      // So we can use a helper function `addDurationToDate`.

      const end = addDurationToDate(start, durationMinutes);

      // Update task properties
      task.startDate = formatDate(start);
      task.startTime = formatTimeFromDate(start);
      task.endDate = formatDate(end);
      task.endTime = formatTimeFromDate(end);

      // Update next available time
      nextAvailableTime = end;

      leveledTasks.push(task);
    });
  });

  return leveledTasks;
}

function addDurationToDate(startDate: Date, minutesToAdd: number): Date {
  // Similar to addWorkMinutes but starts from an arbitrary date/time

  let currentDate = new Date(startDate);
  let minutesRemaining = minutesToAdd;

  while (minutesRemaining > 0) {
    // Check if current time is within work hours
    const currentHour = currentDate.getHours();
    const currentMinute = currentDate.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    const workStartMinutes = WORK_HOURS.start * 60;
    const workEndMinutes = WORK_HOURS.end * 60;

    // If before work hours, move to start
    if (currentTotalMinutes < workStartMinutes) {
      currentDate.setHours(WORK_HOURS.start, 0, 0, 0);
      continue;
    }

    // If after work hours, move to next day start
    if (currentTotalMinutes >= workEndMinutes) {
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(WORK_HOURS.start, 0, 0, 0);
      // Skip weekends
      while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
      continue;
    }

    // We are in work hours. Calculate how much we can fit in this day.
    const minutesAvailableToday = workEndMinutes - currentTotalMinutes;

    if (minutesRemaining <= minutesAvailableToday) {
      // It fits today
      currentDate.setMinutes(currentDate.getMinutes() + minutesRemaining);
      minutesRemaining = 0;
    } else {
      // It overflows today
      // Add what we can
      // Actually, we just move to next day start and subtract what we "used"
      // But we need to advance the currentDate to end of day?
      // No, effectively the task segment ends at workEndMinutes, and resumes next day.
      // So we just subtract minutesAvailableToday from minutesRemaining
      // And set currentDate to next day start.

      minutesRemaining -= minutesAvailableToday;
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(WORK_HOURS.start, 0, 0, 0);
      // Skip weekends
      while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
  }

  return currentDate;
}

function formatTimeFromDate(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export function toTitleCase(str: string): string {
  if (!str) return ""
  return str.toLowerCase().replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
}

export function addWorkMinutes(startDate: Date, minutesToAdd: number): Date {
  // Work hours per day in minutes
  const workMinutesPerDay = (WORK_HOURS.end - WORK_HOURS.start) * 60;

  // Calculate how many full working days to add
  let daysToAdd = Math.floor(minutesToAdd / workMinutesPerDay);
  let remainingMinutes = minutesToAdd % workMinutesPerDay;

  // Calculate the new time
  // Start date is always normalized to 09:00 in our usage, but let's be safe
  // If we assume startDate is at WORK_HOURS.start (09:00)

  const resultDate = new Date(startDate);

  // Add working days, skipping weekends
  let daysAdded = 0;
  while (daysAdded < daysToAdd) {
    resultDate.setDate(resultDate.getDate() + 1);
    // If it's Saturday (6) or Sunday (0), don't count it as a work day added
    // But we still advanced the date.
    // Wait, we need to add *working* days.
    // So if we land on Sat/Sun, we just keep advancing until we hit a weekday?
    // No, simpler: loop until we have added 'daysToAdd' working days.
    const day = resultDate.getDay();
    if (day !== 0 && day !== 6) {
      daysAdded++;
    }
  }

  // Now add the remaining minutes
  // We assume the time is currently WORK_HOURS.start (09:00) because we added full days
  // But wait, resultDate still has the original time.
  // If startDate was 09:00, resultDate is 09:00.

  // Set time to start of day + remaining minutes
  resultDate.setHours(WORK_HOURS.start, 0, 0, 0);
  resultDate.setMinutes(resultDate.getMinutes() + remainingMinutes);

  // Check if we landed on a weekend after adding days (the loop handles adding *full* days)
  // But what if daysToAdd was 0? We might still be on a weekend if startDate was weekend?
  // Assuming startDate is a valid workday.

  // Also check if we overflowed the day? 
  // No, remainingMinutes < workMinutesPerDay, so we are within 09:00 - 18:00.

  // However, we need to ensure we didn't land on a weekend.
  // The loop ensures we added N working days.
  // If we started on Friday and added 1 day, we should be on Monday.
  // My loop:
  // Start Friday. daysToAdd=1.
  // Iter 1: Date becomes Saturday. Day=6. daysAdded=0.
  // Iter 2: Date becomes Sunday. Day=0. daysAdded=0.
  // Iter 3: Date becomes Monday. Day=1. daysAdded=1. Loop ends.
  // Result: Monday. Correct.

  return resultDate;
}
