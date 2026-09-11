"""La persona preseleccionada en un proceso no se puede perder al guardar la OT.

Elegir una persona en un proceso es una decisión del taller: fuerza a que ese paso lo
haga ella, aunque el rango no la habilite (acuerdo con Lucas del 26/08 — "si yo le
indico, lo tiene que hacer").

El DTO de respuesta no declaraba `id_operario`, así que el modal recibía la fila sin
ese campo, lo mostraba como "Sin asignar" y al guardar mandaba `operario_id: null`.
Como el repositorio pisa el valor cuando la clave viene, abrir una OT y apretar
Guardar —sin tocar nada— le borraba la persona forzada a todos sus procesos.
"""
from backend.dto.OrdenTrabajoResponseDTO import OrdenTrabajoProcesoDTO


class _FilaDeLaBase:
    """Lo que devuelve el ORM para una pasada con persona y máquina forzadas."""
    id = 100
    orden = 1
    tiempo_proceso = 60
    cant_operarios = 1
    id_maquinaria = 7
    id_operario = 5
    observaciones = None
    proceso = None
    estado_proceso = None
    operario_nombre = None
    inicio_real = None
    fin_real = None


def test_la_persona_preseleccionada_viaja_al_frontend():
    dto = OrdenTrabajoProcesoDTO.model_validate(_FilaDeLaBase())
    assert dto.id_operario == 5, (
        "sin este campo el modal la lee como 'Sin asignar' y el próximo guardado la borra"
    )
    # La máquina ya viajaba; se controla también para que no se caiga de la misma forma.
    assert dto.id_maquinaria == 7
    assert dto.id == 100, "el id de la PASADA es lo que ata la fila al guardar"


def test_sin_preseleccion_queda_en_none_y_no_en_cero():
    """None significa 'que decida el planificador'. Un 0 sería un id de operario."""
    class SinNada(_FilaDeLaBase):
        id_operario = None
        id_maquinaria = None
    dto = OrdenTrabajoProcesoDTO.model_validate(SinNada())
    assert dto.id_operario is None and dto.id_maquinaria is None
