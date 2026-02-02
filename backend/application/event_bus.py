import asyncio
from typing import Callable, Dict, List, Type
from backend.domain.events.base import DomainEvent
import logging

logger = logging.getLogger("uvicorn")

class EventBus:
    def __init__(self):
        self._subscribers: Dict[Type[DomainEvent], List[Callable]] = {}

    def subscribe(self, event_type: Type[DomainEvent], handler: Callable):
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(handler)
        logger.info(f"EventBus: Subscribed to {event_type.__name__}")

    async def publish(self, event: DomainEvent):
        event_type = type(event)
        if event_type in self._subscribers:
            tasks = []
            for handler in self._subscribers[event_type]:
                # Wrap handler execution to catch exceptions
                tasks.append(self._safe_execute(handler, event))
            
            if tasks:
                await asyncio.gather(*tasks)
        else:
            logger.debug(f"EventBus: No subscribers for {event_type.__name__}")

    async def _safe_execute(self, handler, event):
        try:
            await handler(event)
        except Exception as e:
            logger.error(f"EventBus: Error handling event {type(event).__name__}: {e}")
