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
}

export function PlanningSelectionModal({
    isOpen,
    onClose,
    unplannedOrders,
    onPlan,
    isLoading = false,
    onDataRefresh
}: PlanningSelectionModalProps) {
    const [selectedIds, setSelectedIds] = useState<number[]>([])

    // Filter states
    const [priorityFilter, setPriorityFilter] = useState<string[]>([])
    const [dateSort, setDateSort] = useState<'DEFAULT' | 'OLDEST_FIRST' | 'NEWEST_FIRST'>('DEFAULT')
    const [clientFilter, setClientFilter] = useState<string[]>([])
    const [sectorFilter, setSectorFilter] = useState<string>('ALL')
    const [showClaimsOnly, setShowClaimsOnly] = useState<boolean>(false)
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

            return true
        })
        .sort((a, b) => {
            if (dateSort === 'DEFAULT') return 0
            const dateA = a.fecha_entrada ? new Date(a.fecha_entrada).getTime() : 0
            const dateB = b.fecha_entrada ? new Date(b.fecha_entrada).getTime() : 0
            if (dateSort === 'OLDEST_FIRST') return dateA - dateB
            if (dateSort === 'NEWEST_FIRST') return dateB - dateA
            return 0
        })

    // Auto-select filtered orders when filters change
    useEffect(() => {
        const ids = filteredOrders.map(o => o.id)
        setSelectedIds(ids)
    }, [priorityFilter, dateSort, clientFilter, sectorFilter, showClaimsOnly])

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

                {/* Filter Toolbar Section */}
                <div className="px-6 py-4 border-b bg-slate-50/50 space-y-4 shrink-0">
                    <div className="flex flex-col gap-4">

                        {/* Primary Row: Priority & Claims */}
                        <div className="flex flex-col sm:flex-row gap-4 justify-between">
                            {/* Priority Group */}
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Prioridad:</span>
                                <button
                                    onClick={() => setPriorityFilter([])}
                                    className={cn(
                                        "whitespace-nowrap px-3 py-1 text-xs font-medium rounded-full transition-all border",
                                        priorityFilter.length === 0
                                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                    )}
                                >
                                    Todas
                                </button>
                                {(['URGENTE', 'URGENTE 1', 'URGENTE 2', 'NORMAL'] as const).map(option => (
                                    <button
                                        key={option}
                                        onClick={() => togglePriority(option)}
                                        className={cn(
                                            "whitespace-nowrap px-3 py-1 text-xs font-medium rounded-full transition-all border",
                                            priorityFilter.includes(option)
                                                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                        )}
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sólo reclamos:</span>
                                <div
                                    className={cn(
                                        "w-10 h-5 rounded-full p-0.5 cursor-pointer transition-colors duration-200 ease-in-out",
                                        showClaimsOnly ? "bg-red-500" : "bg-slate-200"
                                    )}
                                    onClick={() => setShowClaimsOnly(!showClaimsOnly)}
                                >
                                    <div className={cn(
                                        "w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out flex items-center justify-center",
                                        showClaimsOnly ? "translate-x-5" : "translate-x-0"
                                    )}>
                                        {showClaimsOnly && <AlertCircle className="w-2.5 h-2.5 text-red-500" />}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Secondary Row: Filters & Sort */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                        {/* Filters */}
                        <div className="sm:col-span-9 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        className="justify-between bg-white w-full"
                                    >
                                        <span className="truncate">
                                            {clientFilter.length === 0
                                                ? "Todos los clientes"
                                                : clientFilter.length === 1
                                                    ? clientFilter[0]
                                                    : `${clientFilter.length} clientes seleccionados`
                                            }
                                        </span>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[300px] p-0" align="start">
                                    <div className="flex flex-col w-full bg-white rounded-md">
                                        <div className="flex items-center border-b px-3 py-2">
                                            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                                            <input
                                                className="flex h-9 w-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                                placeholder="Buscar cliente..."
                                                value={clientSearchTerm}
                                                onChange={(e) => setClientSearchTerm(e.target.value)}
                                            />
                                        </div>
                                        <div className="max-h-[300px] overflow-auto p-1">
                                            <div
                                                className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-slate-100"
                                                onClick={() => setClientFilter([])}
                                            >
                                                <div className={cn(
                                                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                    clientFilter.length === 0 ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                                                )}>
                                                    <Check className={cn("h-4 w-4")} />
                                                </div>
                                                Todos los clientes
                                            </div>

                                            {filteredClients.map((client) => (
                                                <div
                                                    key={client}
                                                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-slate-100"
                                                    onClick={() => {
                                                        setClientFilter(prev =>
                                                            prev.includes(client)
                                                                ? prev.filter(c => c !== client)
                                                                : [...prev, client]
                                                        );
                                                    }}
                                                >
                                                    <div className={cn(
                                                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                        clientFilter.includes(client) ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                                                    )}>
                                                        <Check className={cn("h-4 w-4")} />
                                                    </div>
                                                    {client}
                                                </div>
                                            ))}
                                            {filteredClients.length === 0 && (
                                                <div className="py-6 text-center text-sm text-muted-foreground">
                                                    No se encontró el cliente.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>

                            <Select value={sectorFilter} onValueChange={setSectorFilter}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue placeholder="Todos los sectores" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Todos los sectores</SelectItem>
                                    {uniqueSectors.map(s => (
                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Sort */}
                        <div className="sm:col-span-3">
                            <Select value={dateSort} onValueChange={(val: any) => setDateSort(val)}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue placeholder="Ordenar por" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DEFAULT">Orden por defecto</SelectItem>
                                    <SelectItem value="OLDEST_FIRST">Más antiguos primero</SelectItem>
                                    <SelectItem value="NEWEST_FIRST">Más recientes primero</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
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
                            const emptyOrders = selectedOrders.filter(o => !o.procesos || o.procesos.length === 0);

                            if (emptyOrders.length > 0) {
                                const orderIds = emptyOrders.map(o => `#${o.id}`).join(", ");
                                toast.error(`Las órdenes ${orderIds} no tienen procesos. Agregue procesos antes de planificar.`);
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
