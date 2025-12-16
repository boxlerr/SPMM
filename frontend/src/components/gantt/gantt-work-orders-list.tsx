"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { GanttTask } from "@/lib/types";
import { toTitleCase } from "@/lib/gantt-utils";
import { OrderFiles } from "@/components/common/OrderFiles";

interface GanttWorkOrdersListProps {
    tasks: GanttTask[];
    onTaskClick?: (task: GanttTask) => void;
    onBulkStatusChange?: (taskIds: string[], newStatus: string) => void;
}

export function GanttWorkOrdersList({ tasks, onTaskClick, onBulkStatusChange }: GanttWorkOrdersListProps) {
    const [searchTerm, setSearchTerm] = React.useState("");
    const [isSelectionMode, setIsSelectionMode] = React.useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = React.useState<Set<string>>(new Set());

    const filteredTasks = tasks.filter(task => {
        const term = searchTerm.toLowerCase();
        return (
            task.workOrderNumber.toLowerCase().includes(term) ||
            task.process.toLowerCase().includes(term) ||
            task.resourceName.toLowerCase().includes(term)
        );
    });

    // Group tasks by Work Order
    const tasksByOT = filteredTasks.reduce((acc, task) => {
        if (!acc[task.workOrderNumber]) {
            acc[task.workOrderNumber] = [];
        }
        acc[task.workOrderNumber].push(task);
        return acc;
    }, {} as Record<string, GanttTask[]>);

    const capitalizeFirstLetter = (string: string) => {
        return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
    };

    const getInitials = (name: string) => {
        if (!name || name === "Sin Asignar") return "?";
        const parts = name.trim().split(' ');
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    const formatDate = (dateStr: string) => {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}`;
    };

    const sortedOTs = Object.keys(tasksByOT).sort((a, b) => parseInt(a) - parseInt(b));

    const toggleSelectionMode = () => {
        setIsSelectionMode(!isSelectionMode);
        setSelectedTaskIds(new Set());
    };

    const toggleTaskSelection = (taskId: string) => {
        const newSelected = new Set(selectedTaskIds);
        if (newSelected.has(taskId)) {
            newSelected.delete(taskId);
        } else {
            newSelected.add(taskId);
        }
        setSelectedTaskIds(newSelected);
    };

    const toggleGroupSelection = (otNumber: string, tasks: GanttTask[]) => {
        const newSelected = new Set(selectedTaskIds);
        const allSelected = tasks.every(t => newSelected.has(t.id));

        if (allSelected) {
            tasks.forEach(t => newSelected.delete(t.id));
        } else {
            tasks.forEach(t => newSelected.add(t.id));
        }
        setSelectedTaskIds(newSelected);
    };

    const handleBulkComplete = () => {
        if (onBulkStatusChange) {
            onBulkStatusChange(Array.from(selectedTaskIds), 'finalizado_total');
            setIsSelectionMode(false);
            setSelectedTaskIds(new Set());
        }
    };

    return (
        <Card className="p-4 sm:p-6 bg-gradient-to-br from-white to-gray-50 border-none shadow-xl relative min-h-[500px]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-100 rounded-lg shrink-0">
                        <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold text-gray-800 tracking-tight flex items-center gap-3">
                        Listado de Órdenes de Trabajo Planificadas
                        <span className="text-sm font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full border border-gray-200">
                            {sortedOTs.length}
                        </span>
                    </h3>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={toggleSelectionMode}
                        className={`px-4 py-2 rounded-lg transition-all duration-200 font-medium shadow-sm border flex items-center gap-2 ${isSelectionMode
                            ? 'bg-gray-800 text-white border-gray-800 ring-2 ring-gray-200'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                    >
                        {isSelectionMode ? (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Cancelar Selección
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Edición Rápida
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="mb-6 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
                <input
                    type="text"
                    className="block w-full pl-10 pr-3 py-3 sm:py-2 border border-gray-300 rounded-xl sm:rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-red-500 focus:border-red-500 text-base sm:text-sm transition duration-150 ease-in-out shadow-sm"
                    placeholder="Buscar por OT, proceso u operario..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="space-y-6 pb-20">
                {sortedOTs.map((otNumber, index) => {
                    const otTasks = tasksByOT[otNumber];
                    const totalTasks = otTasks.length;
                    const completedTasks = otTasks.filter(t => t.status === 'finalizado_total').length;
                    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
                    const allGroupSelected = otTasks.every(t => selectedTaskIds.has(t.id));

                    return (
                        <div
                            key={otNumber}
                            className="group border border-gray-100 rounded-xl p-4 sm:p-6 bg-white shadow-sm hover:shadow-md transition-all duration-300 ease-in-out animate-in fade-in slide-in-from-bottom-4"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-4 sm:mb-6 pb-4 border-b border-gray-50">
                                <div className="flex items-center gap-4">
                                    {isSelectionMode ? (
                                        <div
                                            onClick={() => toggleGroupSelection(otNumber, otTasks)}
                                            className={`h-10 w-10 rounded-full flex items-center justify-center cursor-pointer transition-colors ${allGroupSelected ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                        >
                                            {allGroupSelected ? (
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            ) : (
                                                <div className="w-5 h-5 border-2 border-current rounded" />
                                            )}
                                        </div>
                                    ) : (
                                        <div className="h-10 w-10 rounded-full bg-red-50 flex items-center justify-center text-red-600 font-bold text-lg shadow-inner shrink-0">
                                            #{otNumber}
                                        </div>
                                    )}
                                    <div>
                                        <h4 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                            {otNumber}
                                        </h4>
                                        <div className="flex flex-col gap-0.5">
                                            {otTasks[0].client && (
                                                <span className="text-sm font-semibold text-gray-700 block">
                                                    {otTasks[0].client}
                                                </span>
                                            )}
                                            <span className="text-xs text-gray-500 font-medium">{totalTasks} procesos asignados</span>
                                            <OrderFiles orderId={parseInt(otNumber)} />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-1 w-full sm:w-auto bg-gray-50 sm:bg-transparent p-3 sm:p-0 rounded-lg sm:rounded-none">
                                    <span className="text-sm font-bold text-red-600">{progress}% Completado</span>
                                    <div className="w-full sm:w-32 h-2 bg-gray-200 sm:bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-red-500 rounded-full transition-all duration-1000 ease-out"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                                {otTasks.map((task, taskIndex) => (
                                    <div
                                        key={task.id}
                                        className={`relative group/card bg-white border rounded-xl p-4 transition-all duration-200 cursor-pointer overflow-hidden active:scale-[0.98] ${isSelectionMode
                                            ? selectedTaskIds.has(task.id)
                                                ? 'border-red-500 ring-2 ring-red-100 shadow-md bg-red-50/30'
                                                : 'border-gray-200 hover:border-red-300 hover:shadow-md'
                                            : 'border-gray-200 hover:border-red-300 hover:shadow-lg hover:-translate-y-1'
                                            }`}
                                        onClick={() => {
                                            if (isSelectionMode) {
                                                toggleTaskSelection(task.id);
                                            } else {
                                                onTaskClick?.(task);
                                            }
                                        }}
                                        style={{ animationDelay: `${(index * 100) + (taskIndex * 50)}ms` }}
                                    >
                                        <div className={`absolute top-0 left-0 w-1 h-full bg-red-500 transition-opacity duration-300 ${isSelectionMode && selectedTaskIds.has(task.id) ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'}`} />

                                        {isSelectionMode && (
                                            <div className="absolute top-3 right-3 z-10">
                                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${selectedTaskIds.has(task.id)
                                                    ? 'bg-red-500 border-red-500 text-white scale-110'
                                                    : 'bg-white border-gray-300 group-hover/card:border-red-300'
                                                    }`}>
                                                    {selectedTaskIds.has(task.id) && (
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex justify-between items-start mb-3">
                                            <h5 className={`font-bold text-base leading-tight transition-colors pr-8 ${isSelectionMode && selectedTaskIds.has(task.id) ? 'text-red-900' : 'text-gray-800 group-hover/card:text-red-700'}`}>
                                                {capitalizeFirstLetter(task.process)}
                                            </h5>
                                            {!isSelectionMode && task.status === 'finalizado_total' && (
                                                <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0">
                                                    Completado
                                                </span>
                                            )}
                                            {!isSelectionMode && task.status === 'en_proceso' && (
                                                <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0">
                                                    En Curso
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-xs shrink-0 border border-gray-200">
                                                {getInitials(task.resourceName)}
                                            </div>
                                            <span className="text-sm text-gray-600 font-medium truncate">{toTitleCase(task.resourceName)}</span>
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

            {/* Floating Action Bar */}
            {isSelectionMode && selectedTaskIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
                    <div className="bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-6 border border-gray-700">
                        <div className="flex items-center gap-2 border-r border-gray-700 pr-6">
                            <span className="bg-white text-gray-900 text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                                {selectedTaskIds.size}
                            </span>
                            <span className="font-medium text-sm">Seleccionados</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleBulkComplete}
                                className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-full text-sm font-bold transition-colors flex items-center gap-2 shadow-lg shadow-green-900/20"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Marcar Completados
                            </button>
                            <button
                                onClick={() => setSelectedTaskIds(new Set())}
                                className="text-gray-400 hover:text-white transition-colors p-1"
                                title="Limpiar selección"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}
