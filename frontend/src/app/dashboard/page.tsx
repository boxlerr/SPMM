"use client"

import { BarChart3, RefreshCw } from "lucide-react"
import { useDashboardData } from "@/hooks/useDashboardData"
import StatsCards from "@/components/dashboard/StatsCards"
import OrdenesCriticas from "@/components/dashboard/OrdenesCriticas"
import TimelineEntregas from "@/components/dashboard/TimelineEntregas"
import DistribucionPrioridades from "@/components/dashboard/DistribucionPrioridades"
import TopClients from "@/components/dashboard/TopClients"
import TopArticles from "@/components/dashboard/TopArticles"


import PriorityOrdersModal from "@/components/dashboard/PriorityOrdersModal"
import StatusOrdersModal from "@/components/dashboard/StatusOrdersModal"

export default function DashboardPage() {
  const {
    estadisticas,
    ordenesCriticas,
    timelineEntregas,
    topClientes,

    distribucionPrioridades,
    topArticulos,
    loading,
    loadingCriticas,
    loadingTimeline,
    loadingExtras,
    error,
    selectedPriority,
    priorityOrders,
    loadingPriorityOrders,
    setSelectedPriority,
    setPriorityOrders,
    fetchOrdenesPorPrioridad,
    selectedStatus,
    statusOrders,
    loadingStatusOrders,
    setSelectedStatus,
    setStatusOrders,
    fetchOrdenesPorEstado,
    refreshAll,
    apiUrl,
  } = useDashboardData()

  const handlePriorityClick = (prioridad: string) => {
    fetchOrdenesPorPrioridad(prioridad)
  }

  const handleStatusClick = (estado: string) => {
    fetchOrdenesPorEstado(estado)
  }

  const closePriorityModal = () => {
    setSelectedPriority(null)
    setPriorityOrders([])
  }

  const closeStatusModal = () => {
    setSelectedStatus(null)
    setStatusOrders([])
  }

  const isRefreshing = loading || loadingCriticas || loadingTimeline

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header sticky mejorado */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-xl shadow-lg">
                  <BarChart3 className="h-7 w-7 text-white" />
                </div>
                Dashboard
              </h1>
              <p className="text-gray-500 mt-1 text-sm md:text-base">
                Panel de control y estadísticas del sistema SPMM
              </p>
            </div>
            <button
              onClick={refreshAll}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 bg-gradient-to-r from-[#DC143C] to-[#B8112E] text-white rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contenedor principal */}
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8 space-y-6 md:space-y-8">
        {/* 1. Estado de Ordenes (Stats) */}
        <StatsCards estadisticas={estadisticas} loading={loading} error={error} onStatusClick={handleStatusClick} />

        {/* 2. Ordenes Críticas */}
        <OrdenesCriticas ordenes={ordenesCriticas} loading={loadingCriticas} />

        {/* 3. Timeline de entregas */}
        <TimelineEntregas timeline={timelineEntregas} loading={loadingTimeline} />

        {/* 4. Top Artículos y Top Clientes (y Distribución) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 md:gap-8">
          {/* Top Artículos */}
          <TopArticles articulos={topArticulos} loading={loadingExtras} />

          {/* Top Clientes */}
          <TopClients clientes={topClientes} loading={loadingExtras} />

          {/* Distribución de Prioridades (Manteniendo para no perder funcionalidad) */}
          <DistribucionPrioridades
            prioridades={distribucionPrioridades}
            loading={loadingExtras}
            onPriorityClick={handlePriorityClick}
          />
        </div>

      </div>

      {/* Modal de Órdenes por Prioridad */}
      <PriorityOrdersModal
        isOpen={!!selectedPriority}
        onClose={closePriorityModal}
        selectedPriority={selectedPriority}
        priorityOrders={priorityOrders}
        loading={loadingPriorityOrders}
      />

      {/* Modal de Órdenes por Estado */}
      <StatusOrdersModal
        isOpen={!!selectedStatus}
        onClose={closeStatusModal}
        selectedStatus={selectedStatus}
        statusOrders={statusOrders}
        loading={loadingStatusOrders}
      />
    </div>
  )
}
