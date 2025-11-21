"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import "gantt-task-react/dist/index.css";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";

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

// Paleta de colores para procesos
const PROCESS_COLORS = [
    '#3b82f6', // blue-500
    '#ef4444', // red-500
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#8b5cf6', // violet-500
    '#ec4899', // pink-500
    '#06b6d4', // cyan-500
    '#f97316', // orange-500
];

const getProcessColor = (processName: string) => {
    let hash = 0;
    for (let i = 0; i < processName.length; i++) {
        hash = processName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % PROCESS_COLORS.length;
    return PROCESS_COLORS[index];
};

// Componente de Tooltip Personalizado
const CustomTooltip: React.FC<{
    task: Task;
    fontSize: string;
    fontFamily: string;
}> = ({ task, fontSize, fontFamily }) => {
    if (task.type === 'project') return null;

    // Extraer datos del ID o nombre si es necesario, pero idealmente pasamos info en la tarea
    // Como la librería no permite pasar data arbitraria fácilmente en 'Task', 
    // parseamos el nombre o usamos el estado global si fuera necesario.
    // Aquí usaremos el nombre y fechas que ya tiene la tarea.
    
    return (
        <div style={{
            backgroundColor: 'white',
            padding: '12px',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            border: '1px solid #e5e7eb',
            fontSize: '12px',
            fontFamily,
            zIndex: 1000,
            minWidth: '200px'
        }}>
            <div className="font-bold text-gray-900 mb-1 text-sm">{task.name.split(' (OT:')[0]}</div>
            <div className="text-gray-600 mb-2">
                {task.name.match(/\(OT: \d+\)/)?.[0] || ''}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="font-semibold">Inicio:</span>
                <span>{task.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                
                <span className="font-semibold">Fin:</span>
                <span>{task.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                
                <span className="font-semibold">Duración:</span>
                <span>{Math.round((task.end.getTime() - task.start.getTime()) / 60000)} min</span>
            </div>
        </div>
    );
};

const TaskListHeader: React.FC<{ headerHeight: number }> = ({ headerHeight }) => {
    return (
        <div
            style={{
                height: headerHeight,
                fontFamily: 'inherit',
                fontWeight: 'bold',
                paddingLeft: 16,
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
                color: '#374151',
                fontSize: '0.875rem'
            }}
        >
            Operario / Tarea
        </div>
    );
};

const TaskListTable: React.FC<{ 
    rowHeight: number; 
    tasks: Task[]; 
    onExpanderClick: (task: Task) => void;
    planificacionItems: PlanificacionItem[];
}> = ({ rowHeight, tasks, onExpanderClick, planificacionItems }) => {
    
    // Calcular carga de cada operario
    const getOperarioCarga = (operarioId: string) => {
        const tareasOperario = tasks.filter(t => t.project === operarioId && t.type === 'task');
        const totalMinutos = tareasOperario.reduce((acc, t) => {
            return acc + (t.end.getTime() - t.start.getTime()) / 60000;
        }, 0);
        const horasTrabajo = 8 * 60; // 8 horas de trabajo
        const porcentaje = Math.min((totalMinutos / horasTrabajo) * 100, 100);
        return { totalMinutos, porcentaje };
    };

    return (
        <div style={{ fontFamily: 'inherit' }}>
            {tasks.map((t) => {
                const isProject = t.type === 'project';
                let mainText = t.name;
                let subText = '';
                
                if (!isProject) {
                    const parts = t.name.split(' (OT:');
                    mainText = parts[0];
                    if (parts.length > 1) {
                        subText = `OT: ${parts[1].replace(')', '')}`;
                    }
                }

                // Calcular carga si es un operario
                let carga = null;
                if (isProject) {
                    carga = getOperarioCarga(t.id);
                }

                return (
                    <div
                        key={t.id}
                        style={{
                            height: rowHeight,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            paddingLeft: 16,
                            paddingRight: 16,
                            borderBottom: '1px solid #e5e7eb',
                            backgroundColor: isProject ? '#f3f4f6' : '#fff',
                            cursor: isProject ? 'pointer' : 'default',
                            transition: 'background-color 0.2s'
                        }}
                        onClick={() => isProject && onExpanderClick(t)}
                    >
                        <div 
                            style={{ 
                                paddingLeft: isProject ? 0 : 24,
                                display: 'flex',
                                flexDirection: isProject ? 'row' : 'column',
                                alignItems: isProject ? 'center' : 'flex-start',
                                justifyContent: isProject ? 'space-between' : 'center',
                                gap: isProject ? 8 : 0,
                                width: '100%',
                                overflow: 'hidden'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }}>
                                {isProject && (
                                    <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>
                                        {t.hideChildren ? '▶' : '▼'}
                                    </span>
                                )}
                                
                                <div className="truncate w-full">
                                    <span style={{ 
                                        fontWeight: isProject ? 700 : 500, 
                                        color: isProject ? '#111827' : '#374151',
                                        fontSize: isProject ? '0.875rem' : '0.8125rem'
                                    }}>
                                        {mainText}
                                    </span>
                                    {subText && (
                                        <span style={{ 
                                            display: 'block', 
                                            fontSize: '0.75rem', 
                                            color: '#6b7280',
                                            marginTop: '-2px'
                                        }}>
                                            {subText}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Indicador de carga para operarios */}
                            {isProject && carga && (
                                <div style={{ 
                                    fontSize: '0.65rem', 
                                    color: carga.porcentaje > 90 ? '#dc2626' : carga.porcentaje > 75 ? '#f59e0b' : '#10b981',
                                    fontWeight: 600,
                                    flexShrink: 0,
                                    paddingLeft: 8
                                }}>
                                    {Math.round(carga.totalMinutos / 60)}h/8h
                                </div>
                            )}
                        </div>

                        {/* Barra de carga visual para operarios */}
                        {isProject && carga && (
                            <div style={{ 
                                marginTop: 4,
                                height: 3,
                                backgroundColor: '#e5e7eb',
                                borderRadius: 2,
                                overflow: 'hidden',
                                width: '100%'
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${carga.porcentaje}%`,
                                    backgroundColor: carga.porcentaje > 90 ? '#dc2626' : carga.porcentaje > 75 ? '#f59e0b' : '#10b981',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

const PlanificacionGantt = () => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Hour);
    const [planificacionItems, setPlanificacionItems] = useState<PlanificacionItem[]>([]);
    const [selectedItem, setSelectedItem] = useState<PlanificacionItem | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [currentTimePosition, setCurrentTimePosition] = useState<number>(0);

    // Calcular posición de la línea "Ahora" basada en la hora actual
    useEffect(() => {
        const calculateTimePosition = () => {
            const now = new Date();
            const baseDate = new Date();
            baseDate.setHours(9, 0, 0, 0);
            
            // Calcular minutos desde las 9:00 AM
            const minutesSinceBase = (now.getTime() - baseDate.getTime()) / 60000;
            
            // Calcular posición en píxeles (300px de lista + columnWidth * minutos)
            const columnWidth = getColumnWidth();
            const position = 300 + (minutesSinceBase * columnWidth / 60); // columnWidth por hora / 60 minutos
            
            setCurrentTimePosition(position);
        };

        calculateTimePosition();
        // Actualizar cada minuto
        const interval = setInterval(calculateTimePosition, 60000);
        
        return () => clearInterval(interval);
    }, [viewMode]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await fetch('http://localhost:8000/planificacion');
                if (!response.ok) {
                    throw new Error('Error al obtener la planificación');
                }
                const data: PlanificacionItem[] = await response.json();
                setPlanificacionItems(data);
                
                if (data.length === 0) {
                    setTasks([]);
                    return;
                }

                // Configurar fecha base: Hoy a las 9:00 AM
                const baseDate = new Date();
                baseDate.setHours(9, 0, 0, 0);

                // 1. Identificar todos los operarios únicos (y "Sin Operario")
                const operariosMap = new Map<string, { id: string, name: string }>();
                
                data.forEach(item => {
                    const opId = item.id_operario ? `op-${item.id_operario}` : 'op-none';
                    let opName = 'Sin Operario Asignado';
                    if (item.nombre_operario) {
                        opName = `${item.nombre_operario} ${item.apellido_operario || ''}`.trim();
                    }
                    
                    if (!operariosMap.has(opId)) {
                        operariosMap.set(opId, { id: opId, name: opName });
                    }
                });

                // Convertir mapa a array y ordenar (opcional: poner "Sin Operario" al final)
                const operarios = Array.from(operariosMap.values()).sort((a, b) => {
                    if (a.id === 'op-none') return 1;
                    if (b.id === 'op-none') return -1;
                    return a.name.localeCompare(b.name);
                });

                const ganttTasks: Task[] = [];

                // 2. Crear tareas de tipo "project" para cada operario
                operarios.forEach(op => {
                    // Tarea padre (Operario)
                    ganttTasks.push({
                        start: baseDate,
                        end: baseDate, // Se ajustará dinámicamente
                        name: op.name,
                        id: op.id,
                        type: 'project',
                        progress: 0,
                        isDisabled: true,
                        hideChildren: true,
                        styles: { 
                            backgroundColor: '#f3f4f6', 
                            backgroundSelectedColor: '#e5e7eb', 
                            progressColor: '#f3f4f6', 
                            progressSelectedColor: '#e5e7eb' 
                        }
                    });

                    // 3. Filtrar tareas para este operario
                    const tareasOperario = data.filter(item => {
                        const itemOpId = item.id_operario ? `op-${item.id_operario}` : 'op-none';
                        return itemOpId === op.id;
                    });

                    tareasOperario.forEach((item, index) => {
                        const start = new Date(baseDate.getTime() + item.inicio_min * 60000);
                        const end = new Date(baseDate.getTime() + item.fin_min * 60000);
                        
                        // Asegurar duración mínima visual
                        if (end.getTime() <= start.getTime()) {
                            end.setTime(start.getTime() + 60000);
                        }

                        const color = getProcessColor(item.nombre_proceso || 'default');

                        ganttTasks.push({
                            start: start,
                            end: end,
                            name: `${item.nombre_proceso || 'Proceso'} (OT: ${item.orden_id})`,
                            id: `task-${item.orden_id}-${item.proceso_id}-${index}`,
                            type: 'task',
                            project: op.id,
                            progress: 0,
                            isDisabled: false,
                            styles: { 
                                progressColor: color, 
                                progressSelectedColor: color,
                                backgroundColor: color,
                                backgroundSelectedColor: color
                            },
                        });
                    });
                });
                
                setTasks(ganttTasks);

            } catch (error) {
                console.error("Error fetching planificacion:", error);
            }
        };

        fetchData();
    }, []);

    const handleTaskSelect = (task: Task, isSelected: boolean) => {
        if (task.type === 'project') return;

        const parts = task.id.split('-');
        if (parts.length >= 4) {
            const ordenId = parseInt(parts[1]);
            const procesoId = parseInt(parts[2]);
            const item = planificacionItems.find(p => p.orden_id === ordenId && p.proceso_id === procesoId);
            
            if (item) {
                setSelectedItem(item);
                setIsDialogOpen(true);
            }
        }
    };

    const handleExpanderClick = (task: Task) => {
        setTasks(prevTasks => 
            prevTasks.map(t => 
                t.id === task.id 
                    ? { ...t, hideChildren: !t.hideChildren }
                    : t
            )
        );
    };

    const getColumnWidth = () => {
        switch(viewMode) {
            case ViewMode.Month: return 300;
            case ViewMode.Day: return 80;
            case ViewMode.Hour: return 65;
            default: return 65;
        }
    };

    if (tasks.length === 0) {
        return <div className="p-4 text-gray-500">No hay datos de planificación disponibles.</div>;
    }

    return (
        <div className="w-full bg-white rounded-lg shadow p-4">
            <div className="mb-4 flex justify-between items-center">
                <div className="flex gap-2">
                    <button 
                        onClick={() => setViewMode(ViewMode.Hour)} 
                        className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Hour ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >
                        Día (Horas)
                    </button>
                    <button 
                        onClick={() => setViewMode(ViewMode.Day)} 
                        className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Day ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >
                        Semana (Días)
                    </button>
                    <button 
                        onClick={() => setViewMode(ViewMode.Month)} 
                        className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Month ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >
                        Mes
                    </button>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#10b981' }}></div>
                            <span className="text-xs">Carga normal</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f59e0b' }}></div>
                            <span className="text-xs">Carga alta</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#dc2626' }}></div>
                            <span className="text-xs">Sobrecarga</span>
                        </div>
                    </div>
                    <span>Inicio: 09:00 AM</span>
                </div>
            </div>
            
            <div 
                className="border rounded-lg relative" 
                style={{ height: '500px', width: '100%' }}
            >
                {/* Línea vertical "Ahora" - Hora actual exacta */}
                {viewMode === ViewMode.Hour && currentTimePosition > 300 && (
                    <div 
                        className="absolute top-0 bottom-0 pointer-events-none z-20"
                        style={{ 
                            left: `${currentTimePosition}px`,
                            width: '2px',
                            backgroundColor: '#ef4444',
                            boxShadow: '0 0 4px rgba(239, 68, 68, 0.6)'
                        }}
                    >
                        <div 
                            className="absolute -top-6 -left-8 bg-red-500 text-white text-xs px-2 py-0.5 rounded"
                            style={{ fontSize: '10px' }}
                        >
                            Ahora {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>
                )}

                <Gantt
                    tasks={tasks}
                    viewMode={viewMode}
                    locale="es"
                    columnWidth={getColumnWidth()}
                    listCellWidth="300px"
                    barFill={80}
                    ganttHeight={500}
                    rowHeight={50}
                    barCornerRadius={4}
                    fontFamily="inherit"
                    TaskListHeader={TaskListHeader}
                    TaskListTable={(props) => <TaskListTable {...props} planificacionItems={planificacionItems} />}
                    TooltipContent={CustomTooltip}
                    onSelect={handleTaskSelect}
                    onDoubleClick={(task) => handleTaskSelect(task, true)}
                    onExpanderClick={handleExpanderClick}
                    todayColor="rgba(252, 165, 165, 0.1)"
                />
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Detalle de Planificación</DialogTitle>
                        <DialogDescription>
                            Información detallada del proceso seleccionado.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedItem && (
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <span className="font-bold text-right">Proceso:</span>
                                <span className="col-span-3 flex items-center gap-2">
                                    <div 
                                        className="w-3 h-3 rounded-full" 
                                        style={{ backgroundColor: getProcessColor(selectedItem.nombre_proceso || 'default') }}
                                    />
                                    {selectedItem.nombre_proceso}
                                </span>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <span className="font-bold text-right">Orden de Trabajo:</span>
                                <span className="col-span-3">#{selectedItem.orden_id}</span>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <span className="font-bold text-right">Operario:</span>
                                <span className="col-span-3">
                                    {selectedItem.nombre_operario 
                                        ? `${selectedItem.nombre_operario} ${selectedItem.apellido_operario || ''}` 
                                        : 'Sin asignar'}
                                </span>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <span className="font-bold text-right">Maquinaria:</span>
                                <span className="col-span-3">
                                    {selectedItem.nombre_maquinaria || 'Sin asignar'}
                                </span>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <span className="font-bold text-right">Duración:</span>
                                <span className="col-span-3">{selectedItem.fin_min - selectedItem.inicio_min} minutos</span>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <span className="font-bold text-right">Fecha Prometida:</span>
                                <span className="col-span-3">{selectedItem.fecha_prometida || 'N/A'}</span>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default PlanificacionGantt;
