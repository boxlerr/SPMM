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
    const [tasks, setTasks] = useState<GanttTask[]>(() => convertPlanificacionToGanttTasks(planificacion));

    useEffect(() => {
        setRawPlanificacion(planificacion);
        setTasks(convertPlanificacionToGanttTasks(planificacion));
    }, [planificacion]);

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
            await fetch(`${API_URL}/planificacion/${selectedTask.id}`, {
                method: "PUT",
                headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                body: JSON.stringify({ id_operario: opId }),
            });
        } catch (error) {
            console.error("Error updating operator:", error);
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
            await fetch(`${API_URL}/planificacion/${selectedTask.id}`, {
                method: "PUT",
                headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                body: JSON.stringify({ id_maquinaria: machineId }),
            });
        } catch (error) {
            console.error("Error updating machinery:", error);
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
            await fetch(`${API_URL}/ordenes/${selectedTask.orden_id}/procesos/${selectedTask.proceso_id}/estado`, {
                method: "PUT",
                headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                body: JSON.stringify({ id_estado: idEstado }),
            });
        } catch (error) {
            console.error("Error updating status:", error);
        }
    };

    const handleProcessReorder = async (ordenId: number, orderedTasks: GanttTask[]) => {
        // Cada task queda con orden = idx + 1.
        const updates = orderedTasks
            .filter(t => t.dbId !== undefined)
            .map((t, idx) => ({ dbId: t.dbId!, newOrden: idx + 1 }));

        // Optimistic: actualizo orden en los tasks visibles y en rawPlanificacion (secuencia).
        setTasks(prev => prev.map(t => {
            const u = updates.find(x => x.dbId === t.dbId);
            return u ? { ...t, orden: u.newOrden } : t;
        }));
        setRawPlanificacion(prev => prev.map(p => {
            const u = updates.find(x => x.dbId === p.id);
            return u ? { ...p, secuencia: u.newOrden } : p;
        }));

        // Construyo el payload con id_proceso (no el id de planificación).
        const ordenes = orderedTasks
            .map((t, idx) => {
                const planItem = rawPlanificacion.find(p => p.id === t.dbId);
                return planItem ? { id_proceso: planItem.proceso_id, orden: idx + 1 } : null;
            })
            .filter((x): x is { id_proceso: number; orden: number } => x !== null);

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
        for (const task of tasksToUpdate) {
            const item = rawPlanificacion.find(p => p.id === task.dbId);
            if (item) {
                try {
                    await fetch(`${API_URL}/ordenes/${item.orden_id}/procesos/${item.proceso_id}/estado`, {
                        method: "PUT",
                        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                        body: JSON.stringify({ id_estado: idEstado }),
                    });
                } catch (error) {
                    console.error(`Error updating task ${task.id}:`, error);
                }
            }
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
        </div>
    );
}
