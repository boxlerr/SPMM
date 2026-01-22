from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import List, Optional

class PrioridadDTO(BaseModel):
    id: Optional[int] = None
    descripcion: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class SectorDTO(BaseModel):
    id: Optional[int] = None
    nombre: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class ClienteDTO(BaseModel):
    id: Optional[int] = None
    nombre: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class ArticuloDTO(BaseModel):
    id: Optional[int] = None
    cod_articulo: Optional[str] = None
    descripcion: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class ProcesoDTO(BaseModel):
    id: Optional[int] = None
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class EstadoProcesoDTO(BaseModel):
    id: Optional[int] = None
    descripcion: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class OrdenTrabajoProcesoDTO(BaseModel):
    # Flattened or selected fields to avoid circular recursion to OrdenTrabajo
    orden: Optional[int] = None # Assuming 'orden' means execution order, not the work order ID
    tiempo_proceso: Optional[int] = None
    observaciones: Optional[str] = None
    
    # Nested objects
    proceso: Optional[ProcesoDTO] = None
    estado_proceso: Optional[EstadoProcesoDTO] = None
    operario_nombre: Optional[str] = None
    inicio_real: Optional[datetime] = None
    fin_real: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)

class OrdenTrabajoResponseDTO(BaseModel):
    id: int
    id_otvieja: Optional[int] = None
    observaciones: Optional[str] = None
    id_prioridad: Optional[int] = None
    id_sector: Optional[int] = None
    id_cliente: Optional[int] = None
    id_articulo: Optional[int] = None
    unidades: Optional[int] = None
    cantidad_entregada: Optional[int] = 0
    reclamo: Optional[int] = 0
    estado_material: Optional[str] = 'sin_datos'  # 'ok', 'pedido', 'sin_stock', 'sin_datos'
    
    fecha_orden: Optional[datetime] = None
    fecha_entrada: Optional[datetime] = None
    fecha_prometida: Optional[datetime] = None
    fecha_entrega: Optional[datetime] = None
    
    # Relations
    prioridad: Optional[PrioridadDTO] = None
    prioridad: Optional[PrioridadDTO] = None
    sector: Optional[SectorDTO] = None
    cliente: Optional[ClienteDTO] = None
    articulo: Optional[ArticuloDTO] = None
    
    # List of processes
    procesos: List[OrdenTrabajoProcesoDTO] = []

    model_config = ConfigDict(from_attributes=True)
