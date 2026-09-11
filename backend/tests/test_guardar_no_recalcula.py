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
"""
import pytest

from backend.application.PlanificacionService import planificar


class _RepoPlanificacion:
    def __init__(self):
        self.recibido = None

    async def insertar_planificacion_lote(self, resultados):
        self.recibido = resultados
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
