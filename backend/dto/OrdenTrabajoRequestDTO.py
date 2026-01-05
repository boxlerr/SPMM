from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

class OrdenTrabajoProcesoCreateDTO(BaseModel):
    proceso_id: int
    operario_id: Optional[str] = None 
    maquinaria_id: Optional[str] = None
    tiempo_proceso: int # Nuevo campo en minutos
    # fecha_inicio y fecha_fin ya no se envian desde el create modal

class OrdenTrabajoRequestDTO(BaseModel):
    id_otvieja: int # Este es el numero visible
    observaciones: Optional[str] = None
    detalle: Optional[str] = None # 🔹 Nuevo campo detalle
    cliente: Optional[str] = None # Campo visual, no se guarda en BD por ahora
    id_cliente: Optional[int] = None # 🔹 Nuevo campo para asociar cliente real
    unidades: Optional[int] = None
    unidades: Optional[int] = None

    id_prioridad: int
    id_sector: int
    id_articulo: int
    # 🔻 Eliminado: id_maquinaria

    fecha_orden: datetime
    fecha_entrada: datetime
    fecha_prometida: datetime
    fecha_entrega: Optional[datetime] = None
    
    procesos: List[OrdenTrabajoProcesoCreateDTO] = []



