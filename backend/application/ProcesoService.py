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
