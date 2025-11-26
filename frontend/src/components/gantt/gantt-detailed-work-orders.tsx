"use client";

import React, { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar, Clock } from "lucide-react";
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
        <Card className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <h3 className="text-xl font-bold text-foreground">Ordenes de Trabajo Detallado</h3>
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
                        {/* Zoom controls */}
                        <Button variant="outline" size="sm" onClick={zoomOut} title="Zoom Out">
                            <ZoomOut className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={zoomIn} title="Zoom In">
                            <ZoomIn className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Turno: 09:00 - 18:00</span>
                </div>
            </div>

            {/* Main Content */}
            <div
                className="overflow-auto cursor-grab"
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeave}
                onMouseUp={handleMouseUp}
                onMouseMove={handleMouseMove}
                style={{ height: 'calc(100vh - 240px)' }}
            >
                <div style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
                    <div>
                        {/* Table Header */}
                        <div className="grid grid-cols-[150px_repeat(5,1fr)] gap-px bg-border mb-4 rounded-xl shadow-sm sticky top-0 z-40">
                            <div className="bg-primary text-primary-foreground p-3 font-semibold flex items-center justify-center sticky left-0 z-50 rounded-tl-xl rounded-bl-xl shadow-[4px_0_8px_rgba(0,0,0,0.1)]">
                                ORDEN TRABAJO
                            </div>
                            {weekDates.map((date, idx) => (
                                <div key={idx} className={`bg-primary text-primary-foreground p-2 text-center ${idx === weekDates.length - 1 ? 'rounded-tr-xl rounded-br-xl' : ''}`}>
                                    <div className="font-semibold">{WORK_DAYS[idx]}</div>
                                    <div className="text-xs opacity-90 mb-1">
                                        {date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                                    </div>
                                    <div className="flex justify-between text-[10px] opacity-80 px-1">
                                        {zoom < 1.5 ? (
                                            <>
                                                <span>9</span>
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
                            ))}
                        </div>

                        {/* Table Body */}
                        <div className="space-y-4">
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
                                    <div key={otNumber} className="grid grid-cols-[150px_repeat(5,1fr)] gap-px bg-border border rounded-xl shadow-sm">
                                        <div className="bg-card p-4 flex items-center justify-center font-bold text-lg border-r-2 border-primary sticky left-0 z-30 rounded-tl-xl rounded-bl-xl shadow-[4px_0_8px_rgba(0,0,0,0.1)]">
                                            OT {otNumber}
                                        </div>
                                        {weekDates.map((date, dayIdx) => {
                                            const dateStr = formatDate(date);
                                            const dayTasks = weekTaskGroups[dateStr] || [];
                                            dayTasks.sort((a, b) => a.startTime.localeCompare(b.startTime));
                                            return (
                                                <div key={dayIdx} className="bg-card p-2 relative" style={{ height: `${rowHeight}px` }}>
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
                                                                    className={`flex-1 border-r border-gray-200 last:border-r-0 h-full transition-colors ${isDropTarget ? 'bg-primary/20' : ''
                                                                        }`}
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
                                                                className={`absolute h-10 rounded-md text-xs text-white flex items-center px-2 cursor-grab active:cursor-grabbing hover:opacity-90 hover:scale-[1.02] transition-all shadow-sm border border-white/20 overflow-hidden whitespace-nowrap ${PRIORITY_COLORS[task.priority]} ${draggedTask === task.id ? 'opacity-50' : ''
                                                                    }`}
                                                                style={{
                                                                    top: `${taskIdx * 45 + 10}px`,
                                                                    left: `${Math.max(0, leftPercent)}%`,
                                                                    width: `${Math.max(widthPercent, 2)}%`,
                                                                    zIndex: 10,
                                                                }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onTaskClick?.(task);
                                                                }}
                                                                title={`${task.process} - ${task.resourceName} (${task.startTime} - ${task.endTime})`}
                                                            >
                                                                <div className="flex flex-col leading-none pointer-events-none">
                                                                    <span className="font-bold text-[11px] truncate">{task.process}</span>
                                                                    <span className="opacity-90 text-[10px] truncate">{task.resourceName}</span>
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
                                    <div className="text-center p-12 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                                        <p className="text-muted-foreground font-medium">No hay actividades planificadas para esta semana</p>
                                        <p className="text-sm text-gray-400 mt-1">Intenta navegar a otras semanas usando los controles superiores</p>
                                    </div>
                                )}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
}
