"""Guardar un plan aprobado NO vuelve a correr el solver.

Julián, 10/09: "hay que arreglar que al guardar no tiene que calcular, al menos que
haya cambios". No hace falta ni siquiera esa excepción: cada decisión que se toma en
la vista previa —forzar una OT, quitarla, agregar o editar procesos— ya dispara su
recálculo en el momento, y al volver a la pantalla se compara la huella de Recursos
y se recalcula sola si cambió algo. Cuando se aprieta Guardar, lo de pantalla es el
plan vigente.

Y no es sólo velocidad: el solver no devuelve siempre el mismo reparto (medido el
10/09 sobre 40 OT), así que recalcular al guardar podía escribir un plan distinto
del que se aprobó, sin que nadie se enterara.

La ÚNICA lectura que se permite al guardar es la de las pausas vigentes (RF-03): una
OT que se pausó después de calcular el plan no entra (test_confirmar_plan_con_pausas).
Acá se reemplaza por una que no encuentra ninguna y anota que se le preguntó.
"""
from datetime import date, datetime, time, timedelta

import pytest

from backend.application import PlanificacionService as ps
from backend.application.PlanificacionService import planificar
from backend.dto.PlanificarRequestDTO import PlanificarRequestDTO


class _PausasNinguna:
    """Las pausas vigentes: ninguna. Anota cuántas veces se le preguntó."""
    consultas = 0

    def __init__(self, db):
        pass

    async def abiertas_sin_romper(self, ids):
        _PausasNinguna.consultas += 1
        return []

    async def pasos_sin_romper(self, ids):
        raise AssertionError("sin pausas no hace falta leer los pasos")


@pytest.fixture(autouse=True)
def _sin_pausas(monkeypatch):
    _PausasNinguna.consultas = 0
    monkeypatch.setattr(ps, "PausaRepository", _PausasNinguna)


class _RepoPlanificacion:
    SIN_LLEGAR = object()

    def __init__(self):
        self.recibido = None
        self.base_recibida = _RepoPlanificacion.SIN_LLEGAR

    async def insertar_planificacion_lote(self, resultados, inicio_base=None):
        self.recibido = resultados
        self.base_recibida = inicio_base
        return {"mensaje": f"Planificación guardada ({len(resultados)} registros)",
                "id_planificacion_lote": "lote-de-prueba",
                "descripcion_lote": "Planificación de prueba"}


class _RepoQueExplota:
    """Cualquier lectura de acá significa que arrancó el camino del solver."""
    def __getattr__(self, nombre):
        async def _boom(*a, **k):
            raise AssertionError(
                f"Guardar un plan aprobado no puede leer {nombre}(): "
                "eso es el solver arrancando de nuevo.")
        return _boom


PLAN = [{
    "orden_id": 1, "proceso_id": 10, "id_orden_trabajo_proceso": 100,
    "id_operario": 5, "id_maquinaria": 3, "sin_maquinaria": False,
    "inicio_min": 0, "fin_min": 60, "duracion_min": 60, "prioridad_peso": 5,
    "fecha_prometida": None, "sin_asignar": False, "nombre_proceso": "TORNO T1",
    "rangos_permitidos_proceso": [], "forzado_fuera_rango": False,
}]


@pytest.mark.asyncio
async def test_guardar_un_plan_aprobado_no_toca_el_solver():
    repo_plan = _RepoPlanificacion()

    salida = await planificar(
        _RepoQueExplota(), _RepoQueExplota(), _RepoQueExplota(), repo_plan,
        db=_RepoQueExplota(), ordenes_ids=[1], preview=False, plan=PLAN,
    )

    # Se guardó EXACTAMENTE lo aprobado, sin agregar ni sacar nada.
    assert repo_plan.recibido == PLAN

    # Y la respuesta tiene la misma forma que el camino del solver: la auditoría lee
    # `planificados` para sacar el id del lote, y con el dict pelado del repositorio
    # los guardados quedaban registrados sin lote.
    assert set(salida) == {"planificados", "excedentes", "diagnosticos"}
    assert salida["planificados"]["id_planificacion_lote"] == "lote-de-prueba"
    assert salida["excedentes"] == [] and salida["diagnosticos"] == []
    # Lo único que se leyó: las pausas, una vez.
    assert _PausasNinguna.consultas == 1


class _RepoQueAnota:
    """Anota qué le piden, sin romper. Para el contraste de abajo."""
    def __init__(self):
        self.leido = []

    def __getattr__(self, nombre):
        if nombre.startswith("_"):
            raise AttributeError(nombre)
        self.leido.append(nombre)
        async def _nada(*a, **k):
            return []
        return _nada


@pytest.mark.asyncio
async def test_sin_plan_si_arranca_el_solver():
    """El contraste. Sin este test, borrar el `if` de arriba dejaría la suite en
    verde: los dos caminos guardarían igual, sólo que uno tardando un minuto."""
    espia = _RepoQueAnota()
    try:
        await planificar(espia, espia, espia, _RepoPlanificacion(),
                         db=espia, ordenes_ids=[1], preview=False, plan=None)
    except Exception:
        pass  # sin datos de verdad no va a terminar; alcanza con que haya ido a buscarlos
    assert espia.leido, "sin plan armado, planificar tiene que ir a leer los datos"


# ---------------------------------------------------------------------------
# El arranque del plan viaja: vista previa -> pantalla -> guardado
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_se_guarda_el_arranque_que_mando_la_pantalla():
    """El plan se guarda con el arranque CON EL QUE SE MIRÓ, no con uno nuevo.

    La vista previa devuelve `inicio_base`, la pantalla lo guarda en el borrador y lo
    manda de vuelta al confirmar. Si ese valor se pierde en el camino, el backend le
    vuelve a preguntar la hora al reloj y las fechas guardadas no son las que se
    aprobaron: una previa armada a las 06:59 y confirmada a las 07:01 se guarda con un
    día de más. Nada lo sostenía: los 373 tests seguían verdes aunque el valor se
    perdiera.
    """
    repo_plan = _RepoPlanificacion()
    # Un día de esta semana a las 06:59, que es el caso que importa: si el backend
    # recalculara, a las 07:01 daría el día siguiente.
    arranque = datetime.combine(date.today(), time(6, 59))

    await planificar(
        _RepoQueExplota(), _RepoQueExplota(), _RepoQueExplota(), repo_plan,
        db=_RepoQueExplota(), ordenes_ids=[1], preview=False, plan=PLAN,
        inicio_base=arranque,
    )

    assert repo_plan.base_recibida == arranque, (
        "el arranque que mandó la pantalla no llegó al guardado")


@pytest.mark.asyncio
async def test_un_arranque_viejo_no_se_guarda_tal_cual():
    """EL PLAN NUNCA EMPIEZA EN EL PASADO, tampoco si el arranque llega de afuera.

    Un borrador de hace tres días, una pestaña vieja o un request armado a mano traen
    un arranque viejo. Guardarlo tal cual deja un plan que arranca el martes pasado, que
    es exactamente lo que se arregló el 11/9.
    """
    repo_plan = _RepoPlanificacion()
    viejo = datetime.combine(date.today() - timedelta(days=3), time(7, 0))

    await planificar(
        _RepoQueExplota(), _RepoQueExplota(), _RepoQueExplota(), repo_plan,
        db=_RepoQueExplota(), ordenes_ids=[1], preview=False, plan=PLAN,
        inicio_base=viejo,
    )

    assert repo_plan.base_recibida != viejo, "se guardó un plan que arranca en el pasado"
    assert repo_plan.base_recibida.date() >= date.today()


def test_la_ruta_acepta_el_arranque():
    """El campo tiene que existir en el DTO: si no, nunca llega al servicio."""
    dto = PlanificarRequestDTO(plan=[], inicio_base="2026-09-17T07:00:00")
    assert dto.inicio_base == datetime(2026, 9, 17, 7, 0)
