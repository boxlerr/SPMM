"use client"

import { useState, useRef, MouseEvent, useEffect, useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, TrendingUp, Clock, ChevronLeft, ChevronRight, Calendar, Info } from "lucide-react"
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
  toTitleCase,
} from "@/lib/gantt-utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { motion, AnimatePresence } from "framer-motion"

interface GanttMonthlyOverviewProps {
  tasks: GanttTask[]
  resources: Resource[]
  viewMode: "operario" | "maquina"
  onTaskClick?: (task: GanttTask) => void
  onTaskMove?: (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => void
}

export function GanttMonthlyOverview({ tasks, resources, viewMode, onTaskClick, onTaskMove }: GanttMonthlyOverviewProps) {
  const [currentMonthOffset, setCurrentMonthOffset] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Helper for duration formatting
  const formatDuration = (hours: number) => {
    const totalMinutes = Math.round(hours * 60)
    if (totalMinutes < 60) {
      return `${totalMinutes}m`
    }
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
  }

  // Drag & Momentum State
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  // Physics refs
  const velocityRef = useRef(0)
  const lastXRef = useRef(0)
  const lastTimeRef = useRef(0)
  const requestRef = useRef<number | undefined>(undefined)

  const handleMouseDown = (e: MouseEvent) => {
    if (!scrollContainerRef.current) return

    // Stop any current momentum
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current)
    }

    setIsDragging(true)
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft)
    setScrollLeft(scrollContainerRef.current.scrollLeft)

    // Initialize physics tracking
    lastXRef.current = e.pageX
    lastTimeRef.current = performance.now()
    velocityRef.current = 0
  }

  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false)
      startMomentum()
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    startMomentum()
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return
    e.preventDefault()

    const x = e.pageX - scrollContainerRef.current.offsetLeft
    const walk = (x - startX) * 1.5 // Multiplier for faster scrolling
    scrollContainerRef.current.scrollLeft = scrollLeft - walk

    // Calculate velocity
    const now = performance.now()
    const dt = now - lastTimeRef.current
    const dx = e.pageX - lastXRef.current

    if (dt > 0) {
      velocityRef.current = dx / dt
    }

    lastXRef.current = e.pageX
    lastTimeRef.current = now
  }

  const startMomentum = () => {
    if (!scrollContainerRef.current) return

    let vel = velocityRef.current * 15 // Amplify velocity for better feel

    const loop = () => {
      if (!scrollContainerRef.current) return

      // Apply friction
      vel *= 0.95

      if (Math.abs(vel) > 0.1) {
        scrollContainerRef.current.scrollLeft -= vel
        requestRef.current = requestAnimationFrame(loop)
      } else {
        velocityRef.current = 0
      }
    }

    requestRef.current = requestAnimationFrame(loop)
  }

  // Drag & Drop Logic for Tasks
  const handleTaskDragStart = (e: React.DragEvent<HTMLDivElement>, task: GanttTask) => {
    e.stopPropagation() // Prevent triggering scroll drag
    e.dataTransfer.setData("taskId", task.id)
    e.dataTransfer.effectAllowed = "move"
    // Create a ghost image if needed, or let browser handle it
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, resourceId: string, date: string) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData("taskId")
    if (!taskId || !onTaskMove) return

    const task = tasks.find(t => t.id === taskId)
    if (task) {
      // Keep original time, just change date and resource
      onTaskMove(taskId, resourceId, date, task.startTime)
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
      }
    }
  }, [])

  // Memoized calculations
  const monthDates = useMemo(() => getMonthDates(currentMonthOffset * 4), [currentMonthOffset])

  const filteredResources = useMemo(() =>
    resources.filter((r) => r.type === viewMode),
    [resources, viewMode])

  const firstDate = monthDates[0]
  const lastDate = monthDates[monthDates.length - 1]

  // Optimized Task Lookup Map
  // Creates a map: "resourceId-dateString" -> GanttTask[]
  const tasksMap = useMemo(() => {
    const map = new Map<string, GanttTask[]>()
    tasks.forEach(task => {
      const start = new Date(task.startDate)
      const end = new Date(task.endDate)

      // Iterate through each day of the task
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = formatDate(d)
        const key = `${task.resourceId}-${dateStr}`

        if (!map.has(key)) {
          map.set(key, [])
        }
        map.get(key)!.push(task)
      }
    })
    return map
  }, [tasks])

  const getTasksForDay = (resourceId: string, date: string) => {
    return tasksMap.get(`${resourceId}-${date}`) || []
  }

  const stats = useMemo(() => {
    const uniqueOTs = new Set(tasks.map(t => t.workOrderNumber)).size
    return {
      totalOTs: uniqueOTs,
      totalProcesses: tasks.length,
      inProgress: tasks.filter((t) => t.status === "en_proceso").length,
      urgent: tasks.filter((t) => t.priority === "urgente" || t.priority === "critica").length,
      delayed: tasks.filter((t) => t.isDelayed).length,
    }
  }, [tasks])

  // Configuración de dimensiones
  const SIDEBAR_WIDTH = 240
  const DAY_WIDTH = 150
  const TOTAL_WIDTH = SIDEBAR_WIDTH + (monthDates.length * DAY_WIDTH)

  return (
    <Card className="p-0 w-full overflow-hidden border-0 shadow-lg bg-white/50 backdrop-blur-sm ring-1 ring-black/5">
      {/* Header General */}
      <div className="p-6 border-b bg-white/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 tracking-tight">Vista Mensual</h3>
              <p className="text-sm text-muted-foreground mt-1">Gestión general de operaciones</p>
            </div>

            <div className="flex items-center gap-2 bg-gray-100/50 p-1 rounded-lg border border-gray-200/50">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonthOffset((prev) => prev - 1)} className="h-8 w-8 hover:bg-white hover:shadow-sm transition-all">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex flex-col items-center px-4 min-w-[160px]">
                <span className="text-sm font-semibold text-gray-900">
                  {currentMonthOffset === 0
                    ? "Mes Actual"
                    : `Mes ${currentMonthOffset > 0 ? "+" : ""}${currentMonthOffset}`}
                </span>
                <span className="text-xs text-muted-foreground font-medium">
                  {firstDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} -{" "}
                  {lastDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonthOffset((prev) => prev + 1)} className="h-8 w-8 hover:bg-white hover:shadow-sm transition-all">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {currentMonthOffset !== 0 && (
              <Button variant="outline" size="sm" onClick={() => setCurrentMonthOffset(0)} className="h-8 bg-white hover:bg-gray-50">
                <Calendar className="h-3.5 w-3.5 mr-2 text-primary" />
                Volver a Hoy
              </Button>
            )}
          </div>

          {/* Estadísticas */}
          <div className="flex gap-8">
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Total OTs</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-gray-900">{stats.totalOTs}</span>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
            </div>
            <div className="w-px h-10 bg-gray-200" />
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Procesos</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-gray-900">{stats.totalProcesses}</span>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
            </div>
            <div className="w-px h-10 bg-gray-200" />
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">En Proceso</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-blue-600">{stats.inProgress}</span>
                <Clock className="h-4 w-4 text-blue-500" />
              </div>
            </div>
            <div className="w-px h-10 bg-gray-200" />
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Críticas</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-red-600">{stats.urgent}</span>
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contenedor Scrollable */}
      <div
        ref={scrollContainerRef}
        className={`overflow-x-auto overflow-y-hidden relative select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        <div style={{ minWidth: TOTAL_WIDTH }} className="relative bg-white">

          {/* Header de Semanas */}
          <div className="flex sticky top-0 z-20 shadow-sm">
            <div
              className="sticky left-0 z-30 bg-gray-900 text-white font-bold text-sm p-3 flex items-center justify-center shadow-lg"
              style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }}
            >
              <div className="flex items-center gap-2">
                {viewMode === "operario" ? <span className="text-lg">👷‍♂️</span> : <span className="text-lg">🏭</span>}
                {viewMode === "operario" ? "Operarios" : "Máquinas"}
              </div>
            </div>
            {[0, 1, 2, 3].map((week) => (
              <div
                key={week}
                className="text-center border-r border-gray-100 last:border-r-0 font-semibold text-xs py-2 bg-gray-50/80 text-gray-500 uppercase tracking-widest backdrop-blur-sm"
                style={{ width: DAY_WIDTH * 5 }}
              >
                Semana {week + 1}
              </div>
            ))}
          </div>

          {/* Header de Días */}
          <div className="flex border-b border-gray-200 bg-white sticky top-[45px] z-20 shadow-sm">
            <div
              className="sticky left-0 z-30 bg-white border-r border-gray-200 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]"
              style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }}
            />
            {monthDates.map((date, idx) => {
              const isToday = date.toDateString() === new Date().toDateString()
              return (
                <div
                  key={idx}
                  className={`
                    text-center border-r border-gray-100 last:border-r-0 py-3 px-1 transition-colors relative group
                    ${isToday ? "bg-blue-50/50" : "bg-white hover:bg-gray-50"}
                  `}
                  style={{ width: DAY_WIDTH }}
                >
                  {isToday && <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500" />}
                  <div className={`font-bold text-xs uppercase tracking-wider mb-1 ${isToday ? "text-blue-600" : "text-gray-400"}`}>
                    {WORK_DAYS[idx % 5]}
                  </div>
                  <div className={`text-sm font-semibold ${isToday ? "text-blue-700" : "text-gray-700"}`}>
                    {date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Cuerpo del Gantt */}
          <div className="divide-y divide-gray-100">
            <AnimatePresence>
              {filteredResources.map((resource, index) => {
                const totalLoad = monthDates.reduce(
                  (sum, date) => sum + calculateResourceLoad(tasks, resource.id, formatDate(date)),
                  0,
                )
                const avgLoad = totalLoad / monthDates.length
                const utilizationPercent = (avgLoad / WORK_HOURS.total) * 100

                return (
                  <motion.div
                    key={resource.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.3 }}
                    className="flex hover:bg-blue-50/30 transition-colors group/row"
                  >
                    {/* Columna Sticky del Recurso */}
                    <div
                      className="sticky left-0 z-10 bg-white border-r border-gray-200 p-4 flex flex-col justify-center shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] group-hover/row:bg-blue-50/30 transition-colors"
                      style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-bold text-sm text-gray-800 truncate pr-2" title={resource.name}>{resource.name}</div>
                        {utilizationPercent > 100 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-3.5 w-3.5 text-red-500 animate-pulse" />
                              </TooltipTrigger>
                              <TooltipContent>Sobrecarga detectada</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] uppercase tracking-wider font-medium text-gray-500">
                          <span>Carga Promedio</span>
                          <span className={utilizationPercent > 90 ? "text-red-600" : "text-gray-700"}>
                            {utilizationPercent.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${utilizationPercent > 100 ? "bg-red-500" : utilizationPercent > 80 ? "bg-orange-500" : "bg-emerald-500"}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(utilizationPercent, 100)}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Celdas de Días */}
                    {monthDates.map((date, dayIdx) => {
                      const dateStr = formatDate(date)
                      const dayTasks = getTasksForDay(resource.id, dateStr)
                      const load = calculateResourceLoad(tasks, resource.id, dateStr)
                      const overloaded = isOverloaded(load)
                      const isToday = date.toDateString() === new Date().toDateString()

                      return (
                        <div
                          key={dayIdx}
                          className={`
                          border-r border-gray-100 last:border-r-0 p-2 min-h-[140px]
                          transition-all duration-200 flex flex-col justify-between relative
                          ${overloaded ? "bg-red-50/40" : isToday ? "bg-blue-50/20" : ""}
                          hover:bg-gray-50
                        `}
                          style={{ width: DAY_WIDTH }}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, resource.id, dateStr)}
                        >
                          <div className="space-y-2 flex-1">
                            <AnimatePresence mode="popLayout">
                              {dayTasks.slice(0, 3).map((task) => (
                                <motion.div
                                  key={task.id}
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.9 }}
                                  whileHover={{ scale: 1.03, zIndex: 10 }}
                                  draggable
                                  onDragStart={(e) => {
                                    // @ts-ignore
                                    handleTaskDragStart(e, task)
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onTaskClick?.(task)
                                  }}
                                  className={`
                                    ${PRIORITY_COLORS[task.priority]}
                                    text-white
                                    rounded-md px-2.5 py-2 text-xs font-medium
                                    shadow-sm border border-white/10
                                    cursor-grab active:cursor-grabbing
                                    relative overflow-hidden group/card
                                  `}
                                >
                                  <div className="flex items-center justify-between gap-1 relative z-10 mb-0.5">
                                    <span className="truncate font-bold">#{task.workOrderNumber}</span>
                                    {task.priority === 'urgente' && <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                                  </div>
                                  <div className="text-[10px] text-white/90 truncate font-normal relative z-10 opacity-90 group-hover/card:opacity-100">
                                    {toTitleCase(PROCESS_LABELS[task.process as keyof typeof PROCESS_LABELS] || task.process)}
                                  </div>

                                  {/* Shine effect on hover */}
                                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/card:animate-[shimmer_1.5s_infinite]" />
                                </motion.div>
                              ))}
                            </AnimatePresence>

                            {
                              dayTasks.length > 3 && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="text-[10px] font-semibold text-gray-500 text-center bg-gray-100/80 rounded-full py-1 hover:bg-gray-200 transition-colors cursor-pointer"
                                >
                                  +{dayTasks.length - 3} tareas más
                                </motion.div>
                              )
                            }
                          </div>

                          {/* Indicador de carga inferior */}
                          <div className="mt-2 pt-2 border-t border-gray-100/50 flex items-center justify-between">
                            <TooltipProvider>
                              <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                  <div className={`
                                      text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1
                                      ${overloaded ? "text-red-700 bg-red-100" : load > 0 ? "text-gray-600 bg-gray-100" : "text-gray-300"}
                                    `}>
                                    <Clock className="h-3 w-3" />
                                    {formatDuration(load)}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="p-0 border-0 shadow-xl rounded-xl overflow-hidden">
                                  {/* Detailed Tooltip Content */}
                                  <div className="w-72 bg-white">
                                    <div className="bg-gray-50 p-3 border-b flex justify-between items-center">
                                      <span className="font-bold text-gray-900">{date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric" })}</span>
                                      <Badge variant={overloaded ? "destructive" : "secondary"} className="text-[10px]">
                                        {formatDuration(load)} / {WORK_HOURS.total}h
                                      </Badge>
                                    </div>
                                    <div className="max-h-[250px] overflow-y-auto p-2 space-y-1">
                                      {dayTasks.length > 0 ? dayTasks.map(t => (
                                        <div
                                          key={t.id}
                                          className="p-2 hover:bg-gray-50 rounded-lg border border-transparent hover:border-gray-100 transition-all cursor-pointer"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onTaskClick?.(t)
                                          }}
                                        >
                                          <div className="flex justify-between items-center mb-1">
                                            <span className="font-bold text-xs text-blue-600">#{t.workOrderNumber}</span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[t.priority]} text-white`}>
                                              {PRIORITY_LABELS[t.priority]}
                                            </span>
                                          </div>
                                          <div className="text-xs text-gray-700 mb-0.5">
                                            {toTitleCase(PROCESS_LABELS[t.process as keyof typeof PROCESS_LABELS] || t.process)}
                                          </div>
                                          <div className="text-[10px] text-gray-400 flex justify-between">
                                            <span>{t.startTime} - {t.endTime}</span>
                                          </div>
                                        </div>
                                      )) : <div className="text-center py-4 text-gray-400 text-xs">Sin tareas asignadas</div>}
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      )
                    })}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Footer Leyenda */}
      <div className="p-4 border-t bg-white flex items-center justify-between text-xs text-gray-500">
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-blue-600 rounded-full shadow-sm" />
            <span>Normal</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-orange-500 rounded-full shadow-sm" />
            <span>Urgente</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-red-600 rounded-full shadow-sm" />
            <span>Crítica</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-red-100 border border-red-200 rounded-full" />
            <span>Sobrecarga (&gt;8h)</span>
          </div>
        </div>
        <div className="flex items-center gap-2 opacity-60">
          <Info className="h-3.5 w-3.5" />
          <span>Arrastra para mover • Shift + Scroll para navegar</span>
        </div>
      </div>
    </Card>
  )
}
