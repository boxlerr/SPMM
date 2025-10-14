from backend.domain.Proceso import Proceso
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.application.validators.ProcesoValidator import procesoValidator
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException



from backend.commons.loggers.logger import logger

class ProcesoService:
    def __init__(self, db_session):
        self.repository = ProcesoRepository(db_session)

    async def crearProceso(self, proceso_dto: ProcesoRequestDTO):
        try:
            logger.info("Service - Crear proceso.")

            # Validación de negocio
            errores = procesoValidator(proceso_dto)
            if errores:
                raise BusinessException("; ".join(errores))

            proceso = Proceso(
                nombre=proceso_dto.nombre,
                descripcion=proceso_dto.descripcion
            )

            proceso_creado = await self.repository.save(proceso)

            return ResponseDTO(status=True, data=jsonable_encoder(proceso_creado))
        #Las maneja el exception_hanlder pero acá se le da el formato
        #Error al guardar (viene del repo) → InfrastructureException
        #Error de validación (ej. nombre vacío) → BusinessException
        #Otro error inesperado → ApplicationException
        except InfrastructureException:
            raise  
        except BusinessException:
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear el Proceso.") from e


    async def listarProcesos(self):
        logger.info("Service - Listar procesos.")
        procesos = await self.repository.find_all()

        #   Posibles errores:
        # - Error de conexión / consulta SQL → InfrastructureException (repo)
        # - Ninguno si la lista está vacía (devuelve lista vacía)
        
        if not procesos:
            logger.info("Service - No hay procesos registrados.")

        
        return ResponseDTO(status=True, data=jsonable_encoder(procesos))

    async def obtenerProcesoPorId(self, id: int):
        logger.info(f"Service - Obtener proceso ID: {id}")
        proceso = await self.repository.find_by_id(id)

        #  Posibles errores:
        # - Proceso no existe → NotFoundException (lanzarla acá)
        # - Error de base de datos → InfrastructureException (repo)
        if not proceso:
            raise NotFoundException(f"No se encontró el proceso con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(proceso))

    async def modificarProceso(self, id: int, proceso_dto: ProcesoRequestDTO):
        logger.info(f"Service - Modificar proceso ID: {id}")

        #   Posibles errores:
        # - Validaciones de negocio → BusinessException
        # - Proceso inexistente → NotFoundException
        # - Error SQL → InfrastructureException (repo)

        errores = procesoValidator(proceso_dto)
        if errores:
            raise BusinessException("; ".join(errores))

        nueva_data = proceso_dto.dict(exclude_unset=True)
        proceso_actualizado = await self.repository.update(id, nueva_data)

        if not proceso_actualizado:
            raise NotFoundException(f"No se encontró el proceso con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(proceso_actualizado))

    async def eliminarProceso(self, id: int):
        logger.info(f"Service - Eliminar proceso ID: {id}")
        ok = await self.repository.delete(id)

        #   Posibles errores:
        # - Proceso inexistente → NotFoundException
        # - Error SQL / constraint → InfrastructureException (repo)
        if not ok:
            raise NotFoundException(f"No se encontró el proceso con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})
