from pydantic import BaseModel
from typing import Optional

class PlanoRequestDTO(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    tipo_archivo: str
    archivo: bytes
    id_orden_trabajo: int
