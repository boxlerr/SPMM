from typing import Optional
from pydantic import BaseModel, Field

class ProcesoSkillDTO(BaseModel):
    """
    DTO para representar la habilidad de un operario en un proceso.
    """
    id_proceso: int = Field(..., description="ID del proceso")
    nivel: int = Field(..., description="Nivel de habilidad (1 = Principal, 2 = Secundaria)")
    habilitado: Optional[bool] = True

class ProcesoSkillUpdateDTO(BaseModel):
    """
    DTO para actualizar el estado de habilitación de una habilidad.
    """
    habilitado: bool = Field(..., description="Estado de habilitación de la habilidad")
