"use client"

import { useState, useEffect } from "react"
import PlanificacionGanttWrapper from "@/components/PlanificacionGanttWrapper"
import TablaTareas from "@/components/TablaTareas"
import WorkOrdersListWrapper from "@/components/WorkOrdersListWrapper"
import { UnplannedWorkOrders } from "@/components/gantt/unplanned-work-orders"
import { Activity, LayoutList, GanttChartSquare, Plus } from "lucide-react"
import { usePanelContext } from "@/contexts/PanelContext"
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal"
import { Button } from "@/components/ui/button"
import TaskDetailsModal from "@/components/gantt/TaskDetailsModal"
import { toast } from "sonner"
import { convertPlanificacionToGanttTasks, calculateWorkingMinutes } from "@/lib/gantt-utils"
import type { GanttTask, Resource, PlanificacionItem } from "@/lib/types"

export default function OperacionesPage() {
  const [activeTab, setActiveTab] = useState<"gantt" | "tabla" | "work_orders">("gantt")
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const { isDetailsPanelOpen, setIsDetailsPanelOpen } = usePanelContext()

  // Gantt State
  const [tasks, setTasks] = useState<GanttTask[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [rawPlanificacion, setRawPlanificacion] = useState<PlanificacionItem[]>([])
  const [rawOperarios, setRawOperarios] = useState<any[]>([])
  const [viewMode, setViewMode] = useState<"operario" | "maquina">("operario")
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<PlanificacionItem | null>(null)

  // Helper for colors
  const getProcessColor = (processName: string) => {
    const colors: Record<string, string> = {
      "Torneado": "#3b82f6",
      "Fresado": "#10b981",
      "Soldadura": "#f59e0b",
      "Rectificado": "#8b5cf6",
      "Corte": "#ef4444",
      "Pulido": "#ec4899",
    };
    return colors[processName] || "#6b7280";
  };

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        // Fetch Planificacion
        const planResponse = await fetch("http://localhost:8000/planificacion");
        if (!planResponse.ok) throw new Error("Error fetching planificacion");
        const planData: PlanificacionItem[] = await planResponse.json();

        // Parse rangos_permitidos if it comes as a string or array of strings
        const parsedPlanData = planData.map(item => {
          let ranges = item.rangos_permitidos;

          if (typeof ranges === 'string') {
            try {
              ranges = JSON.parse(ranges);
            } catch (e) {
              ranges = [];
            }
          }

          // Handle case where it's an array of strings (e.g. ["4", "10"] or ["'[4, 10]'"])
          if (Array.isArray(ranges) && ranges.length > 0 && typeof ranges[0] === 'string') {
            try {
              // If the first element looks like a JSON array, parse it (e.g. ["'[4, 10]'"])
              if ((ranges[0] as string).trim().startsWith('[')) {
                ranges = JSON.parse(ranges[0] as string);
              } else {
                // Otherwise assume it's ["4", "10"] and convert to numbers
                ranges = (ranges as unknown as string[]).map((r: string) => parseInt(r, 10)).filter((n: number) => !isNaN(n));
              }
            } catch (e) {
              console.error("Error parsing ranges array:", ranges);
              ranges = [];
            }
          }

          return {
            ...item,
            rangos_permitidos: Array.isArray(ranges) ? ranges : []
          };
        });

        setRawPlanificacion(parsedPlanData);

        const ganttTasks = convertPlanificacionToGanttTasks(parsedPlanData);
        setTasks(ganttTasks);

        // Fetch Operarios
        const opResponse = await fetch("http://localhost:8000/operarios");
        if (opResponse.ok) {
          const opData = await opResponse.json();
          const rawOps = Array.isArray(opData.data) ? opData.data : (Array.isArray(opData) ? opData : []);
          setRawOperarios(rawOps);

          const mappedResources: Resource[] = rawOps.map((op: any) => ({
            id: op.id.toString(),
            name: `${op.nombre} ${op.apellido}`,
            type: "operario",
            skills: [], // We use ranges for qualification now
            ranges: op.rangos ? op.rangos.map((r: any) => typeof r === 'object' ? r.id : r) : []
          }));
          setResources(mappedResources);
        }
      } catch (error) {
        console.error("Error loading Gantt data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleTaskMove = async (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newStart = new Date(`${newDate}T${newStartTime}:00`);
    const newOperarioId = parseInt(newResourceId);

    const rawItem = rawPlanificacion.find(i => i.id === task.dbId);
    if (!rawItem) return;

    const baseDate = rawItem.creado_en ? new Date(rawItem.creado_en) : new Date();
    const normalizedBaseDate = new Date(baseDate);
    normalizedBaseDate.setHours(9, 0, 0, 0);

    if (isNaN(newStart.getTime()) || isNaN(normalizedBaseDate.getTime())) {
      console.error("Invalid date detected in handleTaskMove", {
        newDate,
        newStartTime,
        newStart,
        creado_en: rawItem.creado_en,
        baseDate,
        normalizedBaseDate
      });
      toast.error("Error al mover la tarea: Fecha inválida");
      return;
    }

    const newInicioMin = calculateWorkingMinutes(normalizedBaseDate, newStart);

    let durationMinutes = 0;
    if (task.originalFinMin !== undefined && task.originalInicioMin !== undefined) {
      durationMinutes = task.originalFinMin - task.originalInicioMin;
    } else {
      durationMinutes = Math.round(task.duration * 60);
    }

    const newFinMin = newInicioMin + durationMinutes;

    console.log("handleTaskMove Debug:", {
      taskId,
      newResourceId,
      newDate,
      newStartTime,
      baseDate: normalizedBaseDate.toISOString(),
      newStart: newStart.toISOString(),
      newInicioMin,
      durationMinutes
    });

    // Optimistic Update
    const oldTasks = [...tasks];
    const oldRawPlanificacion = [...rawPlanificacion];

    const updatedRawPlanificacion = rawPlanificacion.map(item => {
      if (item.id === task.dbId) {
        return {
          ...item,
          inicio_min: newInicioMin,
          fin_min: newFinMin,
          id_operario: isNaN(newOperarioId) ? item.id_operario : newOperarioId
        };
      }
      return item;
    });

    const newGanttTasks = convertPlanificacionToGanttTasks(updatedRawPlanificacion);

    setRawPlanificacion(updatedRawPlanificacion);
    setTasks(newGanttTasks);

    try {
      const response = await fetch(`http://localhost:8000/planificacion/${task.dbId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inicio_min: newInicioMin,
          fin_min: newFinMin,
          id_operario: isNaN(newOperarioId) ? undefined : newOperarioId
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update task");
      }
    } catch (error) {
      console.error("Error updating task:", error);
      setTasks(oldTasks);
      setRawPlanificacion(oldRawPlanificacion);
    }
  };

  const handleTaskClick = (task: GanttTask) => {
    const originalItem = rawPlanificacion.find(p => p.id === task.dbId);
    if (originalItem) {
      setSelectedTask(originalItem);
      setIsDetailsPanelOpen(true);
    }
  };

  const handleOperatorChange = async (newOpId: string, taskId?: string) => {
    const targetTask = taskId ? rawPlanificacion.find(p => p.id === parseInt(taskId)) : selectedTask;
    if (!targetTask) return;

    const opId = parseInt(newOpId);

    const updatedItem = { ...targetTask, id_operario: opId };

    // If updating the currently selected task, update that state too
    if (selectedTask && selectedTask.id === targetTask.id) {
      setSelectedTask(updatedItem);
    }

    setRawPlanificacion(prev => prev.map(p => p.id === targetTask.id ? updatedItem : p));

    setTasks(prev => prev.map(t => {
      if (t.dbId === targetTask.id) {
        return { ...t, resourceId: newOpId };
      }
      return t;
    }));

    try {
      await fetch(`http://localhost:8000/planificacion/${targetTask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_operario: opId }),
      });
    } catch (error) {
      console.error("Error updating operator:", error);
    }
  };

  const handleStatusChange = async (newStatusId: string, taskId?: string) => {
    console.log("handleStatusChange called with:", newStatusId, taskId);

    const targetTask = taskId ? rawPlanificacion.find(p => p.id === parseInt(taskId)) : selectedTask;
    if (!targetTask) return;

    const idEstado = parseInt(newStatusId);
    console.log("Parsed idEstado:", idEstado);

    let statusString = 'pendiente';
    if (idEstado === 2) statusString = 'en_curso';
    if (idEstado === 3) statusString = 'completado';

    const updatedItem = { ...targetTask, id_estado: idEstado, estado: statusString };

    // If updating the currently selected task, update that state too
    if (selectedTask && selectedTask.id === targetTask.id) {
      setSelectedTask(updatedItem);
    }

    setRawPlanificacion(prev => prev.map(p => p.id === targetTask.id ? updatedItem : p));

    setTasks(prev => prev.map(t => {
      if (t.dbId === targetTask.id) {
        let mappedStatus: any = 'nuevo';
        if (idEstado === 2) mappedStatus = 'en_proceso';
        else if (idEstado === 3) mappedStatus = 'finalizado_total';
        else if (idEstado === 1) mappedStatus = 'nuevo';

        return { ...t, status: mappedStatus };
      }
      return t;
    }));

    try {
      await fetch(`http://localhost:8000/ordenes/${targetTask.orden_id}/procesos/${targetTask.proceso_id}/estado`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_estado: idEstado }),
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  return (
    <div className={`min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col transition-all duration-300 ease-in-out ${isDetailsPanelOpen && activeTab === 'gantt' ? 'mr-[400px]' : 'mr-0'}`}>
      {/* Header normal (no sticky) */}
      <div className="bg-white border-b border-gray-200 shadow-sm flex-shrink-0">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-xl shadow-lg">
                  <Activity className="h-7 w-7 text-white" />
                </div>
                Operaciones
              </h1>
              <p className="text-gray-500 mt-1 text-sm md:text-base">Gestiona la planificación de las órdenes de trabajo</p>
            </div>
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-red-700 hover:bg-red-800 text-white shadow-md transition-all hover:shadow-lg"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nueva Orden
            </Button>
          </div>

          {/* Tabs Navigation */}
          <div className="flex items-center gap-1 mt-6 border-b border-gray-200">
            <button
              onClick={() => setActiveTab("gantt")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "gantt"
                ? "border-red-700 text-red-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <GanttChartSquare size={18} />
              Gantt
            </button>
            <button
              onClick={() => setActiveTab("tabla")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "tabla"
                ? "border-red-700 text-red-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <LayoutList size={18} />
              Procesos
            </button>
            <button
              onClick={() => setActiveTab("work_orders")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "work_orders"
                ? "border-red-700 text-red-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <LayoutList size={18} />
              Órdenes de Trabajo
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-visible">
        <div className={`flex-1 transition-all duration-300 flex flex-col ${activeTab === 'gantt' ? 'max-w-full px-2 py-4' : 'max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-8 w-full'}`}>
          <div className={`bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col ${activeTab === 'gantt' ? 'p-2' : 'p-6'}`}>
            {/* Redundant header removed */}

            {activeTab === "gantt" && (
              <PlanificacionGanttWrapper
                tasks={tasks}
                resources={resources}
                viewMode={viewMode}
                setViewMode={setViewMode}
                onTaskMove={handleTaskMove}
                onTaskClick={handleTaskClick}
                onStatusChange={(taskId, statusId) => handleStatusChange(statusId, taskId)}
                isLoading={isLoading}
              />
            )}
            {activeTab === "tabla" && (
              <TablaTareas
                tasks={tasks}
                operarios={rawOperarios}
                onStatusChange={(taskId, statusId) => handleStatusChange(statusId, taskId)}
                onResponsibleChange={(taskId, opId) => handleOperatorChange(opId, taskId)}
              />
            )}
            {activeTab === "work_orders" && <WorkOrdersListWrapper />}

            {/* Sección de Órdenes No Planificadas */}
            {activeTab === "gantt" && <UnplannedWorkOrders />}
          </div>
        </div>
      </div>

      {/* Sidebar rendered as Fixed Sidebar (Full Height) */}
      <div className={`fixed inset-y-0 right-0 w-[400px] bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-[60] ${isDetailsPanelOpen && activeTab === 'gantt' ? 'translate-x-0' : 'translate-x-full'}`}>
        <TaskDetailsModal
          isOpen={isDetailsPanelOpen}
          selectedItem={selectedTask}
          onClose={() => setIsDetailsPanelOpen(false)}
          getProcessColor={getProcessColor}
          operarios={rawOperarios}
          onOperatorChange={handleOperatorChange}
          onStatusChange={handleStatusChange}
          variant="sidebar"
        />
      </div>

      <CreateWorkOrderModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          setIsCreateModalOpen(false)
        }}
      />
    </div>
  )
}
