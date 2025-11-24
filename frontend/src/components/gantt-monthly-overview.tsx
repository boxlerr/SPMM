"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { AlertTriangle, TrendingUp, Clock, ChevronLeft, ChevronRight, Calendar } from "lucide-react"
import type { GanttTask, Resource } from "@/lib/types"
import {
  WORK_DAYS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  PROCESS_LABELS,
  getMonthDates,
  formatDate,
  calculateResourceLoad,
  isOverloaded,
  WORK_HOURS,
} from "@/lib/gantt-utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface GanttMonthlyOverviewProps {
  tasks: GanttTask[]
  resources: Resource[]
  viewMode: "operario" | "maquina"
  onTaskClick?: (task: GanttTask) => void
}

export function GanttMonthlyOverview({ tasks, resources, viewMode, onTaskClick }: GanttMonthlyOverviewProps) {
  const [currentMonthOffset, setCurrentMonthOffset] = useState(0)

  const monthDates = getMonthDates(currentMonthOffset * 4)
  const filteredResources = resources.filter((r) => r.type === viewMode)

  const firstDate = monthDates[0]
  const lastDate = monthDates[monthDates.length - 1]

  const getTasksForDay = (resourceId: string, date: string) => {
    return tasks.filter((task) => task.resourceId === resourceId && task.startDate === date)
  }

  const stats = {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === "en_proceso").length,
    urgent: tasks.filter((t) => t.priority === "urgente" || t.priority === "critica").length,
    delayed: tasks.filter((t) => t.isDelayed).length,
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-bold text-foreground">Vista Mensual General - 4 Semanas de Planificación</h3>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCurrentMonthOffset((prev) => prev - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex flex-col items-center px-3">
              <span className="text-sm font-medium">
                {currentMonthOffset === 0
                  ? "Mes Actual"
                  : `Mes ${currentMonthOffset > 0 ? "+" : ""}${currentMonthOffset}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {firstDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} -{" "}
                {lastDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCurrentMonthOffset((prev) => prev + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {currentMonthOffset !== 0 && (
              <Button variant="secondary" size="sm" onClick={() => setCurrentMonthOffset(0)}>
                <Calendar className="h-4 w-4 mr-1" />
                Hoy
              </Button>
            )}
          </div>
        </div>

        {/* Estadísticas */}
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Total OTs:</span>
            <span className="font-bold">{stats.total}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            <span className="text-muted-foreground">En Proceso:</span>
            <span className="font-bold">{stats.inProgress}</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="text-muted-foreground">Urgentes:</span>
            <span className="font-bold">{stats.urgent}</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-muted-foreground">Atrasadas:</span>
            <span className="font-bold">{stats.delayed}</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1400px]">
          {/* Header con semanas y días */}
          <div className="grid grid-cols-[180px_repeat(20,1fr)] gap-px bg-border mb-px">
            <div className="bg-primary text-primary-foreground p-2 font-semibold">
              {viewMode === "operario" ? "Operario" : "Máquina"}
            </div>
            {[0, 1, 2, 3].map((week) => (
              <div
                key={week}
                className="col-span-5 bg-primary/90 text-primary-foreground p-2 text-center font-semibold"
              >
                Semana {week + 1}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[180px_repeat(20,1fr)] gap-px bg-border mb-px">
            <div className="bg-muted" />
            {monthDates.map((date, idx) => (
              <div key={idx} className="bg-muted p-1 text-center text-xs">
                <div className="font-medium">{WORK_DAYS[idx % 5]}</div>
                <div className="text-muted-foreground">
                  {date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                </div>
              </div>
            ))}
          </div>

          {/* Filas de recursos */}
          {filteredResources.map((resource) => {
            const totalLoad = monthDates.reduce(
              (sum, date) => sum + calculateResourceLoad(tasks, resource.id, formatDate(date)),
              0,
            )
            const avgLoad = totalLoad / monthDates.length
            const utilizationPercent = (avgLoad / WORK_HOURS.total) * 100

            return (
              <div key={resource.id} className="grid grid-cols-[180px_repeat(20,1fr)] gap-px bg-border mb-px">
                {/* Nombre del recurso con utilización */}
                <div className="bg-card p-2">
                  <div className="font-semibold text-sm mb-1">{resource.name}</div>
                  <div className="space-y-1">
                    <Progress value={utilizationPercent} className="h-1" />
                    <div className="text-xs text-muted-foreground">Utilización: {utilizationPercent.toFixed(0)}%</div>
                  </div>
                </div>

                {/* Días */}
                {monthDates.map((date, dayIdx) => {
                  const dateStr = formatDate(date)
                  const dayTasks = getTasksForDay(resource.id, dateStr)
                  const load = calculateResourceLoad(tasks, resource.id, dateStr)
                  const overloaded = isOverloaded(load)

                  return (
                    <TooltipProvider key={dayIdx}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={`
                              bg-card p-1 min-h-[60px] cursor-pointer
                              hover:bg-muted/50 transition-colors
                              ${overloaded ? "border-2 border-destructive" : ""}
                            `}
                          >
                            {dayTasks.length > 0 && (
                              <div className="space-y-1">
                                {dayTasks.slice(0, 2).map((task) => (
                                  <div
                                    key={task.id}
                                    className={`
                                      ${PRIORITY_COLORS[task.priority]}
                                      text-primary-foreground
                                      rounded px-1 py-0.5 text-[10px]
                                      truncate
                                      cursor-pointer hover:opacity-80
                                    `}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onTaskClick?.(task);
                                    }}
                                  >
                                    {task.workOrderNumber}
                                  </div>
                                ))}
                                {dayTasks.length > 2 && (
                                  <div className="text-[10px] text-muted-foreground text-center">
                                    +{dayTasks.length - 2} más
                                  </div>
                                )}
                              </div>
                            )}
                            {load > 0 && (
                              <div
                                className={`
                                text-[10px] text-center mt-1
                                ${overloaded ? "text-destructive font-bold" : "text-muted-foreground"}
                              `}
                              >
                                {load}h
                              </div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-md">
                          <div className="space-y-2">
                            <div className="font-bold">
                              {date.toLocaleDateString("es-AR", {
                                weekday: "long",
                                day: "2-digit",
                                month: "long",
                              })}
                            </div>
                            <div className="text-sm">
                              <span className="text-muted-foreground">Carga total:</span>
                              <span className={`ml-2 font-bold ${overloaded ? "text-destructive" : ""}`}>
                                {load}h / {WORK_HOURS.total}h
                              </span>
                            </div>
                            {dayTasks.length > 0 && (
                              <div className="space-y-2 max-h-60 overflow-y-auto">
                                {dayTasks.map((task) => (
                                  <div key={task.id} className="border-t pt-2">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="font-semibold text-sm">{task.workOrderNumber}</span>
                                      <Badge variant="outline" className={PRIORITY_COLORS[task.priority]}>
                                        {PRIORITY_LABELS[task.priority]}
                                      </Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 text-xs">
                                      <div>
                                        <span className="text-muted-foreground">Cliente:</span>
                                        <div>{task.client}</div>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Proceso:</span>
                                        <div>{PROCESS_LABELS[task.process]}</div>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Horario:</span>
                                        <div>
                                          {task.startTime} - {task.endTime}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Progreso:</span>
                                        <div>{task.progress}%</div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
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
      </div>

      {/* Leyenda y alertas */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex flex-wrap gap-4 text-sm">
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
            <div className="w-4 h-4 border-2 border-destructive rounded" />
            <span>Sobrecarga</span>
          </div>
        </div>

        {stats.delayed > 0 && (
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-semibold">
              {stats.delayed} orden{stats.delayed > 1 ? "es" : ""} con retraso
            </span>
          </div>
        )}
      </div>
    </Card>
  )
}
