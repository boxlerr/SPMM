"use client"

import type React from "react"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, User, Wrench, Calendar, ChevronDown, ChevronUp } from "lucide-react"
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
  toTitleCase,
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
  const [dragOverCell, setDragOverCell] = useState<{ resourceId: string; date: string; hour: number } | null>(null)
  // Initialize with all resources collapsed by default to show the full list
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set())

  const toggleResource = (resourceId: string) => {
    const newExpanded = new Set(expandedResources)
    if (newExpanded.has(resourceId)) {
      newExpanded.delete(resourceId)
    } else {
      newExpanded.add(resourceId)
    }
    setExpandedResources(newExpanded)
  }

  const weekDates = getWeekDates(currentWeek)
  const filteredResources = resources.filter((r) => r.type === viewMode)

  const hours = Array.from({ length: WORK_HOURS.total }, (_, i) => WORK_HOURS.start + i)

  const getTasksStartingInHour = (resourceId: string, date: string, hour: number) => {
    return tasks.filter((task) => {
      if (task.resourceId !== resourceId) return false

      // Case 1: Task starts on this day at this hour
      if (task.startDate === date) {
        const taskStartHour = Number.parseInt(task.startTime.split(":")[0])
        return taskStartHour === hour
      }

      // Case 2: Task started before this day, continues today, and this is the first hour of the day
      if (task.startDate < date && task.endDate >= date && hour === WORK_HOURS.start) {
        return true
      }

      return false
    })
  }

  const handleDragStart = (taskId: string) => {
    setDraggedTask(taskId)
  }

  const handleDragOver = (e: React.DragEvent, resourceId: string, date: string, hour: number) => {
    e.preventDefault()
    setDragOverCell({ resourceId, date, hour })
  }

  const handleDragLeave = () => {
    setDragOverCell(null)
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
    setDragOverCell(null)
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
          <span>Turno: 09:00 - 18:00</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1200px]">
          {/* Header con días */}
          <div className="grid grid-cols-[200px_repeat(5,1fr)] gap-px bg-border mb-4 rounded-xl overflow-hidden shadow-sm">
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
          <div className="space-y-4 pb-8">
            {filteredResources.map((resource) => (
              <div key={resource.id} className="border rounded-xl shadow-sm bg-card mb-4 overflow-hidden">
                <div className="grid grid-cols-[200px_repeat(5,1fr)] gap-px bg-border">
                  {/* Nombre del recurso */}
                  <div
                    className="bg-card p-4 flex items-start gap-3 border-r-2 border-primary cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => toggleResource(resource.id)}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 mt-0.5 shrink-0"
                    >
                      {expandedResources.has(resource.id) ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>

                    <div className="flex items-center gap-2 mt-0.5">
                      {viewMode === "operario" ? (
                        <User className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <Wrench className="h-4 w-4 text-primary shrink-0" />
                      )}
                      <div>
                        <div className="font-semibold text-sm">
                          {toTitleCase(resource.name)}
                        </div>
                        {resource.skills && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {resource.skills.map((s) => PROCESS_LABELS[s as keyof typeof PROCESS_LABELS] || s).join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Días */}
                  {weekDates.map((date, dayIdx) => {
                    const dateStr = formatDate(date)
                    const load = calculateResourceLoad(tasks, resource.id, dateStr)
                    const overloaded = isOverloaded(load)

                    return (
                      <div key={dayIdx} className="bg-card relative">
                        {/* Indicador de carga */}
                        <div className={`h-1 ${overloaded ? "bg-destructive" : load > 0 ? "bg-accent" : "bg-muted"}`} />

                        {/* Grid de horas (Collapsible) */}
                        {expandedResources.has(resource.id) && (
                          <div className="grid grid-rows-9 h-[360px] animate-in slide-in-from-top-2 duration-200 mb-4">
                            {hours.map((hour) => {
                              const startingTasks = getTasksStartingInHour(resource.id, dateStr, hour)

                              const isDropTarget = dragOverCell?.resourceId === resource.id &&
                                dragOverCell?.date === dateStr &&
                                dragOverCell?.hour === hour

                              return (
                                <div
                                  key={hour}
                                  className={`border-b border-border relative transition-all duration-200 ${isDropTarget
                                    ? 'bg-primary/20 ring-2 ring-primary ring-inset scale-[1.02]'
                                    : draggedTask
                                      ? 'hover:bg-primary/10'
                                      : 'hover:bg-muted/50'
                                    }`}
                                  onDragOver={(e) => handleDragOver(e, resource.id, dateStr, hour)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={() => handleDrop(resource.id, dateStr, hour)}
                                >
                                  {/* Hora label */}
                                  <div className="absolute left-1 top-1 text-[10px] text-muted-foreground">
                                    {formatTime(hour)}
                                  </div>

                                  {/* Tareas */}
                                  {startingTasks.map((task, index) => {
                                    // Calculate duration for THIS day
                                    let startH = Number.parseInt(task.startTime.split(":")[0])
                                    let endH = Number.parseInt(task.endTime.split(":")[0])

                                    // Adjust start/end for multi-day logic
                                    if (task.startDate < dateStr) {
                                      startH = WORK_HOURS.start
                                    }
                                    if (task.endDate > dateStr) {
                                      endH = WORK_HOURS.end
                                    }

                                    const taskDuration = endH - startH

                                    // Calculate width and position for overlapping tasks
                                    const widthPercent = 100 / startingTasks.length
                                    const leftPercent = widthPercent * index

                                    return (
                                      <TooltipProvider key={task.id}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <div
                                              draggable
                                              onDragStart={() => handleDragStart(task.id)}
                                              onDragEnd={() => setDraggedTask(null)}
                                              className={`
                                            absolute top-6 cursor-grab active:cursor-grabbing
                                            ${PRIORITY_COLORS[task.priority]} 
                                            text-primary-foreground
                                            rounded-md p-1 text-xs
                                            transition-all duration-200
                                            ${draggedTask === task.id
                                                  ? 'opacity-40 scale-95 shadow-2xl ring-2 ring-white'
                                                  : 'hover:opacity-90 hover:scale-[1.02] hover:shadow-lg'
                                                }
                                            shadow-sm
                                            border border-white/20
                                            overflow-hidden
                                          `}
                                              style={{
                                                height: `${taskDuration * 40 - 8}px`,
                                                left: `${leftPercent}%`,
                                                width: `${widthPercent}%`,
                                                zIndex: draggedTask === task.id ? 50 : 10 + index
                                              }}
                                            >
                                              <div
                                                className="h-full w-full"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  onTaskClick?.(task);
                                                }}
                                              >
                                                <div className="font-semibold truncate">{toTitleCase(task.workOrderNumber)}</div>
                                                <div className="text-[10px] opacity-90 truncate">
                                                  {toTitleCase(PROCESS_LABELS[task.process as keyof typeof PROCESS_LABELS] || task.process)}
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
                                              <div className="font-bold">{toTitleCase(task.workOrderNumber)}</div>
                                              <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div>
                                                  <span className="text-muted-foreground">Cliente:</span>
                                                  <div className="font-medium">{task.client}</div>
                                                </div>
                                                <div>
                                                  <span className="text-muted-foreground">Proceso:</span>
                                                  <div className="font-medium">{toTitleCase(PROCESS_LABELS[task.process as keyof typeof PROCESS_LABELS] || task.process)}</div>
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
                                                <div className="text-xs">{(task.materials || []).join(", ")}</div>
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
                        )}

                        {/* Resumen de carga */}
                        <div className="p-2 text-center text-xs">
                          <span className={overloaded ? "text-destructive font-semibold" : "text-muted-foreground"}>
                            {Number(load.toFixed(2))}h / {WORK_HOURS.total}h
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
    </Card >
  )
}
