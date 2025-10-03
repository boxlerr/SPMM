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
