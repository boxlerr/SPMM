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

    # 🔹 Nuevos campos "Pronto"
    n_ped_l: Optional[str] = None
    n_pedido: Optional[str] = None
    subsector: Optional[str] = None
    requerido_por: Optional[str] = None
    aprobado_por: Optional[str] = None
    remitos_salida: Optional[str] = None
    f_disp_material: Optional[datetime] = None
    
    fabricacion: Optional[bool] = None
    reparacion: Optional[bool] = None
    sin_cargo: Optional[bool] = None
    stock: Optional[bool] = None
    interno: Optional[bool] = None
    revisada: Optional[bool] = None
    tercerizado_total: Optional[bool] = None
    tercerizado_parcial: Optional[bool] = None
    suspendida: Optional[bool] = None
    email: Optional[bool] = None
    tiene_plano: Optional[bool] = None
    programada: Optional[bool] = None
    en_proceso: Optional[bool] = None
    
    finalizadototal: Optional[bool] = None
    finalizadoparcial: Optional[bool] = None
    reclamo: Optional[bool] = None

    id_prioridad: Optional[int] = None
    id_sector: Optional[int] = None
    id_articulo: Optional[int] = None
    
    fecha_orden: Optional[datetime] = None
    fecha_entrada: Optional[datetime] = None
    fecha_prometida: Optional[datetime] = None
    fecha_entrega: Optional[datetime] = None
    
    procesos: Optional[List[OrdenTrabajoProcesoCreateDTO]] = None
