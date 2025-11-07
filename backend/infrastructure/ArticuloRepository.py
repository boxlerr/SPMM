from sqlalchemy import select
from backend.domain.Articulo import Articulo
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class ArticuloRepository:
    def __init__(self, db):
        self.db = db



    async def save(self, articulo: Articulo):
        try:
            logger.info("Repository - Crear Artículo.")
            self.db.add(articulo)
            await self.db.commit()
            await self.db.refresh(articulo)
            logger.info("Repository - Crear Artículo OK.")
            return articulo
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en save: {e}")
            raise InfrastructureException("Error al guardar un nuevo Artículo.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar artículo ID {id}.")
            result = await self.db.execute(select(Articulo).where(Articulo.id == id))
            articulo = result.scalar_one_or_none()

            if not articulo:
                logger.info(f"Repository - Artículo {id} no encontrado para eliminar.")
                return False

            await self.db.delete(articulo)
            await self.db.commit()
            logger.info(f"Repository - Artículo {id} eliminado correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar el Artículo.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los artículos.")
            result = await self.db.execute(select(Articulo))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar Artículos.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar artículo por ID {id}.")
            result = await self.db.execute(select(Articulo).where(Articulo.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar el Artículo por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar artículo ID {id}.")
            result = await self.db.execute(select(Articulo).where(Articulo.id == id))
            articulo = result.scalar_one_or_none()
            if not articulo:
                logger.info(f"Repository - Artículo {id} no encontrado para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(articulo, key, value)

            await self.db.commit()
            await self.db.refresh(articulo)
            logger.info(f"Repository - Artículo {id} actualizado correctamente.")
            return articulo
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar el Artículo.") from e