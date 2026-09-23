"""RF-03 en el planificador: lo pausado no se programa, y se avisa.

Pedido: «que el planificador no la programe mientras esté pausada», y que salga como
aviso con el formato de siempre: «OT pausada — motivo — desde tal fecha».

Lo que se fija acá:
  1. Una OT pausada no le llega al solver, ninguna de sus pasadas.
  2. Un paso pausado no entra, ni los que van después (van en secuencia); los de antes sí.
  3. El aviso sale con la forma de todos («Sujeto: qué le pasa»), en Media, y cuenta sólo
     el trabajo que quedó afuera de verdad (lo terminado no es trabajo).
  4. Si no se pueden leer las pausas (migración sin correr) el plan sale con todo, como
     antes: mejor un plan con una OT pausada adentro que ningún plan.
  5. Si el diagnóstico de trabas falla, el aviso de lo pausado sale igual.
"""
from datetime import date, datetime
from types import SimpleNamespace

import pytest

from backend.application import PlanificacionService as ps
from backend.application.DiagnosticoPlanificacion import (
    ADVERTENCIA,
    BLOQUEANTE,
    diagnosticos_de_pausas,
    ordenar_diagnosticos,
)
from backend.domain.PausaOrden import PausaOrden

DESDE = datetime(2026, 9, 22, 10, 30)


def _paso(id_, orden, estado=1, minutos=60, nombre="TORNO CNC", id_proceso=None):
    return SimpleNamespace(
        id=id_, orden=orden, id_estado=estado, tiempo_proceso=minutos, cant_operarios=1,
        id_maquinaria=None, id_operario=None, no_lleva_maquina=0, id_proceso=id_proceso or id_,
        proceso=SimpleNamespace(id=id_proceso or id_, nombre=nombre, rangos=[]),
    )


def _ot(id_, numero, pasos):
    return SimpleNamespace(
        id=id_, id_otvieja=numero, procesos=pasos, fecha_prometida=datetime(2026, 10, 1),
        prioridad=SimpleNamespace(descripcion="Normal"),
    )


def _pausa(id_orden, id_otp=None, motivo="FALTA_MATERIAL", paso=None, nombre=None,
           observacion=None, quien="Lucas Gómez"):
    return PausaOrden(id=1, id_orden_trabajo=id_orden, id_otp=id_otp, paso=paso,
                      nombre_proceso=nombre, motivo=motivo, observacion=observacion,
                      desde=DESDE, usuario_pausa=quien)


# ─────────────────────── qué queda afuera ───────────────────────

def test_sin_pausas_entra_todo():
    pasos = [_paso(1, 1), _paso(2, 2)]
    entran, saltado = ps._sacar_lo_pausado(_ot(10, 15279, pasos), pasos, None, {})
    assert entran == pasos and saltado is None


def test_la_ot_pausada_no_entra_entera_y_cuenta_solo_lo_que_falta():
    pasos = [_paso(1, 1, estado=3, minutos=500), _paso(2, 2, minutos=60), _paso(3, 3, minutos=30)]
    entran, saltado = ps._sacar_lo_pausado(_ot(10, 15279, pasos), pasos, _pausa(10), {})
    assert entran == []
    assert saltado["alcance"] == "ot" and saltado["numero"] == 15279
    # La pasada terminada no es trabajo que se pierda del plan.
    assert (saltado["procesos"], saltado["minutos"]) == (2, 90)


def test_el_paso_pausado_se_lleva_los_que_van_despues_y_deja_los_de_antes():
    pasos = [_paso(1, 1), _paso(2, 2), _paso(3, 3), _paso(4, 4)]
    pausa = _pausa(10, id_otp=2, paso=2, nombre="TORNO CNC")
    entran, saltado = ps._sacar_lo_pausado(_ot(10, 15279, pasos), pasos, None, {2: pausa})
    assert [p.id for p in entran] == [1]
    assert saltado["alcance"] == "paso" and saltado["pausa"] is pausa
    assert saltado["procesos"] == 3 and saltado["despues"] == 2


def test_el_corte_se_mira_sobre_toda_la_ot_y_no_solo_lo_elegido():
    """Se eligió planificar el 3 y el 4, y el 2 está pausado: el 3 tampoco se puede hacer."""
    todos = [_paso(1, 1), _paso(2, 2), _paso(3, 3), _paso(4, 4)]
    elegidos = todos[2:]
    entran, saltado = ps._sacar_lo_pausado(
        _ot(10, 15279, todos), elegidos, None, {2: _pausa(10, id_otp=2, paso=2)})
    assert entran == []
    assert saltado["procesos"] == 2


def test_los_pasos_con_el_mismo_numero_se_ordenan_como_en_el_solver():
    """531 filas comparten paso con otra de la misma OT: desempata el id, como en
    _lineas_ordenadas. La del id menor va antes."""
    a, b = _paso(7, 2), _paso(8, 2)
    pasos = [_paso(1, 1), b, a]
    entran, _ = ps._sacar_lo_pausado(_ot(10, 1, pasos), pasos, None, {8: _pausa(10, id_otp=8)})
    assert sorted(p.id for p in entran) == [1, 7]


def test_una_pausa_de_otra_ot_no_toca_esta():
    pasos = [_paso(1, 1)]
    por_ot, por_paso = ps._indexar_pausas([(_pausa(99), 5000), (_pausa(99, id_otp=77), 5000)])
    entran, saltado = ps._sacar_lo_pausado(_ot(10, 1, pasos), pasos, por_ot.get(10), por_paso)
    assert entran == pasos and saltado is None


def test_sin_poder_leer_las_pausas_no_se_saltea_nada():
    assert ps._indexar_pausas(None) == ({}, {})


# ─────────────────────── el aviso ───────────────────────

def test_el_aviso_de_la_ot_pausada_dice_motivo_y_desde_cuando():
    (d,) = diagnosticos_de_pausas([{
        "orden_id": 10, "numero": 15279, "pausa": _pausa(10), "alcance": "ot",
        "procesos": 2, "minutos": 90, "despues": 0,
    }])
    assert d["titulo"] == "OT 15279: pausada por falta de material desde el 22/09 10:30"
    assert d["severidad"] == ADVERTENCIA
    assert (d["recurso"], d["subtipo"], d["tipo"]) == ("orden", "pausa", "ot_pausada")
    assert d["tiene"] == "Falta material"
    assert d["resumen"] == "No entra en el plan hasta que la reanuden."
    assert "**Lucas Gómez**" in d["detalle"]
    assert d["impacto"] == {"procesos": 2, "ots": [10], "minutos": 90,
                            "resumen": "2 procesos · 1 OT · 1h 30m"}
    assert d["soluciones"] and d["soluciones"][0].get("accion") is None


def test_el_aviso_del_paso_pausado_nombra_el_proceso_y_lo_que_arrastra():
    (d,) = diagnosticos_de_pausas([{
        "orden_id": 10, "numero": 15279, "alcance": "paso", "procesos": 3, "minutos": 180,
        "despues": 2,
        "pausa": _pausa(10, id_otp=2, paso=2, nombre="TORNO CNC", motivo="MAQUINA_ROTA"),
    }])
    assert d["titulo"] == "Torno CNC de la OT 15279: pausado por máquina rota desde el 22/09 10:30"
    assert "Tampoco entran los 2 pasos que van después" in d["detalle"]
    assert "ni lo que va después" in d["resumen"]


def test_con_otro_el_motivo_es_lo_que_escribieron():
    (d,) = diagnosticos_de_pausas([{
        "orden_id": 10, "numero": 15279, "alcance": "ot", "procesos": 1, "minutos": 60,
        "pausa": _pausa(10, motivo="OTRO", observacion="se cortó la luz"),
    }])
    assert d["titulo"] == "OT 15279: pausada por otro motivo desde el 22/09 10:30"
    assert d["tiene"] == "se cortó la luz"


def test_los_avisos_de_pausa_van_despues_de_los_de_alta():
    alta = {"id": "x", "severidad": BLOQUEANTE, "impacto": {"minutos": 10}}
    media_grande = {"id": "ot-pausada-1", "severidad": ADVERTENCIA, "impacto": {"minutos": 900}}
    media_chica = {"id": "a", "severidad": ADVERTENCIA, "impacto": {"minutos": 5}}
    assert [d["id"] for d in ordenar_diagnosticos([media_chica, media_grande, alta])] == [
        "x", "ot-pausada-1", "a"]


# ─────────────────────── de punta a punta, con el solver de mentira ───────────────────────

class _Repo:
    def __init__(self, **respuestas):
        self._r = respuestas

    def __getattr__(self, nombre):
        if nombre.startswith("_"):
            raise AttributeError(nombre)

        async def _f(*a, **k):
            return self._r.get(nombre, [])
        return _f


@pytest.fixture
def planificador(monkeypatch):
    """planificar() con todo lo que lee reemplazado, y el solver anotando qué le llega."""
    recibido = {}
    pausas = {"abiertas": []}

    class _Pausas:
        def __init__(self, db):
            pass

        async def abiertas_sin_romper(self, ids):
            return pausas["abiertas"]

    def _solver(procesos, *a, **k):
        recibido["procesos"] = procesos
        return [], {}

    def _diagnosticos_que_explotan(*a, **k):
        raise RuntimeError("se cayó el diagnóstico de trabas")

    monkeypatch.setattr(ps, "PausaRepository", _Pausas)
    monkeypatch.setattr(ps, "RangoRepository", lambda db: _Repo())
    monkeypatch.setattr(ps, "ProcesoRepository", lambda db: _Repo(find_maquinarias_por_proceso={}))
    monkeypatch.setattr(ps, "DiaBloqueadoRepository", lambda db: _Repo())
    monkeypatch.setattr(ps, "PlanoRepository", lambda db: _Repo(find_ordenes_con_plano=set()))
    monkeypatch.setattr(ps, "_resolver_planificacion", _solver)
    import backend.application.DiagnosticoPlanificacion as dp
    monkeypatch.setattr(dp, "construir_diagnosticos", _diagnosticos_que_explotan)

    ordenes = [
        _ot(10, 15279, [_paso(101, 1, nombre="TORNO CNC"), _paso(102, 2, nombre="SOLDADURA")]),
        _ot(20, 15300, [_paso(201, 1, nombre="PINTURA")]),
    ]

    async def correr(abiertas):
        pausas["abiertas"] = abiertas
        return await ps.planificar(
            _Repo(find_with_procesos_by_ids=ordenes),
            _Repo(find_interpreta_planos={}),
            _Repo(),
            _Repo(),
            db=None,
            ordenes_ids=[10, 20],
            preview=True,
            repo_skill=_Repo(get_map_por_proceso={}, get_nativas_deshabilitadas={},
                             get_manuales_por_proceso={}),
            fecha_desde=date(2026, 9, 23),
        )

    return correr, recibido


async def test_la_ot_pausada_no_le_llega_al_solver_y_sale_el_aviso(planificador):
    correr, recibido = planificador
    salida = await correr([(_pausa(10), 15279)])

    assert {p[0] for p in recibido["procesos"]} == {20}, "la OT 10 está pausada"
    (aviso,) = salida["diagnosticos"]
    assert aviso["titulo"].startswith("OT 15279: pausada por falta de material")
    # Con el número que conoce el taller, igual que los demás avisos.
    assert aviso["impacto"]["ots"] == [15279]


async def test_sin_pausas_el_plan_sale_como_antes(planificador):
    correr, recibido = planificador
    salida = await correr([])
    assert {p[0] for p in recibido["procesos"]} == {10, 20}
    assert salida["diagnosticos"] == []


async def test_si_no_se_pueden_leer_las_pausas_entra_todo(planificador):
    correr, recibido = planificador
    await correr(None)
    assert {p[0] for p in recibido["procesos"]} == {10, 20}


async def test_la_secuencia_de_lo_que_entra_se_renumera_sin_huecos(planificador):
    """El solver indexa por (orden, secuencia): lo que queda de la OT tiene que seguir
    numerado 1..N, sin el hueco del paso que se sacó."""
    correr, recibido = planificador
    await correr([(_pausa(10, id_otp=102, paso=2, nombre="SOLDADURA"), 15279)])
    de_la_10 = [(p[1], p[2]) for p in recibido["procesos"] if p[0] == 10]
    assert de_la_10 == [(101, 1)]
