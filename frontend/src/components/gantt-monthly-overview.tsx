"use client"

import { useState, useRef, MouseEvent } from "react"
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
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const handleMouseDown = (e: MouseEvent) => {
    if (!scrollContainerRef.current) return
    setIsDragging(true)
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft)
    setScrollLeft(scrollContainerRef.current.scrollLeft)
  }

  const handleMouseLeave = () => {
    setIsDragging(false)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollContainerRef.current.offsetLeft
    const walk = (x - startX) * 1.5 // Multiplier for faster scrolling
    scrollContainerRef.current.scrollLeft = scrollLeft - walk
  }

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

  // Configuración de dimensiones
  const SIDEBAR_WIDTH = 220
  const DAY_WIDTH = 140 // Ancho fijo por día para evitar desalineación
  const TOTAL_WIDTH = SIDEBAR_WIDTH + (monthDates.length * DAY_WIDTH)

  return (
    <Card className="p-0 w-full overflow-hidden border shadow-sm bg-white">
      {/* Header General */}
      <div className="p-6 border-b bg-white">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h3 className="text-xl font-bold text-foreground">Vista Mensual General - 4 Semanas</h3>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentMonthOffset((prev) => prev - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex flex-col items-center px-3 min-w-[140px]">
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
      </div>

      {/* Contenedor Scrollable */}
      <div
        ref={scrollContainerRef}
        className={`overflow-x-auto overflow-y-hidden relative ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        <div style={{ minWidth: TOTAL_WIDTH }} className="relative">

          {/* Header de Semanas */}
          <div className="flex border-b bg-gray-50 sticky top-0 z-20">
            <div
              className="sticky left-0 z-30 bg-gray-50 border-r font-semibold text-sm p-3 flex items-center justify-center text-muted-foreground shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
              style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }}
            >
              {viewMode === "operario" ? "Operario" : "Máquina"}
            </div>
            {[0, 1, 2, 3].map((week) => (
              <div
                key={week}
                className="text-center border-r last:border-r-0 font-semibold text-sm py-2 bg-white text-gray-700"
                style={{ width: DAY_WIDTH * 5 }}
              >
                Semana {week + 1}
              </div>
            ))}
          </div>

          {/* Header de Días */}
          <div className="flex border-b bg-white sticky top-[41px] z-20">
            <div
              className="sticky left-0 z-30 bg-white border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
              style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }}
            />
            {monthDates.map((date, idx) => (
              <div
                key={idx}
                className="text-center border-r last:border-r-0 py-2 px-1 bg-gray-50/50"
                style={{ width: DAY_WIDTH }}
              >
                <div className="font-medium text-xs text-gray-900">{WORK_DAYS[idx % 5]}</div>
                <div className="text-[10px] text-muted-foreground">
                  {date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                </div>
              </div>
            ))}
          </div>

          {/* Cuerpo del Gantt */}
          <div className="divide-y">
            {filteredResources.map((resource) => {
              const totalLoad = monthDates.reduce(
                (sum, date) => sum + calculateResourceLoad(tasks, resource.id, formatDate(date)),
                0,
              )
              const avgLoad = totalLoad / monthDates.length
              const utilizationPercent = (avgLoad / WORK_HOURS.total) * 100

              return (
                <div key={resource.id} className="flex hover:bg-gray-50/50 transition-colors">
                  {/* Columna Sticky del Recurso */}
                  <div
                    className="sticky left-0 z-10 bg-white border-r p-4 flex flex-col justify-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                    style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }}
                  >
                    <div className="font-bold text-sm text-gray-900 mb-2">{resource.name}</div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Carga</span>
                        <span className="font-medium">{utilizationPercent.toFixed(0)}%</span>
                      </div>
                      <Progress
                        value={utilizationPercent}
                        className="h-1.5"
                        indicatorClassName={utilizationPercent > 100 ? "bg-destructive" : utilizationPercent > 80 ? "bg-warning" : "bg-primary"}
                      />
                    </div>
                  </div>

                  {/* Celdas de Días */}
                  {monthDates.map((date, dayIdx) => {
                    const dateStr = formatDate(date)
                    const dayTasks = getTasksForDay(resource.id, dateStr)
                    const load = calculateResourceLoad(tasks, resource.id, dateStr)
                    const overloaded = isOverloaded(load)

                    return (
                      <div
                        key={dayIdx}
                        className={`
                          border-r last:border-r-0 p-1.5 min-h-[120px]
                          transition-all duration-200 flex flex-col justify-between
                          ${overloaded ? "bg-red-50/30" : ""}
                        `}
                        style={{ width: DAY_WIDTH }}
                      >
                        <TooltipProvider>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <div
                                className="h-full w-full cursor-pointer"
                                onClick={() => {
                                  // Si hay una sola tarea, click directo. Si hay varias, el usuario quizás quiera expandir.
                                  // Por ahora, si hace click en el día, no hacemos nada específico salvo que haga click en la tarea.
                                }}
                              >
                                {dayTasks.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {dayTasks.slice(0, 3).map((task) => (
                                      <div
                                        key={task.id}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          onTaskClick?.(task)
                                        }}
                                        className={`
                                          ${PRIORITY_COLORS[task.priority]}
                                          text-white
                                          rounded px-2 py-1.5 text-xs font-medium
                                          shadow-sm border border-white/10
                                          hover:brightness-110 hover:scale-[1.02] transition-all
                                          relative overflow-hidden group
                                        `}
                                      >
                                        <div className="flex items-center justify-between gap-1 relative z-10">
                                          <span className="truncate">#{task.workOrderNumber}</span>
                                        </div>
                                        <div className="text-[10px] text-white/90 truncate font-normal relative z-10">
                                          {task.client}
                                        </div>
                                      </div>
                                    ))}
                                    {dayTasks.length > 3 && (
                                      <div className="text-[10px] font-medium text-gray-500 text-center bg-gray-100 rounded py-0.5">
                                        +{dayTasks.length - 3} más
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="h-full w-full" />
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="p-0 border-0 shadow-xl rounded-lg overflow-hidden">
                              <div className="w-80 bg-white">
                                <div className="bg-gray-50 p-3 border-b">
                                  <div className="font-bold text-gray-900">
                                    {date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
                                  </div>
                                  <div className="flex items-center justify-between mt-1 text-xs">
                                    <span className="text-gray-500">Carga Total:</span>
                                    <span className={`font-bold ${overloaded ? "text-red-600" : "text-gray-900"}`}>
                                      {load}h / {WORK_HOURS.total}h
                                    </span>
                                  </div>
                                </div>

                                {dayTasks.length > 0 ? (
                                  <div className="max-h-[300px] overflow-y-auto p-2 space-y-2">
                                    {dayTasks.map((task) => (
                                      <div key={task.id} className="p-2 rounded-md border bg-gray-50/50 hover:bg-white hover:shadow-sm transition-all">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="font-bold text-sm text-blue-700">#{task.workOrderNumber}</span>
                                          <Badge variant="outline" className={`${PRIORITY_COLORS[task.priority]} text-white border-0 text-[10px] px-1.5`}>
                                            {PRIORITY_LABELS[task.priority]}
                                          </Badge>
                                        </div>
                                        <div className="text-xs text-gray-600 mb-1 font-medium">{task.client}</div>
                                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-gray-500">
                                          <div>Proceso: <span className="text-gray-700">{PROCESS_LABELS[task.process]}</span></div>
                                          <div>Horario: <span className="text-gray-700">{task.startTime} - {task.endTime}</span></div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-4 text-center text-gray-400 text-sm">
                                    No hay tareas asignadas
                                  </div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Indicador de carga inferior */}
                        {load > 0 && (
                          <div className={`
                            text-[10px] text-center mt-2 font-medium py-0.5 rounded
                            ${overloaded ? "text-red-600 bg-red-50" : "text-gray-500"}
                          `}>
                            {load}h
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer Leyenda */}
      <div className="p-4 border-t bg-gray-50 flex items-center justify-between">
        <div className="flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-600 rounded-sm shadow-sm" />
            <span className="text-gray-600">Normal</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-orange-500 rounded-sm shadow-sm" />
            <span className="text-gray-600">Urgente</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-600 rounded-sm shadow-sm" />
            <span className="text-gray-600">Crítica</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-50 border border-red-200 rounded-sm" />
            <span className="text-gray-600">Sobrecarga</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
