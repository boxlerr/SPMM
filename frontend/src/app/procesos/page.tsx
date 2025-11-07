export default function ProcesosPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Procesos</h1>
        <p className="text-gray-600 mt-2">
          Gestiona los procesos del sistema SPMM
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Endpoints Disponibles
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div>
                <span className="font-medium text-green-800">POST /procesos</span>
                <p className="text-sm text-green-600">Crear proceso</p>
              </div>
              <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">
                Funcional
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div>
                <span className="font-medium text-green-800">GET /procesos</span>
                <p className="text-sm text-green-600">Listar procesos</p>
              </div>
              <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">
                Funcional
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div>
                <span className="font-medium text-green-800">GET /procesos/{`{id}`}</span>
                <p className="text-sm text-green-600">Obtener proceso por ID</p>
              </div>
              <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">
                Funcional
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div>
                <span className="font-medium text-green-800">PUT /procesos/{`{id}`}</span>
                <p className="text-sm text-green-600">Modificar proceso</p>
              </div>
              <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">
                Funcional
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div>
                <span className="font-medium text-green-800">DELETE /procesos/{`{id}`}</span>
                <p className="text-sm text-green-600">Eliminar proceso</p>
              </div>
              <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">
                Funcional
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            Campos del Proceso
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
                <span className="font-medium">tiempo_estimado:</span> number (requerido)
              </div>
              <div className="text-sm">
                <span className="font-medium">activo:</span> boolean (opcional)
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">Nota:</h4>
          <p className="text-sm text-blue-800">
            Los endpoints de procesos están completamente funcionales con operaciones CRUD completas.
          </p>
        </div>
      </div>
    </div>
  );
}
