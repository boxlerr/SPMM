from typing import Optional
from pydantic import BaseModel, Field
from datetime import date


class OperarioRequestDTO(BaseModel):
    """
    DTO de entrada para crear un Operario.
    Mantiene validaciones básicas.
    """

    nombre: str = Field(..., max_length=100)
    apellido: str = Field(..., max_length=100)
    fecha_nacimiento: date
    fecha_ingreso: date
    sector: str = Field(..., max_length=100)
    categoria: str = Field(..., max_length=100)
    disponible: Optional[bool] = True
    cant_hs_trabajadas: Optional[int] = 0
    dias_trabajo: Optional[str] = Field(default=None, max_length=50)


