from backend.domain.Notificacion import Notificacion
from backend.dto.NotificacionRequestDTO import NotificacionCreateDTO, NotificacionUpdateDTO
from backend.infrastructure.NotificacionRepository import NotificacionRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.loggers.logger import logger
from datetime import datetime


class NotificacionService:
    """
    Capa de aplicación de Notificacion (versión asincrónica).
    Maneja validaciones, conversión a DTO y llamadas al repositorio asincrónico.
    """

    def __init__(self, db_session):
        self.repository = NotificacionRepository(db_session)

    # 🔹 Crear Notificación
    async def crearNotificacion(self, notificacion_dto: NotificacionCreateDTO):
        try:
            if not notificacion_dto.mensaje or not notificacion_dto.tipo:
                raise BusinessException("Mensaje y tipo son obligatorios.")

            notificacion = Notificacion(
                mensaje=notificacion_dto.mensaje,
                tipo=notificacion_dto.tipo,
                leida=False,
                motivo=notificacion_dto.motivo,
                id_usuario_creador=notificacion_dto.id_usuario_creador,
                fecha_creacion=datetime.utcnow()
            )

            notificacion_creada = await self.repository.save(notificacion)

            return ResponseDTO(
                status=True,
                data=jsonable_encoder(notificacion_creada.to_dict()),
                errorDescription=""
            )

        except BusinessException as e:
            raise e
        except Exception as e:
            logger.error(f"Service - Error al crear Notificacion: {e}")
            raise InfrastructureException("Error al guardar la Notificacion.") from e

    # 🔹 Listar Notificaciones
    async def listarNotificaciones(self, limit: int = None, offset: int = None, solo_no_leidas: bool = False):
        try:
            logger.info("Service - Listar Notificaciones.")
            notificaciones = await self.repository.find_all(limit=limit, offset=offset, solo_no_leidas=solo_no_leidas)

            data = [notif.to_dict() for notif in notificaciones]

            return ResponseDTO(status=True, data=data, errorDescription="")
        except Exception as e:
            logger.error(f"Service - Error al listar Notificaciones: {e}")
            raise InfrastructureException("Error al listar Notificaciones.") from e

    # 🔹 Obtener Notificación por ID
    async def obtenerNotificacionPorId(self, id: int):
        try:
            logger.info(f"Service - Obtener Notificacion id={id}")
            notif = await self.repository.find_by_id(id)

            if not notif:
                return ResponseDTO(status=False, data={}, errorDescription="Notificacion no encontrada")

            return ResponseDTO(
                status=True,
                data=notif.to_dict(),
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al obtener Notificacion: {e}")
            raise InfrastructureException("Error al obtener Notificacion.") from e

    # 🔹 Marcar como leída
    async def marcarComoLeida(self, id: int):
        try:
            logger.info(f"Service - Marcar Notificacion {id} como leída")
            actualizada = await self.repository.update(id, {"leida": True})

            if not actualizada:
                return ResponseDTO(status=False, data={}, errorDescription="Notificacion no encontrada")

            return ResponseDTO(
                status=True,
                data=actualizada.to_dict(),
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al marcar Notificacion como leída: {e}")
            raise InfrastructureException("Error al marcar la Notificacion como leída.") from e

    # 🔹 Marcar todas como leídas
    async def marcarTodasComoLeidas(self):
        try:
            logger.info("Service - Marcar todas las notificaciones como leídas")
            count = await self.repository.mark_all_as_read()
            return ResponseDTO(
                status=True,
                data={"marcadas": count},
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al marcar todas como leídas: {e}")
            raise InfrastructureException("Error al marcar todas las notificaciones como leídas.") from e

    # 🔹 Obtener contador de no leídas
    async def contarNoLeidas(self):
        try:
            logger.info("Service - Contar notificaciones no leídas")
            count = await self.repository.count(solo_no_leidas=True)
            return ResponseDTO(
                status=True,
                data={"count": count},
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al contar no leídas: {e}")
            raise InfrastructureException("Error al contar notificaciones no leídas.") from e

    # 🔹 Eliminar Notificación
    async def eliminarNotificacion(self, id: int):
        try:
            logger.info(f"Service - Eliminando Notificacion id={id}")
            ok = await self.repository.delete(id)

            if not ok:
                return ResponseDTO(status=False, data={}, errorDescription="Notificacion no encontrada")

            return ResponseDTO(status=True, data={"deleted": id}, errorDescription="")
        except Exception as e:
            logger.error(f"Service - Error al eliminar Notificacion: {e}")
            raise InfrastructureException("Error al eliminar la Notificacion.") from e

    # 🔹 Eliminar todas las notificaciones
    async def eliminarTodas(self):
        try:
            logger.info("Service - Eliminando todas las notificaciones")
            count = await self.repository.delete_all()
            return ResponseDTO(
                status=True,
                data={"eliminadas": count},
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al eliminar todas: {e}")
            raise InfrastructureException("Error al eliminar todas las notificaciones.") from e

