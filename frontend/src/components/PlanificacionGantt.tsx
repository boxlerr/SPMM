"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import "./PlanificacionGantt.module.css";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  ChevronDown,
  X,
  Activity,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePanelContext } from "@/contexts/PanelContext";

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
}

// Paleta de colores para procesos
const PROCESS_COLORS = [
  "#3b82f6", // blue-500
  "#ef4444", // red-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
];

const getProcessColor = (processName: string) => {
  let hash = 0;
  for (let i = 0; i < processName.length; i++) {
    hash = processName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PROCESS_COLORS.length;
  return PROCESS_COLORS[index];
};

// Tooltip personalizado
const CustomTooltip: React.FC<{
  task: Task;
  fontSize: string;
  fontFamily: string;
}> = ({ task, fontSize, fontFamily }) => {
  if (task.type === "project") return null;

  return (
    <div
      style={{
        backgroundColor: "white",
        padding: "12px",
        borderRadius: "8px",
        boxShadow:
          "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        border: "1px solid #e5e7eb",
        fontSize: "12px",
        fontFamily,
        zIndex: 1000,
        minWidth: "200px",
      }}
    >
      <div className="font-bold text-gray-900 mb-1 text-sm">
        {task.name.split(" (OT:")[0]}
      </div>
      <div className="text-gray-600 mb-2">
        {task.name.match(/\(OT: \d+\)/)?.[0] || ""}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="font-semibold">Inicio:</span>
        <span>
          {task.start.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>

        <span className="font-semibold">Fin:</span>
        <span>
          {task.end.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>

        <span className="font-semibold">Duración:</span>
        <span>
          {Math.round((task.end.getTime() - task.start.getTime()) / 60000)} min
        </span>
      </div>
    </div>
  );
};

const TaskListHeader: React.FC<{
  headerHeight: number;
  isSidebarOpen?: boolean;
}> = ({ headerHeight, isSidebarOpen }) => {
  if (isSidebarOpen === false) return null;

  return (
    <div
      style={{
        height: headerHeight,
        fontFamily: "inherit",
        fontWeight: "bold",
        paddingLeft: 16,
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid #e5e7eb",
        backgroundColor: "#f9fafb",
        color: "#374151",
        fontSize: "0.875rem",
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
  onTaskClick?: (item: PlanificacionItem) => void;
}> = ({
  rowHeight,
  tasks,
  onExpanderClick,
  planificacionItems,
  cargasMap,
  isSidebarOpen,
  onTaskClick,
}) => {
    if (isSidebarOpen === false) return null;

    return (
      <div style={{ fontFamily: "inherit" }}>
        {tasks.map((t) => {
          const isProject = t.type === "project";
          let mainText = t.name;
          let subText = "";

          if (isProject) {
            if (
              !mainText ||
              mainText === "Rango Inicio" ||
              mainText === "Rango Fin"
            ) {
              if (t.id === "range-start" || t.id === "range-end") {
                return <div key={t.id} style={{ height: rowHeight }} />;
              }

              if (t.id === "op-none") {
                mainText = "Sin Operario Asignado";
              } else if (t.id.startsWith("op-")) {
                const opId = parseInt(t.id.replace("op-", ""));
                const item = planificacionItems.find(
                  (p) => p.id_operario === opId
                );
                if (item) {
                  mainText = `${item.nombre_operario || ""} ${item.apellido_operario || ""
                    }`.trim();
                } else {
                  mainText = "Operario";
                }
              }
            }

            const carga = cargasMap[t.id] || { totalMinutos: 0, porcentaje: 0 };

            return (
              <div
                key={t.id}
                style={{
                  height: rowHeight,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  paddingLeft: 16,
                  paddingRight: 16,
                  borderBottom: "1px solid #e5e7eb",
                  backgroundColor: "#f3f4f6",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onClick={() => onExpanderClick(t)}
              >
                <div
                  style={{
                    paddingLeft: 0,
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flex: 1,
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{ fontSize: 10, color: "#6b7280", flexShrink: 0 }}
                    >
                      {t.hideChildren ? "▶" : "▼"}
                    </span>

                    <div className="truncate w-full">
                      <span
                        style={{
                          fontWeight: 700,
                          color: "#111827",
                          fontSize: "0.875rem",
                        }}
                      >
                        {mainText}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: "0.65rem",
                      color:
                        carga.porcentaje > 90
                          ? "#dc2626"
                          : carga.porcentaje > 75
                            ? "#f59e0b"
                            : "#10b981",
                      fontWeight: 600,
                      flexShrink: 0,
                      paddingLeft: 8,
                    }}
                  >
                    {Math.round(carga.totalMinutos / 60)}h/8h
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 4,
                    height: 3,
                    backgroundColor: "#e5e7eb",
                    borderRadius: 2,
                    overflow: "hidden",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${carga.porcentaje}%`,
                      backgroundColor:
                        carga.porcentaje > 90
                          ? "#dc2626"
                          : carga.porcentaje > 75
                            ? "#f59e0b"
                            : "#10b981",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            );
          } else {
            const parts = t.name.split(" (OT:");
            mainText = parts[0];
            mainText = mainText.charAt(0).toUpperCase() + mainText.slice(1);

            if (parts.length > 1) {
              subText = `OT: ${parts[1].replace(")", "")}`;
            }

            const dateText = t.start.toLocaleDateString("es-AR", {
              month: "short",
              day: "numeric",
            });

            // Extraer el ID de la planificación del task.id
            const taskIdParts = t.id.split("-");
            const dbIdStr = taskIdParts[4];
            const planItem = dbIdStr
              ? planificacionItems.find((p) => p.id === parseInt(dbIdStr))
              : null;

            const handleTaskClick = () => {
              if (planItem && onTaskClick) {
                onTaskClick(planItem);
              }
            };

            return (
              <div
                key={t.id}
                onClick={handleTaskClick}
                style={{
                  height: rowHeight,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  paddingLeft: 16,
                  paddingRight: 16,
                  borderBottom: "1px solid #e5e7eb",
                  borderLeft: "3px solid transparent",
                  backgroundColor: "#fff",
                  cursor: planItem ? "pointer" : "default",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  if (planItem) {
                    e.currentTarget.style.backgroundColor = "#f3f4f6";
                    e.currentTarget.style.borderLeftColor = getProcessColor(
                      planItem.nombre_proceso || "default"
                    );
                    e.currentTarget.style.boxShadow =
                      "0 1px 3px 0 rgba(0, 0, 0, 0.1)";
                    const chevron = e.currentTarget.querySelector(".task-chevron") as HTMLElement;
                    if (chevron) {
                      chevron.style.color = "#6b7280";
                      chevron.style.transform = "translateX(2px)";
                    }
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#fff";
                  e.currentTarget.style.borderLeftColor = "transparent";
                  e.currentTarget.style.boxShadow = "none";
                  const chevron = e.currentTarget.querySelector(".task-chevron") as HTMLElement;
                  if (chevron) {
                    chevron.style.color = "#9ca3af";
                    chevron.style.transform = "translateX(0)";
                  }
                }}
              >
                <div
                  style={{
                    paddingLeft: 24,
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    overflow: "hidden",
                  }}
                >
                  <div className="truncate" style={{ flex: 1, marginRight: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "#374151",
                          fontSize: "0.8125rem",
                        }}
                      >
                        {mainText}
                      </span>
                    </div>
                    {subText && (
                      <span
                        style={{
                          display: "block",
                          fontSize: "0.75rem",
                          color: "#6b7280",
                          marginTop: "2px",
                          fontWeight: 600,
                        }}
                      >
                        {subText}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#6b7280",
                        textAlign: "right",
                      }}
                    >
                      {dateText}
                    </div>
                    <ChevronRight
                      size={16}
                      style={{
                        color: planItem ? "#9ca3af" : "transparent",
                        flexShrink: 0,
                        transition: "transform 0.15s ease, color 0.15s ease",
                      }}
                      className="task-chevron"
                    />
                  </div>
                </div>
              </div>
            );
          }
        })}
      </div >
    );
  };

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
    const map: Record<string, { totalMinutos: number; porcentaje: number }> =
      {};
    const horasTrabajo = 8 * 60;

    const minutosPorOperario: Record<string, number> = {};

    planificacionItems.forEach((item) => {
      const opId = item.id_operario ? `op-${item.id_operario}` : "op-none";
      const duracion = item.fin_min - item.inicio_min;
      minutosPorOperario[opId] = (minutosPorOperario[opId] || 0) + duracion;
    });

    Object.keys(minutosPorOperario).forEach((opId) => {
      const totalMinutos = minutosPorOperario[opId];
      const porcentaje = Math.min((totalMinutos / horasTrabajo) * 100, 100);
      map[opId] = { totalMinutos, porcentaje };
    });

    return map;
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

      const columnWidth = getColumnWidth();
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

      const columnWidth = getColumnWidth();
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

  // Scroll y sincronización de línea roja
  useEffect(() => {
    const wrapper = ganttContainerRef.current;
    if (!wrapper) return;

    let scrollContainer: HTMLElement | null = null;
    const divs = wrapper.querySelectorAll("div");

    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      const style = window.getComputedStyle(div);
      if (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        div.scrollHeight > div.clientHeight
      ) {
        scrollContainer = div;
        break;
      }
    }

    if (!scrollContainer) return;
    scrollContainerRef.current = scrollContainer;

    const handleScroll = () => {
      if (!scrollContainer) return;

      if (nowLineRef.current && currentTimePosition > 0) {
        const visibleLeft = currentTimePosition - scrollContainer.scrollLeft;
        nowLineRef.current.style.left = `${visibleLeft}px`;
      }
    };

    const handleWheelCapture = (e: WheelEvent) => {
      if (!scrollContainer) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const deltaY = e.deltaY;

      if (deltaY === 0) return;

      const isAtTop = scrollTop <= 0;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) <= 2;

      if ((isAtTop && deltaY < 0) || (isAtBottom && deltaY > 0)) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    wrapper.addEventListener("wheel", handleWheelCapture, {
      passive: false,
      capture: true,
    });

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
      wrapper.removeEventListener("wheel", handleWheelCapture, {
        capture: true,
      } as any);
    };
  }, [currentTimePosition, isSidebarOpen, tasks]);

  // Inyectar listeners pointer directamente en las barras <rect> del Gantt
  useEffect(() => {
    const container = ganttContainerRef.current;
    if (!container || tasks.length === 0) return;

    // Función para inyectar listeners en las barras
    const injectBarListeners = () => {
      // Buscar todos los <rect> que son barras de tareas (no proyectos)
      const svg = container.querySelector("svg");
      if (!svg) {
        console.log("No se encontró SVG en el contenedor");
        return;
      }

      // Obtener todas las barras de tareas (task.type === 'task')
      const taskBars = tasks.filter((t) => t.type === "task");
      console.log("Tareas encontradas:", taskBars.length);

      // Buscar todos los grupos de barras (gantt-task-react usa <g> para agrupar barras)
      // Buscar todos los <rect> dentro del SVG que tienen altura (son barras, no líneas)
      const allRects = svg.querySelectorAll("rect");
      const barRects: Array<{ rect: SVGRectElement; y: number; x: number }> =
        [];

      allRects.forEach((rect) => {
        const height = parseFloat(rect.getAttribute("height") || "0");
        const y = parseFloat(rect.getAttribute("y") || "0");
        const x = parseFloat(rect.getAttribute("x") || "0");
        // Las barras tienen altura > 20px, las líneas tienen altura muy pequeña
        if (height > 20 && x > 0) {
          barRects.push({ rect, y, x });
        }
      });

      // Ordenar por posición Y (de arriba hacia abajo) y luego por X (de izquierda a derecha)
      barRects.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 5) {
          return a.x - b.x; // Misma fila, ordenar por X
        }
        return a.y - b.y; // Diferente fila, ordenar por Y
      });

      // Emparejar cada rect con su task usando el texto cercano
      barRects.forEach(({ rect }, index) => {
        if (index >= taskBars.length) return;

        const task = taskBars[index];
        if (!task) return;

        // Buscar el texto asociado a esta barra para identificar la tarea correcta
        const textElements = svg.querySelectorAll("text");
        let matchedTask = task;

        const rectY = parseFloat(rect.getAttribute("y") || "0");
        const rectHeight = parseFloat(rect.getAttribute("height") || "0");
        const rectCenterY = rectY + rectHeight / 2;
        const rectX = parseFloat(rect.getAttribute("x") || "0");
        const rectWidth = parseFloat(rect.getAttribute("width") || "0");
        const rectCenterX = rectX + rectWidth / 2;

        // Buscar texto que esté dentro o cerca de esta barra
        for (const textEl of textElements) {
          const textY = parseFloat(textEl.getAttribute("y") || "0");
          const textX = parseFloat(textEl.getAttribute("x") || "0");
          const textContent = textEl.textContent || "";

          // Si el texto está dentro del área de la barra
          if (
            Math.abs(textY - rectCenterY) < 25 &&
            textX >= rectX - 10 &&
            textX <= rectX + rectWidth + 10 &&
            textContent.trim().length > 0
          ) {
            // Buscar la tarea que coincide con este texto
            const taskNamePart = task.name.split(" (OT:")[0].toLowerCase();
            if (textContent.toLowerCase().includes(taskNamePart)) {
              matchedTask = task;
              break;
            }

            // Intentar encontrar cualquier tarea que coincida con el texto
            const matchingTask = taskBars.find((t) => {
              const tNamePart = t.name.split(" (OT:")[0].toLowerCase();
              return textContent.toLowerCase().includes(tNamePart);
            });
            if (matchingTask) {
              matchedTask = matchingTask;
              break;
            }
          }
        }

        // Agregar data-task-id si no existe
        const taskIdToUse = matchedTask.id;
        if (
          !rect.getAttribute("data-task-id") ||
          rect.getAttribute("data-task-id") !== taskIdToUse
        ) {
          rect.setAttribute("data-task-id", taskIdToUse);
          rect.style.cursor = "pointer";
        }

        // Remover listeners previos si existen
        const existingListeners = (rect as any).__ganttListeners;
        if (existingListeners) {
          rect.removeEventListener(
            "pointerdown",
            existingListeners.pointerdown
          );
          rect.removeEventListener(
            "pointermove",
            existingListeners.pointermove
          );
          rect.removeEventListener("pointerup", existingListeners.pointerup);
        }

        // Estado local para este rect
        let pointerState = {
          isDown: false,
          startX: 0,
          startY: 0,
          hasMoved: false,
          startTime: 0,
          taskId: taskIdToUse,
        };

        const handlePointerDown = (e: PointerEvent) => {
          console.log("pointerdown detectado en barra:", pointerState.taskId);
          // NO usar stopPropagation aquí, solo prevenir el comportamiento por defecto si es necesario
          // e.stopPropagation(); // Comentado para permitir que el Gantt también maneje el evento
          e.preventDefault(); // Prevenir selección de texto
          pointerState.isDown = true;
          pointerState.startX = e.clientX;
          pointerState.startY = e.clientY;
          pointerState.hasMoved = false;
          pointerState.startTime = Date.now();

          // Cancelar cualquier timeout del modal
          if (modalTimeoutRef.current) {
            clearTimeout(modalTimeoutRef.current);
            modalTimeoutRef.current = null;
          }

          // Cambiar cursor después de 200ms si se mantiene presionado
          const holdTimeout = setTimeout(() => {
            if (pointerState.isDown && !pointerState.hasMoved) {
              rect.style.cursor = "move";
            }
          }, 200);

          (rect as any).__holdTimeout = holdTimeout;
        };

        const handlePointerMove = (e: PointerEvent) => {
          if (!pointerState.isDown) return;

          const deltaX = Math.abs(e.clientX - pointerState.startX);
          const deltaY = Math.abs(e.clientY - pointerState.startY);
          const threshold = 3; // 3px de movimiento = drag

          if (deltaX > threshold || deltaY > threshold) {
            pointerState.hasMoved = true;
            preventModalRef.current = true;

            // Cambiar cursor a move
            rect.style.cursor = "move";

            // Cancelar timeout de hold
            if ((rect as any).__holdTimeout) {
              clearTimeout((rect as any).__holdTimeout);
              (rect as any).__holdTimeout = null;
            }

            // Cancelar timeout del modal
            if (modalTimeoutRef.current) {
              clearTimeout(modalTimeoutRef.current);
              modalTimeoutRef.current = null;
            }
          }
        };

        const handlePointerUp = (e: PointerEvent) => {
          if (!pointerState.isDown) return;

          console.log("pointerup detectado, hasMoved:", pointerState.hasMoved);

          // Cancelar timeout de hold
          if ((rect as any).__holdTimeout) {
            clearTimeout((rect as any).__holdTimeout);
            (rect as any).__holdTimeout = null;
          }

          const deltaX = Math.abs(e.clientX - pointerState.startX);
          const deltaY = Math.abs(e.clientY - pointerState.startY);
          const threshold = 3;

          console.log("Delta:", deltaX, deltaY, "threshold:", threshold);

          // Si NO hubo movimiento significativo, es un CLICK → abrir panel
          if (
            !pointerState.hasMoved &&
            deltaX < threshold &&
            deltaY < threshold
          ) {
            console.log("Es un CLICK, abriendo panel...");
            // Cancelar cualquier timeout previo
            if (modalTimeoutRef.current) {
              clearTimeout(modalTimeoutRef.current);
            }

            // Abrir panel inmediatamente (sin delay para testing)
            const parts = pointerState.taskId.split("-");
            const dbIdStr = parts[4];
            if (dbIdStr) {
              const dbId = parseInt(dbIdStr);
              if (!Number.isNaN(dbId)) {
                const item = planificacionItems.find((p) => p.id === dbId);
                if (item) {
                  console.log("Abriendo panel para tarea:", item); // Debug

                  // Toggle: si es la misma tarea, cerrar el panel
                  if (selectedItem && selectedItem.id === item.id) {
                    setDetailsOpen(false);
                    setSelectedItem(null);
                  } else {
                    // Si es diferente, abrir con la nueva tarea
                    setSelectedItem(item);
                    setDetailsOpen(true);
                  }

                  setSelectedTaskId(pointerState.taskId);

                  // Deseleccionar la tarea
                  requestAnimationFrame(() => {
                    setTasks((prevTasks) => {
                      const updated = prevTasks.map((t) => ({
                        ...t,
                        isSelected: false,
                      }));
                      tasksRef.current = updated;
                      return updated;
                    });
                    setSelectedTaskId(null);
                  });
                }
              }
            }
          } else {
            // Hubo movimiento = drag, no abrir modal
            preventModalRef.current = true;
            setTimeout(() => {
              preventModalRef.current = false;
            }, 500);
          }

          // Resetear estado
          pointerState.isDown = false;
          pointerState.hasMoved = false;
          rect.style.cursor = "pointer";
        };

        // Agregar listeners
        rect.addEventListener("pointerdown", handlePointerDown, {
          passive: false,
        });
        rect.addEventListener("pointermove", handlePointerMove, {
          passive: true,
        });
        rect.addEventListener("pointerup", handlePointerUp, { passive: true });

        // Guardar referencias para poder removerlos después
        (rect as any).__ganttListeners = {
          pointerdown: handlePointerDown,
          pointermove: handlePointerMove,
          pointerup: handlePointerUp,
        };

        console.log(
          `Listeners agregados a barra ${index} con taskId: ${taskIdToUse}`
        );
      });

      console.log(`Total de barras con listeners: ${barRects.length}`);
    };

    // Inyectar listeners después de que el Gantt se renderice
    const timeout = setTimeout(() => {
      injectBarListeners();
    }, 100);

    // Re-inyectar cuando cambien las tareas
    const observer = new MutationObserver(() => {
      injectBarListeners();
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
  }, [tasks, planificacionItems]); // Re-ejecutar cuando cambien las tareas

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

        if (data.length === 0) {
          setTasks([]);
          return;
        }

        const baseDate = new Date();
        baseDate.setHours(9, 0, 0, 0);

        const operariosMap = new Map<string, { id: string; name: string }>();

        data.forEach((item) => {
          const opId = item.id_operario ? `op-${item.id_operario}` : "op-none";
          let opName = "Sin Operario Asignado";
          if (item.nombre_operario) {
            opName = `${item.nombre_operario} ${item.apellido_operario || ""
              }`.trim();
          }

          if (!operariosMap.has(opId)) {
            operariosMap.set(opId, { id: opId, name: opName });
          }
        });

        const operarios = Array.from(operariosMap.values()).sort((a, b) => {
          if (a.id === "op-none") return 1;
          if (b.id === "op-none") return -1;
          return a.name.localeCompare(b.name);
        });

        const ganttTasks: Task[] = [];

        operarios.forEach((op) => {
          ganttTasks.push({
            start: baseDate,
            end: baseDate,
            name: "",
            id: op.id,
            type: "project",
            progress: 0,
            isDisabled: true,
            hideChildren: true,
            styles: {
              backgroundColor: "#f3f4f6",
              backgroundSelectedColor: "#e5e7eb",
              progressColor: "#f3f4f6",
              progressSelectedColor: "#e5e7eb",
            },
          });

          const tareasOperario = data.filter((item) => {
            const itemOpId = item.id_operario
              ? `op-${item.id_operario}`
              : "op-none";
            return itemOpId === op.id;
          });

          tareasOperario.forEach((item, index) => {
            const originalStart = new Date(
              baseDate.getTime() + item.inicio_min * 60000
            );

            const start = new Date(originalStart);
            start.setHours(0, 0, 0, 0);

            const end = new Date(start);
            end.setTime(start.getTime() + 24 * 60 * 60 * 1000 - 1000);

            const color = getProcessColor(item.nombre_proceso || "default");

            ganttTasks.push({
              start: start,
              end: end,
              name: `${item.nombre_proceso || "Proceso"} (OT: ${item.orden_id
                })`,
              id: `task-${item.orden_id}-${item.proceso_id}-${index}-${item.id}`,
              type: "task",
              project: op.id,
              progress: 0,
              isDisabled: false,
              styles: {
                progressColor: color,
                progressSelectedColor: color,
                backgroundColor: color,
                backgroundSelectedColor: color,
              },
            });
          });
        });

        let minDate = new Date();
        if (ganttTasks.length > 0) {
          minDate = ganttTasks.reduce(
            (min, t) => (t.start < min ? t.start : min),
            ganttTasks[0].start
          );
        } else {
          minDate = baseDate;
        }

        setTasks(ganttTasks);
        tasksRef.current = ganttTasks;
        setGanttStartDate(minDate);
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

      const updatedData = await response.json();

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

  const getColumnWidth = () => {
    switch (viewMode) {
      case ViewMode.Year:
        return 500;
      case ViewMode.Month:
        return 400;
      case ViewMode.Week:
        return 350;
      case ViewMode.Day:
        return 300;
      case ViewMode.Hour:
        return 120;
      default:
        return 120;
    }
  };

  const getViewLabel = (mode: ViewMode) => {
    switch (mode) {
      case ViewMode.Hour:
        return "Horas";
      case ViewMode.Day:
        return "Días";
      case ViewMode.Week:
        return "Semanas";
      case ViewMode.Month:
        return "Meses";
      case ViewMode.Year:
        return "Años";
      default:
        return "Vista";
    }
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
            <button className="p-1.5 hover:bg-gray-100 text-gray-600 border-r">
              <span className="text-xs font-medium">-</span>
            </button>
            <button className="p-1.5 hover:bg-gray-100 text-gray-600">
              <span className="text-xs font-medium">+</span>
            </button>
          </div>
        </div>
      </div >

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
            columnWidth={getColumnWidth()}
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

      {/* Panel lateral fijo - estilo Jira/Asana/Notion */}
      {
        detailsOpen && selectedItem && (
          <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-2xl z-50 border-l border-gray-200 flex flex-col transform transition-transform duration-300 ease-in-out">
            {/* Header del panel con branding rojo */}
            <div className="relative bg-gradient-to-r from-[#DC143C] to-[#B8112E] p-4 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                    <Activity className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">
                      Detalle de Planificación
                    </h2>
                    <p className="text-xs text-white/80 mt-0.5">
                      OT #{selectedItem.orden_id}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setDetailsOpen(false);
                    setSelectedItem(null);
                  }}
                  className="text-white/80 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/20"
                  title="Cerrar panel"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Contenido del panel */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {/* Proceso */}
                <div>
                  <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Proceso
                  </label>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: getProcessColor(
                          selectedItem.nombre_proceso || "default"
                        ),
                      }}
                    />
                    <span className="text-base text-gray-900 font-medium">
                      {selectedItem.nombre_proceso}
                    </span>
                  </div>
                </div>

                {/* Orden de Trabajo */}
                <div>
                  <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Orden de Trabajo
                  </label>
                  <span className="text-base text-gray-900 font-medium">
                    #{selectedItem.orden_id}
                  </span>
                </div>

                {/* Operario */}
                <div>
                  <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Operario
                  </label>
                  <Select
                    value={selectedItem.id_operario?.toString() || ""}
                    onValueChange={handleOperatorChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar operario" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.isArray(operarios) &&
                        operarios.map((op) => (
                          <SelectItem key={op.id} value={op.id.toString()}>
                            {op.nombre} {op.apellido}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Maquinaria */}
                <div>
                  <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Maquinaria
                  </label>
                  <span className="text-base text-gray-900">
                    {selectedItem.nombre_maquinaria || "Sin asignar"}
                  </span>
                </div>

                {/* Duración */}
                <div>
                  <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Duración
                  </label>
                  <span className="text-base text-gray-900">
                    {selectedItem.fin_min - selectedItem.inicio_min} minutos
                  </span>
                </div>

                {/* Fecha Prometida */}
                <div>
                  <label className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Fecha Prometida
                  </label>
                  <span className="text-base text-gray-900">
                    {selectedItem.fecha_prometida || "N/A"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
};

export default PlanificacionGantt;
