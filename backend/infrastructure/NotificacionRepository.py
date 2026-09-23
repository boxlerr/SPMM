from sqlalchemy import select, desc, func
from backend.domain.Notificacion import Notificacion
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


# Los avisos que salen de «Usuarios y permisos» (alta, cambio y baja de una cuenta:
# «Usuario 'x' (Nombre Apellido) fue creado»). Esa sección es confidencial, así que sus
# avisos los ve sólo quien la puede ver (NotificacionAPI decide quién; acá se filtra).
PREFIJO_AVISOS_DE_USUARIOS = "usuario_"


def es_aviso_de_usuarios(tipo) -> bool:
    return (tipo or "").startswith(PREFIJO_AVISOS_DE_USUARIOS)


def _visibles(consulta, ocultar_avisos_de_usuarios: bool):
    if ocultar_avisos_de_usuarios:
        consulta = consulta.where(
            ~Notificacion.tipo.startswith(PREFIJO_AVISOS_DE_USUARIOS, autoescape=True)
        )
    return consulta


class NotificacionRepository:
    """
    Repositorio asincrónico de `Notificacion`.
    Maneja transacciones usando AsyncSession y errores con InfrastructureException.

    `ocultar_avisos_de_usuarios`: la campanita es UNA para todo el taller, pero los
    avisos de «Usuarios y permisos» no son para todos (ver PREFIJO_AVISOS_DE_USUARIOS).
    Lo que se oculta no se lista, no se cuenta, no se lee por id y no se marca como
    leído: para quien no lo ve, no existe.
    """

    def __init__(self, db):
        self.db = db

    async def find_by_id(self, id: int, ocultar_avisos_de_usuarios: bool = False):
        try:
            result = await self.db.execute(_visibles(
                select(Notificacion).where(Notificacion.id_notificacion == id),
                ocultar_avisos_de_usuarios,
            ))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error al buscar Notificacion {id}: {e}")
            raise InfrastructureException("Error al buscar la Notificacion por ID.") from e

    async def find_all(self, limit: int = None, offset: int = None, solo_no_leidas: bool = False,
                       ocultar_avisos_de_usuarios: bool = False):
        try:
            logger.info("Repository - Obtener todas las notificaciones desde la base de datos.")
            query = _visibles(select(Notificacion), ocultar_avisos_de_usuarios)
            
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

    async def count(self, solo_no_leidas: bool = False, ocultar_avisos_de_usuarios: bool = False):
        """Cuenta el total de notificaciones"""
        try:
            query = _visibles(select(func.count()).select_from(Notificacion), ocultar_avisos_de_usuarios)
            if solo_no_leidas:
                query = query.where(Notificacion.leida == False)
            return int((await self.db.execute(query)).scalar() or 0)
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

    async def guardar_varias(self, notificaciones: list[Notificacion]):
        """Guarda un lote de notificaciones en UN solo viaje y UN solo commit.

        El detector de órdenes retrasadas escribe de a muchas: llamar a `save()` por
        cada una sería una ida y vuelta por orden contra Supabase, cuyo pooler admite
        15 conexiones para TODO el proyecto. Y peor: si se cortara a mitad de camino
        quedaría media corrida avisada, que es justo el estado del que después nadie
        se entera.

        Devuelve cuántas se guardaron.
        """
        if not notificaciones:
            return 0
        try:
            self.db.add_all(notificaciones)
            await self.db.commit()
            logger.info(f"Repository - {len(notificaciones)} notificaciones guardadas en lote.")
            return len(notificaciones)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al guardar notificaciones en lote: {e}")
            raise InfrastructureException("Error al guardar las Notificaciones.") from e

    async def update(self, id: int, nueva_data: dict, ocultar_avisos_de_usuarios: bool = False):
        try:
            result = await self.db.execute(_visibles(
                select(Notificacion).where(Notificacion.id_notificacion == id),
                ocultar_avisos_de_usuarios,
            ))
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

    async def mark_all_as_read(self, ocultar_avisos_de_usuarios: bool = False):
        """Marca como leídas todas las que ve quien lo pide (las que no ve, no las toca:
        un operario no puede dejar leído para el admin un aviso que él ni ve)."""
        try:
            result = await self.db.execute(_visibles(
                select(Notificacion).where(Notificacion.leida == False),
                ocultar_avisos_de_usuarios,
            ))
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

