from typing import Optional
from pydantic import BaseModel, Field

class MaquinariaRequestDTO(BaseModel):
    """
    DTO de entrada para crear o actualizar una Maquinaria.

    Los tres campos del RF-08 (`tipo`, `estado_operativo`, `frecuencia_mantenimiento_dias`)
    son opcionales A PROPÓSITO: el frontend se publica solo al pushear y el backend se
    deploya a mano, así que un front viejo que no los conoce le va a pegar a este
    backend. Si no vienen, en el alta se usa el default y en la edición no se tocan
    (el servicio usa `exclude_unset`). Contra qué valores se validan vive en
    MaquinariaService, que es quien contesta el 422 con un motivo legible.
    """
    nombre: str = Field(..., max_length=100)
    cod_maquina: Optional[str] = Field(None, max_length=50)
    limitacion: Optional[str] = Field(None, max_length=255)
    capacidad: Optional[str] = Field(None, max_length=255)
    especialidad: Optional[str] = Field(None, max_length=255)
    tipo: Optional[str] = Field(None, max_length=40)
    estado_operativo: Optional[str] = Field(None, max_length=20)
    frecuencia_mantenimiento_dias: Optional[int] = None

    class Config:
        json_schema_extra = {
            "example": {
                "nombre": "Torno CNC Haas VF2",
                "cod_maquina": "TORNO-01",
                "limitacion": "Falla en avance automático",
                "capacidad": "Ejes X, Y, Z; potencia 7.5HP",
                "especialidad": "Mecanizado de precisión",
                "tipo": "TORNO",
                "estado_operativo": "operativa",
                "frecuencia_mantenimiento_dias": 90,
            }
        }
