from backend.domain.Proceso import Proceso
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from fastapi import HTTPException
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.application.validators.ProcesoValidator import procesoValidator
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException

from backend.commons.loggers.logger import logger

class ProcesoService:
    def __init__(self, db_session):
        self.repository = ProcesoRepository(db_session)

    async def crearProceso(self, proceso_dto: ProcesoRequestDTO):
        try:    
            logger.info("Service - Crear proceso.")
            proceso = Proceso(
                nombre=proceso_dto.nombre,
                descripcion=proceso_dto.descripcion
            )

            proceso_creado = await self.repository.save(proceso)

            return ResponseDTO(
                status=True,
                data=jsonable_encoder(proceso_creado),
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error: {e}")
            raise ApplicationException("Error al guardar el Proceso.") from e

    async def listarProcesos(self):
        try:
            logger.info("Service - Listar procesos.")
            procesos = await self.repository.find_all()
            return ResponseDTO(status=True, data=jsonable_encoder(procesos))
        except InfrastructureException as e:
            logger.error(f"Service - Error: {e}")
            raise

    async def obtenerProcesoPorId(self, id: int):
        try:
            proceso = await self.repository.find_by_id(id)
            if not proceso:
                return ResponseDTO(status=False, data={}, errorDescription="Proceso no encontrado")
            return ResponseDTO(status=True, data=jsonable_encoder(proceso))
        except Exception as e:
            raise InfrastructureException("Error al obtener el Proceso.") from e

    async def modificarProceso(self, id: int, proceso_dto: ProcesoRequestDTO):
        try:
            errores = procesoValidator(proceso_dto)
            if errores:
                return ResponseDTO(status=False, data={}, errorDescription="; ".join(errores))

            nueva_data = proceso_dto.dict(exclude_unset=True)
            proceso_actualizado = await self.repository.update(id, nueva_data)

            if not proceso_actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Proceso no encontrado")

            return ResponseDTO(status=True, data=jsonable_encoder(proceso_actualizado))
        except Exception as e:
            raise InfrastructureException("Error al actualizar el Proceso.") from e

    async def eliminarProceso(self, id: int):
        try:
            logger.info("Service - Inicio DELETE /procesos/id")
            ok = await self.repository.delete(id)
            if not ok:
                raise HTTPException(status_code=404, detail="Proceso no encontrado")
            return ResponseDTO(status=True, data={"deleted": id})
        except Exception as e:
            raise InfrastructureException("Error al eliminar el Proceso.") from e
