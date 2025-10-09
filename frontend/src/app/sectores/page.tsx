export default function SectoresPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Sectores</h1>
        <p className="text-gray-600 mt-2">
          Gestiona los sectores del sistema SPMM
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Endpoints Disponibles
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
              <div>
                <span className="font-medium text-yellow-800">POST /sectores</span>
                <p className="text-sm text-yellow-600">Crear sector</p>
              </div>
              <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">
                En desarrollo
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
              <div>
                <span className="font-medium text-yellow-800">DELETE /sectores/{`{id}`}</span>
                <p className="text-sm text-yellow-600">Eliminar sector</p>
              </div>
              <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">
                En desarrollo
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            Campos del Sector
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm">
                <span className="font-medium">nombre:</span> string (requerido)
              </div>
              <div className="text-sm">
                <span className="font-medium">descripcion:</span> string (requerido)
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm">
                <span className="font-medium">activo:</span> boolean (opcional)
              </div>
              <div className="text-sm">
                <span className="font-medium">codigo:</span> string (opcional)
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-yellow-50 rounded-lg">
          <h4 className="font-medium text-yellow-900 mb-2">Estado:</h4>
          <p className="text-sm text-yellow-800">
            Los endpoints de sectores están implementados pero comentados en el main.py. 
            Para activarlos, descomenta las líneas correspondientes en el archivo main.py del backend.
          </p>
        </div>
      </div>
    </div>
  );
}
