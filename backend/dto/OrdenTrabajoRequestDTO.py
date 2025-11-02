from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class OrdenTrabajoRequestDTO(BaseModel):
    id_otvieja: int
    observaciones: Optional[str] = None

    id_prioridad: int
    id_sector: int
    id_articulo: int
    # 🔻 Eliminado: id_maquinaria

    fecha_orden: datetime
    fecha_entrada: datetime
    fecha_prometida: datetime
    fecha_entrega: Optional[datetime] = None


