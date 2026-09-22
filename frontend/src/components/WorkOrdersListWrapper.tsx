import React, { useEffect, useState } from "react";
import type { PlanificacionItem, WorkOrder } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnplannedWorkOrdersList } from "./UnplannedWorkOrdersList";
import { CompletedWorkOrdersList } from "./CompletedWorkOrdersList";
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ZoomControl, usePersistedZoom } from "@/components/ui/zoom-control";
import TodasLasOrdenes from "@/app/operaciones/_components/TodasLasOrdenes";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { API_URL } from "@/config";
import { isOrderCompleted } from "@/lib/utils";

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
    /**
     * La pantalla de planificación, que se dibuja adentro de la solapa «Planificadas».
     *
     * Baja armada desde Operaciones porque todo su estado vive allá (qué plan se está
     * mirando, qué día, qué OTs están tildadas). Acá era una lista más sin horarios, y
     * al lado había una segunda pantalla —la solapa «Planificación»— que mostraba lo
     * mismo con los horarios y con su propia idea de qué está planificado. Eran dos
     * lugares para una sola pregunta.
     */
    contenidoPlanificadas?: React.ReactNode;
    /** Cuántas OTs cuenta la solapa «Planificadas». Lo manda el padre para que el
     *  número y la lista de adentro digan lo mismo: acá se contarían las de TODAS las
     *  planificaciones y adentro se muestran las de la que está elegida. */
    conteoPlanificadas?: number;
    /** Qué solapa está abierta. La manda el padre para poder caer en «Planificadas»
     *  después de confirmar un plan, que es el momento en que más ganas hay de verlo. */
    subTab?: string;
    /** Avisa qué solapa se está mirando (para limpiar la selección al salir). */
    onSubTabChange?: (valor: string) => void;
}

export default function WorkOrdersListWrapper({
    refreshTrigger = 0,
    orders,
    planificacion,
    onRefresh,
    contenidoPlanificadas,
    conteoPlanificadas,
    subTab: subTabExterna,
    onSubTabChange,
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

    // Qué solapa se está mirando. Hace falta acá —y no sólo en el padre— porque
    // «Planificadas» trae su propia barra de acciones con su propio zoom: mostrar los
    // dos deslizadores, y que el de afuera no haga nada, es peor que no mostrar ninguno.
    const [subTabLocal, setSubTabLocal] = useState("no_planificadas");
    const subTab = subTabExterna ?? subTabLocal;


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
            <Tabs
                value={subTab}
                onValueChange={(v) => { setSubTabLocal(v); onSubTabChange?.(v); }}
                className="w-full"
            >
                {/* Cabecera: tabs + ZoomControl alineado a la derecha. El zoom aplica a las
                    tres listas, que ahora son la misma tabla. */}
                <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
                    {/* `flex-wrap h-auto`: en un teléfono las cuatro solapas no entran en una
                        fila y se salían de la pantalla por la derecha, con «Todas» afuera
                        (RF-27). Ahora bajan a una segunda fila. En la computadora entran y
                        se ven igual que antes: una fila de 40px, que es lo que medía el `h-10`. */}
                    <TabsList className="bg-gray-100 p-1 rounded-xl w-fit max-w-full h-auto flex-wrap justify-start">
                        <TabsTrigger value="no_planificadas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-orange-600 data-[state=active]:shadow-sm">
                            No Planificadas ({unplannedOrders.length})
                        </TabsTrigger>
                        <TabsTrigger value="planificadas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm">
                            Planificadas ({conteoPlanificadas ?? plannedOrders.length})
                        </TabsTrigger>
                        <TabsTrigger value="historial" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-green-700 data-[state=active]:shadow-sm">
                            Historial ({completedOrders.length})
                        </TabsTrigger>
                        {/* La cuarta: TODAS juntas. Las otras tres parten el trabajo y en
                            ninguna se ve el total, así que una OT que se planifica
                            desaparece de la lista donde uno la estaba mirando y se lee
                            como perdida. Acá está siempre, diga lo que diga su estado. */}
                        <TabsTrigger value="todas" className="px-4 rounded-lg data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm">
                            Todas ({orders.length})
                        </TabsTrigger>
                    </TabsList>
                    <div className="flex items-center gap-2">
                        {/* El zoom se esconde abajo de `md` (RF-27): ahí las listas se ven
                            como tarjetas y el zoom sólo actúa sobre la tabla, así que en el
                            teléfono no hacía nada y además empujaba «Nueva orden» afuera
                            del recuadro. */}
                        {subTab !== "planificadas" && (
                            <div className="hidden md:block">
                                <ZoomControl value={zoom} onChange={setZoom} />
                            </div>
                        )}
                        {/* Dar de alta una OT es lo que hace Carolina, y no entra nunca a
                            planificar: el botón tiene que estar en ESTA pantalla, no en la
                            cabecera de Operaciones, que se va con el scroll y se lee como
                            parte del planificador. Acá se ve en las tres solapas y también
                            cuando la lista está vacía. Abre el mismo modal que el de arriba,
                            en modo alta (`orderToEdit` en null). */}
                        <Button
                            onClick={() => { setOrderToEdit(null); setIsEditModalOpen(true); }}
                            className="h-8 gap-1.5 bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Nueva orden
                        </Button>
                    </div>
                </div>

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

                {/* Misma tabla, mismos filtros, mismas columnas que No Planificadas: lo
                    único que cambia es el título y el color. Antes era una vista de
                    tarjetas plegables (Gantt) que no se parecía a ninguna otra pantalla. */}
                <TabsContent value="planificadas" className="mt-0">
                    {/* Acá adentro va la planificación entera: el plan elegido, la semana
                        o el día, los horarios de cada paso y la carga de cada persona.
                        Cuando el padre no la manda (otras pantallas que usan este mismo
                        componente) se cae a la lista de siempre. */}
                    {contenidoPlanificadas ?? (
                        <UnplannedWorkOrdersList
                            variante="planificadas"
                            orders={plannedOrders}
                            onEdit={handleEditOrder}
                            onDelete={handleDeleteOrder}
                            onDataChange={onRefresh}
                            tableZoom={zoom}
                        />
                    )}
                </TabsContent>

                <TabsContent value="historial" className="mt-0">
                    <CompletedWorkOrdersList
                        orders={completedOrders}
                        onEdit={handleEditOrder}
                        tableZoom={zoom}
                    />
                </TabsContent>

                <TabsContent value="todas" className="mt-0">
                    <TodasLasOrdenes onRefresh={onRefresh} />
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
        </div>
    );
}
