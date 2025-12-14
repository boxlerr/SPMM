# backend/dto/PlanificarRequestDTO.py
from pydantic import BaseModel
from typing import List, Optional

class PlanificarRequestDTO(BaseModel):
    ordenes_ids: Optional[List[int]] = None
    preview: Optional[bool] = False
