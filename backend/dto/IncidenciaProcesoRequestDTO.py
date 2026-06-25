from typing import Optional
from pydantic import BaseModel


class IncidenciaProcesoRequestDTO(BaseModel):
    """DTO para registrar una incidencia (ej. interpretación de planos)."""
    id_orden_trabajo: int
    id_proceso: Optional[int] = None
    id_operario: Optional[int] = None
    tipo: Optional[str] = "INTERPRETACION_PLANOS"
    minutos_perdidos: Optional[int] = 0
    operarios_extra: Optional[int] = 0
    descripcion: Optional[str] = None
