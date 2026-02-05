from dataclasses import dataclass
from .base import DomainEvent
from typing import Optional

@dataclass(frozen=True, kw_only=True)
class WorkOrderCreated(DomainEvent):
    id: int
    id_cliente: Optional[int]
    unidades: int
    fecha_prometida: Optional[str] = None # Using concrete types from DTO/Model
    creator_name: Optional[str] = None 

@dataclass(frozen=True, kw_only=True)
class WorkOrderStateChanged(DomainEvent):
    id: int
    new_state: str # Could be "Iniciado", "Finalizado", etc.
    previous_state: Optional[str] = None
    actor_name: Optional[str] = None
