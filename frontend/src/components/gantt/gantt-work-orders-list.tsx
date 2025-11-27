"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { GanttTask } from "@/lib/types";

interface GanttWorkOrdersListProps {
    tasks: GanttTask[];
}

export function GanttWorkOrdersList({ tasks }: GanttWorkOrdersListProps) {
    // Group tasks by Work Order
    const tasksByOT = tasks.reduce((acc, task) => {
        if (!acc[task.workOrderNumber]) {
            acc[task.workOrderNumber] = [];
        }
        acc[task.workOrderNumber].push(task);
        return acc;
    }, {} as Record<string, GanttTask[]>);

    const sortedOTs = Object.keys(tasksByOT).sort((a, b) => parseInt(a) - parseInt(b));

    return (
        <Card className="p-6">
            <h3 className="text-xl font-bold text-foreground mb-6">Listado de Órdenes de Trabajo</h3>
            <div className="space-y-4">
                {sortedOTs.map((otNumber) => {
                    const otTasks = tasksByOT[otNumber];
                    // Calculate total progress or status based on tasks
                    const totalTasks = otTasks.length;
                    const completedTasks = otTasks.filter(t => t.status === 'finalizado_total').length;
                    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                    return (
                        <div key={otNumber} className="border rounded-lg p-4 bg-card shadow-sm">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-bold text-lg">OT {otNumber}</h4>
                                <span className="text-sm text-muted-foreground">{progress}% Completado</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                {otTasks.map(task => (
                                    <div key={task.id} className="text-sm border p-2 rounded bg-muted/50">
                                        <div className="font-semibold">{task.process}</div>
                                        <div className="text-xs text-muted-foreground">{task.resourceName}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {task.startDate} {task.startTime} - {task.endTime}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {sortedOTs.length === 0 && (
                    <div className="text-center text-muted-foreground p-8">
                        No hay órdenes de trabajo disponibles.
                    </div>
                )}
            </div>
        </Card>
    );
}
