"use client";

import React, { useEffect, useState } from "react";
import { GanttWorkOrdersList } from "./gantt/gantt-work-orders-list";
import { convertPlanificacionToGanttTasks } from "@/lib/gantt-utils";
import type { GanttTask, PlanificacionItem, Resource } from "@/lib/types";
import TaskDetailsModal from "./gantt/TaskDetailsModal";

export default function WorkOrdersListWrapper() {
    const [tasks, setTasks] = useState<GanttTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [rawPlanificacion, setRawPlanificacion] = useState<PlanificacionItem[]>([]);
    const [rawOperarios, setRawOperarios] = useState<any[]>([]);
    const [selectedTask, setSelectedTask] = useState<PlanificacionItem | null>(null);
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

    // Helper for colors (duplicated from PlanificacionGanttWrapper for consistency)
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

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
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
                }
            } catch (error) {
                console.error("Error loading Work Orders data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

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

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando órdenes de trabajo...</div>;
    }

    return (
        <div className="relative">
            <GanttWorkOrdersList tasks={tasks} onTaskClick={handleTaskClick} />

            <TaskDetailsModal
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
