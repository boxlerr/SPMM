from sqlalchemy import select
from backend.domain.Sector import Sector
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class SectorRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, sector: Sector):
        try:
            logger.info("Repository - Crear Sector.")
            self.db.add(sector)
            await self.db.commit()
            await self.db.refresh(sector)
            logger.info("Repository - Crear Sector OK.")
            return sector
        except Exception as e:
            logger.error(f"Repository - Error real en save: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar el Sector.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los sectores.")
            result = await self.db.execute(select(Sector))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar los Sectores.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar sector por ID {id}.")
            result = await self.db.execute(select(Sector).where(Sector.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar el Sector por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar sector ID {id}.")
            result = await self.db.execute(select(Sector).where(Sector.id == id))
            sector = result.scalar_one_or_none()
            if not sector:
                logger.info(f"Repository - Sector {id} no encontrado para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(sector, key, value)

            await self.db.commit()
            await self.db.refresh(sector)
            logger.info(f"Repository - Sector {id} actualizado correctamente.")
            return sector
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar el Sector.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar sector ID {id}.")
            result = await self.db.execute(select(Sector).where(Sector.id == id))
            sector = result.scalar_one_or_none()

            if not sector:
                logger.info(f"Repository - Sector {id} no encontrado para eliminar.")
                return False

            await self.db.delete(sector)
            await self.db.commit()
            logger.info(f"Repository - Sector {id} eliminado correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar el Sector.") from e



