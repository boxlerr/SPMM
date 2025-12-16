from backend.domain.Plano import Plano
from backend.dto.PlanoRequestDTO import PlanoRequestDTO
from backend.infrastructure.PlanoRepository import PlanoRepository
from backend.commons.ResponseDTO import ResponseDTO

# Excepciones
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException

from backend.commons.loggers.logger import logger
from fastapi.encoders import jsonable_encoder


class PlanoService:
    def __init__(self, db_session):
        self.repository = PlanoRepository(db_session)

    async def crearPlano(self, dto: PlanoRequestDTO):
        try:
            logger.info("Service - Crear Plano.")

            # No hay validaciones de negocio por ahora
            plano = Plano(
                nombre=dto.nombre,
                descripcion=dto.descripcion,
                tipo_archivo=dto.tipo_archivo,
                archivo=dto.archivo,
                id_orden_trabajo=dto.id_orden_trabajo
            )

            plano_guardado = await self.repository.save(plano)

            return ResponseDTO(status=True, data=self._plano_to_dict(plano_guardado))

        except InfrastructureException:
            raise
        except Exception as e:
            logger.error(f"Service - Error inesperado creando Plano: {e}")
            raise ApplicationException("Error inesperado al crear el Plano.") from e

    async def obtenerPlanoPorId(self, id: int):
        logger.info(f"Service - Obtener Plano ID: {id}")

        plano = await self.repository.find_by_id(id)

        if not plano:
            raise NotFoundException(f"No se encontró el Plano con ID {id}")

        return ResponseDTO(status=True, data=self._plano_to_dict(plano))

    async def obtenerPlanosPorOrdenTrabajo(self, id_orden: int):
        logger.info(f"Service - Obtener Planos por OrdenTrabajo ID: {id_orden}")

        planos = await self.repository.find_by_orden_trabajo(id_orden)

        data = [self._plano_to_dict(p) for p in planos]
        return ResponseDTO(status=True, data=data)

    async def obtenerContenidoPlano(self, id: int):
        logger.info(f"Service - Obtener Contenido Plano ID: {id}")
        plano = await self.repository.find_by_id(id)
        if not plano:
            raise NotFoundException(f"No se encontró el Plano con ID {id}")
        return plano.archivo, plano.tipo_archivo, plano.nombre

    async def eliminarPlano(self, id: int):
        logger.info(f"Service - Eliminar Plano ID: {id}")

        eliminado = await self.repository.delete(id)

        if not eliminado:
            raise NotFoundException(f"No se encontró el Plano con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})

    async def modificarPlano(self, id: int, dto: PlanoRequestDTO):
        logger.info(f"Service - Modificar Plano ID: {id}")

        plano = await self.repository.find_by_id(id)

        if not plano:
            raise NotFoundException(f"No existe el Plano con ID {id}")

        # Actualiza campos
        plano.nombre = dto.nombre
        plano.descripcion = dto.descripcion
        plano.tipo_archivo = dto.tipo_archivo
        plano.archivo = dto.archivo

        actualizado = await self.repository.update(plano.id, {
            "nombre": dto.nombre,
            "descripcion": dto.descripcion,
            "tipo_archivo": dto.tipo_archivo,
            "archivo": dto.archivo
        })
        # Note: repository.update takes (id, dict) based on previous reading, wait, let me check PlanoRepository.update signature again.
        # Checking PlanoRepository.py content from history...
        # async def update(self, id: int, nueva_data: dict):
        # Yes, it takes id and dict. But in previous code 'modificarPlano' was calling 'self.repository.update(plano)'.
        # Let's check the previous code of PlanoService.py provided in Step 61.
        # Line 94: actualizado = await self.repository.update(plano)
        # But looking at PlanoRepository.py in Step 55, line 63: async def update(self, id: int, nueva_data: dict):
        # DISCREPANCY DETECTED. The previous Service code was likely broken or I misread.
        # Looking at Step 55 again:
        # async def update(self, id: int, nueva_data: dict): ...
        # So the Service needs to call it with a dict. The previous service code I read in Step 61 line 94 says:
        # actualizado = await self.repository.update(plano)
        # If I replace it, I must fix this usage.
        
        return ResponseDTO(status=True, data=self._plano_to_dict(actualizado))

    def _plano_to_dict(self, plano: Plano) -> dict:
        return {
            "id": plano.id,
            "nombre": plano.nombre,
            "descripcion": plano.descripcion,
            "tipo_archivo": plano.tipo_archivo,
            "fecha_subida": plano.fecha_subida,
            "id_orden_trabajo": plano.id_orden_trabajo
        }
