from typing import Optional
from pydantic import BaseModel, Field

class ProcesoSkillDTO(BaseModel):
    """
    DTO de una habilidad del operario sobre un proceso.

    El universo de habilidades son las SKILLS NATIVAS (las que le dan sus rangos).
    Esta entrada describe el estado de una de ellas en dos ejes independientes:

      - `nivel`: prioridad para el planificador. 0 = nativa sin marcar,
        1 = SKILL 1 (preferido), 2 = SKILL 2. NO habilita nada por sí solo:
        solo se puede marcar 1/2 sobre un proceso que ya es nativo del operario.
      - `habilitado`: False apaga la nativa — el planificador deja de asignarle
        ese proceso aunque el rango se lo dé.
    """
    id_proceso: int = Field(..., description="ID del proceso")
    nivel: int = Field(
        0,
        ge=0,
        le=2,
        description="Prioridad: 0 = nativa sin marcar, 1 = SKILL 1, 2 = SKILL 2",
    )
    habilitado: Optional[bool] = True
    nativa: Optional[bool] = Field(
        None,
        description="Solo lectura: si el proceso proviene de los rangos del operario",
    )

class ProcesoSkillUpdateDTO(BaseModel):
    """
    DTO para actualizar el estado de habilitación de una habilidad.
    """
    habilitado: bool = Field(..., description="Estado de habilitación de la habilidad")
