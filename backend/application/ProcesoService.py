"""from backend.domain.Proceso import Proceso
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from fastapi import HTTPException
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder

from backend.application.validators.ProcesoValidator import procesoValidator
from backend.commons.exceptions.InfrastructureException import InfrastructureException

from backend.commons.loggers.logger import logger

class ProcesoService:

    def __init__(self, db_session):
        self.repository = ProcesoRepository(db_session)

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
    async def listarProcesos2(self):
        repo = ProcesoRepository()
        logger.info(f"Aplicacion - Invocar al REPO - Traer todos")
        procesos = await repo.find_all()
        return ResponseDTO(status=True, data=jsonable_encoder(procesos))
    
    
    async def listarProcesos(self):
        try:
            logger.info("Service - Listar procesos.")
            return await self.repository.find_all()
        except InfrastructureException as e:
            logger.error(f"Service - Error: {e}")
            raise

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
    async def eliminarProceso(self,id: int):
        try:
            logger.info("APLICACION - Inicio DEL /procesos/id")
            
            ok = await self.repository.delete(id)
            logger.info(f"APLICACION - Resultado delete: {ok} ")
            
            if not ok:
                raise HTTPException(status_code=404, detail="Proceso no encontrado")
            
            return ResponseDTO(status=True, data={"deleted": id})
        except Exception as e:
            raise InfrastructureException("Error al eliminar el Proceso.") from e
"""

from backend.domain.Proceso import Proceso
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from fastapi import HTTPException
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.application.validators.ProcesoValidator import procesoValidator
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class ProcesoService:
    def __init__(self, db_session):
        self.repository = ProcesoRepository(db_session)

    async def crearProceso(self, proceso_dto: ProcesoRequestDTO):
        try:
            errores = procesoValidator(proceso_dto)
            if errores:
                return ResponseDTO(status=False, data={}, errorDescription="; ".join(errores))

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
            raise InfrastructureException("Error al guardar el Proceso.") from e

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
