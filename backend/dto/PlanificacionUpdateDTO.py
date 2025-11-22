from pydantic import BaseModel
from typing import Optional

class PlanificacionUpdateDTO(BaseModel):
    inicio_min: Optional[int] = None
    fin_min: Optional[int] = None
    id_operario: Optional[int] = None
