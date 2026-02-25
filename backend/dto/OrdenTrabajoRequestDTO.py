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
    cantidad_entregada: Optional[int] = 0

    # 🔹 Nuevos campos "Pronto"
    n_ped_l: Optional[str] = None
    n_pedido: Optional[str] = None
    subsector: Optional[str] = None
    requerido_por: Optional[str] = None
    aprobado_por: Optional[str] = None
    remitos_salida: Optional[str] = None
    f_disp_material: Optional[datetime] = None
    
    fabricacion: Optional[bool] = False
    reparacion: Optional[bool] = False
    sin_cargo: Optional[bool] = False
    stock: Optional[bool] = False
    interno: Optional[bool] = False
    revisada: Optional[bool] = False
    tercerizado_total: Optional[bool] = False
    tercerizado_parcial: Optional[bool] = False
    suspendida: Optional[bool] = False
    email: Optional[bool] = False
    tiene_plano: Optional[bool] = False
    programada: Optional[bool] = False
    en_proceso: Optional[bool] = False
    
    finalizadototal: Optional[bool] = False
    finalizadoparcial: Optional[bool] = False
    reclamo: Optional[bool] = False

    id_prioridad: int
    id_sector: int
    id_articulo: int
    # 🔻 Eliminado: id_maquinaria

    fecha_orden: datetime
    fecha_entrada: datetime
    fecha_prometida: datetime
    fecha_entrega: Optional[datetime] = None
    
    procesos: List[OrdenTrabajoProcesoCreateDTO] = []



