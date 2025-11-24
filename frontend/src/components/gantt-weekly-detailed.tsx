"use client"

import type React from "react"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, User, Wrench, Calendar } from "lucide-react"
import type { GanttTask, Resource } from "@/lib/types"
import {
  WORK_HOURS,
  WORK_DAYS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  PROCESS_LABELS,
  getWeekDates,
  formatDate,
  formatTime,
  calculateResourceLoad,
  isOverloaded,
} from "@/lib/gantt-utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface GanttWeeklyDetailedProps {
  tasks: GanttTask[]
  resources: Resource[]
  viewMode: "operario" | "maquina"
  onTaskMove?: (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => void
  onTaskClick?: (task: GanttTask) => void
}

export function GanttWeeklyDetailed({ tasks, resources, viewMode, onTaskMove, onTaskClick }: GanttWeeklyDetailedProps) {
  const [currentWeek, setCurrentWeek] = useState(0)
  const [draggedTask, setDraggedTask] = useState<string | null>(null)

  const weekDates = getWeekDates(currentWeek)
  const filteredResources = resources.filter((r) => r.type === viewMode)

  const hours = Array.from({ length: WORK_HOURS.total }, (_, i) => WORK_HOURS.start + i)

  const getTasksForCell = (resourceId: string, date: string, hour: number) => {
    return tasks.filter((task) => {
      if (task.resourceId !== resourceId || task.startDate !== date) return false
      const taskStartHour = Number.parseInt(task.startTime.split(":")[0])
      const taskEndHour = Number.parseInt(task.endTime.split(":")[0])
      return hour >= taskStartHour && hour < taskEndHour
    })
  }

  const handleDragStart = (taskId: string) => {
    setDraggedTask(taskId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (resourceId: string, date: string, hour: number) => {
    if (draggedTask && onTaskMove) {
      const task = tasks.find((t) => t.id === draggedTask)
      if (task) {
        const newStartTime = formatTime(hour)
        onTaskMove(draggedTask, resourceId, date, newStartTime)
      }
    }
    setDraggedTask(null)
  }

  const firstDate = weekDates[0]
  const lastDate = weekDates[4]

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-bold text-foreground">
            Vista Semanal Detallada - {viewMode === "operario" ? "Por Operario" : "Por Máquina"}
          </h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCurrentWeek((prev) => prev - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex flex-col items-center px-3">
              <span className="text-sm font-medium">
                {currentWeek === 0 ? "Semana Actual" : `Semana ${currentWeek > 0 ? "+" : ""}${currentWeek}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {firstDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} -{" "}
                {lastDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCurrentWeek((prev) => prev + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {currentWeek !== 0 && (
              <Button variant="secondary" size="sm" onClick={() => setCurrentWeek(0)}>
                <Calendar className="h-4 w-4 mr-1" />
                Hoy
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Turno: 07:00 - 16:00</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1200px]">
          {/* Header con días */}
          <div className="grid grid-cols-[200px_repeat(5,1fr)] gap-px bg-border mb-px">
            <div className="bg-primary text-primary-foreground p-3 font-semibold">
              {viewMode === "operario" ? "Operario" : "Máquina"}
            </div>
            {weekDates.map((date, idx) => (
              <div key={idx} className="bg-primary text-primary-foreground p-3 text-center">
                <div className="font-semibold">{WORK_DAYS[idx]}</div>
                <div className="text-xs opacity-90">
                  {date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                </div>
              </div>
            ))}
          </div>

          {/* Filas de recursos */}
          {filteredResources.map((resource) => (
            <div key={resource.id} className="mb-4">
              <div className="grid grid-cols-[200px_repeat(5,1fr)] gap-px bg-border">
                {/* Nombre del recurso */}
                <div className="bg-card p-3 flex items-center gap-2 border-r-2 border-primary">
                  {viewMode === "operario" ? (
                    <User className="h-4 w-4 text-primary" />
                  ) : (
                    <Wrench className="h-4 w-4 text-primary" />
                  )}
                  <div>
                    <div className="font-semibold text-sm">{resource.name}</div>
                    {resource.skills && (
                      <div className="text-xs text-muted-foreground">
                        {resource.skills.map((s) => PROCESS_LABELS[s]).join(", ")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Días */}
                {weekDates.map((date, dayIdx) => {
                  const dateStr = formatDate(date)
                  const load = calculateResourceLoad(tasks, resource.id, dateStr)
                  const overloaded = isOverloaded(load)

                  return (
                    <div key={dayIdx} className="bg-card">
                      {/* Indicador de carga */}
                      <div className={`h-1 ${overloaded ? "bg-destructive" : load > 0 ? "bg-accent" : "bg-muted"}`} />

                      {/* Grid de horas */}
                      <div className="grid grid-rows-9 h-[360px]">
                        {hours.map((hour) => {
                          const cellTasks = getTasksForCell(resource.id, dateStr, hour)
                          const isFirstHourOfTask = cellTasks.some(
                            (task) => Number.parseInt(task.startTime.split(":")[0]) === hour,
                          )

                          return (
                            <div
                              key={hour}
                              className="border-b border-border relative hover:bg-muted/50 transition-colors"
                              onDragOver={handleDragOver}
                              onDrop={() => handleDrop(resource.id, dateStr, hour)}
                            >
                              {/* Hora label */}
                              <div className="absolute left-1 top-1 text-[10px] text-muted-foreground">
                                {formatTime(hour)}
                              </div>

                              {/* Tareas */}
                              {isFirstHourOfTask &&
                                cellTasks.map((task) => {
                                  const taskDuration =
                                    Number.parseInt(task.endTime.split(":")[0]) -
                                    Number.parseInt(task.startTime.split(":")[0])

                                  return (
                                    <TooltipProvider key={task.id}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div
                                            draggable
                                            onDragStart={() => handleDragStart(task.id)}
                                            className={`
                                            absolute inset-x-1 top-6 cursor-move
                                            ${PRIORITY_COLORS[task.priority]} 
                                            text-primary-foreground
                                            rounded p-1 text-xs
                                            hover:opacity-90 transition-opacity
                                            shadow-sm
                                          `}
                                            style={{ height: `${taskDuration * 40 - 8}px` }}
                                          >
                                            <div
                                              className="h-full w-full"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onTaskClick?.(task);
                                              }}
                                            >
                                              <div className="font-semibold truncate">{task.workOrderNumber}</div>
                                              <div className="text-[10px] opacity-90 truncate">
                                                {PROCESS_LABELS[task.process]}
                                              </div>
                                              <div className="text-[10px] opacity-90">{task.progress}%</div>
                                              {task.isDelayed && (
                                                <AlertTriangle className="h-3 w-3 absolute top-1 right-1" />
                                              )}
                                            </div>
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-sm">
                                          <div className="space-y-2">
                                            <div className="font-bold">{task.workOrderNumber}</div>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                              <div>
                                                <span className="text-muted-foreground">Cliente:</span>
                                                <div className="font-medium">{task.client}</div>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Proceso:</span>
                                                <div className="font-medium">{PROCESS_LABELS[task.process]}</div>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Sector:</span>
                                                <div className="font-medium">{task.sector}</div>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Subsector:</span>
                                                <div className="font-medium">{task.subsector}</div>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Horario:</span>
                                                <div className="font-medium">
                                                  {task.startTime} - {task.endTime}
                                                </div>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Duración:</span>
                                                <div className="font-medium">{task.duration}h</div>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Cantidad:</span>
                                                <div className="font-medium">{task.quantity} unidades</div>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Progreso:</span>
                                                <div className="font-medium">{task.progress}%</div>
                                              </div>
                                            </div>
                                            <div>
                                              <span className="text-muted-foreground text-xs">Materiales:</span>
                                              <div className="text-xs">{task.materials.join(", ")}</div>
                                            </div>
                                            {task.notes && (
                                              <div>
                                                <span className="text-muted-foreground text-xs">Notas:</span>
                                                <div className="text-xs">{task.notes}</div>
                                              </div>
                                            )}
                                            <div className="flex gap-2 pt-2">
                                              <Badge variant="outline" className={PRIORITY_COLORS[task.priority]}>
                                                {PRIORITY_LABELS[task.priority]}
                                              </Badge>
                                              <Badge variant="outline">{STATUS_LABELS[task.status]}</Badge>
                                            </div>
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )
                                })}
                            </div>
                          )
                        })}
                      </div>

                      {/* Resumen de carga */}
                      <div className="p-2 text-center text-xs">
                        <span className={overloaded ? "text-destructive font-semibold" : "text-muted-foreground"}>
                          {load}h / {WORK_HOURS.total}h
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Leyenda */}
      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-primary rounded" />
          <span>Normal</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-warning rounded" />
          <span>Urgente</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-destructive rounded" />
          <span>Crítica</span>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span>Con retraso</span>
        </div>
      </div>
    </Card>
  )
}
