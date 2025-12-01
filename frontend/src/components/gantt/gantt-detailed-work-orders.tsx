"use client";

import React, { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar, Clock, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    getWeekDates,
    formatDate,
    formatTime,
    WORK_DAYS,
    PRIORITY_COLORS,
} from "@/lib/gantt-utils";
import type { GanttTask } from "@/lib/types";

interface GanttDetailedWorkOrdersProps {
    tasks: GanttTask[];
    onTaskClick?: (task: GanttTask) => void;
    onTaskMove?: (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => void;
}

export function GanttDetailedWorkOrders({ tasks, onTaskClick, onTaskMove }: GanttDetailedWorkOrdersProps) {
    const [currentWeek, setCurrentWeek] = useState(0);
    const [zoom, setZoom] = useState(1); // 1 = 100%
    const [draggedTask, setDraggedTask] = useState<string | null>(null);
    const [dragOverCell, setDragOverCell] = useState<{ otNumber: string; date: string; hour: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const startX = useRef(0);
    const startY = useRef(0);
    const scrollLeft = useRef(0);
    const scrollTop = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (containerRef.current && e.button === 0) {
            isDragging.current = true;
            startX.current = e.pageX - containerRef.current.offsetLeft;
            startY.current = e.pageY - containerRef.current.offsetTop;
            scrollLeft.current = containerRef.current.scrollLeft;
            scrollTop.current = containerRef.current.scrollTop;
            containerRef.current.style.cursor = 'grabbing';
        }
    }, []);

    const handleMouseLeave = useCallback(() => {
        isDragging.current = false;
        if (containerRef.current) containerRef.current.style.cursor = 'grab';
    }, []);

    const handleMouseUp = useCallback(() => {
        isDragging.current = false;
        if (containerRef.current) containerRef.current.style.cursor = 'grab';
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging.current || !containerRef.current) return;
        e.preventDefault();
        const x = e.pageX - containerRef.current.offsetLeft;
        const y = e.pageY - containerRef.current.offsetTop;
        const walkX = x - startX.current;
        const walkY = y - startY.current;
        containerRef.current.scrollLeft = scrollLeft.current - walkX;
        containerRef.current.scrollTop = scrollTop.current - walkY;
    }, []);

    const weekDates = getWeekDates(currentWeek);
    const firstDate = weekDates[0];
    const lastDate = weekDates[4];

    // Group tasks by Work Order
    const tasksByOT = tasks.reduce((acc, task) => {
        if (!acc[task.workOrderNumber]) {
            acc[task.workOrderNumber] = [];
        }
        acc[task.workOrderNumber].push(task);
        return acc;
    }, {} as Record<string, GanttTask[]>);

    const sortedOTs = Object.keys(tasksByOT).sort((a, b) => parseInt(a) - parseInt(b));

    const handleDragStart = (taskId: string) => {
        setDraggedTask(taskId);
    };

    const handleDragOver = (e: React.DragEvent, otNumber: string, date: string, hour: number) => {
        e.preventDefault();
        setDragOverCell({ otNumber, date, hour });
    };

    const handleDragLeave = () => {
        setDragOverCell(null);
    };

    const handleDrop = (otNumber: string, date: string, hour: number) => {
        if (draggedTask && onTaskMove) {
            const task = tasks.find((t) => t.id === draggedTask);
            if (task) {
                const newStartTime = formatTime(hour);
                onTaskMove(draggedTask, task.resourceId, date, newStartTime);
            }
        }
        setDraggedTask(null);
        setDragOverCell(null);
    };

    const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 5));
    const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 1));

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
                        <ClipboardList className="h-6 w-6 text-red-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 tracking-tight">Procesos</h3>
                        <p className="text-sm text-gray-500 font-medium">Vista detallada por Orden de Trabajo</p>
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
                            {lastDate.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
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
                    <div className="flex items-center gap-1 bg-white/50 p-1 rounded-xl border border-gray-100 shadow-sm">
                        <Button variant="ghost" size="icon" onClick={zoomOut} title="Zoom Out" className="h-7 w-7 rounded-lg hover:bg-white hover:shadow-sm">
                            <ZoomOut className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={zoomIn} title="Zoom In" className="h-7 w-7 rounded-lg hover:bg-white hover:shadow-sm">
                            <ZoomIn className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50/80 text-blue-700 rounded-xl text-xs font-bold border border-blue-100/50 shadow-sm backdrop-blur-sm">
                        <Clock className="h-3.5 w-3.5" />
                        <span>09:00 - 18:00</span>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div
                className="overflow-auto cursor-grab pb-4 px-1"
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeave}
                onMouseUp={handleMouseUp}
                onMouseMove={handleMouseMove}
                style={{ height: 'calc(100vh - 240px)' }}
            >
                <div style={{ width: `${zoom * 100}%`, minWidth: '100%' }} className="bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/40 overflow-hidden">
                    <div>
                        {/* Table Header */}
                        <div className="grid grid-cols-[150px_repeat(5,1fr)] gap-px bg-gray-50/50 border-b border-gray-200/60 backdrop-blur-sm sticky top-0 z-40">
                            <div className="bg-gray-50/30 text-gray-700 p-3 font-semibold text-sm flex items-center justify-center sticky left-0 z-50 border-r border-gray-200/60">
                                ORDEN TRABAJO
                            </div>
                            {weekDates.map((date, idx) => {
                                const isToday = new Date().toDateString() === date.toDateString()
                                return (
                                    <div key={idx} className={cn(
                                        "p-2 text-center border-r border-gray-200/60 last:border-r-0 flex flex-col items-center justify-center relative overflow-hidden transition-colors duration-300",
                                        isToday ? "bg-red-50/40" : "hover:bg-gray-50/30"
                                    )}>
                                        {isToday && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-red-600 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />}
                                        <div className="font-bold text-[10px] text-gray-400 uppercase tracking-[0.2em] mb-1.5">{WORK_DAYS[idx]}</div>
                                        <div className={cn(
                                            "text-sm font-bold w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-300 mb-1",
                                            isToday ? "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/30 scale-110" : "text-gray-700 bg-white shadow-sm border border-gray-100"
                                        )}>
                                            {date.getDate()}
                                        </div>
                                        <div className="flex justify-between text-[9px] opacity-60 px-1 font-mono w-full text-gray-500">
                                            {zoom < 1.5 ? (
                                                <>
                                                    <span>09</span>
                                                    <span>12</span>
                                                    <span>15</span>
                                                    <span>18</span>
                                                </>
                                            ) : (
                                                Array.from({ length: 10 }, (_, i) => 9 + i).map((hour) => (
                                                    <span key={hour}>{hour}</span>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        {/* Table Body */}
                        <div className="divide-y divide-gray-100/60">
                            {sortedOTs.map((otNumber) => {
                                const otTasks = tasksByOT[otNumber];

                                const weekTaskGroups: Record<string, GanttTask[]> = {};
                                weekDates.forEach((d) => {
                                    const dStr = formatDate(d);
                                    weekTaskGroups[dStr] = otTasks.filter((t) => t.startDate === dStr);
                                });

                                const hasTasksInWeek = Object.values(weekTaskGroups).some((g) => g.length > 0);
                                if (!hasTasksInWeek) return null;

                                const maxTasksInDay = Math.max(
                                    ...weekDates.map((d) => {
                                        const dStr = formatDate(d);
                                        return (weekTaskGroups[dStr] || []).length;
                                    })
                                );
                                const rowHeight = Math.max(100, maxTasksInDay * 45 + 20);

                                return (
                                    <div key={otNumber} className="grid grid-cols-[150px_repeat(5,1fr)] gap-px bg-white/40 hover:bg-white/80 transition-all duration-300 group">
                                        <div className="bg-white border-r border-gray-200/60 p-4 flex items-center justify-center font-bold text-lg text-gray-700 sticky left-0 z-30 group-hover:bg-gray-50/50 transition-colors shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)]">
                                            OT {otNumber}
                                        </div>
                                        {weekDates.map((date, dayIdx) => {
                                            const dateStr = formatDate(date);
                                            const dayTasks = weekTaskGroups[dateStr] || [];
                                            dayTasks.sort((a, b) => a.startTime.localeCompare(b.startTime));
                                            const isToday = new Date().toDateString() === date.toDateString()

                                            return (
                                                <div key={dayIdx} className={cn(
                                                    "relative border-r border-gray-100/60 last:border-r-0 transition-colors duration-300",
                                                    isToday ? "bg-red-50/20" : ""
                                                )} style={{ height: `${rowHeight}px` }}>
                                                    <div className="absolute inset-0 flex px-2">
                                                        {[...Array(9)].map((_, i) => {
                                                            const hour = 9 + i;
                                                            const isDropTarget =
                                                                dragOverCell?.otNumber === otNumber &&
                                                                dragOverCell?.date === dateStr &&
                                                                dragOverCell?.hour === hour;
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    className={cn(
                                                                        "flex-1 border-r border-gray-100/40 last:border-r-0 h-full transition-colors",
                                                                        isDropTarget ? "bg-blue-50/60 shadow-inner" : "hover:bg-white/40"
                                                                    )}
                                                                    onDragOver={(e) => handleDragOver(e, otNumber, dateStr, hour)}
                                                                    onDragLeave={handleDragLeave}
                                                                    onDrop={() => handleDrop(otNumber, dateStr, hour)}
                                                                ></div>
                                                            );
                                                        })}
                                                    </div>
                                                    {dayTasks.map((task, taskIdx) => {
                                                        const startHour = parseInt(task.startTime.split(':')[0]);
                                                        const startMin = parseInt(task.startTime.split(':')[1]);
                                                        const endHour = parseInt(task.endTime.split(':')[0]);
                                                        const endMin = parseInt(task.endTime.split(':')[1]);
                                                        const startTotalMins = (startHour - 9) * 60 + startMin;
                                                        const durationMins = (endHour * 60 + endMin) - (startHour * 60 + startMin);
                                                        const totalWorkDayMins = 9 * 60;
                                                        const leftPercent = (startTotalMins / totalWorkDayMins) * 100;
                                                        const widthPercent = (durationMins / totalWorkDayMins) * 100;
                                                        return (
                                                            <div
                                                                key={task.id}
                                                                draggable
                                                                onDragStart={() => handleDragStart(task.id)}
                                                                className={cn(
                                                                    "absolute h-10 rounded-xl text-xs text-white flex items-center px-2.5 cursor-grab active:cursor-grabbing hover:scale-[1.02] transition-all shadow-sm border border-white/20 overflow-hidden whitespace-nowrap z-10",
                                                                    PRIORITY_COLORS[task.priority],
                                                                    draggedTask === task.id && "opacity-50 grayscale blur-[1px]"
                                                                )}
                                                                style={{
                                                                    top: `${taskIdx * 45 + 10}px`,
                                                                    left: `${Math.max(0, leftPercent)}%`,
                                                                    width: `${Math.max(widthPercent, 2)}%`,
                                                                }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onTaskClick?.(task);
                                                                }}
                                                                title={`${task.process} - ${task.resourceName} (${task.startTime} - ${task.endTime})`}
                                                            >
                                                                {/* Glass Shine Effect */}
                                                                <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300" />

                                                                <div className="flex flex-col leading-none pointer-events-none relative z-10">
                                                                    <span className="font-bold text-[11px] truncate drop-shadow-sm">{task.process}</span>
                                                                    <span className="opacity-90 text-[10px] truncate font-medium">{task.resourceName}</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}

                            {/* Empty State */}
                            {sortedOTs.every((otNumber) => {
                                const otTasks = tasksByOT[otNumber];
                                return !weekDates.some((d) => {
                                    const dStr = formatDate(d);
                                    return otTasks.some((t) => t.startDate === dStr);
                                });
                            }) && (
                                    <div className="text-center p-12 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50 m-4">
                                        <p className="text-muted-foreground font-medium">No hay actividades planificadas para esta semana</p>
                                        <p className="text-sm text-gray-400 mt-1">Intenta navegar a otras semanas usando los controles superiores</p>
                                    </div>
                                )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
