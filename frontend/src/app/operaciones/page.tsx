"use client"


import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import PlanificacionGanttWrapper from "@/components/PlanificacionGanttWrapper"
import WorkOrdersListWrapper from "@/components/WorkOrdersListWrapper"
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { ScrollableTabsBar } from "@/components/planning/ScrollableTabsBar"
import { PlanningListTable } from "@/components/planning/PlanningListTable"
import { SharedOperatorsList } from "@/components/resources/SharedOperatorsList"
import DetalleOperario from "@/app/recursos/_components/DetalleOperario"
import CambiarEstado from "@/app/recursos/_components/CambiarEstado"
import { Operario } from "@/app/recursos/_types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import MateriaPrimaTab from "./_components/MateriaPrimaTab"
import { OperatorLoadTab } from "./_components/OperatorLoadTab"


import { getWeekDates, formatDate } from "@/lib/gantt-utils"
import { cn, isOrderCompleted, isOrderDelivered } from "@/lib/utils"
import { Activity, LayoutList, GanttChartSquare, Plus, CalendarClock, User, Box, RefreshCw, Trash2, ChevronDown, CheckCircle2 } from "lucide-react"
import { ZoomControl, usePersistedZoom } from "@/components/ui/zoom-control"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { usePanelContext } from "@/contexts/PanelContext"
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal"
import { Button } from "@/components/ui/button"
import TaskDetailsModal from "@/components/gantt/TaskDetailsModal"
import { toast } from "sonner"
import { convertPlanificacionToGanttTasks } from "@/lib/gantt-utils"
import { baseDelPlan, finDeLaFila, inicioDeLaFila, minutosDesdeFecha } from "@/lib/plan-fechas"
import type { GanttTask, Resource, PlanificacionItem, WorkOrder } from "@/lib/types"
import { PlanningPreviewScreen } from "@/components/planning/PlanningPreviewScreen"
import { AvailabilityConfigModal } from "@/components/planning/AvailabilityConfigModal"
import { PlanningSelectionScreen } from "@/components/planning/PlanningSelectionScreen"
import { ProgresoPlanificacion } from "@/components/planning/ProgresoPlanificacion"
import { BorradoresPlan } from "@/components/planning/BorradoresPlan"
import { useBorradorPlan } from "@/hooks/useBorradorPlan"
import type { BorradorPlan, TandaManual } from "@/lib/borradorPlan"
import { payloadDeAjustes, type AjusteDelPlan, type AjustesDelPlanPayload } from "@/lib/ajustesPlan"
import { huellaRecursos } from "@/lib/huellaRecursos"
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

/** Valor especial del desplegable de planificaciones: no es un lote, es una acción. */
const LIMPIAR_VIEJAS = "__limpiar_viejas__";

/**
 * Lee `?tab=materia_prima&pieza=ID` —el enlace del aviso de stock bajo en la
 * campanita (RF-14)— y abre la solapa parada en esa pieza.
 *
 * Es un componente aparte, envuelto en <Suspense>, y no un `window.location` leído al
 * montar, por dos motivos: `useSearchParams` fuera de un Suspense rompe el build
 * estático de Next 15, y leyéndolo una sola vez al montar el aviso no andaría si ya se
 * está en Operaciones (el router cambia la dirección sin volver a montar la página).
 *
 * Después de leerlo limpia los dos parámetros sin recargar, como `?edit_ot`, para que
 * un refresh no vuelva a saltar a la pieza.
 */
function EnlaceMateriaPrima({ onAbrir }: { onAbrir: (idPieza: number | null) => void }) {
  const params = useSearchParams()
  const tab = params.get("tab")
  const pieza = params.get("pieza")
  useEffect(() => {
    if (tab !== "materia_prima") return
    const id = Number(pieza)
    onAbrir(Number.isInteger(id) && id > 0 ? id : null)
    const url = new URL(window.location.href)
    url.searchParams.delete("tab")
    url.searchParams.delete("pieza")
    window.history.replaceState({}, "", url.toString())
    // `onAbrir` cambia en cada render de la página: si estuviera acá, esto correría en
    // cada render. Lo que dispara el salto es el parámetro, y sólo eso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pieza])
  return null
}

/** Qué OT pidió abrir un enlace: por id interno o por el número que ve la gente. */
type OtPedida = { id: number } | { vieja: number }

/**
 * Lee `?edit_ot=ID` (o `?edit_ot_vieja=N`) y le pasa a la página qué OT abrir. Lo usan
 * el «Editar OT ↗» de la vista previa del plan y el aviso de OT retrasada de la
 * campanita (RF-04).
 *
 * Mismo camino que `EnlaceMateriaPrima`, y por lo mismo. Antes esto se leía de
 * `window.location` en un efecto que dependía sólo de la lista de órdenes, y fallaba
 * de dos maneras cuando ya se estaba en Operaciones: tocar el aviso no abría nada (el
 * router cambia la dirección sin volver a montar la página, y la lista no cambiaba), y
 * el `?edit_ot` quedaba en la dirección, así que la próxima edición en línea de
 * cualquier OT —que toca la lista— abría de golpe el modal de la retrasada.
 *
 * Por eso el parámetro se borra acá apenas se lee, y lo pendiente queda en el estado
 * de la página, no en la dirección: una vez abierto, no hay nada que lo reabra.
 */
function EnlaceEditarOT({ onPedir }: { onPedir: (pedido: OtPedida) => void }) {
  const params = useSearchParams()
  const editOt = params.get("edit_ot")
  const editOtVieja = params.get("edit_ot_vieja")
  useEffect(() => {
    if (!editOt && !editOtVieja) return
    const id = Number(editOt)
    const vieja = Number(editOtVieja)
    if (editOt && Number.isInteger(id) && id > 0) onPedir({ id })
    else if (editOtVieja && Number.isInteger(vieja) && vieja > 0) onPedir({ vieja })
    const url = new URL(window.location.href)
    url.searchParams.delete("edit_ot")
    url.searchParams.delete("edit_ot_vieja")
    window.history.replaceState({}, "", url.toString())
    // Ver la nota de `EnlaceMateriaPrima`: lo que dispara es el parámetro, no el callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOt, editOtVieja])
  return null
}

export default function OperacionesPage() {
  // Operaciones abre SIEMPRE en "Órdenes de Trabajo": es la pantalla desde la que se
  // arranca el día (ver qué entró y qué falta planificar), no la planificación ya hecha.
  const [activeTab, setActiveTab] = useState<"gantt" | "work_orders" | "operarios" | "materia_prima" | "carga">("work_orders")
  /** La pieza a la que lleva el aviso de stock bajo (RF-14). Se consume una vez: la
   *  solapa la busca, la resalta y avisa que ya la usó. */
  const [piezaEnlazada, setPiezaEnlazada] = useState<number | null>(null)
  /** Qué solapa de Órdenes de Trabajo está abierta. Vive acá —y no adentro de la
   *  lista— porque al confirmar un plan hay que caer en «Planificadas». */
  const [otSubTab, setOtSubTab] = useState("no_planificadas")
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  /** OT pre-seleccionada para editar (viene del query param `?edit_ot=ID` desde
   *  el link "Editar OT ↗" de la vista previa, o de otra parte del sistema). */
  const [orderToEdit, setOrderToEdit] = useState<WorkOrder | null>(null)
  /** La OT que pidió abrir un enlace (`EnlaceEditarOT`), mientras llegan las órdenes.
   *  Se consume una vez: al abrirla vuelve a null. */
  const [otPedida, setOtPedida] = useState<OtPedida | null>(null)
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

  /**
   * EL DÍA QUE SE ESTÁ MIRANDO en Semanal y en Diaria. Por defecto, HOY.
   *
   * Antes, si había una planificación elegida arriba, el día de referencia era el día
   * en que se armó ESA planificación. Julián, 16/09/2026: «en diarias y semanal no me
   * aparecen las que tengo para hoy». Con la planificación de mayo elegida, Semanal
   * mostraba la semana del 4 al 10 de mayo y Diaria el 7 de mayo — cuatro meses atrás.
   *
   * Y no era sólo por planes viejos: el día en que se aprieta "Planificar" es
   * justamente el día en que el plan NUNCA empieza (si la jornada ya arrancó, el plan
   * es para mañana; ver lib/plan-fechas). O sea que "Diaria según lote" caía siempre
   * en un día vacío, para cualquier plan, incluso el recién hecho.
   *
   * Elegir QUÉ PLAN mirar y elegir QUÉ DÍA mirar son dos preguntas distintas y ahora
   * tienen cada una su control: el desplegable de arriba y el calendario.
   */
  const fechaReferencia = customRefDate ?? new Date();
  const mirandoHoy = !customRefDate
    || customRefDate.toDateString() === new Date().toDateString();
  /**
   * El mismo día, como texto. Es lo que va en las dependencias de los `useMemo` que
   * filtran por fecha: `fechaReferencia` es un objeto `Date` NUEVO en cada render
   * cuando no hay fecha elegida a mano, así que ponerlo de dependencia recalcula las
   * listas enteras en cada render —con 1267 órdenes y la planificación completa, eso
   * se siente—. El día cambia una vez por día; la identidad del objeto, cien veces por
   * minuto.
   */
  const diaDeReferencia = `${fechaReferencia.getFullYear()}-${fechaReferencia.getMonth()}-${fechaReferencia.getDate()}`;

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
  // Qué traba el plan y cómo se destraba: lo calcula el backend en cada vista previa.
  const [diagnosticosPlan, setDiagnosticosPlan] = useState<any[]>([])
  const [operatorLoads, setOperatorLoads] = useState<Record<number, number>>({})
  // Overlay de progreso del cálculo. `listo` marca que la respuesta llegó: la
  // barra se completa y el overlay se baja cuando termina de armarse la vista previa.
  const [calculando, setCalculando] = useState<{ activo: boolean; ots: number; listo: boolean; modo?: "calcular" | "guardar" }>(
    { activo: false, ots: 0, listo: false }
  )
  // Autoguardado del plan sin confirmar. El navegador escribe en cada cambio (cubre
  // el cierre accidental y el corte de luz); la base va debounceada y es la copia
  // que ve cualquiera desde cualquier máquina. Ver hooks/useBorradorPlan.
  const { registrarCambio, guardarYa, olvidar, adoptar, empezarNuevo, idBorradorEnBase } = useBorradorPlan()
  // Lo que devolvió el solver, para poder recomponer el borrador entero cuando lo
  // único que cambió fue una edición hecha dentro de la vista previa.
  const baseBorrador = useRef<Omit<BorradorPlan, "ediciones" | "forzarOrdenIds" | "tandasManuales" | "ajustesDelPlan" | "guardadoEn"> | null>(null)
  /**
   * Lo último que avisó la vista previa, para poder recomponer el borrador ENTERO
   * desde cualquiera de los dos avisos.
   *
   * Los retoques a mano y lo que se agregó a mano llegan por callbacks distintos y
   * en momentos distintos. Si cada uno armara el borrador con lo suyo y vacío lo
   * del otro, el último en hablar le borraría al otro su parte —y el borrador
   * terminaría sin las pasadas elegidas, que es justo lo que se está arreglando.
   */
  const retoquesBorrador = useRef<{ ediciones: Record<string, any>; forzarOrdenIds: number[] }>({ ediciones: {}, forzarOrdenIds: [] })
  const tandasBorrador = useRef<TandaManual[]>([])
  /**
   * Las soluciones aplicadas SOLO a este plan (no tocan Recursos).
   *
   * Va en un ref por el mismo motivo que las tandas: lo que hay que guardar tiene
   * que estar disponible en el instante en que se arma el borrador, y un estado de
   * React llega recién en el render siguiente. Acá es peor todavía que con las
   * tandas, porque un ajuste no existe en ningún otro lado: si el guardado lo
   * saltea, no se puede recuperar de ninguna parte. Ver lib/ajustesPlan.
   */
  const ajustesBorrador = useRef<AjusteDelPlan[]>([])
  /** Cuándo se calculó el plan que se está viendo. Al retomar un borrador es la
   *  fecha del borrador, no la de ahora: es lo que permite avisar que la foto de
   *  diagnósticos puede haber quedado vieja. */
  const [planCalculadoEn, setPlanCalculadoEn] = useState<string | undefined>(undefined)
  /** Cómo estaban los datos de Recursos cuando se calculó el plan que se ve.
   *  Es lo que permite revisar solo, al volver, si lo que decían los avisos ya se
   *  arregló — sin recalcular a lo bruto para averiguarlo. Ver lib/huellaRecursos. */
  const [huellaPlan, setHuellaPlan] = useState<string | null | undefined>(undefined)
  /** Lo que traía un borrador retomado, para que la vista previa lo restaure.
   *  Con un plan nuevo van vacíos, que es lo que los limpia. */
  const [edicionesIniciales, setEdicionesIniciales] = useState<Record<string, any>>({})
  const [forzarIdsIniciales, setForzarIdsIniciales] = useState<number[]>([])
  const [tandasIniciales, setTandasIniciales] = useState<TandaManual[]>([])
  const [ajustesIniciales, setAjustesIniciales] = useState<AjusteDelPlan[]>([])

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
  /**
   * Los días que el taller no trabaja (feriados, mantenimiento). Se cargan desde
   * Disponibilidad y el planificador los saltea.
   *
   * Hacen falta ACÁ porque la vuelta de fecha a minutos —arrastrar un proceso en el
   * Gantt, escribirle otro horario— tiene que contar los mismos días que contó el
   * backend al armar la fecha. Sin ellos, la ida y la vuelta dejan de ser la misma
   * cuenta y cada feriado en el medio corre el proceso un día de trabajo entero.
   */
  const [feriados, setFeriados] = useState<string[]>([])
  const [isDeletingLote, setIsDeletingLote] = useState(false)
  const [isLimpiarViejasOpen, setIsLimpiarViejasOpen] = useState(false)
  const [limpiandoViejas, setLimpiandoViejas] = useState(false)

  // Sub-tab activa dentro de Planificación (Planificadas / Semanal / ... ).
  // Es controlada para poder limpiar la selección de OTs al cambiar de pestaña
  // (si no, uno selecciona en "Planificadas", cambia de tab y el tachito borraría
  // OTs que ya no está viendo).
  const [planSubTab, setPlanSubTab] = useState<string>("general")

  // OTs tildadas en la tabla de Planificadas/Completadas. Se usan para sacarlas
  // de la planificación con el tachito de la barra de acciones.
  const [selectedPlanIds, setSelectedPlanIds] = useState<number[]>([])
  const [isQuitarOtsDialogOpen, setIsQuitarOtsDialogOpen] = useState(false)
  const [isQuitandoOts, setIsQuitandoOts] = useState(false)
  /** Qué estado se está por aplicar a todas las OTs tildadas (null = ninguno). */
  const [estadoMasivo, setEstadoMasivo] = useState<number | null>(null)
  const [estadoMasivoEnCurso, setEstadoMasivoEnCurso] = useState(false)








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
  /**
   * Refresca todo. Devuelve las filas de planificación que llegó a traer —vacío si el
   * GET falló—, para que quien lo llama pueda saber si el refresco sirvió: los errores
   * se tragan a propósito (esto corre de fondo y no puede voltear la pantalla), así
   * que sin el valor de vuelta no hay forma de distinguir "no hay nada" de "no llegó".
   *
   * `silencioso`: refresca SIN prender el cartel de carga. Las tablas reemplazan todo
   * su contenido por un spinner mientras `isLoading` está prendido, así que un
   * refresco después de tocar una celda hacía desaparecer la lista entera por un rato
   * —y con ella la OT desplegada y el lugar donde estabas parado— para volver con los
   * mismos datos más un campo cambiado. Para eso alcanza con que la fila se actualice
   * cuando llegue.
   */
  const fetchData = async (
    { silencioso = false }: { silencioso?: boolean } = {}
  ): Promise<PlanificacionItem[]> => {
    let filasDelPlan: PlanificacionItem[] = [];
    try {
      if (!silencioso) setIsLoading(true);

      let mappedResources: Resource[] = [];

      // 1. Fetch Operarios
      try {
        // Los días no laborables, para que la vuelta de fecha a minutos cuente igual
        // que el backend. Si falla, se sigue sin ellos: es peor no mostrar el plan.
        fetch(`${API_URL}/config/availability`, { headers: getAuthHeaders() })
          .then(r => r.ok ? r.json() : { blocked_dates: [] })
          .then(d => setFeriados(d?.blocked_dates || []))
          .catch(() => { /* sin feriados, como antes */ });

        const opResponse = await fetch(`${API_URL}/operarios`, { headers: getAuthHeaders() });
        if (opResponse.status === 401) {
          if (typeof window !== "undefined") window.location.href = "/login";
          return filasDelPlan;
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
            hora_inicio: op.hora_inicio || "07:00",
            hora_fin: op.hora_fin || "16:00",
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
          return filasDelPlan;
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
          filasDelPlan = parsedPlanData;
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
          return filasDelPlan;
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
          return filasDelPlan;
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
    return filasDelPlan;
  };

  useEffect(() => {
    fetchData();
  }, []);

  /**
   * Abre el modal de edición de la OT que pidió un enlace (`?edit_ot`, ver
   * `EnlaceEditarOT`), apenas están las órdenes. Si se llega de otra pantalla, la
   * lista todavía no llegó y el pedido espera; si ya se estaba acá, abre en el acto.
   *
   * El pedido se consume antes de abrir: así, que después cambie la lista (cualquier
   * edición en línea la toca) no vuelve a abrir nada.
   */
  useEffect(() => {
    if (!otPedida) return;
    if (ordenesTrabajo.length === 0) return;
    const target = "id" in otPedida
      ? ordenesTrabajo.find(o => o.id === otPedida.id)
      : ordenesTrabajo.find(o => o.id_otvieja === otPedida.vieja);
    setOtPedida(null);
    if (!target) {
      // Antes no pasaba nada y no se sabía por qué: tocar el aviso parecía roto.
      toast.error(
        "id" in otPedida
          ? "Esa orden ya no está en la lista: puede que la hayan borrado."
          : `La OT #${otPedida.vieja} ya no está en la lista: puede que la hayan borrado.`
      );
      return;
    }
    setOrderToEdit(target);
    setIsCreateModalOpen(true);
  }, [otPedida, ordenesTrabajo]);


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

  /** Filas de plan viejas que no tienen planificación asignada: el desplegable las
   *  saltea, así que sólo se ven con "Todas". Si existen, no se elige una
   *  planificación sola al entrar: esconderlas sería perder trabajo de vista. */
  const hayPlanSinLote = React.useMemo(
    () => rawPlanificacion.some(p => !p.id_planificacion_lote),
    [rawPlanificacion]);

  /**
   * AL ENTRAR SE MUESTRA LA PLANIFICACIÓN QUE ESTÁ CORRIENDO, no todas juntas.
   *
   * Arrancaba en "Todas las Planificaciones" y sólo se movía con un click, así que
   * quedaba clavada donde la habían dejado. El 16/09/2026, tres minutos después de
   * planificar, la pantalla seguía mostrando la de mayo — y con ella, trabajo de hace
   * cuatro meses ya entregado.
   *
   * Es a propósito que NO se guarde en el navegador: recordar la elegida es justamente
   * lo que producía la pantalla clavada. Se recalcula en cada entrada, que es barato y
   * siempre dice la verdad. Sólo la primera vez: después manda lo que elija la persona.
   */
  const yaSeEligioLote = React.useRef(false);
  React.useEffect(() => {
    if (yaSeEligioLote.current || hayPlanSinLote || uniqueLotes.length === 0) return;
    yaSeEligioLote.current = true;
    setSelectedLoteId(uniqueLotes[0].id);
  }, [uniqueLotes, hayPlanSinLote]);

  const filteredPlanificacion = React.useMemo(() => {
    if (selectedLoteId === "all") return rawPlanificacion;
    return rawPlanificacion.filter(p => p.id_planificacion_lote === selectedLoteId);
  }, [rawPlanificacion, selectedLoteId]);


  // `isOrderDelivered` / `isOrderCompleted` viven en lib/utils: el reparto
  // Planificadas / No Planificadas / Historial de la solapa "Órdenes de Trabajo" usa
  // exactamente el mismo criterio. Cuando cada pantalla tenía el suyo, el contador
  // decía 0 y la lista de abajo mostraba 24.

  // Use filteredPlanificacion for deriving planned orders to reflect the history selection
  const plannedOrderIds = new Set(filteredPlanificacion.map(p => p.orden_id));
  const plannedOrdenes = ordenesTrabajo.filter(o => plannedOrderIds.has(o.id));

  /** Planificadas ya completadas (entregadas) — van a su propia pestaña. */
  const completedPlannedOrdenes = plannedOrdenes.filter(isOrderCompleted);

  /**
   * LAS CUATRO LISTAS DE LA PANTALLA, cada una en un solo lugar.
   *
   * Estaban escritas a mano adentro del JSX, una por solapa, y por eso se habían ido
   * separando: "Planificadas" descartaba las entregadas y "Semanal" no, así que una OT
   * ya entregada se caía de una lista y reaparecía en la otra, mirando el mismo plan.
   * Acá arriba se ven las cuatro juntas y se nota si alguna se desalinea. Además son
   * las que alimentan los contadores de las solapas: el número y la lista no pueden
   * decir cosas distintas.
   */
  const estaTerminadaEnElTaller = (order: WorkOrder) =>
    !!order.procesos && order.procesos.length > 0
    && order.procesos.every(p => p.estado_proceso.id === 3);

  /** Lo que falta hacer de la planificación elegida. */
  const otsPendientes = React.useMemo(
    () => plannedOrdenes.filter(o => !estaTerminadaEnElTaller(o) && !isOrderCompleted(o)),
    [plannedOrdenes]);

  /** De lo que falta hacer, lo que cae en la semana que se está mirando. */
  const otsDeLaSemana = React.useMemo(() => {
    const dia = fechaReferencia.getDay();
    const lunes = new Date(fechaReferencia);
    lunes.setDate(fechaReferencia.getDate() - dia + (dia === 0 ? -6 : 1));
    lunes.setHours(0, 0, 0, 0);
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    domingo.setHours(23, 59, 59, 999);
    return otsPendientes.filter(order => {
      const procesos = filteredPlanificacion.filter(p => p.orden_id === order.id);
      return procesos.some(p => {
        const inicio = inicioDeLaFila(p);
        return !!inicio && inicio >= lunes && inicio <= domingo;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ver `diaDeReferencia`
  }, [otsPendientes, filteredPlanificacion, diaDeReferencia]);

  /** De lo que falta hacer, lo que se toca el día que se está mirando. */
  const otsDelDia = React.useMemo(() => {
    const desde = new Date(fechaReferencia);
    desde.setHours(0, 0, 0, 0);
    const hasta = new Date(fechaReferencia);
    hasta.setHours(23, 59, 59, 999);
    return otsPendientes.filter(order => {
      const procesos = filteredPlanificacion.filter(p => p.orden_id === order.id);
      return procesos.some(p => {
        const inicio = inicioDeLaFila(p);
        const fin = finDeLaFila(p);
        // Se cruza con el día: empieza antes de que termine y termina después de que empieza.
        return !!inicio && !!fin && inicio <= hasta && fin >= desde;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ver `diaDeReferencia`
  }, [otsPendientes, filteredPlanificacion, diaDeReferencia]);

  /**
   * El primer día con trabajo de la planificación elegida, de hoy en adelante.
   *
   * Es el seguro de que la pantalla abra en HOY: si planificás a las 11, el plan
   * arranca mañana a las 07:00 y la Diaria de hoy sale vacía POR DISEÑO. Sin decirlo,
   * esa pantalla en blanco se lee como «no se guardó» o «se perdió el plan».
   */
  /** Las filas del plan de las OT que todavía tienen trabajo. Es lo que miran las
   *  listas, así que el calendario y el aviso tienen que mirar lo mismo: si no, el
   *  botón "arranca el jue 17" lleva a un día donde la lista sale vacía igual. */
  const filasPendientes = React.useMemo(() => {
    const ids = new Set(otsPendientes.map(o => o.id));
    return filteredPlanificacion.filter(p => ids.has(p.orden_id));
  }, [filteredPlanificacion, otsPendientes]);

  const primerDiaConTrabajo = React.useMemo(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    let primero: Date | null = null;
    filasPendientes.forEach(p => {
      const inicio = inicioDeLaFila(p);
      if (!inicio || inicio < hoy) return;
      if (!primero || inicio < primero) primero = inicio;
    });
    return primero as Date | null;
  }, [filasPendientes]);

  /** Las filas del plan que todavía representan trabajo por hacer: alimentan la Carga. */
  const cargaPendiente = React.useMemo(() => {
    const entregadas = new Set(completedPlannedOrdenes.map(o => o.id));
    return filteredPlanificacion.filter(
      p => p.id_estado !== 3 && !entregadas.has(p.orden_id));
  }, [filteredPlanificacion, completedPlannedOrdenes]);

  /**
   * Lo que el taller TERMINÓ y todavía NO se entregó.
   *
   * Antes eran todas las terminadas, y como al tildar el último proceso el sistema le
   * pone fecha de entrega a la OT, casi todas caían también en "Entregadas al cliente":
   * dos solapas diciendo lo mismo con nombres distintos («no entiendo la diferencia
   * entre completadas y finalizadas», Julián, 16/09/2026). Sacando las entregadas, esta
   * lista pasa a contestar algo que antes no contestaba nadie: qué hay para despachar.
   */
  const otsTerminadasSinEntregar = React.useMemo(
    () => plannedOrdenes.filter(o => estaTerminadaEnElTaller(o) && !isOrderCompleted(o)),
    [plannedOrdenes]);


  // Set de fechas (YYYY-MM-DD) que tienen al menos un proceso planificado.
  // Se usa en el calendario del banner para mostrar un punto rojo en esos días,
  // así el usuario sabe de un vistazo en qué días hay trabajo cargado.

  const plannedDates = React.useMemo(() => {
    const set = new Set<string>();
    filasPendientes.forEach(p => {
      const real = inicioDeLaFila(p, feriados);
      if (!real) return;
      const key = `${real.getFullYear()}-${String(real.getMonth() + 1).padStart(2, '0')}-${String(real.getDate()).padStart(2, '0')}`;
      set.add(key);
    });
    return set;
    // Las dependencias son las que el cuerpo LEE de verdad. Decían
    // `[filteredPlanificacion]`, que ya no se usa acá adentro: el set quedaba pegado a
    // un valor viejo y no coincidía con las listas. Se veía como el aviso «esta
    // planificación arranca el mié 16/09 — ir a ese día» estando parado en el 16/09.
  }, [filasPendientes, feriados]);

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
    // Sin re-planificar: las que NO están en ningún plan.
    //
    // Devolvía `unplannedOrdenes`, que excluye sólo las del plan que estás mirando: las
    // de los OTROS planes aparecían como "sin planificar" y se podían planificar dos
    // veces sin que nada avisara. Con "Todas" elegido no se notaba porque ahí las dos
    // listas coinciden; desde que la pantalla abre parada en una planificación, sí.
    return trulyUnplannedOrders;
  }, [isReplanning, selectedLoteId, trulyUnplannedOrders, plannedOrdenes]);


  // ... existing code ...

  const handleTaskMove = async (taskId: string, newResourceId: string, newDate: string, newStartTime: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newStart = new Date(newDate + "T" + newStartTime + ":00");
    const newOperarioId = parseInt(newResourceId);

    const rawItem = rawPlanificacion.find(i => i.id === task.dbId);
    if (!rawItem) return;

    // El arranque de ESTE plan (lib/plan-fechas), no el día en que se apretó
    // "Planificar" puesto a las 09:00: lo que se guarda es el minuto, así que si la
    // base no es la misma que usó el backend, arrastrar un proceso lo manda a otro día.
    const normalizedBaseDate = baseDelPlan(rawItem, feriados);

    if (isNaN(newStart.getTime()) || isNaN(normalizedBaseDate.getTime())) {
      console.error("Invalid date detected in handleTaskMove", {
        newDate,
        newStartTime,
        newStart,
        creado_en: rawItem.creado_en,
        inicio_base: rawItem.inicio_base,
        normalizedBaseDate
      });
      toast.error("Error al mover el proceso: Fecha inválida");
      return;
    }

    const newInicioMin = minutosDesdeFecha(normalizedBaseDate, newStart, feriados);

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
        // Las fechas que mandó el backend quedaron viejas en cuanto movimos el minuto.
        // Si se dejan, `inicioDeLaFila` las prefiere —son las que manda— y la barra se
        // vuelve a dibujar donde estaba: parecía que el arrastre no hacía nada. Se
        // sacan, y la fecha sale de los minutos nuevos con el mismo arranque y la misma
        // jornada que va a usar el backend; el próximo refresco las repone.
        const { fecha_inicio_estimada, fecha_fin_estimada, ...resto } = item;
        return {
          ...resto,
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
      toast.error("No se pudo mover el proceso. Se revirtió; revisá la conexión e intentá de nuevo.");
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

      // Se le pone el nombre a LA PASADA que se cambió, no a todas las que comparten
      // el proceso. En una OT con el mismo proceso repetido —dato válido: la 7497
      // tiene TORNO CNC trece veces— cambiarle el operario a una repintaba las trece,
      // y de ahí sacan su valor los desplegables de la tabla. El fallback por proceso
      // es para los planes viejos, donde `id_orden_trabajo_proceso` viene en NULL.
      const idPasada = targetTask.id_orden_trabajo_proceso;

      return {
        ...order,
        procesos: order.procesos.map(proc => {
          const esLaPasada = idPasada != null
            ? proc.id === idPasada
            : proc.proceso.id === targetTask.proceso_id;
          if (!esLaPasada) return proc;
          return { ...proc, operario_nombre: opName };
        })
      };
    }));

    try {
      const response = await fetch(`${API_URL}/planificacion/` + targetTask.id, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ id_operario: opId }),
      });
      if (!response.ok) throw new Error("Failed to update operator");
    } catch (error) {
      console.error("Error updating operator:", error);
      toast.error("No se pudo guardar el cambio de recurso humano. Se revirtió; revisá la conexión e intentá de nuevo.");
      fetchData();
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
      const response = await fetch(`${API_URL}/ordenes/` + targetTask.orden_id + "/procesos/" + targetTask.proceso_id + "/estado", {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ id_estado: idEstado, id_otp: (targetTask as any).id_orden_trabajo_proceso }),
      });
      if (!response.ok) throw new Error("Failed to update status");
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("No se pudo guardar el cambio de estado. Se revirtió; revisá la conexión e intentá de nuevo.");
      fetchData();
    }

  }

  const handleMachineryChange = async (planId: number, maquinariaId: number) => {
    // La fila exacta del plan. Se buscaba por (orden, proceso) y se tomaba la primera:
    // en una OT con el mismo proceso repetido, cambiarle la máquina a la segunda pasada
    // se la cambiaba a la primera.
    const planItem = rawPlanificacion.find(p => p.id === planId);
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
      toast.error("Error al actualizar el recurso maquinaria");
      // Revert
      fetchData();
    }
  };

  /** Refresca de fondo, sin tapar la lista con el spinner. Para todo lo que ya se ve
   *  cambiado en pantalla y sólo hace falta confirmar contra el servidor. */
  const refrescarEnSilencio = () => { void fetchData({ silencioso: true }); };

  /**
   * Pisa campos sueltos de una OT en la lista que ya está en pantalla.
   *
   * Lo usan las celdas editables de la tabla: el valor nuevo se ve al toque y no hay
   * que volver a pedir las 1267 órdenes para enterarse de que una fecha cambió. Si el
   * guardado falla, la tabla vuelve a llamar con el valor viejo.
   */
  const parchearOrden = (ordenId: number, cambios: Record<string, any>) => {
    setOrdenesTrabajo(prev => prev.map(o => o.id === ordenId ? { ...o, ...cambios } : o));
  };

  /**
   * El horario de un proceso, corregido a mano desde la tabla.
   *
   * Lo que se guarda no es una fecha sino el minuto del plan; la cuenta la hace la
   * tabla con la misma jornada que usó el backend (ver lib/plan-fechas) y acá llegan
   * los minutos ya hechos.
   *
   * Antes esto lo guardaba la tabla y después recargaba la pantalla entera. Ahora se
   * actualiza en el lugar, igual que cuando se arrastra el proceso en el Gantt.
   */
  const handleInicioEstimadoChange = async (planId: number, inicioMin: number, finMin: number) => {
    const planViejo = rawPlanificacion;
    const tareasViejas = tasks;
    if (!planViejo.some(p => p.id === planId)) return;

    const actualizada = planViejo.map(item => {
      if (item.id !== planId) return item;
      // Las fechas hechas que mandó el backend se SACAN: `inicioDeLaFila` las
      // prefiere, así que si se dejan la celda se vuelve a dibujar con el horario
      // viejo y parece que el cambio no hizo nada. El próximo refresco las repone.
      const { fecha_inicio_estimada, fecha_fin_estimada, ...resto } = item;
      return { ...resto, inicio_min: inicioMin, fin_min: finMin };
    });

    setRawPlanificacion(actualizada);
    setTasks(convertPlanificacionToGanttTasks(actualizada, resources));

    try {
      const response = await fetch(`${API_URL}/planificacion/${planId}`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ inicio_min: inicioMin, fin_min: finMin }),
      });
      if (!response.ok) throw new Error("Failed to update start date");
    } catch (error) {
      console.error("Error updating start date:", error);
      setRawPlanificacion(planViejo);
      setTasks(tareasViejas);
      toast.error("No se pudo guardar el horario. Se revirtió; revisá la conexión e intentá de nuevo.");
    }
  };


  const [isStatusConfirmOpen, setIsStatusConfirmOpen] = useState(false);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<{ ordenId: number, procesoId: number, newStatusId: number, idOtp?: number } | null>(null);

  const confirmStatusChange = () => {
    if (pendingStatusUpdate) {
      executeProcessStatusChange(pendingStatusUpdate.ordenId, pendingStatusUpdate.procesoId, pendingStatusUpdate.newStatusId, pendingStatusUpdate.idOtp);
      setPendingStatusUpdate(null);
    }
    setIsStatusConfirmOpen(false);
  };

  // `idOtp` = orden_trabajo_proceso.id, la PASADA puntual. El mismo proceso puede ir
  // varias veces en la OT, así que sin esto el backend tiene que adivinar cuál.
  const handleProcessStatusChange = async (ordenId: number, procesoId: number, newStatusId: number, idOtp?: number) => {
    // Find current status
    const order = ordenesTrabajo.find(o => o.id === ordenId);
    if (!order) return;
    const process = order.procesos.find(p => p.proceso.id === procesoId);
    if (!process) return;

    const currentStatusId = process.estado_proceso.id;

    // Check if reverting from Finalizado (3) to Pendiente (1)
    if (currentStatusId === 3 && newStatusId === 1) {
      setPendingStatusUpdate({ ordenId, procesoId, newStatusId, idOtp });
      setIsStatusConfirmOpen(true);
      return;
    }

    // Otherwise proceed directly
    executeProcessStatusChange(ordenId, procesoId, newStatusId, idOtp);
  };

  const executeProcessStatusChange = async (ordenId: number, procesoId: number, newStatusId: number, idOtp?: number) => {
    // 1. Optimistic update local state (ordenesTrabajo)
    setOrdenesTrabajo(prev => prev.map(order => {
      if (order.id !== ordenId) return order;
      return {
        ...order,
        procesos: order.procesos.map(proc => {
          // Por PASADA si se sabe cuál; si no, por proceso (igual que antes).
          if (idOtp != null ? proc.id !== idOtp : proc.proceso.id !== procesoId) return proc;

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
        body: JSON.stringify({ id_estado: newStatusId, id_otp: idOtp }),
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
              // Si vino la pasada, se toca sólo esa; si no, se cae al proceso (una OT
              // sin repetidos se comporta igual que antes).
              if (idOtp != null ? proc.id !== idOtp : proc.proceso.id !== procesoId) return proc;
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
            // Sin la pasada, reordenar una OT con el mismo proceso repetido movía
            // siempre la misma fila.
            id_otp: p.id,
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

    // Un cálculo nuevo es un borrador NUEVO, no una versión del anterior. Sin esta
    // línea el autosave seguía estampando el id del borrador viejo y en la base eso
    // es un UPDATE del contenido: planificar de nuevo pisaba el borrador de antes y
    // no quedaba rastro de lo pisado (31/08: uno de 8 OT quedó en 1 OT).
    empezarNuevo();

    // Call API for preview
    try {
      setCalculando({ activo: true, ots: ids.length, listo: false });
      // La foto de Recursos se pide JUNTO con el cálculo, no después: así no suma
      // latencia, y queda claro que es "cómo estaban los datos cuando se planificó".
      const huellaPromesa = huellaRecursos();
      // Con timeout: el 15/08 el servidor murió a mitad de un cálculo y el
      // "Calculando planificación..." quedó clavado para siempre — sin límite,
      // un request muerto es indistinguible de uno lento.
      //
      // Los 7 minutos son el número más chico de toda la cadena, así que es ÉSTE el
      // que decide cuánto se banca una tanda grande: con los 3 que había, una de 60
      // OT —244 segundos medidos— la cortaba el navegador aunque el servidor la
      // terminara bien, y el trabajo se perdía entero.
      //
      // De dónde sale el 420 y no el 300 que parecía alcanzar. Aquellos 244 segundos
      // se midieron con el presupuesto del solver ya puesto en 240, así que son
      // ~240 de solver más una decena de armar y volcar. Con el presupuesto que
      // ahora calcula el backend por tamaño de lote, el techo sigue siendo 240 —o
      // sea que el piso de una tanda grande no baja— y todo lo que crezca alrededor
      // (leer más OTs, más diagnósticos) se suma encima. 300 dejaba 56 segundos de
      // aire sobre una medición sola; 420 deja casi tres minutos y sigue lejos de
      // los 600 a los que corta el servidor, que es el tope duro que no conviene
      // tocar. Es mejor esperar de más una vez que perder una tanda de 60 OT.
      const response = await fetch(`${API_URL}/planificar`, {
        method: "POST",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(420_000),
        body: JSON.stringify({
          ordenes_ids: ids,
          preview: true,
          fecha_desde: range.fecha_desde,
          fecha_hasta: range.fecha_hasta,
        }),
      });

      // La respuesta llegó: la barra se completa. El overlay se baja en el finally,
      // recién cuando terminó también de armarse la vista previa.
      setCalculando(c => ({ ...c, listo: true }));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.detail || `El servidor respondió con un error (${response.status}). Probá de nuevo o con menos OTs.`);
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
      const enrich = (res: any) => {
        const order = ordenesTrabajo.find(o => o.id === res.orden_id);
        const operario = rawOperarios.find(op => op.id === res.id_operario);
        const maquina = rawMaquinarias.find(m => m.id === res.id_maquinaria);

        // Las fechas del plan las calcula el backend con la jornada real del taller
        // (07:00 a 16:00 con pausas) y con el arranque de ESTE plan. Acá se hacía
        // `ahora + inicio_min` en minutos de reloj corrido: la vista previa prometía
        // trabajo a las 3 de la mañana y de madrugada de un domingo.
        const startDate = inicioDeLaFila(res) || baseDelPlan(res);
        const endDate = finDeLaFila(res) || startDate;

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
      const diags = Array.isArray(responseData?.diagnosticos) ? responseData.diagnosticos : [];
      setDiagnosticosPlan(diags);

      // El cálculo recién terminado es lo caro de todo esto: se guarda sin esperar
      // el debounce, antes de que el usuario llegue a tocar nada.
      const huella = await huellaPromesa;
      baseBorrador.current = {
        ordenesIds: ids,
        rango: range,
        resultados: enrichedResults,
        excedentes: enrichedExcedentes,
        diagnosticos: diags,
        // El arranque del plan, tal como lo devolvió el backend. Viaja con el
        // borrador y vuelve al confirmar: es lo que ata las fechas que se miran a
        // las fechas que se guardan.
        inicioBase: responseData?.inicio_base,
        huella,
      };
      setHuellaPlan(huella);
      // Plan nuevo: no hay retoques, ni nada agregado a mano, ni ajustes que restaurar.
      // Los ajustes valen para EL plan en el que se aplicaron, no para el próximo: si
      // no se limpian acá, el plan nuevo saldría con la fresadora abierta del plan
      // anterior y no habría forma de saber por qué no coincide con los datos.
      setEdicionesIniciales({});
      setForzarIdsIniciales([]);
      setTandasIniciales([]);
      setAjustesIniciales([]);
      retoquesBorrador.current = { ediciones: {}, forzarOrdenIds: [] };
      tandasBorrador.current = [];
      ajustesBorrador.current = [];
      setPlanCalculadoEn(new Date().toISOString());
      void guardarYa({
        ...baseBorrador.current,
        ediciones: {},
        forzarOrdenIds: [],
        tandasManuales: [],
        ajustesDelPlan: [],
        guardadoEn: new Date().toISOString(),
      });

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
        return getWeekKey(inicioDeLaFila(r) || baseDelPlan(r));
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
      // Distinguir "tardó demasiado / se cortó" de cualquier otro error: son
      // acciones distintas para el usuario (esperar y reintentar vs avisar).
      const esTimeout = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
      toast.error(
        esTimeout
          ? "El cálculo tardó demasiado y se cortó. Probá con menos OTs o un rango de fechas más corto."
          : "No se pudo calcular la planificación: se cortó la conexión con el servidor. Probá de nuevo."
      );
    } finally {
      // En el finally y no en cada salida: hay varios `return` tempranos y con uno
      // solo que se olvide, la pantalla queda tapada por el overlay para siempre.
      setCalculando({ activo: false, ots: 0, listo: false });
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
    lineasPorOrden?: Record<number, number[]>,
    ajustes?: AjustesDelPlanPayload,
  ) => {
    if (ids.length === 0) {
      toast.error("No hay OTs para recalcular.");
      return;
    }
    setIsPreviewCalculating(true);
    setCalculando({ activo: true, ots: ids.length, listo: false });
    setSelectedOrderIds(ids);
    setPlanningRange(range);

    try {
      // Igual que en el primer cálculo: la foto de Recursos se pide en paralelo, y
      // el mismo tope de 5 minutos (el motivo está escrito en `handlePlanSelection`).
      const huellaPromesa = huellaRecursos();
      const response = await fetch(`${API_URL}/planificar`, {
        method: "POST",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(420_000),
        body: JSON.stringify({
          ordenes_ids: ids,
          preview: true,
          fecha_desde: range.fecha_desde,
          fecha_hasta: range.fecha_hasta,
          forzar_ordenes_ids: forzarIds.length > 0 ? forzarIds : undefined,
          // D1: si se eligieron procesos sueltos, se mandan para planificar solo esos de
          // esas OTs. Van ids de PASADA (orden_trabajo_proceso.id), no de proceso: el
          // mismo proceso puede estar varias veces en la OT y se elige de a una.
          lineas_por_orden: lineasPorOrden && Object.keys(lineasPorOrden).length > 0 ? lineasPorOrden : undefined,
          // Las soluciones aplicadas "solo para este plan": el backend las usa en
          // memoria para armar el cálculo y no escribe nada. Tienen que ir en TODOS
          // los recálculos, no sólo en el que las aplica — forzar una OT, quitar
          // otra, deshacer una tanda o la revisión automática al volver de Recursos
          // pasan por acá también, y sin esto cualquiera de esos devolvía el plan a
          // lo que dice la base con la tira de ajustes todavía en pantalla.
          ajustes_del_plan: ajustes,
        }),
      });

      setCalculando(c => ({ ...c, listo: true }));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.detail || "Error al recalcular planificación");
        return;
      }

      const responseData = await response.json();
      const planificadosRaw: any[] = Array.isArray(responseData) ? responseData : (responseData.planificados || []);
      const excedentesRaw: any[] = Array.isArray(responseData) ? [] : (responseData.excedentes || []);

      const enrich = (res: any) => {
        const order = ordenesTrabajo.find(o => o.id === res.orden_id);
        const operario = rawOperarios.find(op => op.id === res.id_operario);
        const maquina = rawMaquinarias.find(m => m.id === res.id_maquinaria);
        // Misma regla que el otro camino: la fecha la trae el backend.
        const startDate = inicioDeLaFila(res) || baseDelPlan(res);
        const endDate = finDeLaFila(res) || startDate;
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

      const recalcResultados = planificadosRaw.map(enrich);
      const recalcExcedentes = excedentesRaw.map(enrich);
      const recalcDiags = Array.isArray(responseData?.diagnosticos) ? responseData.diagnosticos : [];
      setPreviewResults(recalcResultados);
      setExcedentesResults(recalcExcedentes);
      setDiagnosticosPlan(recalcDiags);

      const huella = await huellaPromesa;
      baseBorrador.current = {
        ordenesIds: ids,
        rango: range,
        resultados: recalcResultados,
        excedentes: recalcExcedentes,
        diagnosticos: recalcDiags,
        inicioBase: responseData?.inicio_base,
        huella,
      };
      setHuellaPlan(huella);
      setPlanCalculadoEn(new Date().toISOString());
      // Un recálculo NO empieza de cero: la vista previa se queda con lo agregado a
      // mano, con los retoques y con los ajustes de este plan, así que el borrador
      // tiene que guardarlos también. Escribir vacío acá los borraba de la base sin
      // que nadie hubiera deshecho nada, y este guardado limpia el debounce, así que
      // tampoco volvían después. Con los ajustes es todavía peor: no están en
      // Recursos, o sea que perderlos acá es perderlos para siempre.
      // Para cuando llega acá los tres están al día: la vista previa avisa en el
      // render que sigue al click y esto corre recién cuando contestó el solver.
      void guardarYa({
        ...baseBorrador.current,
        ...retoquesBorrador.current,
        tandasManuales: tandasBorrador.current,
        ajustesDelPlan: ajustesBorrador.current,
        guardadoEn: new Date().toISOString(),
      });

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
      setCalculando({ activo: false, ots: 0, listo: false });
    }
  };

  /** El borrador entero, armado con el plan que devolvió el solver más todo lo que
   *  la vista previa fue avisando. Guarda en el navegador al instante y en la base
   *  a los pocos segundos. */
  const registrarBorrador = useCallback(() => {
    const base = baseBorrador.current;
    // Sin base no hay plan calculado todavía: el modal dispara estos avisos al
    // montarse, con todo vacío, y eso no es un borrador.
    if (!base) return;
    registrarCambio({
      ...base,
      ...retoquesBorrador.current,
      tandasManuales: tandasBorrador.current,
      ajustesDelPlan: ajustesBorrador.current,
      guardadoEn: new Date().toISOString(),
    });
  }, [registrarCambio]);

  /** Cada retoque de la vista previa (máquina, operario, horario, forzar una OT). */
  const handleEdicionesBorrador = useCallback((ediciones: Record<string, any>, forzarOrdenIds: number[]) => {
    retoquesBorrador.current = { ediciones, forzarOrdenIds };
    registrarBorrador();
  }, [registrarBorrador]);

  /** Cada cambio en lo que se agregó a mano (tandas nuevas, deshacer, quitar una
   *  OT o una pasada). Sin esto el borrador volvía sin nada agregado a mano y el
   *  primer recálculo le devolvía a cada OT todos sus procesos. */
  /**
   * Pone todos los pasos de las OTs tildadas en el mismo estado, de una.
   *
   * Va por un endpoint que lo hace en UNA transacción y no por un PUT por paso:
   * cinco OTs de diez pasos son cincuenta requests, y si uno falla a la mitad la
   * orden queda hecha por la mitad sin que nadie lo haya decidido.
   */
  const aplicarEstadoMasivo = async () => {
    if (estadoMasivo === null) return;
    const ids = [...selectedPlanIds];
    try {
      setEstadoMasivoEnCurso(true);
      const res = await fetch(`${API_URL}/ordenes/estado-masivo`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ orden_ids: ids, id_estado: estadoMasivo }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => null);
      const pasos = data?.data?.procesos;
      toast.success(
        estadoMasivo === 3
          ? `${ids.length} orden${ids.length === 1 ? "" : "es"} marcada${ids.length === 1 ? "" : "s"} como terminada${ids.length === 1 ? "" : "s"}`
          : `${ids.length} orden${ids.length === 1 ? "" : "es"} vuelta${ids.length === 1 ? "" : "s"} a pendiente`,
        pasos ? { description: `${pasos} paso${pasos === 1 ? "" : "s"} actualizado${pasos === 1 ? "" : "s"}.` } : undefined,
      );
      setSelectedPlanIds([]);
      await fetchData();
    } catch (error) {
      console.error("Error en el cambio de estado masivo:", error);
      toast.error("No se pudo cambiar el estado. No se modificó ninguna orden.");
    } finally {
      setEstadoMasivoEnCurso(false);
      setEstadoMasivo(null);
    }
  };

  /** Abrir la OT. Es lo que hace el doble clic en CUALQUIERA de las listas: en
   *  Semanal, Diaria y Terminadas el doble clic no hacía nada y la fila prometía en
   *  su globito que sí («un click para ver el detalle · doble clic para abrir la OT»),
   *  así que parecía que la pantalla se había colgado. */
  const abrirOT = (item: WorkOrder) => {
    setOrderToEdit(item);
    setIsCreateModalOpen(true);
  };

  const handleTandasBorrador = useCallback((tandas: TandaManual[]) => {
    tandasBorrador.current = tandas;
    registrarBorrador();
  }, [registrarBorrador]);

  /**
   * Cada cambio en las soluciones aplicadas "solo para este plan".
   *
   * Es lo único del borrador que no tiene copia en ningún lado: los retoques se
   * pueden volver a hacer mirando el plan, las tandas se pueden volver a agregar,
   * pero un ajuste local no está en la base ni en el plan que devolvió el solver.
   * Si no sube acá, cerrar la pestaña lo borra sin dejar rastro.
   */
  const handleAjustesBorrador = useCallback((ajustes: AjusteDelPlan[]) => {
    ajustesBorrador.current = ajustes;
    registrarBorrador();
  }, [registrarBorrador]);

  /** Retomar un plan calculado y sin confirmar: se abre tal cual quedó, sin
   *  recalcular. Lo que se pierde recalculando son los minutos del solver y los
   *  retoques hechos a mano, así que se restauran los dos. */
  const handleAbrirBorrador = (borrador: BorradorPlan) => {
    setPreviewResults(borrador.resultados || []);
    setExcedentesResults(borrador.excedentes || []);
    setDiagnosticosPlan(borrador.diagnosticos || []);
    setSelectedOrderIds(borrador.ordenesIds || []);
    setPlanningRange(borrador.rango || {});
    baseBorrador.current = {
      ordenesIds: borrador.ordenesIds || [],
      rango: borrador.rango || {},
      resultados: borrador.resultados || [],
      excedentes: borrador.excedentes || [],
      diagnosticos: borrador.diagnosticos || [],
      // Un borrador se confirma con el arranque con el que se CALCULÓ, aunque se
      // retome tres días después. Los guardados antes del 16/09/2026 no lo tienen y
      // el backend recalcula, como venía haciendo.
      inicioBase: borrador.inicioBase,
      huella: borrador.huella ?? null,
    };
    // La huella es la del MOMENTO DEL CÁLCULO, no la de ahora: si se tomara ahora,
    // un borrador de ayer nunca detectaría lo que se arregló anoche.
    setHuellaPlan(borrador.huella ?? null);
    // Acá sí hay retoques que restaurar: el comentario de abajo lo prometía desde
    // el 19/08 pero la vista previa nunca los recibía y se perdían todos.
    setEdicionesIniciales(borrador.ediciones || {});
    setForzarIdsIniciales(borrador.forzarOrdenIds || []);
    // Lo agregado a mano vuelve con el borrador. Los guardados antes del 11/09 no lo
    // traen: ésos se abren como se abrían, sin nada marcado, y no se rompe nada.
    setTandasIniciales(borrador.tandasManuales || []);
    // Lo mismo con las soluciones aplicadas sólo a este plan: no están en Recursos,
    // así que si no vuelven de acá no vuelven de ningún lado, y el primer recálculo
    // devolvería el plan a lo que dicen los datos con la traba de vuelta. Los
    // borradores anteriores al 17/09/2026 no lo traen: se abren sin ningún ajuste,
    // igual que antes.
    setAjustesIniciales(borrador.ajustesDelPlan || []);
    retoquesBorrador.current = {
      ediciones: borrador.ediciones || {},
      forzarOrdenIds: borrador.forzarOrdenIds || [],
    };
    tandasBorrador.current = borrador.tandasManuales || [];
    // El ref se pisa acá y no se espera al aviso de la vista previa: ese llega recién
    // en el render siguiente, y si en el medio se dispara un guardado el borrador
    // recién retomado se guardaría sin sus ajustes —o sea, borrándolos.
    ajustesBorrador.current = borrador.ajustesDelPlan || [];
    setPlanCalculadoEn(borrador.guardadoEn);
    // El autosave pasa a pisar ESTE borrador en vez de crear uno nuevo.
    adoptar(borrador);
    setIsSelectionModalOpen(false);
    setIsPreviewOpen(true);
  };

  /** Salir del planificador sin confirmar no descarta nada: se sincroniza ya, sin
   *  esperar el debounce, así el borrador queda completo para el que lo retome. */
  const handleSalirDelPlanificador = () => {
    void guardarYa();
    setIsPreviewOpen(false);
    setIsSelectionModalOpen(false);
  };

  /** Mientras se planifica, Operaciones cede la pantalla entera. */
  const planificadorAbierto = isSelectionModalOpen || isPreviewOpen;

  const handleConfirmPlan = async (manualPlanOrForzar?: any[] | { forzarOrdenIds: number[] }) => {
    try {
      setIsConfirmingPlan(true);

      // Confirmar escribe el plan que está en pantalla y en un lote grande eso
      // igual son varios segundos de ida y vuelta. Hasta el 10/09 no mostraba nada:
      // Lucas estuvo 62 segundos frente a una pantalla muda y concluyó "se clavó,
      // ¿no?". Frenaron la planificación por eso. La vista previa sí lo mostraba;
      // faltaba acá. (Ese día confirmar todavía volvía a pasar por el solver; ya no,
      // pero la pantalla muda seguiría estando mal igual.)
      setCalculando({ activo: true, ots: selectedOrderIds.length, listo: false, modo: "guardar" });

      // Con qué arreglos "solo para este plan" se calculó lo que se está por guardar.
      //
      // Se lee ACÁ, arriba de todo, y no cerca del fetch: el final de este mismo
      // handler vacía `ajustesBorrador.current` y `olvidar()` borra el borrador, o
      // sea que ésta es la última vez que los ajustes existen en algún lado —no
      // están en Recursos ni vienen adentro del plan que devolvió el solver—.
      //
      // El backend NO los aplica en este camino: guardar copia el plan que se
      // aprobó en pantalla, no lo recalcula. Van para que quede RASTRO. El log de
      // "planificar() con ajustes" está puesto arriba del early-return del plan ya
      // armado justo para esto, y sin mandarlos no se imprimía nunca: un plan se
      // guardaba con una prensa que, según Recursos, esa persona no puede usar, y
      // no había una sola línea en ningún lado que lo dijera.
      const ajustesDelPlanGuardado = payloadDeAjustes(ajustesBorrador.current);

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

      // Mismo tope de 5 minutos que el cálculo aunque acá no haya solver: es una
      // escritura de todos los procesos del lote, y cortarla antes de tiempo es
      // peor que cortar un cálculo —el plan queda sin guardar después de que
      // alguien ya lo aprobó, y hay que volver a revisarlo entero—.
      const response = await fetch(`${API_URL}/planificar`, {
        method: "POST",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(420_000),
        body: JSON.stringify({
          ordenes_ids: finalOrdenIds,
          preview: false,
          plan: manualPlan,
          fecha_desde: planningRange.fecha_desde,
          fecha_hasta: planningRange.fecha_hasta,
          forzar_ordenes_ids: forzarOrdenIds,
          // Cuál borrador se está confirmando, para que el backend borre ESE y
          // ninguno más. Sin esto lo adivinaba por el lote de OTs y se llevaba
          // puestos todos los borradores contenidos en la tanda, propios y ajenos.
          borrador_id: idBorradorEnBase(),
          // El arranque con el que se armó ESTE plan. Sin esto el backend le vuelve
          // a preguntar la hora al reloj al guardar, y un plan mirado a las 06:59 y
          // confirmado a las 07:01 se guarda con un día de más.
          inicio_base: baseBorrador.current?.inicioBase,
          // Los arreglos con los que se calculó este plan. No cambian nada de lo que
          // se escribe —el plan va tal cual se aprobó—: son el rastro de por qué el
          // plan guardado no le cierra a quien mañana lo compare con Recursos.
          ajustes_del_plan: ajustesDelPlanGuardado,
        }),
      });

      if (!response.ok) {
        toast.error("Error al guardar planificación");
        return;
      }

      // El id de la planificación recién guardada, para dejar la pantalla parada en
      // ELLA. Antes el cuerpo de la respuesta no se leía nunca y al volver a
      // Operaciones aparecías donde estabas: con el desplegable en cualquier plan
      // viejo, mirando el trabajo de otro mes.
      const guardado = await response.json().catch(() => null);
      const loteNuevo = guardado?.planificados?.id_planificacion_lote;

      toast.success("Planificación guardada exitosamente");
      // Dejó de ser un borrador: ahora es el plan. Si no se olvida acá, la próxima
      // vez Planificar Órdenes ofrece "retomar" algo que ya está confirmado.
      olvidar();
      baseBorrador.current = null;
      setIsPreviewOpen(false);
      setIsSelectionModalOpen(false);
      setSelectedOrderIds([]);
      setPlanningRange({});
      setExcedentesResults([]);
      // Que no queden colgados para el próximo plan: la huella es de un plan que
      // ya no existe y los retoques eran de ese borrador.
      setHuellaPlan(undefined);
      setEdicionesIniciales({});
      setForzarIdsIniciales([]);
      setTandasIniciales([]);
      // Los ajustes valían para ESTE plan, que ya se guardó: dejarlos colgados haría
      // que la próxima planificación arranque con la fresadora abierta de ésta, y
      // saliendo distinta de los datos sin que nadie hubiera pedido nada.
      setAjustesIniciales([]);
      retoquesBorrador.current = { ediciones: {}, forzarOrdenIds: [] };
      tandasBorrador.current = [];
      ajustesBorrador.current = [];

      // GUARDAR TERMINA ACÁ. El plan ya está escrito.
      //
      // Antes se seguía esperando `fetchData()` con el cartel arriba, y eso son
      // varios segundos más: vuelve a traer los operarios, las 1267 órdenes y la
      // planificación entera. O sea que el plan estaba guardado y la pantalla
      // seguía diciendo «guardando», por trabajo que no cambia nada de lo que se
      // acaba de hacer.
      //
      // Julián (11/9): «el guardado tiene que ser instantáneo al terminar la
      // planificación y quede planificada».
      //
      // Así que el cartel se va y las listas se refrescan solas, por su cuenta.
      // No se pierde nada: `fetchData` prende su propio `isLoading` y cada lista
      // muestra que se está actualizando, sin tapar la pantalla ni hacer esperar.
      setIsConfirmingPlan(false);
      setCalculando({ activo: false, ots: 0, listo: false, modo: "calcular" });

      // El plan recién hecho es el que hay que mirar: se cae en Órdenes de Trabajo >
      // Planificadas > Pendientes, con esa planificación elegida. El lote se setea
      // DESPUÉS de que `fetchData` trajo sus filas; si se hiciera antes, el desplegable
      // quedaría un instante mostrando un plan del que todavía no llegó nada.
      setActiveTab("work_orders");
      setOtSubTab("planificadas");
      setPlanSubTab("general");
      setSelectedPlanIds([]);
      void fetchData().then((filas) => {
        // Sólo se salta a la planificación nueva si el refresco la trajo de verdad.
        // `fetchData` se traga los errores del GET a propósito (es un refresco de
        // fondo), así que sin esta guarda un error de red dejaba la pantalla parada en
        // un lote vacío: el plan estaba guardado y parecía perdido.
        if (!loteNuevo) return;
        const llego = (filas || []).some((f: any) => f.id_planificacion_lote === loteNuevo);
        if (!llego) {
          toast.error("El plan se guardó bien, pero no se pudo actualizar la pantalla. Recargá.");
          return;
        }
        yaSeEligioLote.current = true;
        setSelectedLoteId(loteNuevo);
      });
      return;

    } catch (error) {
      toast.error("Error al guardar la planificación");
    } finally {
      // Sólo corre si algo falló antes del return de arriba: en el camino feliz
      // esto ya se apagó y el usuario está de vuelta en Operaciones.
      setIsConfirmingPlan(false);
      setCalculando({ activo: false, ots: 0, listo: false, modo: "calcular" });
    }
  };

  /** Saca del plan las OTs tildadas (se planificaron por error / ya no van).
   *  El lote sigue existiendo con el resto; las OTs vuelven a "No Planificadas". */
  const handleQuitarOtsSeleccionadas = async () => {
    if (selectedPlanIds.length === 0) return;

    try {
      setIsQuitandoOts(true);
      const response = await fetch(`${API_URL}/planificacion/quitar-ordenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          orden_ids: selectedPlanIds,
          // Si se está viendo una planificación puntual, solo se saca de esa;
          // con "Todas las Planificaciones" se saca de todas donde aparezca.
          id_lote: selectedLoteId !== "all" ? selectedLoteId : null,
        }),
      });

      if (!response.ok) throw new Error("Error al quitar las OTs de la planificación");

      const n = selectedPlanIds.length;
      toast.success(n === 1 ? "OT quitada de la planificación" : `${n} OTs quitadas de la planificación`);
      setSelectedPlanIds([]);
      await fetchData();
    } catch (error) {
      console.error("Error removing orders from planning:", error);
      toast.error("Error al quitar las OTs de la planificación");
    } finally {
      setIsQuitandoOts(false);
      setIsQuitarOtsDialogOpen(false);
    }
  };

  /**
   * Borra todas las planificaciones viejas de una. La vigente nunca entra.
   *
   * No hay deshacer: el backend guarda un resumen de lo borrado (cuántas filas, cuántas
   * OT, quién y cuándo) pero no copia las filas a ningún lado. Por eso el cartel dice
   * con todas las letras qué se lleva, en vez de frenar.
   */
  const handleLimpiarViejas = async () => {
    setLimpiandoViejas(true);
    let borrados = 0;
    try {
      for (const lote of lotesViejos) {
        const res = await fetch(`${API_URL}/planificacion/lote/${lote.id}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
        if (res.ok) borrados++;
      }
      if (borrados === lotesViejos.length) {
        toast.success(`${borrados} planificación${borrados === 1 ? "" : "es"} eliminada${borrados === 1 ? "" : "s"}`);
      } else {
        toast.warning(`Se eliminaron ${borrados} de ${lotesViejos.length}. Probá de nuevo con las que quedaron.`);
      }
      setSelectedLoteId(uniqueLotes[0]?.id ?? "all");
      await fetchData();
    } catch (error) {
      console.error("Error limpiando planificaciones viejas:", error);
      toast.error("No se pudieron eliminar las planificaciones viejas");
    } finally {
      setLimpiandoViejas(false);
      setIsLimpiarViejasOpen(false);
    }
  };

  /** "Planificación Septiembre 2026 (16/9/2026 11:00)". Estaba escrito adentro del
   *  desplegable; ahora lo usan también el botón de borrar y su confirmación, para que
   *  el cartel diga QUÉ se está por borrar y no "esta planificación". */
  const nombreDelLote = (lote: { descripcion: string; date: string }) => {
    const cuando = new Date(lote.date);
    let label = lote.descripcion;
    if (label.toLowerCase().includes("planificación")) {
      const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
      label = `Planificación ${capitalize(format(cuando, "MMMM yyyy", { locale: es }))}`;
    }
    const hora = cuando.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${label} (${cuando.toLocaleDateString()} ${hora})`;
  };

  /**
   * El nombre corto, para el botón: "Sep 2026 · 16/9 11:00".
   *
   * En el desplegable va el nombre largo, que es donde hay lugar; en el botón no
   * entraba y se cortaba en «Planificación Septiembre 2026 (10». La fecha y la hora
   * son lo único que distingue dos planificaciones del mismo mes, así que son lo que
   * no se puede perder.
   */
  const nombreCortoDelLote = (lote: { descripcion: string; date: string }) => {
    const cuando = new Date(lote.date);
    const mes = format(cuando, "MMM yyyy", { locale: es });
    return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} · ${format(cuando, "d/M HH:mm")}`;
  };

  /** Lo que dice el botón del selector según lo que esté elegido. */
  const etiquetaPlanElegido = (() => {
    if (selectedLoteId === "all") return "Todas";
    const lote = uniqueLotes.find(l => l.id === selectedLoteId);
    return lote ? nombreCortoDelLote(lote) : "Elegí una";
  })();

  /** Cuánto se lleva puesto borrar una planificación: OTs y renglones. */
  const tamanoDelLote = (id: string) => {
    const filas = rawPlanificacion.filter(p => p.id_planificacion_lote === id);
    return { renglones: filas.length, ots: new Set(filas.map(f => f.orden_id)).size };
  };

  /** Las planificaciones que no son la vigente. La más nueva nunca entra. */
  const lotesViejos = React.useMemo(() => uniqueLotes.slice(1), [uniqueLotes]);

  const handleDeleteLote = async () => {
    if (selectedLoteId === "all") return;

    try {
      setIsDeletingLote(true);
      const response = await fetch(`${API_URL}/planificacion/lote/${selectedLoteId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (!response.ok) throw new Error("Error al eliminar el lote de planificación");

      toast.success("Planificación eliminada");
      // Queda parado en la más nueva que sobrevivió. Volvía a "Todas", y como el tacho
      // está deshabilitado con "Todas", para borrar la siguiente había que volver a
      // elegirla — y elegirla mandaba toda la pantalla a ese mes.
      const queQuedan = uniqueLotes.filter(l => l.id !== selectedLoteId);
      setSelectedLoteId(queQuedan[0]?.id ?? "all");
      await fetchData();
    } catch (error) {
      console.error("Error deleting planning batch:", error);
      toast.error("Error al eliminar el lote de planificación");
    } finally {
      setIsDeletingLote(false);
      setIsDeleteLoteDialogOpen(false);
    }
  };


  /**
   * LA PANTALLA DE PLANIFICACIÓN, que ahora vive adentro de «Planificadas».
   *
   * Eran dos pantallas separadas —Órdenes de Trabajo → Planificadas y la solapa
   * Planificación— que mostraban lo mismo con distinto nivel de detalle: una con
   * los horarios y otra sin ellos, cada una con su propia idea de qué está
   * planificado. Julián, 16/09/2026: «creo que podemos unificar esta sección de
   * planificación en planificadas y listo, meter todo ahí».
   *
   * El estado sigue viviendo acá arriba (el plan elegido, el día, los tildes) y lo
   * que baja es el árbol ya armado: `WorkOrdersListWrapper` lo dibuja adentro de su
   * solapa, sin saber nada de planificación.
   */
  const pantallaDePlanificacion = (
            <Tabs
              value={planSubTab}
              onValueChange={(v) => { setPlanSubTab(v); setSelectedPlanIds([]); }}
              className="w-full flex-1 flex flex-col"
            >
              {/* LA BARRA DE ARRIBA, EN DOS RENGLONES QUE CONTESTAN DOS PREGUNTAS.

                  Estaba todo en uno solo y no entraba: los cinco controles envolvían a
                  tres renglones contra la derecha mientras la izquierda tenía sólo el riel,
                  y el hueco que quedaba entre medio era más alto que la tabla. Encima el
                  nombre de la planificación se cortaba en «Planificación Septiembre 2026 (10».

                  Renglón 1 — QUÉ PLAN se está mirando, y qué se puede hacer con él.
                  Renglón 2 — QUÉ PARTE de ese plan se muestra, y con qué zoom. */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Select
                  value={selectedLoteId}
                  onValueChange={(v) => {
                    if (v === LIMPIAR_VIEJAS) { setIsLimpiarViejasOpen(true); return; }
                    setSelectedLoteId(v);
                  }}
                >
                  <SelectTrigger
                    className="h-9 w-full min-w-0 max-w-[340px] gap-1.5 border-gray-200 bg-white text-xs sm:w-auto sm:min-w-[230px]"
                    title="Qué planificación se está mirando"
                  >
                    <CalendarClock className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                    <span className="hidden shrink-0 font-normal text-gray-400 xl:inline">Plan</span>
                    <span className="truncate font-medium">{etiquetaPlanElegido}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las Planificaciones</SelectItem>
                    {uniqueLotes.map((lote, i) => (
                      <SelectItem key={lote.id} value={lote.id}>
                        {nombreDelLote(lote)}{i === 0 ? " · la que está corriendo" : ""}
                      </SelectItem>
                    ))}
                    {/* Limpiar las viejas de una: borrar una son cuatro clicks y hay que
                        ELEGIRLA primero, lo que manda toda la pantalla a ese mes. La
                        vigente —la primera de la lista— nunca entra. */}
                    {lotesViejos.length > 0 && (
                      <SelectItem value={LIMPIAR_VIEJAS} className="text-red-600">
                        Limpiar planificaciones viejas ({lotesViejos.length})
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <div className="ml-auto flex items-center gap-2">
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
                  {/* Eliminar la planificación entera. Antes este mismo botón hacía DOS
                      cosas según hubiera OTs tildadas o no —borrar el plan o sacar esas
                      OTs— y cuál de las dos no se veía hasta después de apretarlo.
                      Sacar las tildadas se mudó a la barra de selección, que aparece
                      sola y dice qué hace. */}
                  {(() => {
                    const deshabilitado = selectedLoteId === "all" || isDeletingLote || isQuitandoOts;
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsDeleteLoteDialogOpen(true)}
                        className={cn(
                          "bg-white border-red-200 transition-colors gap-1.5",
                          deshabilitado
                            ? "text-gray-400 border-gray-200 cursor-not-allowed hover:bg-white"
                            : "text-red-600 hover:bg-red-50"
                        )}
                        disabled={deshabilitado}
                        title={selectedLoteId === "all"
                          ? "Elegí una planificación para poder eliminarla"
                          : "Eliminar esta planificación entera"}
                      >
                        <Trash2 className={cn("h-3.5 w-3.5", deshabilitado ? "text-gray-400" : "text-red-600")} />
                        <span className="text-xs font-semibold">Eliminar plan</span>
                      </Button>
                    );
                  })()}
                </div>
              </div>

              <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
                <ScrollableTabsBar className="rounded-full bg-gray-100/90 p-1 ring-1 ring-black/[0.03]">
                <TabsTrigger
                  value="general"
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:text-gray-800 data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-black/5"
                  title="Todo lo que falta hacer de la planificación elegida"
                >
                  Pendientes
                  {otsPendientes.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 ring-1 ring-black/[0.04]">
                      {otsPendientes.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="semanal"
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:text-gray-800 data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-black/5"
                  title="Lo que falta hacer en la semana que estás mirando"
                >
                  Semanal
                  {otsDeLaSemana.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 ring-1 ring-black/[0.04]">
                      {otsDeLaSemana.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="diaria"
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:text-gray-800 data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-black/5"
                  title="Lo que falta hacer el día que estás mirando"
                >
                  Diaria
                  {otsDelDia.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 ring-1 ring-black/[0.04]">
                      {otsDelDia.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="completadas"
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:text-gray-800 data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-black/5"
                  title="El cliente ya las recibió completas"
                >
                  Entregadas al cliente
                  {completedPlannedOrdenes.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-green-100 text-green-700 px-1.5 py-0.5 text-[10px] font-semibold">
                      {completedPlannedOrdenes.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="finalizadas"
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:text-gray-800 data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-black/5"
                  title="El taller las terminó y todavía no se entregaron"
                >
                  Terminadas en el taller
                  {otsTerminadasSinEntregar.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-semibold">
                      {otsTerminadasSinEntregar.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="carga"
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:text-gray-800 data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-black/5"
                >
                  Carga
                </TabsTrigger>
                </ScrollableTabsBar>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Selector de semana (al lado del zoom): muestra la semana visualizada
                      y permite cambiarla. Comparte estado con las vistas Semanal/Diaria
                      (customRefDate / lote / hoy). */}
                  {(() => {
                    const refDate = fechaReferencia;
                    const day = refDate.getDay();
                    const monday = new Date(refDate);
                    monday.setDate(refDate.getDate() - day + (day === 0 ? -6 : 1));
                    const sunday = new Date(monday);
                    sunday.setDate(monday.getDate() + 6);
                    const fmtD = (d: Date) => format(d, "d MMM", { locale: es });
                    return (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="bg-white border-gray-200 text-xs gap-1.5" title="Semana visualizada — clic para cambiarla">
                            <CalendarClock className="h-3.5 w-3.5 text-gray-500" />
                            <span className="hidden xl:inline text-gray-400 font-normal">Semana</span>
                            <span className="font-medium">{fmtD(monday)}–{fmtD(sunday)}</span>
                            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <div className="border-b px-3 py-2 flex items-center justify-between gap-4">
                            <p className="text-xs font-semibold text-gray-700">Elegí una semana</p>
                            {!mirandoHoy && (
                              <button onClick={() => setCustomRefDate(null)} className="text-[11px] text-blue-600 hover:underline">Volver a hoy</button>
                            )}
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
                        </PopoverContent>
                      </Popover>
                    );
                  })()}
                  {/* Zoom control compartido (mismo storage key que No Planificadas,
                      Historial, Planificar y Vista Previa).
                      Escondido abajo de `md` (RF-27): ahí el plan se ve en tarjetas y el
                      zoom sólo actúa sobre la tabla; en el teléfono no hacía nada y, al
                      lado del selector de semana, se salía de la pantalla. */}
                  <div className="hidden md:block">
                    <ZoomControl value={planZoom} onChange={setPlanZoom} />
                  </div>
                </div>
              </div>

              {/* LO QUE SE PUEDE HACER CON LO TILDADO.

                  Tildar OTs no se notaba: el único cambio era que el botón rojo de
                  arriba pasaba de decir "Eliminar plan" a "Quitar 5 OTs", en el mismo
                  lugar y del mismo color. Julián, 16/09: «al seleccionar todas no me
                  deja hacer nada (...) no se nota el cambio, una animación o algo que
                  me deje ver que aparecen botones al seleccionarlas».
                  Ahora aparece esta barra, entra deslizándose y dice qué se puede hacer. */}
              {selectedPlanIds.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-gradient-to-r from-rose-50 to-red-50/60 px-3 py-2.5 shadow-sm ring-1 ring-red-500/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white">
                    {selectedPlanIds.length}
                  </span>
                  <span className="text-sm font-semibold text-red-900">
                    {selectedPlanIds.length === 1 ? "orden seleccionada" : "órdenes seleccionadas"}
                  </span>

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEstadoMasivo(3)}
                      disabled={estadoMasivoEnCurso}
                      className="h-8 gap-1.5 border-green-300 bg-white text-xs font-semibold text-green-700 hover:bg-green-50"
                      title="Dar por terminados TODOS los pasos de las OTs tildadas"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Marcar como terminadas
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEstadoMasivo(1)}
                      disabled={estadoMasivoEnCurso}
                      className="h-8 gap-1.5 border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      title="Volver TODOS los pasos de las OTs tildadas a pendiente"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Volver a pendientes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsQuitarOtsDialogOpen(true)}
                      disabled={isQuitandoOts}
                      className="h-8 gap-1.5 border-red-300 bg-white text-xs font-semibold text-red-700 hover:bg-red-50"
                      title="Sacarlas de la planificación (vuelven a quedar sin planificar)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Quitar del plan
                    </Button>
                    <button
                      onClick={() => setSelectedPlanIds([])}
                      className="px-2 text-xs font-medium text-red-700/70 underline-offset-2 hover:text-red-900 hover:underline"
                    >
                      Deseleccionar
                    </button>
                  </div>
                </div>
              )}

              {/* El zoom NO se aplica acá globalmente — se pasa como prop `tableZoom`
                  a cada PlanningListTable para que solo afecte la tabla, no la barra
                  de búsqueda ni los banners de Semanal/Diaria. */}
              <div className="flex-1 p-0">
                <TabsContent value="general" className="m-0 h-full">
                  {/* General: todas las que NO están terminadas ni entregadas.
                      Las entregadas completas se mudan a la pestaña "Completadas". */}
                  <PlanningListTable
                    tableZoom={planZoom}
                    data={otsPendientes}
                    mensajeVacio="Esta planificación no tiene trabajo pendiente: ya está todo terminado o entregado."
                    selectedIds={selectedPlanIds}
                    onSelectionChange={setSelectedPlanIds}
                    isLoading={isLoading}
                    onProcessStatusChange={handleProcessStatusChange}
                    onProcessReorder={handleProcessReorder}
                    onOperatorChange={(planId, operarioId) => handleOperatorChange(operarioId.toString(), planId.toString())}
                    onMachineryChange={handleMachineryChange}
                    operarios={rawOperarios}
                    maquinarias={rawMaquinarias}
                    // La planificación ELEGIDA arriba, no todas juntas. Una OT que se
                    // planificó dos veces tiene una fila por plan, y la fila que se
                    // mostraba (y se editaba) era la primera de la lista mezclada: con
                    // septiembre elegido podías estar leyendo, y corrigiendo, la de mayo.
                    planificacion={filteredPlanificacion}
                    feriados={feriados}
                    onRowClick={abrirOT}
                    onDataChange={refrescarEnSilencio}
                    onOrdenPatch={parchearOrden}
                    onInicioEstimadoChange={handleInicioEstimadoChange}
                  />
                </TabsContent>

                <TabsContent value="semanal" className="m-0 h-full">
                  {/* Weekly: Filter by reference week based on selected Lote.
                      La fecha de cada proceso sale de `inicioDeLaFila` (lib/plan-fechas):
                      la que calculó el backend con la jornada real del taller y el arranque
                      de ese plan. Acá había una cuenta propia —`creado_en` a las 09:00 más
                      los minutos, con jornada de 09 a 18— que ponía el trabajo en el día en
                      que se apretó "Planificar" en vez del día en que se hace. */}
                  {/* Banner Semanal — rediseñado para verse pro:
                        - Icono en cuadrito propio con fondo (jerarquía visual)
                        - Label uppercase pequeño arriba ("Semana") + rango en grande
                        - Badge con dot de color según origen (Hoy / Personalizada / Lote)
                        - Botón explícito "Cambiar fecha" + "Volver a hoy" condicional */}
                  {(() => {
                    const refDate = fechaReferencia;
                    let badgeText = "Esta semana";
                    // Paleta en sintonía con la marca (rojo) + estados:
                    //   - Default (esta semana / hoy): verde teal (estado positivo, complementa al rojo)
                    //   - Personalizada: ámbar (warm tone, complementario al rojo de marca)
                    //   - Según lote: índigo (frío, distingue del rojo sin chocar)
                    let badgeColor = "bg-teal-50 text-teal-700 ring-teal-200/80";
                    let badgeDot = "bg-teal-500";
                    if (!mirandoHoy) {
                      badgeText = "Fecha personalizada";
                      badgeColor = "bg-amber-50 text-amber-800 ring-amber-200/80";
                      badgeDot = "bg-amber-500";
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
                                {otsDeLaSemana.length === 0 && primerDiaConTrabajo && (
                                  <button
                                    onClick={() => setCustomRefDate(primerDiaConTrabajo)}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200/80 hover:bg-blue-100 transition-colors normal-case"
                                  >
                                    <CalendarClock className="h-3 w-3" />
                                    Esta planificación arranca el {format(primerDiaConTrabajo, "EEE d/MM", { locale: es })} — ir a esa semana
                                  </button>
                                )}
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
                            {!mirandoHoy && (
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
                    data={otsDeLaSemana}
                    mensajeVacio="Esta semana no hay trabajo de esta planificación. Probá con «Cambiar fecha» o elegí otra planificación arriba."
                    selectedIds={selectedPlanIds}
                    onSelectionChange={setSelectedPlanIds}
                    isLoading={isLoading}
                    onProcessStatusChange={handleProcessStatusChange}
                    onProcessReorder={handleProcessReorder}
                    onOperatorChange={(planId, operarioId) => handleOperatorChange(operarioId.toString(), planId.toString())}
                    onMachineryChange={handleMachineryChange}
                    operarios={rawOperarios}
                    maquinarias={rawMaquinarias}
                    planificacion={filteredPlanificacion}
                    feriados={feriados}
                    onRowClick={abrirOT}
                    onDataChange={refrescarEnSilencio}
                    onOrdenPatch={parchearOrden}
                    onInicioEstimadoChange={handleInicioEstimadoChange}
                  />
                </TabsContent>

                {/* `diaResaltado`: para que se vea CUÁL paso trae a la OT a este día.
                    Un paso largo —soldar 2700 minutos son cinco jornadas y media— puede
                    haber arrancado el viernes y seguir en curso hoy, y en pantalla se leía
                    «Vie 11/09» estando parado un miércoles: parecía un error de la lista. */}
                <TabsContent value="diaria" className="m-0 h-full">
                  {/* Daily: misma regla que Semanal — el inicio y el fin de cada proceso
                      salen de `inicioDeLaFila` / `finDeLaFila` (lib/plan-fechas). */}
                  {/* Banner Diaria — mismo lenguaje visual que Semanal. Muestra el día
                      en grande (día de la semana + fecha) con badge de origen. */}
                  {(() => {
                    const refDate = fechaReferencia;
                    // Misma paleta que el banner Semanal — consistencia visual.
                    let badgeText = "Hoy";
                    let badgeColor = "bg-teal-50 text-teal-700 ring-teal-200/80";
                    let badgeDot = "bg-teal-500";
                    if (!mirandoHoy) {
                      badgeText = "Fecha personalizada";
                      badgeColor = "bg-amber-50 text-amber-800 ring-amber-200/80";
                      badgeDot = "bg-amber-500";
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
                                {/* El día está vacío pero la planificación tiene trabajo más
                                    adelante: decirlo, y ofrecer ir. Un día en blanco sin
                                    explicación se lee como «se perdió el plan». */}
                                {!tieneOTs && primerDiaConTrabajo && (
                                  <button
                                    onClick={() => setCustomRefDate(primerDiaConTrabajo)}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200/80 hover:bg-blue-100 transition-colors normal-case"
                                  >
                                    <CalendarClock className="h-3 w-3" />
                                    Esta planificación arranca el {format(primerDiaConTrabajo, "EEE d/MM", { locale: es })} — ir a ese día
                                  </button>
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
                            {!mirandoHoy && (
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
                    data={otsDelDia}
                    mensajeVacio="Este día no hay trabajo de esta planificación. Probá con «Cambiar fecha» o elegí otra planificación arriba."
                    diaResaltado={fechaReferencia}
                    selectedIds={selectedPlanIds}
                    onSelectionChange={setSelectedPlanIds}
                    isLoading={isLoading}
                    onProcessStatusChange={handleProcessStatusChange}
                    onProcessReorder={handleProcessReorder}
                    onOperatorChange={(planId, operarioId) => handleOperatorChange(operarioId.toString(), planId.toString())}
                    onMachineryChange={handleMachineryChange}
                    operarios={rawOperarios}
                    maquinarias={rawMaquinarias}
                    planificacion={filteredPlanificacion}
                    feriados={feriados}
                    onRowClick={abrirOT}
                    onDataChange={refrescarEnSilencio}
                    onOrdenPatch={parchearOrden}
                    onInicioEstimadoChange={handleInicioEstimadoChange}
                  />
                </TabsContent>

                <TabsContent value="completadas" className="m-0 h-full">
                  {/* Completadas: OTs planificadas con la entrega completa (o ya marcadas
                      como entregadas por el legacy). Salen de "Planificadas" y caen acá,
                      así la lista de trabajo pendiente queda limpia. */}
                  <div className="mb-3 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-green-800">
                      OTs de esta planificación que <span className="font-semibold">el cliente ya recibió</span> completas.
                      Se sacan solas de <span className="font-semibold">Planificadas</span>, de Semanal y de Diaria,
                      para que ahí quede sólo lo que falta hacer.
                    </p>
                  </div>
                  <PlanningListTable
                    tableZoom={planZoom}
                    data={completedPlannedOrdenes}
                    mensajeVacio="Todavía no se entregó ninguna OT de esta planificación."
                    selectedIds={selectedPlanIds}
                    onSelectionChange={setSelectedPlanIds}
                    isLoading={isLoading}
                    onProcessStatusChange={handleProcessStatusChange}
                    onProcessReorder={handleProcessReorder}
                    onOperatorChange={(planId, operarioId) => handleOperatorChange(operarioId.toString(), planId.toString())}
                    onMachineryChange={handleMachineryChange}
                    operarios={rawOperarios}
                    maquinarias={rawMaquinarias}
                    planificacion={filteredPlanificacion}
                    feriados={feriados}
                    onRowClick={abrirOT}
                    onDataChange={refrescarEnSilencio}
                    onOrdenPatch={parchearOrden}
                    onInicioEstimadoChange={handleInicioEstimadoChange}
                  />
                </TabsContent>

                <TabsContent value="finalizadas" className="m-0 h-full">
                  {/* Terminadas en el taller: todos los pasos tildados y TODAVÍA SIN
                      ENTREGAR. El "sin entregar" es lo que la distingue de la solapa de
                      al lado; sin eso las dos listas decían casi lo mismo. */}
                  <div className="mb-3 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-900">
                      OTs con <span className="font-semibold">todos los pasos terminados</span> que
                      todavía no se entregaron: es lo que hay para despachar. Cuando se entregan
                      pasan a <span className="font-semibold">Entregadas al cliente</span>.
                    </p>
                  </div>
                  <PlanningListTable
                    tableZoom={planZoom}
                    data={otsTerminadasSinEntregar}
                    mensajeVacio="No hay nada terminado esperando despacho en esta planificación."
                    selectedIds={selectedPlanIds}
                    onSelectionChange={setSelectedPlanIds}
                    isLoading={isLoading}
                    onProcessStatusChange={handleProcessStatusChange}
                    onProcessReorder={handleProcessReorder}
                    onOperatorChange={(planId, operarioId) => handleOperatorChange(operarioId.toString(), planId.toString())}
                    onMachineryChange={handleMachineryChange}
                    operarios={rawOperarios}
                    maquinarias={rawMaquinarias}
                    planificacion={filteredPlanificacion}
                    feriados={feriados}
                    onRowClick={abrirOT}
                    onDataChange={refrescarEnSilencio}
                    onOrdenPatch={parchearOrden}
                    onInicioEstimadoChange={handleInicioEstimadoChange}
                  />
                </TabsContent>

                <TabsContent value="carga" className="m-0 h-full">
                  {/* La carga de cada persona es LO QUE LE FALTA HACER: se sacan los pasos
                      ya terminados y las OTs ya entregadas. Se sumaba todo, así que los
                      minutos y los "Días Ocupados" venían inflados con trabajo hecho y
                      cobrado, y con eso se decidía a quién cargarle lo que viene. */}
                  <OperatorLoadTab
                    planificacion={cargaPendiente}
                    operarios={rawOperarios}
                    ordenes={ordenesTrabajo}
                  />
                </TabsContent>
              </div>
            </Tabs>
  );

  return (
    <div className={"flex flex-col transition-all duration-300 ease-in-out " + ((isDetailsPanelOpen && !planificadorAbierto && activeTab === 'gantt') ? 'xl:mr-[400px]' : '')}>
      <Suspense fallback={null}>
        <EnlaceMateriaPrima
          onAbrir={(idPieza) => {
            setActiveTab("materia_prima")
            setPiezaEnlazada(idPieza)
          }}
        />
        <EnlaceEditarOT onPedir={setOtPedida} />
      </Suspense>
      {/* La raíz no pone ni alto ni fondo: los pone la pantalla de adentro, que
          arranca justo del alto de la ventana. El `min-h-screen` que había acá
          sumaba los 24px de arriba y abajo del layout y hacía scrollear el
          documento medio centímetro de gusto. */}
      {planificadorAbierto ? (
        /* Planificar dejó de ser un modal flotando arriba de Operaciones: es una
           pantalla, con la barra lateral de la app a la izquierda y un flujo de dos
           pasos —elegir OTs → revisar el plan— que no se cierra por un click al
           costado. Las dos conviven montadas (la que no toca queda en `hidden`)
           para que "Volver" no pierda el rango de fechas ni lo tildado.

           Sin padding propio: el layout de la app ya envuelve todo en su margen
           (LayoutWrapper, `--pad-app`). El `px-8` que había acá se sumaba a ese y dejaba 56px de
           margen muerto de cada lado —"aprovechar mejor el espacio de la derecha y la
           izquierda", Julián 26/08—, y el `pt-2` sumaba 8px de alto que el shell no
           descuenta (descuenta justo los dos márgenes del layout, `--pad-app`): el pie
           quedaba mordido y el contenedor scrolleaba de a poquito. */
        <div className="w-full">
          <PlanningSelectionScreen
            isOpen={isSelectionModalOpen}
            onClose={handleSalirDelPlanificador}
            unplannedOrders={ordersForPlanning}
            onPlan={handlePlanSelection}
            isLoading={false}
            onDataRefresh={fetchData}
            initialSelectedIds={isReplanning ? plannedOrdenes.map(o => o.id) : []}
            onAbrirBorrador={handleAbrirBorrador}
            availableOperarios={rawOperarios}
          />
          <PlanningPreviewScreen
            isOpen={isPreviewOpen}
            onClose={handleSalirDelPlanificador}
            onBack={() => {
              void guardarYa();
              setIsPreviewOpen(false);
              setIsSelectionModalOpen(true);
            }}
            onEdicionesChange={handleEdicionesBorrador}
            onTandasChange={handleTandasBorrador}
            onAjustesChange={handleAjustesBorrador}
            calculadoEn={planCalculadoEn}
            inicioBase={baseBorrador.current?.inicioBase}
            feriados={feriados}
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
            diagnosticos={diagnosticosPlan}
            huellaAlCalcular={huellaPlan}
            edicionesIniciales={edicionesIniciales}
            forzarIdsIniciales={forzarIdsIniciales}
            tandasIniciales={tandasIniciales}
            ajustesIniciales={ajustesIniciales}
          />
        </div>
      ) : (
      <>
      {/* Una sola pantalla, no un card adentro de otro card adentro del padding
          del layout. Julián, 2/09: "que deje de estar encerrado en modales la
          sección y ocupe bien todo el espacio de la página".

          Lo que había eran tres marcos anidados —el `p-6` de LayoutWrapper, un
          `lg:px-8` propio y el `p-6` de cada card— que se comían 80px de cada
          lado antes de la primera columna de la tabla, más una cabecera de 230px
          de alto: entraban seis filas de 179. Es la misma queja del 26/08 sobre
          el planificador ("aprovechar mejor el espacio de la derecha y la
          izquierda") y se resuelve igual: el padding lo pone el layout y nadie
          más.

          El marco es el de PantallaPlanificador: `min-h` y no `h`, así la página
          sigue scrolleando de una sola manera —nada de scroll adentro de scroll,
          que es lo que incomodaba— y lo que tiene que quedar a la vista se
          resuelve con `sticky`. `svh` y no `vh` por la barra de Safari en iOS. */}
      <div className="min-h-[calc(100svh-2*var(--pad-app,1.5rem))] w-full flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm">
        {/* Cabecera fija: título, acciones y solapas quedan a la vista mientras
            corren las OTs por abajo. z-30 para pasarle por encima a los
            encabezados de las tablas, que están en z-10/z-20. */}
        <div className="sticky top-0 z-30 bg-white rounded-t-xl border-b border-gray-200">
          {/* `pr-16`: la campana de notificaciones es `fixed` arriba a la derecha
              (Topbar) y ahora la cabecera vive ahí también. Sin ese hueco reservado
              se le sienta encima al botón «Planificar». */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pl-3 sm:pl-4 pr-16 pt-3 pb-2">
            {/* Título en una línea con la bajada al lado y no debajo: es la misma
                pantalla todos los días, no hace falta que se anuncie con 4xl. */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-lg shadow-md shrink-0">
                <Activity className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl lg:text-2xl font-bold text-gray-900 leading-tight">Operaciones</h1>
                <p className="text-gray-500 text-xs truncate">Gestiona la planificación de las órdenes de trabajo</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              {/* Retomar un borrador, desde acá y no sólo desde adentro del planificador.
                  Lucas se fue a mirar otra pantalla y dio el plan por perdido: estaba
                  guardado, pero la única puerta para volver a abrirlo estaba adentro de
                  la pantalla de la que se había ido. Se esconde solo cuando no hay
                  borradores, así que casi todos los días la cabecera queda igual. */}
              <BorradoresPlan onAbrir={handleAbrirBorrador} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAvailabilityModalOpen(true)}
                className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300 shadow-sm flex-1 md:flex-none"
                title="Configurar feriados y días no laborales"
              >
                <CalendarClock className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Disponibilidad</span>
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setIsReplanning(false);
                  setIsSelectionModalOpen(true);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all hover:shadow-lg flex-1 md:flex-none"
              >
                <CalendarClock className="md:mr-2 h-4 w-4" />
                <span className="hidden md:inline">Planificar</span>
              </Button>
              {/* En «Órdenes de Trabajo» este botón se esconde: esa pantalla tiene el
                  suyo adentro, y dos botones rojos con el mismo ícono y la misma acción
                  a diez centímetros uno del otro se leen como dos cosas distintas. */}
              {activeTab !== "work_orders" && (
                <Button
                  size="sm"
                  onClick={() => setIsCreateModalOpen(true)}
                  className="bg-red-700 hover:bg-red-800 text-white shadow-md transition-all hover:shadow-lg flex-1 md:flex-none"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span>Nueva orden</span>
                </Button>
              )}
            </div>
          </div>

          {/* Tabs Navigation. `-mb-px` para que el subrayado rojo de la solapa
              activa pise el borde de la cabecera en vez de dibujar dos líneas. */}
          <div className="flex overflow-x-auto items-center gap-1 px-2 sm:px-3 -mb-px scrollbar-hide">
            <button
              onClick={() => setActiveTab("work_orders")}
              className={"flex whitespace-nowrap items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors " + (activeTab === "work_orders" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")}
            >
              <LayoutList size={18} />
              Órdenes de Trabajo
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
              Recurso humano
            </button>

            <button
              onClick={() => setActiveTab("materia_prima")}
              className={"flex whitespace-nowrap items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors " + (activeTab === "materia_prima" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")}
            >
              <Box size={18} />
              Materia Prima
            </button>

          </div>
        </div>

        {/* El padding lo pone cada pantalla. */}
        <div className={`flex-1 min-w-0 flex flex-col ${activeTab === 'gantt' ? 'p-2' : activeTab === 'work_orders' ? 'px-3 pt-3 pb-6' : 'px-4 py-4 sm:px-5'}`}>
            {activeTab === "operarios" && (
              <div className="w-full">
                <div className="flex items-center gap-2 mb-4">
                  <User className="h-5 w-5 text-gray-500" />
                  <h2 className="text-lg font-semibold">Gestión del recurso humano</h2>
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
              <MateriaPrimaTab
                piezaInicial={piezaEnlazada}
                onPiezaInicialUsada={() => setPiezaEnlazada(null)}
              />
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
                onRefresh={fetchData}
                contenidoPlanificadas={pantallaDePlanificacion}
                conteoPlanificadas={otsPendientes.length}
                subTab={otSubTab}
                onSubTabChange={(v) => { setOtSubTab(v); if (v !== "planificadas") setSelectedPlanIds([]); }}
              />
            )}

        </div>
      </div>
      </>
      )}

      {/* Sidebar rendered as Fixed Sidebar (Full Height).
          `max-w-full`: en un teléfono los 400px fijos eran más que la pantalla y el
          panel quedaba cortado del lado izquierdo, con el título afuera (RF-27). Ahora
          ocupa el ancho que haya; desde 400px en adelante, igual que siempre. Abajo de
          `xl` se superpone al contenido en vez de correrlo (el `xl:mr-[400px]` de arriba). */}
      <div className={"fixed inset-y-0 right-0 w-[400px] max-w-full bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-[60] " + ((isDetailsPanelOpen && !planificadorAbierto && activeTab === 'gantt') ? 'translate-x-0' : 'translate-x-full')}>
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


      {/* Va por encima de los modales de planificación: el cálculo se dispara desde
          adentro de ellos y el overlay tiene que tapar los dos. */}
      <ProgresoPlanificacion
        activo={calculando.activo}
        cantidadOts={calculando.ots}
        listo={calculando.listo}
        modo={calculando.modo}
      />

      <AvailabilityConfigModal
        isOpen={isAvailabilityModalOpen}
        onClose={() => setIsAvailabilityModalOpen(false)}
      />

      {/* Vive suelto: lo abre `isStatusConfirmOpen` desde cualquier lista. Estaba
          colgado de la solapa "Planificación", que ya no existe. */}
      {(
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
        isOpen={isQuitarOtsDialogOpen}
        onClose={() => setIsQuitarOtsDialogOpen(false)}
        onConfirm={handleQuitarOtsSeleccionadas}
        title={selectedPlanIds.length === 1 ? "¿Quitar la OT de la planificación?" : `¿Quitar ${selectedPlanIds.length} OTs de la planificación?`}
        description={
          (selectedPlanIds.length === 1
            ? "La OT se saca de la planificación y vuelve a estar disponible para planificar. "
            : "Las OTs se sacan de la planificación y vuelven a estar disponibles para planificar. ") +
          (selectedLoteId !== "all"
            ? "El resto de la planificación no se toca."
            : "Como estás viendo TODAS las planificaciones, se quitan de todas donde aparezcan.")
        }
        confirmText={isQuitandoOts ? "Quitando..." : "Sí, quitar"}
        cancelText="Cancelar"
        variant="destructive"
      />
      <ConfirmationDialog
        isOpen={isDeleteLoteDialogOpen}
        onClose={() => setIsDeleteLoteDialogOpen(false)}
        onConfirm={handleDeleteLote}
        title="¿Eliminar esta planificación?"
        description={(() => {
          const lote = uniqueLotes.find(l => l.id === selectedLoteId);
          if (!lote) return "Se va a eliminar la planificación elegida.";
          const { ots, renglones } = tamanoDelLote(lote.id);
          return `${nombreDelLote(lote)} — ${ots} OT y ${renglones} renglones de plan. `
            + "Se borra para siempre y no se puede deshacer: los horarios, las personas y las "
            + "máquinas que tenía asignadas se pierden. Las OTs vuelven a quedar disponibles "
            + "para planificar.";
        })()}
        confirmText={isDeletingLote ? "Eliminando..." : "Sí, eliminar"}
        cancelText="Cancelar"
        variant="destructive"
      />

      {/* El cambio masivo escribe en MUCHAS filas de una: cinco OTs pueden ser
          cincuenta pasos con su hora de fin. Por eso el cartel dice cuántas órdenes y
          qué les va a pasar, en vez de un "¿estás seguro?". */}
      <ConfirmationDialog
        isOpen={estadoMasivo !== null}
        onClose={() => setEstadoMasivo(null)}
        onConfirm={aplicarEstadoMasivo}
        title={estadoMasivo === 3
          ? `¿Dar por terminadas ${selectedPlanIds.length} orden${selectedPlanIds.length === 1 ? "" : "es"}?`
          : `¿Volver ${selectedPlanIds.length} orden${selectedPlanIds.length === 1 ? "" : "es"} a pendiente?`}
        description={estadoMasivo === 3
          ? "Se marcan como terminados TODOS los pasos de esas órdenes, con la hora de "
            + "ahora como hora de fin, y las órdenes pasan a «Terminadas en el taller». "
            + "Es el mismo efecto que tildar cada paso a mano, todo junto."
          : "Se vuelven a pendiente TODOS los pasos de esas órdenes y se borran sus horas "
            + "reales de arranque y de fin. El trabajo que ya se haya hecho no queda "
            + "registrado."}
        confirmText={estadoMasivoEnCurso
          ? "Aplicando..."
          : (estadoMasivo === 3 ? "Sí, darlas por terminadas" : "Sí, volverlas a pendiente")}
        cancelText="Cancelar"
        variant={estadoMasivo === 3 ? "default" : "destructive"}
      />

      <ConfirmationDialog
        isOpen={isLimpiarViejasOpen}
        onClose={() => setIsLimpiarViejasOpen(false)}
        onConfirm={handleLimpiarViejas}
        title={`¿Eliminar ${lotesViejos.length} planificacion${lotesViejos.length === 1 ? "" : "es"} vieja${lotesViejos.length === 1 ? "" : "s"}?`}
        description={(() => {
          const detalle = lotesViejos.map(l => {
            const { ots } = tamanoDelLote(l.id);
            return `• ${nombreDelLote(l)} — ${ots} OT`;
          }).join("\n");
          const vigente = uniqueLotes[0];
          return `Se eliminan todas menos la que está corriendo`
            + (vigente ? ` (${nombreDelLote(vigente)}), que no se toca` : "")
            + `:\n\n${detalle}\n\nSe borran para siempre y no se puede deshacer. Las OTs que `
            + `sólo estaban en estas planificaciones vuelven a quedar sin planificar.`;
        })()}
        confirmText={limpiandoViejas ? "Eliminando..." : "Sí, eliminar todas"}
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


