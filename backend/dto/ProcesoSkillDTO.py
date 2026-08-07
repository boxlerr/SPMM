from typing import Optional
from pydantic import BaseModel, Field

class ProcesoSkillDTO(BaseModel):
    """
    DTO de una habilidad del operario sobre un proceso.

    El universo de habilidades son las SKILLS NATIVAS (las que le dan sus rangos) más
    las MANUALES (las que se le cargaron a mano). Esta entrada describe el estado de
    una de ellas en ejes independientes:

      - `manual`: True = la habilidad la agregó alguien a mano y habilita el proceso
        para este operario aunque su rango no lo dé. False = es una nativa.
      - `nivel`: prioridad para el planificador. 0 = sin marcar, 1 = SKILL 1
        (preferido), 2 = SKILL 2. NO habilita nada por sí solo: solo se puede marcar
        1/2 sobre un proceso que el operario ya tiene (nativo o manual).
      - `habilitado`: False apaga la habilidad — el planificador deja de asignarle
        ese proceso aunque el rango se lo dé.
      - `orden`: posición dentro de la lista de su nivel (0 = primero = más
        preferido). Desempata DENTRO del nivel; el nivel sigue mandando.
    """
    id_proceso: int = Field(..., description="ID del proceso")
    nivel: int = Field(
        0,
        ge=0,
        le=2,
        description="Prioridad: 0 = nativa sin marcar, 1 = SKILL 1, 2 = SKILL 2",
    )
    habilitado: Optional[bool] = True
    orden: Optional[int] = Field(
        None,
        ge=0,
        description="Posición dentro de SKILLS 1/2 (0 = primero). None = al final",
    )
    manual: Optional[bool] = Field(
        False,
        description="True = habilidad cargada a mano: habilita el proceso aunque el rango no lo dé",
    )
    nativa: Optional[bool] = Field(
        None,
        description="Solo lectura: si el proceso proviene de los rangos del operario",
    )

class ProcesoSkillUpdateDTO(BaseModel):
    """
    DTO para actualizar el estado de habilitación de una habilidad.
    """
    habilitado: bool = Field(..., description="Estado de habilitación de la habilidad")
