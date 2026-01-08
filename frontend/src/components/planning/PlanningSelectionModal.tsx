"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PlanningListTable } from "./PlanningListTable"
import { WorkOrder } from "@/lib/types"

import { toast } from "sonner"

interface PlanningSelectionModalProps {
    isOpen: boolean
    onClose: () => void
    unplannedOrders: WorkOrder[]
    onPlan: (selectedIds: number[]) => void
    isLoading?: boolean
}

export function PlanningSelectionModal({
    isOpen,
    onClose,
    unplannedOrders,
    onPlan,
    isLoading = false
}: PlanningSelectionModalProps) {
    const [selectedIds, setSelectedIds] = useState<number[]>([])

    // Filter states
    const [priorityFilter, setPriorityFilter] = useState<'ALL' | 'URGENTE' | 'URGENTE 1' | 'URGENTE 2' | 'NORMAL'>('ALL')
    const [dateSort, setDateSort] = useState<'DEFAULT' | 'OLDEST_FIRST' | 'NEWEST_FIRST'>('DEFAULT')
    const [clientFilter, setClientFilter] = useState<string>('ALL')
    const [sectorFilter, setSectorFilter] = useState<string>('ALL')

    // Derived lists for dropdowns
    const uniqueClients = Array.from(new Set(unplannedOrders.map(o => o.cliente?.nombre).filter(Boolean))).sort()
    const uniqueSectors = Array.from(new Set(unplannedOrders.map(o => o.sector?.nombre).filter(Boolean))).sort()

    // Apply filters and sort to get the current list
    const filteredOrders = unplannedOrders
        .filter(order => {
            // Priority
            if (priorityFilter !== 'ALL') {
                const p = order.prioridad?.descripcion?.toLowerCase() || ''
                if (priorityFilter === 'URGENTE') {
                    if (p !== 'urgente') return false
                } else if (priorityFilter === 'URGENTE 1') {
                    if (!p.includes('urgente 1') && p !== 'urgente 1') return false
                } else if (priorityFilter === 'URGENTE 2') {
                    if (!p.includes('urgente 2') && p !== 'urgente 2') return false
                } else if (priorityFilter === 'NORMAL') {
                    if (!p.includes('normal')) return false
                }
            }

            // Client
            if (clientFilter !== 'ALL') {
                if (order.cliente?.nombre !== clientFilter) return false
            }

            // Sector
            if (sectorFilter !== 'ALL') {
                if (order.sector?.nombre !== sectorFilter) return false
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

    // Auto-select filtered orders when filters change or when modal opens
    // Using a simpler approach: calculate selected IDs on the fly for the button,
    // or keep syncing state. Syncing state allows manual deselect if user wants to exclude one specific item.
    // Let's sync state when filters change.

    const applyCriteria = () => {
        const ids = filteredOrders.map(o => o.id)
        setSelectedIds(ids)
    }

    // Determine current criteria text
    const getCriteriaText = () => {
        const parts = []
        if (priorityFilter !== 'ALL') parts.push(`Prioridad: ${priorityFilter.toLowerCase()}`)
        if (clientFilter !== 'ALL') parts.push(`Cliente: ${clientFilter}`)
        if (sectorFilter !== 'ALL') parts.push(`Sector: ${sectorFilter}`)
        if (dateSort !== 'DEFAULT') parts.push(`Fecha: ${dateSort === 'OLDEST_FIRST' ? 'antigua a nueva' : 'nueva a antigua'}`)
        return parts.length > 0 ? parts.join(', ') : 'Ninguno (selección manual)'
    }

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

        return `${days} días de trabajo aprox. (${hours} hs)`
    }

    const estimatedTime = calculateEstimatedTime()

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[95vw] w-[95vw] sm:max-w-[95vw] h-[95vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 py-4 border-b space-y-4">
                    <DialogTitle>Seleccionar Órdenes para Planificar</DialogTitle>

                    {/* Criterios Section */}
                    <div className="bg-slate-50 border rounded-md p-4 space-y-4">
                        <div className="flex justify-between items-center">
                            <div className="text-sm font-medium text-slate-700">Criterios de planificación</div>
                            {estimatedTime && (
                                <div className="text-sm font-semibold text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                                    ⏱ Carga estimada: {estimatedTime}
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

                            {/* Priority Selector */}
                            <div className="flex flex-col gap-1.5 col-span-2">
                                <label className="text-xs text-slate-500 font-medium">Prioridad</label>
                                <div className="flex bg-white rounded-md border shadow-sm p-1 gap-1 overflow-x-auto">
                                    {(['ALL', 'URGENTE', 'URGENTE 1', 'URGENTE 2', 'NORMAL'] as const).map(option => (
                                        <button
                                            key={option}
                                            onClick={() => {
                                                setPriorityFilter(option)
                                                // Automatic apply
                                                setTimeout(applyCriteria, 0)
                                            }}
                                            className={`whitespace-nowrap flex-1 px-3 py-1.5 text-sm rounded-md transition-all ${priorityFilter === option
                                                ? 'bg-blue-100 text-blue-700 font-medium'
                                                : 'hover:bg-gray-50 text-slate-600'
                                                }`}
                                        >
                                            {option === 'ALL' ? 'Todas' : option.charAt(0) + option.slice(1).toLowerCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Date Sort Selector */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs text-slate-500 font-medium">Fecha de Entrada</label>
                                <div className="flex bg-white rounded-md border shadow-sm p-1">
                                    <button
                                        onClick={() => {
                                            setDateSort(dateSort === 'OLDEST_FIRST' ? 'DEFAULT' : 'OLDEST_FIRST')
                                            setTimeout(applyCriteria, 0)
                                        }}
                                        className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-all ${dateSort === 'OLDEST_FIRST'
                                            ? 'bg-blue-100 text-blue-700 font-medium'
                                            : 'hover:bg-gray-50 text-slate-600'
                                            }`}
                                    >
                                        Más antiguas
                                    </button>
                                    <button
                                        onClick={() => {
                                            setDateSort(dateSort === 'NEWEST_FIRST' ? 'DEFAULT' : 'NEWEST_FIRST')
                                            setTimeout(applyCriteria, 0)
                                        }}
                                        className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-all ${dateSort === 'NEWEST_FIRST'
                                            ? 'bg-blue-100 text-blue-700 font-medium'
                                            : 'hover:bg-gray-50 text-slate-600'
                                            }`}
                                    >
                                        Más nuevas
                                    </button>
                                </div>
                            </div>

                            {/* Custom / Add More Placeholder */}
                            <div className="flex flex-col gap-1.5 items-start justify-end pb-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 -ml-2"
                                    onClick={() => applyCriteria()} // Force re-apply manually if needed
                                >
                                    Refrescar Selección
                                </Button>
                            </div>

                            {/* Client Selector (Full row if needed or split) */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs text-slate-500 font-medium">Cliente</label>
                                <select
                                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    value={clientFilter}
                                    onChange={(e) => {
                                        setClientFilter(e.target.value)
                                        setTimeout(applyCriteria, 0)
                                    }}
                                >
                                    <option value="ALL">Todos los clientes</option>
                                    {uniqueClients.map(c => (
                                        <option key={c} value={c as string}>{c as string}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Sector Selector */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs text-slate-500 font-medium">Sector</label>
                                <select
                                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    value={sectorFilter}
                                    onChange={(e) => {
                                        setSectorFilter(e.target.value)
                                        setTimeout(applyCriteria, 0)
                                    }}
                                >
                                    <option value="ALL">Todos los sectores</option>
                                    {uniqueSectors.map(s => (
                                        <option key={s} value={s as string}>{s as string}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-auto p-6 bg-gray-50/50">
                    <div className="bg-white border rounded-lg shadow-sm">
                        <PlanningListTable
                            data={filteredOrders} // Show only filtered ones? Or all and check filtered? 
                            // Result: Show filtered ones makes it clearer what "Automatic" means.
                            // But user said "igual quiero que abajo se muestre la lista de ordenes".
                            // If we filter the DATA validation, we might hide unselected ones.
                            // Better to show filtered list so the user sees exactly what will be planned.
                            selectedIds={selectedIds}
                            onSelectionChange={setSelectedIds}
                            isLoading={isLoading}
                            onRowClick={() => { }}
                        />
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t bg-white gap-2 justify-between items-center">
                    <div className="text-sm text-slate-500">
                        {selectedIds.length} órdenes seleccionadas por criterio: <span className="font-medium text-slate-700">{getCriteriaText()}</span>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => {
                                // Validate again just in case
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
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {isLoading ? "Procesando..." : `Planificar`}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
