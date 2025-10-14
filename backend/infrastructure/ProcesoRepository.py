
from sqlalchemy import select
from backend.domain.Proceso import Proceso
from backend.commons.exceptions.InfrastructureException import InfrastructureException

from backend.commons.loggers.logger import logger

class ProcesoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, proceso: Proceso):
        try:
            logger.info("Repository - Crear Proceso.")
            self.db.add(proceso)
            await self.db.commit()
            await self.db.refresh(proceso)
            logger.info("Repository - Crear Proceso OK.")
            return proceso
        except Exception as e:
            logger.error(f"Repository - Error real en save: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar el Proceso.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los procesos.")
            result = await self.db.execute(select(Proceso))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar los Procesos.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar proceso por ID {id}.")
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar el Proceso por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar proceso ID {id}.")
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            proceso = result.scalar_one_or_none()
            if not proceso:
                logger.info(f"Repository - Proceso {id} no encontrado para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(proceso, key, value)

            await self.db.commit()
            await self.db.refresh(proceso)
            logger.info(f"Repository - Proceso {id} actualizado correctamente.")
            return proceso
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar el Proceso.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar proceso ID {id}.")
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            proceso = result.scalar_one_or_none()

            if not proceso:
                logger.info(f"Repository - Proceso {id} no encontrado para eliminar.")
                return False

            await self.db.delete(proceso)
            await self.db.commit()
            logger.info(f"Repository - Proceso {id} eliminado correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar el Proceso.") from e
