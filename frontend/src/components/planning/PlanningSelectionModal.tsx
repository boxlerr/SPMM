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
import { WorkOrderFilters, WorkOrderFilterState, initialFilterState, applyWorkOrderFilters } from "@/components/common/WorkOrderFilters"

interface PlanningSelectionModalProps {
    isOpen: boolean
    onClose: () => void
    unplannedOrders: WorkOrder[]
    onPlan: (selectedIds: number[]) => void
    isLoading?: boolean

    onDataRefresh?: () => void
    initialSelectedIds?: number[]
    autoSelectAll?: boolean
    availableResourcesCount?: number
}

export function PlanningSelectionModal({
    isOpen,
    onClose,
    unplannedOrders,
    onPlan,
    isLoading = false,
    onDataRefresh,
    initialSelectedIds = [],
    autoSelectAll = true,
    availableResourcesCount = 1
}: PlanningSelectionModalProps) {
    const [selectedIds, setSelectedIds] = useState<number[]>(initialSelectedIds)

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

    // Derived lists
    const uniqueClients = Array.from(new Set(unplannedOrders.map(o => o.cliente?.nombre).filter((n): n is string => !!n))).sort()
    const uniqueSectors = Array.from(new Set(unplannedOrders.map(o => o.sector?.nombre).filter((n): n is string => !!n))).sort()

    const filteredClients = uniqueClients.filter(c =>
        c.toLowerCase().includes(clientSearchTerm.toLowerCase())
    );

    // Apply filters and sort
    const filteredOrders = applyWorkOrderFilters(unplannedOrders, filters)
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
    }, [filters, dateSort, autoSelectAll])

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

        // Calculate time based on available resources
        const resourceCount = Math.max(1, availableResourcesCount);
        const effectiveMinutes = totalMinutes / resourceCount;

        const MIN_LABORAL_DIA = 495 // 8.25 hours
        const days = (effectiveMinutes / MIN_LABORAL_DIA).toFixed(1)
        const hours = (effectiveMinutes / 60).toFixed(1)

        return `${days} días (${hours} hs)`
    }

    const estimatedTime = calculateEstimatedTime()

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
                <div className="px-6 py-0 border-b bg-slate-50/80 shrink-0">
                    <WorkOrderFilters filters={filters} setFilters={setFilters} orders={unplannedOrders}>
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
                    </WorkOrderFilters>
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
