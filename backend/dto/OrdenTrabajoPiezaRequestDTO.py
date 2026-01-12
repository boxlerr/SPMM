from pydantic import BaseModel
from typing import Optional

class OrdenTrabajoPiezaRequestDTO(BaseModel):
    id_orden_trabajo: int
    id_pieza: int
    cantidad: float
    unidad: Optional[str] = None
    pedido: Optional[int] = 0
    disponible: Optional[int] = 0
    cantusada: Optional[float] = 0.0
