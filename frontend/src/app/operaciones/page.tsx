"use client"


import React, { useState, useEffect, useMemo } from "react"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import PlanificacionGanttWrapper from "@/components/PlanificacionGanttWrapper"
import WorkOrdersListWrapper from "@/components/WorkOrdersListWrapper"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PlanningListTable } from "@/components/planning/PlanningListTable"
import { SharedOperatorsList } from "@/components/resources/SharedOperatorsList"
import DetalleOperario from "@/app/recursos/_components/DetalleOperario"
import CambiarEstado from "@/app/recursos/_components/CambiarEstado"
import { Operario } from "@/app/recursos/_types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import MateriaPrimaTab from "./_components/MateriaPrimaTab"
import { OperatorLoadTab } from "./_components/OperatorLoadTab"


import { getWeekDates, formatDate } from "@/lib/gantt-utils"
import { cn } from "@/lib/utils"
import { Activity, LayoutList, GanttChartSquare, Plus, CalendarClock, User, Box, RefreshCw, Trash2, ChevronDown } from "lucide-react"
import { ZoomControl, usePersistedZoom } from "@/components/ui/zoom-control"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { usePanelContext } from "@/contexts/PanelContext"
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal"
import { Button } from "@/components/ui/button"
import TaskDetailsModal from "@/components/gantt/TaskDetailsModal"
import { toast } from "sonner"
import { convertPlanificacionToGanttTasks, calculateWorkingMinutes, addWorkMinutes } from "@/lib/gantt-utils"
import type { GanttTask, Resource, PlanificacionItem, WorkOrder } from "@/lib/types"
import { PlanningPreviewModal } from "@/components/planning/PlanningPreviewModal"
import { AvailabilityConfigModal } from "@/components/planning/AvailabilityConfigModal"
import { PlanningSelectionModal } from "@/components/planning/PlanningSelectionModal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarPicker } from "@/components/ui/calendar"
import { API_URL } from "@/config"

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export default function OperacionesPage() {
  const [activeTab, setActiveTab] = useState<"gantt" | "work_orders" | "lista_planificacion" | "operarios" | "materia_prima" | "carga">("lista_planificacion")
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  /** OT pre-seleccionada para editar (viene del query param `?edit_ot=ID` desde
   *  el link "Editar OT ↗" del PlanningPreviewModal, o de otra parte del sistema). */
  const [orderToEdit, setOrderToEdit] = useState<WorkOrder | null>(null)
  const { isDetailsPanelOpen, setIsDetailsPanelOpen } = usePanelContext()

  // Refresh Trigger for Children
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isAvailabilityModalOpen, setIsAvailabilityModalOpen] = useState(false);

  // Gantt State
  const [tasks, setTasks] = useState<GanttTask[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [rawPlanificacion, setRawPlanificacion] = useState<PlanificacionItem[]>([])
  const [ordenesTrabajo, setOrdenesTrabajo] = useState<WorkOrder[]>([])
  const [rawOperarios, setRawOperarios] = useState<any[]>([])
  const [rawMaquinarias, setRawMaquinarias] = useState<any[]>([])
  const [viewMode, setViewMode] = useState<"operario" | "maquina">("operario")
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<PlanificacionItem | null>(null)

  // History State
  const [selectedLoteId, setSelectedLoteId] = useState<string>("all")

  // Fecha override seleccionada por el usuario desde el calendario del banner
  // (vistas Semanal/Diaria). Si está seteada, gana sobre "hoy" y sobre "lote".
  // Si es null, se usa la lógica vieja (lote seleccionado → fecha del lote, o hoy).
  const [customRefDate, setCustomRefDate] = useState<Date | null>(null)

  // Zoom (%) compartido entre todas las vistas de Operaciones (Planificación,
  // No Planificadas, Historial, Modal Planificar y Vista Previa). Persistido en
  // localStorage bajo la key 'plan_zoom'. Ver components/ui/zoom-control.tsx.
  const [planZoom, setPlanZoom] = usePersistedZoom('plan_zoom', 100)

  // Selective Planning State
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false)
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]) // Used for confirmation
  const [planningRange, setPlanningRange] = useState<{ fecha_desde?: string, fecha_hasta?: string }>({}) // Used for confirmation
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewResults, setPreviewResults] = useState<any[]>([])
  const [excedentesResults, setExcedentesResults] = useState<any[]>([])
  const [operatorLoads, setOperatorLoads] = useState<Record<number, number>>({})

  const [isConfirmingPlan, setIsConfirmingPlan] = useState(false)
  const [isReplanning, setIsReplanning] = useState(false)
  /** Flag específico para "recalcular dentro de la vista previa" (no cerrar modal). */
  const [isPreviewCalculating, setIsPreviewCalculating] = useState(false)

  const [isOperatorsModalOpen, setIsOperatorsModalOpen] = useState(false)
  const [selectedOperatorForModal, setSelectedOperatorForModal] = useState<Operario | null>(null)
  const [isCambiarEstadoOpen, setIsCambiarEstadoOpen] = useState(false)
  const [operatorTasks, setOperatorTasks] = useState<PlanificacionItem[]>([])

  // Delete Planning Batch State
  const [isDeleteLoteDialogOpen, setIsDeleteLoteDialogOpen] = useState(false)
  const [isDeletingLote, setIsDeletingLote] = useState(false)








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
  const fetchData = async () => {
    try {
      setIsLoading(true);

      let mappedResources: Resource[] = [];

      // 1. Fetch Operarios
      try {
        const opResponse = await fetch(`${API_URL}/operarios`, { headers: getAuthHeaders() });
        if (opResponse.status === 401) {
          if (typeof window !== "undefined") window.location.href = "/login";
          return;
        }

        if (opResponse.ok) {
          const opData = await opResponse.json();
          const allOps = Array.isArray(opData.data) ? opData.data : (Array.isArray(opData) ? opData : []);
          const filteredOps = allOps.filter((op: any) => op.sector?.toUpperCase() !== "PRUEBAS");
          setRawOperarios(filteredOps);

          mappedResources = filteredOps.map((op: any) => ({
            id: op.id.toString(),
            name: op.nombre + " " + op.apellido,
            type: "operario",
            skills: [],
            ranges: op.rangos ? op.rangos.map((r: any) => (typeof r === "object" ? r.id : r)) : [],
            hora_inicio: op.hora_inicio || "09:00",
            hora_fin: op.hora_fin || "18:00",
          }));
          setResources(mappedResources);
        } else {
          console.error("Error fetching operarios:", opResponse.status);
        }
      } catch (error) {
        console.error("Failed to fetch operarios:", error);
      }

      // 2. Fetch Planificacion
      try {
        const planResponse = await fetch(`${API_URL}/planificacion`, { headers: getAuthHeaders() });
        if (planResponse.status === 401) {
          if (typeof window !== "undefined") window.location.href = "/login";
          return;
        }
        if (planResponse.ok) {
          const planData: PlanificacionItem[] = await planResponse.json();

          const parsedPlanData = planData.map((item) => {
            let ranges = item.rangos_permitidos;
            if (typeof ranges === "string") {
              try {
                ranges = JSON.parse(ranges);
              } catch (e) {
                ranges = [];
              }
            }

            if (Array.isArray(ranges) && ranges.length > 0 && typeof ranges[0] === "string") {
              try {
                if ((ranges[0] as string).trim().startsWith("[")) {
                  ranges = JSON.parse(ranges[0] as string);
                } else {
                  ranges = (ranges as unknown as string[]).map((r: string) => parseInt(r, 10)).filter((n: number) => !isNaN(n));
                }
              } catch (e) {
                console.error("Error parsing ranges array:", ranges);
                ranges = [];
              }
            }

            return {
              ...item,
              rangos_permitidos: Array.isArray(ranges) ? ranges : [],
            };
          });

          setRawPlanificacion(parsedPlanData);
          const ganttTasks = convertPlanificacionToGanttTasks(parsedPlanData, mappedResources);
          setTasks(ganttTasks);
        } else {
          console.error("Error fetching planificacion:", planResponse.status);
        }
      } catch (error) {
        console.error("Failed to fetch planificacion:", error);
      }

      // 3. Fetch Maquinarias
      try {
        const maqResponse = await fetch(`${API_URL}/maquinarias`, { headers: getAuthHeaders() });
        if (maqResponse.status === 401) {
          if (typeof window !== "undefined") window.location.href = "/login";
          return;
        }
        if (maqResponse.ok) {
          const maqData = await maqResponse.json();
          const list = Array.isArray(maqData.data) ? maqData.data : (Array.isArray(maqData) ? maqData : []);
          setRawMaquinarias(list);
        }
      } catch (error) {
        console.error("Error fetching maquinarias:", error);
      }

      // 4. Fetch Ordenes
      try {
        const ordenesResponse = await fetch(`${API_URL}/ordenes`, { headers: getAuthHeaders() });
        if (ordenesResponse.status === 401) {
          if (typeof window !== "undefined") window.location.href = "/login";
          return;
        }
        if (ordenesResponse.ok) {
          const ordenesData = await ordenesResponse.json();
          const ordenesList = Array.isArray(ordenesData) ? ordenesData : (ordenesData.data || []);
          setOrdenesTrabajo(ordenesList);
        }
      } catch (error) {
        console.error("Error fetching ordenes:", error);
      }
    } catch (globalError) {
      console.error("Critical error in fetchData:", globalError);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  /**
   * Lee el query param `?edit_ot=ID` (o `?edit_ot_vieja=ID`) y, cuando las OTs
   * ya están cargadas, abre el modal de edición. Esto permite que desde el modal
   * de vista previa el usuario haga click en "Editar OT ↗" y aterrice acá
   * directamente sobre la OT correcta, en una pestaña separada.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (ordenesTrabajo.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const editOtId = params.get("edit_ot");
    const editOtVieja = params.get("edit_ot_vieja");
    if (!editOtId && !editOtVieja) return;

    const target = editOtId
      ? ordenesTrabajo.find(o => o.id === parseInt(editOtId))
      : ordenesTrabajo.find(o => o.id_otvieja === parseInt(editOtVieja!));

    if (target) {
      setOrderToEdit(target);
      setIsCreateModalOpen(true);
      // Limpiamos el query param sin recargar para que no se vuelva a abrir al refresh.
      const url = new URL(window.location.href);
      url.searchParams.delete("edit_ot");
      url.searchParams.delete("edit_ot_vieja");
      window.history.replaceState({}, "", url.toString());
    }
  }, [ordenesTrabajo]);


  const uniqueLotes = React.useMemo(() => {
    const lotes = new Map<string, { id: string; descripcion: string; date: string }>();
    rawPlanificacion.forEach(item => {
      if (item.id_planificacion_lote) {
        if (!lotes.has(item.id_planificacion_lote)) {
          lotes.set(item.id_planificacion_lote, {
            id: item.id_planificacion_lote,
            descripcion: item.descripcion_lote || "Sin descripción",
            date: item.creado_en // Assuming date is consistent for the batch
          });
        }
      }
    });
    // Convert to array and sort by date descending
    return Array.from(lotes.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [rawPlanificacion]);

  const filteredPlanificacion = React.useMemo(() => {
    if (selectedLoteId === "all") return rawPlanificacion;
    return rawPlanificacion.filter(p => p.id_planificacion_lote === selectedLoteId);
  }, [rawPlanificacion, selectedLoteId]);


  const isOrderDelivered = (order: WorkOrder) => {
    // Una OT está "entregada / finalizada" si:
    //   (a) el cron la marcó finalizadototal=1 (regla oficial del legacy: cantidade>=cantidad,
    //       fc=1, suspendida=1, etc.) — esto es el caso más común. El cron NO siempre setea
    //       fecha_entrega porque en el legacy esa fecha queda en '1950-01-01' (sentinel)
    //       hasta que se facture, así que no podemos depender solo de fecha_entrega.
    //   (b) o tiene fecha_entrega real (>1950).
    // Bug previo: solo se chequeaba (b), por eso el modal Planificador mostraba 208 OTs
    // cuando la lista "No Planificadas" mostraba 165 — las 43 de diferencia eran OTs ya
    // finalizadas (finalizadototal=1) pero con fecha_entrega NULL.
    if (Number(order.finalizadototal) === 1) return true;
    if (!order.fecha_entrega) return false;
    const deliveryDate = new Date(order.fecha_entrega);
    return deliveryDate.getFullYear() > 1950;
  };

  // Use filteredPlanificacion for deriving planned orders to reflect the history selection
  const plannedOrderIds = new Set(filteredPlanificacion.map(p => p.orden_id));
  const plannedOrdenes = ordenesTrabajo.filter(o => plannedOrderIds.has(o.id));

  // Set de fechas (YYYY-MM-DD) que tienen al menos un proceso planificado.
  // Se usa en el calendario del banner para mostrar un punto rojo en esos días,
  // así el usuario sabe de un vistazo en qué días hay trabajo cargado.
  const plannedDates = React.useMemo(() => {
    const set = new Set<string>();
    filteredPlanificacion.forEach(p => {
      if (!p.creado_en || typeof p.inicio_min !== 'number') return;
      const base = new Date(p.creado_en);
      base.setHours(9, 0, 0, 0);
      const real = addWorkMinutes(base, p.inicio_min);
      const key = `${real.getFullYear()}-${String(real.getMonth() + 1).padStart(2, '0')}-${String(real.getDate()).padStart(2, '0')}`;
      set.add(key);
    });
    return set;
  }, [filteredPlanificacion]);

  // Lista de Date objects (uno por cada día con planificación) — react-day-picker
  // espera un array de Dates como modificador, no un Set de strings.
  const plannedDateObjects = React.useMemo(() => {
    return Array.from(plannedDates).map(key => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d);
    });
  }, [plannedDates]);

  // Calculate REALLY Unplanned Orders (excluding ALL planned orders from ANY batch AND delivered orders)
  const allPlannedIds = new Set(rawPlanificacion.map(p => p.orden_id));
  const trulyUnplannedOrders = ordenesTrabajo.filter(o => !allPlannedIds.has(o.id) && !isOrderDelivered(o));

  // For the standard view (not re-planning), we usually show 'unplannedOrdenes' which excludes CURRENTLY viewed planned + Delivered.
  // BUT if 'selectedLoteId' is specific, 'plannedOrdenes' has only that batch.
  // If we want to show 'Unplanned' in the table, effectively it should be trulyUnplanned + those from other batches?
  // Current logic: unplannedOrdenes = ordenesTrabajo.filter(o => !plannedOrderIds.has(o.id));
  // If I select 'Batch A', plannedOrderIds has Batch A IDs.
  // unplannedOrdenes has Unplanned + Batch B IDs. This is CORRECT for the "Unplanned" table view if that's what's intended.
  // BUT for Re-planning, user wants: Batch A + Unplanned. (Exclude Batch B).
  const unplannedOrdenes = ordenesTrabajo.filter(o => !plannedOrderIds.has(o.id) && !isOrderDelivered(o));


  const ordersForPlanning = React.useMemo(() => {
    if (isReplanning && selectedLoteId !== 'all') {
      // Current batch orders (plannedOrdenes) + TRULY Unplanned
      const map = new Map<number, WorkOrder>();
      trulyUnplannedOrders.forEach(o => map.set(o.id, o));
      plannedOrdenes.forEach(o => map.set(o.id, o));

      // Filter out FULLY FINALIZED or DELIVERED orders
      // Users don't want to re-plan things that are already done.
      const allOrders = Array.from(map.values());
      return allOrders.filter(o => {
        if (isOrderDelivered(o)) return false;
        if (!o.procesos || o.procesos.length === 0) return true; // Keep if no processes (edge case)
        // If every process is status 3 (Finalizado), exclude it.
        const allFinalized = o.procesos.every(p => p.estado_proceso.id === 3);
        return !allFinalized;
      });
    }
    // If not re-planning, we just show "unplanned"
    return unplannedOrdenes;
  }, [isReplanning, selectedLoteId, trulyUnplannedOrders, plannedOrdenes, unplannedOrdenes]);


  // ... existing code ...

  const handleTaskMove = async (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newStart = new Date(newDate + "T" + newStartTime + ":00");
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

    const newGanttTasks = convertPlanificacionToGanttTasks(updatedRawPlanificacion, resources);

    setRawPlanificacion(updatedRawPlanificacion);
    setTasks(newGanttTasks);

    try {
      const response = await fetch(`${API_URL}/planificacion/` + task.dbId, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
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

    // Optimistic update for PlanningListTable (ordenesTrabajo)
    setOrdenesTrabajo(prev => prev.map(order => {
      if (order.id !== targetTask.orden_id) return order;

      const op = rawOperarios.find(o => o.id === opId);
      const opName = op ? `${op.nombre} ${op.apellido}` : "";

      return {
        ...order,
        procesos: order.procesos.map(proc => {
          if (proc.proceso.id !== targetTask.proceso_id) return proc;
          return {
            ...proc,
            operario_nombre: opName,
            // If the local interface has id_operario, update it too
            // id_operario: opId 
          };
        })
      };
    }));

    try {
      await fetch(`${API_URL}/planificacion/` + targetTask.id, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
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
      await fetch(`${API_URL}/ordenes/` + targetTask.orden_id + "/procesos/" + targetTask.proceso_id + "/estado", {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ id_estado: idEstado }),
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }

  }

  const handleMachineryChange = async (ordenId: number, procesoId: number, maquinariaId: number) => {
    // Find the planificacion item
    const planItem = rawPlanificacion.find(p => p.orden_id === ordenId && p.proceso_id === procesoId);
    if (!planItem) return;

    // Optimistic update
    const updatedItem = { ...planItem, id_maquinaria: maquinariaId };

    // Update rawPlanificacion
    setRawPlanificacion(prev => prev.map(p => p.id === planItem.id ? updatedItem : p));

    // Update Gantt tasks if necessary (GanttTasks don't currently show machine ID but might use it for filtering)
    // For now we just update rawPlanificacion which is the source of truth for the list

    try {
      const response = await fetch(`${API_URL}/planificacion/${planItem.id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ id_maquinaria: maquinariaId })
      });

      if (!response.ok) throw new Error("Failed to update machinery");

      // Update local machinery name/id in rawPlanificacion for display
      // We might need to refetch or manually update the name if we want to be perfect without refetch
      // but the Select uses ID so it should be fine.
      // If we display name, we need to look it up.
      const machine = rawMaquinarias.find(m => m.id === maquinariaId);
      if (machine) {
        setRawPlanificacion(prev => prev.map(p => p.id === planItem.id ? { ...p, nombre_maquinaria: machine.nombre } : p));
      }

    } catch (error) {
      console.error("Error updating machinery:", error);
      toast.error("Error al actualizar maquinaria");
      // Revert
      fetchData();
    }
  };


  const [isStatusConfirmOpen, setIsStatusConfirmOpen] = useState(false);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<{ ordenId: number, procesoId: number, newStatusId: number } | null>(null);

  const confirmStatusChange = () => {
    if (pendingStatusUpdate) {
      executeProcessStatusChange(pendingStatusUpdate.ordenId, pendingStatusUpdate.procesoId, pendingStatusUpdate.newStatusId);
      setPendingStatusUpdate(null);
    }
    setIsStatusConfirmOpen(false);
  };

  const handleProcessStatusChange = async (ordenId: number, procesoId: number, newStatusId: number) => {
    // Find current status
    const order = ordenesTrabajo.find(o => o.id === ordenId);
    if (!order) return;
    const process = order.procesos.find(p => p.proceso.id === procesoId);
    if (!process) return;

    const currentStatusId = process.estado_proceso.id;

    // Check if reverting from Finalizado (3) to Pendiente (1)
    if (currentStatusId === 3 && newStatusId === 1) {
      setPendingStatusUpdate({ ordenId, procesoId, newStatusId });
      setIsStatusConfirmOpen(true);
      return;
    }

    // Otherwise proceed directly
    executeProcessStatusChange(ordenId, procesoId, newStatusId);
  };

  const executeProcessStatusChange = async (ordenId: number, procesoId: number, newStatusId: number) => {
    // 1. Optimistic update local state (ordenesTrabajo)
    setOrdenesTrabajo(prev => prev.map(order => {
      if (order.id !== ordenId) return order;
      return {
        ...order,
        procesos: order.procesos.map(proc => {
          if (proc.proceso.id !== procesoId) return proc;

          let statusDesc = 'Pendiente';
          if (newStatusId === 2) statusDesc = 'En Proceso';
          if (newStatusId === 3) statusDesc = 'Finalizado';

          return {
            ...proc,
            estado_proceso: {
              id: newStatusId,
              descripcion: statusDesc
            }
          };
        })
      };
    }));

    // 2. Also update rawPlanificacion/tasks if they link to this process?
    // This is complex as rawPlanificacion items map one-to-one with processes.
    // We can try to find the matching PlanificacionItem and update it too for consistency.
    setRawPlanificacion(prev => prev.map(p => {
      if (p.orden_id === ordenId && p.proceso_id === procesoId) {
        let statusString = 'pendiente';
        if (newStatusId === 2) statusString = 'en_curso';
        if (newStatusId === 3) statusString = 'completado';

        return {
          ...p,
          id_estado: newStatusId,
          estado: statusString
        };
      }
      return p;
    }));

    // Update tasks state (Gantt) as well
    setTasks(prev => prev.map(t => {
      // We need to find the task corresponding to this process.
      // We can match by dbId if we had it, but here we iterate. 
      // We can inspect rawPlanificacion update and sync.
      // Or simpler: just find task with matching ordenId and processId via rawPlanificacion lookup?
      // Actually, GanttTasks have 'dbId' which matches PlanificacionItem.id.
      // We don't have that ID directly here easily without lookup.
      // Let's rely on finding it in rawPlanificacion first or just refetch? 
      // For now, let's skip deep Gantt update here or do a simple lookup.
      return t;
    }));


    try {
      const response = await fetch(`${API_URL}/ordenes/` + ordenId + "/procesos/" + procesoId + "/estado", {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ id_estado: newStatusId }),
      });

      if (!response.ok) throw new Error("Failed to update status");

      const json = await response.json();

      // Update with real server timestamps if available
      if (json.status && json.data) {
        const { inicio_real, fin_real } = json.data;

        setOrdenesTrabajo(prev => prev.map(order => {
          if (order.id !== ordenId) return order;
          return {
            ...order,
            procesos: order.procesos.map(proc => {
              if (proc.proceso.id !== procesoId) return proc;
              return {
                ...proc,
                inicio_real: inicio_real,
                fin_real: fin_real
              };
            })
          };
        }));
      }
      toast.success("Estado actualizado correctamente");
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Error al actualizar el estado");
      // Revert in case of error (would need complex revert logic or simple refetch)
    }
  }


  const handleProcessReorder = async (ordenId: number, newOrderedProcesses: any[]) => {
    // 1. Optimistic update
    setOrdenesTrabajo(prev => prev.map(order => {
      if (order.id !== ordenId) return order;
      return {
        ...order,
        procesos: newOrderedProcesses
      };
    }));

    try {
      const response = await fetch(`${API_URL}/ordenes/${ordenId}/procesos/reorder`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({
          ordenes: newOrderedProcesses.map(p => ({
            id_proceso: p.proceso.id,
            orden: p.orden
          }))
        })
      });

      if (!response.ok) throw new Error("Failed to reorder processes");
      toast.success("Orden de procesos actualizado");
    } catch (error) {
      console.error("Error reordering:", error);
      toast.error("Error al reordenar los procesos");
      // Revert logic would go here (fetchData)
      fetchData();
    }
  };

  const handlePlanSelection = async (ids: number[], range: { fecha_desde?: string, fecha_hasta?: string } = {}) => {
    if (ids.length === 0) return;

    // Set selected IDs and range locally so we know what to verify/save later
    setSelectedOrderIds(ids);
    setPlanningRange(range);

    // Call API for preview
    try {
      toast.loading("Calculando planificación...");
      const response = await fetch(`${API_URL}/planificar`, {
        method: "POST",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({
          ordenes_ids: ids,
          preview: true,
          fecha_desde: range.fecha_desde,
          fecha_hasta: range.fecha_hasta,
        }),
      });

      toast.dismiss();

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.detail || "Error al calcular planificación");
        return;
      }

      const responseData = await response.json();

      // Backend ahora devuelve {planificados, excedentes}; mantenemos compat con array crudo por si acaso
      const planificadosRaw: any[] = Array.isArray(responseData)
        ? responseData
        : (responseData.planificados || []);
      const excedentesRaw: any[] = Array.isArray(responseData)
        ? []
        : (responseData.excedentes || []);

      // Enrich results with Client and Article info
      const now = new Date();
      const enrich = (res: any) => {
        const order = ordenesTrabajo.find(o => o.id === res.orden_id);
        const operario = rawOperarios.find(op => op.id === res.id_operario);
        const maquina = rawMaquinarias.find(m => m.id === res.id_maquinaria);

        // Calculate simplified dates (assuming T=0 is Now, and API returns 'inicio_min'/'fin_min')
        // We use 'inicio_min' from result if available, otherwise fallback to check if 'start_time' exists (legacy?)
        const startMin = res.inicio_min !== undefined ? res.inicio_min : (res.start_time || 0);
        const endMin = res.fin_min !== undefined ? res.fin_min : (res.end_time || 0);

        const startDate = new Date(now.getTime() + startMin * 60000);
        const endDate = new Date(now.getTime() + endMin * 60000);

        const formatDateShort = (d: Date) => {
          return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        }

        return {
          ...res,
          id_otvieja: order?.id_otvieja,
          cliente: order?.cliente?.nombre || "N/A",
          articulo: order?.articulo?.descripcion || "N/A",
          codigo: order?.articulo?.cod_articulo || "",
          operario_nombre: operario ? `${operario.nombre} ${operario.apellido}` : null,
          maquinaria_nombre: maquina ? maquina.nombre : null,
          fecha_inicio_texto: formatDateShort(startDate),
          fecha_fin_texto: formatDateShort(endDate),
          fecha_prometida: order?.fecha_prometida || null,
          fecha_entrada: order?.fecha_entrada || null,
          unidades: order?.unidades || 0,
          cantidad_entregada: order?.cantidad_entregada || 0,
          estado_material: order?.estado_material || null,
          id_prioridad: order?.id_prioridad,
          prioridad_descripcion: order?.prioridad?.descripcion,
          // Status flags for coloring
          all_finalized: order?.procesos?.every(p => p.estado_proceso.id === 3) && (order?.procesos?.length || 0) > 0,
          any_process_started: order?.procesos?.some(p => p.estado_proceso.id === 2 || p.estado_proceso.id === 3)
        };
      };

      const enrichedResults = planificadosRaw.map(enrich);
      const enrichedExcedentes = excedentesRaw.map(enrich);

      setPreviewResults(enrichedResults);
      setExcedentesResults(enrichedExcedentes);

      // Calculate current operator loads for the WEEK of the FIRST PLANNED ITEM
      const loads: Record<number, { current: number, new: number }> = {};

      // Helper to get week key or range
      const getWeekKey = (date: Date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - d.getDay() + 1); // Monday
        return d.getTime();
      };

      const newPlanWeekKeys = new Set(enrichedResults.map((r: any) => {
        const startMin = r.inicio_min !== undefined ? r.inicio_min : (r.start_time || 0);
        return getWeekKey(new Date(now.getTime() + startMin * 60000));
      }));

      // Better approach using `tasks` (GanttTasks) which have absolute dates
      const calculatedLoads: Record<number, number> = {};

      tasks.forEach(task => {
        const opId = parseInt(task.resourceId);
        if (isNaN(opId)) return;

        const taskDate = new Date(task.startDate);
        const taskWeek = getWeekKey(taskDate);

        // Only count if it falls in one of the relevant weeks for new plan
        if (newPlanWeekKeys.has(taskWeek)) {
          calculatedLoads[opId] = (calculatedLoads[opId] || 0) + (task.duration * 60); // Duration in minutes
        }
      });

      setOperatorLoads(calculatedLoads);

      // Close selection modal and open preview
      setIsSelectionModalOpen(false);
      setIsPreviewOpen(true);

    } catch (error) {
      toast.error("Error al calcular la planificación");
    }
  };

  /**
   * Recalcula la planificación SIN cerrar el modal de vista previa. Lo usa el
   * modal cuando el usuario:
   *   - Agrega más OTs vía el popover "Agregar OTs"
   *   - Toca el botón "Recalcular" (por si cambió disponibilidad de operarios,
   *     forzó algún excedente, etc.)
   *
   * Usa el mismo rango (`planningRange`) que se eligió al abrir el modal y
   * reusa la lógica de enrich de `handlePlanSelection`.
   */
  const handleRecalculatePreview = async (
    ids: number[],
    range: { fecha_desde?: string; fecha_hasta?: string },
    forzarIds: number[] = [],
    procesosPorOrden?: Record<number, number[]>,
  ) => {
    if (ids.length === 0) {
      toast.error("No hay OTs para recalcular.");
      return;
    }
    setIsPreviewCalculating(true);
    setSelectedOrderIds(ids);
    setPlanningRange(range);

    try {
      const response = await fetch(`${API_URL}/planificar`, {
        method: "POST",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({
          ordenes_ids: ids,
          preview: true,
          fecha_desde: range.fecha_desde,
          fecha_hasta: range.fecha_hasta,
          forzar_ordenes_ids: forzarIds.length > 0 ? forzarIds : undefined,
          // D1: si se eligieron procesos sueltos, se mandan para planificar solo esos de esas OTs.
          procesos_por_orden: procesosPorOrden && Object.keys(procesosPorOrden).length > 0 ? procesosPorOrden : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.detail || "Error al recalcular planificación");
        return;
      }

      const responseData = await response.json();
      const planificadosRaw: any[] = Array.isArray(responseData) ? responseData : (responseData.planificados || []);
      const excedentesRaw: any[] = Array.isArray(responseData) ? [] : (responseData.excedentes || []);

      const now = new Date();
      const enrich = (res: any) => {
        const order = ordenesTrabajo.find(o => o.id === res.orden_id);
        const operario = rawOperarios.find(op => op.id === res.id_operario);
        const maquina = rawMaquinarias.find(m => m.id === res.id_maquinaria);
        const startMin = res.inicio_min !== undefined ? res.inicio_min : (res.start_time || 0);
        const endMin = res.fin_min !== undefined ? res.fin_min : (res.end_time || 0);
        const startDate = new Date(now.getTime() + startMin * 60000);
        const endDate = new Date(now.getTime() + endMin * 60000);
        const formatDateShort = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return {
          ...res,
          id_otvieja: order?.id_otvieja,
          cliente: order?.cliente?.nombre || "N/A",
          articulo: order?.articulo?.descripcion || "N/A",
          codigo: order?.articulo?.cod_articulo || "",
          operario_nombre: operario ? `${operario.nombre} ${operario.apellido}` : null,
          maquinaria_nombre: maquina ? maquina.nombre : null,
          fecha_inicio_texto: formatDateShort(startDate),
          fecha_fin_texto: formatDateShort(endDate),
          fecha_prometida: order?.fecha_prometida || null,
          fecha_entrada: order?.fecha_entrada || null,
          unidades: order?.unidades || 0,
          cantidad_entregada: order?.cantidad_entregada || 0,
          estado_material: order?.estado_material || null,
          id_prioridad: order?.id_prioridad,
          prioridad_descripcion: order?.prioridad?.descripcion,
          all_finalized: order?.procesos?.every(p => p.estado_proceso.id === 3) && (order?.procesos?.length || 0) > 0,
          any_process_started: order?.procesos?.some(p => p.estado_proceso.id === 2 || p.estado_proceso.id === 3),
        };
      };

      setPreviewResults(planificadosRaw.map(enrich));
      setExcedentesResults(excedentesRaw.map(enrich));

      // Distinguimos:
      //   - "sin lugar" reales: OTs excedentes que el usuario NO forzó (decisión pendiente).
      //   - "forzadas parciales": OTs que el usuario forzó pero el solver no pudo asignar todos
      //     sus procesos (probablemente por falta de operario/máquina compatible o timeout).
      // Sin esta distinción, el toast decía "X OTs sin lugar" aun después de forzar y eso
      // confundía al usuario ("forzo y dice que están sin lugar?").
      const planificadosCount = planificadosRaw.length;
      const forcedSet = new Set(forzarIds);
      const excedenteOrdenIds = Array.from(new Set(excedentesRaw.map(r => r.orden_id)));
      const trueSinLugar = excedenteOrdenIds.filter(id => !forcedSet.has(id));
      const forzadasParciales = excedenteOrdenIds.filter(id => forcedSet.has(id));

      const parts = [`${planificadosCount} procesos planificados`];
      if (trueSinLugar.length > 0) parts.push(`${trueSinLugar.length} OT(s) sin lugar`);
      if (forzadasParciales.length > 0) parts.push(`${forzadasParciales.length} OT(s) forzada(s) con procesos sin asignar`);
      toast.success(`Recalculado: ${parts.join(", ")}.`);
    } catch (error) {
      toast.error("Error al recalcular la planificación");
    } finally {
      setIsPreviewCalculating(false);
    }
  };

  const handleConfirmPlan = async (manualPlanOrForzar?: any[] | { forzarOrdenIds: number[] }) => {
    try {
      setIsConfirmingPlan(true);

      // Distinguir entre el caso "manual plan" (array) y el nuevo "decisiones de excedentes" ({forzarOrdenIds})
      let manualPlan: any[] | undefined = undefined;
      let forzarOrdenIds: number[] | undefined = undefined;
      if (Array.isArray(manualPlanOrForzar)) {
        manualPlan = manualPlanOrForzar;
      } else if (manualPlanOrForzar && Array.isArray(manualPlanOrForzar.forzarOrdenIds)) {
        forzarOrdenIds = manualPlanOrForzar.forzarOrdenIds;
      }

      // Filtrar las órdenes que el usuario decidió descartar (eran excedentes y no fueron forzadas)
      let finalOrdenIds = selectedOrderIds;
      if (forzarOrdenIds !== undefined) {
        const excedentesOrdenIds = new Set(excedentesResults.map((r: any) => r.orden_id));
        const forzarSet = new Set(forzarOrdenIds);
        // Mantener: las que ya estaban planificadas (no excedentes) + las que el usuario forzó
        finalOrdenIds = selectedOrderIds.filter(id => !excedentesOrdenIds.has(id) || forzarSet.has(id));
      }

      const response = await fetch(`${API_URL}/planificar`, {
        method: "POST",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({
          ordenes_ids: finalOrdenIds,
          preview: false,
          plan: manualPlan,
          fecha_desde: planningRange.fecha_desde,
          fecha_hasta: planningRange.fecha_hasta,
          forzar_ordenes_ids: forzarOrdenIds,
        }),
      });

      if (!response.ok) {
        toast.error("Error al guardar planificación");
        return;
      }

      toast.success("Planificación guardada exitosamente");
      setIsPreviewOpen(false);
      setSelectedOrderIds([]);
      setPlanningRange({});
      setExcedentesResults([]);

      // Refresh data
      await fetchData();

    } catch (error) {
      toast.error("Error al guardar la planificación");
    } finally {
      setIsConfirmingPlan(false);
    }
  };

  const handleDeleteLote = async () => {
    if (selectedLoteId === "all") return;

    try {
      setIsDeletingLote(true);
      const response = await fetch(`${API_URL}/planificacion/lote/${selectedLoteId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (!response.ok) throw new Error("Error al eliminar el lote de planificación");

      toast.success("Lote de planificación eliminado correctamente");
      setSelectedLoteId("all");
      await fetchData();
    } catch (error) {
      console.error("Error deleting planning batch:", error);
      toast.error("Error al eliminar el lote de planificación");
    } finally {
      setIsDeletingLote(false);
      setIsDeleteLoteDialogOpen(false);
    }
  };


  return (
    <div className={"min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col transition-all duration-300 ease-in-out " + ((isDetailsPanelOpen && (activeTab === 'gantt' || activeTab === 'lista_planificacion')) ? 'xl:mr-[400px]' : '')}>
      {/* Header normal (no sticky)
          Antes: el header era full-width (border-b shadow-sm) y el card de abajo
          estaba centrado con padding lateral, lo que los hacía verse desalineados.
          Ahora ambos son cards con los MISMOS paddings laterales que el body container,
          así sus bordes y contenidos quedan perfectamente alineados verticalmente. */}
      <div className="flex-shrink-0 w-full px-2 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-gray-900 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-xl shadow-lg shrink-0">
                  <Activity className="h-5 w-5 md:h-7 md:w-7 text-white" />
                </div>
                Operaciones
              </h1>
              <p className="text-gray-500 mt-1 text-sm md:text-base">Gestiona la planificación de las órdenes de trabajo</p>
            </div>
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              <Button
                variant="outline"
                onClick={() => setIsAvailabilityModalOpen(true)}
                className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300 shadow-sm flex-1 md:flex-none"
                title="Configurar feriados y días no laborales"
              >
                <CalendarClock className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Disponibilidad</span>
              </Button>
              <Button
                onClick={() => {
                  setIsReplanning(false);
                  setIsSelectionModalOpen(true);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all hover:shadow-lg flex-1 md:flex-none"
              >
                <CalendarClock className="md:mr-2 h-4 w-4" />
                <span className="hidden md:inline">Planificar</span>
              </Button>
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-red-700 hover:bg-red-800 text-white shadow-md transition-all hover:shadow-lg flex-1 md:flex-none w-full sm:w-auto mt-2 sm:mt-0"
              >
                <Plus className="mr-2 h-4 w-4" />
                <span>Nueva Orden</span>
              </Button>
            </div>
          </div>

          {/* Tabs Navigation */}
          <div className="flex overflow-x-auto pb-1 items-center gap-1 mt-6 border-b border-gray-200 scrollbar-hide">
            <button
              onClick={() => setActiveTab("lista_planificacion")}
              className={"flex whitespace-nowrap items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors " + (activeTab === "lista_planificacion" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")}
            >
              <LayoutList size={18} />
              Planificación
            </button>
            {/* <button
              onClick={() => setActiveTab("gantt")}
              className={"flex whitespace-nowrap items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors " + (activeTab === "gantt" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")}
            >
              <GanttChartSquare size={18} />
              Gantt
            </button> */}

            <button
              onClick={() => setActiveTab("operarios")}
              className={"flex whitespace-nowrap items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors " + (activeTab === "operarios" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")}
            >
              <User size={18} />
              Operarios
            </button>

            <button
              onClick={() => setActiveTab("materia_prima")}
              className={"flex whitespace-nowrap items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors " + (activeTab === "materia_prima" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")}
            >
              <Box size={18} />
              Materia Prima
            </button>

            <button
              onClick={() => setActiveTab("work_orders")}
              className={"flex whitespace-nowrap items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors " + (activeTab === "work_orders" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")}
            >
              <LayoutList size={18} />
              Órdenes de Trabajo
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-visible w-full">
        {/* Padding-top reducido (pt-4) porque ahora el header también es un card con
            su propio margin inferior implícito. Antes era py-8 que generaba un gap
            excesivo entre el header full-width y el card del body. */}
        {/* Padding unificado entre `work_orders` y `lista_planificacion` para que las
            tablas internas (PlanningListTable / UnplannedWorkOrdersList / CompletedWorkOrdersList)
            tengan exactamente el mismo ancho útil y los anchos de columna se vean iguales. */}
        <div className={`flex-1 transition-all w-full duration-300 flex flex-col ${activeTab === 'gantt' ? 'w-full px-2 py-4' : 'w-full mx-auto px-2 sm:px-4 md:px-6 lg:px-8 pt-4 pb-4 sm:pb-8'}`}>
          {/* Para `lista_planificacion` quitamos el padding del card (`p-0`) para que
              la barra de sub-tabs (Planificadas | Semanal | ...) ocupe el ancho COMPLETO
              y toque los bordes superior e izquierdo del card. El padding interno lo
              maneja cada TabsContent abajo. */}
          {/* `work_orders` usa el mismo padding interno (p-6 / p-0) que `lista_planificacion`
              para que las tablas hijas tengan el mismo ancho exacto y las columnas se
              alineen entre Planificación, No Planificadas e Historial. */}
          <div className={`bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col ${activeTab === 'gantt' ? 'p-2' : activeTab === 'work_orders' ? 'p-6' : activeTab === 'lista_planificacion' ? 'p-0 overflow-hidden' : 'p-6'}`}>
            {/* Redundant header removed */}

            {activeTab === "operarios" && (
              <div className="w-full">
                <div className="flex items-center gap-2 mb-4">
                  <User className="h-5 w-5 text-gray-500" />
                  <h2 className="text-lg font-semibold">Gestión de Operarios</h2>
                </div>
                <SharedOperatorsList
                  operarios={rawOperarios}
                  isLoading={isLoading && rawOperarios.length === 0}
                  onView={(op) => {
                    setSelectedOperatorForModal(op);
                    setOperatorTasks(rawPlanificacion.filter(p => p.id_operario === op.id));
                  }}
                />
              </div>
            )}

            {activeTab === "materia_prima" && (
              <MateriaPrimaTab />
            )}

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

            {activeTab === "work_orders" && (
              <WorkOrdersListWrapper
                refreshTrigger={refreshTrigger}
                orders={ordenesTrabajo}
                planificacion={rawPlanificacion}
                operarios={rawOperarios}
                maquinarias={rawMaquinarias}
                onRefresh={fetchData}
              />
            )}
            {activeTab === "lista_planificacion" && (
              <Tabs defaultValue="general" className="w-full flex-1 flex flex-col">
                {/* Header de sub-tabs: cambié `xl:flex-row` → `lg:flex-row` para que tabs y
                    acciones queden lado a lado desde 1024px (antes solo desde 1280px, lo cual
                    hacía que con el sidebar abierto las acciones se fueran a una segunda fila).
                    Si el ancho aún no alcanza, los tabs scrollean horizontal (no wrappean). */}
                <div className="border-b px-4 sm:px-6 pt-2 bg-gray-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-2 lg:gap-3">
                  <TabsList className="bg-transparent p-0 h-auto flex flex-nowrap gap-1 sm:gap-2 lg:gap-3 justify-start w-full lg:w-auto overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <TabsTrigger
                      value="general"
                      className="shrink-0 rounded-none border-b-2 border-transparent px-2 lg:px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-500 data-[state=active]:border-red-600 data-[state=active]:text-red-700 data-[state=active]:bg-transparent hover:text-gray-700 transition-colors"
                    >
                      Planificadas
                    </TabsTrigger>
                    <TabsTrigger
                      value="semanal"
                      className="shrink-0 rounded-none border-b-2 border-transparent px-2 lg:px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-500 data-[state=active]:border-red-600 data-[state=active]:text-red-700 data-[state=active]:bg-transparent hover:text-gray-700 transition-colors"
                    >
                      Semanal
                    </TabsTrigger>
                    <TabsTrigger
                      value="diaria"
                      className="shrink-0 rounded-none border-b-2 border-transparent px-2 lg:px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-500 data-[state=active]:border-red-600 data-[state=active]:text-red-700 data-[state=active]:bg-transparent hover:text-gray-700 transition-colors"
                    >
                      Diaria
                    </TabsTrigger>
                    <TabsTrigger
                      value="finalizadas"
                      className="shrink-0 rounded-none border-b-2 border-transparent px-2 lg:px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-500 data-[state=active]:border-red-600 data-[state=active]:text-red-700 data-[state=active]:bg-transparent hover:text-gray-700 transition-colors"
                    >
                      Finalizadas
                    </TabsTrigger>
                    <TabsTrigger
                      value="carga"
                      className="shrink-0 rounded-none border-b-2 border-transparent px-2 lg:px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-500 data-[state=active]:border-red-600 data-[state=active]:text-red-700 data-[state=active]:bg-transparent hover:text-gray-700 transition-colors"
                    >
                      Carga
                    </TabsTrigger>
                  </TabsList>

                  {/* Acciones de la derecha: mantengo todo en línea (sm:flex-row) y reduzco el
                      ancho del Select para que la barra entera quepa al lado de los tabs sin
                      romper el layout cuando hay sidebar abierto. */}
                  <div className="py-2 pr-2 flex flex-row items-center gap-2 flex-wrap lg:flex-nowrap w-full lg:w-auto">

                    {/* Zoom control compartido (mismo storage key que No Planificadas,
                        Historial, Planificar y Vista Previa). */}
                    <ZoomControl value={planZoom} onChange={setPlanZoom} />

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (selectedLoteId === "all") {
                          toast.error("Seleccione una planificación específica para re-planificar.");
                          return;
                        }
                        setIsReplanning(true);
                        setIsSelectionModalOpen(true);
                      }}
                      className={cn(
                        "bg-white border-blue-200 transition-colors",
                        selectedLoteId === "all"
                          ? "text-gray-400 border-gray-200 cursor-not-allowed hover:bg-white"
                          : "text-blue-600 hover:bg-gray-50"
                      )}
                      title={selectedLoteId === "all" ? "Seleccione una planificación para habilitar" : "Re-planificar este lote (incluyendo órdenes pendientes)"}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5 lg:mr-2", selectedLoteId === "all" ? "text-gray-400" : "text-blue-600")} />
                      <span className="hidden lg:inline">Re-planificar</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsDeleteLoteDialogOpen(true)}
                      className={cn(
                        "bg-white border-red-200 transition-colors",
                        selectedLoteId === "all"
                          ? "text-gray-400 border-gray-200 cursor-not-allowed hover:bg-white"
                          : "text-red-600 hover:bg-red-50"
                      )}
                      disabled={selectedLoteId === "all" || isDeletingLote}
                      title={selectedLoteId === "all" ? "Seleccione una planificación para habilitar" : "Eliminar este lote de planificación"}
                    >
                      <Trash2 className={cn("h-3.5 w-3.5", selectedLoteId === "all" ? "text-gray-400" : "text-red-600")} />
                    </Button>

                    <Select value={selectedLoteId} onValueChange={setSelectedLoteId}>
                      <SelectTrigger className="w-[180px] lg:w-[220px] xl:w-[260px] bg-white border-gray-200 text-xs lg:text-sm">
                        <SelectValue placeholder="Lote / Historial" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las Planificaciones</SelectItem>
                        {uniqueLotes.map(lote => {
                          const dateObj = new Date(lote.date);

                          // Translate/Format Description
                          let label = lote.descripcion;
                          // If it looks like default format "Planificación [Month] [Year]", reformat it
                          if (label.toLowerCase().includes("planificación")) {
                            const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
                            const monthYear = capitalize(format(dateObj, 'MMMM yyyy', { locale: es }));
                            label = `Planificación ${monthYear}`;
                          }

                          const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          return (
                            <SelectItem key={lote.id} value={lote.id}>
                              {label} ({dateObj.toLocaleDateString()} {timeStr})
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* El zoom NO se aplica acá globalmente — se pasa como prop `tableZoom`
                    a cada PlanningListTable para que solo afecte la tabla, no la barra
                    de búsqueda ni los banners de Semanal/Diaria. */}
                <div className="flex-1 p-0">
                  <TabsContent value="general" className="m-0 h-full px-4 py-4 sm:px-6 sm:py-6">
                    {/* General: Show all that are NOT fully finalized */}
                    <PlanningListTable
                      tableZoom={planZoom}
                      data={plannedOrdenes.filter(order => {
                        // Exclude if all processes are finalized
                        const allFinalized = order.procesos && order.procesos.length > 0 && order.procesos.every(p => p.estado_proceso.id === 3);
                        return !allFinalized;
                      })}
                      isLoading={isLoading}
                      onProcessStatusChange={handleProcessStatusChange}
                      onProcessReorder={handleProcessReorder}
                      onOperatorChange={(ordenId, procesoId, operarioId) => handleOperatorChange(operarioId.toString(), rawPlanificacion.find(p => p.orden_id === ordenId && p.proceso_id === procesoId)?.id.toString())}
                      onMachineryChange={handleMachineryChange}
                      operarios={rawOperarios}
                      maquinarias={rawMaquinarias}
                      planificacion={rawPlanificacion}
                      onRowClick={(item) => {
                        setOrderToEdit(item);
                        setIsCreateModalOpen(true);
                      }}
                      onDataChange={fetchData}
                    />
                  </TabsContent>

                  <TabsContent value="semanal" className="m-0 h-full px-4 py-4 sm:px-6 sm:py-6">
                    {/* Weekly: Filter by reference week based on selected Lote.
                        Bug previo: el código filtraba por `p.fecha_inicio_estimada` pero ese
                        campo NO EXISTE en la tabla `planificacion`. Solo tiene `creado_en` +
                        `inicio_min` (offset en minutos hábiles). La fecha real se calcula
                        con `addWorkMinutes(creado_en@9am, inicio_min)` — misma lógica que
                        usa el Gantt y `getScheduledStart` en PlanningListTable. */}
                    {/* Banner Semanal — rediseñado para verse pro:
                          - Icono en cuadrito propio con fondo (jerarquía visual)
                          - Label uppercase pequeño arriba ("Semana") + rango en grande
                          - Badge con dot de color según origen (Hoy / Personalizada / Lote)
                          - Botón explícito "Cambiar fecha" + "Volver a hoy" condicional */}
                    {(() => {
                      let refDate = new Date();
                      let badgeText = "Esta semana";
                      // Paleta en sintonía con la marca (rojo) + estados:
                      //   - Default (esta semana / hoy): verde teal (estado positivo, complementa al rojo)
                      //   - Personalizada: ámbar (warm tone, complementario al rojo de marca)
                      //   - Según lote: índigo (frío, distingue del rojo sin chocar)
                      let badgeColor = "bg-teal-50 text-teal-700 ring-teal-200/80";
                      let badgeDot = "bg-teal-500";
                      if (customRefDate) {
                        refDate = customRefDate;
                        badgeText = "Fecha personalizada";
                        badgeColor = "bg-amber-50 text-amber-800 ring-amber-200/80";
                        badgeDot = "bg-amber-500";
                      } else if (selectedLoteId !== "all") {
                        const lote = uniqueLotes.find(l => l.id === selectedLoteId);
                        if (lote) {
                          refDate = new Date(lote.date);
                          badgeText = "Según lote";
                          badgeColor = "bg-indigo-50 text-indigo-700 ring-indigo-200/80";
                          badgeDot = "bg-indigo-500";
                        }
                      }
                      const day = refDate.getDay();
                      const diff = refDate.getDate() - day + (day === 0 ? -6 : 1);
                      const monday = new Date(refDate);
                      monday.setDate(diff);
                      const sunday = new Date(monday);
                      sunday.setDate(monday.getDate() + 6);
                      const fmt = (d: Date) => format(d, "d 'de' MMM", { locale: es });
                      const year = monday.getFullYear();

                      return (
                        <div className="mb-5 rounded-xl border border-red-100/80 bg-gradient-to-br from-white via-rose-50/40 to-red-50/30 shadow-sm">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5">
                            {/* Icono + Info principal */}
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              <div className="shrink-0 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#DC143C] to-[#B01030] shadow-md shadow-red-500/25 ring-1 ring-white/20">
                                <CalendarClock className="h-6 w-6 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-red-900/60">
                                  Semana visualizada
                                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${badgeColor}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${badgeDot}`} />
                                    {badgeText}
                                  </span>
                                </div>
                                <div className="mt-1 text-lg sm:text-xl font-bold text-slate-900 leading-tight tracking-tight">
                                  {fmt(monday)}
                                  <span className="mx-2 text-red-400/60 font-normal">→</span>
                                  {fmt(sunday)}
                                  <span className="ml-2 text-slate-400 font-normal text-base">{year}</span>
                                </div>
                              </div>
                            </div>

                            {/* Acciones */}
                            <div className="flex items-center gap-2 shrink-0">
                              {customRefDate && (
                                <button
                                  onClick={() => setCustomRefDate(null)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 hover:border-red-300 transition-colors"
                                >
                                  Volver a hoy
                                </button>
                              )}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#DC143C] to-[#B01030] px-4 py-2 text-xs font-semibold text-white shadow-md shadow-red-500/20 hover:shadow-lg hover:shadow-red-500/30 hover:brightness-110 active:scale-[0.98] transition-all">
                                    <CalendarClock className="h-3.5 w-3.5" />
                                    Cambiar fecha
                                    <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 border-red-100 shadow-xl shadow-red-500/10" align="end">
                                  <div className="border-b border-red-100 bg-gradient-to-r from-rose-50 to-red-50 px-4 py-2.5">
                                    <p className="text-xs font-semibold text-red-900">Elegí una fecha</p>
                                    <p className="text-[10px] text-red-700/70 mt-0.5">Los días con un punto tienen OTs planificadas</p>
                                  </div>
                                  <CalendarPicker
                                    mode="single"
                                    selected={refDate}
                                    onSelect={(d) => d && setCustomRefDate(d)}
                                    modifiers={{ hasPlan: plannedDateObjects }}
                                    modifiersClassNames={{
                                      hasPlan: "relative font-bold text-[#DC143C] after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:bg-[#DC143C] after:rounded-full",
                                    }}
                                    locale={es}
                                  />
                                  <div className="border-t border-red-100 bg-rose-50/40 px-3 py-2 text-[11px] text-red-900/80 flex items-center gap-2">
                                    <span className="h-1.5 w-1.5 rounded-full bg-[#DC143C]" />
                                    Días con OTs planificadas
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    <PlanningListTable
                      tableZoom={planZoom}
                      data={plannedOrdenes.filter(order => {
                        // 1. Check if fully finalized (exclude)
                        const allFinalized = order.procesos && order.procesos.length > 0 && order.procesos.every(p => p.estado_proceso.id === 3);
                        if (allFinalized) return false;

                        // 2. Determine Reference Date.
                        //    Prioridad: customRefDate (calendar override) > lote del dropdown > hoy.
                        let referenceDate = new Date();
                        if (customRefDate) {
                          referenceDate = customRefDate;
                        } else if (selectedLoteId !== "all") {
                          const lote = uniqueLotes.find(l => l.id === selectedLoteId);
                          if (lote) referenceDate = new Date(lote.date);
                        }

                        // 3. Calculate Week Range (Monday to Sunday)
                        const getWeekRange = (d: Date) => {
                          const date = new Date(d);
                          const day = date.getDay(); // 0 (Sun) to 6 (Sat)
                          const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
                          const monday = new Date(date.setDate(diff));
                          monday.setHours(0, 0, 0, 0);

                          const sunday = new Date(monday);
                          sunday.setDate(monday.getDate() + 6);
                          sunday.setHours(23, 59, 59, 999);

                          return { start: monday, end: sunday };
                        };

                        const { start, end } = getWeekRange(referenceDate);

                        // 4. Check if any process in this order is scheduled for this week.
                        //    Calculamos la fecha real a partir de creado_en + inicio_min
                        //    (minutos hábiles desde las 9:00 del día de creación del plan).
                        const orderProcesses = filteredPlanificacion.filter(p => p.orden_id === order.id);
                        if (orderProcesses.length === 0) return false;

                        return orderProcesses.some(p => {
                          if (!p.creado_en || typeof p.inicio_min !== 'number') return false;
                          const baseDate = new Date(p.creado_en);
                          baseDate.setHours(9, 0, 0, 0);
                          const pDate = addWorkMinutes(baseDate, p.inicio_min);
                          return pDate >= start && pDate <= end;
                        });
                      })}
                      isLoading={isLoading}
                      onProcessStatusChange={handleProcessStatusChange}
                      onProcessReorder={handleProcessReorder}
                      onOperatorChange={(ordenId, procesoId, operarioId) => handleOperatorChange(operarioId.toString(), rawPlanificacion.find(p => p.orden_id === ordenId && p.proceso_id === procesoId)?.id.toString())}
                      onMachineryChange={handleMachineryChange}
                      operarios={rawOperarios}
                      maquinarias={rawMaquinarias}
                      planificacion={rawPlanificacion} // Pass full planificacion for lookup
                      onRowClick={(item) => {
                        console.log("Clicked order:", item);
                      }}
                      onDataChange={fetchData}
                    />
                  </TabsContent>

                  <TabsContent value="diaria" className="m-0 h-full px-4 py-4 sm:px-6 sm:py-6">
                    {/* Daily: mismo bug que Semanal — usaba `fecha_inicio_estimada` que no
                        existe. Acá calculamos pStart con `creado_en + inicio_min` y pEnd con
                        `creado_en + fin_min` (o fallback a `inicio_min`). */}
                    {/* Banner Diaria — mismo lenguaje visual que Semanal. Muestra el día
                        en grande (día de la semana + fecha) con badge de origen. */}
                    {(() => {
                      let refDate = new Date();
                      let badgeText = "Hoy";
                      // Misma paleta que el banner Semanal — consistencia visual.
                      let badgeColor = "bg-teal-50 text-teal-700 ring-teal-200/80";
                      let badgeDot = "bg-teal-500";
                      if (customRefDate) {
                        refDate = customRefDate;
                        const isToday = refDate.toDateString() === new Date().toDateString();
                        if (!isToday) {
                          badgeText = "Fecha personalizada";
                          badgeColor = "bg-amber-50 text-amber-800 ring-amber-200/80";
                          badgeDot = "bg-amber-500";
                        }
                      } else if (selectedLoteId !== "all") {
                        const lote = uniqueLotes.find(l => l.id === selectedLoteId);
                        if (lote) {
                          refDate = new Date(lote.date);
                          badgeText = "Según lote";
                          badgeColor = "bg-indigo-50 text-indigo-700 ring-indigo-200/80";
                          badgeDot = "bg-indigo-500";
                        }
                      }
                      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
                      const diaSemana = capitalize(format(refDate, "EEEE", { locale: es }));
                      const fechaCompleta = format(refDate, "d 'de' MMMM, yyyy", { locale: es });
                      // Detectar si la fecha de referencia coincide con algún día que tiene OTs.
                      const refKey = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}-${String(refDate.getDate()).padStart(2, '0')}`;
                      const tieneOTs = plannedDates.has(refKey);

                      return (
                        <div className="mb-5 rounded-xl border border-red-100/80 bg-gradient-to-br from-white via-rose-50/40 to-red-50/30 shadow-sm">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5">
                            {/* Icono + Info principal */}
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              <div className="shrink-0 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#DC143C] to-[#B01030] shadow-md shadow-red-500/25 ring-1 ring-white/20">
                                <CalendarClock className="h-6 w-6 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-red-900/60">
                                  Día visualizado
                                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${badgeColor}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${badgeDot}`} />
                                    {badgeText}
                                  </span>
                                  {tieneOTs && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200/80">
                                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                                      Con OTs planificadas
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 text-lg sm:text-xl font-bold text-slate-900 leading-tight tracking-tight">
                                  {diaSemana}
                                  <span className="ml-2 text-slate-500 font-medium">{fechaCompleta}</span>
                                </div>
                              </div>
                            </div>

                            {/* Acciones */}
                            <div className="flex items-center gap-2 shrink-0">
                              {customRefDate && (
                                <button
                                  onClick={() => setCustomRefDate(null)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 hover:border-red-300 transition-colors"
                                >
                                  Volver a hoy
                                </button>
                              )}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#DC143C] to-[#B01030] px-4 py-2 text-xs font-semibold text-white shadow-md shadow-red-500/20 hover:shadow-lg hover:shadow-red-500/30 hover:brightness-110 active:scale-[0.98] transition-all">
                                    <CalendarClock className="h-3.5 w-3.5" />
                                    Cambiar fecha
                                    <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 border-red-100 shadow-xl shadow-red-500/10" align="end">
                                  <div className="border-b border-red-100 bg-gradient-to-r from-rose-50 to-red-50 px-4 py-2.5">
                                    <p className="text-xs font-semibold text-red-900">Elegí una fecha</p>
                                    <p className="text-[10px] text-red-700/70 mt-0.5">Los días con un punto tienen OTs planificadas</p>
                                  </div>
                                  <CalendarPicker
                                    mode="single"
                                    selected={refDate}
                                    onSelect={(d) => d && setCustomRefDate(d)}
                                    modifiers={{ hasPlan: plannedDateObjects }}
                                    modifiersClassNames={{
                                      hasPlan: "relative font-bold text-[#DC143C] after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:bg-[#DC143C] after:rounded-full",
                                    }}
                                    locale={es}
                                  />
                                  <div className="border-t border-red-100 bg-rose-50/40 px-3 py-2 text-[11px] text-red-900/80 flex items-center gap-2">
                                    <span className="h-1.5 w-1.5 rounded-full bg-[#DC143C]" />
                                    Días con OTs planificadas
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    <PlanningListTable
                      tableZoom={planZoom}
                      data={plannedOrdenes.filter(order => {
                        // 1. Check if fully finalized (exclude)
                        const allFinalized = order.procesos && order.procesos.length > 0 && order.procesos.every(p => p.estado_proceso.id === 3);
                        if (allFinalized) return false;

                        // 2. Determine Reference Date.
                        //    Prioridad: customRefDate (calendar override) > lote del dropdown > hoy.
                        let referenceDate = new Date();
                        if (customRefDate) {
                          referenceDate = customRefDate;
                        } else if (selectedLoteId !== "all") {
                          const lote = uniqueLotes.find(l => l.id === selectedLoteId);
                          if (lote) referenceDate = new Date(lote.date);
                        }

                        // 3. Check if any process in this order overlaps with reference day.
                        const orderProcesses = filteredPlanificacion.filter(p => p.orden_id === order.id);
                        if (orderProcesses.length === 0) return false;

                        const startOfDay = new Date(referenceDate);
                        startOfDay.setHours(0, 0, 0, 0);
                        const endOfDay = new Date(referenceDate);
                        endOfDay.setHours(23, 59, 59, 999);

                        return orderProcesses.some(p => {
                          if (!p.creado_en || typeof p.inicio_min !== 'number') return false;
                          const baseDate = new Date(p.creado_en);
                          baseDate.setHours(9, 0, 0, 0);
                          const pStart = addWorkMinutes(baseDate, p.inicio_min);
                          const finMinutes = (typeof p.fin_min === 'number' && p.fin_min > p.inicio_min)
                            ? p.fin_min
                            : p.inicio_min;
                          const pEnd = addWorkMinutes(baseDate, finMinutes);

                          // Overlap: Task Start <= Day End AND Task End >= Day Start
                          return pStart <= endOfDay && pEnd >= startOfDay;
                        });
                      })}
                      isLoading={isLoading}
                      onProcessStatusChange={handleProcessStatusChange}
                      onProcessReorder={handleProcessReorder}
                      onOperatorChange={(ordenId, procesoId, operarioId) => handleOperatorChange(operarioId.toString(), rawPlanificacion.find(p => p.orden_id === ordenId && p.proceso_id === procesoId)?.id.toString())}
                      onMachineryChange={handleMachineryChange}
                      operarios={rawOperarios}
                      maquinarias={rawMaquinarias}
                      planificacion={rawPlanificacion}
                      onRowClick={(item) => {
                        console.log("Clicked order:", item);
                      }}
                      onDataChange={fetchData}
                    />
                  </TabsContent>

                  <TabsContent value="finalizadas" className="m-0 h-full px-4 py-4 sm:px-6 sm:py-6">
                    {/* Finalizadas: Filter where ALL processes are status 3 (Finalizado) */}
                    <PlanningListTable
                      tableZoom={planZoom}
                      data={plannedOrdenes.filter(order => {
                        // Check if order has processes and ALL are status 3
                        return order.procesos && order.procesos.length > 0 && order.procesos.every(p => p.estado_proceso.id === 3);
                      })}
                      isLoading={isLoading}
                      onProcessStatusChange={handleProcessStatusChange}
                      onProcessReorder={handleProcessReorder}
                      onOperatorChange={(ordenId, procesoId, operarioId) => handleOperatorChange(operarioId.toString(), rawPlanificacion.find(p => p.orden_id === ordenId && p.proceso_id === procesoId)?.id.toString())}
                      operarios={rawOperarios}
                      planificacion={rawPlanificacion}
                      onRowClick={(item) => {
                        console.log("Clicked order:", item);
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="carga" className="m-0 h-full px-4 py-4 sm:px-6 sm:py-6">
                    <OperatorLoadTab
                      planificacion={filteredPlanificacion}
                      operarios={rawOperarios}
                      ordenes={ordenesTrabajo}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            )}

            {/* Sección de Órdenes No Planificadas */}
          </div>
        </div>
      </div>

      {/* Sidebar rendered as Fixed Sidebar (Full Height) */}
      <div className={"fixed inset-y-0 right-0 w-[400px] bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-[60] " + ((isDetailsPanelOpen && (activeTab === 'gantt' || activeTab === 'lista_planificacion')) ? 'translate-x-0' : 'translate-x-full')}>
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
        onClose={() => {
          setIsCreateModalOpen(false)
          setOrderToEdit(null)
        }}
        onSuccess={() => {
          setIsCreateModalOpen(false)
          setOrderToEdit(null)
          fetchData()
          setRefreshTrigger(prev => prev + 1)
        }}
        orderToEdit={orderToEdit}
      />


      <PlanningSelectionModal
        isOpen={isSelectionModalOpen}
        onClose={() => setIsSelectionModalOpen(false)}
        unplannedOrders={ordersForPlanning}
        onPlan={handlePlanSelection}
        isLoading={false}
        onDataRefresh={fetchData}
        initialSelectedIds={isReplanning ? plannedOrdenes.map(o => o.id) : []}
        autoSelectAll={!isReplanning}
        availableOperarios={rawOperarios}
      />
      <AvailabilityConfigModal
        isOpen={isAvailabilityModalOpen}
        onClose={() => setIsAvailabilityModalOpen(false)}
      />

      <PlanningPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        onBack={() => {
          setIsPreviewOpen(false);
          setIsSelectionModalOpen(true);
        }}
        onConfirm={handleConfirmPlan}
        results={previewResults}
        excedentes={excedentesResults}
        operatorLoads={operatorLoads}
        isConfirming={isConfirmingPlan}
        availableOperators={rawOperarios}
        availableMachines={rawMaquinarias}
        unplannedOrders={ordersForPlanning}
        selectedOrderIds={selectedOrderIds}
        planningRange={planningRange}
        onRecalculate={handleRecalculatePreview}
        isCalculating={isPreviewCalculating}
      />
      {activeTab === "lista_planificacion" && (
        <ConfirmationDialog
          isOpen={isStatusConfirmOpen}
          onClose={() => setIsStatusConfirmOpen(false)}
          onConfirm={confirmStatusChange}
          title="¿Revertir proceso finalizado?"
          description="El proceso ya está finalizado. Si lo vuelve a pendiente, se perderá la fecha de finalización. ¿Está seguro?"
          confirmText="Sí, revertir"
          cancelText="Cancelar"
          variant="destructive"
        />
      )}
      <ConfirmationDialog
        isOpen={isDeleteLoteDialogOpen}
        onClose={() => setIsDeleteLoteDialogOpen(false)}
        onConfirm={handleDeleteLote}
        title="¿Eliminar lote de planificación?"
        description="Esta acción eliminará permanentemente todos los registros de esta planificación. Las órdenes volverán a estar disponibles para planificar. ¿Está seguro?"
        confirmText={isDeletingLote ? "Eliminando..." : "Sí, eliminar"}
        cancelText="Cancelar"
        variant="destructive"
      />

      {/* Operator Detail Modal */}
      {selectedOperatorForModal && (
        <DetalleOperario
          operario={selectedOperatorForModal}
          tasks={operatorTasks}
          onClose={() => setSelectedOperatorForModal(null)}
          onCambiarEstado={(op: Operario) => {
            // We can allow state change here too
            setIsCambiarEstadoOpen(true);
          }}
          onOperatorUpdated={() => {
            fetchData(); // Refetch global data to update status
          }}
        />
      )}

      {/* Change Status Modal */}
      {isCambiarEstadoOpen && selectedOperatorForModal && (
        <CambiarEstado
          operario={selectedOperatorForModal}
          open={isCambiarEstadoOpen}
          onClose={() => setIsCambiarEstadoOpen(false)}
          onSuccess={async () => {
            await fetchData();
            setIsCambiarEstadoOpen(false);
            // Update selected operator in modal if it changed (e.g. status)
            // Since rawOperarios updates, we might need to find it again to pass fresh data
            // But fetchData updates rawOperarios, and selectedOperatorForModal is a stale copy.
            // We should update selectedOperatorForModal based on new data.
            // Done effectively by re-rendering if we derived it, but we use state.
            // We can rely on DetalleOperario just showing what it has,
            // but status badge might be stale inside DetalleOperario until closed/reopened.
            // Let's try to update the local selected state
            // const updatedOp = rawOperarios.find(o => o.id === selectedOperatorForModal.id);
            // if (updatedOp) setSelectedOperatorForModal(updatedOp);
            // We can't easily access the *new* rawOperarios here immediately after await fetchData if it's async state update.
            // For now, closing and reopening is fine, or just let it be.
          }}
          cleanUrl={API_URL}
        />
      )}

    </div>
  )
}


