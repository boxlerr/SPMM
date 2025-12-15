from pydantic import BaseModel, Field
from typing import Optional


class ClienteRequestDTO(BaseModel):
    nombre: str = Field(..., max_length=100)
    direccion: Optional[str] = None
    cuit: Optional[str] = None
    telefono: Optional[str] = None
    celular: Optional[str] = None
    localidad: Optional[str] = None
    mail: Optional[str] = None
    web: Optional[str] = None
    obs: Optional[str] = None
    fantasia: Optional[str] = None
    abreviatura: Optional[str] = None
