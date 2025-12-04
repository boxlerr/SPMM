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

            plano_dict = {
                "id": plano_guardado.id,
                "nombre": plano_guardado.nombre,
                "descripcion": plano_guardado.descripcion,
                "tipo_archivo": plano_guardado.tipo_archivo,
                "fecha_subida": plano_guardado.fecha_subida,
                "id_orden_trabajo": plano_guardado.id_orden_trabajo
            }


            return ResponseDTO(status=True, data=jsonable_encoder(plano_dict ))

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

        return ResponseDTO(status=True, data=jsonable_encoder(plano))

    async def obtenerPlanosPorOrdenTrabajo(self, id_orden: int):
        logger.info(f"Service - Obtener Planos por OrdenTrabajo ID: {id_orden}")

        planos = await self.repository.find_by_orden_trabajo(id_orden)

        return ResponseDTO(status=True, data=jsonable_encoder(planos))

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

        actualizado = await self.repository.update(plano)

        return ResponseDTO(status=True, data=jsonable_encoder(actualizado))
