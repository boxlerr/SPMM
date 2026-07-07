# backend/dto/PlanificarRequestDTO.py
from datetime import date
from pydantic import BaseModel, model_validator
from typing import Dict, List, Optional

class PlanificarRequestDTO(BaseModel):
    ordenes_ids: Optional[List[int]] = None
    preview: Optional[bool] = False
    plan: Optional[List[dict]] = None
    fecha_desde: Optional[date] = None
    fecha_hasta: Optional[date] = None
    # Órdenes que el usuario decide forzar dentro del horizonte aunque no entren (paso 7)
    forzar_ordenes_ids: Optional[List[int]] = None
    # D1 (feedback 06/07): agregar procesos SUELTOS al plan. Mapea orden_id ->
    # lista de proceso_ids a planificar de esa OT. Si una OT NO está en el dict,
    # se planifican TODOS sus procesos (comportamiento actual). Sirve para el
    # replan donde solo falta un proceso de una orden.
    procesos_por_orden: Optional[Dict[int, List[int]]] = None

    @model_validator(mode="after")
    def _validar_rango(self):
        if self.fecha_desde and self.fecha_hasta and self.fecha_hasta < self.fecha_desde:
            raise ValueError("fecha_hasta no puede ser anterior a fecha_desde")
        return self
