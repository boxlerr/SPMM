from typing import Optional
from pydantic import BaseModel, Field

class ProcesoRequestDTO(BaseModel):
    nombre: Optional[str] = Field(default=None, max_length=255)
    descripcion: Optional[str] = None
