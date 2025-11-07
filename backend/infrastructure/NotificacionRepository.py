from sqlalchemy import select, desc
from backend.domain.Notificacion import Notificacion
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class NotificacionRepository:
    """
    Repositorio asincrónico de `Notificacion`.
    Maneja transacciones usando AsyncSession y errores con InfrastructureException.
    """

    def __init__(self, db):
        self.db = db

    async def find_by_id(self, id: int):
        try:
            result = await self.db.execute(
                select(Notificacion).where(Notificacion.id_notificacion == id)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error al buscar Notificacion {id}: {e}")
            raise InfrastructureException("Error al buscar la Notificacion por ID.") from e

    async def find_all(self, limit: int = None, offset: int = None, solo_no_leidas: bool = False):
        try:
            logger.info("Repository - Obtener todas las notificaciones desde la base de datos.")
            query = select(Notificacion)
            
            if solo_no_leidas:
                query = query.where(Notificacion.leida == False)
            
            query = query.order_by(desc(Notificacion.fecha_creacion))
            
            if limit:
                query = query.limit(limit)
            if offset:
                query = query.offset(offset)
            
            result = await self.db.execute(query)
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros)")
            return data
        except Exception as e:
            logger.error(f"Repository - Error al listar Notificaciones: {e}")
            raise InfrastructureException("Error al listar Notificaciones.") from e

    async def count(self, solo_no_leidas: bool = False):
        """Cuenta el total de notificaciones"""
        try:
            query = select(Notificacion)
            if solo_no_leidas:
                query = query.where(Notificacion.leida == False)
            result = await self.db.execute(query)
            return len(result.scalars().all())
        except Exception as e:
            logger.error(f"Repository - Error al contar Notificaciones: {e}")
            raise InfrastructureException("Error al contar Notificaciones.") from e

    async def save(self, notificacion: Notificacion):
        try:
            self.db.add(notificacion)
            await self.db.commit()
            await self.db.refresh(notificacion)
            return notificacion
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al guardar Notificacion: {e}")
            raise InfrastructureException("Error al guardar una Notificacion.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            result = await self.db.execute(
                select(Notificacion).where(Notificacion.id_notificacion == id)
            )
            notificacion = result.scalar_one_or_none()
            if not notificacion:
                logger.info(f"Repository - Notificacion {id} no encontrada para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(notificacion, key, value)

            await self.db.commit()
            await self.db.refresh(notificacion)
            logger.info(f"Repository - Notificacion {id} actualizada correctamente.")
            return notificacion

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al actualizar Notificacion {id}: {e}")
            raise InfrastructureException("Error al actualizar la Notificacion.") from e

    async def mark_all_as_read(self):
        """Marca todas las notificaciones como leídas"""
        try:
            result = await self.db.execute(
                select(Notificacion).where(Notificacion.leida == False)
            )
            notificaciones = result.scalars().all()
            
            for notif in notificaciones:
                notif.leida = True
            
            await self.db.commit()
            logger.info(f"Repository - {len(notificaciones)} notificaciones marcadas como leídas.")
            return len(notificaciones)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al marcar todas como leídas: {e}")
            raise InfrastructureException("Error al marcar todas las notificaciones como leídas.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Inicio DELETE notificacion id={id}")
            result = await self.db.execute(
                select(Notificacion).where(Notificacion.id_notificacion == id)
            )
            notificacion = result.scalar_one_or_none()

            if not notificacion:
                logger.info("Repository - Notificacion no encontrada.")
                return False

            await self.db.delete(notificacion)
            await self.db.commit()
            logger.info(f"Repository - Notificacion {id} eliminada correctamente.")
            return True

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al eliminar Notificacion {id}: {e}")
            raise InfrastructureException("Error al eliminar la Notificacion.") from e

    async def delete_all(self):
        """Elimina todas las notificaciones"""
        try:
            logger.info("Repository - Eliminando todas las notificaciones")
            result = await self.db.execute(select(Notificacion))
            notificaciones = result.scalars().all()
            
            for notif in notificaciones:
                await self.db.delete(notif)
            
            await self.db.commit()
            logger.info(f"Repository - {len(notificaciones)} notificaciones eliminadas.")
            return len(notificaciones)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al eliminar todas las notificaciones: {e}")
            raise InfrastructureException("Error al eliminar todas las notificaciones.") from e

