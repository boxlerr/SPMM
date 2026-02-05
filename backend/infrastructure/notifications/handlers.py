from backend.domain.events.work_order import WorkOrderCreated, WorkOrderStateChanged
from backend.dto.notification_dto import NotificationDTO
from backend.infrastructure.realtime.ws_manager import WSManager
from backend.infrastructure.db import SessionLocal
from backend.domain.Notificacion import Notificacion
from backend.infrastructure.NotificacionRepository import NotificacionRepository
import logging
import asyncio

logger = logging.getLogger("uvicorn")

class NotificationHandlers:
    def __init__(self, ws_manager: WSManager):
        self.ws_manager = ws_manager

    async def on_work_order_created(self, event: WorkOrderCreated):
        logger.info(f"Handler: WorkOrderCreated {event.id}")
        
        # 1. Persistir Notificación
        saved_notification = None
        async with SessionLocal() as session:
            repo = NotificacionRepository(session)
            msg = f"Nueva Orden de Trabajo #{event.id} creada."
            if event.creator_name:
                msg = f"Nueva Orden de Trabajo #{event.id} creada por {event.creator_name}."

            new_notif = Notificacion(
                mensaje=msg,
                tipo="WORK_ORDER_CREATED",
                leida=False,
                id_usuario_creador=None # Podríamos pasarlo en el evento si existe
            )
            saved_notification = await repo.save(new_notif)
            # Refrescar ID
            notif_id = saved_notification.id_notificacion

        # 2. Broadcast
        if saved_notification:
            notification_dto = NotificationDTO(
                type="WORK_ORDER_CREATED",
                message=saved_notification.mensaje,
                severity="info",
                entity={"id": event.id, "unidades": event.unidades, "cliente_id": event.id_cliente, "id_notificacion": notif_id},
                created_at=event.occurred_at
            )
            await self.ws_manager.broadcast(notification_dto.model_dump())

    async def on_work_order_state_changed(self, event: WorkOrderStateChanged):
        logger.info(f"Handler: WorkOrderStateChanged {event.id} -> {event.new_state}")
        
        # 1. Persistir Notificación
        saved_notification = None
        async with SessionLocal() as session:
            repo = NotificacionRepository(session)
            msg = f"La Orden #{event.id} cambió a estado '{event.new_state}'."
            if event.actor_name:
                msg = f"{event.actor_name} cambió la Orden #{event.id} a estado '{event.new_state}'."
            
            new_notif = Notificacion(
                mensaje=msg,
                tipo="WORK_ORDER_STATE_CHANGED",
                leida=False,
                motivo=f"Estado anterior: {event.previous_state}",
                id_usuario_creador=None
            )
            saved_notification = await repo.save(new_notif)
            notif_id = saved_notification.id_notificacion

        # 2. Broadcast
        if saved_notification:
            notification_dto = NotificationDTO(
                type="WORK_ORDER_STATE_CHANGED",
                message=saved_notification.mensaje,
                severity="info",
                entity={"id": event.id, "new_state": event.new_state, "previous_state": event.previous_state, "id_notificacion": notif_id},
                created_at=event.occurred_at
            )
            await self.ws_manager.broadcast(notification_dto.model_dump())
