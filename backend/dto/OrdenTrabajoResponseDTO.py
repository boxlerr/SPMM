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
    # id de la PASADA (orden_trabajo_proceso.id). Es lo que hay que mandar para tocar
    # una línea puntual: el mismo proceso puede estar varias veces en la OT, así que
    # (orden, proceso) ya no la identifica.
    id: Optional[int] = None
    orden: Optional[int] = None # Assuming 'orden' means execution order, not the work order ID
    tiempo_proceso: Optional[int] = None
    cant_operarios: Optional[int] = None  # Operarios que requiere el proceso en simultáneo
    # Máquina preseleccionada (NULL = el planificador elige). El frontend resuelve
    # el nombre desde la lista de maquinarias que ya trae, así evitamos lazy-load async.
    id_maquinaria: Optional[int] = None
    # Persona PRESELECCIONADA (NULL = el planificador elige).
    #
    # FALTABA, y la ausencia borraba datos en silencio: el modal leía la fila sin este
    # campo, lo tomaba como "sin asignar" y al guardar mandaba `operario_id: null`.
    # Como `update_processes_full` pisa el valor cuando la clave viene, cada guardado
    # de una OT le borraba la persona forzada a todos sus procesos — justo el dato que
    # alguien se tomó el trabajo de poner a mano para que el planificador lo respete.
    id_operario: Optional[int] = None
    # "Va a mano". Tiene que viajar o la pantalla lo muestra como «Sin recurso
    # maquinaria» —que es otra cosa— y al guardar se pierde la marca.
    no_lleva_maquina: Optional[int] = None
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
    detalle: Optional[str] = None
    id_prioridad: Optional[int] = None
    id_sector: Optional[int] = None
    id_cliente: Optional[int] = None
    id_articulo: Optional[int] = None
    unidades: Optional[int] = None
    cantidad_entregada: Optional[int] = 0
    reclamo: Optional[int] = 0
    # 'ok', 'pedido', 'sin_stock' (= falta pedir), 'sin_datos' o 'no_lleva'. Lo calcula
    # application/materia_prima/estado.py.
    estado_material: Optional[str] = 'sin_datos'
    
    # 🔹 Nuevos campos "Pronto"
    n_ped_l: Optional[str] = None
    n_pedido: Optional[str] = None
    subsector: Optional[str] = None
    requerido_por: Optional[str] = None
    aprobado_por: Optional[str] = None
    remitos_salida: Optional[str] = None
    f_disp_material: Optional[datetime] = None
    
    fabricacion: Optional[int] = 0
    reparacion: Optional[int] = 0
    sin_cargo: Optional[int] = 0
    stock: Optional[int] = 0
    interno: Optional[int] = 0
    revisada: Optional[int] = 0
    tercerizado_total: Optional[int] = 0
    tercerizado_parcial: Optional[int] = 0
    suspendida: Optional[int] = 0
    email: Optional[int] = 0
    tiene_plano: Optional[int] = 0
    no_lleva_plano: Optional[int] = 0
    no_lleva_materia_prima: Optional[int] = 0
    programada: Optional[int] = 0
    en_proceso: Optional[int] = 0
    
    finalizadototal: Optional[int] = 0
    finalizadoparcial: Optional[int] = 0

    # RF-11: «Estado y control». `controlado_por` / `controlado_en` en None con
    # controlado=1 = no se registró quién la marcó (nunca un autor inventado).
    controlado: Optional[int] = 0
    finalizado_para_pintar: Optional[int] = 0
    finalizado_tercerizacion_intermedia: Optional[int] = 0
    finalizado_tercerizacion_final: Optional[int] = 0
    cantidad_finalizada_parcial: Optional[int] = None
    controlado_en: Optional[datetime] = None
    controlado_por: Optional[str] = None

    fecha_orden: Optional[datetime] = None
    fecha_entrada: Optional[datetime] = None
    fecha_prometida: Optional[datetime] = None
    fecha_entrega: Optional[datetime] = None

    # Último rastro de edición. Los dos en None significan "nunca se tocó desde SPMM"
    # (las OT que trajo el sistema viejo), no "no se sabe". Y `modificado_por` en None
    # con `modificado_en` escrito significa que el cambio entró por una puerta que no
    # pudo identificar al usuario: antes que inventar un autor, se manda vacío.
    modificado_en: Optional[datetime] = None
    modificado_por: Optional[str] = None
    
    # Relations
    prioridad: Optional[PrioridadDTO] = None
    prioridad: Optional[PrioridadDTO] = None
    sector: Optional[SectorDTO] = None
    cliente: Optional[ClienteDTO] = None
    articulo: Optional[ArticuloDTO] = None
    
    # List of processes
    procesos: List[OrdenTrabajoProcesoDTO] = []

    model_config = ConfigDict(from_attributes=True)
