from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoProcesoCreateDTO

class OrdenTrabajoUpdateDTO(BaseModel):
    id_otvieja: Optional[int] = None
    observaciones: Optional[str] = None
    detalle: Optional[str] = None
    cliente: Optional[str] = None
    id_cliente: Optional[int] = None
    unidades: Optional[int] = None
    cantidad_entregada: Optional[int] = None

    id_prioridad: Optional[int] = None
    id_sector: Optional[int] = None
    id_articulo: Optional[int] = None
    
    fecha_orden: Optional[datetime] = None
    fecha_entrada: Optional[datetime] = None
    fecha_prometida: Optional[datetime] = None
    fecha_entrega: Optional[datetime] = None
    
    procesos: Optional[List[OrdenTrabajoProcesoCreateDTO]] = None
