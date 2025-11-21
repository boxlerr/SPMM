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
    Circle
} from 'lucide-react';

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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await fetch('http://localhost:8000/planificacion');
                if (!response.ok) {
                    throw new Error('Error al obtener la planificación');
                }
                const data: PlanificacionItem[] = await response.json();
                setItems(data);
                organizeGroups(data);
            } catch (error) {
                console.error("Error fetching planificacion:", error);
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
                color: '#f59e0b', // Amber
                items: enCurso,
                isExpanded: true
            },
            {
                id: 'pendientes',
                title: 'Pendientes',
                color: '#3b82f6', // Blue
                items: pendientes,
                isExpanded: true
            },
            {
                id: 'completados',
                title: 'Completado',
                color: '#10b981', // Emerald
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

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando tareas...</div>;
    }

    return (
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
                                        <div className="w-32 px-4 border-r border-gray-100 text-center">Estado</div>
                                        <div className="w-32 px-4 text-center">Vencimiento</div>
                                        <div className="w-10"></div>
                                    </div>

                                    {/* Group Items */}
                                    <div className="border-l-4" style={{ borderColor: group.color }}>
                                        {group.items.map(item => (
                                            <div key={`${item.orden_id}-${item.proceso_id}`} className="flex items-center border-b border-gray-100 py-2 hover:bg-gray-50 group/row transition-colors">
                                                <div className="w-8 flex justify-center">
                                                    <input type="checkbox" className="rounded border-gray-300" />
                                                </div>
                                                <div className="flex-1 px-4 border-r border-gray-100 flex items-center gap-2">
                                                    <span className="text-sm text-gray-700 font-medium truncate">
                                                        {item.nombre_proceso}
                                                    </span>
                                                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                                        OT: {item.orden_id}
                                                    </span>
                                                </div>
                                                <div className="w-40 px-4 border-r border-gray-100 flex justify-center">
                                                    {item.nombre_operario ? (
                                                        <div className="flex items-center gap-2" title={`${item.nombre_operario} ${item.apellido_operario || ''}`}>
                                                            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                                                                {item.nombre_operario.charAt(0)}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center">
                                                            <User size={14} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="w-32 px-4 border-r border-gray-100 flex justify-center">
                                                    <span className={`px-3 py-1 rounded text-xs font-medium w-full text-center ${getStatusColor(group.id)}`}>
                                                        {getStatusLabel(group.id)}
                                                    </span>
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
                                        ))}
                                        
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
                                    
                                    {/* Group Summary Footer */}
                                    <div className="flex items-center py-2">
                                        <div className="w-8"></div>
                                        <div className="flex-1"></div>
                                        <div className="w-40"></div>
                                        <div className="w-32 px-4">
                                            <div className="h-6 w-full bg-gray-200 rounded relative overflow-hidden">
                                                <div 
                                                    className="absolute top-0 left-0 h-full" 
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
    );
};

export default TablaTareas;
