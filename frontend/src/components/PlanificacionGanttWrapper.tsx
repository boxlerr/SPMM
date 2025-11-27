"use client";

import React, { useEffect, useState } from "react";
import { GanttWeeklyDetailed } from "./gantt-weekly-detailed";
import { GanttMonthlyOverview } from "./gantt-monthly-overview";
import { GanttDetailedWorkOrders } from "./gantt/gantt-detailed-work-orders";
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

        const oldStart = new Date(`${task.startDate}T${task.startTime}:00`);
        const newStart = new Date(`${newDate}T${newStartTime}:00`);
        const newOperarioId = parseInt(newResourceId);

        // Import calculateWorkingMinutes dynamically
        const { calculateWorkingMinutes } = require("@/lib/gantt-utils");

        // Calculate the new start time in minutes from the base date
        // We need to be careful here. 
        // originalInicioMin is relative to the base date (creado_en).
        // But the task might have been clamped visually to 09:00 if it was outside work hours.
        // If we just add diffMinutes to originalInicioMin, we might still end up with a time < 09:00 if originalInicioMin was way off.

        // Instead, let's calculate the working minutes from the base date (creado_en normalized to 09:00) to the NEW start date.
        // This is more robust.

        const rawItem = rawPlanificacion.find(i => i.id === task.dbId);
        if (!rawItem) return;

        const baseDate = rawItem.creado_en ? new Date(rawItem.creado_en) : new Date();
        const normalizedBaseDate = new Date(baseDate);
        normalizedBaseDate.setHours(9, 0, 0, 0);

        const newInicioMin = calculateWorkingMinutes(normalizedBaseDate, newStart);

        // Calculate new duration in minutes
        // If we have original duration, use it. Otherwise calculate from current duration.
        let durationMinutes = 0;
        if (task.originalFinMin !== undefined && task.originalInicioMin !== undefined) {
            durationMinutes = task.originalFinMin - task.originalInicioMin;
        } else {
            durationMinutes = Math.round(task.duration * 60);
        }

        const newFinMin = newInicioMin + durationMinutes;

        // 3. Optimistic Update with Re-Leveling
        const oldTasks = [...tasks];
        const oldRawPlanificacion = [...rawPlanificacion];

        // Update the raw item in a new array
        const updatedRawPlanificacion = rawPlanificacion.map(item => {
            if (item.id === task.dbId) {
                return {
                    ...item,
                    inicio_min: newInicioMin,
                    fin_min: newFinMin,
                    id_operario: isNaN(newOperarioId) ? item.id_operario : newOperarioId
                };
            }
            return item;
        });

        // Regenerate tasks (this runs levelResources)
        const newGanttTasks = convertPlanificacionToGanttTasks(updatedRawPlanificacion);

        // Update state
        setRawPlanificacion(updatedRawPlanificacion);
        setTasks(newGanttTasks);

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
            setRawPlanificacion(oldRawPlanificacion);
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
            <div className="flex-1 flex flex-col space-y-4 p-4 min-w-0">
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
                        <TabsTrigger value="orders">Procesos</TabsTrigger>
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

                    <TabsContent value="orders" className="mt-4 flex-1 overflow-auto">
                        <GanttDetailedWorkOrders
                            tasks={tasks}
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
