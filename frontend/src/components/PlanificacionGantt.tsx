"use client";

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import "gantt-task-react/dist/index.css";
import { ChevronLeft, ChevronRight, Calendar, List, Maximize2, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

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

const TaskListHeader: React.FC<{ headerHeight: number; isSidebarOpen?: boolean }> = ({ headerHeight, isSidebarOpen }) => {
    if (isSidebarOpen === false) return null;
    
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
    cargasMap: Record<string, { totalMinutos: number; porcentaje: number }>;
    isSidebarOpen?: boolean;
}> = ({ rowHeight, tasks, onExpanderClick, planificacionItems, cargasMap, isSidebarOpen }) => {
    
    if (isSidebarOpen === false) return null;

    return (
        <div style={{ fontFamily: 'inherit' }}>
            {tasks.map((t) => {
                const isProject = t.type === 'project';
                let mainText = t.name;
                let subText = '';
                
                if (isProject) {
                    // Recuperar nombre si está vacío (para ocultarlo en el gráfico)
                    if (!mainText || mainText === 'Rango Inicio' || mainText === 'Rango Fin') {
                        if (t.id === 'range-start' || t.id === 'range-end') {
                            return <div key={t.id} style={{ height: rowHeight }} />;
                        }
                        
                        if (t.id === 'op-none') {
                            mainText = 'Sin Operario Asignado';
                        } else if (t.id.startsWith('op-')) {
                            const opId = parseInt(t.id.replace('op-', ''));
                            // Optimización: Buscar en un mapa si fuera necesario, pero find es rápido para arrays pequeños de operarios
                            // Si planificacionItems es muy grande, esto podría optimizarse también, pero el cuello de botella principal era getOperarioCarga
                            const item = planificacionItems.find(p => p.id_operario === opId);
                            if (item) {
                                mainText = `${item.nombre_operario || ''} ${item.apellido_operario || ''}`.trim();
                            } else {
                                mainText = 'Operario';
                            }
                        }
                    }
                    
                    const carga = cargasMap[t.id] || { totalMinutos: 0, porcentaje: 0 };
                    
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
                                backgroundColor: '#f3f4f6',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s'
                            }}
                            onClick={() => onExpanderClick(t)}
                        >
                            <div 
                                style={{ 
                                    paddingLeft: 0,
                                    display: 'flex',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                    width: '100%',
                                    overflow: 'hidden'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }}>
                                    <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>
                                        {t.hideChildren ? '▶' : '▼'}
                                    </span>
                                    
                                    <div className="truncate w-full">
                                        <span style={{ 
                                            fontWeight: 700, 
                                            color: '#111827',
                                            fontSize: '0.875rem'
                                        }}>
                                            {mainText}
                                        </span>
                                    </div>
                                </div>

                                <div style={{ 
                                    fontSize: '0.65rem', 
                                    color: carga.porcentaje > 90 ? '#dc2626' : carga.porcentaje > 75 ? '#f59e0b' : '#10b981',
                                    fontWeight: 600,
                                    flexShrink: 0,
                                    paddingLeft: 8
                                }}>
                                    {Math.round(carga.totalMinutos / 60)}h/8h
                                </div>
                            </div>

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
                        </div>
                    );
                } else {
                    const parts = t.name.split(' (OT:');
                    mainText = parts[0];
                    if (parts.length > 1) {
                        subText = `OT: ${parts[1].replace(')', '')}`;
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
                                backgroundColor: '#fff',
                                cursor: 'default',
                            }}
                        >
                            <div 
                                style={{ 
                                    paddingLeft: 24,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-start',
                                    justifyContent: 'center',
                                    width: '100%',
                                    overflow: 'hidden'
                                }}
                            >
                                <div className="truncate w-full">
                                    <span style={{ 
                                        fontWeight: 500, 
                                        color: '#374151',
                                        fontSize: '0.8125rem'
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
                        </div>
                    );
                }
            })}
        </div>
    );
};

const PlanificacionGantt = () => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week); // Default a Semanas como en la imagen
    const [planificacionItems, setPlanificacionItems] = useState<PlanificacionItem[]>([]);
    const [selectedItem, setSelectedItem] = useState<PlanificacionItem | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [currentTimePosition, setCurrentTimePosition] = useState<number>(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
    const [ganttStartDate, setGanttStartDate] = useState<Date | null>(null);
    const nowLineRef = useRef<HTMLDivElement>(null);

    const ganttContainerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const startX = useRef(0);
    const scrollLeft = useRef(0);
    const isDragGesture = useRef(false);
    const animationFrameId = useRef<number | null>(null);

    // Optimización: Calcular cargas de trabajo una sola vez cuando cambian los items
    const cargasMap = useMemo(() => {
        const map: Record<string, { totalMinutos: number; porcentaje: number }> = {};
        const horasTrabajo = 8 * 60; // 8 horas

        // Agrupar minutos por operario
        const minutosPorOperario: Record<string, number> = {};

        planificacionItems.forEach(item => {
            const opId = item.id_operario ? `op-${item.id_operario}` : 'op-none';
            const duracion = item.fin_min - item.inicio_min;
            minutosPorOperario[opId] = (minutosPorOperario[opId] || 0) + duracion;
        });

        // Calcular porcentajes
        Object.keys(minutosPorOperario).forEach(opId => {
            const totalMinutos = minutosPorOperario[opId];
            const porcentaje = Math.min((totalMinutos / horasTrabajo) * 100, 100);
            map[opId] = { totalMinutos, porcentaje };
        });

        return map;
    }, [planificacionItems]);

    // Memoizar los componentes de tabla y cabecera para evitar re-renderizados innecesarios que resetean el scroll
    const MemoizedTaskListHeader = useMemo(() => {
        return (props: any) => <TaskListHeader {...props} isSidebarOpen={isSidebarOpen} />;
    }, [isSidebarOpen]);

    const MemoizedTaskListTable = useMemo(() => {
        return (props: any) => <TaskListTable {...props} planificacionItems={planificacionItems} cargasMap={cargasMap} isSidebarOpen={isSidebarOpen} />;
    }, [planificacionItems, cargasMap, isSidebarOpen]);

    const getScrollContainer = () => {
        if (!ganttContainerRef.current) return null;
        // Buscamos el contenedor específico que tiene el scroll horizontal
        // En gantt-task-react suele ser un div con overflow-x: auto o scroll
        const divs = ganttContainerRef.current.querySelectorAll('div');
        for (let i = 0; i < divs.length; i++) {
            const div = divs[i];
            // Verificamos explícitamente el estilo o la propiedad
            const style = window.getComputedStyle(div);
            if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
                return div;
            }
        }
        return null;
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const scrollContainer = getScrollContainer();
        if (scrollContainer) {
            const rect = ganttContainerRef.current?.getBoundingClientRect();
            if (!rect) return;
            
            const xInComponent = e.clientX - rect.left;
            const sidebarWidth = isSidebarOpen ? 300 : 0;
            
            // Si el click es en la sidebar, no iniciamos drag
            if (xInComponent < sidebarWidth) {
                return;
            }

            // IMPORTANTE: Ignorar si el click es en la barra de scroll vertical
            const scrollRect = scrollContainer.getBoundingClientRect();
            const scrollbarWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth;
            
            // Margen de seguridad de 20px para la barra de scroll
            if (e.clientX >= scrollRect.right - Math.max(scrollbarWidth, 20)) {
                return;
            }

            // Si el click está en la zona del scrollbar horizontal (abajo)
            const scrollbarHeight = scrollContainer.offsetHeight - scrollContainer.clientHeight;
            if (e.clientY >= scrollRect.bottom - Math.max(scrollbarHeight, 20)) {
                return;
            }

            isDragGesture.current = false;
            startX.current = e.pageX - scrollContainer.offsetLeft;
            scrollLeft.current = scrollContainer.scrollLeft;
            setIsDragging(true);
        }
    };

    const handleMouseLeave = () => {
        if (isDragging) {
            setIsDragging(false);
            isDragGesture.current = false;
        }
    };

    const handleMouseUp = () => {
        if (isDragging) {
            setIsDragging(false);
            // Pequeño timeout para evitar que el click se propague si fue un drag
            setTimeout(() => {
                isDragGesture.current = false;
            }, 100);
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        
        e.preventDefault();
        
        if (animationFrameId.current) return;

        animationFrameId.current = requestAnimationFrame(() => {
            const scrollContainer = getScrollContainer();
            if (scrollContainer) {
                const x = e.pageX - scrollContainer.offsetLeft;
                const walk = (x - startX.current) * 1.5; // Velocidad de scroll
                
                // Si se mueve más de 5px, lo consideramos un gesto de drag
                if (Math.abs(walk) > 5) {
                    isDragGesture.current = true;
                }
                
                scrollContainer.scrollLeft = scrollLeft.current - walk;
            }
            animationFrameId.current = null;
        });
    };

    const handleAutoAdjust = () => {
        const scrollContainer = getScrollContainer();
        if (scrollContainer && tasks.length > 0) {
            // Encontrar la fecha de inicio del gráfico (la tarea más antigua o range-start)
            // Como quitamos range-start, usamos ganttStartDate o la primera tarea
            const startDate = ganttStartDate || tasks[0].start;
            
            const now = new Date();
            
            const diffTime = now.getTime() - startDate.getTime();
            const diffHours = diffTime / (1000 * 60 * 60);
            
            const columnWidth = getColumnWidth();
            let pixels = 0;
            
            switch(viewMode) {
                case ViewMode.Hour:
                    pixels = diffHours * columnWidth;
                    break;
                case ViewMode.Day:
                    pixels = (diffHours / 24) * columnWidth;
                    break;
                case ViewMode.Week:
                    pixels = (diffHours / (24 * 7)) * columnWidth;
                    break;
                case ViewMode.Month:
                    pixels = (diffHours / (24 * 30)) * columnWidth;
                    break;
                case ViewMode.Year:
                    pixels = (diffHours / (24 * 365)) * columnWidth;
                    break;
            }

            const containerWidth = scrollContainer.clientWidth;
            // Centrar: restar la mitad del ancho del contenedor
            scrollContainer.scrollTo({
                left: pixels - (containerWidth / 2),
                behavior: 'smooth'
            });
        }
    };

    // Calcular posición de la línea "Ahora" basada en la hora actual
    useEffect(() => {
        const calculateTimePosition = () => {
            if (!ganttStartDate) return;

            const now = new Date();
            const diffTime = now.getTime() - ganttStartDate.getTime();
            const diffHours = diffTime / (1000 * 60 * 60);
            
            const columnWidth = getColumnWidth();
            let pixels = 0;
            
            switch(viewMode) {
                case ViewMode.Hour:
                    pixels = diffHours * columnWidth;
                    break;
                case ViewMode.Day:
                    pixels = (diffHours / 24) * columnWidth;
                    break;
                case ViewMode.Week:
                    pixels = (diffHours / (24 * 7)) * columnWidth;
                    break;
                case ViewMode.Month:
                    pixels = (diffHours / (24 * 30)) * columnWidth;
                    break;
                case ViewMode.Year:
                    pixels = (diffHours / (24 * 365)) * columnWidth;
                    break;
            }
            
            const sidebarWidth = isSidebarOpen ? 300 : 0;
            const position = sidebarWidth + pixels;
            
            setCurrentTimePosition(position);
        };

        calculateTimePosition();
        // Actualizar cada minuto
        const interval = setInterval(calculateTimePosition, 60000);
        
        return () => clearInterval(interval);
    }, [viewMode, isSidebarOpen, ganttStartDate]);

    // Sincronizar la línea roja con el scroll
    useEffect(() => {
        const container = getScrollContainer();
        if (!container) return;

        const handleScroll = () => {
            if (nowLineRef.current && currentTimePosition > 0) {
                // currentTimePosition es absoluto desde el inicio del gráfico + sidebar
                // visibleLeft = currentTimePosition - scrollLeft
                // Nota: currentTimePosition ya incluye sidebarWidth
                const visibleLeft = currentTimePosition - container.scrollLeft;
                nowLineRef.current.style.left = `${visibleLeft}px`;
            }
        };

        container.addEventListener('scroll', handleScroll);
        // Actualización inicial
        handleScroll();

        return () => container.removeEventListener('scroll', handleScroll);
    }, [currentTimePosition, isSidebarOpen]);

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
                        name: "", // Nombre vacío para no mostrarlo en el gráfico
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

                // Calcular la fecha de inicio real del gráfico (la menor de todas las tareas)
                let minDate = new Date();
                if (ganttTasks.length > 0) {
                    minDate = ganttTasks.reduce((min, t) => t.start < min ? t.start : min, ganttTasks[0].start);
                } else {
                    // Si no hay tareas, usar hoy a las 9
                    minDate = baseDate;
                }
                
                setTasks(ganttTasks);
                setGanttStartDate(minDate);

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
            case ViewMode.Year: return 350;
            case ViewMode.Month: return 300;
            case ViewMode.Week: return 250;
            case ViewMode.Day: return 65;
            case ViewMode.Hour: return 50;
            default: return 65;
        }
    };

    const getViewLabel = (mode: ViewMode) => {
        switch(mode) {
            case ViewMode.Hour: return 'Horas';
            case ViewMode.Day: return 'Días';
            case ViewMode.Week: return 'Semanas';
            case ViewMode.Month: return 'Meses';
            case ViewMode.Year: return 'Años';
            default: return 'Vista';
        }
    };

    if (tasks.length === 0) {
        return <div className="p-4 text-gray-500">No hay datos de planificación disponibles.</div>;
    }

    return (
        <div className="w-full bg-white rounded-lg shadow p-4">
            <div className="mb-4 flex justify-between items-center border-b pb-4">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-gray-800">Gantt</span>
                        <button className="text-gray-400 hover:text-gray-600">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                            </svg>
                        </button>
                    </div>
                    
                    <div className="h-6 w-px bg-gray-300 mx-2"></div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mr-4">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#10b981' }}></div>
                            <span className="text-xs">Normal</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f59e0b' }}></div>
                            <span className="text-xs">Alta</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#dc2626' }}></div>
                            <span className="text-xs">Critica</span>
                        </div>
                    </div>

                    <button
                        onClick={handleAutoAdjust}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white border rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm mr-2"
                    >
                        <Calendar size={14} />
                        Ajuste automático
                    </button>

                    <div className="relative">
                        <button 
                            onClick={() => setIsViewDropdownOpen(!isViewDropdownOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white border rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
                        >
                            {getViewLabel(viewMode)}
                            <ChevronDown size={14} />
                        </button>
                        
                        {isViewDropdownOpen && (
                            <>
                                <div 
                                    className="fixed inset-0 z-10" 
                                    onClick={() => setIsViewDropdownOpen(false)}
                                ></div>
                                <div className="absolute right-0 mt-1 w-36 bg-white border rounded-md shadow-lg z-20 py-1">
                                    <button 
                                        onClick={() => { setViewMode(ViewMode.Hour); setIsViewDropdownOpen(false); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Hour ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}`}
                                    >
                                        Horas
                                    </button>
                                    <button 
                                        onClick={() => { setViewMode(ViewMode.Day); setIsViewDropdownOpen(false); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Day ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}`}
                                    >
                                        Días
                                    </button>
                                    <button 
                                        onClick={() => { setViewMode(ViewMode.Week); setIsViewDropdownOpen(false); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Week ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}`}
                                    >
                                        Semanas
                                    </button>
                                    <button 
                                        onClick={() => { setViewMode(ViewMode.Month); setIsViewDropdownOpen(false); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Month ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}`}
                                    >
                                        Meses
                                    </button>
                                    <button 
                                        onClick={() => { setViewMode(ViewMode.Year); setIsViewDropdownOpen(false); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Year ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}`}
                                    >
                                        Años
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    
                    <div className="flex items-center border rounded-md overflow-hidden">
                        <button className="p-1.5 hover:bg-gray-100 text-gray-600 border-r">
                            <span className="text-xs font-medium">-</span>
                        </button>
                        <button className="p-1.5 hover:bg-gray-100 text-gray-600">
                            <span className="text-xs font-medium">+</span>
                        </button>
                    </div>
                </div>
            </div>
            
            <div 
                ref={ganttContainerRef}
                className="border rounded-lg relative select-none" 
                style={{ 
                    height: '500px', 
                    width: '100%', 
                    cursor: isDragging ? 'grabbing' : 'default',
                    // overflow: 'hidden' eliminado para evitar conflictos con el scroll vertical nativo
                }}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeave}
                onMouseUp={handleMouseUp}
                onMouseMove={handleMouseMove}
            >
                {/* Botón para colapsar/expandir sidebar */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsSidebarOpen(!isSidebarOpen);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`absolute z-30 flex items-center justify-center w-6 h-6 rounded-full shadow-md transition-all duration-300 border ${
                        isSidebarOpen 
                            ? 'bg-white border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200' 
                            : 'bg-red-600 border-red-600 text-white hover:bg-red-700'
                    }`}
                    style={{
                        top: '12px',
                        left: isSidebarOpen ? '270px' : '16px',
                    }}
                    title={isSidebarOpen ? "Ocultar lista" : "Mostrar lista"}
                >
                    {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                </button>

                {/* Línea vertical "Ahora" - Hora actual exacta */}
                {viewMode === ViewMode.Hour && currentTimePosition > (isSidebarOpen ? 300 : 0) && (
                    <div 
                        ref={nowLineRef}
                        className="absolute top-0 bottom-0 pointer-events-none z-20"
                        style={{ 
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

                <div style={{ pointerEvents: isDragging ? 'none' : 'auto', height: '100%' }}>
                    <Gantt
                        key={isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}
                        tasks={tasks}
                        viewMode={viewMode}
                        locale="es"
                        columnWidth={getColumnWidth()}
                        listCellWidth={isSidebarOpen ? "300px" : "0px"}
                        barFill={80}
                        ganttHeight={500}
                        rowHeight={50}
                        barCornerRadius={4}
                        fontFamily="inherit"
                        TaskListHeader={MemoizedTaskListHeader}
                        TaskListTable={MemoizedTaskListTable}
                        TooltipContent={CustomTooltip}
                        onSelect={(task, isSelected) => {
                            if (!isDragGesture.current) {
                                handleTaskSelect(task, isSelected);
                            }
                        }}
                        onDoubleClick={(task) => {
                            if (!isDragGesture.current) {
                                handleTaskSelect(task, true);
                            }
                        }}
                        onExpanderClick={handleExpanderClick}
                        todayColor="rgba(252, 165, 165, 0.1)"
                    />
                </div>
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
