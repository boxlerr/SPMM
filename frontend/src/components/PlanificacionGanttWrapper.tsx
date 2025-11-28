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

interface PlanificacionGanttWrapperProps {
    tasks: GanttTask[];
    resources: Resource[];
    viewMode: "operario" | "maquina";
    setViewMode: (mode: "operario" | "maquina") => void;
    onTaskMove: (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => void;
    onTaskClick: (task: GanttTask) => void;
    isLoading: boolean;
}

export default function PlanificacionGanttWrapper({
    tasks,
    resources,
    viewMode,
    setViewMode,
    onTaskMove,
    onTaskClick,
    isLoading
}: PlanificacionGanttWrapperProps) {

    // Force re-render on resize to fix Gantt width issues during transition
    const [containerWidth, setContainerWidth] = useState(0);
    const containerRef = React.useRef<HTMLDivElement>(null);

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
        <div ref={containerRef} className="flex h-[calc(100vh-180px)] overflow-hidden w-full">
            <div className="flex-1 flex flex-col space-y-4 p-4 min-w-0 overflow-hidden">
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
                <Tabs defaultValue="weekly" className="w-full flex-1 flex flex-col overflow-hidden">
                    <TabsList>
                        <TabsTrigger value="weekly">Semanal Detallado</TabsTrigger>
                        <TabsTrigger value="monthly">Mensual General</TabsTrigger>
                        <TabsTrigger value="orders">Procesos</TabsTrigger>
                    </TabsList>

                    <TabsContent value="weekly" className="mt-4 flex-1 overflow-auto">
                        {/* Key forces re-render on width change to fix layout bugs */}
                        <GanttWeeklyDetailed
                            key={`weekly-${containerWidth}`}
                            tasks={tasks}
                            resources={resources}
                            viewMode={viewMode}
                            onTaskMove={onTaskMove}
                            onTaskClick={onTaskClick}
                        />
                    </TabsContent>

                    <TabsContent value="monthly" className="mt-4 flex-1 overflow-auto">
                        <GanttMonthlyOverview
                            key={`monthly-${containerWidth}`}
                            tasks={tasks}
                            resources={resources}
                            viewMode={viewMode}
                            onTaskClick={onTaskClick}
                            onTaskMove={onTaskMove}
                        />
                    </TabsContent>

                    <TabsContent value="orders" className="mt-4 flex-1 overflow-auto">
                        <GanttDetailedWorkOrders
                            key={`orders-${containerWidth}`}
                            tasks={tasks}
                            onTaskClick={onTaskClick}
                            onTaskMove={onTaskMove}
                        />
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
