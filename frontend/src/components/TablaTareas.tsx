"use client";

import React, { useEffect, useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    User,
    Plus,
    Search,
    Filter,
    MoreHorizontal,
    Calendar,
    CheckCircle2,
    Circle,
    GripVertical
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface PlanificacionItem {
    id: number;
    orden_id: number;
    proceso_id: number;
    nombre_proceso: string;
    inicio_min: number;
    fin_min: number;
    creado_en: string;
    id_operario?: number;
    id_maquinaria?: number;
    nombre_maquinaria?: string;
    nombre_operario?: string;
    apellido_operario?: string;
    fecha_prometida?: string;
    prioridad_peso?: number;
}

interface Operario {
    id: number;
    nombre: string;
    apellido: string;
    sector?: string;
    categoria?: string;
    disponible?: boolean;
    fecha_nacimiento?: string;
    fecha_ingreso?: string;
    telefono?: string;
    celular?: string;
    dni?: string;
}

interface TaskGroup {
    id: string;
    title: string;
    color: string;
    items: PlanificacionItem[];
    isExpanded: boolean;
}

const TablaTareas = () => {
    const [items, setItems] = useState<PlanificacionItem[]>([]);
    const [groups, setGroups] = useState<TaskGroup[]>([]);
    const [operarios, setOperarios] = useState<Operario[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [planRes, opRes] = await Promise.all([
                    fetch('http://localhost:8000/planificacion'),
                    fetch('http://localhost:8000/operarios')
                ]);

                if (!planRes.ok || !opRes.ok) {
                    throw new Error('Error al obtener datos');
                }

                const planData: PlanificacionItem[] = await planRes.json();
                const opResponse = await opRes.json();

                // Extract data from ResponseDTO wrapper
                const opData: Operario[] = opResponse.data || [];

                setItems(planData);
                setOperarios(opData);
                organizeGroups(planData);
            } catch (error) {
                console.error("Error fetching data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const organizeGroups = (data: PlanificacionItem[]) => {
        const now = new Date();
        const baseDate = new Date();
        baseDate.setHours(9, 0, 0, 0);

        const pendientes: PlanificacionItem[] = [];
        const enCurso: PlanificacionItem[] = [];
        const completados: PlanificacionItem[] = [];

        data.forEach(item => {
            const start = new Date(baseDate.getTime() + item.inicio_min * 60000);
            const end = new Date(baseDate.getTime() + item.fin_min * 60000);

            if (end < now) {
                completados.push(item);
            } else if (start <= now && end >= now) {
                enCurso.push(item);
            } else {
                pendientes.push(item);
            }
        });

        setGroups([
            {
                id: 'en-curso',
                title: 'En Curso',
                color: '#f59e0b',
                items: enCurso,
                isExpanded: true
            },
            {
                id: 'pendientes',
                title: 'Pendientes',
                color: '#3b82f6',
                items: pendientes,
                isExpanded: true
            },
            {
                id: 'completados',
                title: 'Completado',
                color: '#10b981',
                items: completados,
                isExpanded: true
            }
        ]);
    };

    const toggleGroup = (groupId: string) => {
        setGroups(groups.map(g =>
            g.id === groupId ? { ...g, isExpanded: !g.isExpanded } : g
        ));
    };

    const updateTask = async (id: number, updates: Partial<PlanificacionItem>) => {
        try {
            const updatedItems = items.map(item =>
                item.id === id ? { ...item, ...updates } : item
            );
            setItems(updatedItems);
            organizeGroups(updatedItems);

            const response = await fetch(`http://localhost:8000/planificacion/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (!response.ok) throw new Error('Failed to update task');
        } catch (error) {
            console.error("Error updating task:", error);
        }
    };

    const handleStatusChange = (taskId: number, newStatus: string) => {
        const now = new Date();
        const baseDate = new Date();
        baseDate.setHours(9, 0, 0, 0);

        const currentMinutes = Math.floor((now.getTime() - baseDate.getTime()) / 60000);

        let updates: Partial<PlanificacionItem> = {};

        if (newStatus === 'en-curso') {
            updates = { inicio_min: currentMinutes };
        } else if (newStatus === 'completados') {
            updates = { fin_min: currentMinutes };
        } else if (newStatus === 'pendientes') {
            updates = { inicio_min: currentMinutes + 60 };
        }

        updateTask(taskId, updates);
    };

    const handleResponsibleChange = (taskId: number, operarioId: string) => {
        const opId = parseInt(operarioId);
        const operario = operarios.find(o => o.id === opId);
        updateTask(taskId, {
            id_operario: opId,
            nombre_operario: operario?.nombre,
            apellido_operario: operario?.apellido
        });
    };

    const onDragEnd = (result: DropResult) => {
        const { source, destination, draggableId } = result;

        if (!destination) return;

        if (source.droppableId !== destination.droppableId) {
            const taskId = parseInt(draggableId);
            handleStatusChange(taskId, destination.droppableId);
        }
    };

    const getStatusColor = (groupId: string) => {
        switch (groupId) {
            case 'en-curso': return 'bg-amber-400 text-white';
            case 'completados': return 'bg-emerald-400 text-white';
            default: return 'bg-gray-400 text-white';
        }
    };

    const getStatusLabel = (groupId: string) => {
        switch (groupId) {
            case 'en-curso': return 'En curso';
            case 'completados': return 'Listo';
            default: return 'Pendiente';
        }
    };

    const capitalizeFirst = (text: string) => {
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    };

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando tareas...</div>;
    }

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <div className="w-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {/* Toolbar */}
                <div className="p-4 border-b border-gray-200 flex items-center gap-4 overflow-x-auto">
                    <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1 hover:bg-blue-700 transition-colors">
                        Agregar tarea <ChevronDown size={14} />
                    </button>
                    <div className="flex items-center gap-2 border rounded px-2 py-1.5 bg-white">
                        <Search size={16} className="text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar"
                            className="outline-none text-sm w-32 md:w-48"
                        />
                    </div>
                    <button className="text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded text-sm flex items-center gap-1">
                        <User size={16} /> Persona
                    </button>
                    <button className="text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded text-sm flex items-center gap-1">
                        <Filter size={16} /> Filtrar
                    </button>
                </div>

                {/* Table Content */}
                <div className="overflow-x-auto">
                    <div className="min-w-[800px]">
                        {groups.map(group => (
                            <div key={group.id} className="mb-6">
                                {/* Group Header */}
                                <div className="flex items-center gap-2 px-4 py-2 group cursor-pointer hover:bg-gray-50" onClick={() => toggleGroup(group.id)}>
                                    <div className={`p-1 rounded hover:bg-gray-200 transition-colors ${!group.isExpanded ? '-rotate-90' : ''}`}>
                                        <ChevronDown size={16} className="text-gray-500" />
                                    </div>
                                    <h3 className="font-semibold text-lg" style={{ color: group.color }}>
                                        {group.title}
                                    </h3>
                                    <span className="text-gray-400 text-sm font-normal">
                                        {group.items.length} tareas
                                    </span>
                                </div>

                                {group.isExpanded && (
                                    <div className="pl-4 pr-4">
                                        {/* Table Header */}
                                        <div className="flex items-center border-b border-gray-200 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            <div className="w-8 flex justify-center">
                                                <input type="checkbox" className="rounded border-gray-300" />
                                            </div>
                                            <div className="flex-1 px-4 border-r border-gray-100">Tarea</div>
                                            <div className="w-40 px-4 border-r border-gray-100 text-center">Responsable</div>
                                            <div className="w-40 px-4 border-r border-gray-100 text-center">Estado</div>
                                            <div className="w-32 px-4 text-center">Vencimiento</div>
                                            <div className="w-10"></div>
                                        </div>

                                        {/* Group Items with Drag and Drop */}
                                        <Droppable droppableId={group.id}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.droppableProps}
                                                    className="border-l-4"
                                                    style={{
                                                        borderColor: group.color,
                                                        backgroundColor: snapshot.isDraggingOver ? '#f9fafb' : 'transparent'
                                                    }}
                                                >
                                                    {group.items.map((item, index) => (
                                                        <Draggable
                                                            key={item.id.toString()}
                                                            draggableId={item.id.toString()}
                                                            index={index}
                                                        >
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    className={`flex items-center border-b border-gray-100 py-2 hover:bg-gray-50 group/row transition-all ${snapshot.isDragging ? 'shadow-lg bg-white' : ''
                                                                        }`}
                                                                >
                                                                    <div className="w-8 flex justify-center">
                                                                        <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing">
                                                                            <GripVertical size={16} className="text-gray-400" />
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex-1 px-4 border-r border-gray-100 flex items-center gap-2">
                                                                        <span className="text-sm text-gray-700 font-medium truncate capitalize">
                                                                            {item.nombre_proceso}
                                                                        </span>
                                                                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                                                            OT: {item.orden_id}
                                                                        </span>
                                                                    </div>
                                                                    <div className="w-40 px-4 border-r border-gray-100 flex justify-center">
                                                                        <Select
                                                                            value={item.id_operario?.toString() || "unassigned"}
                                                                            onValueChange={(value) => {
                                                                                if (value !== "unassigned") {
                                                                                    handleResponsibleChange(item.id, value);
                                                                                }
                                                                            }}
                                                                        >
                                                                            <SelectTrigger size="sm" className="w-full">
                                                                                <SelectValue>
                                                                                    {item.nombre_operario ? (
                                                                                        <div className="flex items-center gap-2">
                                                                                            <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                                                                                                {item.nombre_operario.charAt(0).toUpperCase()}
                                                                                            </div>
                                                                                            <span className="text-xs truncate">
                                                                                                {capitalizeFirst(item.nombre_operario)} {item.apellido_operario ? capitalizeFirst(item.apellido_operario) : ''}
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="flex items-center gap-2 text-gray-400">
                                                                                            <User size={14} />
                                                                                            <span className="text-xs">Sin asignar</span>
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
                                                                                {operarios.map(op => (
                                                                                    <SelectItem key={op.id} value={op.id.toString()}>
                                                                                        <div className="flex items-center gap-2">
                                                                                            <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                                                                                                {op.nombre.charAt(0).toUpperCase()}
                                                                                            </div>
                                                                                            <span>{capitalizeFirst(op.nombre)} {capitalizeFirst(op.apellido)}</span>
                                                                                        </div>
                                                                                    </SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div className="w-40 px-4 border-r border-gray-100 flex justify-center">
                                                                        <Select
                                                                            value={group.id}
                                                                            onValueChange={(value) => handleStatusChange(item.id, value)}
                                                                        >
                                                                            <SelectTrigger size="sm" className="w-full">
                                                                                <SelectValue>
                                                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(group.id)}`}>
                                                                                        {getStatusLabel(group.id)}
                                                                                    </span>
                                                                                </SelectValue>
                                                                            </SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="pendientes">
                                                                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-400 text-white">
                                                                                        Pendiente
                                                                                    </span>
                                                                                </SelectItem>
                                                                                <SelectItem value="en-curso">
                                                                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-400 text-white">
                                                                                        En curso
                                                                                    </span>
                                                                                </SelectItem>
                                                                                <SelectItem value="completados">
                                                                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-400 text-white">
                                                                                        Listo
                                                                                    </span>
                                                                                </SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div className="w-32 px-4 flex justify-center">
                                                                        <span className="text-sm text-gray-600">
                                                                            {item.fecha_prometida || '-'}
                                                                        </span>
                                                                    </div>
                                                                    <div className="w-10 flex justify-center opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                                        <button className="text-gray-400 hover:text-gray-600">
                                                                            <MoreHorizontal size={16} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}

                                                    {/* Add Task Row (Visual) */}
                                                    <div className="flex items-center py-2 hover:bg-gray-50 cursor-pointer">
                                                        <div className="w-8 flex justify-center">
                                                            <div className="w-4 h-4 rounded border border-gray-300"></div>
                                                        </div>
                                                        <div className="flex-1 px-4 flex items-center gap-2 text-gray-400 text-sm">
                                                            <Plus size={14} />
                                                            <span>Agregar tarea</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </Droppable>

                                        {/* Group Summary Footer */}
                                        <div className="flex items-center py-2">
                                            <div className="w-8"></div>
                                            <div className="flex-1"></div>
                                            <div className="w-40"></div>
                                            <div className="w-40 px-4">
                                                <div className="h-6 w-full bg-gray-200 rounded relative overflow-hidden">
                                                    <div
                                                        className="absolute top-0 left-0 h-full transition-all"
                                                        style={{
                                                            width: '100%',
                                                            backgroundColor: group.color
                                                        }}
                                                    ></div>
                                                </div>
                                            </div>
                                            <div className="w-32 px-4 text-center text-xs text-gray-500">
                                                {/* Date range summary could go here */}
                                            </div>
                                            <div className="w-10"></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </DragDropContext>
    );
};

export default TablaTareas;
