from sqlalchemy import select
from backend.domain.Plano import Plano
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class PlanoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, plano: Plano):
        try:
            logger.info("Repository - Crear Plano.")
            self.db.add(plano)
            await self.db.commit()
            await self.db.refresh(plano)
            logger.info("Repository - Crear Plano OK.")
            return plano
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en save Plano: {e}")
            raise InfrastructureException("Error al guardar un nuevo Plano.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar Plano ID {id}.")
            result = await self.db.execute(select(Plano).where(Plano.id == id))
            plano = result.scalar_one_or_none()

            if not plano:
                logger.info(f"Repository - Plano {id} no encontrado para eliminar.")
                return False

            await self.db.delete(plano)
            await self.db.commit()
            logger.info(f"Repository - Plano {id} eliminado correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete Plano: {e}")
            raise InfrastructureException("Error al eliminar el Plano.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar Plano por ID {id}.")
            result = await self.db.execute(select(Plano).where(Plano.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id Plano: {e}")
            raise InfrastructureException("Error al buscar el Plano por ID.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los Planos.")
            result = await self.db.execute(select(Plano))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all Plano: {e}")
            raise InfrastructureException("Error al listar Planos.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar Plano ID {id}.")
            result = await self.db.execute(select(Plano).where(Plano.id == id))
            plano = result.scalar_one_or_none()

            if not plano:
                logger.info(f"Repository - Plano {id} no encontrado para actualizar.")
                return None

            # Actualizar solo los campos presentes (mismo estilo Articulo)
            for key, value in nueva_data.items():
                setattr(plano, key, value)

            await self.db.commit()
            await self.db.refresh(plano)
            logger.info(f"Repository - Plano {id} actualizado correctamente.")
            return plano
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update Plano: {e}")
            raise InfrastructureException("Error al actualizar el Plano.") from e

    async def find_by_orden_trabajo(self, id_orden: int):
        try:
            logger.info(f"Repository - Obtener Planos por OrdenTrabajo ID {id_orden}.")
            result = await self.db.execute(select(Plano).where(Plano.id_orden_trabajo == id_orden))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_orden_trabajo: {e}")
            raise InfrastructureException("Error al obtener Planos por Orden de Trabajo.") from e
