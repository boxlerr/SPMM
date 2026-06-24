"""
Tests de la exclusión de nativas desactivadas en el armado del modelo del solver
(_crear_variables_y_dominios). Verifican que:
  - en el camino rango se restan los operarios excluidos,
  - sin nativas_off no se excluye a nadie,
  - el modo skill-map NO se ve afectado por nativas_off.
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import _crear_variables_y_dominios

OP_DOMAIN_VALS_IDX = 13  # posición de op_domain_vals en la tupla de retorno
DUMMY_OP_ID = 999999


def _dominio_operarios(op_skill_levels, nativas_off, operarios=None):
    operarios = operarios or [(10, 7), (11, 7), (12, 8)]
    # _crear_variables_y_dominios usa el horizonte como global H (lo setea
    # _resolver_planificacion en la corrida real); acá lo fijamos a mano.
    ps.H = 100000
    model = cp_model.CpModel()
    # (orden, proc, sec, fecha, peso, dur, rangos_proc, nombre, usa_maquina, familia, op_skill_levels)
    procesos_norm = [(1, 100, 1, None, 5, 10, [7], "Torneado", False, None, op_skill_levels)]
    ret = _crear_variables_y_dominios(
        model, procesos_norm, operarios, [], set(), set(), nativas_off
    )
    return ret[OP_DOMAIN_VALS_IDX][(1, 1)]


def test_excluye_operario_en_camino_rango():
    vals = _dominio_operarios(op_skill_levels={}, nativas_off={100: {11}})
    assert 11 not in vals          # nativa desactivada -> excluido
    assert 10 in vals              # el otro tornero sigue
    assert 12 not in vals          # rango 8 no aplica al proceso (rango 7)


def test_sin_nativas_off_no_excluye():
    vals = _dominio_operarios(op_skill_levels={}, nativas_off={})
    assert 10 in vals and 11 in vals


def test_skillmap_no_afectado_por_nativas_off():
    # En modo skill-map (hay op_skill_levels) la exclusión de nativas NO se aplica.
    vals = _dominio_operarios(op_skill_levels={11: 1}, nativas_off={100: {11}})
    assert 11 in vals              # sigue válido pese a estar en nativas_off
