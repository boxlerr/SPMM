"use client";

import { useEffect, useState } from "react";
import { 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  PlayCircle, 
  TrendingUp,
  RefreshCw 
} from "lucide-react";

interface EstadisticasOrdenes {
  completadas: number;
  en_proceso: number;
  pendientes: number;
  retrasadas: number;
  total: number;
}

export default function DashboardPage() {
  const [estadisticas, setEstadisticas] = useState<EstadisticasOrdenes | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    fetchEstadisticas();
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
          onClick={fetchEstadisticas}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-[#DC143C] text-white rounded-lg hover:bg-[#B8112E] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
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
