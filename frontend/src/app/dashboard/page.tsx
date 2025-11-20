"use client"

import { useEffect, useState } from "react"
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  PlayCircle,
  TrendingUp,
  RefreshCw,
  Package,
  Users,
  Calendar,
  Factory,
  BarChart3,
  Activity,
} from "lucide-react"

interface EstadisticasOrdenes {
  completadas: number
  en_proceso: number
  pendientes: number
  retrasadas: number
  total: number
}

interface OrdenCritica {
  id: number
  articulo: string
  sector: string
  fecha_prometida: string
  dias_restantes: number
}

interface OcupacionSector {
  sector: string
  ordenes_activas: number
  porcentaje: number
}

interface TimelineEntrega {
  fecha: string
  fecha_formato: string
  dia_semana: string
  cantidad_ordenes: number
  ordenes: Array<{
    id: number
    articulo: string
    sector: string
  }>
}

export default function DashboardPage() {
  const [estadisticas, setEstadisticas] = useState<EstadisticasOrdenes | null>(null)
  const [ordenesCriticas, setOrdenesCriticas] = useState<OrdenCritica[]>([])
  const [ocupacionSectores, setOcupacionSectores] = useState<OcupacionSector[]>([])
  const [timelineEntregas, setTimelineEntregas] = useState<TimelineEntrega[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingCriticas, setLoadingCriticas] = useState(true)
  const [loadingOcupacion, setLoadingOcupacion] = useState(true)
  const [loadingTimeline, setLoadingTimeline] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

  const fetchEstadisticas = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`${apiUrl}/ordenes-estadisticas/estados`)

      if (!response.ok) {
        throw new Error("Error al obtener estadísticas")
      }

      const data = await response.json()
      setEstadisticas(data.data)
    } catch (err) {
      console.error("Error fetching stats:", err)
      setError("Error al cargar estadísticas")
    } finally {
      setLoading(false)
    }
  }

  const fetchOrdenesCriticas = async () => {
    try {
      setLoadingCriticas(true)
      const response = await fetch(`${apiUrl}/ordenes-estadisticas/criticas?dias=7`)

      if (!response.ok) {
        throw new Error("Error al obtener órdenes críticas")
      }

      const data = await response.json()
      setOrdenesCriticas(data.data)
    } catch (err) {
      console.error("Error fetching critical orders:", err)
    } finally {
      setLoadingCriticas(false)
    }
  }

  const fetchOcupacionSectores = async () => {
    try {
      setLoadingOcupacion(true)
      const response = await fetch(`${apiUrl}/ordenes-estadisticas/ocupacion-sector`)

      if (!response.ok) {
        throw new Error("Error al obtener ocupación por sector")
      }

      const data = await response.json()
      setOcupacionSectores(data.data)
    } catch (err) {
      console.error("Error fetching sector occupation:", err)
    } finally {
      setLoadingOcupacion(false)
    }
  }

  const fetchTimelineEntregas = async () => {
    try {
      setLoadingTimeline(true)
      const response = await fetch(`${apiUrl}/ordenes-estadisticas/proximas-entregas?dias=10`)

      if (!response.ok) {
        throw new Error("Error al obtener timeline de entregas")
      }

      const data = await response.json()

      console.log("[v0] Datos recibidos del backend:", data.data)

      const timelineSinDomingos = data.data
        .map((dia: TimelineEntrega) => {
          // Parsear la fecha en formato YYYY-MM-DD correctamente
          const [year, month, day] = dia.fecha.split("-").map(Number)
          const fecha = new Date(year, month - 1, day) // month - 1 porque JavaScript usa 0-11
          const diaSemana = fecha.getDay()
          console.log("[v0] Procesando día:", {
            fecha: dia.fecha,
            dia_semana_texto: dia.dia_semana,
            getDay: diaSemana,
            esDomingo: diaSemana === 0,
          })
          return { ...dia, _dayOfWeek: diaSemana }
        })
        .filter((dia: any) => {
          return dia._dayOfWeek !== 0 // 0 = Domingo
        })
        .slice(0, 7) // Solo mostrar 7 días laborables

      console.log("[v0] Timeline después de filtrar domingos:", timelineSinDomingos)
      setTimelineEntregas(timelineSinDomingos)
    } catch (err) {
      console.error("Error fetching timeline:", err)
    } finally {
      setLoadingTimeline(false)
    }
  }

  useEffect(() => {
    fetchEstadisticas()
    fetchOrdenesCriticas()
    fetchOcupacionSectores()
    fetchTimelineEntregas()
  }, [])

  const calcularPorcentaje = (valor: number, total: number) => {
    if (total === 0) return 0
    return Math.round((valor / total) * 100)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
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
              onClick={() => {
                fetchEstadisticas()
                fetchOrdenesCriticas()
                fetchOcupacionSectores()
                fetchTimelineEntregas()
              }}
              disabled={loading || loadingCriticas || loadingOcupacion || loadingTimeline}
              className="flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 bg-gradient-to-r from-[#DC143C] to-[#B8112E] text-white rounded-lg hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading || loadingCriticas || loadingOcupacion || loadingTimeline ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contenedor principal */}
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8 space-y-6 md:space-y-8">
        {/* Sección de estadísticas principales */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-[#DC143C]" />
            <h2 className="text-xl md:text-2xl font-bold text-gray-900">Estado de Órdenes</h2>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20 bg-white rounded-2xl shadow-sm">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-[#DC143C] mx-auto mb-4"></div>
                <p className="text-gray-500 text-sm">Cargando estadísticas...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 text-center">
              <AlertCircle className="h-12 w-12 text-[#DC143C] mx-auto mb-3" />
              <p className="text-[#DC143C] font-semibold">{error}</p>
            </div>
          )}

          {!loading && !error && estadisticas && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
              {/* Tarjeta Completadas */}
              <div className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 p-6 border border-gray-100 hover:border-green-200 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-green-50 to-transparent rounded-full -mr-16 -mt-16 opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                      <CheckCircle2 className="h-7 w-7 text-white" />
                    </div>
                    <span className="text-sm font-bold text-green-600 bg-green-100 px-3 py-1.5 rounded-full">
                      {calcularPorcentaje(estadisticas.completadas, estadisticas.total)}%
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Completadas</h3>
                    <p className="text-4xl font-bold text-green-600 mb-3">{estadisticas.completadas}</p>
                    <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${calcularPorcentaje(estadisticas.completadas, estadisticas.total)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Tarjeta En Proceso */}
              <div className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 p-6 border border-gray-100 hover:border-blue-200 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-50 to-transparent rounded-full -mr-16 -mt-16 opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                      <PlayCircle className="h-7 w-7 text-white" />
                    </div>
                    <span className="text-sm font-bold text-blue-600 bg-blue-100 px-3 py-1.5 rounded-full">
                      {calcularPorcentaje(estadisticas.en_proceso, estadisticas.total)}%
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">En Proceso</h3>
                    <p className="text-4xl font-bold text-blue-600 mb-3">{estadisticas.en_proceso}</p>
                    <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${calcularPorcentaje(estadisticas.en_proceso, estadisticas.total)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Tarjeta Pendientes */}
              <div className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 p-6 border border-gray-100 hover:border-yellow-200 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-yellow-50 to-transparent rounded-full -mr-16 -mt-16 opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                      <Clock className="h-7 w-7 text-white" />
                    </div>
                    <span className="text-sm font-bold text-yellow-600 bg-yellow-100 px-3 py-1.5 rounded-full">
                      {calcularPorcentaje(estadisticas.pendientes, estadisticas.total)}%
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Pendientes</h3>
                    <p className="text-4xl font-bold text-yellow-600 mb-3">{estadisticas.pendientes}</p>
                    <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-yellow-500 to-yellow-600 h-2 rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${calcularPorcentaje(estadisticas.pendientes, estadisticas.total)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Tarjeta Retrasadas */}
              <div className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 p-6 border border-gray-100 hover:border-red-200 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-red-50 to-transparent rounded-full -mr-16 -mt-16 opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                      <AlertCircle className="h-7 w-7 text-white" />
                    </div>
                    <span className="text-sm font-bold text-[#DC143C] bg-red-100 px-3 py-1.5 rounded-full">
                      {calcularPorcentaje(estadisticas.retrasadas, estadisticas.total)}%
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Retrasadas</h3>
                    <p className="text-4xl font-bold text-[#DC143C] mb-3">{estadisticas.retrasadas}</p>
                    <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-[#DC143C] to-[#B8112E] h-2 rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${calcularPorcentaje(estadisticas.retrasadas, estadisticas.total)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Grid de 2 columnas para widgets secundarios */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
          {/* Widget de alertas */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-orange-500 to-[#DC143C] px-6 py-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg">
                    <AlertCircle className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Órdenes Críticas</h2>
                    <p className="text-orange-50 text-sm">Próximas a vencer (7 días)</p>
                  </div>
                </div>
                {ordenesCriticas.length > 0 && (
                  <div className="bg-white px-4 py-2 rounded-lg">
                    <span className="text-2xl font-bold text-orange-600">{ordenesCriticas.length}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6">
              {loadingCriticas && (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-orange-500"></div>
                </div>
              )}

              {!loadingCriticas && ordenesCriticas.length === 0 && (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-10 w-10 text-green-600" />
                  </div>
                  <p className="text-gray-900 font-semibold text-lg mb-1">Sin órdenes críticas</p>
                  <p className="text-gray-500 text-sm">Todas las órdenes están bajo control</p>
                </div>
              )}

              {!loadingCriticas && ordenesCriticas.length > 0 && (
                <div className="space-y-3">
                  {ordenesCriticas.slice(0, 5).map((orden) => (
                    <div
                      key={orden.id}
                      className="group bg-gradient-to-r from-gray-50 to-white rounded-xl border-l-4 border-orange-500 p-4 hover:shadow-md transition-all duration-200"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold text-gray-900">#{orden.id}</span>
                            <span className="text-gray-400">•</span>
                            <span className="text-sm text-gray-700 truncate">{orden.articulo}</span>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1.5 text-gray-600">
                              <Factory className="h-4 w-4 flex-shrink-0" />
                              <span className="font-medium">{orden.sector}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-4 w-4 flex-shrink-0 text-orange-500" />
                              <span
                                className={`font-bold ${
                                  orden.dias_restantes <= 2
                                    ? "text-[#DC143C]"
                                    : orden.dias_restantes <= 5
                                      ? "text-orange-600"
                                      : "text-yellow-600"
                                }`}
                              >
                                {orden.dias_restantes} {orden.dias_restantes === 1 ? "día" : "días"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${
                            orden.dias_restantes <= 2
                              ? "bg-red-100 text-[#DC143C]"
                              : orden.dias_restantes <= 5
                                ? "bg-orange-100 text-orange-700"
                                : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
                          {orden.dias_restantes <= 2 ? "⚠️ Urgente" : "⏰ Próxima"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Widget de ocupación por sector */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-purple-500 to-indigo-600 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg">
                  <Factory className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Ocupación por Sector</h2>
                  <p className="text-purple-50 text-sm">Carga de trabajo actual</p>
                </div>
              </div>
            </div>

            <div className="p-6">
              {loadingOcupacion && (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-purple-500"></div>
                </div>
              )}

              {!loadingOcupacion && ocupacionSectores.length === 0 && (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Users className="h-10 w-10 text-gray-400" />
                  </div>
                  <p className="text-gray-600 font-medium">No hay sectores registrados</p>
                </div>
              )}

              {!loadingOcupacion && ocupacionSectores.length > 0 && (
                <div className="space-y-4">
                  {ocupacionSectores.map((sector, index) => (
                    <div key={index} className="group">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                            <Factory className="h-5 w-5 text-purple-600" />
                          </div>
                          <span className="font-semibold text-gray-900 text-lg">{sector.sector}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-purple-600">{sector.porcentaje}%</div>
                          <p className="text-xs text-gray-500">{sector.ordenes_activas} órdenes</p>
                        </div>
                      </div>
                      <div className="relative w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-500 to-indigo-600 rounded-full transition-all duration-1000 ease-out"
                          style={{ width: `${sector.porcentaje}%` }}
                        >
                          <div className="absolute inset-0 bg-white/20"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Timeline de entregas */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-[#DC143C] via-[#C41230] to-[#B8112E] px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-white/20 backdrop-blur-sm rounded-xl shadow-lg">
                  <Calendar className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Próximas Entregas</h2>
                  <p className="text-purple-50 text-sm">Timeline de los próximos 7 días</p>
                </div>
              </div>
              {timelineEntregas.length > 0 && (
                <div className="bg-white px-5 py-2.5 rounded-xl shadow-md">
                  <div className="text-center">
                    <span className="text-2xl font-bold text-[#DC143C]">
                      {timelineEntregas.reduce((sum, day) => sum + day.cantidad_ordenes, 0)}
                    </span>
                    <p className="text-xs text-gray-600 font-medium">Total</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="p-6 md:p-8">
            {loadingTimeline ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-[#DC143C]"></div>
              </div>
            ) : timelineEntregas.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="h-10 w-10 text-green-600" />
                </div>
                <p className="text-gray-900 font-semibold text-lg mb-1">Sin entregas programadas</p>
                <p className="text-gray-500 text-sm">No hay órdenes próximas a vencer en 7 días</p>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="bg-gradient-to-br from-gray-50 via-white to-gray-50 rounded-2xl p-6 md:p-8 border-2 border-gray-100 shadow-sm">
                  {/* Título de la sección */}
                  <div className="mb-6 pb-4 border-b border-gray-200">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-[#DC143C]" />
                      Vista Semanal
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">Distribución de entregas por día</p>
                  </div>

                  {/* Grid del timeline mejorado */}
                  <div className="grid grid-cols-7 gap-2 md:gap-4">
                    {timelineEntregas.map((dia, index) => {
                      const maxOrdenes = Math.max(...timelineEntregas.map((d) => d.cantidad_ordenes))
                      const altura = maxOrdenes > 0 ? (dia.cantidad_ordenes / maxOrdenes) * 100 : 0
                      const tieneOrdenes = dia.cantidad_ordenes > 0

                      return (
                        <div key={index} className="group relative">
                          <div className="flex flex-col items-center">
                            {/* Contenedor de la barra con altura fija */}
                            <div className="w-full h-40 md:h-48 flex flex-col justify-end mb-4 relative">
                              {tieneOrdenes ? (
                                <>
                                  {/* Barra animada */}
                                  <div
                                    className={`w-full rounded-t-xl transition-all duration-700 group-hover:scale-110 cursor-pointer relative overflow-hidden ${
                                      dia.cantidad_ordenes >= 5
                                        ? "bg-gradient-to-t from-[#DC143C] via-[#E63946] to-[#FF6B6B] shadow-lg shadow-red-200"
                                        : dia.cantidad_ordenes >= 3
                                          ? "bg-gradient-to-t from-orange-600 via-orange-400 to-orange-300 shadow-lg shadow-orange-200"
                                          : "bg-gradient-to-t from-[#0EA5E9] via-[#38BDF8] to-[#7DD3FC] shadow-lg shadow-cyan-200"
                                    }`}
                                    style={{ height: `${Math.max(altura, 30)}%` }}
                                  >
                                    {/* Efecto de brillo */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/10 to-white/30"></div>

                                    {/* Número de órdenes */}
                                    <div className="relative flex items-center justify-center h-full">
                                      <div className="bg-white/30 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-md">
                                        <span className="text-white font-bold text-lg md:text-2xl drop-shadow-lg">
                                          {dia.cantidad_ordenes}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Líneas decorativas */}
                                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/40"></div>
                                  </div>

                                  {/* Indicador de nivel */}
                                  <div
                                    className={`absolute -right-1 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
                                      dia.cantidad_ordenes >= 5
                                        ? "text-[#DC143C]"
                                        : dia.cantidad_ordenes >= 3
                                          ? "text-orange-600"
                                          : "text-cyan-600"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1 bg-white rounded-lg shadow-lg px-2 py-1 text-xs font-bold whitespace-nowrap">
                                      {dia.cantidad_ordenes >= 5 ? (
                                        <>
                                          <AlertCircle className="w-3 h-3" />
                                          Alta
                                        </>
                                      ) : dia.cantidad_ordenes >= 3 ? (
                                        <>
                                          <TrendingUp className="w-3 h-3" />
                                          Media
                                        </>
                                      ) : (
                                        <>
                                          <CheckCircle2 className="w-3 h-3" />
                                          Baja
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="w-full h-4 rounded-t-lg bg-gradient-to-t from-gray-200 to-gray-100 border-2 border-dashed border-gray-300"></div>
                              )}
                            </div>

                            {/* Información del día mejorada */}
                            <div
                              className={`text-center transition-all duration-300 ${
                                tieneOrdenes ? "transform group-hover:scale-110" : ""
                              }`}
                            >
                              <div
                                className={`text-xs md:text-sm font-bold mb-1 uppercase tracking-wider ${
                                  tieneOrdenes ? "text-[#DC143C]" : "text-gray-400"
                                }`}
                              >
                                {dia.dia_semana.substring(0, 3)}
                              </div>
                              <div
                                className={`text-xs md:text-sm ${
                                  tieneOrdenes
                                    ? "text-gray-800 font-semibold bg-gray-100 px-2 py-1 rounded-lg"
                                    : "text-gray-400"
                                }`}
                              >
                                {dia.fecha_formato}
                              </div>
                            </div>
                          </div>

                          {tieneOrdenes && (
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none z-30 scale-95 group-hover:scale-100">
                              <div className="bg-gray-900 text-white rounded-2xl shadow-2xl overflow-hidden min-w-[280px] border border-gray-700">
                                {/* Header del tooltip */}
                                <div
                                  className={`px-4 py-3 ${
                                    dia.cantidad_ordenes >= 5
                                      ? "bg-gradient-to-r from-[#DC143C] to-[#B8112E]"
                                      : dia.cantidad_ordenes >= 3
                                        ? "bg-gradient-to-r from-orange-600 to-orange-500"
                                        : "bg-gradient-to-r from-cyan-600 to-cyan-500"
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="font-bold text-sm">{dia.dia_semana}</div>
                                      <div className="text-xs opacity-90">{dia.fecha_formato}</div>
                                    </div>
                                    <div className="bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5">
                                      <span className="font-bold text-lg">{dia.cantidad_ordenes}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Lista de órdenes */}
                                <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                                  {dia.ordenes.slice(0, 5).map((orden, idx) => (
                                    <div
                                      key={orden.id}
                                      className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-colors"
                                    >
                                      <div className="flex items-start gap-3">
                                        <div
                                          className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                                            dia.cantidad_ordenes >= 5
                                              ? "bg-[#DC143C]/20 text-red-300"
                                              : dia.cantidad_ordenes >= 3
                                                ? "bg-orange-500/20 text-orange-300"
                                                : "bg-cyan-500/20 text-cyan-300"
                                          }`}
                                        >
                                          {idx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-1">
                                            <Package className="w-3 h-3 text-gray-400" />
                                            <span className="font-bold text-white text-sm">#{orden.id}</span>
                                          </div>
                                          <p className="text-xs text-gray-300 line-clamp-2">{orden.articulo}</p>
                                          <div className="flex items-center gap-1.5 mt-2">
                                            <Factory className="w-3 h-3 text-gray-400" />
                                            <span className="text-xs text-gray-400 font-medium">{orden.sector}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                  {dia.cantidad_ordenes > 5 && (
                                    <div className="text-center py-2 bg-gray-800/50 rounded-lg">
                                      <p className="text-xs text-gray-400 font-semibold">
                                        +{dia.cantidad_ordenes - 5} órdenes más
                                      </p>
                                    </div>
                                  )}
                                </div>

                                {/* Flecha del tooltip */}
                                <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
                                  <div className="border-8 border-transparent border-t-gray-900"></div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8 pt-8 mt-8 border-t-2 border-gray-200">
                    <div className="text-sm text-gray-600 font-bold uppercase tracking-wider">Nivel de carga:</div>
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <div className="w-6 h-6 bg-gradient-to-t from-[#0EA5E9] to-[#7DD3FC] rounded-lg shadow-md"></div>
                        <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/30 rounded-lg"></div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-900 font-bold">Baja</span>
                        <p className="text-xs text-gray-500">1-2 órdenes</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <div className="w-6 h-6 bg-gradient-to-t from-orange-600 to-orange-300 rounded-lg shadow-md"></div>
                        <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/30 rounded-lg"></div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-900 font-bold">Media</span>
                        <p className="text-xs text-gray-500">3-4 órdenes</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <div className="w-6 h-6 bg-gradient-to-t from-[#DC143C] to-[#FF6B6B] rounded-lg shadow-md"></div>
                        <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/30 rounded-lg"></div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-900 font-bold">Alta</span>
                        <p className="text-xs text-gray-500">5+ órdenes</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                      <Package className="w-6 h-6 text-[#DC143C]" />
                      Detalle por Día
                    </h3>
                    <span className="text-sm text-gray-500 font-medium">
                      {timelineEntregas.filter((d) => d.cantidad_ordenes > 0).length} días con entregas
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                    {timelineEntregas
                      .filter((d) => d.cantidad_ordenes > 0)
                      .map((dia) => (
                        <div
                          key={dia.fecha}
                          className="group bg-white rounded-xl border-2 border-gray-200 hover:border-[#DC143C] p-5 hover:shadow-xl transition-all duration-300"
                        >
                          {/* Header de la card */}
                          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg ${
                                  dia.cantidad_ordenes >= 5
                                    ? "bg-gradient-to-br from-[#DC143C] to-[#B8112E]"
                                    : dia.cantidad_ordenes >= 3
                                      ? "bg-gradient-to-br from-orange-500 to-orange-600"
                                      : "bg-gradient-to-br from-cyan-500 to-cyan-600"
                                }`}
                              >
                                {dia.cantidad_ordenes}
                              </div>
                              <div>
                                <div className="font-bold text-gray-900 text-lg">{dia.dia_semana}</div>
                                <div className="text-sm text-gray-600">{dia.fecha_formato}</div>
                              </div>
                            </div>
                            <div
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                                dia.cantidad_ordenes >= 5
                                  ? "bg-red-100 text-[#DC143C]"
                                  : dia.cantidad_ordenes >= 3
                                    ? "bg-orange-100 text-orange-700"
                                    : "bg-cyan-100 text-cyan-700"
                              }`}
                            >
                              {dia.cantidad_ordenes >= 5 ? "Alta" : dia.cantidad_ordenes >= 3 ? "Media" : "Baja"}
                            </div>
                          </div>

                          {/* Lista de órdenes */}
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                            {dia.ordenes.map((orden, idx) => (
                              <div
                                key={orden.id}
                                className="bg-gradient-to-r from-gray-50 to-white rounded-lg border border-gray-200 p-3 hover:border-[#DC143C] hover:shadow-md transition-all duration-200"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="flex-shrink-0 w-8 h-8 bg-[#DC143C]/10 rounded-lg flex items-center justify-center">
                                    <span className="text-[#DC143C] font-bold text-sm">{idx + 1}</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-[#DC143C] font-bold text-sm">#{orden.id}</span>
                                    </div>
                                    <p className="text-sm text-gray-700 font-medium line-clamp-2 mb-2">
                                      {orden.articulo}
                                    </p>
                                    <div className="flex items-center gap-1.5">
                                      <Factory className="w-3.5 h-3.5 text-gray-500" />
                                      <span className="text-xs text-gray-600 font-semibold">{orden.sector}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Sección de información del sistema */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Estado del sistema */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-600" />
              Estado del Sistema
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Servicios Activos</h3>
                <div className="space-y-2">
                  {["Operarios", "Procesos", "Artículos"].map((servicio) => (
                    <div
                      key={servicio}
                      className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100"
                    >
                      <span className="text-green-900 font-medium">{servicio}</span>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        <span className="text-xs bg-green-200 text-green-800 font-semibold px-2 py-1 rounded">
                          Activo
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">En Desarrollo</h3>
                <div className="space-y-2">
                  {["Sectores", "Órdenes de Trabajo", "Prioridades"].map((servicio) => (
                    <div
                      key={servicio}
                      className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg border border-yellow-100"
                    >
                      <span className="text-yellow-900 font-medium">{servicio}</span>
                      <span className="text-xs bg-yellow-200 text-yellow-800 font-semibold px-2 py-1 rounded">
                        En desarrollo
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Información del backend */}
          <section className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Información del Backend
            </h3>
            <div className="space-y-3">
              <div className="bg-white rounded-lg p-4 border border-blue-100">
                <p className="text-xs text-gray-600 font-semibold uppercase tracking-wide mb-1">URL del Servidor</p>
                <p className="text-sm text-gray-900 font-mono break-all">{apiUrl}</p>
              </div>
              <div className="bg-white rounded-lg p-4 border border-blue-100">
                <p className="text-xs text-gray-600 font-semibold uppercase tracking-wide mb-1">Documentación API</p>
                <a
                  href={`${apiUrl}/docs`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 font-mono break-all underline"
                >
                  {apiUrl}/docs
                </a>
              </div>
              <div className="bg-white rounded-lg p-4 border border-blue-100">
                <p className="text-xs text-gray-600 font-semibold uppercase tracking-wide mb-1">Estado de Conexión</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  <span className="text-sm font-semibold text-green-700">Conectado</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
