"use client"

import { useMemo } from "react"
import { BarChart3, LayoutGrid, RefreshCw } from "lucide-react"
import { useDashboardData } from "@/hooks/useDashboardData"
import StatsCards from "@/components/dashboard/StatsCards"
import OrdenesCriticas from "@/components/dashboard/OrdenesCriticas"
import TimelineEntregas from "@/components/dashboard/TimelineEntregas"
import DistribucionPrioridades from "@/components/dashboard/DistribucionPrioridades"
import TopClients from "@/components/dashboard/TopClients"
import TopArticles from "@/components/dashboard/TopArticles"
import IncidenciasPlanos from "@/components/dashboard/IncidenciasPlanos"
import RendimientoEstimadoReal from "@/components/dashboard/RendimientoEstimadoReal"
import BotonReporteMensual from "@/components/dashboard/BotonReporteMensual"


import { usePermisos } from "@/hooks/usePermisos"
import { tarjetasVisibles, type TarjetaCodigo } from "@/lib/permisos"

import PriorityOrdersModal from "@/components/dashboard/PriorityOrdersModal"
import StatusOrdersModal from "@/components/dashboard/StatusOrdersModal"

// Las tres tarjetas chicas van en una grilla de 4 columnas en pantallas grandes (Artículos
// ocupa 2). Sin el ranking de clientes quedan 3 columnas; con sólo el ranking, 2 (así no
// queda una tarjeta angosta y un hueco al lado). Clases escritas enteras: Tailwind no ve
// las que se arman pegando pedazos.
const GRILLA_XL: Record<number, string> = {
  4: "xl:grid-cols-4",
  3: "xl:grid-cols-3",
  2: "xl:grid-cols-2",
  1: "xl:grid-cols-2",
}

export default function DashboardPage() {
  // RF-28: cada tarjeta es de un área (lib/permisos.ts, TARJETAS_DASHBOARD) y cada uno ve
  // sólo las de las áreas que puede leer: el Operario, sin Clientes, no ve el ranking de
  // clientes. Las que no se ven tampoco se piden (el backend las contesta 403). Sin
  // permisos (backend viejo) se ven todas, como siempre.
  //
  // El rendimiento POR PERSONA compara a la gente con nombre y apellido: es una sección
  // confidencial (RF-24) y es una tarjeta más, con la sección como requisito.
  const { permisos } = usePermisos()
  const visibles = useMemo(() => tarjetasVisibles(permisos), [permisos])
  const ve = (codigo: TarjetaCodigo) => visibles.includes(codigo)
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
    errorStatusOrders,
    setSelectedStatus,
    setStatusOrders,
    fetchOrdenesPorEstado,
    refreshAll,
  } = useDashboardData(visibles)
  const columnasChicas = (ve("top_articulos") ? 2 : 0) + (ve("top_clientes") ? 1 : 0)
    + (ve("distribucion_prioridades") ? 1 : 0)

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
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-4 sm:py-6">
          {/* RF-27. Esta cabecera se pega arriba al scrollear y la campana de avisos flota
              en la esquina de arriba a la derecha: en el teléfono, «Actualizar» quedaba
              justo debajo de ella, y en 320px además se salía de la cabecera (el título
              no achica). Abajo de `sm` el botón va debajo del título, a la izquierda;
              el `pr-12` (hasta `lg`) le deja a la campana su esquina. */}
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between pr-12 lg:pr-0">
            <div className="min-w-0">
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
            {visibles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {/* RF-21: el reporte de un mes (por defecto el que cerró), en su pantalla. */}
                <BotonReporteMensual />
                <button
                  onClick={refreshAll}
                  disabled={isRefreshing}
                  className="shrink-0 flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 bg-gradient-to-r from-[#DC143C] to-[#B8112E] text-white rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                  {/* Con rótulo también en el teléfono: ahí va solo en su renglón, y un
                      botón rojo con dos flechitas y nada más no dice qué hace. */}
                  <span>Actualizar</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contenedor principal */}
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8 space-y-6 md:space-y-8">
        {visibles.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-10 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gray-100">
              <LayoutGrid className="h-5 w-5 text-gray-500" />
            </div>
            <p className="font-semibold text-gray-900">No hay nada para mostrarte acá todavía</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
              El Dashboard resume las órdenes, los clientes y las no conformidades, y tu usuario no
              ve ninguna de esas pantallas. Si las necesitás, pedíselas a un administrador.
            </p>
          </div>
        )}

        {/* 1. Estado de Ordenes (Stats) */}
        {ve("estado_ordenes") && (
          <StatsCards estadisticas={estadisticas} loading={loading} error={error} onStatusClick={handleStatusClick} />
        )}

        {/* 2. Ordenes Críticas */}
        {ve("ordenes_criticas") && <OrdenesCriticas ordenes={ordenesCriticas} loading={loadingCriticas} />}

        {/* Interpretación de planos: incidencias y tiempo perdido */}
        {ve("incidencias_planos") && <IncidenciasPlanos />}

        {/* Rendimiento: tiempo estimado vs. real por proceso y por operario */}
        {ve("rendimiento") && <RendimientoEstimadoReal />}

        {/* 3. Timeline de entregas */}
        {ve("timeline_entregas") && <TimelineEntregas timeline={timelineEntregas} loading={loadingTimeline} />}

        {/* 4. Top Artículos y Top Clientes (y Distribución) */}
        {columnasChicas > 0 && (
          <div className={`grid grid-cols-1 md:grid-cols-2 ${GRILLA_XL[columnasChicas]} gap-6 md:gap-8`}>
            {/* Top Artículos */}
            {ve("top_articulos") && <TopArticles articulos={topArticulos} loading={loadingExtras} />}

            {/* Top Clientes */}
            {ve("top_clientes") && <TopClients clientes={topClientes} loading={loadingExtras} />}

            {/* Distribución de Prioridades (Manteniendo para no perder funcionalidad) */}
            {ve("distribucion_prioridades") && (
              <DistribucionPrioridades
                prioridades={distribucionPrioridades}
                loading={loadingExtras}
                onPriorityClick={handlePriorityClick}
              />
            )}
          </div>
        )}

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
        error={errorStatusOrders}
      />
    </div>
  )
}
