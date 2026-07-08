import React, { useEffect, useState } from "react";
import { GanttWorkOrdersList } from "./gantt/gantt-work-orders-list";
import { convertPlanificacionToGanttTasks } from "@/lib/gantt-utils";
import type { GanttTask, PlanificacionItem, WorkOrder } from "@/lib/types";
import TaskDetailsModal from "./gantt/TaskDetailsModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnplannedWorkOrdersList } from "./UnplannedWorkOrdersList";
import { CompletedWorkOrdersList } from "./CompletedWorkOrdersList";
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ZoomControl, usePersistedZoom } from "@/components/ui/zoom-control";
import { API_URL } from "@/config";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

interface WorkOrdersListWrapperProps {
    refreshTrigger?: number;
    /** OTs ya cargadas por la página padre. Evita refetch duplicado de /ordenes. */
    orders: WorkOrder[];
    /** Planificación cargada por el padre. Inicializa el state local que permite optimistic updates. */
    planificacion: PlanificacionItem[];
    /** Operarios cargados por el padre, usados en el modal de detalles. */
    operarios: any[];
    /** Maquinarias cargadas por el padre, usadas en el modal de detalles. */
    maquinarias?: any[];
    /** Callback para pedirle al padre que vuelva a cargar todos los datos
     *  (después de crear/editar/eliminar OTs o de cambios masivos). */
    onRefresh?: () => void;
}

export default function WorkOrdersListWrapper({
    refreshTrigger = 0,
    orders,
    planificacion,
    operarios,
    maquinarias = [],
    onRefresh,
}: WorkOrdersListWrapperProps) {
    // State local para permitir optimistic updates (cambio de operario, estado, etc.)
    // sin tener que esperar el round-trip al backend. Se re-sincroniza desde props
    // cuando el padre vuelve a fetchear.
    const [rawPlanificacion, setRawPlanificacion] = useState<PlanificacionItem[]>(planificacion);

    // Mezcla tasks "reales" (con entrada en planificacion) + placeholders para procesos
    // de OTs planificadas que están en orden_trabajo_proceso pero no tienen planificación
    // todavía (típicamente, procesos agregados a mano después de planificar la OT).
    const buildTasks = (plan: PlanificacionItem[], ords: WorkOrder[]): GanttTask[] => {
        const planned = convertPlanificacionToGanttTasks(plan);
        const plannedOrderIds = new Set(plan.map(p => p.orden_id));
        const unplanned: GanttTask[] = [];
        for (const order of ords) {
            if (!plannedOrderIds.has(order.id) || !order.procesos) continue;
            const plannedProcessIds = new Set(
                plan.filter(p => p.orden_id === order.id).map(p => p.proceso_id)
            );
            for (const proc of order.procesos) {
                if (plannedProcessIds.has(proc.proceso.id)) continue;
                unplanned.push({
                    id: `unplanned-${order.id}-${proc.proceso.id}`,
                    workOrderId: order.id,
                    workOrderNumber: order.id_otvieja?.toString() || order.id.toString(),
                    resourceId: 'unassigned',
                    resourceName: proc.operario_nombre || 'Sin Asignar',
                    resourceType: 'operario',
                    process: proc.proceso?.nombre || '',
                    startDate: '',
                    endDate: '',
                    startTime: '',
                    endTime: '',
                    duration: (proc.tiempo_proceso || 0) / 60,
                    priority: 'normal',
                    status: (proc.estado_proceso?.id === 3 ? 'finalizado_total' :
                             proc.estado_proceso?.id === 2 ? 'en_proceso' : 'nuevo') as any,
                    progress: proc.estado_proceso?.id === 3 ? 100 :
                              proc.estado_proceso?.id === 2 ? 50 : 0,
                    client: order.cliente?.nombre,
                    isDelayed: false,
                    orden: proc.orden,
                    procesoId: proc.proceso?.id,
                    isUnplanned: true,
                    notes: order.observaciones || order.detalle || '',
                    quantity: order.unidades,
                    cantidad_entregada: order.cantidad_entregada,
                });
            }
        }
        return [...planned, ...unplanned];
    };

    const [tasks, setTasks] = useState<GanttTask[]>(() => buildTasks(planificacion, orders));

    useEffect(() => {
        setRawPlanificacion(planificacion);
        setTasks(buildTasks(planificacion, orders));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planificacion, orders]);

    const [selectedTask, setSelectedTask] = useState<PlanificacionItem | null>(null);
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

    // Zoom compartido con la sección de Planificación (misma key en localStorage).
    const [zoom, setZoom] = usePersistedZoom('plan_zoom', 100);

    // Edit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [orderToEdit, setOrderToEdit] = useState<WorkOrder | null>(null);

    // Delete Confirmation State
    const [deleteOrderId, setDeleteOrderId] = useState<number | null>(null);


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

    // El fetch de /ordenes, /planificacion y /operarios ya no vive acá:
    // la página padre (OperacionesPage) los carga UNA VEZ y los pasa por props.
    // Esto eliminó ~5 requests duplicadas a /ordenes por cada navegación a este tab.
    // Cuando algo cambia (crear/editar/eliminar OT), llamamos a `onRefresh?.()` para
    // que el padre re-fetchee y el nuevo `planificacion` baje por prop al state local.

    // Dispara un refresh externo cuando cambia el trigger (creación de OT desde el header).
    useEffect(() => {
        if (refreshTrigger > 0) onRefresh?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshTrigger]);

    const handleTaskClick = (task: GanttTask) => {
        const originalItem = rawPlanificacion.find(p => p.id === task.dbId);
        if (originalItem) {
            setSelectedTask(originalItem);
            setIsDetailsPanelOpen(true);
        }
    };

    // Confirmación de delete
    const [taskToDelete, setTaskToDelete] = useState<GanttTask | null>(null);

    const handleRequestDeleteTask = (task: GanttTask) => {
        setTaskToDelete(task);
    };

    const confirmDeleteTask = async () => {
        if (!taskToDelete || taskToDelete.procesoId === undefined) {
            setTaskToDelete(null);
            return;
        }
        const ordenId = taskToDelete.workOrderId;
        const procesoId = taskToDelete.procesoId;
        const taskId = taskToDelete.id;
        const planId = taskToDelete.dbId;
        // Optimistic: saco de tasks y de rawPlanificacion.
        setTasks(prev => prev.filter(t => t.id !== taskId));
        if (planId !== undefined) {
            setRawPlanificacion(prev => prev.filter(p => p.id !== planId));
        }
        setTaskToDelete(null);
        try {
            const res = await fetch(`${API_URL}/ordenes/${ordenId}/procesos/${procesoId}`, {
                method: "DELETE",
                headers: getAuthHeaders(),
            });
            if (!res.ok) {
                let errMsg = "Error al eliminar el proceso";
                try {
                    const body = await res.json();
                    errMsg = body?.errors?.[0]?.message || errMsg;
                } catch {}
                throw new Error(errMsg);
            }
            toast.success("Proceso eliminado");
        } catch (error: any) {
            console.error("Error deleting process:", error);
            toast.error(error?.message || "Error al eliminar el proceso");
            onRefresh?.();
        }
    };

    // ... existing handlers (handleOperatorChange, handleStatusChange, etc.) ...
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
            const res = await fetch(`${API_URL}/planificacion/${selectedTask.id}`, {
                method: "PUT",
                headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                body: JSON.stringify({ id_operario: opId }),
            });
            if (!res.ok) throw new Error("save failed");
        } catch (error) {
            console.error("Error updating operator:", error);
            toast.error("No se pudo guardar el cambio de operario. Se revirtió; revisá la conexión e intentá de nuevo.");
            onRefresh?.();
        }
    };

    const handleMachineryChange = async (newMachineId: string) => {
        if (!selectedTask) return;
        const machineId = parseInt(newMachineId);
        // El select usa "0" para "Sin asignar" → guardamos undefined en el state local
        // y el backend interpreta 0 como NULL.
        const normalizedId = machineId === 0 ? undefined : machineId;
        const machine = maquinarias.find(m => m.id === machineId);
        const updatedItem = {
            ...selectedTask,
            id_maquinaria: normalizedId,
            nombre_maquinaria: machine?.nombre,
        };
        setSelectedTask(updatedItem);
        setRawPlanificacion(prev => prev.map(p => p.id === selectedTask.id ? updatedItem : p));
        setTasks(prev => prev.map(t => {
            if (t.dbId === selectedTask.id) {
                return { ...t, machineId: normalizedId, machineName: machine?.nombre };
            }
            return t;
        }));
        try {
            const res = await fetch(`${API_URL}/planificacion/${selectedTask.id}`, {
                method: "PUT",
                headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                body: JSON.stringify({ id_maquinaria: machineId }),
            });
            if (!res.ok) throw new Error("save failed");
        } catch (error) {
            console.error("Error updating machinery:", error);
            toast.error("No se pudo guardar el cambio de máquina. Se revirtió; revisá la conexión e intentá de nuevo.");
            onRefresh?.();
        }
    };

    const handleStatusChange = async (newStatusId: string) => {
        if (!selectedTask) return;
        const idEstado = parseInt(newStatusId);
        let statusString = 'pendiente';
        if (idEstado === 2) statusString = 'en_curso';
        if (idEstado === 3) statusString = 'completado';
        const updatedItem = { ...selectedTask, id_estado: idEstado, estado: statusString };
        setSelectedTask(updatedItem);
        setRawPlanificacion(prev => prev.map(p => p.id === selectedTask.id ? updatedItem : p));
        setTasks(prev => prev.map(t => {
            if (t.dbId === selectedTask.id) {
                let mappedStatus: any = 'nuevo';
                if (idEstado === 2) mappedStatus = 'en_proceso';
                else if (idEstado === 3) mappedStatus = 'finalizado_total';
                else if (idEstado === 1) mappedStatus = 'nuevo';
                return { ...t, status: mappedStatus };
            }
            return t;
        }));
        try {
            const res = await fetch(`${API_URL}/ordenes/${selectedTask.orden_id}/procesos/${selectedTask.proceso_id}/estado`, {
                method: "PUT",
                headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                body: JSON.stringify({ id_estado: idEstado }),
            });
            if (!res.ok) throw new Error("save failed");
        } catch (error) {
            console.error("Error updating status:", error);
            toast.error("No se pudo guardar el cambio de estado. Se revirtió; revisá la conexión e intentá de nuevo.");
            onRefresh?.();
        }
    };

    const handleProcessReorder = async (ordenId: number, orderedTasks: GanttTask[]) => {
        // Construyo el payload usando procesoId directo (sirve para planificados y no planificados).
        const ordenes = orderedTasks
            .map((t, idx) => t.procesoId !== undefined ? { id_proceso: t.procesoId, orden: idx + 1 } : null)
            .filter((x): x is { id_proceso: number; orden: number } => x !== null);

        // Optimistic: actualizo orden en tasks (por procesoId) y secuencia en rawPlanificacion.
        const ordenByProcId = new Map(ordenes.map(o => [o.id_proceso, o.orden]));
        setTasks(prev => prev.map(t => {
            if (t.workOrderId !== ordenId || t.procesoId === undefined) return t;
            const newOrden = ordenByProcId.get(t.procesoId);
            return newOrden !== undefined ? { ...t, orden: newOrden } : t;
        }));
        setRawPlanificacion(prev => prev.map(p => {
            if (p.orden_id !== ordenId) return p;
            const newOrden = ordenByProcId.get(p.proceso_id);
            return newOrden !== undefined ? { ...p, secuencia: newOrden } : p;
        }));

        try {
            const res = await fetch(`${API_URL}/ordenes/${ordenId}/procesos/reorder`, {
                method: "PUT",
                headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                body: JSON.stringify({ ordenes }),
            });
            if (!res.ok) throw new Error("reorder failed");
        } catch (error) {
            console.error("Error reordering processes:", error);
            toast.error("Error al reordenar procesos");
            onRefresh?.();
        }
    };

    const handleBulkStatusChange = async (taskIds: string[], newStatus: string) => {
        let idEstado = 1;
        if (newStatus === 'en_proceso') idEstado = 2;
        if (newStatus === 'finalizado_total') idEstado = 3;
        const tasksToUpdate = tasks.filter(t => taskIds.includes(t.id));
        setTasks(prev => prev.map(t => {
            if (taskIds.includes(t.id)) {
                return { ...t, status: newStatus as any };
            }
            return t;
        }));
        setRawPlanificacion(prev => prev.map(p => {
            const task = tasksToUpdate.find(t => t.dbId === p.id);
            if (task) {
                return { ...p, id_estado: idEstado, estado: newStatus === 'finalizado_total' ? 'completado' : 'pendiente' };
            }
            return p;
        }));
        let algunErrorBulk = false;
        for (const task of tasksToUpdate) {
            const item = rawPlanificacion.find(p => p.id === task.dbId);
            if (item) {
                try {
                    const res = await fetch(`${API_URL}/ordenes/${item.orden_id}/procesos/${item.proceso_id}/estado`, {
                        method: "PUT",
                        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                        body: JSON.stringify({ id_estado: idEstado }),
                    });
                    if (!res.ok) throw new Error("save failed");
                } catch (error) {
                    console.error(`Error updating task ${task.id}:`, error);
                    algunErrorBulk = true;
                }
            }
        }
        if (algunErrorBulk) {
            toast.error("No se pudieron guardar algunos cambios de estado. Se revirtieron; revisá la conexión e intentá de nuevo.");
            onRefresh?.();
        }
    };

    // Filter Logic
    // Planned = Exists in Planificacion table AND not completed
    const plannedOrderIds = new Set(rawPlanificacion.map(p => p.orden_id));

    const plannedOrders = orders.filter(o => plannedOrderIds.has(o.id) && !o.finalizadototal);
    const unplannedOrders = orders.filter(o => !plannedOrderIds.has(o.id) && !o.finalizadototal);
    const completedOrders = orders.filter(o => o.finalizadototal);

    const handleEditOrder = (order: WorkOrder) => {
        setOrderToEdit(order);
        setIsEditModalOpen(true);
    };

    const handleEditSuccess = () => {
        onRefresh?.();
    };

    const handleDeleteOrder = (id: number) => {
        setDeleteOrderId(id);
    };

    const confirmDelete = async () => {
        if (!deleteOrderId) return;

        try {
            const response = await fetch(`${API_URL}/ordenes/${deleteOrderId}`, {
                method: "DELETE",
                headers: getAuthHeaders()
            });

            if (!response.ok) throw new Error("Error al eliminar");

            toast.success("Orden eliminada correctamente");
            onRefresh?.();
        } catch (error) {
            console.error("Error deleting order:", error);
            toast.error("Error al eliminar la orden");
        } finally {
            setDeleteOrderId(null);
        }
    };

    return (
        <div className="relative">
            <Tabs defaultValue="planificadas" className="w-full">
                {/* Cabecera: tabs + ZoomControl alineado a la derecha. El zoom solo
                    aplica a No Planificadas e Historial (las listas tabulares); el
                    tab Planificadas usa Gantt con su propia escala y no debe escalarse. */}
                <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
                    <TabsList className="bg-gray-100 p-1 rounded-xl w-fit">
                        <TabsTrigger value="planificadas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm">
                            Planificadas ({plannedOrders.length})
                        </TabsTrigger>
                        <TabsTrigger value="no_planificadas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-orange-600 data-[state=active]:shadow-sm">
                            No Planificadas ({unplannedOrders.length})
                        </TabsTrigger>
                        <TabsTrigger value="historial" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-green-700 data-[state=active]:shadow-sm">
                            Historial ({completedOrders.length})
                        </TabsTrigger>
                    </TabsList>
                    <ZoomControl value={zoom} onChange={setZoom} />
                </div>

                <TabsContent value="planificadas" className="mt-0">
                    <GanttWorkOrdersList
                        tasks={tasks}
                        onTaskClick={handleTaskClick}
                        onBulkStatusChange={handleBulkStatusChange}
                        onProcessReorder={handleProcessReorder}
                        onTaskDelete={handleRequestDeleteTask}
                        onDataRefresh={onRefresh}
                    />
                </TabsContent>

                <TabsContent value="no_planificadas" className="mt-0">
                    {/* El zoom va como prop para que el componente lo aplique SOLO a la
                        tabla, no al header (icono + buscador) ni a los filtros. */}
                    <UnplannedWorkOrdersList
                        orders={unplannedOrders}
                        onEdit={handleEditOrder}
                        onDelete={handleDeleteOrder}
                        onDataChange={onRefresh}
                        tableZoom={zoom}
                    />
                </TabsContent>

                <TabsContent value="historial" className="mt-0">
                    <CompletedWorkOrdersList
                        orders={completedOrders}
                        onEdit={handleEditOrder}
                        tableZoom={zoom}
                    />
                </TabsContent>
            </Tabs>

            <TaskDetailsModal
                isOpen={isDetailsPanelOpen}
                selectedItem={selectedTask}
                onClose={() => setIsDetailsPanelOpen(false)}
                getProcessColor={getProcessColor}
                operarios={operarios}
                maquinarias={maquinarias}
                onOperatorChange={handleOperatorChange}
                onMachineryChange={handleMachineryChange}
                onStatusChange={handleStatusChange}
            />

            <CreateWorkOrderModal
                isOpen={isEditModalOpen}
                onClose={() => {
                    setIsEditModalOpen(false);
                    setOrderToEdit(null);
                }}
                onSuccess={handleEditSuccess}
                orderToEdit={orderToEdit}
            />
            <ConfirmationDialog
                isOpen={!!deleteOrderId}
                onClose={() => setDeleteOrderId(null)}
                onConfirm={confirmDelete}
                title="Eliminar Orden de Trabajo"
                description="¿Estás seguro de que deseas eliminar esta orden? Esta acción eliminará permanentemente la orden, sus procesos, archivos y planificaciones asociadas. Esta acción no se puede deshacer."
                confirmText="Eliminar"
                cancelText="Cancelar"
                variant="destructive"
            />
            <ConfirmationDialog
                isOpen={!!taskToDelete}
                onClose={() => setTaskToDelete(null)}
                onConfirm={confirmDeleteTask}
                title="Eliminar proceso"
                description={
                    taskToDelete
                        ? `¿Eliminar "${taskToDelete.process}" de la OT? Si tenía planificación, también se borrará. Esta acción no se puede deshacer.`
                        : ""
                }
                confirmText="Eliminar"
                cancelText="Cancelar"
                variant="destructive"
            />
        </div>
    );
}
