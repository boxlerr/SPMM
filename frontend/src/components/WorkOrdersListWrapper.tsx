import React, { useEffect, useState } from "react";
import type { PlanificacionItem, WorkOrder } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnplannedWorkOrdersList, type ProcesoRef } from "./UnplannedWorkOrdersList";
import { CompletedWorkOrdersList } from "./CompletedWorkOrdersList";
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ZoomControl, usePersistedZoom } from "@/components/ui/zoom-control";
import { API_URL } from "@/config";
import { isOrderCompleted, parseApiError } from "@/lib/utils";

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
    /** Callback para pedirle al padre que vuelva a cargar todos los datos
     *  (después de crear/editar/eliminar OTs o de cambios masivos). */
    onRefresh?: () => void;
}

export default function WorkOrdersListWrapper({
    refreshTrigger = 0,
    orders,
    planificacion,
    onRefresh,
}: WorkOrdersListWrapperProps) {
    // State local para permitir optimistic updates (cambio de operario, estado, etc.)
    // sin tener que esperar el round-trip al backend. Se re-sincroniza desde props
    // cuando el padre vuelve a fetchear.
    const [rawPlanificacion, setRawPlanificacion] = useState<PlanificacionItem[]>(planificacion);

    useEffect(() => {
        setRawPlanificacion(planificacion);
    }, [planificacion]);

    // Zoom compartido con la sección de Planificación (misma key en localStorage).
    const [zoom, setZoom] = usePersistedZoom('plan_zoom', 100);

    // Edit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [orderToEdit, setOrderToEdit] = useState<WorkOrder | null>(null);

    // Delete Confirmation State
    const [deleteOrderId, setDeleteOrderId] = useState<number | null>(null);

    // Proceso suelto que se está por borrar (se confirma antes de pegarle al backend).
    const [procesoToDelete, setProcesoToDelete] = useState<ProcesoRef | null>(null);

    /** Cambia el estado de varios procesos de una sola vez ("Marcar completados").
     *
     *  Va secuencial a propósito: son N requests contra el backend y mandarlas todas
     *  juntas no acelera nada que se note, pero sí multiplica el riesgo de que alguna
     *  se caiga. Si falla una, las demás igual se guardan y el aviso dice cuántas.
     *  Al final siempre refrescamos, así lo que se ve es lo que quedó guardado. */
    const handleProcessStatusChange = async (refs: ProcesoRef[], idEstado: number) => {
        let fallaron = 0;
        for (const ref of refs) {
            try {
                const res = await fetch(`${API_URL}/ordenes/${ref.ordenId}/procesos/${ref.procesoId}/estado`, {
                    method: "PUT",
                    headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                    // `id_otp` dice QUÉ pasada tocar: sin él, una OT con el mismo proceso
                    // repetido cambia siempre la primera y no la que se tildó.
                    body: JSON.stringify({ id_estado: idEstado, id_otp: ref.idOtp }),
                });
                if (!res.ok) throw new Error("save failed");
            } catch (error) {
                console.error(`Error updating process ${ref.procesoId} of order ${ref.ordenId}:`, error);
                fallaron++;
            }
        }

        const total = refs.length;
        if (fallaron === 0) {
            toast.success(total === 1 ? "Proceso actualizado" : `${total} procesos actualizados`);
        } else if (fallaron === total) {
            toast.error("No se pudo guardar ningún cambio. Revisá la conexión e intentá de nuevo.");
        } else {
            toast.error(`Se guardaron ${total - fallaron} de ${total}. Los que fallaron quedaron como estaban.`);
        }
        onRefresh?.();
    };

    const confirmDeleteProceso = async () => {
        if (!procesoToDelete) return;
        const ref = procesoToDelete;
        setProcesoToDelete(null);
        try {
            // `id_otp` dice QUÉ pasada borrar: sin él, una OT con el mismo proceso
            // repetido borraría la primera y no la que se tocó.
            const otpQS = ref.idOtp !== undefined ? `?id_otp=${ref.idOtp}` : "";
            const res = await fetch(`${API_URL}/ordenes/${ref.ordenId}/procesos/${ref.procesoId}${otpQS}`, {
                method: "DELETE",
                headers: getAuthHeaders(),
            });
            if (!res.ok) {
                throw new Error(parseApiError(await res.text()) || "Error al eliminar el proceso");
            }
            toast.success("Proceso eliminado");
        } catch (error: any) {
            console.error("Error deleting process:", error);
            toast.error(error?.message || "Error al eliminar el proceso");
        } finally {
            onRefresh?.();
        }
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

    // Las tres listas son un reparto: cada OT cae en una sola.
    //   Historial      → ya está completada (entregada o finalizada por el legacy).
    //   Planificadas   → NO completada y con procesos planificados.
    //   No Planificadas→ NO completada y sin planificar.
    // El criterio de "completada" es `isOrderCompleted` (lib/utils), el mismo que usa la
    // pestaña Completadas de Planificación. Antes acá se miraba `o.finalizadototal` en
    // crudo y la lista de Planificadas se armaba aparte, desde la planificación: por eso
    // el contador decía "Planificadas (0)" y adentro se veían 24 OTs que en realidad ya
    // estaban entregadas y tenían que estar en el Historial.
    const plannedOrderIds = new Set(rawPlanificacion.map(p => p.orden_id));

    const completedOrders = orders.filter(isOrderCompleted);
    const activeOrders = orders.filter(o => !isOrderCompleted(o));
    const plannedOrders = activeOrders.filter(o => plannedOrderIds.has(o.id));
    const unplannedOrders = activeOrders.filter(o => !plannedOrderIds.has(o.id));

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
            {/* "No Planificadas" va primera y es la que abre: es el trabajo que todavía
                hay que resolver. Las otras dos son consulta. */}
            <Tabs defaultValue="no_planificadas" className="w-full">
                {/* Cabecera: tabs + ZoomControl alineado a la derecha. El zoom aplica a las
                    tres listas, que ahora son la misma tabla. */}
                <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
                    <TabsList className="bg-gray-100 p-1 rounded-xl w-fit">
                        <TabsTrigger value="no_planificadas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-orange-600 data-[state=active]:shadow-sm">
                            No Planificadas ({unplannedOrders.length})
                        </TabsTrigger>
                        <TabsTrigger value="planificadas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm">
                            Planificadas ({plannedOrders.length})
                        </TabsTrigger>
                        <TabsTrigger value="historial" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-green-700 data-[state=active]:shadow-sm">
                            Historial ({completedOrders.length})
                        </TabsTrigger>
                    </TabsList>
                    <ZoomControl value={zoom} onChange={setZoom} />
                </div>

                <TabsContent value="no_planificadas" className="mt-0">
                    {/* El zoom va como prop para que el componente lo aplique SOLO a la
                        tabla, no al header (icono + buscador) ni a los filtros. */}
                    <UnplannedWorkOrdersList
                        orders={unplannedOrders}
                        onEdit={handleEditOrder}
                        onDelete={handleDeleteOrder}
                        onDataChange={onRefresh}
                        onProcessStatusChange={handleProcessStatusChange}
                        onProcessDelete={setProcesoToDelete}
                        tableZoom={zoom}
                    />
                </TabsContent>

                {/* Misma tabla, mismos filtros, mismas columnas que No Planificadas: lo
                    único que cambia es el título y el color. Antes era una vista de
                    tarjetas plegables (Gantt) que no se parecía a ninguna otra pantalla. */}
                <TabsContent value="planificadas" className="mt-0">
                    {/* `planificacion` va SOLO acá: es lo que deja mostrar a qué hora y en
                        qué máquina cae cada proceso, que es justamente lo que hace que
                        una OT esté en esta solapa y no en la de al lado. */}
                    <UnplannedWorkOrdersList
                        variante="planificadas"
                        orders={plannedOrders}
                        planificacion={rawPlanificacion}
                        onEdit={handleEditOrder}
                        onDelete={handleDeleteOrder}
                        onDataChange={onRefresh}
                        onProcessStatusChange={handleProcessStatusChange}
                        onProcessDelete={setProcesoToDelete}
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
                isOpen={!!procesoToDelete}
                onClose={() => setProcesoToDelete(null)}
                onConfirm={confirmDeleteProceso}
                title="Eliminar proceso"
                description={
                    procesoToDelete
                        ? `¿Eliminar "${procesoToDelete.nombre}" de la OT? Si ya estaba planificado, también se borra del plan (queda un hueco en el horario del operario hasta que vuelvas a planificar la OT). Esta acción no se puede deshacer.`
                        : ""
                }
                confirmText="Eliminar"
                cancelText="Cancelar"
                variant="destructive"
            />
        </div>
    );
}
