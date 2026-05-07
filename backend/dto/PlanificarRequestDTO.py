# backend/dto/PlanificarRequestDTO.py
from datetime import date
from pydantic import BaseModel, model_validator
from typing import List, Optional

class PlanificarRequestDTO(BaseModel):
    ordenes_ids: Optional[List[int]] = None
    preview: Optional[bool] = False
    plan: Optional[List[dict]] = None
    fecha_desde: Optional[date] = None
    fecha_hasta: Optional[date] = None
    # Órdenes que el usuario decide forzar dentro del horizonte aunque no entren (paso 7)
    forzar_ordenes_ids: Optional[List[int]] = None
    # Fase 3: capacidades extras opcionales bajo demanda
    permitir_he: Optional[bool] = False         # 2 hs extras al final del día L-V (16:00-18:00)
    permitir_sabado: Optional[bool] = False     # Sábado de 5 hs (07:00-12:00)

    @model_validator(mode="after")
    def _validar_rango(self):
        if self.fecha_desde and self.fecha_hasta and self.fecha_hasta < self.fecha_desde:
            raise ValueError("fecha_hasta no puede ser anterior a fecha_desde")
        return self
