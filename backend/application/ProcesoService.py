from backend.domain.Proceso import Proceso
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.infrastructure.ProcesoRepository import ProcesoRepository

from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder

from backend.application.validators.ProcesoValidator import procesoValidator
from backend.commons.exceptions.InfrastructureException import InfrastructureException

class ProcesoService:
    def __init__(self):
        pass

    def crearProceso(self, proceso_dto: ProcesoRequestDTO):
        try:
            errores = procesoValidator(proceso_dto)
            if errores:
                return ResponseDTO(status=False, data={}, errorDescription="; ".join(errores))

            proceso = Proceso(
                nombre=proceso_dto.nombre,
                descripcion=proceso_dto.descripcion
            )

            repo = ProcesoRepository()
            proceso_creado = repo.save(proceso)

            response = ResponseDTO()
            response.status = True
            response.data = jsonable_encoder(proceso_creado)
            response.errorDescription = ""

            return response

        except Exception as e:
            raise InfrastructureException("Error al guardar el Proceso.") from e

    # 🔹 Nuevo: Listar todos los procesos
    def listarProcesos(self):
        repo = ProcesoRepository()
        procesos = repo.find_all()
        return ResponseDTO(status=True, data=jsonable_encoder(procesos))

    # 🔹 Nuevo: Obtener proceso por ID
    def obtenerProcesoPorId(self, id: int):
        repo = ProcesoRepository()
        proceso = repo.find_by_id(id)
        if not proceso:
            return ResponseDTO(status=False, data={}, errorDescription="Proceso no encontrado")
        return ResponseDTO(status=True, data=jsonable_encoder(proceso))

    # 🔹 Nuevo: Modificar un proceso
    def modificarProceso(self, id: int, proceso_dto: ProcesoRequestDTO):
        try:
            errores = procesoValidator(proceso_dto)
            if errores:
                return ResponseDTO(status=False, data={}, errorDescription="; ".join(errores))

            repo = ProcesoRepository()
            nueva_data = proceso_dto.dict(exclude_unset=True)
            proceso_actualizado = repo.update(id, nueva_data)

            if not proceso_actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Proceso no encontrado")

            return ResponseDTO(status=True, data=jsonable_encoder(proceso_actualizado))
        except Exception as e:
            raise InfrastructureException("Error al actualizar el Proceso.") from e

    # 🔹 Nuevo: Eliminar un proceso
    def eliminarProceso(self, id: int):
        try:
            repo = ProcesoRepository()
            ok = repo.delete(id)
            if not ok:
                return ResponseDTO(status=False, data={}, errorDescription="Proceso no encontrado")
            return ResponseDTO(status=True, data={"deleted": id})
        except Exception as e:
            raise InfrastructureException("Error al eliminar el Proceso.") from e
