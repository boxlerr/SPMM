from sqlalchemy import select
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from datetime import datetime

class OrdenTrabajoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, orden: OrdenTrabajo):
        try:
            logger.info("Repository - Crear Orden de Trabajo.")
            self.db.add(orden)
            await self.db.commit()
            await self.db.refresh(orden)
            logger.info("Repository - Crear Orden de Trabajo OK.")
            return orden
        except Exception as e:
            logger.error(f"Repository - Error real en save: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar la Orden de Trabajo.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todas las órdenes de trabajo.")
            result = await self.db.execute(select(OrdenTrabajo))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar las Órdenes de Trabajo.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar orden de trabajo por ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar la Orden de Trabajo por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar orden de trabajo ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            orden = result.scalar_one_or_none()
            if not orden:
                logger.info(f"Repository - Orden de trabajo {id} no encontrada para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(orden, key, value)

            await self.db.commit()
            await self.db.refresh(orden)
            logger.info(f"Repository - Orden de trabajo {id} actualizada correctamente.")
            return orden
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar la Orden de Trabajo.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar orden de trabajo ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            orden = result.scalar_one_or_none()

            if not orden:
                logger.info(f"Repository - Orden de trabajo {id} no encontrada para eliminar.")
                return False

            await self.db.delete(orden)
            await self.db.commit()
            logger.info(f"Repository - Orden de trabajo {id} eliminada correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar la Orden de Trabajo.") from e
            
    async def find_by_fecha_orden_entre(self, desde: datetime, hasta: datetime):
        try:
            logger.info(f"Repository - Buscar órdenes entre {desde} y {hasta}.")
            result = await self.db.execute(select(OrdenTrabajo).where(
                OrdenTrabajo.fecha_orden >= desde,
                OrdenTrabajo.fecha_orden <= hasta
            ))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_fecha_orden_entre: {e}")
            raise InfrastructureException("Error al filtrar por fechas.") from e

    async def find_by_prioridad(self, id_prioridad: int):
        try:
            logger.info(f"Repository - Buscar órdenes por prioridad {id_prioridad}.")
            result = await self.db.execute(select(OrdenTrabajo).where(
                OrdenTrabajo.id_prioridad == id_prioridad
            ))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_prioridad: {e}")
            raise InfrastructureException("Error al filtrar por prioridad.") from e





