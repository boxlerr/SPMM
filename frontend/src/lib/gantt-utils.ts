import type { WorkOrder, GanttTask, Priority, PlanificacionItem, Status } from "./types"

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
  nuevo: "Pendiente",
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
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`
}

export function calculateResourceLoad(tasks: GanttTask[], resourceId: string, date: string): number {
  const resourceTasks = tasks.filter((task) => task.resourceId === resourceId)

  const targetDateStr = date

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
    // console.log(`Task ${item.id}: creado_en=${item.creado_en}, baseDate=${baseDate}, inicio_min=${item.inicio_min}`);
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

    const task = {
      id: `task-${item.orden_id}-${item.proceso_id}-${item.id}`,
      dbId: item.id,
      workOrderId: item.orden_id,
      workOrderNumber: item.orden_id.toString(),
      resourceId: (() => {
        const rid = item.id_operario ? item.id_operario.toString() : "unassigned";
        return rid;
      })(),
      resourceName: item.nombre_operario ? `${item.nombre_operario} ${item.apellido_operario || ''}`.trim() : "Sin Asignar",
      resourceType: "operario" as const,
      process: item.nombre_proceso,
      startDate: startDate,
      endDate: endDate,
      startTime: startTime,
      endTime: endTime,
      duration: Number(((item.fin_min - item.inicio_min) / 60).toFixed(2)),
      originalInicioMin: item.inicio_min,
      originalFinMin: item.fin_min,
      notes: item.observaciones_proceso || item.observaciones_ot || "",
      progress: item.id_estado === 3 ? 100 : item.id_estado === 2 ? 50 : 0,
      status: (item.id_estado === 3 ? "finalizado_total" : item.id_estado === 2 ? "en_proceso" : "nuevo") as Status,
      dependencies: [],
      priority: priority,
      isDelayed: false,
      allowedRanges: item.rangos_permitidos || [],
    };

    console.log(`Converted Task ${task.id}: resourceId=${task.resourceId}, start=${task.startDate} ${task.startTime}`);
    return task;
  });

  return levelResources(initialTasks);
}

function levelResources(tasks: GanttTask[]): GanttTask[] {
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

      // Clamp start time to work hours
      const startHour = start.getHours();
      if (startHour < WORK_HOURS.start) {
        start.setHours(WORK_HOURS.start, 0, 0, 0);
      } else if (startHour >= WORK_HOURS.end) {
        start.setDate(start.getDate() + 1);
        start.setHours(WORK_HOURS.start, 0, 0, 0);
      }

      // Ensure start is on a working day
      while (start.getDay() === 0 || start.getDay() === 6) {
        start.setDate(start.getDate() + 1);
        start.setHours(WORK_HOURS.start, 0, 0, 0);
      }

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

  const resultDate = new Date(startDate);

  if (minutesToAdd >= 0) {
    // Positive addition (forward in time)
    let daysToAdd = Math.floor(minutesToAdd / workMinutesPerDay);
    let remainingMinutes = minutesToAdd % workMinutesPerDay;

    // Add working days
    let daysAdded = 0;
    while (daysAdded < daysToAdd) {
      resultDate.setDate(resultDate.getDate() + 1);
      const day = resultDate.getDay();
      if (day !== 0 && day !== 6) {
        daysAdded++;
      }
    }

    // Add remaining minutes
    resultDate.setHours(WORK_HOURS.start, 0, 0, 0);
    resultDate.setMinutes(resultDate.getMinutes() + remainingMinutes);

    return resultDate;
  } else {
    // Negative addition (backward in time)
    let minutesToSubtract = Math.abs(minutesToAdd);
    let daysToSubtract = Math.floor(minutesToSubtract / workMinutesPerDay);
    let remainingMinutesToSubtract = minutesToSubtract % workMinutesPerDay;

    // Subtract working days
    let daysSubtracted = 0;
    while (daysSubtracted < daysToSubtract) {
      resultDate.setDate(resultDate.getDate() - 1);
      const day = resultDate.getDay();
      if (day !== 0 && day !== 6) {
        daysSubtracted++;
      }
    }

    // Subtract remaining minutes
    // We assume we are starting from 09:00 (start of day) effectively
    // So subtracting minutes means going to previous day's end
    // Wait, the logic for positive was: set to 09:00 + remaining.
    // For negative, we should set to 18:00 - remaining?
    // If we are at 09:00 (normalized base), and we subtract 1 minute.
    // We should go to previous working day 17:59.

    // Let's simplify:
    // 1. Move back N full days.
    // 2. Move back remaining minutes from 09:00? No, from 09:00 of the *current* day?
    // If we are at 09:00, and subtract 10 mins.
    // We go to previous day 17:50.

    // So, first subtract full days.
    // Then subtract remaining minutes.

    // If we are at 09:00.
    // Subtract remainingMinutesToSubtract.
    // We need to wrap to previous day.

    // Actually, let's just use a loop for the remaining minutes part to be safe.

    // But wait, the positive logic sets time to 09:00 + remaining.
    // This implies the base date is always 09:00.
    // So for negative:
    // 18:00 - remaining?

    // Example: -60 mins.
    // 18:00 - 60 = 17:00.
    // If -540 mins (9 hours).
    // 18:00 - 540 = 09:00.

    // So yes, set to 18:00 and subtract remaining.

    // But we need to ensure we are on a working day.
    // If we just subtracted days, we might be on a weekend?
    // The loop ensures we land on a weekday (or we skipped weekends).
    // But wait, if we land on Monday 09:00.
    // And we need to subtract 1 minute.
    // We should go to Friday 17:59.

    // So:
    // 1. Subtract full days.
    // 2. If remaining > 0:
    //    Move back 1 more day (skipping weekends).
    //    Set time to 18:00 - remaining.

    if (remainingMinutesToSubtract > 0) {
      // Move back 1 day to start subtracting from its end
      resultDate.setDate(resultDate.getDate() - 1);
      while (resultDate.getDay() === 0 || resultDate.getDay() === 6) {
        resultDate.setDate(resultDate.getDate() - 1);
      }
      resultDate.setHours(WORK_HOURS.end, 0, 0, 0);
      resultDate.setMinutes(resultDate.getMinutes() - remainingMinutesToSubtract);
    } else {
      // Exact day boundary, set to 09:00
      resultDate.setHours(WORK_HOURS.start, 0, 0, 0);
    }

    return resultDate;
  }
}

export function calculateWorkingMinutes(startDate: Date, endDate: Date): number {
  // console.log("calculateWorkingMinutes input:", startDate.toISOString(), endDate.toISOString());
  let isNegative = false;
  let start = new Date(startDate);
  let end = new Date(endDate);

  if (start > end) {
    isNegative = true;
    // Swap
    const temp = start;
    start = end;
    end = temp;
  }

  let current = new Date(start);
  let totalMinutes = 0;

  const target = new Date(end);

  while (current < target) {
    const currentDay = current.getDay();
    const isWeekend = currentDay === 0 || currentDay === 6;

    // If weekend, skip to next Monday 09:00
    if (isWeekend) {
      current.setDate(current.getDate() + 1);
      current.setHours(WORK_HOURS.start, 0, 0, 0);
      continue;
    }

    // Current is a workday.
    // Determine the end of the work day for current
    const workStart = new Date(current);
    workStart.setHours(WORK_HOURS.start, 0, 0, 0);

    const workEnd = new Date(current);
    workEnd.setHours(WORK_HOURS.end, 0, 0, 0);

    // If current is before work start, move to work start
    if (current < workStart) {
      current = new Date(workStart);
    }

    // If current is after work end, move to next day
    if (current >= workEnd) {
      current.setDate(current.getDate() + 1);
      current.setHours(WORK_HOURS.start, 0, 0, 0);
      continue;
    }

    // Now current is within work hours (or at start).
    // Determine how much we can add today.
    // We stop at either workEnd or target.

    let nextStop = new Date(workEnd);
    if (target < nextStop) {
      nextStop = new Date(target);
    }

    // Add difference
    const diffMs = nextStop.getTime() - current.getTime();
    if (diffMs > 0) {
      totalMinutes += Math.floor(diffMs / 60000);
    }

    // Advance current
    current = new Date(nextStop);

    // If we reached workEnd, move to next day start to avoid infinite loop if target is far
    if (current.getTime() === workEnd.getTime()) {
      current.setDate(current.getDate() + 1);
      current.setHours(WORK_HOURS.start, 0, 0, 0);
    }
  }

  return isNegative ? -totalMinutes : totalMinutes;
}

export const isOperatorQualified = (operatorRanges: number[], allowedRanges: number[] | string | any[]): boolean => {
  let parsedAllowed: number[] = [];

  if (Array.isArray(allowedRanges)) {
    // Check if it's an array of strings like ["4, 10"] or ["4", "10"]
    if (allowedRanges.length > 0 && typeof allowedRanges[0] === 'string') {
      const first = allowedRanges[0] as string;
      if (first.trim().startsWith('[')) {
        try {
          parsedAllowed = JSON.parse(first);
        } catch { parsedAllowed = []; }
      } else {
        // Assume ["4", "10"]
        parsedAllowed = allowedRanges.map(r => parseInt(r as string, 10)).filter(n => !isNaN(n));
      }
    } else {
      parsedAllowed = allowedRanges as number[];
    }
  } else if (typeof allowedRanges === 'string') {
    try {
      parsedAllowed = JSON.parse(allowedRanges);
    } catch (e) {
      console.error("Error parsing allowedRanges string:", allowedRanges);
      parsedAllowed = [];
    }
  } else {
    // If null/undefined, return true (no restrictions)
    return true;
  }

  if (!Array.isArray(parsedAllowed) || parsedAllowed.length === 0) return true; // No restrictions
  if (!Array.isArray(operatorRanges) || operatorRanges.length === 0) return false; // Operator has no skills

  return parsedAllowed.some(r => operatorRanges.includes(r));
};
