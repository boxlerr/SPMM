# backend/dto/PlanificarRequestDTO.py
from datetime import date, datetime
from pydantic import BaseModel, model_validator
from typing import Dict, List, Optional

class AjusteSkillNativaDTO(BaseModel):
    """Prender o apagar a una persona en un proceso, SOLO para este cálculo."""
    operario_id: int
    proceso_id: int
    habilitado: bool = True


class AjustesDelPlanDTO(BaseModel):
    """Cambios que valen SOLO para este cálculo y no se guardan en Recursos.

    Nacen del panel de trabas del planificador (pedido de Julián, 17/09/2026). Ahí
    cada aviso propone una solución, y hasta ahora la única forma de aplicarla era
    escribirla en Recursos: para destrabar UN plan había que cambiarle los datos al
    taller para siempre. Con esto el plan se calcula como si el cambio existiera,
    pero en la base no se toca nada.

    Los diccionarios son el conjunto FINAL de rangos de ese proceso / esa máquina,
    no un agregado: lo que venga acá reemplaza lo que dice la base, no se suma.
    Las claves llegan como texto en el JSON; el `Dict[int, ...]` es lo que las
    convierte a int, que es como se comparan después contra los ids del ORM.
    """
    procesos: Dict[int, List[int]] = {}        # proceso_id -> conjunto FINAL de rangos
    maquinarias: Dict[int, List[int]] = {}     # maquinaria_id -> conjunto FINAL de rangos
    skills_nativas: List[AjusteSkillNativaDTO] = []


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
    # Igual que `procesos_por_orden` pero eligiendo PASADAS puntuales: mapea orden_id
    # -> lista de orden_trabajo_proceso.id. Hace falta desde que el mismo proceso
    # puede ir varias veces en una OT (la 7497 tiene TORNO CNC 13 veces): elegir "el
    # proceso" no dice cuál de las 13. Si viene, manda sobre `procesos_por_orden`.
    lineas_por_orden: Optional[Dict[int, List[int]]] = None
    # Qué borrador se está confirmando. Al confirmar, ese plan deja de ser un
    # borrador y hay que sacarlo de "Planes sin confirmar"; con el id se borra ESA
    # fila y ninguna otra. Opcional a propósito: si no viene (pestaña con el bundle
    # viejo, o un plan que nunca llegó a guardarse) el backend cae al borrado por
    # lote exacto. Ver PlanificacionBorradorRepository.borrar_por_ordenes.
    borrador_id: Optional[int] = None
    # Desde cuándo arranca el plan que se está confirmando (el T=0 del planificador).
    # Lo devuelve la vista previa y la pantalla lo manda de vuelta tal cual, para que
    # las fechas que se guardan sean EXACTAMENTE las que se miraron. Sin esto el
    # backend le volvía a preguntar la hora al reloj: una previa armada a las 06:59 y
    # confirmada a las 07:01 se guardaba con un día de más.
    inicio_base: Optional[datetime] = None
    # Los arreglos que el usuario aplicó "solo para este plan" desde el panel de
    # trabas. Opcional a propósito: una pestaña con el bundle viejo no lo manda y
    # tiene que seguir planificando igual que siempre. Ver AjustesDelPlanDTO.
    ajustes_del_plan: Optional[AjustesDelPlanDTO] = None

    @model_validator(mode="after")
    def _validar_rango(self):
        if self.fecha_desde and self.fecha_hasta and self.fecha_hasta < self.fecha_desde:
            raise ValueError("fecha_hasta no puede ser anterior a fecha_desde")
        return self
