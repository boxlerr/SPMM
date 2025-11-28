"use client"

import { useState, useEffect } from "react"
import PlanificacionGanttWrapper from "@/components/PlanificacionGanttWrapper"
import TablaTareas from "@/components/TablaTareas"
import WorkOrdersListWrapper from "@/components/WorkOrdersListWrapper"
import { Activity, LayoutList, GanttChartSquare, Plus } from "lucide-react"
import { usePanelContext } from "@/contexts/PanelContext"
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal"
import { Button } from "@/components/ui/button"
import TaskDetailsModal from "@/components/gantt/TaskDetailsModal"
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
        setRawPlanificacion(planData);

        const ganttTasks = convertPlanificacionToGanttTasks(planData);
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
            skills: [] // TODO: Add skills if available in API
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

    const newInicioMin = calculateWorkingMinutes(normalizedBaseDate, newStart);

    let durationMinutes = 0;
    if (task.originalFinMin !== undefined && task.originalInicioMin !== undefined) {
      durationMinutes = task.originalFinMin - task.originalInicioMin;
    } else {
      durationMinutes = Math.round(task.duration * 60);
    }

    const newFinMin = newInicioMin + durationMinutes;

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

  const handleOperatorChange = async (newOpId: string) => {
    if (!selectedTask) return;
    const opId = parseInt(newOpId);

    const updatedItem = { ...selectedTask, id_operario: opId };
    setSelectedTask(updatedItem);

    setRawPlanificacion(prev => prev.map(p => p.id === selectedTask.id ? updatedItem : p));

    setTasks(prev => prev.map(t => {
      if (t.dbId === selectedTask.id) {
        return { ...t, resourceId: newOpId };
      }
      return t;
    }));

    try {
      await fetch(`http://localhost:8000/planificacion/${selectedTask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_operario: opId }),
      });
    } catch (error) {
      console.error("Error updating operator:", error);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedTask) return;

    const updatedItem = { ...selectedTask, estado: newStatus };
    setSelectedTask(updatedItem);

    setRawPlanificacion(prev => prev.map(p => p.id === selectedTask.id ? updatedItem : p));

    setTasks(prev => prev.map(t => {
      if (t.dbId === selectedTask.id) {
        let mappedStatus: any = 'nuevo';
        if (newStatus === 'en_curso') mappedStatus = 'en_proceso';
        else if (newStatus === 'completado') mappedStatus = 'finalizado_total';
        else if (newStatus === 'pendiente') mappedStatus = 'nuevo';

        return { ...t, status: mappedStatus };
      }
      return t;
    }));

    try {
      await fetch(`http://localhost:8000/ordenes/${selectedTask.orden_id}/procesos/${selectedTask.proceso_id}/estado`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: newStatus }),
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  return (
    <div className={`min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col transition-all duration-300 ease-in-out ${isDetailsPanelOpen && activeTab === 'gantt' ? 'mr-[400px]' : 'mr-0'}`}>
      {/* Header sticky mejorado */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40 flex-shrink-0">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-xl shadow-lg">
                  <Activity className="h-7 w-7 text-white" />
                </div>
                Operaciones
              </h1>
              <p className="text-gray-500 mt-1 text-sm md:text-base">Gestiona las operaciones del sistema</p>
            </div>
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all hover:shadow-lg"
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
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <GanttChartSquare size={18} />
              Gantt
            </button>
            <button
              onClick={() => setActiveTab("tabla")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "tabla"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <LayoutList size={18} />
              Procesos
            </button>
            <button
              onClick={() => setActiveTab("work_orders")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "work_orders"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <LayoutList size={18} />
              Órdenes de Trabajo
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className={`flex-1 transition-all duration-300 flex flex-col ${activeTab === 'gantt' ? 'max-w-full px-2 py-4' : 'max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-8 w-full'}`}>
          <div className={`bg-white rounded-lg shadow-sm border border-gray-200 flex-1 flex flex-col ${activeTab === 'gantt' ? 'p-2' : 'p-6'}`}>
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex-shrink-0">
              {activeTab === "gantt" ? "Planificación (Gantt)" : activeTab === "tabla" ? "Procesos" : "Órdenes de Trabajo"}
            </h2>

            {activeTab === "gantt" && (
              <PlanificacionGanttWrapper
                tasks={tasks}
                resources={resources}
                viewMode={viewMode}
                setViewMode={setViewMode}
                onTaskMove={handleTaskMove}
                onTaskClick={handleTaskClick}
                isLoading={isLoading}
              />
            )}
            {activeTab === "tabla" && <TablaTareas />}
            {activeTab === "work_orders" && <WorkOrdersListWrapper />}
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
