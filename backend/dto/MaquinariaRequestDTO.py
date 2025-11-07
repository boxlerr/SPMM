from typing import Optional
from pydantic import BaseModel, Field

class MaquinariaRequestDTO(BaseModel):
    """
    DTO de entrada para crear o actualizar una Maquinaria.
    """
    nombre: str = Field(..., max_length=100)
    cod_maquina: Optional[str] = Field(None, max_length=50)
    limitacion: Optional[str] = Field(None, max_length=255)
    capacidad: Optional[str] = Field(None, max_length=255)
    especialidad: Optional[str] = Field(None, max_length=255)

    class Config:
        json_schema_extra = {
            "example": {
                "nombre": "Torno CNC Haas VF2",
                "cod_maquina": "TORNO-01",
                "limitacion": "Falla en avance automático",
                "capacidad": "Ejes X, Y, Z; potencia 7.5HP",
                "especialidad": "Mecanizado de precisión"
            }
        }

