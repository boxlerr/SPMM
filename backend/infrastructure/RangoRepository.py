from sqlalchemy import select
from backend.domain.Rango import Rango
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class RangoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, rango: Rango):
        try:
            logger.info("Repository - Crear Rango.")
            self.db.add(rango)
            await self.db.commit()
            await self.db.refresh(rango)
            logger.info("Repository - Crear Rango OK.")
            return rango
        except Exception as e:
            logger.error(f"Repository - Error real en save Rango: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar el Rango.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los rangos.")
            result = await self.db.execute(select(Rango).order_by(Rango.nombre))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all Rango: {e}")
            raise InfrastructureException("Error al listar los Rangos.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar rango por ID {id}.")
            result = await self.db.execute(select(Rango).where(Rango.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id Rango: {e}")
            raise InfrastructureException("Error al buscar el Rango por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar rango ID {id}.")
            result = await self.db.execute(select(Rango).where(Rango.id == id))
            rango = result.scalar_one_or_none()
            if not rango:
                logger.info(f"Repository - Rango {id} no encontrado para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(rango, key, value)

            await self.db.commit()
            await self.db.refresh(rango)
            logger.info(f"Repository - Rango {id} actualizado correctamente.")
            return rango
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update Rango: {e}")
            raise InfrastructureException("Error al actualizar el Rango.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar rango ID {id}.")
            result = await self.db.execute(select(Rango).where(Rango.id == id))
            rango = result.scalar_one_or_none()

            if not rango:
                logger.info(f"Repository - Rango {id} no encontrado para eliminar.")
                return False

            await self.db.delete(rango)
            await self.db.commit()
            logger.info(f"Repository - Rango {id} eliminado correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete Rango: {e}")
            raise InfrastructureException("Error al eliminar el Rango.") from e
