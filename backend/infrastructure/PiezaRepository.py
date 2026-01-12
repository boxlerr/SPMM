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

    async def find_all(self, page: int = 1, size: int = 50, search: str = ""):
        try:
            logger.info(f"Repository - Obtener piezas paginadas: page={page}, size={size}, search='{search}'")
            
            # Base query
            query = select(Pieza)
            
            # Filter if search term provided
            if search:
                search_filter = (Pieza.descripcion.ilike(f"%{search}%")) | (Pieza.cod_pieza.ilike(f"%{search}%"))
                query = query.where(search_filter)
            
            # Count total API call
            # We need a separate count query or use func.count()
            # Efficient way for simple count:
            from sqlalchemy import func
            count_query = select(func.count()).select_from(query.subquery())
            total_result = await self.db.execute(count_query)
            total = total_result.scalar()
            
            # Pagination
            # MSSQL requires ORDER BY for OFFSET/LIMIT
            query = query.order_by(Pieza.id.asc())
            offset = (page - 1) * size
            query = query.offset(offset).limit(size)
            
            result = await self.db.execute(query)
            data = result.scalars().all()
            
            logger.info(f"Repository - Resultado OK ({len(data)} registros de {total}).")
            return data, total
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
