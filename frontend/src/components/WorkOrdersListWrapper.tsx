import React, { useEffect, useState } from "react";
import { GanttWorkOrdersList } from "./gantt/gantt-work-orders-list";
import { convertPlanificacionToGanttTasks } from "@/lib/gantt-utils";
import type { GanttTask, PlanificacionItem, WorkOrder } from "@/lib/types";
import TaskDetailsModal from "./gantt/TaskDetailsModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnplannedWorkOrdersList } from "./UnplannedWorkOrdersList";
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { API_URL } from "@/config";

interface WorkOrdersListWrapperProps {
    refreshTrigger?: number;
}

export default function WorkOrdersListWrapper({ refreshTrigger = 0 }: WorkOrdersListWrapperProps) {
    const [tasks, setTasks] = useState<GanttTask[]>([]);
    const [loading, setLoading] = useState(true);
    // rawPlanificacion is mainly for task details mapping
    const [rawPlanificacion, setRawPlanificacion] = useState<PlanificacionItem[]>([]);
    const [rawOperarios, setRawOperarios] = useState<any[]>([]);
    const [selectedTask, setSelectedTask] = useState<PlanificacionItem | null>(null);
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

    // New state for Unplanned orders split
    const [allOrders, setAllOrders] = useState<WorkOrder[]>([]);

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

    const fetchData = async () => {
        try {
            setLoading(true);

            const [planResponse, ordenesResponse, opResponse] = await Promise.all([
                fetch(`${API_URL}/planificacion`),
                fetch(`${API_URL}/ordenes`),
                fetch(`${API_URL}/operarios`)
            ]);

            // 1. Process Planificacion
            if (planResponse.ok) {
                const planData: PlanificacionItem[] = await planResponse.json();
                setRawPlanificacion(planData);
                const ganttTasks = convertPlanificacionToGanttTasks(planData);
                setTasks(ganttTasks);
            } else {
                console.error("Error fetching planificacion");
            }

            // 2. Process Orders
            if (ordenesResponse.ok) {
                const ordenesData = await ordenesResponse.json();
                const ordenesList = Array.isArray(ordenesData) ? ordenesData : (ordenesData.data || []);
                setAllOrders(ordenesList);
            }

            // 3. Process Operarios
            if (opResponse.ok) {
                const opData = await opResponse.json();
                const rawOps = Array.isArray(opData.data) ? opData.data : (Array.isArray(opData) ? opData : []);
                setRawOperarios(rawOps);
            }

        } catch (error) {
            console.error("Error loading Work Orders data:", error);
            toast.error("Error al cargar datos");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
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
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_operario: opId }),
            });
        } catch (error) {
            console.error("Error updating operator:", error);
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
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_estado: idEstado }),
            });
        } catch (error) {
            console.error("Error updating status:", error);
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
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id_estado: idEstado }),
                    });
                } catch (error) {
                    console.error(`Error updating task ${task.id}:`, error);
                }
            }
        }
    };

    // Filter Logic
    // Planned = Exists in Planificacion table
    const plannedOrderIds = new Set(rawPlanificacion.map(p => p.orden_id));

    const plannedOrders = allOrders.filter(o => plannedOrderIds.has(o.id));
    const unplannedOrders = allOrders.filter(o => !plannedOrderIds.has(o.id));

    const handleEditOrder = (order: WorkOrder) => {
        setOrderToEdit(order);
        setIsEditModalOpen(true);
    };

    const handleEditSuccess = () => {
        fetchData(); // Refresh all data
    };

    const handleDeleteOrder = (id: number) => {
        setDeleteOrderId(id);
    };

    const confirmDelete = async () => {
        if (!deleteOrderId) return;

        try {
            const response = await fetch(`${API_URL}/ordenes/${deleteOrderId}`, {
                method: "DELETE"
            });

            if (!response.ok) throw new Error("Error al eliminar");

            toast.success("Orden eliminada correctamente");
            fetchData();
        } catch (error) {
            console.error("Error deleting order:", error);
            toast.error("Error al eliminar la orden");
        } finally {
            setDeleteOrderId(null);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando órdenes de trabajo...</div>;
    }

    return (
        <div className="relative">
            <Tabs defaultValue="planificadas" className="w-full">
                <TabsList className="mb-6 bg-gray-100 p-1 rounded-xl w-fit">
                    <TabsTrigger value="planificadas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm">
                        Planificadas ({plannedOrders.length})
                    </TabsTrigger>
                    <TabsTrigger value="no_planificadas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-orange-600 data-[state=active]:shadow-sm">
                        No Planificadas ({unplannedOrders.length})
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="planificadas" className="mt-0">
                    <GanttWorkOrdersList
                        tasks={tasks}
                        onTaskClick={handleTaskClick}
                        onBulkStatusChange={handleBulkStatusChange}
                    />
                </TabsContent>

                <TabsContent value="no_planificadas" className="mt-0">
                    <UnplannedWorkOrdersList
                        orders={unplannedOrders}
                        onEdit={handleEditOrder}
                        onDelete={handleDeleteOrder}
                    />
                </TabsContent>
            </Tabs>

            <TaskDetailsModal
                isOpen={isDetailsPanelOpen}
                selectedItem={selectedTask}
                onClose={() => setIsDetailsPanelOpen(false)}
                getProcessColor={getProcessColor}
                operarios={rawOperarios}
                onOperatorChange={handleOperatorChange}
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
