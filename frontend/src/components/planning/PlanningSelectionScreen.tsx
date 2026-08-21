import { useState, useEffect } from "react"
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
import { Calendar, Filter, Clock, AlertCircle, AlertTriangle, CheckCircle2, Check, ChevronsUpDown, ListChecks, Search, X } from "lucide-react"
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
    autoSelectAll?: boolean
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
    autoSelectAll = true,
    availableOperarios = []
}: PlanningSelectionScreenProps) {
    const [selectedIds, setSelectedIds] = useState<number[]>(initialSelectedIds)

    // Zoom compartido con el resto de Operaciones.
    const [zoom, setZoom] = usePersistedZoom('plan_zoom', 100)

    // Sync selectedIds when modal opens or initialSelectedIds changes
    useEffect(() => {
        if (isOpen) {
            // Filter out any IDs that are not in the available unplannedOrders
            const validIds = initialSelectedIds.filter(id =>
                unplannedOrders.some(order => order.id === id)
            );
            setSelectedIds(validIds);
        }
    }, [isOpen, initialSelectedIds, unplannedOrders]);

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

    // Auto-select filtered orders when filters change
    useEffect(() => {
        if (!autoSelectAll) return;
        const ids = filteredOrders.map(o => o.id)
        setSelectedIds(ids)
    }, [filters, dateSort, autoSelectAll])

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
                    <div className="px-6 pt-4 pb-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                                <ListChecks className="w-5 h-5 text-blue-600 shrink-0" />
                                Planificar órdenes
                                <span className="text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                                    Paso 1 de 2
                                </span>
                            </h1>
                            <p className="text-sm text-gray-500 mt-0.5">
                                Elegí qué OTs entran en el plan y, si hace falta, entre qué fechas. Se calcula sobre lo tildado.
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {/* El cálculo es caro (minutos con 34 OTs) y antes cerrar la
                                vista previa lo tiraba entero. Acá se retoma sin recalcular.
                                El componente no se dibuja si no hay borradores guardados. */}
                            {onAbrirBorrador && <BorradoresPlan onAbrir={onAbrirBorrador} refrescar={isOpen ? 1 : 0} />}
                            {/* Zoom control: afecta a la tabla de selección. */}
                            <ZoomControl value={zoom} onChange={setZoom} />
                        </div>
                    </div>

                    <div className="px-6 pb-3 flex items-center gap-2.5 flex-wrap">
                        {estimatedTime && (
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 gap-1.5 px-3 py-1 text-sm font-medium">
                                <Clock className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Est:</span> {estimatedTime}
                            </Badge>
                        )}
                        <Badge variant="outline" className="text-slate-500 font-normal">
                            {selectedIds.length} seleccionadas
                        </Badge>
                        {selectedIds.length > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedIds([])}
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

                    </div>

                    {/* Filter Toolbar Section - Symmetric & Compact */}
                    <div className="px-6 py-0 border-t bg-slate-50/80">
                    <WorkOrderFilters filters={filters} setFilters={setFilters} orders={unplannedOrders}>
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
                    <div className="px-6 py-4 flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={onClose} className="text-gray-600">
                        Salir del planificador
                    </Button>
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
                                const orderIds = noStockOrders.map(nro).join(", ");
                                toast.error(`Las órdenes ${orderIds} no tienen stock disponible. Resuelva el stock antes de planificar.`, {
                                    duration: 6000,
                                    description: "Verifique la columna Material en la lista."
                                });
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
            <div className="flex-1 min-w-0 overflow-hidden bg-gray-50 flex flex-col">
                    <div className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col gap-4">
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
                        <div className="bg-white border rounded-lg shadow-sm flex-1 min-h-0 relative overflow-hidden flex flex-col">
                            <div className="absolute inset-0 overflow-auto">
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
                                />
                            </div>
                        </div>
                    </div>
                </div>

        </PantallaPlanificador>
    )
}
