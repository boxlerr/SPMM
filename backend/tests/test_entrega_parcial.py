"""Entrega parcial: el plan fabrica sólo una parte de la OT.

Lucas (27/10/2026), con la 15984 fuera del plan: «Debo poder indicar si en vez del total
del pedido, puedo hacer una entrega parcial. En este caso por ejemplo, son 66 piezas total
pero tengo que entregar 24 para el jueve».

Viaja con los ajustes «solo para este plan» (`ajustes_del_plan.entregas_parciales`): no se
escribe en la OT y la vista previa la manda en todos los recálculos. Se cuida que la
producción se achique a esas piezas (las preparaciones no), que la fecha de la entrega
reemplace a la prometida en el cálculo y que cada fila diga con qué entrega salió, que es
de donde la pantalla saca si el plan que muestra ya la tiene.
"""
import types
from datetime import date, datetime

import pytest
from pydantic import ValidationError

from backend.application import PlanificacionService as PS
from backend.dto.PlanificarRequestDTO import PlanificarRequestDTO
from backend.tests.test_ajustes_solo_este_plan import (  # noqa: F401
    _RepoMaquinaria, _RepoOperario, _RepoOrden, _RepoPlanificacionEspia, _RepoSkill,
    _maquina, _pasada, _proceso, sin_base,
)

PROMETIDA = datetime(2026, 11, 6)


def _ot_15984(entregadas=0):
    """La 15984: 66 piezas, una preparación y un torneado de 2.640 min (40 min por pieza)."""
    preparacion = _proceso(20, "PREPARACION TORNO CNC", [7])
    torneado = _proceso(21, "TORNO CNC", [7])
    return types.SimpleNamespace(
        id=15984, id_otvieja=15984, prioridad=None, fecha_prometida=PROMETIDA,
        unidades=66, cantidad_entregada=entregadas, cantidad_finalizada_parcial=None,
        procesos=[_pasada(500, preparacion, orden=1, minutos=60),
                  _pasada(501, torneado, orden=2, minutos=2640)],
    )


@pytest.fixture
def solver_eco(monkeypatch):
    """Anota lo que le llega al solver y devuelve una fila por paso, como si entrara todo."""
    capturado = {}

    def _falso(procesos, *resto):
        capturado["procesos"] = procesos
        filas = [{"orden_id": p[0], "proceso_id": p[1], "secuencia": p[2], "duracion_min": p[5],
                  "inicio_min": 0, "fin_min": p[5], "excedente": False} for p in procesos]
        return filas, {}

    monkeypatch.setattr(PS, "_resolver_planificacion", _falso)
    return capturado


async def _correr(ajustes, orden=None):
    return await PS.planificar(
        _RepoOrden([orden or _ot_15984()]),
        _RepoOperario(), _RepoMaquinaria([_maquina(3, "TORNO CNC 1", [7])]),
        _RepoPlanificacionEspia(), db=object(), ordenes_ids=[15984], preview=True,
        repo_skill=_RepoSkill(), ajustes_del_plan=ajustes,
    )


def _minutos(capturado):
    return {p[7]: p[5] for p in capturado["procesos"]}


# --- Qué vale como entrega parcial ------------------------------------------

def test_24_de_66_es_una_entrega_parcial():
    ot = _ot_15984()
    assert PS.entrega_parcial_de(ot, 0, {"unidades": 24, "fecha": date(2026, 10, 29)}) == {
        "unidades": 24, "fecha": date(2026, 10, 29), "faltan": 66}


def test_cuenta_contra_lo_que_falta_y_no_contra_el_total():
    # Con 30 entregadas faltan 36: pedir 24 sigue siendo parcial, pedir 36 ya es todo.
    ot = _ot_15984(entregadas=30)
    assert PS.entrega_parcial_de(ot, 30, {"unidades": 24})["faltan"] == 36
    assert PS.entrega_parcial_de(ot, 30, {"unidades": 36}) is None


def test_pedir_todo_o_nada_no_es_entrega_parcial():
    ot = _ot_15984()
    assert PS.entrega_parcial_de(ot, 0, {"unidades": 66}) is None
    assert PS.entrega_parcial_de(ot, 0, {"unidades": 80}) is None
    assert PS.entrega_parcial_de(ot, 0, {"unidades": 0}) is None
    assert PS.entrega_parcial_de(ot, 0, None) is None


def test_sin_unidades_cargadas_no_hay_contra_que_dividir():
    ot = _ot_15984()
    ot.unidades = None
    assert PS.entrega_parcial_de(ot, 0, {"unidades": 24}) is None


# --- Lo que le llega al solver ------------------------------------------------

async def test_la_produccion_se_achica_a_las_piezas_y_la_preparacion_no(sin_base, solver_eco):
    await _correr({"entregas_parciales": {15984: {"unidades": 24, "fecha": None}}})
    # 2.640 min para 66 piezas → 960 min para 24. Preparar el torno tarda lo mismo.
    assert _minutos(solver_eco) == {"TORNO CNC": 960, "PREPARACION TORNO CNC": 60}


async def test_con_entregas_ya_cargadas_se_planifican_las_piezas_pedidas(sin_base, solver_eco):
    await _correr({"entregas_parciales": {15984: {"unidades": 24}}}, _ot_15984(entregadas=30))
    assert _minutos(solver_eco)["TORNO CNC"] == 960


async def test_la_fecha_de_la_entrega_manda_sobre_la_prometida(sin_base, solver_eco):
    await _correr({"entregas_parciales": {15984: {"unidades": 24, "fecha": date(2026, 10, 29)}}})
    # índice 3 de la tupla del solver = para cuándo tiene que estar.
    assert {p[3] for p in solver_eco["procesos"]} == {date(2026, 10, 29)}


async def test_sin_fecha_sigue_valiendo_la_prometida(sin_base, solver_eco):
    await _correr({"entregas_parciales": {15984: {"unidades": 24}}})
    assert {p[3] for p in solver_eco["procesos"]} == {PROMETIDA}


async def test_sin_entrega_parcial_el_plan_sale_como_siempre(sin_base, solver_eco):
    salida = await _correr(None)
    assert _minutos(solver_eco) == {"TORNO CNC": 2640, "PREPARACION TORNO CNC": 60}
    assert {p[3] for p in solver_eco["procesos"]} == {PROMETIDA}
    assert all("entrega_parcial" not in f for f in salida["planificados"])


# --- Lo que vuelve a la pantalla ----------------------------------------------

async def test_cada_fila_dice_con_que_entrega_se_calculo(sin_base, solver_eco):
    salida = await _correr({"entregas_parciales": {15984: {"unidades": 24, "fecha": date(2026, 10, 29)}}})
    filas = salida["planificados"] + salida["excedentes"]
    assert len(filas) == 2
    assert all(f["entrega_parcial"] == {"unidades": 24, "faltan": 66, "fecha": "2026-10-29"}
               for f in filas)
    # La fila achicada sigue llevando el lote entero, para mostrar «24 de 66».
    torneado = next(f for f in filas if f["proceso_id"] == 21)
    assert (torneado["minutos_lote"], torneado["unidades_lote"], torneado["unidades_faltan"]) == (2640, 66, 24)


def test_marca_tambien_las_filas_que_quedaron_afuera():
    filas = [{"orden_id": 15984, "excedente": True}, {"orden_id": 15985, "excedente": False}]
    PS._marcar_entregas_parciales(filas, {15984: {"unidades": 24, "faltan": 66, "fecha": None}})
    assert filas[0]["entrega_parcial"] == {"unidades": 24, "faltan": 66, "fecha": None}
    assert "entrega_parcial" not in filas[1]


# --- El pedido ----------------------------------------------------------------

def test_el_dto_lee_la_entrega_parcial_con_las_claves_de_json():
    body = PlanificarRequestDTO(ordenes_ids=[15984], preview=True, ajustes_del_plan={
        "procesos": {}, "maquinarias": {}, "skills_nativas": [],
        "entregas_parciales": {"15984": {"unidades": 24, "fecha": "2026-10-29"}},
    })
    ajustes = body.ajustes_del_plan.model_dump()
    assert ajustes["entregas_parciales"] == {15984: {"unidades": 24, "fecha": date(2026, 10, 29)}}


def test_el_dto_sin_entregas_parciales_sigue_andando():
    body = PlanificarRequestDTO(ordenes_ids=[1], ajustes_del_plan={
        "procesos": {}, "maquinarias": {}, "skills_nativas": []})
    assert body.ajustes_del_plan.model_dump()["entregas_parciales"] == {}


def test_el_dto_no_acepta_cero_piezas():
    with pytest.raises(ValidationError):
        PlanificarRequestDTO(ajustes_del_plan={"entregas_parciales": {"15984": {"unidades": 0}}})
