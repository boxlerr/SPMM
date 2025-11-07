"use client";

import { useEffect, useState } from "react";
import { 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  PlayCircle, 
  TrendingUp,
  RefreshCw,
  Package,
  Users,
  Plus,
  Calendar,
  ChevronRight,
  Factory
} from "lucide-react";

interface EstadisticasOrdenes {
  completadas: number;
  en_proceso: number;
  pendientes: number;
  retrasadas: number;
  total: number;
}

interface OrdenCritica {
  id: number;
  articulo: string;
  sector: string;
  fecha_prometida: string;
  dias_restantes: number;
}

interface OcupacionSector {
  sector: string;
  ordenes_activas: number;
  porcentaje: number;
}

interface TimelineEntrega {
  fecha: string;
  fecha_formato: string;
  dia_semana: string;
  cantidad_ordenes: number;
  ordenes: Array<{
    id: number;
    articulo: string;
    sector: string;
  }>;
}

export default function DashboardPage() {
  const [estadisticas, setEstadisticas] = useState<EstadisticasOrdenes | null>(null);
  const [ordenesCriticas, setOrdenesCriticas] = useState<OrdenCritica[]>([]);
  const [ocupacionSectores, setOcupacionSectores] = useState<OcupacionSector[]>([]);
  const [timelineEntregas, setTimelineEntregas] = useState<TimelineEntrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCriticas, setLoadingCriticas] = useState(true);
  const [loadingOcupacion, setLoadingOcupacion] = useState(true);
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const fetchEstadisticas = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${apiUrl}/ordenes-estadisticas/estados`);
      
      if (!response.ok) {
        throw new Error('Error al obtener estadísticas');
      }
      
      const data = await response.json();
      setEstadisticas(data.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
      setError('Error al cargar estadísticas');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdenesCriticas = async () => {
    try {
      setLoadingCriticas(true);
      const response = await fetch(`${apiUrl}/ordenes-estadisticas/criticas?dias=7`);
      
      if (!response.ok) {
        throw new Error('Error al obtener órdenes críticas');
      }
      
      const data = await response.json();
      setOrdenesCriticas(data.data);
    } catch (err) {
      console.error('Error fetching critical orders:', err);
    } finally {
      setLoadingCriticas(false);
    }
  };

  const fetchOcupacionSectores = async () => {
    try {
      setLoadingOcupacion(true);
      const response = await fetch(`${apiUrl}/ordenes-estadisticas/ocupacion-sector`);
      
      if (!response.ok) {
        throw new Error('Error al obtener ocupación por sector');
      }
      
      const data = await response.json();
      setOcupacionSectores(data.data);
    } catch (err) {
      console.error('Error fetching sector occupation:', err);
    } finally {
      setLoadingOcupacion(false);
    }
  };

  const fetchTimelineEntregas = async () => {
    try {
      setLoadingTimeline(true);
      const response = await fetch(`${apiUrl}/ordenes-estadisticas/proximas-entregas?dias=7`);
      
      if (!response.ok) {
        throw new Error('Error al obtener timeline de entregas');
      }
      
      const data = await response.json();
      setTimelineEntregas(data.data);
    } catch (err) {
      console.error('Error fetching timeline:', err);
    } finally {
      setLoadingTimeline(false);
    }
  };

  useEffect(() => {
    fetchEstadisticas();
    fetchOrdenesCriticas();
    fetchOcupacionSectores();
    fetchTimelineEntregas();
  }, []);

  const calcularPorcentaje = (valor: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((valor / total) * 100);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Panel principal del sistema SPMM
          </p>
        </div>
        <button
          onClick={() => {
            fetchEstadisticas();
            fetchOrdenesCriticas();
            fetchOcupacionSectores();
            fetchTimelineEntregas();
          }}
          disabled={loading || loadingCriticas || loadingOcupacion || loadingTimeline}
          className="flex items-center gap-2 px-4 py-2 bg-[#DC143C] text-white rounded-lg hover:bg-[#B8112E] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${(loading || loadingCriticas || loadingOcupacion || loadingTimeline) ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {/* Widget de Estadísticas de Órdenes */}
      <div className="bg-gradient-to-br from-white to-gray-50 rounded-xl shadow-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Estado de Órdenes</h2>
            <p className="text-sm text-gray-600 mt-1">Resumen general de órdenes de trabajo</p>
          </div>
          {estadisticas && (
            <div className="text-right">
              <div className="text-3xl font-bold text-[#DC143C]">{estadisticas.total}</div>
              <div className="text-sm text-gray-600">Total</div>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#DC143C]"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center text-red-800">
            {error}
          </div>
        )}

        {!loading && !error && estadisticas && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Completadas */}
            <div className="bg-white rounded-lg border border-green-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="p-3 bg-green-100 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                </div>
                <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded-full">
                  {calcularPorcentaje(estadisticas.completadas, estadisticas.total)}%
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-600">Completadas</h3>
                <p className="text-3xl font-bold text-green-600 mt-1">{estadisticas.completadas}</p>
                <div className="mt-3 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${calcularPorcentaje(estadisticas.completadas, estadisticas.total)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* En Proceso */}
            <div className="bg-white rounded-lg border border-blue-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <PlayCircle className="h-6 w-6 text-blue-600" />
                </div>
                <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                  {calcularPorcentaje(estadisticas.en_proceso, estadisticas.total)}%
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-600">En Proceso</h3>
                <p className="text-3xl font-bold text-blue-600 mt-1">{estadisticas.en_proceso}</p>
                <div className="mt-3 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${calcularPorcentaje(estadisticas.en_proceso, estadisticas.total)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Pendientes */}
            <div className="bg-white rounded-lg border border-yellow-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="p-3 bg-yellow-100 rounded-lg">
                  <Clock className="h-6 w-6 text-yellow-600" />
                </div>
                <span className="text-xs font-semibold text-yellow-600 bg-yellow-100 px-2 py-1 rounded-full">
                  {calcularPorcentaje(estadisticas.pendientes, estadisticas.total)}%
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-600">Pendientes</h3>
                <p className="text-3xl font-bold text-yellow-600 mt-1">{estadisticas.pendientes}</p>
                <div className="mt-3 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-yellow-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${calcularPorcentaje(estadisticas.pendientes, estadisticas.total)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Retrasadas */}
            <div className="bg-white rounded-lg border border-red-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="p-3 bg-red-100 rounded-lg">
                  <AlertCircle className="h-6 w-6 text-red-600" />
                </div>
                <span className="text-xs font-semibold text-red-600 bg-red-100 px-2 py-1 rounded-full">
                  {calcularPorcentaje(estadisticas.retrasadas, estadisticas.total)}%
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-600">Retrasadas</h3>
                <p className="text-3xl font-bold text-red-600 mt-1">{estadisticas.retrasadas}</p>
                <div className="mt-3 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-red-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${calcularPorcentaje(estadisticas.retrasadas, estadisticas.total)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Widget de Alertas de Órdenes Críticas */}
      <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl shadow-lg border border-orange-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-orange-600" />
              Alertas de Órdenes Críticas
            </h2>
            <p className="text-sm text-gray-600 mt-1">Órdenes próximas a vencer (7 días)</p>
          </div>
          {ordenesCriticas.length > 0 && (
            <div className="text-right">
              <div className="text-3xl font-bold text-orange-600">{ordenesCriticas.length}</div>
              <div className="text-sm text-gray-600">Alertas</div>
            </div>
          )}
        </div>

        {loadingCriticas && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
          </div>
        )}

        {!loadingCriticas && ordenesCriticas.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-3" />
            <p className="text-green-800 font-medium">No hay órdenes críticas</p>
            <p className="text-sm text-green-600 mt-1">Todas las órdenes están bajo control</p>
          </div>
        )}

        {!loadingCriticas && ordenesCriticas.length > 0 && (
          <div className="space-y-3">
            {ordenesCriticas.slice(0, 5).map((orden) => (
              <div
                key={orden.id}
                className="bg-white rounded-lg border-l-4 border-orange-500 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-gray-900">#{orden.id}</span>
                      <span className="text-sm text-gray-600">- {orden.articulo}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <span className="font-medium">Sector:</span>
                        <span>{orden.sector}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span className="font-medium">Vence en:</span>
                        <span className={`font-semibold ${
                          orden.dias_restantes <= 2 
                            ? 'text-red-600' 
                            : orden.dias_restantes <= 5 
                            ? 'text-orange-600' 
                            : 'text-yellow-600'
                        }`}>
                          {orden.dias_restantes} {orden.dias_restantes === 1 ? 'día' : 'días'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    orden.dias_restantes <= 2 
                      ? 'bg-red-100 text-red-800' 
                      : orden.dias_restantes <= 5 
                      ? 'bg-orange-100 text-orange-800' 
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {orden.dias_restantes <= 2 ? '⚠️ Urgente' : '⏰ Próxima'}
                  </div>
                </div>
              </div>
            ))}
            {ordenesCriticas.length > 5 && (
              <div className="text-center pt-2">
                <button className="text-sm text-orange-600 hover:text-orange-800 font-medium">
                  Ver todas las alertas ({ordenesCriticas.length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Widget de Ocupación por Sector */}
      <div className="bg-gradient-to-br from-white to-gray-50 rounded-xl shadow-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Users className="h-6 w-6 text-purple-600" />
              Ocupación por Sector
            </h2>
            <p className="text-sm text-gray-600 mt-1">Carga de trabajo por sector</p>
          </div>
        </div>

        {loadingOcupacion && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          </div>
        )}

        {!loadingOcupacion && ocupacionSectores.length === 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <Users className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No hay sectores registrados</p>
          </div>
        )}

        {!loadingOcupacion && ocupacionSectores.length > 0 && (
          <div className="space-y-4">
            {ocupacionSectores.map((sector, index) => (
              <div key={index} className="bg-white rounded-lg border border-purple-100 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Factory className="h-5 w-5 text-purple-600" />
                    <span className="font-semibold text-gray-800">{sector.sector}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-purple-600">{sector.porcentaje}%</span>
                    <p className="text-xs text-gray-500">{sector.ordenes_activas} órdenes</p>
                  </div>
                </div>
                <div className="relative w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div 
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${sector.porcentaje}%` }}
                  >
                    <div className="absolute inset-0 bg-white opacity-20 animate-pulse"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 📅 Timeline de Próximas Entregas (7 días) */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="w-6 h-6 text-white" />
              <div>
                <h2 className="text-xl font-bold text-white">Entregas Próxima Semana</h2>
                <p className="text-cyan-50 text-sm">Timeline de entregas en los próximos 7 días</p>
              </div>
            </div>
            {timelineEntregas.length > 0 && (
              <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-lg">
                <span className="text-white font-bold text-lg">
                  {timelineEntregas.reduce((sum, day) => sum + day.cantidad_ordenes, 0)} órdenes
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="p-6">
          {loadingTimeline ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
            </div>
          ) : timelineEntregas.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <p className="text-gray-600 font-medium">Sin entregas programadas</p>
              <p className="text-sm text-gray-500 mt-1">No hay órdenes próximas a vencer en 7 días</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Timeline horizontal */}
              <div className="grid grid-cols-7 gap-2">
                {timelineEntregas.map((dia, index) => {
                  const maxOrdenes = Math.max(...timelineEntregas.map(d => d.cantidad_ordenes));
                  const altura = maxOrdenes > 0 ? (dia.cantidad_ordenes / maxOrdenes) * 100 : 0;
                  
                  return (
                    <div key={index} className="group relative">
                      {/* Barra vertical */}
                      <div className="flex flex-col items-center">
                        <div className="w-full h-32 flex flex-col justify-end mb-2">
                          {dia.cantidad_ordenes > 0 ? (
                            <div 
                              className={`w-full rounded-t-lg transition-all duration-300 group-hover:opacity-80 cursor-pointer ${
                                dia.cantidad_ordenes >= 5 ? 'bg-gradient-to-t from-red-500 to-red-400' :
                                dia.cantidad_ordenes >= 3 ? 'bg-gradient-to-t from-orange-500 to-orange-400' :
                                'bg-gradient-to-t from-cyan-500 to-cyan-400'
                              }`}
                              style={{ height: `${Math.max(altura, 20)}%` }}
                            >
                              <div className="flex items-center justify-center h-full">
                                <span className="text-white font-bold text-lg">
                                  {dia.cantidad_ordenes}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="w-full h-2 rounded-t-lg bg-gray-200"></div>
                          )}
                        </div>
                        
                        {/* Info del día */}
                        <div className="text-center">
                          <div className={`text-xs font-semibold mb-1 ${
                            dia.cantidad_ordenes > 0 ? 'text-cyan-700' : 'text-gray-500'
                          }`}>
                            {dia.dia_semana}
                          </div>
                          <div className={`text-xs ${
                            dia.cantidad_ordenes > 0 ? 'text-gray-700 font-medium' : 'text-gray-400'
                          }`}>
                            {dia.fecha_formato}
                          </div>
                        </div>
                      </div>

                      {/* Tooltip con detalles (hover) */}
                      {dia.cantidad_ordenes > 0 && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
                          <div className="bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 min-w-[200px]">
                            <div className="font-semibold mb-2 border-b border-gray-700 pb-2">
                              {dia.dia_semana} {dia.fecha_formato}
                            </div>
                            <div className="space-y-1">
                              {dia.ordenes.slice(0, 3).map((orden) => (
                                <div key={orden.id} className="text-xs">
                                  <span className="font-medium">#{orden.id}</span> - {orden.articulo.substring(0, 30)}...
                                </div>
                              ))}
                              {dia.cantidad_ordenes > 3 && (
                                <div className="text-xs text-gray-400 pt-1">
                                  +{dia.cantidad_ordenes - 3} más...
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Leyenda */}
              <div className="flex items-center justify-center gap-6 pt-4 border-t border-gray-200">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gradient-to-t from-cyan-500 to-cyan-400 rounded"></div>
                  <span className="text-xs text-gray-600">1-2 órdenes</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gradient-to-t from-orange-500 to-orange-400 rounded"></div>
                  <span className="text-xs text-gray-600">3-4 órdenes</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gradient-to-t from-red-500 to-red-400 rounded"></div>
                  <span className="text-xs text-gray-600">5+ órdenes</span>
                </div>
              </div>

              {/* Detalle de órdenes por día */}
              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Detalle de Entregas
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {timelineEntregas.filter(d => d.cantidad_ordenes > 0).map((dia) => (
                    <div key={dia.fecha} className="bg-gradient-to-br from-cyan-50 to-blue-50 rounded-lg border border-cyan-200 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-cyan-900 text-sm">
                          {dia.dia_semana} {dia.fecha_formato}
                        </div>
                        <span className="bg-cyan-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                          {dia.cantidad_ordenes}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {dia.ordenes.map((orden) => (
                          <div key={orden.id} className="text-xs text-gray-700 flex items-start gap-1">
                            <span className="text-cyan-600 font-medium">#{orden.id}</span>
                            <span className="truncate">{orden.articulo}</span>
                          </div>
                        ))}
                        {dia.cantidad_ordenes > dia.ordenes.length && (
                          <div className="text-xs text-cyan-600 font-medium">
                            +{dia.cantidad_ordenes - dia.ordenes.length} más...
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Estado del sistema */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Estado del Sistema</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Endpoints Activos</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <span className="text-green-800 font-medium">Operarios</span>
                <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">Funcional</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <span className="text-green-800 font-medium">Procesos</span>
                <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">Funcional</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <span className="text-green-800 font-medium">Artículos</span>
                <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">Funcional</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Endpoints en Desarrollo</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                <span className="text-yellow-800 font-medium">Sectores</span>
                <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">En desarrollo</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                <span className="text-yellow-800 font-medium">Órdenes de Trabajo</span>
                <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">En desarrollo</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                <span className="text-yellow-800 font-medium">Prioridades</span>
                <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">En desarrollo</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Información del backend */}
      <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
        <h3 className="text-lg font-semibold text-blue-900 mb-2 flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Información del Backend
        </h3>
        <div className="text-sm text-blue-800 space-y-1">
          <p><strong>URL:</strong> {apiUrl}</p>
          <p><strong>Documentación API:</strong> {apiUrl}/docs</p>
          <p><strong>Estado:</strong> <span className="inline-flex items-center">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
            Activo
          </span></p>
        </div>
      </div>
    </div>
  );
}
