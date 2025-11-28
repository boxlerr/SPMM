"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { GanttTask } from "@/lib/types";

interface GanttWorkOrdersListProps {
    tasks: GanttTask[];
    onTaskClick?: (task: GanttTask) => void;
}

export function GanttWorkOrdersList({ tasks, onTaskClick }: GanttWorkOrdersListProps) {
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
        <Card className="p-6 bg-gradient-to-br from-white to-gray-50 border-none shadow-xl">
            <div className="flex items-center gap-3 mb-8">
                <div className="p-2 bg-red-100 rounded-lg">
                    <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-800 tracking-tight">Listado de Órdenes de Trabajo</h3>
            </div>

            <div className="space-y-6">
                {sortedOTs.map((otNumber, index) => {
                    const otTasks = tasksByOT[otNumber];
                    const totalTasks = otTasks.length;
                    const completedTasks = otTasks.filter(t => t.status === 'finalizado_total').length;
                    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                    return (
                        <div
                            key={otNumber}
                            className="group border border-gray-100 rounded-xl p-6 bg-white shadow-sm hover:shadow-md transition-all duration-300 ease-in-out animate-in fade-in slide-in-from-bottom-4"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-50">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-red-50 flex items-center justify-center text-red-600 font-bold text-lg shadow-inner">
                                        #{otNumber}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-lg text-gray-800">Orden de Trabajo {otNumber}</h4>
                                        <span className="text-xs text-gray-500 font-medium">{totalTasks} procesos asignados</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-sm font-bold text-red-600">{progress}% Completado</span>
                                    <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-red-500 rounded-full transition-all duration-1000 ease-out"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {otTasks.map((task, taskIndex) => (
                                    <div
                                        key={task.id}
                                        className="relative group/card bg-white border border-gray-200 rounded-xl p-4 hover:border-red-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden"
                                        onClick={() => onTaskClick?.(task)}
                                        style={{ animationDelay: `${(index * 100) + (taskIndex * 50)}ms` }}
                                    >
                                        <div className="absolute top-0 left-0 w-1 h-full bg-red-500 opacity-0 group-hover/card:opacity-100 transition-opacity duration-300" />

                                        <div className="flex justify-between items-start mb-3">
                                            <h5 className="font-bold text-gray-800 text-base leading-tight group-hover/card:text-red-700 transition-colors">
                                                {capitalizeFirstLetter(task.process)}
                                            </h5>
                                            {task.status === 'finalizado_total' && (
                                                <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                                    Completado
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                </svg>
                                            </div>
                                            <span className="text-sm text-gray-600 font-medium">{task.resourceName}</span>
                                        </div>

                                        <div className="space-y-2 bg-gray-50 rounded-lg p-3 border border-gray-100">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-gray-500 font-medium flex items-center gap-1">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                    </svg>
                                                    Inicio
                                                </span>
                                                <span className="text-gray-900 font-semibold bg-white px-2 py-0.5 rounded shadow-sm">
                                                    {formatDate(task.startDate)} <span className="text-gray-400 mx-1">|</span> {task.startTime}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-gray-500 font-medium flex items-center gap-1">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    Fin
                                                </span>
                                                <span className="text-gray-900 font-semibold bg-white px-2 py-0.5 rounded shadow-sm">
                                                    {task.endDate !== task.startDate ? `${formatDate(task.endDate)} ` : ''}
                                                    {task.endTime}
                                                </span>
                                            </div>
                                        </div>

                                        {task.notes && (
                                            <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                                                <p className="text-xs text-gray-500 line-clamp-2 italic flex gap-1">
                                                    <svg className="w-3 h-3 mt-0.5 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                                    </svg>
                                                    {task.notes}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {sortedOTs.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center animate-in fade-in zoom-in duration-500">
                        <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-4 shadow-inner">
                            <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">No hay órdenes de trabajo</h3>
                        <p className="text-gray-500 max-w-sm mt-2">
                            No se encontraron órdenes de trabajo activas en este momento.
                        </p>
                    </div>
                )}
            </div>
        </Card>
    );
}
