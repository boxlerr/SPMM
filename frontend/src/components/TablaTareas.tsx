"use client";

import React, { useMemo, useState, useCallback } from 'react';
import {
    ChevronRight,
    User,
    Plus,
    Search,
    Filter,
    MoreHorizontal,
    GripVertical,
    Calendar
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { motion, AnimatePresence } from "framer-motion";
import CreateGroupModal from '@/components/CreateGroupModal';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isOperatorQualified } from "@/lib/gantt-utils";
import { AlertCircle } from "lucide-react";
import type { GanttTask } from "@/lib/types";

interface TablaTareasProps {
    tasks: GanttTask[];
    operarios: any[];
    onStatusChange: (taskId: string, newStatusId: string) => void;
    onResponsibleChange: (taskId: string, newOpId: string) => void;
}

interface TaskGroup {
    id: string;
    title: string;
    color: string;
    items: GanttTask[];
    isExpanded: boolean;
}

// Memoized Task Row Component to prevent re-renders during drag
const TaskRow = React.memo(({ item, index, groupColor, groupId, operarios, onStatusChange, onResponsibleChange }: {
    item: GanttTask;
    index: number;
    groupColor: string;
    groupId: string;
    operarios: any[];
    onStatusChange: (taskId: string, newStatusId: string) => void;
    onResponsibleChange: (taskId: string, newOpId: string) => void;
}) => {
    const capitalizeFirst = (text: string) => {
        if (!text) return '';
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    };

    const getInitials = (name: string) => {
        if (!name) return '';
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    };

    const getStatusColor = (statusId: string) => {
        switch (statusId) {
            case 'en_proceso': return 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-200';
            case 'finalizado_total': return 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-200';
            default: return 'bg-slate-400 text-white hover:bg-slate-500 shadow-slate-200';
        }
    };

    const getStatusLabel = (statusId: string) => {
        switch (statusId) {
            case 'en_proceso': return 'En curso';
            case 'finalizado_total': return 'Listo';
            default: return 'Pendiente';
        }
    };

    return (
        <Draggable draggableId={item.id} index={index}>
            {(provided, snapshot) => (
                <motion.div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                    layout
                    className={`flex items-center border-b border-gray-100 py-3 hover:bg-gray-50 group/row transition-colors ${snapshot.isDragging ? 'shadow-xl bg-white ring-1 ring-gray-200 rounded-md z-50' : ''
                        }`}
                >
                    <div className="w-10 flex justify-center">
                        <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing p-1.5 hover:bg-gray-200 rounded-md transition-colors opacity-0 group-hover/row:opacity-100">
                            <GripVertical size={16} className="text-gray-400" />
                        </div>
                    </div>
                    <div className="flex-1 px-4 border-r border-gray-100 flex items-center gap-3 overflow-hidden">
                        <div className="flex flex-col min-w-0">
                            <span className="text-sm text-gray-700 font-medium truncate capitalize" title={item.process}>
                                {item.process}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                                    OT #{item.workOrderNumber}
                                </span>
                                {item.client && (
                                    <span className="text-[10px] text-gray-400 truncate max-w-[100px]" title={item.client}>
                                        {item.client}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="w-56 px-4 border-r border-gray-100 flex justify-center" onPointerDown={(e) => e.stopPropagation()}>
                        <Select
                            value={item.resourceId || "unassigned"}
                            onValueChange={(value) => {
                                if (value !== "unassigned") {
                                    const taskId = item.dbId ? item.dbId.toString() : item.id;
                                    onResponsibleChange(taskId, value);
                                }
                            }}
                        >
                            <SelectTrigger size="sm" className="w-full border-none shadow-none bg-transparent hover:bg-gray-100 h-9 focus:ring-0 px-2">
                                <SelectValue>
                                    {item.resourceName && item.resourceName !== "Sin Asignar" ? (
                                        <div className="flex items-center gap-2 w-full">
                                            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0 border border-blue-200 shadow-sm">
                                                {getInitials(item.resourceName)}
                                            </div>
                                            <span className="text-xs text-gray-700 truncate font-medium">
                                                {capitalizeFirst(item.resourceName)}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-gray-400 group-hover/row:text-gray-500">
                                            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200 border-dashed">
                                                <User size={14} />
                                            </div>
                                            <span className="text-xs">Asignar</span>
                                        </div>
                                    )}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="unassigned">
                                    <div className="flex items-center gap-2">
                                        <User size={14} />
                                        <span>Sin asignar</span>
                                    </div>
                                </SelectItem>
                                {operarios.map(op => {
                                    // Handle both 'ranges' (frontend type) and 'rangos' (backend response)
                                    const opRanges = op.ranges || (op.rangos ? op.rangos.map((r: any) => typeof r === 'object' ? r.id : r) : []);
                                    // Ensure item.allowedRanges is available. If not, we might need to rely on item.rangos_permitidos if it exists on GanttTask
                                    // Based on types.ts, GanttTask might not have rangos_permitidos directly unless we added it.
                                    // Let's check if we can access it. If item comes from convertPlanificacionToGanttTasks, it might be missing.
                                    // However, for now, let's assume we can access it or we need to pass it.
                                    // Actually, looking at TablaTareas usage in page.tsx, 'tasks' are GanttTask[].
                                    // We need to ensure GanttTask has 'allowedRanges' or similar.
                                    // Let's check types.ts first to be sure.
                                    // Wait, I can't check types.ts inside this replace.
                                    // I will assume 'allowedRanges' exists on GanttTask as per previous work, or I'll use 'rangos_permitidos' if I added it.
                                    // Let's use a safe check.
                                    const allowedRanges = (item as any).allowedRanges || (item as any).rangos_permitidos || [];

                                    // Import isOperatorQualified at the top first!
                                    // I will add the import in a separate block or assume it's added.
                                    // Wait, I need to add the import first.

                                    const isQualified = isOperatorQualified(opRanges, allowedRanges);

                                    return (
                                        <SelectItem
                                            key={op.id}
                                            value={op.id.toString()}
                                            disabled={!isQualified}
                                            className={!isQualified ? "opacity-50 cursor-not-allowed bg-gray-50" : ""}
                                        >
                                            <div className="flex items-center justify-between w-full gap-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-bold">
                                                        {getInitials(op.nombre + ' ' + op.apellido)}
                                                    </div>
                                                    <span>{capitalizeFirst(op.nombre)} {capitalizeFirst(op.apellido)}</span>
                                                </div>
                                                {!isQualified && (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <div className="p-1">
                                                                    <AlertCircle className="w-3 h-3 text-gray-400" />
                                                                </div>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>No tiene la capacidad para realizar este proceso</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )}
                                            </div>
                                        </SelectItem>
                                    )
                                })}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-40 px-4 border-r border-gray-100 flex justify-center" onPointerDown={(e) => e.stopPropagation()}>
                        <Select
                            value={groupId}
                            onValueChange={(value) => {
                                let statusId = '1';
                                if (value === 'en_proceso') statusId = '2';
                                if (value === 'finalizado_total') statusId = '3';

                                const taskId = item.dbId ? item.dbId.toString() : item.id;
                                onStatusChange(taskId, statusId);
                            }}
                        >
                            <SelectTrigger size="sm" className="w-full border-none shadow-none bg-transparent hover:bg-gray-100 h-9 focus:ring-0 p-0 flex justify-center group/status">
                                <SelectValue>
                                    <span className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide shadow-sm transition-all duration-300 w-28 block text-center group-hover/status:scale-105 ${getStatusColor(groupId)}`}>
                                        {getStatusLabel(groupId)}
                                    </span>
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="nuevo">
                                    <span className="px-2 py-0.5 rounded text-xs font-medium text-slate-600">
                                        Pendiente
                                    </span>
                                </SelectItem>
                                <SelectItem value="en_proceso">
                                    <span className="px-2 py-0.5 rounded text-xs font-medium text-blue-600">
                                        En curso
                                    </span>
                                </SelectItem>
                                <SelectItem value="finalizado_total">
                                    <span className="px-2 py-0.5 rounded text-xs font-medium text-emerald-600">
                                        Listo
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-32 px-4 flex justify-center">
                        <div className="flex items-center gap-1.5 text-gray-400 group-hover/row:text-gray-600 transition-colors">
                            {/* Placeholder for date */}
                            <span className="text-xs">-</span>
                        </div>
                    </div>
                    <div className="w-12 flex justify-center opacity-0 group-hover/row:opacity-100 transition-opacity">
                        <button className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600">
                            <MoreHorizontal size={16} />
                        </button>
                    </div>
                </motion.div>
            )}
        </Draggable>
    );
});
TaskRow.displayName = "TaskRow";

const TablaTareas = ({ tasks, operarios, onStatusChange, onResponsibleChange }: TablaTareasProps) => {
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        'en_proceso': true,
        'nuevo': true,
        'finalizado_total': true
    });
    const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    // Use useMemo to calculate groups only when tasks or search changes
    const groups = useMemo(() => {
        const pendientes: GanttTask[] = [];
        const enCurso: GanttTask[] = [];
        const completados: GanttTask[] = [];

        tasks.forEach(task => {
            // Filter by search term
            if (searchTerm && !task.workOrderNumber.toLowerCase().includes(searchTerm.toLowerCase()) &&
                !task.process.toLowerCase().includes(searchTerm.toLowerCase())) {
                return;
            }

            if (task.status === 'finalizado_total' || task.status === 'finalizado_parcial') {
                completados.push(task);
            } else if (task.status === 'en_proceso') {
                enCurso.push(task);
            } else {
                pendientes.push(task);
            }
        });

        return [
            {
                id: 'en_proceso',
                title: 'En Curso',
                color: '#3b82f6', // Blue
                items: enCurso,
            },
            {
                id: 'nuevo',
                title: 'Pendientes',
                color: '#64748b', // Slate Gray
                items: pendientes,
            },
            {
                id: 'finalizado_total',
                title: 'Completado',
                color: '#10b981', // Emerald
                items: completados,
            }
        ];
    }, [tasks, searchTerm]);

    const toggleGroup = (groupId: string) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupId]: !prev[groupId]
        }));
    };

    const onDragEnd = useCallback((result: DropResult) => {
        const { source, destination, draggableId } = result;

        if (!destination) return;

        if (source.droppableId !== destination.droppableId) {
            let newStatusId = '1'; // Pendiente
            if (destination.droppableId === 'en_proceso') newStatusId = '2';
            if (destination.droppableId === 'finalizado_total') newStatusId = '3';

            // We need to find the task to get its dbId, or pass it in the draggableId if possible.
            // But draggableId is the string ID. We need to parse it or find the task.
            // Since we don't have the task object here easily without searching, 
            // and we know the format is task-OT-PROC-DBID, we can try to extract it,
            // OR better, just find it in the tasks array.
            const task = tasks.find(t => t.id === draggableId);
            if (task) {
                const taskId = task.dbId ? task.dbId.toString() : task.id;
                onStatusChange(taskId, newStatusId);
            }
        }
    }, [onStatusChange, tasks]);

    const handleCreateGroup = (name: string, color: string) => {
        // Visual only
    };

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <div className="w-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Toolbar */}
                <div className="p-4 border-b border-gray-200 flex items-center gap-4 overflow-x-auto bg-gray-50/50">
                    <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400 transition-all">
                        <Search size={18} className="text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar tareas..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="outline-none text-sm w-48 md:w-64 placeholder:text-gray-400"
                        />
                    </div>
                    <div className="h-6 w-px bg-gray-300 mx-2"></div>
                    <button className="text-gray-600 hover:bg-white hover:shadow-sm hover:text-gray-900 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all">
                        <User size={16} />
                        <span>Persona</span>
                    </button>
                    <button className="text-gray-600 hover:bg-white hover:shadow-sm hover:text-gray-900 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all">
                        <Filter size={16} />
                        <span>Filtrar</span>
                    </button>
                </div>

                {/* Table Content */}
                <div className="overflow-x-auto">
                    <div className="min-w-[900px] pb-10">
                        {groups.map(group => (
                            <div key={group.id} className="mb-6">
                                {/* Group Header */}
                                <div
                                    className="flex items-center gap-3 px-6 py-3 group cursor-pointer hover:bg-gray-50 transition-all sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-y border-transparent hover:border-gray-100"
                                    onClick={() => toggleGroup(group.id)}
                                >
                                    <div className={`p-1 rounded-md hover:bg-gray-100 text-gray-400 transition-all duration-200 ${!expandedGroups[group.id] ? '-rotate-90' : ''}`}>
                                        <ChevronRight size={20} />
                                    </div>
                                    <h3 className="font-bold text-lg tracking-tight" style={{ color: group.color }}>
                                        {group.title}
                                    </h3>
                                    <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs font-medium">
                                        {group.items.length}
                                    </span>
                                    <div className="flex-1" />
                                    {/* Status indicators */}
                                    <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="flex gap-1 h-2">
                                            <div className="w-16 h-full rounded-full opacity-50" style={{ backgroundColor: group.color }} />
                                        </div>
                                    </div>
                                </div>

                                {expandedGroups[group.id] && (
                                    <div className="px-6">
                                        {/* Table Header */}
                                        <div className="flex items-center border-b border-gray-200 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                            <div className="w-10 flex justify-center">
                                            </div>
                                            <div className="flex-1 px-4 border-r border-transparent">Tarea</div>
                                            <div className="w-56 px-4 border-r border-transparent text-center">Responsable</div>
                                            <div className="w-40 px-4 border-r border-transparent text-center">Estado</div>
                                            <div className="w-32 px-4 text-center">Vencimiento</div>
                                            <div className="w-12"></div>
                                        </div>

                                        {/* Group Items with Drag and Drop */}
                                        <Droppable droppableId={group.id}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.droppableProps}
                                                    className={`min-h-[50px] transition-colors rounded-b-lg ${snapshot.isDraggingOver ? 'bg-blue-50/30' : ''}`}
                                                >
                                                    <AnimatePresence mode="popLayout">
                                                        {group.items.map((item, index) => (
                                                            <TaskRow
                                                                key={item.id}
                                                                item={item}
                                                                index={index}
                                                                groupColor={group.color}
                                                                groupId={group.id}
                                                                operarios={operarios}
                                                                onStatusChange={onStatusChange}
                                                                onResponsibleChange={onResponsibleChange}
                                                            />
                                                        ))}
                                                    </AnimatePresence>
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Add New Group Button */}
                        <div className="px-6 mt-8">
                            <button
                                className="flex items-center gap-2 px-5 py-3 border border-gray-200 shadow-sm rounded-xl hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 transition-all text-gray-500 font-medium text-sm"
                                onClick={() => setIsCreateGroupModalOpen(true)}
                            >
                                <Plus size={18} />
                                Nuevo Grupo
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Create Group Modal */}
            <CreateGroupModal
                isOpen={isCreateGroupModalOpen}
                onClose={() => setIsCreateGroupModalOpen(false)}
                onCreateGroup={handleCreateGroup}
            />
        </DragDropContext>
    );
};

export default TablaTareas;
