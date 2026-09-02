import { useState, useEffect, useRef } from "react"
import { PantallaPlanificador } from "./PantallaPlanificador"
import { Button } from "@/components/ui/button"
import { PlanningListTable } from "./PlanningListTable"
import { WorkOrder } from "@/lib/types"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarUI } from "@/components/ui/calendar"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import type { DateRange } from "react-day-picker"
import { API_URL } from "@/config"

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Calendar, Filter, Clock, AlertCircle, AlertTriangle, CheckCircle2, Check, ChevronsUpDown, ListChecks, LogOut, Search, X } from "lucide-react"
import { WorkOrderFilters, WorkOrderFilterState, initialFilterState, applyWorkOrderFilters } from "@/components/common/WorkOrderFilters"
import { ZoomControl, usePersistedZoom } from "@/components/ui/zoom-control"
import { BorradoresPlan } from "./BorradoresPlan"
import type { BorradorPlan } from "@/lib/borradorPlan"

export interface PlanningRange {
    fecha_desde?: string  // "YYYY-MM-DD"
    fecha_hasta?: string  // "YYYY-MM-DD"
}

interface PlanningSelectionScreenProps {
    /** Se mantiene montada y oculta cuando no es el paso activo: ver PantallaPlanificador. */
    isOpen: boolean
    onClose: () => void
    unplannedOrders: WorkOrder[]
    onPlan: (selectedIds: number[], range: PlanningRange) => void
    isLoading?: boolean

    onDataRefresh?: () => void
    initialSelectedIds?: number[]
    /** Abre un plan calculado y sin confirmar, sin volver a calcularlo. */
    onAbrirBorrador?: (borrador: BorradorPlan) => void
    availableOperarios?: any[]
}

export function PlanningSelectionScreen({
    isOpen,
    onClose,
    unplannedOrders,
    onPlan,
    isLoading = false,
    onDataRefresh,
    initialSelectedIds = [],
    onAbrirBorrador,
    availableOperarios = []
}: PlanningSelectionScreenProps) {
    const [selectedIds, setSelectedIds] = useState<number[]>(initialSelectedIds)

    /** Modo "ver solo las tildadas". Guarda la FOTO de qué había tildado al entrar,
     *  no la selección viva: si filtrara por lo tildado en vivo, destildar una la
     *  haría desaparecer del renglón y no habría cómo volver a tildarla. Así se
     *  revisa la tanda tranquilo y se destilda lo que sobra sin que la lista salte.
     *  `null` = apagado. */
    const [soloTildadas, setSoloTildadas] = useState<number[] | null>(null)

    // Zoom compartido con el resto de Operaciones.
    const [zoom, setZoom] = usePersistedZoom('plan_zoom', 100)

    // Con qué arranca la selección al abrir.
    //
    // `initialSelectedIds` llega como array NUEVO en cada render del padre
    // (`isReplanning ? plannedOrdenes.map(...) : []`), así que se compara por
    // CONTENIDO: con el array en las dependencias, este efecto corría a cada rato y
    // dejaba la selección en cero en medio de la tildada.
    //
    // Y se aplica UNA sola vez por juego de ids, porque "Volver" desde la vista
    // previa no es abrir de cero: la pantalla queda montada y oculta, así que al
    // volver `isOpen` pasa de false a true y el efecto corría de nuevo. Mientras
    // había tildado automático no se notaba —volvía a tildar todo—; sin él, volver
    // te dejaba la lista en blanco y el botón "Planificar" apagado, con las 20 OT
    // que habías elegido para re-tildar a mano.
    const initialIdsKey = initialSelectedIds.join(",")
    const idsAplicadosRef = useRef<string | null>(null)
    useEffect(() => {
        if (!isOpen) return
        if (idsAplicadosRef.current === initialIdsKey) return
        idsAplicadosRef.current = initialIdsKey
        // Filter out any IDs that are not in the available unplannedOrders
        const validIds = initialSelectedIds.filter(id =>
            unplannedOrders.some(order => order.id === id)
        );
        setSelectedIds(validIds);
        setSoloTildadas(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialIdsKey]);

    /** Salir del planificador SÍ es cerrar: la próxima vez se entra en blanco.
     *  (Distinto de "Volver", que es seguir con la misma tanda.) */
    const salirDelPlanificador = () => {
        idsAplicadosRef.current = null
        setSelectedIds([])
        setSoloTildadas(null)
        onClose()
    }

    // Filter states
    const [filters, setFilters] = useState<WorkOrderFilterState>(initialFilterState)
    const [dateSort, setDateSort] = useState<'DEFAULT' | 'OLDEST_FIRST' | 'NEWEST_FIRST'>('DEFAULT')
    const [clientSearchTerm, setClientSearchTerm] = useState('')

    // Date range state
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
    const [blockedDates, setBlockedDates] = useState<Date[]>([])
    const [datePopoverOpen, setDatePopoverOpen] = useState(false)

    // Fetch blocked dates when modal opens (to display in calendar)
    useEffect(() => {
        if (!isOpen) return
        const getAuthHeaders = (): HeadersInit => {
            if (typeof window === 'undefined') return {}
            const token = localStorage.getItem('access_token')
            return token ? { 'Authorization': `Bearer ${token}` } : {}
        }
        fetch(`${API_URL}/config/availability`, { headers: getAuthHeaders() })
            .then(r => r.ok ? r.json() : { blocked_dates: [] })
            .then(data => {
                const dates = (data.blocked_dates || []).map((d: string) => {
                    const [y, m, day] = d.split('-').map(Number)
                    return new Date(y, m - 1, day)
                })
                setBlockedDates(dates)
            })
            .catch(() => { /* silencioso: si falla, solo no se pintan en rojo */ })
    }, [isOpen])

    // Derived lists
    const uniqueClients = Array.from(new Set(unplannedOrders.map(o => o.cliente?.nombre).filter((n): n is string => !!n))).sort()
    const uniqueSectors = Array.from(new Set(unplannedOrders.map(o => o.sector?.nombre).filter((n): n is string => !!n))).sort()

    const filteredClients = uniqueClients.filter(c =>
        c.toLowerCase().includes(clientSearchTerm.toLowerCase())
    );

    // Apply filters and sort. Lo tildado A MANO también sube arriba, pero eso lo
    // maneja la tabla (pinSelectedOnTop) para no reordenar en vivo con cada tilde;
    // acá solo se garantiza que las pre-seleccionadas arranquen arriba.
    const filteredOrders = applyWorkOrderFilters(unplannedOrders, filters)
        .filter(o => soloTildadas === null || soloTildadas.includes(o.id))
        .sort((a, b) => {
            const isASelected = initialSelectedIds.includes(a.id);
            const isBSelected = initialSelectedIds.includes(b.id);
            if (isASelected && !isBSelected) return -1;
            if (!isASelected && isBSelected) return 1;

            if (dateSort === 'DEFAULT') return 0
            const dateA = a.fecha_entrada ? new Date(a.fecha_entrada).getTime() : 0
            const dateB = b.fecha_entrada ? new Date(b.fecha_entrada).getTime() : 0
            if (dateSort === 'OLDEST_FIRST') return dateA - dateB
            if (dateSort === 'NEWEST_FIRST') return dateB - dateA
            return 0
        })

    // Acá NO hay tildado automático, y es a propósito (Julián, 31/08: "cuando abro
    // planificar de base ya están todas seleccionadas, no tiene que pasar eso").
    // Antes un useEffect hacía `setSelectedIds(lo filtrado)` cada vez que cambiaban
    // los filtros: abría con las 176 OT tildadas y, peor, cambiar de filtro
    // reemplazaba la selección —tildabas las urgentes, pasabas a retrasadas y las
    // urgentes se perdían sin aviso (pedido de Lucas, 28/08)—.
    //
    // Al no existir ese efecto, los filtros NUNCA tocan `selectedIds`: la selección
    // se acumula sola mientras vas filtrando. Para tildar de a tandas está el tilde
    // de la cabecera de la lista, que suma o saca solo las filas que estás viendo.

    /** Huella de los filtros: cambia sólo cuando se toca un filtro o el orden, y es
     *  lo que le avisa a la lista que cierre las filas desplegadas. El rango de
     *  fechas no entra: es el horizonte del plan, no filtra la lista. */
    const filtrosKey = JSON.stringify(filters) + "|" + dateSort + "|" + (soloTildadas !== null)

    /** "Deseleccionar todas" también apaga el modo de revisión: si no, quedabas
     *  mirando una lista vacía sin entender por qué no hay ninguna OT. */
    const deseleccionarTodas = () => {
        setSelectedIds([])
        setSoloTildadas(null)
    }

    /** El badge "N seleccionadas" es el interruptor del modo de revisión: te deja
     *  ver de un saque qué elegiste sin ir a buscarlo entre 176 renglones. */
    const alternarSoloTildadas = () => {
        setSoloTildadas(prev => (prev === null ? [...selectedIds] : null))
    }

    /**
     * Las OT que elegiste y no tienen material.
     *
     * Hoy Lucas las saca a mano de a una antes de planificar: se acuerda, filtra por
     * material, las destilda y vuelve. El filtro ya existía —lo que faltaba era no tener
     * que acordarse—. Esto no bloquea ni destilda solo: avisa cuántas son y las saca de
     * un click, que es lo que él venía haciendo con el mouse.
     *
     * El criterio es el mismo que usa la columna Material de las tres listas de órdenes:
     * 'ok' es el único que cuenta como material puesto. Sin dato es sin stock — es lo
     * que se ve en pantalla y no podíamos decir una cosa acá y otra allá.
     */
    const sinMaterial = unplannedOrders.filter(o => {
        if (!selectedIds.includes(o.id)) return false
        const estado = o.estado_material || 'sin_datos'
        // Mismo criterio que el corte de abajo: «pedido» sí se planifica, el material
        // está encargado. Sin stock y sin datos, no.
        return estado === 'sin_stock' || estado === 'sin_datos'
    })

    const sacarLasSinMaterial = () => {
        const fuera = new Set(sinMaterial.map(o => o.id))
        setSelectedIds(prev => prev.filter(id => !fuera.has(id)))
        setSoloTildadas(prev => (prev === null ? null : prev.filter(id => !fuera.has(id))))
    }

    // Calculate estimated workload
    const calculateEstimatedTime = () => {
        if (selectedIds.length === 0) return null

        const selectedOrders = unplannedOrders.filter(o => selectedIds.includes(o.id))
        let totalMinutes = 0
        let procesosConTiempo = 0
        let totalProcesos = 0
        let otsSinProcesos = 0
        selectedOrders.forEach(o => {
            const procs = o.procesos || []
            if (procs.length === 0) {
                otsSinProcesos++
            } else {
                totalProcesos += procs.length
                procs.forEach(p => {
                    if (p.tiempo_proceso && p.tiempo_proceso > 0) {
                        procesosConTiempo++
                        totalMinutes += p.tiempo_proceso
                    }
                })
            }
        })

        // Distinguimos 3 escenarios para que el usuario sepa exactamente qué
        // arreglar antes de planificar:
        //   1) Ninguna de las OTs tiene procesos cargados → no se puede planificar.
        //   2) Hay procesos cargados pero ninguno tiene tiempo → falta cargar tiempos.
        //   3) Hay tiempos → calculamos estimación.
        if (totalProcesos === 0) {
            return `— (${otsSinProcesos} sin procesos cargados)`
        }
        if (procesosConTiempo === 0) {
            return `— (procesos sin tiempo cargado)`
        }

        // Solo contamos operarios marcados como disponibles. Si el array no llega
        // o queda vacio, caemos a 1 para no dividir por cero.
        const operariosDisponibles = availableOperarios.filter(op => op?.disponible !== false)
        const resourceCount = Math.max(1, operariosDisponibles.length)
        const effectiveMinutes = totalMinutes / resourceCount

        // Jornada laboral promedio real de los operarios disponibles
        // (hora_fin - hora_inicio - desayuno - almuerzo). Default 495 min (8.25h)
        // si no hay datos cargados todavia.
        const parseHHMM = (s?: string) => {
            if (!s || typeof s !== 'string') return null
            const [h, m] = s.split(':').map(Number)
            if (isNaN(h) || isNaN(m)) return null
            return h * 60 + m
        }
        const jornadasMin = operariosDisponibles
            .map(op => {
                const ini = parseHHMM(op?.hora_inicio)
                const fin = parseHHMM(op?.hora_fin)
                if (ini === null || fin === null || fin <= ini) return null
                const desayuno = Number(op?.min_desayuno) || 0
                const almuerzo = Number(op?.min_almuerzo) || 0
                return Math.max(0, (fin - ini) - desayuno - almuerzo)
            })
            .filter((v): v is number => v !== null && v > 0)
        const MIN_LABORAL_DIA = jornadasMin.length > 0
            ? jornadasMin.reduce((a, b) => a + b, 0) / jornadasMin.length
            : 495

        const days = (effectiveMinutes / MIN_LABORAL_DIA).toFixed(1)
        const hours = (effectiveMinutes / 60).toFixed(1)

        return `${days} días (${hours} hs)`
    }

    const estimatedTime = calculateEstimatedTime()

    return (
        <PantallaPlanificador
            visible={isOpen}
            cabecera={
                <>
                    <div className="px-6 pt-2 pb-2 flex items-center justify-between gap-x-4 gap-y-1 flex-wrap">
                        <div className="min-w-0 flex items-baseline gap-3">
                            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2 shrink-0">
                                <ListChecks className="w-5 h-5 text-blue-600 shrink-0" />
                                Planificar órdenes
                                <span className="text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                                    Paso 1 de 2
                                </span>
                            </h1>
                            <p className="text-sm text-gray-500 min-w-0 truncate hidden xl:block">
                                Elegí qué OTs entran en el plan y, si hace falta, entre qué fechas. Se calcula sobre lo tildado.
                            </p>
                        </div>
                        <div className="flex items-center gap-2.5 flex-wrap justify-end min-w-0">
                            {/* Los chips de estado y el rango de fechas subieron acá: la fila
                                propia que tenían abajo eran 40px que le faltaban a la lista. */}
                            {/* Los chips de estado y el rango de fechas subieron acá desde
                                su propia fila: eran 40px de alto para cuatro controles chicos
                                que entran de sobra al lado del título, y esos 40px son media
                                fila más de lista. */}
                        {estimatedTime && (
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 gap-1.5 px-3 py-1 text-sm font-medium">
                                <Clock className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Est:</span> {estimatedTime}
                            </Badge>
                        )}
                        {sinMaterial.length > 0 && (
                            <button
                                type="button"
                                onClick={sacarLasSinMaterial}
                                title={`Sacar de la selección: ${sinMaterial.map(o => `#${(o as any).id_otvieja || o.id}`).join(", ")}`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100"
                            >
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                {sinMaterial.length === 1
                                    ? "1 sin material"
                                    : `${sinMaterial.length} sin material`}
                                <span className="font-normal opacity-80">· sacar</span>
                            </button>
                        )}
                        {/* El contador es el botón para revisar lo elegido: con 176 renglones,
                            encontrar las 3 que tildaste era scrollear a ojo (Julián, 31/08).
                            Encendido, la lista muestra solo esas y el badge dice cómo salir. */}
                        <button
                            type="button"
                            onClick={alternarSoloTildadas}
                            disabled={selectedIds.length === 0 && soloTildadas === null}
                            aria-pressed={soloTildadas !== null}
                            title={soloTildadas !== null
                                ? "Volver a la lista completa"
                                : "Ver solo las OT que tildaste"}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                                "disabled:cursor-default disabled:opacity-60",
                                soloTildadas !== null
                                    ? "border-blue-300 bg-blue-50 font-medium text-blue-700 hover:bg-blue-100"
                                    : "border-slate-200 font-normal text-slate-500 enabled:hover:border-slate-300 enabled:hover:bg-slate-50 enabled:hover:text-slate-700"
                            )}
                        >
                            {soloTildadas !== null && <Check className="w-3 h-3 shrink-0" />}
                            {selectedIds.length} seleccionadas
                            {soloTildadas !== null && <X className="w-3 h-3 shrink-0 opacity-70" />}
                        </button>
                        {selectedIds.length > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={deseleccionarTodas}
                                className="h-6 px-2 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50"
                            >
                                Deseleccionar todas
                            </Button>
                        )}

                        {/* Date Range Picker */}
                        <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className={cn(
                                        "h-8 gap-2 font-normal",
                                        !dateRange?.from && "text-slate-500"
                                    )}
                                    title="Definir desde y hasta qué día planificar"
                                >
                                    <Calendar className="w-3.5 h-3.5" />
                                    {dateRange?.from ? (
                                        dateRange.to ? (
                                            <span className="text-xs">
                                                {format(dateRange.from, "d MMM", { locale: es })} – {format(dateRange.to, "d MMM yyyy", { locale: es })}
                                            </span>
                                        ) : (
                                            <span className="text-xs">
                                                Desde {format(dateRange.from, "d MMM yyyy", { locale: es })}
                                            </span>
                                        )
                                    ) : (
                                        <span className="text-xs">Rango de fechas</span>
                                    )}
                                    {dateRange?.from && (
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setDateRange(undefined)
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.stopPropagation()
                                                    setDateRange(undefined)
                                                }
                                            }}
                                            className="ml-1 hover:text-red-600 inline-flex items-center"
                                            aria-label="Limpiar rango"
                                        >
                                            <X className="w-3 h-3" />
                                        </span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <div className="p-3 border-b text-xs text-slate-600 bg-slate-50">
                                    Seleccione el rango de días en los que se distribuirán las órdenes.
                                    Los días <span className="text-red-600 font-medium">no laborables</span> (configurados en Disponibilidad) se omitirán automáticamente.
                                </div>
                                <CalendarUI
                                    mode="range"
                                    selected={dateRange}
                                    onSelect={setDateRange}
                                    numberOfMonths={2}
                                    locale={es}
                                    disabled={{ before: new Date() }}
                                    modifiers={{ blocked: blockedDates }}
                                    modifiersStyles={{
                                        blocked: {
                                            backgroundColor: "#fee2e2",
                                            color: "#ef4444",
                                            textDecoration: "line-through"
                                        }
                                    }}
                                />
                                <div className="flex justify-between items-center p-3 border-t bg-slate-50">
                                    <span className="text-xs text-slate-500">
                                        {dateRange?.from && dateRange?.to
                                            ? `${Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86400000) + 1} días`
                                            : "Sin rango definido"}
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setDateRange(undefined)}
                                            className="h-7 text-xs"
                                        >
                                            Limpiar
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => setDatePopoverOpen(false)}
                                            className="h-7 text-xs"
                                        >
                                            Listo
                                        </Button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                            {/* El cálculo es caro (minutos con 34 OTs) y antes cerrar la
                                vista previa lo tiraba entero. Acá se retoma sin recalcular.
                                El componente no se dibuja si no hay borradores guardados. */}
                            {onAbrirBorrador && <BorradoresPlan onAbrir={onAbrirBorrador} refrescar={isOpen ? 1 : 0} />}
                            {/* Zoom control: afecta a la tabla de selección. */}
                            <ZoomControl value={zoom} onChange={setZoom} />
                            {/* La salida, arriba y en el mismo lugar que en la vista previa.
                                Estaba sola en el pie y Lucas no la encontraba: buscaba la
                                vuelta arriba, que es donde está en el paso siguiente. Dos
                                pantallas del mismo flujo no pueden tener la salida en
                                extremos opuestos. */}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={salirDelPlanificador}
                                className="h-8 gap-1.5 text-gray-500 hover:text-gray-800"
                                title="Volver a Operaciones. Todavía no armaste ningún plan: la próxima vez arrancás de cero."
                            >
                                <LogOut className="w-3.5 h-3.5" />
                                Salir
                            </Button>
                        </div>
                    </div>


                    {/* Filter Toolbar Section - Symmetric & Compact */}
                    <div className="px-6 py-0 border-t bg-slate-50/80">
                    <WorkOrderFilters filters={filters} setFilters={setFilters} orders={unplannedOrders} compacto>
                        {/* Misma estética que el resto de filtros: "Categoría: valor"
                            con el valor en negrita cuando hay algo aplicado. */}
                        <Select value={dateSort} onValueChange={(val: any) => setDateSort(val)}>
                            <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal [&>span:first-child]:flex-1 [&>span:first-child]:truncate">
                                <span className="truncate">
                                    <span className="text-slate-500 font-normal">Orden: </span>
                                    <span className={cn(
                                        dateSort === "DEFAULT" ? "text-slate-500 font-normal" : "font-semibold text-slate-800"
                                    )}>
                                        {dateSort === "DEFAULT" ? "Defecto" : dateSort === "OLDEST_FIRST" ? "Más antiguos" : "Más recientes"}
                                    </span>
                                </span>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DEFAULT" className="text-xs">Defecto</SelectItem>
                                <SelectItem value="OLDEST_FIRST" className="text-xs">Más antiguos</SelectItem>
                                <SelectItem value="NEWEST_FIRST" className="text-xs">Más recientes</SelectItem>
                            </SelectContent>
                        </Select>
                    </WorkOrderFilters>
                    </div>
                </>
            }
            pie={
                <>
                    <div className="px-6 py-3 flex flex-wrap items-center justify-end gap-2">
                    <Button
                        onClick={() => {
                            const selectedOrders = unplannedOrders.filter(o => selectedIds.includes(o.id));

                            // En los toasts la OT se nombra por su número VISIBLE (id_otvieja),
                            // que es el que está en la columna OT de la lista. Antes se mostraba
                            // el id interno: el aviso decía "#8599" y buscar 8599 en la lista no
                            // encontraba nada, así que parecía que el sistema se quejaba de
                            // órdenes que no existen.
                            const nro = (o: WorkOrder) => `#${o.id_otvieja ?? o.id}`;

                            // 1. Check for empty processes
                            const emptyOrders = selectedOrders.filter(o => !o.procesos || o.procesos.length === 0);
                            if (emptyOrders.length > 0) {
                                const orderIds = emptyOrders.map(nro).join(", ");
                                toast.error(`Las órdenes ${orderIds} no tienen procesos. Agregue procesos antes de planificar.`, {
                                    duration: 6000,
                                    description: "Destildalas para planificar el resto, o cargales los procesos primero.",
                                });
                                return;
                            }

                            // 2. Check for missing stock
                            const noStockOrders = selectedOrders.filter(o => {
                                const estado = o.estado_material || 'sin_datos';
                                return estado === 'sin_stock' || estado === 'sin_datos';
                            });

                            if (noStockOrders.length > 0) {
                                // Antes esto frenaba y te mandaba a mirar la columna Material:
                                // el trabajo de sacarlas quedaba para vos, de a una. Ahora el
                                // aviso trae la salida puesta — avisar, no bloquear.
                                const orderIds = noStockOrders.map(nro).join(", ");
                                const restantes = selectedIds.filter(
                                    id => !noStockOrders.some(o => o.id === id)
                                );
                                toast.error(
                                    noStockOrders.length === 1
                                        ? `La orden ${orderIds} no tiene material.`
                                        : `${noStockOrders.length} órdenes no tienen material: ${orderIds}.`,
                                    {
                                        duration: 8000,
                                        description: restantes.length > 0
                                            ? `Podés sacarlas y planificar las otras ${restantes.length}.`
                                            : "Son todas las que tildaste, así que no queda nada para planificar.",
                                        action: restantes.length > 0
                                            ? {
                                                label: "Sacarlas y planificar",
                                                onClick: () => {
                                                    setSelectedIds(restantes);
                                                    setSoloTildadas(prev =>
                                                        prev === null ? null : prev.filter(id => restantes.includes(id)));
                                                    onPlan(restantes, {
                                                        fecha_desde: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined,
                                                        fecha_hasta: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined,
                                                    });
                                                },
                                            }
                                            : undefined,
                                    }
                                );
                                return;
                            }

                            const range: PlanningRange = {
                                fecha_desde: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined,
                                fecha_hasta: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined,
                            }
                            onPlan(selectedIds, range)
                        }}
                        disabled={selectedIds.length === 0 || isLoading}
                        className="bg-blue-600 hover:bg-blue-700 gap-2"
                    >
                        {isLoading ? (
                            "Procesando..."
                        ) : (
                            <>
                                <CheckCircle2 className="w-4 h-4" />
                                Planificar {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
                            </>
                        )}
                    </Button>
                    </div>
                </>
            }
        >
            {/* Content Area */}
            <div className="flex-1 min-w-0 bg-gray-50 flex flex-col">
                    <div className="flex-1 p-2 flex flex-col gap-3">
                        {/* El umbral estaba en 30 y saltaba en la semana normal del taller
                            —Lucas planifica 35 a 40 OTs de una— recomendando justo lo
                            contrario de lo que hay que hacer: partir el lote hace que el
                            segundo cálculo no vea las máquinas que reservó el primero y
                            salgan dos planes que se pisan. Ahora avisa recién a las 50, y
                            avisa de lo único cierto: que va a tardar. */}
                        {selectedIds.length > 50 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex gap-4 items-start shrink-0 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="bg-amber-100 p-2 rounded-full shrink-0">
                                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                                </div>
                                <div className="space-y-1.5">
                                    <h4 className="font-bold text-amber-800 text-sm">
                                        Son muchas órdenes juntas ({selectedIds.length})
                                    </h4>
                                    <p className="text-xs text-amber-700/90 leading-relaxed max-w-[800px]">
                                        Se pueden planificar igual, pero el cálculo va a tardar unos minutos: el planificador prueba todas las combinaciones de máquinas, operarios y turnos antes de decidir. Vas a ver una barra con el avance.
                                    </p>
                                    <p className="text-xs font-semibold text-amber-800 mt-2">
                                        Conviene hacerlo en una sola tanda y no en varias: si partís el lote, el segundo cálculo no ve las máquinas que reservó el primero y los dos planes se pisan.
                                    </p>
                                </div>
                            </div>
                        )}
                        {/* Sin `absolute inset-0 overflow-auto`: la tarjeta crece con la
                            lista y el scroll es el de la página, uno solo. Antes eran tres
                            scrolls metidos uno adentro del otro. */}
                        <div className="bg-white border rounded-lg shadow-sm flex-1">
                            <div>
                                <PlanningListTable
                                    tableZoom={zoom}
                                    data={filteredOrders}
                                    selectedIds={selectedIds}
                                    onSelectionChange={setSelectedIds}
                                    isLoading={isLoading}
                                    onRowClick={() => { }}
                                    onDataChange={onDataRefresh}
                                    hideStatus={true}
                                    highlightedIds={initialSelectedIds}
                                    pinSelectedOnTop
                                    colapsarFilasKey={filtrosKey}
                                    compacto
                                />
                            </div>
                        </div>
                    </div>
                </div>

        </PantallaPlanificador>
    )
}
