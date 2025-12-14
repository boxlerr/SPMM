"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PlanningListTable } from "./PlanningListTable"
import { WorkOrder } from "@/lib/types"

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

    const handlePlanClick = () => {
        onPlan(selectedIds)
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[95vw] w-[95vw] sm:max-w-[95vw] h-[95vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 py-4 border-b">
                    <DialogTitle>Seleccionar Órdenes para Planificar</DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-auto p-6 bg-gray-50/50">
                    <div className="bg-white border rounded-lg shadow-sm">
                        <PlanningListTable
                            data={unplannedOrders}
                            selectedIds={selectedIds}
                            onSelectionChange={setSelectedIds}
                            isLoading={isLoading}
                            // Pass empty handlers effectively disabling row click nav if desired, or keep generic
                            onRowClick={() => { }}
                        />
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t bg-white gap-2">
                    <Button variant="outline" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handlePlanClick}
                        disabled={selectedIds.length === 0 || isLoading}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        {isLoading ? "Procesando..." : `Planificar Seleccionadas (${selectedIds.length})`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
