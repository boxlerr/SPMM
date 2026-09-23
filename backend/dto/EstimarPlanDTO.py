from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class EstimarPlanDTO(BaseModel):
    """Cuerpo de POST /planificacion/estimar: lo tildado en el Paso 1 del planificador."""
    ordenes_ids: List[int]
    fecha_desde: Optional[date] = None
    # Si viene, además de cuánto tarda todo, dice qué entra hasta ese día.
    fecha_hasta: Optional[date] = None
