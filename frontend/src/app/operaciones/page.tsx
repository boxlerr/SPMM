"use client"

import { useState } from "react"
import PlanificacionGanttWrapper from "@/components/PlanificacionGanttWrapper"
import TablaTareas from "@/components/TablaTareas"
import WorkOrdersListWrapper from "@/components/WorkOrdersListWrapper"
import { Activity, LayoutList, GanttChartSquare, Plus } from "lucide-react"
import { usePanelContext } from "@/contexts/PanelContext"
import CreateWorkOrderModal from "@/components/CreateWorkOrderModal"
import { Button } from "@/components/ui/button"

export default function OperacionesPage() {
  const [activeTab, setActiveTab] = useState<"gantt" | "tabla" | "work_orders">("gantt")
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const { isDetailsPanelOpen } = usePanelContext()

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header sticky mejorado */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-xl shadow-lg">
                  <Activity className="h-7 w-7 text-white" />
                </div>
                Operaciones
              </h1>
              <p className="text-gray-500 mt-1 text-sm md:text-base">Gestiona las operaciones del sistema</p>
            </div>
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all hover:shadow-lg"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nueva Orden
            </Button>
          </div>

          {/* Tabs Navigation */}
          <div className="flex items-center gap-1 mt-6 border-b border-gray-200">
            <button
              onClick={() => setActiveTab("gantt")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "gantt"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <GanttChartSquare size={18} />
              Gantt
            </button>
            <button
              onClick={() => setActiveTab("tabla")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "tabla"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <LayoutList size={18} />
              Procesos
            </button>
            <button
              onClick={() => setActiveTab("work_orders")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "work_orders"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
            >
              <LayoutList size={18} />
              Órdenes de Trabajo
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            {activeTab === "gantt" ? "Planificación (Gantt)" : activeTab === "tabla" ? "Procesos" : "Órdenes de Trabajo"}
          </h2>

          {activeTab === "gantt" && <PlanificacionGanttWrapper />}
          {activeTab === "tabla" && <TablaTareas />}
          {activeTab === "work_orders" && <WorkOrdersListWrapper />}
        </div>
      </div>

      <CreateWorkOrderModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          setIsCreateModalOpen(false)
        }}
      />
    </div>
  )
}
