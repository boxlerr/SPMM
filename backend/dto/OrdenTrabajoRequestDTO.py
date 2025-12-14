from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

class OrdenTrabajoProcesoCreateDTO(BaseModel):
    proceso_id: int
    operario_id: Optional[str] = None # Puede venir "none" o ID
    maquinaria_id: Optional[str] = None # Puede venir "none" o ID
    fecha_inicio: datetime
    fecha_fin: datetime

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



