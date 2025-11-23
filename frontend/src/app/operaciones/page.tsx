"use client";

import { useState } from "react";
import PlanificacionGantt from "@/components/PlanificacionGantt";
import TablaTareas from "@/components/TablaTareas";
import { Activity, LayoutList, GanttChartSquare } from "lucide-react";
import { usePanelContext } from "@/contexts/PanelContext";

export default function OperacionesPage() {
  const [activeTab, setActiveTab] = useState<'gantt' | 'tabla'>('gantt');
  const { isDetailsPanelOpen } = usePanelContext();

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100"
      style={{
        marginRight: isDetailsPanelOpen ? "320px" : "0",
        transition: "margin-right 0.3s ease-in-out",
      }}
    >
      {/* Header sticky mejorado */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-xl shadow-lg">
                  <Activity className="h-7 w-7 text-white" />
                </div>
                Operaciones
              </h1>
              <p className="text-gray-500 mt-1 text-sm md:text-base">
                Gestiona las operaciones del sistema
              </p>
            </div>
          </div>

          {/* Tabs Navigation */}
          <div className="flex items-center gap-1 mt-6 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('gantt')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'gantt'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <GanttChartSquare size={18} />
              Gantt
            </button>
            <button
              onClick={() => setActiveTab('tabla')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'tabla'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <LayoutList size={18} />
              Tabla de Tareas
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-8 space-y-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            {activeTab === 'gantt' ? 'Planificación (Gantt)' : 'Listado de Tareas'}
          </h2>

          {activeTab === 'gantt' ? (
            <PlanificacionGantt />
          ) : (
            <TablaTareas />
          )}
        </div>
      </div>
    </div>
  );
}