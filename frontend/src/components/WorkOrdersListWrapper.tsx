"use client";

import React, { useEffect, useState } from "react";
import { GanttWorkOrdersList } from "./gantt/gantt-work-orders-list";
import { convertPlanificacionToGanttTasks } from "@/lib/gantt-utils";
import type { GanttTask, PlanificacionItem } from "@/lib/types";

export default function WorkOrdersListWrapper() {
    const [tasks, setTasks] = useState<GanttTask[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const planResponse = await fetch("http://localhost:8000/planificacion");
                if (!planResponse.ok) throw new Error("Error fetching planificacion");
                const planData: PlanificacionItem[] = await planResponse.json();

                const ganttTasks = convertPlanificacionToGanttTasks(planData);
                setTasks(ganttTasks);
            } catch (error) {
                console.error("Error loading Work Orders data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando órdenes de trabajo...</div>;
    }

    return <GanttWorkOrdersList tasks={tasks} />;
}
