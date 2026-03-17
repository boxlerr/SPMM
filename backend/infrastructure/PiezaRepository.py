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

    async def find_all(self, page: int = 1, size: int = 50, search: str = "", only_with_ot: bool = False):
        try:
            from sqlalchemy import func
            from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
            from backend.domain.OrdenTrabajo import OrdenTrabajo
            
            logger.info(f"Repository - Obtener piezas paginadas: page={page}, size={size}, search='{search}', only_with_ot={only_with_ot}")
            
            # Subquery to get the related old work order ID for each piece
            ot_subquery = select(
                OrdenTrabajoPieza.id_pieza,
                func.max(OrdenTrabajo.id_otvieja).label("ot_vie_rel")
            ).join(
                OrdenTrabajo, OrdenTrabajoPieza.id_orden_trabajo == OrdenTrabajo.id
            ).group_by(OrdenTrabajoPieza.id_pieza).subquery()

            # Main query
            if only_with_ot:
                # Use INNER JOIN if we only want pieces with OT
                query = select(Pieza, ot_subquery.c.ot_vie_rel).join(
                    ot_subquery, Pieza.id == ot_subquery.c.id_pieza
                )
            else:
                # Use OUTER JOIN to include all pieces
                query = select(Pieza, ot_subquery.c.ot_vie_rel).outerjoin(
                    ot_subquery, Pieza.id == ot_subquery.c.id_pieza
                )
            
            if search:
                search_filter = (Pieza.descripcion.ilike(f"%{search}%")) | (Pieza.cod_pieza.ilike(f"%{search}%"))
                query = query.where(search_filter)
            
            # Count total
            if only_with_ot:
                count_query = select(func.count(Pieza.id)).join(
                    ot_subquery, Pieza.id == ot_subquery.c.id_pieza
                )
            else:
                count_query = select(func.count(Pieza.id))
                
            if search:
                count_query = count_query.where((Pieza.descripcion.ilike(f"%{search}%")) | (Pieza.cod_pieza.ilike(f"%{search}%")))
            
            total_result = await self.db.execute(count_query)
            total = total_result.scalar()
            
            # Pagination
            query = query.order_by(Pieza.id.asc())
            offset = (page - 1) * size
            query = query.offset(offset).limit(size)
            
            result = await self.db.execute(query)
            rows = result.all()
            
            data = []
            for row in rows:
                pieza = row[0]
                # Populate id_otvieja dynamically for display
                if row[1] is not None:
                    pieza.id_otvieja = row[1]
                data.append(pieza)
            
            logger.info(f"Repository - Resultado OK ({len(data)} registros de {total}).")
            return data, total
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException(f"Error al listar Piezas: {str(e)}") from e


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
