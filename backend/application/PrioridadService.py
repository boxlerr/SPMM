from backend.domain.Prioridad import Prioridad
from backend.dto.PrioridadRequestDTO import PrioridadRequestDTO
from backend.infrastructure.PrioridadRepository import PrioridadRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.application.validators.PrioridadValidator import prioridadValidator
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger

class PrioridadService:
    def __init__(self, db_session):
        self.repository = PrioridadRepository(db_session)

    async def crearPrioridad(self, prioridad_dto: PrioridadRequestDTO):
        try:
            logger.info("Service - Crear prioridad.")

            # Validación de negocio
            errores = prioridadValidator(prioridad_dto)
            if errores:
                raise BusinessException("; ".join(errores))

            prioridad = Prioridad(
                descripcion=prioridad_dto.descripcion,
                detalle=prioridad_dto.detalle
            )

            prioridad_creada = await self.repository.save(prioridad)

            return ResponseDTO(status=True, data=jsonable_encoder(prioridad_creada))
        except InfrastructureException:
            raise  
        except BusinessException:
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear la Prioridad.") from e

    async def listarPrioridades(self):
        logger.info("Service - Listar prioridades.")
        prioridades = await self.repository.find_all()
        
        if not prioridades:
            logger.info("Service - No hay prioridades registradas.")
        
        return ResponseDTO(status=True, data=jsonable_encoder(prioridades))

    async def obtenerPrioridadPorId(self, id: int):
        logger.info(f"Service - Obtener prioridad ID: {id}")
        prioridad = await self.repository.find_by_id(id)

        if not prioridad:
            raise NotFoundException(f"No se encontró la prioridad con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(prioridad))

    async def modificarPrioridad(self, id: int, prioridad_dto: PrioridadRequestDTO):
        logger.info(f"Service - Modificar prioridad ID: {id}")

        # Validación de negocio
        errores = prioridadValidator(prioridad_dto)
        if errores:
            raise BusinessException("; ".join(errores))

        nueva_data = prioridad_dto.dict(exclude_unset=True)
        prioridad_actualizada = await self.repository.update(id, nueva_data)

        if not prioridad_actualizada:
            raise NotFoundException(f"No se encontró la prioridad con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(prioridad_actualizada))

    async def eliminarPrioridad(self, id: int):
        logger.info(f"Service - Eliminar prioridad ID: {id}")
        ok = await self.repository.delete(id)

        if not ok:
            raise NotFoundException(f"No se encontró la prioridad con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})
