"""RF-03 al CONFIRMAR: lo que se pausó después de calcular el plan no entra.

El caso: se calcula la vista previa (o se retoma un borrador de ayer), alguien pausa una
de sus OT desde Operaciones y después se aprieta Confirmar. El guardado copia las filas
que se aprobaron en pantalla, sin volver a pasar por el solver
(test_guardar_no_recalcula), así que hasta ahora la OT pausada entraba al plan
confirmado igual, sin que nadie se enterara. Es justo lo que la pausa pidió que no pase.

Lo que se fija acá:
  1. La OT pausada no se guarda; las demás sí, tal cual se aprobaron.
  2. Un paso pausado no se guarda, ni los que van después en la OT; los de antes sí. El
     orden es el de TODOS los pasos de la OT, no sólo los que traía el plan.
  3. Sale el mismo aviso que al calcular, en la respuesta del guardado.
  4. Si todo quedó pausado, no se escribe un lote vacío.
  5. Si no se pueden leer las pausas, se guarda todo, como antes de RF-03.
  6. De punta a punta contra la base (SQLite): pausar con el servicio de verdad y
     confirmar.
"""
from datetime import date, datetime

import pytest

from backend.application import PlanificacionService as ps
from backend.application.PausaService import PausaService
from backend.domain.PausaOrden import PausaOrden
from backend.tests.test_pausas_ot import LUCAS, NUMERO, OT, PINTURA, SOLDADURA, TORNO, taller  # noqa: F401

DESDE = datetime(2026, 9, 22, 10, 30)


def _pausa(id_orden, id_otp=None, paso=None, motivo="FALTA_MATERIAL"):
    return PausaOrden(id=1, id_orden_trabajo=id_orden, id_otp=id_otp, paso=paso,
                      nombre_proceso="SOLDADURA" if id_otp else None, motivo=motivo,
                      desde=DESDE, usuario_pausa="Lucas Gómez")


def _fila(orden_id, id_otp, minutos=60, proceso_id=150):
    return {"orden_id": orden_id, "proceso_id": proceso_id, "id_orden_trabajo_proceso": id_otp,
            "id_operario": 5, "id_maquinaria": 3, "sin_maquinaria": False, "inicio_min": 0,
            "fin_min": minutos, "duracion_min": minutos, "prioridad_peso": 5,
            "fecha_prometida": None, "sin_asignar": False, "nombre_proceso": "X",
            "rangos_permitidos_proceso": [], "forzado_fuera_rango": False}


class _Pausas:
    """PausaRepository de mentira: las pausas y los pasos que se le digan."""
    abiertas: list | None = []
    pasos: dict | None = {}
    pidieron_pasos = 0

    def __init__(self, db):
        pass

    async def abiertas_sin_romper(self, ids):
        if _Pausas.abiertas is None:
            return None
        return [(p, nro) for p, nro in _Pausas.abiertas if p.id_orden_trabajo in ids]

    async def pasos_sin_romper(self, ids):
        _Pausas.pidieron_pasos += 1
        if _Pausas.pasos is None:
            return None
        return {i: _Pausas.pasos[i] for i in ids if i in _Pausas.pasos}


class _RepoPlan:
    def __init__(self):
        self.recibido = None

    async def insertar_planificacion_lote(self, plan, inicio_base=None):
        self.recibido = plan
        return {"id_planificacion_lote": "lote", "mensaje": "ok"}


class _NoLeer:
    def __getattr__(self, nombre):
        async def _boom(*a, **k):
            raise AssertionError(f"guardar no puede leer {nombre}()")
        return _boom


@pytest.fixture(autouse=True)
def _repo_de_pausas(monkeypatch):
    _Pausas.abiertas, _Pausas.pasos, _Pausas.pidieron_pasos = [], {}, 0
    monkeypatch.setattr(ps, "PausaRepository", _Pausas)


async def _confirmar(plan, repo_plan=None, db=None):
    repo_plan = repo_plan or _RepoPlan()
    salida = await ps.planificar(_NoLeer(), _NoLeer(), _NoLeer(), repo_plan,
                                 db=db if db is not None else _NoLeer(),
                                 ordenes_ids=sorted({f["orden_id"] for f in plan}),
                                 preview=False, plan=plan)
    return salida, repo_plan


# ─────────────────────── 1. la OT pausada ───────────────────────

async def test_la_ot_que_se_pauso_despues_de_calcular_no_se_guarda():
    _Pausas.abiertas = [(_pausa(10), 15279)]
    plan = [_fila(10, 101), _fila(10, 102), _fila(11, 201)]
    salida, repo = await _confirmar(plan)

    assert [f["orden_id"] for f in repo.recibido] == [11], "entró la OT pausada"
    # Lo que queda va tal cual se aprobó (el mismo dict, sin tocar).
    assert repo.recibido[0] is plan[2]
    (aviso,) = salida["diagnosticos"]
    assert aviso["tipo"] == "ot_pausada"
    assert aviso["titulo"] == "OT 15279: pausada por falta de material desde el 22/09 10:30"
    assert aviso["impacto"]["procesos"] == 2 and aviso["impacto"]["minutos"] == 120
    # Con la OT entera pausada no hace falta el orden de sus pasos.
    assert _Pausas.pidieron_pasos == 0


# ─────────────────────── 2. el paso pausado ───────────────────────

async def test_el_paso_pausado_y_los_que_van_despues_no_se_guardan():
    # Pasos de la OT 10: 101 (1), 102 (2, pausado), 103 (3). El 103 viene en dos tramos.
    _Pausas.abiertas = [(_pausa(10, id_otp=102, paso=2), 15279)]
    _Pausas.pasos = {10: [(1, 101, 3), (2, 102, 2), (3, 103, 1)]}
    plan = [_fila(10, 101), _fila(10, 102, 30), _fila(10, 103, 45), _fila(10, 103, 15), _fila(11, 201)]
    salida, repo = await _confirmar(plan)

    assert [(f["orden_id"], f["id_orden_trabajo_proceso"]) for f in repo.recibido] == [(10, 101), (11, 201)]
    (aviso,) = salida["diagnosticos"]
    assert aviso["titulo"].startswith("Soldadura de la OT 15279: pausado por falta de material")
    # Dos pasos afuera (el 103 son dos filas del mismo paso), uno después del pausado.
    assert aviso["impacto"]["procesos"] == 2 and aviso["impacto"]["minutos"] == 90
    assert "Tampoco entra el paso que va después" in aviso["detalle"]


async def test_el_corte_mira_todos_los_pasos_de_la_ot_y_no_solo_los_del_plan():
    """El plan trae sólo el 103; el pausado es el 102, que va antes: el 103 no entra."""
    _Pausas.abiertas = [(_pausa(10, id_otp=102, paso=2), 15279)]
    _Pausas.pasos = {10: [(1, 101, 1), (2, 102, 1), (3, 103, 1)]}
    salida, repo = await _confirmar([_fila(10, 103), _fila(11, 201)])
    assert [f["orden_id"] for f in repo.recibido] == [11]
    assert len(salida["diagnosticos"]) == 1


async def test_un_paso_pausado_que_ya_se_termino_no_corta_nada():
    _Pausas.abiertas = [(_pausa(10, id_otp=102, paso=2), 15279)]
    _Pausas.pasos = {10: [(1, 101, 3), (2, 102, 3), (3, 103, 1)]}
    plan = [_fila(10, 103)]
    salida, repo = await _confirmar(plan)
    assert repo.recibido == plan and salida["diagnosticos"] == []


async def test_una_fila_que_no_dice_su_paso_no_se_programa_si_la_ot_tiene_un_paso_pausado():
    _Pausas.abiertas = [(_pausa(10, id_otp=102, paso=2), 15279)]
    _Pausas.pasos = {10: [(1, 101, 1), (2, 102, 1)]}
    salida, repo = await _confirmar([_fila(10, 101), _fila(10, None)])
    assert [f["id_orden_trabajo_proceso"] for f in repo.recibido] == [101]


async def test_sin_poder_leer_los_pasos_la_ot_con_un_paso_pausado_no_entra():
    """No se sabe qué va después del pausado: lo seguro es no programar nada de esa OT."""
    _Pausas.abiertas = [(_pausa(10, id_otp=102, paso=2), 15279)]
    _Pausas.pasos = None
    salida, repo = await _confirmar([_fila(10, 101), _fila(11, 201)])
    assert [f["orden_id"] for f in repo.recibido] == [11]
    assert len(salida["diagnosticos"]) == 1


# ─────────────────────── 4 y 5. todo pausado / sin pausas ───────────────────────

async def test_si_todo_quedo_pausado_no_se_escribe_un_lote_vacio():
    _Pausas.abiertas = [(_pausa(10), 15279)]
    salida, repo = await _confirmar([_fila(10, 101)])
    assert repo.recibido is None, "se escribió un plan confirmado sin nada adentro"
    assert salida["planificados"]["id_planificacion_lote"] is None
    assert salida["planificados"]["registros"] == 0
    assert salida["diagnosticos"][0]["tipo"] == "ot_pausada"


async def test_sin_poder_leer_las_pausas_se_guarda_todo_como_antes():
    _Pausas.abiertas = None
    plan = [_fila(10, 101), _fila(11, 201)]
    salida, repo = await _confirmar(plan)
    assert repo.recibido == plan and salida["diagnosticos"] == []


# ─────────────────────── 6. de punta a punta ───────────────────────

async def test_pausar_despues_de_la_vista_previa_y_confirmar(taller, monkeypatch):
    """Con la base de verdad (SQLite) y el PausaRepository de verdad: se pausa la
    soldadura de la OT 15279 con el servicio y se confirma un plan que la traía."""
    from backend.infrastructure.PausaRepository import PausaRepository
    monkeypatch.setattr(ps, "PausaRepository", PausaRepository)

    plan = [_fila(OT, TORNO), _fila(OT, SOLDADURA), _fila(OT, PINTURA)]
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=SOLDADURA, usuario=LUCAS)

    salida, repo = await _confirmar(plan, db=taller)
    assert [f["id_orden_trabajo_proceso"] for f in repo.recibido] == [TORNO]
    (aviso,) = salida["diagnosticos"]
    assert f"OT {NUMERO}" in aviso["titulo"] and "máquina rota" in aviso["titulo"]

    # Reanudada, vuelve a entrar entera.
    await PausaService(taller).reanudar(OT, id_otp=SOLDADURA, usuario=LUCAS)
    salida, repo = await _confirmar(plan, db=taller)
    assert repo.recibido == plan and salida["diagnosticos"] == []
