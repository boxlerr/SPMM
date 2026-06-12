from sqlalchemy import update

from backend.domain.Rango import Rango
from backend.domain.Operario import Operario
from backend.dto.RangoRequestDTO import RangoRequestDTO
from backend.infrastructure.RangoRepository import RangoRepository
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.NotFoundException import NotFoundException
from fastapi.encoders import jsonable_encoder
from backend.commons.loggers.logger import logger


class RangoService:
    def __init__(self, db_session):
        self.db = db_session
        self.repository = RangoRepository(db_session)

    async def crearRango(self, rango_dto: RangoRequestDTO):
        try:
            logger.info("Service - Crear rango.")
            nombre = (rango_dto.nombre or "").strip()
            if not nombre:
                raise BusinessException("El nombre del Rango es obligatorio.")

            rango = Rango(nombre=nombre)
            rango_creado = await self.repository.save(rango)
            return ResponseDTO(status=True, data=jsonable_encoder(rango_creado))
        except (InfrastructureException, BusinessException):
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear el Rango.") from e

    async def listarRangos(self):
        logger.info("Service - Listar rangos.")
        rangos = await self.repository.find_all()
        return ResponseDTO(status=True, data=jsonable_encoder(rangos))

    async def obtenerRangoPorId(self, id: int):
        logger.info(f"Service - Obtener rango ID: {id}")
        rango = await self.repository.find_by_id(id)
        if not rango:
            raise NotFoundException(f"No se encontró el rango con ID {id}")
        return ResponseDTO(status=True, data=jsonable_encoder(rango))

    async def modificarRango(self, id: int, rango_dto: RangoRequestDTO):
        logger.info(f"Service - Modificar rango ID: {id}")
        nombre = (rango_dto.nombre or "").strip()
        if not nombre:
            raise BusinessException("El nombre del Rango es obligatorio.")

        # Capturar el nombre anterior antes de actualizar, para propagar el renombre
        # a los operarios que tenían ese rango como categoría.
        rango_actual = await self.repository.find_by_id(id)
        if not rango_actual:
            raise NotFoundException(f"No se encontró el rango con ID {id}")
        nombre_anterior = rango_actual.nombre

        nueva_data = rango_dto.dict(exclude_unset=True)
        rango_actualizado = await self.repository.update(id, nueva_data)
        if not rango_actualizado:
            raise NotFoundException(f"No se encontró el rango con ID {id}")

        # Si cambió el nombre, actualizar la categoría de los operarios afectados.
        if nombre_anterior and nombre_anterior != rango_actualizado.nombre:
            try:
                await self.db.execute(
                    update(Operario)
                    .where(Operario.categoria == nombre_anterior)
                    .values(categoria=rango_actualizado.nombre)
                )
                await self.db.commit()
                logger.info(
                    f"Service - Operarios con categoria '{nombre_anterior}' "
                    f"actualizados a '{rango_actualizado.nombre}'."
                )
            except Exception as e:
                await self.db.rollback()
                logger.error(f"Service - Error al propagar renombre de rango a operarios: {e}")
                raise ApplicationException(
                    "Error al propagar el nuevo nombre del rango a los operarios."
                ) from e

        return ResponseDTO(status=True, data=jsonable_encoder(rango_actualizado))

    async def eliminarRango(self, id: int):
        logger.info(f"Service - Eliminar rango ID: {id}")
        ok = await self.repository.delete(id)
        if not ok:
            raise NotFoundException(f"No se encontró el rango con ID {id}")
        return ResponseDTO(status=True, data={"deleted": id})
