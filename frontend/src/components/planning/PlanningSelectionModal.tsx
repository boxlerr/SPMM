import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PlanningListTable } from "./PlanningListTable"
import { WorkOrder } from "@/lib/types"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Calendar, Filter, Clock, AlertCircle, CheckCircle2, Check, ChevronsUpDown, Search } from "lucide-react"

interface PlanningSelectionModalProps {
    isOpen: boolean
    onClose: () => void
    unplannedOrders: WorkOrder[]
    onPlan: (selectedIds: number[]) => void
    isLoading?: boolean

    onDataRefresh?: () => void
    initialSelectedIds?: number[]
    autoSelectAll?: boolean
}

export function PlanningSelectionModal({
    isOpen,
    onClose,
    unplannedOrders,
    onPlan,
    isLoading = false,
    onDataRefresh,
    initialSelectedIds = [],
    autoSelectAll = true
}: PlanningSelectionModalProps) {
    const [selectedIds, setSelectedIds] = useState<number[]>(initialSelectedIds)

    // Sync selectedIds when modal opens or initialSelectedIds changes
    useEffect(() => {
        if (isOpen) {
            setSelectedIds(initialSelectedIds);
        }
    }, [isOpen, initialSelectedIds]);

    // Filter states
    const [priorityFilter, setPriorityFilter] = useState<string[]>([])
    const [dateSort, setDateSort] = useState<'DEFAULT' | 'OLDEST_FIRST' | 'NEWEST_FIRST'>('DEFAULT')
    const [clientFilter, setClientFilter] = useState<string[]>([])
    const [sectorFilter, setSectorFilter] = useState<string>('ALL')
    const [materialFilter, setMaterialFilter] = useState<string>('ALL')
    const [promisedDateFilter, setPromisedDateFilter] = useState<string>('ALL')
    const [batchSizeFilter, setBatchSizeFilter] = useState<string>('ALL')
    const [showClaimsOnly, setShowClaimsOnly] = useState<boolean>(false)
    const [showDelayedOnly, setShowDelayedOnly] = useState<boolean>(false)
    const [showWithProcessesOnly, setShowWithProcessesOnly] = useState<boolean>(false)
    const [clientSearchTerm, setClientSearchTerm] = useState('')


    // Derived lists
    const uniqueClients = Array.from(new Set(unplannedOrders.map(o => o.cliente?.nombre).filter((n): n is string => !!n))).sort()
    const uniqueSectors = Array.from(new Set(unplannedOrders.map(o => o.sector?.nombre).filter((n): n is string => !!n))).sort()

    const filteredClients = uniqueClients.filter(c =>
        c.toLowerCase().includes(clientSearchTerm.toLowerCase())
    );

    // Apply filters and sort
    const filteredOrders = unplannedOrders
        .filter(order => {
            // Priority
            if (priorityFilter.length > 0) {
                const p = order.prioridad?.descripcion?.toLowerCase() || ''
                // If "Normal" selected, we match "normal". 
                // If "Urgente" (generic) selected, exact match or contains? 
                // Previous logic: 'URGENTE' -> exact 'urgente'. 'URGENTE 1' -> includes 'urgente 1'.

                const matchesPriority = priorityFilter.some(filter => {
                    if (filter === 'URGENTE') return p === 'urgente';
                    if (filter === 'URGENTE 1') return p.includes('urgente 1') || p === 'urgente 1';
                    if (filter === 'URGENTE 2') return p.includes('urgente 2') || p === 'urgente 2';
                    if (filter === 'NORMAL') return p.includes('normal');
                    return false;
                });

                if (!matchesPriority) return false;
            }

            // Client
            if (clientFilter.length > 0) {
                const clientName = order.cliente?.nombre || '';
                // Since our filter values come from the unique list directly, exact match is appropriate.
                // However, we need to ensure the stored filter values match what's in the order.
                if (!clientFilter.includes(clientName)) return false;
            }

            // Sector
            if (sectorFilter !== 'ALL') {
                if (order.sector?.nombre !== sectorFilter) return false
            }

            // Claims Filter
            if (showClaimsOnly) {
                if (!order.reclamo || order.reclamo === 0) return false
            }

            // Material Status Filter
            if (materialFilter !== 'ALL') {
                const estado = order.estado_material || 'sin_datos'
                if (materialFilter === 'OK' && estado !== 'ok') return false
                if (materialFilter === 'PEDIDO' && estado !== 'pedido') return false
                if (materialFilter === 'SIN_STOCK' && estado !== 'sin_stock' && estado !== 'sin_datos') return false
            }

            // Promised Date Filter
            if (promisedDateFilter !== 'ALL') {
                const promisedDate = order.fecha_prometida ? new Date(order.fecha_prometida) : null
                if (!promisedDate) return false

                const today = new Date()
                today.setHours(0, 0, 0, 0)

                // End of this week (Sunday)
                const endOfWeek = new Date(today)
                endOfWeek.setDate(today.getDate() + (7 - today.getDay()))

                // End of month
                const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

                // Next 2 weeks
                const nextWeekEnd = new Date(today)
                nextWeekEnd.setDate(today.getDate() + 14)

                // Filter: date must be >= today AND <= end of period
                if (promisedDateFilter === 'THIS_WEEK') {
                    if (promisedDate < today || promisedDate > endOfWeek) return false
                }
                if (promisedDateFilter === 'THIS_MONTH') {
                    if (promisedDate < today || promisedDate > endOfMonth) return false
                }
                if (promisedDateFilter === 'NEXT_2_WEEKS') {
                    if (promisedDate < today || promisedDate > nextWeekEnd) return false
                }
            }

            // Delayed Orders Filter
            if (showDelayedOnly) {
                const promisedDate = order.fecha_prometida ? new Date(order.fecha_prometida) : null
                if (!promisedDate) return false
                const today = new Date()
                today.setHours(0, 0, 0, 0)
                if (promisedDate >= today) return false
            }

            // Has Processes Filter
            if (showWithProcessesOnly) {
                if (!order.procesos || order.procesos.length === 0) return false
            }

            // Batch Size Filter
            if (batchSizeFilter !== 'ALL') {
                const units = order.unidades || 0
                if (batchSizeFilter === 'SMALL' && units > 10) return false
                if (batchSizeFilter === 'MEDIUM' && (units <= 10 || units > 50)) return false
                if (batchSizeFilter === 'LARGE' && units <= 50) return false
            }

            return true
        })
        .sort((a, b) => {
            // Priority Sort: Initial Selected Orders First
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
    }, [priorityFilter, dateSort, clientFilter, sectorFilter, materialFilter, promisedDateFilter, batchSizeFilter, showClaimsOnly, showDelayedOnly, showWithProcessesOnly, autoSelectAll])

    // Calculate estimated workload
    const calculateEstimatedTime = () => {
        const selectedOrders = unplannedOrders.filter(o => selectedIds.includes(o.id))
        let totalMinutes = 0
        selectedOrders.forEach(o => {
            o.procesos?.forEach(p => {
                totalMinutes += p.tiempo_proceso || 0
            })
        })

        if (totalMinutes === 0) return null

        const MIN_LABORAL_DIA = 495 // 8.25 hours
        const days = (totalMinutes / MIN_LABORAL_DIA).toFixed(1)
        const hours = (totalMinutes / 60).toFixed(1)

        return `${days} días (${hours} hs)`
    }

    const estimatedTime = calculateEstimatedTime()

    const togglePriority = (p: string) => {
        setPriorityFilter(prev =>
            prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
        )
    }

    const toggleClient = (c: string) => {
        setClientFilter(prev =>
            prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
        )
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[95vw] w-[95vw] sm:max-w-[95vw] h-[95vh] flex flex-col p-0 gap-0">

                {/* Header with Integrated Stats */}
                <DialogHeader className="px-6 py-4 border-b flex flex-row items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <DialogTitle className="text-xl">Planificar Órdenes</DialogTitle>
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
                    </div>
                </DialogHeader>

                {/* Filter Toolbar Section - Symmetric & Compact */}
                <div className="px-6 py-2.5 border-b bg-slate-50/80 space-y-2.5 shrink-0">

                    {/* Row 1: Unified Priority & Status Toggles */}
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Prioridad:</span>
                            <div className="flex bg-slate-200/50 p-0.5 rounded-lg border border-slate-200">
                                <button
                                    onClick={() => setPriorityFilter([])}
                                    className={cn(
                                        "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all",
                                        priorityFilter.length === 0 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                    )}
                                >
                                    Todas
                                </button>
                                {(['URGENTE', 'URGENTE 1', 'URGENTE 2', 'NORMAL'] as const).map(option => (
                                    <button
                                        key={option}
                                        onClick={() => togglePriority(option)}
                                        className={cn(
                                            "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all",
                                            priorityFilter.includes(option) ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                        )}
                                    >
                                        {option === 'URGENTE' ? 'URG' : option}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="h-5 w-px bg-slate-300" />

                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setShowWithProcessesOnly(!showWithProcessesOnly)}>
                                <div className={cn(
                                    "w-7 h-3.5 rounded-full p-0.5 transition-colors",
                                    showWithProcessesOnly ? "bg-green-500" : "bg-slate-300"
                                )}>
                                    <div className={cn(
                                        "w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform",
                                        showWithProcessesOnly ? "translate-x-3" : "translate-x-0"
                                    )} />
                                </div>
                                <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Procesos</span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setShowDelayedOnly(!showDelayedOnly)}>
                                <div className={cn(
                                    "w-7 h-3.5 rounded-full p-0.5 transition-colors",
                                    showDelayedOnly ? "bg-red-500" : "bg-slate-300"
                                )}>
                                    <div className={cn(
                                        "w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform",
                                        showDelayedOnly ? "translate-x-3" : "translate-x-0"
                                    )} />
                                </div>
                                <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Retrasadas</span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setShowClaimsOnly(!showClaimsOnly)}>
                                <div className={cn(
                                    "w-7 h-3.5 rounded-full p-0.5 transition-colors",
                                    showClaimsOnly ? "bg-orange-500" : "bg-slate-300"
                                )}>
                                    <div className={cn(
                                        "w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform",
                                        showClaimsOnly ? "translate-x-3" : "translate-x-0"
                                    )} />
                                </div>
                                <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Reclamos</span>
                            </label>
                        </div>
                    </div>

                    {/* Row 2: Symmetric Grid of All Selectors */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                        {/* Client Selector */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="justify-between bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                                    <span className="truncate">
                                        {clientFilter.length === 0 ? "Cliente: Todos" : clientFilter.length === 1 ? clientFilter[0] : `${clientFilter.length} Selecc.`}
                                    </span>
                                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[280px] p-0 shadow-xl border-slate-200" align="start">
                                <div className="flex flex-col w-full bg-white rounded-md">
                                    <div className="flex items-center border-b px-2.5 py-2 bg-slate-50/50">
                                        <Search className="mr-2 h-3.5 w-3.5 shrink-0 opacity-40" />
                                        <input
                                            className="flex h-7 w-full rounded-md bg-transparent text-sm outline-none placeholder:text-slate-400"
                                            placeholder="Filtrar clientes..."
                                            value={clientSearchTerm}
                                            onChange={(e) => setClientSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <div className="max-h-[250px] overflow-auto p-1.5 space-y-0.5">
                                        <div
                                            className="relative flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-xs hover:bg-slate-100 transition-colors"
                                            onClick={() => setClientFilter([])}
                                        >
                                            <div className={cn(
                                                "mr-2.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-slate-300",
                                                clientFilter.length === 0 ? "bg-slate-900 border-slate-900 text-white" : "text-transparent"
                                            )}>
                                                <Check className="h-3 w-3" />
                                            </div>
                                            Todos los clientes
                                        </div>
                                        {filteredClients.map((client) => (
                                            <div
                                                key={client}
                                                className="relative flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-xs hover:bg-slate-100 transition-colors"
                                                onClick={() => setClientFilter(prev => prev.includes(client) ? prev.filter(c => c !== client) : [...prev, client])}
                                            >
                                                <div className={cn(
                                                    "mr-2.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-slate-300",
                                                    clientFilter.includes(client) ? "bg-slate-900 border-slate-900 text-white" : "text-transparent"
                                                )}>
                                                    <Check className="h-3 w-3" />
                                                </div>
                                                <span className="truncate">{client}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Select value={sectorFilter} onValueChange={setSectorFilter}>
                            <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                                <SelectValue placeholder="Sector" />
                            </SelectTrigger>
                            <SelectContent><SelectItem value="ALL" className="text-xs">Sector: Todos</SelectItem>{uniqueSectors.map(s => (<SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>))}</SelectContent>
                        </Select>

                        <Select value={materialFilter} onValueChange={setMaterialFilter}>
                            <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                                <SelectValue placeholder="Material" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL" className="text-xs">Material: Todos</SelectItem>
                                <SelectItem value="OK" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500" />Disponible</div></SelectItem>
                                <SelectItem value="PEDIDO" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" />Pedido</div></SelectItem>
                                <SelectItem value="SIN_STOCK" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-500" />Sin Stock</div></SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={promisedDateFilter} onValueChange={setPromisedDateFilter}>
                            <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                                <SelectValue placeholder="Entrega" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL" className="text-xs">Entrega: Todas</SelectItem>
                                <SelectItem value="THIS_WEEK" className="text-xs">Esta semana</SelectItem>
                                <SelectItem value="NEXT_2_WEEKS" className="text-xs">Próx. 2 semanas</SelectItem>
                                <SelectItem value="THIS_MONTH" className="text-xs">Este mes</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={batchSizeFilter} onValueChange={setBatchSizeFilter}>
                            <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                                <SelectValue placeholder="Unidades" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL" className="text-xs">Lote: Todos</SelectItem>
                                <SelectItem value="SMALL" className="text-xs">Pequeño (≤10)</SelectItem>
                                <SelectItem value="MEDIUM" className="text-xs">Mediano (11-50)</SelectItem>
                                <SelectItem value="LARGE" className="text-xs">Grande ({">"}50)</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={dateSort} onValueChange={(val: any) => setDateSort(val)}>
                            <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                                <SelectValue placeholder="Ordenar" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DEFAULT" className="text-xs">Orden: Defecto</SelectItem>
                                <SelectItem value="OLDEST_FIRST" className="text-xs">Más antiguos</SelectItem>
                                <SelectItem value="NEWEST_FIRST" className="text-xs">Más recientes</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>


                {/* Content Area */}
                <div className="flex-1 overflow-hidden bg-gray-50 flex flex-col">
                    <div className="flex-1 overflow-auto p-4 sm:p-6">
                        <div className="bg-white border rounded-lg shadow-sm">
                            <PlanningListTable
                                data={filteredOrders}
                                selectedIds={selectedIds}
                                onSelectionChange={setSelectedIds}
                                isLoading={isLoading}
                                onRowClick={() => { }}
                                onDataChange={onDataRefresh}
                                hideStatus={true}
                                highlightedIds={initialSelectedIds}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <DialogFooter className="px-6 py-4 border-t bg-white gap-2 shrink-0">
                    <Button variant="outline" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={() => {
                            const selectedOrders = unplannedOrders.filter(o => selectedIds.includes(o.id));

                            // 1. Check for empty processes
                            const emptyOrders = selectedOrders.filter(o => !o.procesos || o.procesos.length === 0);
                            if (emptyOrders.length > 0) {
                                const orderIds = emptyOrders.map(o => `#${o.id}`).join(", ");
                                toast.error(`Las órdenes ${orderIds} no tienen procesos. Agregue procesos antes de planificar.`);
                                return;
                            }

                            // 2. Check for missing stock
                            const noStockOrders = selectedOrders.filter(o => {
                                const estado = o.estado_material || 'sin_datos';
                                return estado === 'sin_stock' || estado === 'sin_datos';
                            });

                            if (noStockOrders.length > 0) {
                                const orderIds = noStockOrders.map(o => `#${o.id}`).join(", ");
                                toast.error(`Las órdenes ${orderIds} no tienen stock disponible. Resuelva el stock antes de planificar.`, {
                                    duration: 5000,
                                    description: "Verifique la columna Material en la lista."
                                });
                                return;
                            }

                            onPlan(selectedIds)
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
                </DialogFooter>
            </DialogContent >
        </Dialog >
    )
}
