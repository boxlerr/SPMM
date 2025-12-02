"use client"

import type React from "react"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, User, Wrench, Calendar, ChevronDown, ChevronUp, MoreHorizontal, CheckCircle2, Circle } from "lucide-react"
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
    isOperatorQualified,
} from "@/lib/gantt-utils"
import { toast } from "sonner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"

interface GanttWeeklyDetailedProps {
    tasks: GanttTask[]
    resources: Resource[]
    viewMode: "operario" | "maquina"
    onTaskMove?: (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => void
    onTaskClick?: (task: GanttTask) => void
    onStatusChange?: (taskId: string, newStatusId: string) => void
}

export function GanttWeeklyDetailed({ tasks, resources, viewMode, onTaskMove, onTaskClick, onStatusChange }: GanttWeeklyDetailedProps) {
    const [trayTasks, setTrayTasks] = useState<GanttTask[]>([])
    const [isTrayOpen, setIsTrayOpen] = useState(false)
    const [currentWeek, setCurrentWeek] = useState(0)
    const [draggedTask, setDraggedTask] = useState<string | null>(null)
    const [dragOverCell, setDragOverCell] = useState<{ resourceId: string; date: string; hour: number } | null>(null)
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
    // Filter out tasks that are currently in the tray
    const visibleTasks = tasks.filter(t => !trayTasks.some(trayTask => trayTask.id === t.id))
    const filteredResources = resources.filter((r) => r.type === viewMode)

    const hours = Array.from({ length: WORK_HOURS.total }, (_, i) => WORK_HOURS.start + i)

    const STATUS_GRADIENTS: Record<string, string> = {
        nuevo: "bg-gradient-to-br from-gray-400 to-gray-500 border-gray-300 shadow-gray-500/20",
        en_proceso: "bg-gradient-to-br from-blue-500 to-blue-600 border-blue-400 shadow-blue-500/20",
        finalizado_total: "bg-gradient-to-br from-green-500 to-green-600 border-green-400 shadow-green-500/20",
        pausado: "bg-gradient-to-br from-amber-500 to-amber-600 border-amber-400 shadow-amber-500/20",
        finalizado_parcial: "bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-400 shadow-emerald-500/20",
    }

    const getTasksStartingInHour = (resourceId: string, date: string, hour: number) => {
        return visibleTasks.filter((task) => {
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

    const handleDragStart = (task: GanttTask) => {
        // Delay state update to allow drag to start properly
        setTimeout(() => setDraggedTask(task.id), 0)
    }

    const handleDragOver = (e: React.DragEvent, resourceId: string, date: string, hour: number) => {
        e.preventDefault()
        // Only update state if the cell actually changed to prevent excessive re-renders
        if (
            dragOverCell?.resourceId !== resourceId ||
            dragOverCell?.date !== date ||
            dragOverCell?.hour !== hour
        ) {
            setDragOverCell({ resourceId, date, hour })
        }
    }

    const handleDrop = (resourceId: string, date: string, hour: number) => {
        if (draggedTask && onTaskMove) {
            // Find target resource to check qualification
            const targetResource = resources.find(r => r.id === resourceId)

            // Check if task is in tray
            const trayTaskIndex = trayTasks.findIndex(t => t.id === draggedTask)
            let taskToMove: GanttTask | undefined

            if (trayTaskIndex !== -1) {
                taskToMove = trayTasks[trayTaskIndex]
            } else {
                taskToMove = tasks.find((t) => t.id === draggedTask)
            }

            if (taskToMove && targetResource) {
                // Check qualification
                // Ensure we have ranges/allowedRanges. 
                // Resources in this view are 'Resource' type which has 'ranges'.
                // Tasks are 'GanttTask' which has 'allowedRanges'.
                const opRanges = targetResource.ranges || []
                const allowedRanges = taskToMove.allowedRanges || []

                // Determine target hour
                let targetHour = hour
                if (targetHour === -1) {
                    // If dropped on summary row, preserve current start time
                    const currentStartHour = taskToMove.startTime ? Number.parseInt(taskToMove.startTime.split(":")[0]) : WORK_HOURS.start

                    console.log("Drop on summary row:", {
                        taskId: taskToMove.id,
                        startTime: taskToMove.startTime,
                        currentStartHour,
                        hour
                    })

                    targetHour = isNaN(currentStartHour) ? WORK_HOURS.start : currentStartHour

                    // Ensure it's within work hours
                    if (targetHour < WORK_HOURS.start || targetHour >= WORK_HOURS.end) {
                        targetHour = WORK_HOURS.start
                    }
                }

                if (trayTaskIndex !== -1) {
                    // Task came from tray
                    const newStartTime = formatTime(targetHour)
                    onTaskMove(taskToMove.id, resourceId, date, newStartTime)

                    // Remove from tray
                    const newTray = [...trayTasks]
                    newTray.splice(trayTaskIndex, 1)
                    setTrayTasks(newTray)
                } else {
                    // Task came from grid
                    const newStartTime = formatTime(targetHour)
                    onTaskMove(draggedTask, resourceId, date, newStartTime)
                }
            }
        }
        setDraggedTask(null)
        setDragOverCell(null)
    }

    const handleDragOverTray = (e: React.DragEvent) => {
        e.preventDefault()
        if (!isTrayOpen) setIsTrayOpen(true)
    }

    const handleDropToTray = (e: React.DragEvent) => {
        e.preventDefault()
        if (draggedTask) {
            // Check if already in tray
            if (trayTasks.some(t => t.id === draggedTask)) return

            const task = tasks.find(t => t.id === draggedTask)
            if (task) {
                setTrayTasks([...trayTasks, task])
            }
        }
        setDraggedTask(null)
    }

    const firstDate = weekDates[0]
    const lastDate = weekDates[4]

    return (
        <div className="space-y-6 relative min-h-screen pb-32">
            {/* Background Decor */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-red-500/5 blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/5 blur-[120px]" />
            </div>

            {/* Header Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white/80 backdrop-blur-xl p-4 rounded-3xl shadow-lg border border-white/20 items-center sticky top-4 z-40 transition-all duration-300 hover:shadow-xl">
                <div className="flex items-center gap-4 justify-self-start">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 p-2.5 rounded-2xl shadow-inner">
                        {viewMode === "operario" ? <User className="h-6 w-6 text-red-600" /> : <Wrench className="h-6 w-6 text-red-600" />}
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 tracking-tight">
                            {viewMode === "operario" ? "Planificación por Operario" : "Planificación por Máquina"}
                        </h3>
                        <p className="text-sm text-gray-500 font-medium">Vista Semanal Detallada</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 bg-gray-100/50 p-1.5 rounded-2xl border border-gray-200/50 justify-self-center backdrop-blur-sm">
                    <Button variant="ghost" size="icon" onClick={() => setCurrentWeek((prev) => prev - 1)} className="h-9 w-9 rounded-xl hover:bg-white hover:shadow-md transition-all">
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex flex-col items-center justify-center px-6 w-[200px]">
                        <span className="text-sm font-bold text-gray-900 whitespace-nowrap">
                            {currentWeek === 0 ? "Semana Actual" : `Semana ${currentWeek > 0 ? "+" : ""}${currentWeek}`}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold whitespace-nowrap mt-0.5">
                            {firstDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} -{" "}
                            {lastDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                        </span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setCurrentWeek((prev) => prev + 1)} className="h-9 w-9 rounded-xl hover:bg-white hover:shadow-md transition-all">
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                <div className="flex items-center gap-3 justify-self-end">
                    {currentWeek !== 0 && (
                        <Button variant="outline" size="sm" onClick={() => setCurrentWeek(0)} className="text-xs h-9 rounded-xl border-gray-200 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                            <Calendar className="h-3.5 w-3.5 mr-1.5" />
                            Volver a Hoy
                        </Button>
                    )}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50/80 text-blue-700 rounded-xl text-xs font-bold border border-blue-100/50 shadow-sm backdrop-blur-sm">
                        <Clock className="h-3.5 w-3.5" />
                        <span>09:00 - 18:00</span>
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto pb-4 px-1">
                <div className="min-w-[1200px] bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/40 overflow-hidden">
                    {/* Main Grid Header */}
                    <div className="grid grid-cols-[220px_repeat(5,1fr)] bg-gray-50/50 border-b border-gray-200/60 backdrop-blur-sm">
                        <div className="p-4 font-semibold text-gray-700 flex items-center border-r border-gray-200/60 bg-gray-50/30">
                            Recurso
                        </div>
                        {weekDates.map((date, idx) => {
                            const isToday = new Date().toDateString() === date.toDateString()
                            return (
                                <div
                                    key={idx}
                                    className={cn(
                                        "p-3 text-center border-r border-gray-200/60 last:border-r-0 flex flex-col items-center justify-center relative overflow-hidden transition-colors duration-300",
                                        isToday ? "bg-red-50/40" : "hover:bg-gray-50/30"
                                    )}
                                >
                                    {isToday && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-red-600 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />}
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1.5">{WORK_DAYS[idx]}</span>
                                    <div className={cn(
                                        "text-sm font-bold w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-300",
                                        isToday ? "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/30 scale-110" : "text-gray-700 bg-white shadow-sm border border-gray-100"
                                    )}>
                                        {date.getDate()}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Resources Rows */}
                    <div className="divide-y divide-gray-100/60">
                        {filteredResources.map((resource) => (
                            <div key={resource.id} className="group bg-white/40 hover:bg-white/80 transition-all duration-300">
                                <div className="grid grid-cols-[220px_repeat(5,1fr)]">
                                    {/* Resource Info Column */}
                                    <div
                                        className="p-4 border-r border-gray-200/60 relative group/resource flex flex-col justify-center cursor-pointer hover:bg-gray-50/50 transition-colors"
                                        onClick={() => toggleResource(resource.id)}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={cn(
                                                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm",
                                                expandedResources.has(resource.id)
                                                    ? "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-red-500/20"
                                                    : "bg-white border border-gray-200 text-gray-400 group-hover/resource:border-red-200 group-hover/resource:text-red-500"
                                            )}>
                                                {viewMode === "operario" ? <User className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}
                                            </div>
                                            <div className="min-w-0 flex-1 pt-0.5">
                                                <div className="flex items-center gap-2">
                                                    <div className="font-bold text-sm text-gray-800 truncate group-hover/resource:text-red-600 transition-colors">{toTitleCase(resource.name)}</div>
                                                    {expandedResources.has(resource.id) ? (
                                                        <ChevronUp className="h-3 w-3 text-gray-400" />
                                                    ) : (
                                                        <ChevronDown className="h-3 w-3 text-gray-400" />
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-gray-400 mt-0.5 truncate font-medium">
                                                    {resource.skills ? resource.skills.map((s) => PROCESS_LABELS[s as keyof typeof PROCESS_LABELS] || s).join(", ") : "Sin especialidad"}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Days Columns */}
                                    {weekDates.map((date, dayIdx) => {
                                        const dateStr = formatDate(date)
                                        const load = calculateResourceLoad(visibleTasks, resource.id, dateStr)
                                        const overloaded = isOverloaded(load)
                                        const isToday = new Date().toDateString() === date.toDateString()

                                        const isDropTarget = dragOverCell?.resourceId === resource.id &&
                                            dragOverCell?.date === dateStr &&
                                            dragOverCell?.hour === -1

                                        return (
                                            <div
                                                key={dayIdx}
                                                className={cn(
                                                    "relative border-r border-gray-100/60 last:border-r-0 min-h-[70px] transition-colors duration-300",
                                                    isToday ? "bg-red-50/20" : "",
                                                    isDropTarget ? "bg-blue-50/60 shadow-inner ring-2 ring-inset ring-blue-200" : ""
                                                )}
                                                onDragOver={(e) => handleDragOver(e, resource.id, dateStr, -1)}
                                                onDrop={() => handleDrop(resource.id, dateStr, -1)}
                                            >
                                                {/* Load Indicator */}
                                                <div className="absolute top-2 right-2 z-10">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger>
                                                                <div className={cn(
                                                                    "text-[10px] font-bold px-2 py-1 rounded-lg border shadow-sm backdrop-blur-sm",
                                                                    overloaded
                                                                        ? "bg-red-100/80 text-red-700 border-red-200"
                                                                        : load > 0
                                                                            ? "bg-green-100/80 text-green-700 border-green-200"
                                                                            : "bg-gray-100/80 text-gray-400 border-gray-200"
                                                                )}>
                                                                    {Number(load.toFixed(1))}h
                                                                </div>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>Carga: {Number(load.toFixed(2))}h / {WORK_HOURS.total}h</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </div>

                                                {/* Expanded View (Hourly Grid) */}
                                                <AnimatePresence>
                                                    {expandedResources.has(resource.id) && (
                                                        <motion.div
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: "auto", opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            transition={{ duration: 0.3, ease: "easeInOut" }}
                                                            className="overflow-hidden"
                                                        >
                                                            <div className="grid grid-rows-9 border-t border-gray-100/60 mt-12 bg-white/30">
                                                                {hours.map((hour) => {
                                                                    const startingTasks = getTasksStartingInHour(resource.id, dateStr, hour)
                                                                    const isDropTarget = dragOverCell?.resourceId === resource.id &&
                                                                        dragOverCell?.date === dateStr &&
                                                                        dragOverCell?.hour === hour

                                                                    return (
                                                                        <div
                                                                            key={hour}
                                                                            className={cn(
                                                                                "h-14 border-b border-gray-50/60 relative transition-all duration-200",
                                                                                isDropTarget ? "bg-blue-50/60 shadow-inner" : "hover:bg-white/40"
                                                                            )}
                                                                            onDragOver={(e) => handleDragOver(e, resource.id, dateStr, hour)}
                                                                            onDrop={() => handleDrop(resource.id, dateStr, hour)}
                                                                        >
                                                                            {/* Hour Label */}
                                                                            {dayIdx === 0 && (
                                                                                <span className="absolute left-1 top-1 text-[9px] text-gray-300 font-mono font-medium tracking-tighter">
                                                                                    {formatTime(hour)}
                                                                                </span>
                                                                            )}

                                                                            {/* Tasks */}
                                                                            <div className="relative h-full w-full px-1 py-0.5">
                                                                                {startingTasks.map((task, index) => {
                                                                                    let startH = Number.parseInt(task.startTime.split(":")[0])
                                                                                    let endH = Number.parseInt(task.endTime.split(":")[0])
                                                                                    if (task.startDate < dateStr) startH = WORK_HOURS.start
                                                                                    if (task.endDate > dateStr) endH = WORK_HOURS.end
                                                                                    const taskDuration = endH - startH
                                                                                    const widthPercent = 100 / startingTasks.length
                                                                                    const leftPercent = widthPercent * index

                                                                                    return (
                                                                                        <HoverCard key={task.id} openDelay={0} closeDelay={400}>
                                                                                            <HoverCardTrigger asChild>
                                                                                                <motion.div
                                                                                                    layoutId={task.id}
                                                                                                    draggable
                                                                                                    onDragStart={() => handleDragStart(task)}
                                                                                                    onDragEnd={() => setDraggedTask(null)}
                                                                                                    onClick={(e) => {
                                                                                                        // Prevent click if dragging (though usually handled by DnD logic)
                                                                                                        if (draggedTask) return;
                                                                                                        e.stopPropagation();
                                                                                                        onTaskClick?.(task);
                                                                                                    }}
                                                                                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                                                                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                                                                                    whileHover={{ scale: 1.02, zIndex: 50, y: -2 }}
                                                                                                    whileDrag={{ scale: 1.05, zIndex: 100, opacity: 0.8 }}
                                                                                                    className={cn(
                                                                                                        "absolute rounded-xl p-2.5 text-xs cursor-pointer active:cursor-grabbing shadow-sm border border-white/20 overflow-hidden group/task transition-shadow duration-200",
                                                                                                        STATUS_GRADIENTS[task.status] || STATUS_GRADIENTS["nuevo"],
                                                                                                        draggedTask === task.id && "opacity-50 grayscale blur-[1px]"
                                                                                                    )}
                                                                                                    style={{
                                                                                                        height: `${taskDuration * 56 - 4}px`, // 56px per hour row
                                                                                                        top: "2px",
                                                                                                        left: `${leftPercent}%`,
                                                                                                        width: `${widthPercent}%`,
                                                                                                        zIndex: 10 + index
                                                                                                    }}
                                                                                                >
                                                                                                    {/* Glass Shine Effect */}
                                                                                                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover/task:opacity-100 transition-opacity duration-300" />

                                                                                                    <div className="relative z-10 flex flex-col h-full text-white">
                                                                                                        <div className="font-bold truncate text-[11px] leading-tight drop-shadow-sm">
                                                                                                            {toTitleCase(task.workOrderNumber)}
                                                                                                        </div>
                                                                                                        <div className="text-[10px] opacity-90 truncate mt-0.5 font-medium">
                                                                                                            {toTitleCase(PROCESS_LABELS[task.process as keyof typeof PROCESS_LABELS] || task.process)}
                                                                                                        </div>

                                                                                                        {task.isDelayed && (
                                                                                                            <div className="absolute top-1 right-1 bg-red-500 rounded-full p-1 shadow-sm animate-pulse">
                                                                                                                <AlertTriangle className="h-2 w-2 text-white" />
                                                                                                            </div>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </motion.div>
                                                                                            </HoverCardTrigger>
                                                                                            <HoverCardContent side="right" align="start" sideOffset={0} className="p-0 border-0 overflow-hidden rounded-2xl shadow-2xl bg-white/95 backdrop-blur-xl ring-1 ring-black/5 w-80 z-[60]">
                                                                                                <div>
                                                                                                    {/* Header */}
                                                                                                    <div className={cn("p-5 text-white relative overflow-hidden",
                                                                                                        STATUS_GRADIENTS[task.status] || STATUS_GRADIENTS["nuevo"]
                                                                                                    )}>
                                                                                                        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                                                                                                        <div className="absolute bottom-0 right-0 opacity-10 transform translate-x-1/4 translate-y-1/4">
                                                                                                            <Wrench className="w-24 h-24" />
                                                                                                        </div>
                                                                                                        <div className="relative z-10">
                                                                                                            <div className="flex items-start justify-between">
                                                                                                                <div>
                                                                                                                    <div className="text-[10px] uppercase tracking-wider font-bold opacity-80 mb-1">Orden de Trabajo</div>
                                                                                                                    <div className="font-bold text-2xl tracking-tight leading-none">{toTitleCase(task.workOrderNumber)}</div>
                                                                                                                </div>
                                                                                                                {task.isDelayed && (
                                                                                                                    <div className="bg-red-500/20 backdrop-blur-md p-1.5 rounded-lg border border-white/20 shadow-sm">
                                                                                                                        <AlertTriangle className="h-5 w-5 text-white animate-pulse" />
                                                                                                                    </div>
                                                                                                                )}
                                                                                                            </div>

                                                                                                            <div className="flex flex-wrap gap-2 mt-4">
                                                                                                                <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30 border-0 text-[10px] h-6 px-2.5 backdrop-blur-md shadow-sm">
                                                                                                                    {PRIORITY_LABELS[task.priority]}
                                                                                                                </Badge>
                                                                                                                <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30 border-0 text-[10px] h-6 px-2.5 backdrop-blur-md shadow-sm">
                                                                                                                    {STATUS_LABELS[task.status]}
                                                                                                                </Badge>
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    </div>

                                                                                                    {/* Body */}
                                                                                                    <div className="p-5 space-y-5">
                                                                                                        {/* Info Grid */}
                                                                                                        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                                                                                                            <div className="col-span-2">
                                                                                                                <div className="flex items-center gap-2 mb-1.5">
                                                                                                                    <User className="w-3.5 h-3.5 text-gray-400" />
                                                                                                                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Cliente</span>
                                                                                                                </div>
                                                                                                                <div className="font-semibold text-gray-900 text-sm pl-5.5">
                                                                                                                    {task.client || <span className="text-gray-400 italic font-normal">Sin cliente asignado</span>}
                                                                                                                </div>
                                                                                                            </div>

                                                                                                            <div className="col-span-2">
                                                                                                                <div className="flex items-center gap-2 mb-1.5">
                                                                                                                    <Wrench className="w-3.5 h-3.5 text-gray-400" />
                                                                                                                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Proceso</span>
                                                                                                                </div>
                                                                                                                <div className="font-semibold text-gray-900 text-sm pl-5.5 leading-snug">
                                                                                                                    {toTitleCase(PROCESS_LABELS[task.process as keyof typeof PROCESS_LABELS] || task.process)}
                                                                                                                </div>
                                                                                                            </div>

                                                                                                            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                                                                                                <div className="flex items-center gap-2 mb-1">
                                                                                                                    <Clock className="w-3.5 h-3.5 text-blue-500" />
                                                                                                                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Horario</span>
                                                                                                                </div>
                                                                                                                <div className="font-bold text-gray-900 text-sm">
                                                                                                                    {task.startTime} - {task.endTime}
                                                                                                                </div>
                                                                                                            </div>

                                                                                                            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                                                                                                <div className="flex items-center gap-2 mb-1">
                                                                                                                    <Calendar className="w-3.5 h-3.5 text-purple-500" />
                                                                                                                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Duración</span>
                                                                                                                </div>
                                                                                                                <div className="font-bold text-gray-900 text-sm">
                                                                                                                    {task.duration}h
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        </div>

                                                                                                        {/* Notes */}
                                                                                                        {task.notes && (
                                                                                                            <div className="bg-amber-50/60 p-3.5 rounded-xl border border-amber-100/60 text-xs text-amber-900/80 leading-relaxed relative overflow-hidden">
                                                                                                                <div className="absolute top-0 left-0 w-1 h-full bg-amber-300" />
                                                                                                                <span className="font-bold block mb-1.5 flex items-center gap-1.5 text-amber-700">
                                                                                                                    <MoreHorizontal className="h-3.5 w-3.5" /> Notas
                                                                                                                </span>
                                                                                                                {task.notes}
                                                                                                            </div>
                                                                                                        )}

                                                                                                        {/* Actions */}
                                                                                                        <div className="pt-2">
                                                                                                            <DropdownMenu>
                                                                                                                <DropdownMenuTrigger asChild>
                                                                                                                    <Button
                                                                                                                        variant="outline"
                                                                                                                        size="sm"
                                                                                                                        className="w-full justify-between text-xs h-9 font-medium border-gray-200 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-300 transition-all shadow-sm"
                                                                                                                    >
                                                                                                                        <span className="flex items-center gap-2">
                                                                                                                            <span className={cn("w-2 h-2 rounded-full",
                                                                                                                                task.status === "nuevo" ? "bg-gray-400" :
                                                                                                                                    task.status === "en_proceso" ? "bg-blue-500" : "bg-green-500"
                                                                                                                            )} />
                                                                                                                            {STATUS_LABELS[task.status]}
                                                                                                                        </span>
                                                                                                                        <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                                                                                                                    </Button>
                                                                                                                </DropdownMenuTrigger>
                                                                                                                <DropdownMenuContent className="w-72 p-1.5 rounded-xl shadow-xl border-gray-100 z-[70]">
                                                                                                                    <DropdownMenuItem onClick={() => task.dbId && onStatusChange?.(task.dbId.toString(), "1")} className="rounded-lg py-2.5 px-3 focus:bg-gray-50 cursor-pointer">
                                                                                                                        <Circle className="h-2.5 w-2.5 mr-3 fill-gray-400 text-gray-400" />
                                                                                                                        <div className="flex flex-col">
                                                                                                                            <span className="font-medium text-gray-700">Pendiente</span>
                                                                                                                            <span className="text-[10px] text-gray-400">La tarea aún no ha comenzado</span>
                                                                                                                        </div>
                                                                                                                    </DropdownMenuItem>
                                                                                                                    <DropdownMenuItem onClick={() => task.dbId && onStatusChange?.(task.dbId.toString(), "2")} className="rounded-lg py-2.5 px-3 focus:bg-blue-50 focus:text-blue-700 cursor-pointer">
                                                                                                                        <Circle className="h-2.5 w-2.5 mr-3 fill-blue-500 text-blue-500" />
                                                                                                                        <div className="flex flex-col">
                                                                                                                            <span className="font-medium text-blue-700">En Proceso</span>
                                                                                                                            <span className="text-[10px] text-blue-400/80">La tarea está en curso</span>
                                                                                                                        </div>
                                                                                                                    </DropdownMenuItem>
                                                                                                                    <DropdownMenuItem onClick={() => task.dbId && onStatusChange?.(task.dbId.toString(), "3")} className="rounded-lg py-2.5 px-3 focus:bg-green-50 focus:text-green-700 cursor-pointer">
                                                                                                                        <CheckCircle2 className="h-2.5 w-2.5 mr-3 text-green-500" />
                                                                                                                        <div className="flex flex-col">
                                                                                                                            <span className="font-medium text-green-700">Finalizado</span>
                                                                                                                            <span className="text-[10px] text-green-400/80">La tarea se ha completado</span>
                                                                                                                        </div>
                                                                                                                    </DropdownMenuItem>
                                                                                                                </DropdownMenuContent>
                                                                                                            </DropdownMenu>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                </div>
                                                                                            </HoverCardContent>
                                                                                        </HoverCard>
                                                                                    )
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Task Tray (Bandeja de Tareas) */}
            <motion.div
                initial={{ y: "80%" }}
                animate={{ y: isTrayOpen || draggedTask ? "0%" : "85%" }}
                transition={{ type: "spring", damping: 20, stiffness: 100 }}
                className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 pt-10 pointer-events-none flex justify-center"
            >
                <div
                    className="w-full max-w-4xl bg-white/90 backdrop-blur-2xl rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] border border-white/50 pointer-events-auto overflow-hidden"
                    onMouseEnter={() => setIsTrayOpen(true)}
                    onMouseLeave={() => setIsTrayOpen(false)}
                    onDragOver={handleDragOverTray}
                    onDrop={handleDropToTray}
                >
                    {/* Handle */}
                    <div className="absolute top-0 left-0 w-full h-8 flex items-center justify-center cursor-pointer bg-gradient-to-b from-white/50 to-transparent" onClick={() => setIsTrayOpen(!isTrayOpen)}>
                        <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
                    </div>

                    <div className="p-6 pt-8">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600">
                                    <MoreHorizontal className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900">Bandeja de Tareas</h3>
                                    <p className="text-xs text-gray-500">Arrastra tareas aquí para moverlas entre semanas</p>
                                </div>
                            </div>
                            <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-100">
                                {trayTasks.length} Tareas
                            </Badge>
                        </div>

                        <div className={cn(
                            "min-h-[100px] rounded-2xl border-2 border-dashed transition-colors flex gap-3 p-3 overflow-x-auto items-center",
                            draggedTask && !trayTasks.some(t => t.id === draggedTask)
                                ? "border-indigo-400 bg-indigo-50/50"
                                : "border-gray-200 bg-gray-50/30"
                        )}>
                            {trayTasks.length === 0 ? (
                                <div className="w-full text-center text-gray-400 text-sm py-4">
                                    {draggedTask ? "¡Suelta aquí para guardar!" : "La bandeja está vacía"}
                                </div>
                            ) : (
                                trayTasks.map((task) => (
                                    <motion.div
                                        key={task.id}
                                        layoutId={task.id}
                                        draggable
                                        onDragStart={() => handleDragStart(task)}
                                        onDragEnd={() => setDraggedTask(null)}
                                        whileHover={{ scale: 1.05, y: -5 }}
                                        whileDrag={{ scale: 1.1, opacity: 0.8 }}
                                        className={cn(
                                            "flex-shrink-0 w-48 p-3 rounded-xl shadow-sm border border-white/50 cursor-grab active:cursor-grabbing relative group",
                                            STATUS_GRADIENTS[task.status] || STATUS_GRADIENTS["nuevo"]
                                        )}
                                    >
                                        <div className="text-white">
                                            <div className="font-bold text-xs truncate">{toTitleCase(task.workOrderNumber)}</div>
                                            <div className="text-[10px] opacity-90 truncate mt-0.5">{task.client}</div>
                                            <div className="mt-2 flex items-center justify-between text-[10px] opacity-80 border-t border-white/20 pt-1">
                                                <span>{task.duration}h</span>
                                                <span>{STATUS_LABELS[task.status]}</span>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Legend */}
            <div className="flex flex-wrap gap-6 justify-center bg-white/60 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-white/40">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-gray-400 rounded-full shadow-sm shadow-gray-400/50" />
                    <span className="text-sm text-gray-600 font-medium">Pendiente</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full shadow-sm shadow-blue-500/50" />
                    <span className="text-sm text-gray-600 font-medium">En Proceso</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full shadow-sm shadow-green-500/50" />
                    <span className="text-sm text-gray-600 font-medium">Finalizado</span>
                </div>
                <div className="w-px h-4 bg-gray-300" />
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <span className="text-sm text-gray-600 font-medium">Con retraso</span>
                </div>
            </div>
        </div>
    )
}
