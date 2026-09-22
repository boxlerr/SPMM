from typing import Optional
from pydantic import BaseModel


class IncidenciaProcesoRequestDTO(BaseModel):
    """DTO para registrar una no conformidad contra una orden (RF-12)."""
    id_orden_trabajo: int
    id_proceso: Optional[int] = None
    id_operario: Optional[int] = None
    # El default se mantiene a propósito. El frontend se deploya solo al pushear y el
    # backend a mano, así que una versión vieja del front le va a pegar a este backend:
    # exigir `tipo` haría que el modal que hoy anda conteste 422. Los que mandan tipo
    # (todos los de hoy) mandan uno de TIPOS, y el servicio lo valida.
    tipo: Optional[str] = "INTERPRETACION_PLANOS"
    minutos_perdidos: Optional[int] = 0
    operarios_extra: Optional[int] = 0
    descripcion: Optional[str] = None
    # Lo que suma la no conformidad. `gravedad` y `piezas_afectadas` quedan en None si
    # quien carga no los completó: eso se guarda como «sin clasificar» y no como un
    # valor medio inventado.
    gravedad: Optional[str] = None
    piezas_afectadas: Optional[int] = None


class IncidenciaProcesoUpdateDTO(BaseModel):
    """Corregir una no conformidad ya cargada, o cerrarla.

    Todos los campos son opcionales y sólo se tocan los que VIENEN en el cuerpo: mandar
    `{"gravedad": "GRAVE"}` no puede borrar la descripción. Eso se resuelve con
    `model_dump(exclude_unset=True)` en el servicio, no con None como «no cambiar»,
    porque para `accion_correctiva` y `gravedad` None es un valor válido (vaciarlas).
    """
    tipo: Optional[str] = None
    gravedad: Optional[str] = None
    estado: Optional[str] = None
    piezas_afectadas: Optional[int] = None
    accion_correctiva: Optional[str] = None
    descripcion: Optional[str] = None
    minutos_perdidos: Optional[int] = None
    operarios_extra: Optional[int] = None
    id_proceso: Optional[int] = None
    id_operario: Optional[int] = None


class CerrarIncidenciaDTO(BaseModel):
    """Cerrar una no conformidad: qué se hizo para resolverla.

    Va aparte del update porque cerrar no es editar un campo: estampa la fecha de
    cierre y es lo que saca la fila del reporte de abiertas.
    """
    accion_correctiva: Optional[str] = None
