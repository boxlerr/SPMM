from sqlalchemy import select
from backend.domain.Pieza import Pieza
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class PiezaRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, pieza: Pieza):
        try:
            logger.info("Repository - Crear Pieza.")
            self.db.add(pieza)
            await self.db.commit()
            await self.db.refresh(pieza)
            logger.info("Repository - Crear Pieza OK.")
            return pieza
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en save: {e}")
            raise InfrastructureException("Error al guardar una nueva Pieza.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar pieza ID {id}.")
            result = await self.db.execute(select(Pieza).where(Pieza.id == id))
            pieza = result.scalar_one_or_none()

            if not pieza:
                logger.info(f"Repository - Pieza {id} no encontrada para eliminar.")
                return False

            await self.db.delete(pieza)
            await self.db.commit()
            logger.info(f"Repository - Pieza {id} eliminada correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar la Pieza.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todas las piezas.")
            result = await self.db.execute(select(Pieza))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar Piezas.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar pieza por ID {id}.")
            result = await self.db.execute(select(Pieza).where(Pieza.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar la Pieza por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar pieza ID {id}.")
            result = await self.db.execute(select(Pieza).where(Pieza.id == id))
            pieza = result.scalar_one_or_none()
            if not pieza:
                logger.info(f"Repository - Pieza {id} no encontrada para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(pieza, key, value)

            await self.db.commit()
            await self.db.refresh(pieza)
            logger.info(f"Repository - Pieza {id} actualizada correctamente.")
            return pieza
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar la Pieza.") from e
