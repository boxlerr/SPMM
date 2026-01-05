from typing import Optional
from pydantic import BaseModel, Field
from datetime import date

class OperarioRequestDTO(BaseModel):
    """
    DTO de entrada para crear/actualizar un Operario.
    """
    nombre: str = Field(..., max_length=100)
    apellido: str = Field(..., max_length=100)
    fecha_nacimiento: Optional[date] = None
    fecha_ingreso: Optional[date] = None
    sector: Optional[str] = None
    categoria: str = Field(..., max_length=100)
    disponible: Optional[bool] = True
    
    # Estos sí pueden ser opcionales
    telefono: Optional[str] = Field(None, max_length=50)
    celular: Optional[str] = Field(None, max_length=50)
    dni: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=150)

    class Config:
        json_schema_extra = {
            "example": {
                "nombre": "Juan",
                "apellido": "Pérez",
                "fecha_nacimiento": "1990-05-15",
                "fecha_ingreso": "2020-01-10",
                "sector": "MECANIZADO",
                "categoria": "OPERARIO CALIFICADO",
                "disponible": True,
                "telefono": "4233-2492",
                "celular": "11-2748-6366",
                "dni": "32753520"
            }
        }