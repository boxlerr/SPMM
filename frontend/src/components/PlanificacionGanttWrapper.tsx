"use client";

import React, { useEffect, useState } from "react";
import { GanttWeeklyDetailed } from "./gantt-weekly-detailed";
import { GanttMonthlyOverview } from "./gantt-monthly-overview";
import { convertPlanificacionToGanttTasks } from "@/lib/gantt-utils";
import type { GanttTask, Resource, PlanificacionItem } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import SidebarPanel from "./gantt/SidebarPanel";
import { usePanelContext } from "@/contexts/PanelContext";

export default function PlanificacionGanttWrapper() {
    const [tasks, setTasks] = useState<GanttTask[]>([]);
    const [resources, setResources] = useState<Resource[]>([]);
    const [rawPlanificacion, setRawPlanificacion] = useState<PlanificacionItem[]>([]);
    const [rawOperarios, setRawOperarios] = useState<any[]>([]);
    const [viewMode, setViewMode] = useState<"operario" | "maquina">("operario");
    const [isLoading, setIsLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState<PlanificacionItem | null>(null);
    const { isDetailsPanelOpen, setIsDetailsPanelOpen } = usePanelContext();

    // Helper for colors
    const getProcessColor = (processName: string) => {
        const colors: Record<string, string> = {
            "Torneado": "#3b82f6",
            "Fresado": "#10b981",
            "Soldadura": "#f59e0b",
            "Rectificado": "#8b5cf6",
            "Corte": "#ef4444",
            "Pulido": "#ec4899",
        };
        return colors[processName] || "#6b7280";
    };

    // Fetch data
    useEffect(() => {
        const fetchData = async () => {
            try {
                setIsLoading(true);
                // Fetch Planificacion
                const planResponse = await fetch("http://localhost:8000/planificacion");
                if (!planResponse.ok) throw new Error("Error fetching planificacion");
                const planData: PlanificacionItem[] = await planResponse.json();
                setRawPlanificacion(planData);

                const ganttTasks = convertPlanificacionToGanttTasks(planData);
                setTasks(ganttTasks);

                // Fetch Operarios
                const opResponse = await fetch("http://localhost:8000/operarios");
                if (opResponse.ok) {
                    const opData = await opResponse.json();
                    const rawOps = Array.isArray(opData.data) ? opData.data : (Array.isArray(opData) ? opData : []);
                    setRawOperarios(rawOps);

                    const mappedResources: Resource[] = rawOps.map((op: any) => ({
                        id: op.id.toString(),
                        name: `${op.nombre} ${op.apellido}`,
                        type: "operario",
                        skills: [] // TODO: Add skills if available in API
                    }));
                    setResources(mappedResources);
                }
            } catch (error) {
                console.error("Error loading Gantt data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    const handleTaskMove = async (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        // 1. Calculate time difference
        const oldStart = new Date(`${task.startDate}T${task.startTime}:00`);
        const newStart = new Date(`${newDate}T${newStartTime}:00`);

        const diffMillis = newStart.getTime() - oldStart.getTime();
        const diffMinutes = Math.round(diffMillis / 60000);

        if (diffMinutes === 0 && task.resourceId === newResourceId) return;

        // 2. Calculate new values
        const newInicioMin = (task.originalInicioMin || 0) + diffMinutes;
        const newFinMin = (task.originalFinMin || 0) + diffMinutes;
        const newOperarioId = parseInt(newResourceId);

        // 3. Optimistic Update
        const oldTasks = [...tasks];
        setTasks(prev => prev.map(t => {
            if (t.id === taskId) {
                // Calculate new end time for UI
                const newEndMillis = newStart.getTime() + (t.duration * 60 * 60 * 1000);
                const newEnd = new Date(newEndMillis);

                return {
                    ...t,
                    startDate: newDate,
                    startTime: newStartTime,
                    endDate: newEnd.toISOString().split('T')[0],
                    endTime: `${newEnd.getHours().toString().padStart(2, '0')}:${newEnd.getMinutes().toString().padStart(2, '0')}`,
                    resourceId: newResourceId,
                    originalInicioMin: newInicioMin,
                    originalFinMin: newFinMin
                };
            }
            return t;
        }));

        // 4. API Call
        try {
            const response = await fetch(`http://localhost:8000/planificacion/${task.dbId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    inicio_min: newInicioMin,
                    fin_min: newFinMin,
                    id_operario: isNaN(newOperarioId) ? undefined : newOperarioId
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to update task");
            }
        } catch (error) {
            console.error("Error updating task:", error);
            // Rollback
            setTasks(oldTasks);
            // TODO: Show toast error
        }
    };

    const handleTaskClick = (task: GanttTask) => {
        const originalItem = rawPlanificacion.find(p => p.id === task.dbId);
        if (originalItem) {
            setSelectedTask(originalItem);
            setIsDetailsPanelOpen(true);
        }
    };

    const handleOperatorChange = async (newOpId: string) => {
        if (!selectedTask) return;
        const opId = parseInt(newOpId);

        // Optimistic update
        const updatedItem = { ...selectedTask, id_operario: opId };
        setSelectedTask(updatedItem);

        // Update raw list
        setRawPlanificacion(prev => prev.map(p => p.id === selectedTask.id ? updatedItem : p));

        // Update Gantt tasks
        setTasks(prev => prev.map(t => {
            if (t.dbId === selectedTask.id) {
                return { ...t, resourceId: newOpId };
            }
            return t;
        }));

        try {
            await fetch(`http://localhost:8000/planificacion/${selectedTask.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_operario: opId }),
            });
        } catch (error) {
            console.error("Error updating operator:", error);
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center">Cargando planificación...</div>;
    }

    return (
        <div className="flex min-h-screen">
            <div className={`flex-1 flex flex-col space-y-4 p-4 transition-all duration-300 ${isDetailsPanelOpen ? "mr-80" : ""} min-w-0`}>
                <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold">Planificación de Producción</h2>
                    <div className="flex gap-2">
                        <Button
                            variant={viewMode === "operario" ? "default" : "outline"}
                            onClick={() => setViewMode("operario")}
                        >
                            Operarios
                        </Button>
                        <Button
                            variant={viewMode === "maquina" ? "default" : "outline"}
                            onClick={() => setViewMode("maquina")}
                        >
                            Máquinas
                        </Button>
                    </div>
                </div>

                <Tabs defaultValue="weekly" className="w-full flex-1 flex flex-col">
                    <TabsList>
                        <TabsTrigger value="weekly">Semanal Detallado</TabsTrigger>
                        <TabsTrigger value="monthly">Mensual General</TabsTrigger>
                    </TabsList>

                    <TabsContent value="weekly" className="mt-4 flex-1 overflow-auto">
                        <GanttWeeklyDetailed
                            tasks={tasks}
                            resources={resources}
                            viewMode={viewMode}
                            onTaskMove={handleTaskMove}
                            onTaskClick={handleTaskClick}
                        />
                    </TabsContent>

                    <TabsContent value="monthly" className="mt-4 flex-1 overflow-auto">
                        <GanttMonthlyOverview
                            tasks={tasks}
                            resources={resources}
                            viewMode={viewMode}
                            onTaskClick={handleTaskClick}
                            onTaskMove={handleTaskMove}
                        />
                    </TabsContent>
                </Tabs>
            </div>

            <SidebarPanel
                isOpen={isDetailsPanelOpen}
                selectedItem={selectedTask}
                onClose={() => setIsDetailsPanelOpen(false)}
                getProcessColor={getProcessColor}
                operarios={rawOperarios}
                onOperatorChange={handleOperatorChange}
            />
        </div>
    );
}
