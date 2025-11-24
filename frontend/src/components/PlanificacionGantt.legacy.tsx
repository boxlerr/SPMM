"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import "./PlanificacionGantt.module.css";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { usePanelContext } from "@/contexts/PanelContext";

// Components
import TaskListHeader from "./gantt/TaskListHeader";
import TaskListTable from "./gantt/TaskListTable";
import CustomTooltip from "./gantt/CustomTooltip";
import SidebarPanel from "./gantt/SidebarPanel";

// Libs
import {
  getProcessColor,
  getColumnWidth,
  getZoomLimits,
  getViewLabel,
} from "../lib/gantt-utils";
import {
  PlanificacionItem,
  Operario,
  calculateCargas,
  transformToGanttTasks,
} from "../lib/gantt-transform";
import {
  setupBarListeners,
  handleWheelScroll,
  setupDragToPan,
} from "../lib/gantt-events";

const PlanificacionGantt = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
  const [planificacionItems, setPlanificacionItems] = useState<
    PlanificacionItem[]
  >([]);
  const [selectedItem, setSelectedItem] = useState<PlanificacionItem | null>(
    null
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [currentTimePosition, setCurrentTimePosition] = useState<number>(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [ganttStartDate, setGanttStartDate] = useState<Date | null>(null);
  const [operarios, setOperarios] = useState<Operario[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [columnWidth, setColumnWidth] = useState<number>(350);
  const nowLineRef = useRef<HTMLDivElement>(null);

  // Ref para acceder a tasks sin causar re-renders
  const tasksRef = useRef<Task[]>([]);

  // Sincronizar tasksRef cuando tasks cambia
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Sincronizar estado del panel con el contexto para que Topbar se mueva
  const { setIsDetailsPanelOpen } = usePanelContext();
  useEffect(() => {
    setIsDetailsPanelOpen(detailsOpen);
  }, [detailsOpen, setIsDetailsPanelOpen]);

  const ganttContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  // Refs para diferenciar click vs drag
  const dragStateRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    taskId: string | null;
    startTime: number;
    isMouseDown: boolean;
    hasMoved: boolean;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    taskId: null,
    startTime: 0,
    isMouseDown: false,
    hasMoved: false,
  });

  const lastDragRef = useRef<{ taskId: string | null; time: number }>({
    taskId: null,
    time: 0,
  });

  // Flag para prevenir que se abra el modal durante un drag
  const preventModalRef = useRef<boolean>(false);
  // Timeout para abrir el modal con delay
  const modalTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cargas por operario
  const cargasMap = useMemo(() => {
    return calculateCargas(planificacionItems);
  }, [planificacionItems]);

  const MemoizedTaskListHeader = useMemo(() => {
    return (props: any) => (
      <TaskListHeader {...props} isSidebarOpen={isSidebarOpen} />
    );
  }, [isSidebarOpen]);

  const MemoizedTaskListTable = useMemo(() => {
    return (props: any) => (
      <TaskListTable
        {...props}
        planificacionItems={planificacionItems}
        cargasMap={cargasMap}
        isSidebarOpen={isSidebarOpen}
        onTaskClick={(item: PlanificacionItem) => {
          // Toggle: si es la misma tarea, cerrar el panel
          if (selectedItem && selectedItem.id === item.id) {
            setDetailsOpen(false);
            setSelectedItem(null);
          } else {
            // Si es diferente, abrir con la nueva tarea
            setSelectedItem(item);
            setDetailsOpen(true);
          }
        }}
        getProcessColor={getProcessColor}
      />
    );
  }, [planificacionItems, cargasMap, isSidebarOpen, selectedItem]);

  const getScrollContainer = () => {
    if (!ganttContainerRef.current) return null;
    const divs = ganttContainerRef.current.querySelectorAll("div");
    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      const style = window.getComputedStyle(div);
      const hasHorizontalScroll =
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        div.scrollWidth > div.clientWidth;
      const hasVerticalScroll =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        div.scrollHeight > div.clientHeight;

      if (hasHorizontalScroll || hasVerticalScroll) {
        return div;
      }
    }
    return null;
  };

  const handleAutoAdjust = () => {
    const scrollContainer = getScrollContainer();
    if (scrollContainer && tasks.length > 0) {
      const startDate = ganttStartDate || tasks[0].start;

      const now = new Date();

      const diffTime = now.getTime() - startDate.getTime();
      const diffHours = diffTime / (1000 * 60 * 60);

      const columnWidth = getColumnWidth(viewMode);
      let pixels = 0;

      switch (viewMode) {
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

      scrollContainer.scrollTo({
        left: pixels - containerWidth / 2,
        behavior: "smooth",
      });
    }
  };

  // Línea "Ahora"
  useEffect(() => {
    const calculateTimePosition = () => {
      if (!ganttStartDate) return;

      const now = new Date();
      const diffTime = now.getTime() - ganttStartDate.getTime();
      const diffHours = diffTime / (1000 * 60 * 60);

      const columnWidth = getColumnWidth(viewMode);
      let pixels = 0;

      switch (viewMode) {
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
    const interval = setInterval(calculateTimePosition, 60000);

    return () => clearInterval(interval);
  }, [viewMode, isSidebarOpen, ganttStartDate]);

  // Scroll mejorado: Sincronización de línea roja, Shift+Wheel y Drag-to-Pan
  useEffect(() => {
    const wrapper = ganttContainerRef.current;
    if (!wrapper) return;

    // 1. Buscar el contenedor con scroll
    let scrollContainer: HTMLElement | null = null;

    const findScrollContainer = () => {
      const divs = wrapper.querySelectorAll("div");
      for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        const style = window.getComputedStyle(div);
        if (style.overflowX === "auto" || style.overflowX === "scroll") {
          return div;
        }
      }
      // Fallback
      for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        const style = window.getComputedStyle(div);
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          div.scrollHeight > div.clientHeight
        ) {
          return div;
        }
      }
      return null;
    };

    scrollContainer = findScrollContainer();

    if (!scrollContainer) return;
    scrollContainerRef.current = scrollContainer;

    // --- A. Lógica de Línea Roja (Ahora) ---
    const handleScroll = () => {
      if (!scrollContainer) return;
      if (nowLineRef.current && currentTimePosition > 0) {
        const visibleLeft = currentTimePosition - scrollContainer.scrollLeft;
        nowLineRef.current.style.left = `${visibleLeft}px`;
      }
    };

    // Agregar listeners
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    // --- B. Shift + Wheel (Scroll Horizontal) ---
    const wheelHandler = (e: WheelEvent) => handleWheelScroll(e, scrollContainer!);
    wrapper.addEventListener("wheel", wheelHandler, {
      passive: false,
      capture: true,
    });

    // --- C. Drag-to-Pan (Estilo Figma/Miro) ---
    const cleanupDrag = setupDragToPan(wrapper, scrollContainer);

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
      wrapper.removeEventListener("wheel", wheelHandler, {
        capture: true,
      } as any);
      cleanupDrag();
    };
  }, [currentTimePosition, isSidebarOpen, tasks]);

  // Inyectar listeners pointer directamente en las barras <rect> del Gantt
  useEffect(() => {
    const container = ganttContainerRef.current;
    if (!container || tasks.length === 0) return;

    // Inyectar listeners después de que el Gantt se renderice
    const timeout = setTimeout(() => {
      setupBarListeners({
        container,
        tasks,
        planificacionItems,
        setSelectedItem,
        setDetailsOpen,
        setSelectedTaskId,
        setTasks,
        tasksRef,
        preventModalRef,
        modalTimeoutRef,
        selectedItem,
      });
    }, 100);

    // Re-inyectar cuando cambien las tareas
    const observer = new MutationObserver(() => {
      setupBarListeners({
        container,
        tasks,
        planificacionItems,
        setSelectedItem,
        setDetailsOpen,
        setSelectedTaskId,
        setTasks,
        tasksRef,
        preventModalRef,
        modalTimeoutRef,
        selectedItem,
      });
    });

    if (container) {
      observer.observe(container, { childList: true, subtree: true });
    }

    return () => {
      clearTimeout(timeout);
      observer.disconnect();

      // Limpiar listeners de todas las barras
      const svg = container?.querySelector("svg");
      if (svg) {
        const allRects = svg.querySelectorAll("rect[data-task-id]");
        allRects.forEach((rect) => {
          const listeners = (rect as any).__ganttListeners;
          if (listeners) {
            rect.removeEventListener("pointerdown", listeners.pointerdown);
            rect.removeEventListener("pointermove", listeners.pointermove);
            rect.removeEventListener("pointerup", listeners.pointerup);
          }
          if ((rect as any).__holdTimeout) {
            clearTimeout((rect as any).__holdTimeout);
          }
        });
      }

      // Limpiar timeout del modal
      if (modalTimeoutRef.current) {
        clearTimeout(modalTimeoutRef.current);
        modalTimeoutRef.current = null;
      }
    };
  }, [tasks, planificacionItems, selectedItem]); // Re-ejecutar cuando cambien las tareas o el item seleccionado

  // Fetch planificación
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("http://localhost:8000/planificacion");
        if (!response.ok) {
          throw new Error("Error al obtener la planificación");
        }
        const data: PlanificacionItem[] = await response.json();
        setPlanificacionItems(data);

        const { tasks: ganttTasks, startDate } = transformToGanttTasks(data);

        setTasks(ganttTasks);
        tasksRef.current = ganttTasks;
        setGanttStartDate(startDate);
      } catch (error) {
        console.error("Error fetching planificacion:", error);
      }
    };

    fetchData();
  }, []);

  // Fetch operarios
  useEffect(() => {
    const fetchOperarios = async () => {
      try {
        const response = await fetch("http://localhost:8000/operarios");
        if (response.ok) {
          const data = await response.json();
          if (data.data && Array.isArray(data.data)) {
            setOperarios(data.data);
          } else if (Array.isArray(data)) {
            setOperarios(data);
          } else {
            console.error("Operarios data is not an array:", data);
            setOperarios([]);
          }
        }
      } catch (error) {
        console.error("Error fetching operarios:", error);
        setOperarios([]);
      }
    };
    fetchOperarios();
  }, []);

  const handleTaskChange = async (task: Task) => {
    const parts = task.id.split("-");
    if (parts.length < 5) {
      return;
    }

    const dbId = parseInt(parts[4]);
    if (isNaN(dbId)) {
      console.warn("Invalid dbId in handleTaskChange:", parts[4]);
      return;
    }

    const item = planificacionItems.find((p) => p.id === dbId);
    if (!item) {
      console.warn("Item not found for dbId:", dbId);
      return;
    }

    const oldTask = tasks.find((t) => t.id === task.id);
    if (!oldTask) {
      console.warn("Old task not found:", task.id);
      return;
    }

    const diffMillis = task.start.getTime() - oldTask.start.getTime();
    // Aumentar el umbral para evitar cambios muy pequeños
    if (Math.abs(diffMillis) < 1000) {
      return;
    }

    const diffMinutes = Math.round(diffMillis / 60000);

    const newInicio = item.inicio_min + diffMinutes;
    const newFin = item.fin_min + diffMinutes;

    // Validar que los valores sean válidos
    if (newInicio < 0 || newFin < 0 || newFin <= newInicio) {
      console.warn("Invalid time values:", { newInicio, newFin });
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:8000/planificacion/${dbId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inicio_min: newInicio,
            fin_min: newFin,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorText}`
        );
      }

      setPlanificacionItems((prev) =>
        prev.map((p) =>
          p.id === dbId ? { ...p, inicio_min: newInicio, fin_min: newFin } : p
        )
      );

      setTasks((prev) => {
        const updated = prev.map((t) =>
          t.id === task.id ? { ...t, start: task.start, end: task.end } : t
        );
        tasksRef.current = updated;
        return updated;
      });
    } catch (error) {
      // Solo mostrar error si realmente era un drag intencional
      const dragState = dragStateRef.current;
      if (dragState.isDragging) {
        console.error("Error updating task:", error);
        // Revertir el cambio visual si la petición falló
        setTasks((prev) => {
          const updated = prev.map((t) =>
            t.id === task.id
              ? { ...t, start: oldTask.start, end: oldTask.end }
              : t
          );
          tasksRef.current = updated;
          return updated;
        });
      }
      // Re-lanzar el error solo si realmente era un drag
      if (dragState.isDragging) {
        throw error;
      }
      // Si no era un drag, simplemente retornar sin hacer nada
      return;
    }
  };

  // CLICK vs DRAG – ahora manejado por los listeners pointer en las barras
  // Este handler solo se usa para limpiar selección, el modal se abre desde los listeners pointer
  const handleGanttSelect = (task: Task, isSelected: boolean) => {
    // Ignorar selects sobre proyectos / filas de operario
    if (task.type === "project") return;

    // Si se deselecciona, limpiar el estado
    if (!isSelected) {
      setSelectedTaskId(null);
      return;
    }

    // Los clicks reales ahora se manejan en los listeners pointer
    // Este handler solo limpia la selección visual
    setTimeout(() => {
      setTasks((prevTasks) => {
        const updated = prevTasks.map((t) => ({ ...t, isSelected: false }));
        tasksRef.current = updated;
        return updated;
      });
    }, 50);
  };

  const handleGanttDateChange = async (task: Task) => {
    // Verificar que la tarea es válida
    const parts = task.id.split("-");
    if (parts.length < 5) {
      return;
    }

    // Verificar que realmente hubo un cambio significativo comparando con la tarea anterior
    const oldTask = tasks.find((t) => t.id === task.id);
    if (!oldTask) {
      return;
    }

    const diffMillis = task.start.getTime() - oldTask.start.getTime();

    // Verificar que realmente hubo un drag antes de procesar
    const dragState = dragStateRef.current;

    // CRÍTICO: Solo procesar si se detectó movimiento significativo (drag confirmado)
    // Si no hay drag confirmado Y el cambio es pequeño, es un click simple - no hacer nada
    if (!dragState.isDragging) {
      // Si el cambio es muy pequeño (< 2 segundos), definitivamente es un click, no un drag
      if (Math.abs(diffMillis) < 2000) {
        return;
      }
      // Si el cambio es mayor pero no se detectó drag, puede ser un movimiento accidental
      // Solo permitir si el cambio es realmente grande (más de 1 minuto)
      if (Math.abs(diffMillis) < 60000) {
        return;
      }
    }

    // Si el cambio es muy pequeño incluso con drag, puede ser un ajuste mínimo - ignorar
    if (Math.abs(diffMillis) < 1000) {
      return;
    }

    // Solo proceder si realmente hay un drag confirmado
    try {
      // Marcamos que esta tarea se acaba de mover (drag)
      const now = Date.now();
      lastDragRef.current = { taskId: task.id, time: now };
      dragStateRef.current.isDragging = true;
      dragStateRef.current.taskId = task.id;
      dragStateRef.current.hasMoved = true;
      // ACTIVAR el flag para prevenir que se abra el modal durante el drag
      preventModalRef.current = true;
      // Cancelar el timeout del modal si existe
      if (modalTimeoutRef.current) {
        clearTimeout(modalTimeoutRef.current);
        modalTimeoutRef.current = null;
      }

      await handleTaskChange(task);
    } catch (error) {
      // Solo mostrar error si realmente era un drag (no un click)
      if (dragState.isDragging) {
        console.error("Error en handleGanttDateChange:", error);
        // Revertir el cambio visual si falló
        setTasks((prev) => {
          const updated = prev.map((t) =>
            t.id === task.id
              ? { ...t, start: oldTask.start, end: oldTask.end }
              : t
          );
          tasksRef.current = updated;
          return updated;
        });
      }
      // Si no era un drag, simplemente ignorar el error silenciosamente
    } finally {
      // Resetear el estado de drag después de un delay más largo para asegurar que onSelect no abra el modal
      setTimeout(() => {
        dragStateRef.current.isDragging = false;
        dragStateRef.current.taskId = null;
        dragStateRef.current.hasMoved = false;
        // Mantener el flag un poco más para prevenir que se abra el modal justo después
        setTimeout(() => {
          preventModalRef.current = false;
        }, 300);
      }, 800);
    }
  };

  const handleExpanderClick = (task: Task) => {
    setTasks((prevTasks) => {
      const updated = prevTasks.map((t) =>
        t.id === task.id ? { ...t, hideChildren: !t.hideChildren } : t
      );
      tasksRef.current = updated;
      return updated;
    });
  };

  const handleOperatorChange = async (newOpId: string) => {
    if (!selectedItem) return;

    const opId = parseInt(newOpId);

    try {
      const response = await fetch(
        `http://localhost:8000/planificacion/${selectedItem.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_operario: opId,
          }),
        }
      );

      if (response.ok) {
        const newOp = operarios.find((o) => o.id === opId);
        setPlanificacionItems((prev) =>
          prev.map((p) =>
            p.id === selectedItem.id
              ? {
                ...p,
                id_operario: opId,
                nombre_operario: newOp?.nombre,
                apellido_operario: newOp?.apellido,
              }
              : p
          )
        );

        // No cerrar el panel, solo actualizar los datos
        // El panel permanece abierto para mejor UX
      }
    } catch (error) {
      console.error("Error updating operator:", error);
    }
  };

  // Resetear ancho de columna al cambiar de vista
  useEffect(() => {
    setColumnWidth(getColumnWidth(viewMode));
  }, [viewMode]);

  const handleZoomIn = () => {
    const { max } = getZoomLimits(viewMode);
    setColumnWidth((prev) => Math.min(prev + 20, max));
  };

  const handleZoomOut = () => {
    const { min } = getZoomLimits(viewMode);
    setColumnWidth((prev) => Math.max(prev - 20, min));
  };

  if (tasks.length === 0) {
    return (
      <div className="p-4 text-gray-500">
        No hay datos de planificación disponibles.
      </div>
    );
  }

  return (
    <div
      className="w-full bg-white rounded-lg shadow p-4"
      style={{
        marginRight: detailsOpen ? "320px" : "0",
        transition: "margin-right 0.3s ease-in-out",
      }}
    >
      <div className="mb-4 flex justify-between items-center border-b pb-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg text-gray-800">Gantt</span>
            <button className="text-gray-400 hover:text-gray-600">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
            </button>
          </div>

          <div className="h-6 w-px bg-gray-300 mx-2"></div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-500 mr-4">
            <div className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: "#10b981" }}
              ></div>
              <span className="text-xs">Normal</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: "#f59e0b" }}
              ></div>
              <span className="text-xs">Alta</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: "#dc2626" }}
              ></div>
              <span className="text-xs">Crítica</span>
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
                    onClick={() => {
                      setViewMode(ViewMode.Hour);
                      setIsViewDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Hour
                      ? "bg-blue-50 text-blue-600"
                      : "text-gray-700"
                      }`}
                  >
                    Horas
                  </button>
                  <button
                    onClick={() => {
                      setViewMode(ViewMode.Day);
                      setIsViewDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Day
                      ? "bg-blue-50 text-blue-600"
                      : "text-gray-700"
                      }`}
                  >
                    Días
                  </button>
                  <button
                    onClick={() => {
                      setViewMode(ViewMode.Week);
                      setIsViewDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Week
                      ? "bg-blue-50 text-blue-600"
                      : "text-gray-700"
                      }`}
                  >
                    Semanas
                  </button>
                  <button
                    onClick={() => {
                      setViewMode(ViewMode.Month);
                      setIsViewDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Month
                      ? "bg-blue-50 text-blue-600"
                      : "text-gray-700"
                      }`}
                  >
                    Meses
                  </button>
                  <button
                    onClick={() => {
                      setViewMode(ViewMode.Year);
                      setIsViewDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${viewMode === ViewMode.Year
                      ? "bg-blue-50 text-blue-600"
                      : "text-gray-700"
                      }`}
                  >
                    Años
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center border rounded-md overflow-hidden">
            <button
              onClick={handleZoomOut}
              className="p-1.5 hover:bg-gray-100 text-gray-600 border-r"
              title="Alejar (Zoom Out)"
            >
              <span className="text-xs font-medium">-</span>
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1.5 hover:bg-gray-100 text-gray-600"
              title="Acercar (Zoom In)"
            >
              <span className="text-xs font-medium">+</span>
            </button>
          </div>
        </div>
      </div>

      <div
        ref={ganttContainerRef}
        className="border rounded-lg relative"
        style={{
          height: "500px",
          width: "100%",
          position: "relative",
          overflow: "hidden",
          overscrollBehavior: "none",
        }}
      >
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`absolute z-30 flex items-center justify-center w-6 h-6 rounded-full shadow-md transition-all duration-300 border ${isSidebarOpen
            ? "bg-white border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200"
            : "bg-red-600 border-red-600 text-white hover:bg-red-700"
            }`}
          style={{
            top: "12px",
            left: isSidebarOpen ? "270px" : "16px",
          }}
          title={isSidebarOpen ? "Ocultar lista" : "Mostrar lista"}
        >
          {isSidebarOpen ? (
            <ChevronLeft size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>

        {viewMode === ViewMode.Hour &&
          currentTimePosition > (isSidebarOpen ? 300 : 0) && (
            <div
              ref={nowLineRef}
              className="absolute top-0 bottom-0 pointer-events-none z-20"
              style={{
                width: "2px",
                backgroundColor: "#ef4444",
                boxShadow: "0 0 4px rgba(239, 68, 68, 0.6)",
              }}
            >
              <div
                className="absolute -top-6 -left-8 bg-red-500 text-white text-xs px-2 py-0.5 rounded"
                style={{ fontSize: "10px" }}
              >
                Ahora{" "}
                {new Date().toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          )}

        <div
          style={{
            height: "100%",
            width: "100%",
            position: "relative",
          }}
        >
          <Gantt
            tasks={tasks}
            viewMode={viewMode}
            locale="es"
            columnWidth={columnWidth}
            listCellWidth={isSidebarOpen ? "300px" : "0px"}
            barFill={90}
            ganttHeight={500}
            rowHeight={50}
            barCornerRadius={4}
            headerHeight={90}
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="16px"
            TaskListHeader={MemoizedTaskListHeader}
            TaskListTable={MemoizedTaskListTable}
            TooltipContent={CustomTooltip}
            onExpanderClick={handleExpanderClick}
            onSelect={handleGanttSelect}
            onDateChange={handleGanttDateChange}
            todayColor="rgba(252, 165, 165, 0.1)"
          />
        </div>
      </div>

      <SidebarPanel
        isOpen={detailsOpen}
        selectedItem={selectedItem}
        onClose={() => {
          setDetailsOpen(false);
          setSelectedItem(null);
        }}
        getProcessColor={getProcessColor}
        operarios={operarios}
        onOperatorChange={handleOperatorChange}
      />
    </div>
  );
};

export default PlanificacionGantt;
