from sqlalchemy import select
from backend.domain.Prioridad import Prioridad
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class PrioridadRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, prioridad: Prioridad):
        try:
            logger.info("Repository - Crear Prioridad.")
            self.db.add(prioridad)
            await self.db.commit()
            await self.db.refresh(prioridad)
            logger.info("Repository - Crear Prioridad OK.")
            return prioridad
        except Exception as e:
            logger.error(f"Repository - Error real en save: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar la Prioridad.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todas las prioridades.")
            result = await self.db.execute(select(Prioridad))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar las Prioridades.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar prioridad por ID {id}.")
            result = await self.db.execute(select(Prioridad).where(Prioridad.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar la Prioridad por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar prioridad ID {id}.")
            result = await self.db.execute(select(Prioridad).where(Prioridad.id == id))
            prioridad = result.scalar_one_or_none()
            if not prioridad:
                logger.info(f"Repository - Prioridad {id} no encontrada para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(prioridad, key, value)

            await self.db.commit()
            await self.db.refresh(prioridad)
            logger.info(f"Repository - Prioridad {id} actualizada correctamente.")
            return prioridad
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar la Prioridad.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar prioridad ID {id}.")
            result = await self.db.execute(select(Prioridad).where(Prioridad.id == id))
            prioridad = result.scalar_one_or_none()

            if not prioridad:
                logger.info(f"Repository - Prioridad {id} no encontrada para eliminar.")
                return False

            await self.db.delete(prioridad)
            await self.db.commit()
            logger.info(f"Repository - Prioridad {id} eliminada correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar la Prioridad.") from e
