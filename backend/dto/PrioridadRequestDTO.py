from typing import Optional
from pydantic import BaseModel, Field

class PrioridadRequestDTO(BaseModel):
    descripcion: str = Field(..., max_length=100)
    detalle: Optional[str] = Field(default=None, max_length=255)
