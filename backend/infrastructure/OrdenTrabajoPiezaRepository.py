from sqlalchemy import select
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class OrdenTrabajoPiezaRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, entity: OrdenTrabajoPieza):
        try:
            logger.info("Repository - Crear OrdenTrabajoPieza.")
            self.db.add(entity)
            await self.db.commit()
            await self.db.refresh(entity)
            logger.info("Repository - Crear OrdenTrabajoPieza OK.")
            return entity
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en save: {e}")
            raise InfrastructureException("Error al guardar OrdenTrabajoPieza.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar OrdenTrabajoPieza ID {id}.")
            result = await self.db.execute(select(OrdenTrabajoPieza).where(OrdenTrabajoPieza.id == id))
            entity = result.scalar_one_or_none()

            if not entity:
                logger.info(f"Repository - OrdenTrabajoPieza {id} no encontrada para eliminar.")
                return False

            await self.db.delete(entity)
            await self.db.commit()
            logger.info(f"Repository - OrdenTrabajoPieza {id} eliminada correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar OrdenTrabajoPieza.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todas las OrdenTrabajoPieza.")
            result = await self.db.execute(select(OrdenTrabajoPieza))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar OrdenTrabajoPieza.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar OrdenTrabajoPieza por ID {id}.")
            result = await self.db.execute(select(OrdenTrabajoPieza).where(OrdenTrabajoPieza.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar OrdenTrabajoPieza por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar OrdenTrabajoPieza ID {id}.")
            result = await self.db.execute(select(OrdenTrabajoPieza).where(OrdenTrabajoPieza.id == id))
            entity = result.scalar_one_or_none()
            if not entity:
                logger.info(f"Repository - OrdenTrabajoPieza {id} no encontrada para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(entity, key, value)

            await self.db.commit()
            await self.db.refresh(entity)
            logger.info(f"Repository - OrdenTrabajoPieza {id} actualizada correctamente.")
            return entity
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar OrdenTrabajoPieza.") from e
