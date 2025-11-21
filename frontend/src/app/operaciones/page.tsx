import PlanificacionGantt from "@/components/PlanificacionGantt";

export default function OperacionesPage() {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Operaciones</h1>
          <p className="text-gray-600 mt-2">Gestiona las operaciones del sistema</p>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Planificación (Gantt)</h2>
          <PlanificacionGantt />
        </div>
      </div>
    );
  }