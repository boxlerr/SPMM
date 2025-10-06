from backend.domain.Prioridad import Prioridad
from backend.dto.PrioridadRequestDTO import PrioridadRequestDTO
from backend.infrastructure.PrioridadRepository import PrioridadRepository

from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder

from backend.application.validators.PrioridadValidator import prioridadValidator
from backend.commons.exceptions.InfrastructureException import InfrastructureException

class PrioridadService:
    def __init__(self):
        pass

    def crearPrioridad(self, prioridad_dto: PrioridadRequestDTO):
        try:
            errores = prioridadValidator(prioridad_dto)
            if errores:
                return ResponseDTO(status=False, data={}, errorDescription="; ".join(errores))

            prioridad = Prioridad(
                descripcion=prioridad_dto.descripcion,
                detalle=prioridad_dto.detalle
            )

            repo = PrioridadRepository()
            prioridad_creada = repo.save(prioridad)

            response = ResponseDTO()
            response.status = True
            response.data = jsonable_encoder(prioridad_creada)
            response.errorDescription = ""

            return response

        except Exception as e:
            raise InfrastructureException("Error al guardar la Prioridad.") from e

    # 🔹 Nuevo: Listar todas las prioridades
    def listarPrioridades(self):
        repo = PrioridadRepository()
        prioridades = repo.find_all()
        response = ResponseDTO(status=True, data=jsonable_encoder(prioridades))
        return response

    # 🔹 Nuevo: Traer una prioridad por ID
    def obtenerPrioridadPorId(self, id: int):
        repo = PrioridadRepository()
        prioridad = repo.find_by_id(id)
        if not prioridad:
            return ResponseDTO(status=False, data={}, errorDescription="Prioridad no encontrada")
        return ResponseDTO(status=True, data=jsonable_encoder(prioridad))

    # 🔹 Nuevo: Modificar una prioridad
    def modificarPrioridad(self, id: int, prioridad_dto: PrioridadRequestDTO):
        try:
            errores = prioridadValidator(prioridad_dto)
            if errores:
                return ResponseDTO(status=False, data={}, errorDescription="; ".join(errores))

            repo = PrioridadRepository()
            nueva_data = prioridad_dto.dict(exclude_unset=True)
            prioridad_actualizada = repo.update(id, nueva_data)

            if not prioridad_actualizada:
                return ResponseDTO(status=False, data={}, errorDescription="Prioridad no encontrada")

            return ResponseDTO(status=True, data=jsonable_encoder(prioridad_actualizada))
        except Exception as e:
            raise InfrastructureException("Error al actualizar la Prioridad.") from e

    # 🔹 Nuevo: Eliminar una prioridad
    def eliminarPrioridad(self, id: int):
        try:
            repo = PrioridadRepository()
            ok = repo.delete(id)
            if not ok:
                return ResponseDTO(status=False, data={}, errorDescription="Prioridad no encontrada")
            return ResponseDTO(status=True, data={"deleted": id})
        except Exception as e:
            raise InfrastructureException("Error al eliminar la Prioridad.") from e
