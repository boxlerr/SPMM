"use client";

import React, { useEffect, useState } from "react";
import { GanttWeeklyDetailed } from "./gantt-weekly-detailed";
import { GanttMonthlyOverview } from "./gantt-monthly-overview";
import { GanttDetailedWorkOrders } from "./gantt/gantt-detailed-work-orders";
import { convertPlanificacionToGanttTasks } from "@/lib/gantt-utils";
import type { GanttTask, Resource, PlanificacionItem } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import TaskDetailsModal from "./gantt/TaskDetailsModal";
import { usePanelContext } from "@/contexts/PanelContext";
import { isOperatorQualified } from "@/lib/gantt-utils";
import { toast } from "sonner";

interface PlanificacionGanttWrapperProps {
    tasks: GanttTask[];
    resources: Resource[];
    viewMode: "operario" | "maquina";
    setViewMode: (mode: "operario" | "maquina") => void;
    onTaskMove: (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => void;
    onTaskClick: (task: GanttTask) => void;
    onStatusChange?: (taskId: string, newStatusId: string) => void;
    isLoading: boolean;
}

export default function PlanificacionGanttWrapper({
    tasks,
    resources,
    viewMode,
    setViewMode,
    onTaskMove,
    onTaskClick,
    onStatusChange,
    isLoading
}: PlanificacionGanttWrapperProps) {

    // Force re-render on resize to fix Gantt width issues during transition
    const [containerWidth, setContainerWidth] = useState(0);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const handleTaskMove = (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
            // Validate operator capability
            if (viewMode === "operario") {
                const targetResource = resources.find(r => r.id === newResourceId);
                if (targetResource && targetResource.type === "operario") {
                    if (!isOperatorQualified(targetResource.ranges || [], task.allowedRanges || [])) {
                        toast.error("Este operario no tiene la capacidad para realizar este proceso");
                        return; // Cancel move
                    }
                }
            }

            onTaskMove(taskId, newResourceId, newDate, newStartTime);
        }
    };

    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    if (isLoading) {
        return <div className="p-8 text-center">Cargando planificación...</div>;
    }

    return (
        <div ref={containerRef} className="flex flex-col w-full">
            <Tabs defaultValue="weekly" className="flex-1 flex flex-col min-w-0">
                <div className="px-4 pt-4 pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-50 p-2 rounded-lg border border-gray-100">
                        <TabsList className="bg-white border border-gray-200 shadow-sm">
                            <TabsTrigger value="weekly" className="data-[state=active]:bg-red-50 data-[state=active]:text-red-700">Semanal Detallado</TabsTrigger>
                            <TabsTrigger value="monthly" className="data-[state=active]:bg-red-50 data-[state=active]:text-red-700">Mensual General</TabsTrigger>
                            <TabsTrigger value="orders" className="data-[state=active]:bg-red-50 data-[state=active]:text-red-700">Procesos</TabsTrigger>
                        </TabsList>

                        <div className="flex bg-white rounded-md border border-gray-200 shadow-sm p-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`rounded-sm px-3 ${viewMode === "operario" ? "bg-red-100 text-red-800 font-medium" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"}`}
                                onClick={() => setViewMode("operario")}
                            >
                                Operarios
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`rounded-sm px-3 ${viewMode === "maquina" ? "bg-red-100 text-red-800 font-medium" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"}`}
                                onClick={() => setViewMode("maquina")}
                            >
                                Máquinas
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 p-4 pt-2">
                    <TabsContent value="weekly" className="mt-0">
                        <GanttWeeklyDetailed
                            key={`weekly-${containerWidth}`}
                            tasks={tasks}
                            resources={resources}
                            viewMode={viewMode}
                            onTaskMove={handleTaskMove}
                            onTaskClick={onTaskClick}
                            onStatusChange={onStatusChange}
                        />
                    </TabsContent>

                    <TabsContent value="monthly" className="mt-0">
                        <GanttMonthlyOverview
                            tasks={tasks}
                            resources={resources}
                            viewMode={viewMode}
                            onTaskClick={onTaskClick}
                            onTaskMove={handleTaskMove}
                        />
                    </TabsContent>

                    <TabsContent value="orders" className="mt-0">
                        <GanttDetailedWorkOrders
                            tasks={tasks}
                            onTaskClick={onTaskClick}
                            onTaskMove={handleTaskMove}
                        />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
