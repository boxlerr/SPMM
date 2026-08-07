"""
Tests de la exclusión de nativas desactivadas en el armado del modelo del solver
(_crear_variables_y_dominios). Verifican que:
  - se restan los operarios excluidos,
  - sin nativas_off no se excluye a nadie,
  - tener SKILL 1/2 NO blinda contra la desactivación: apagar la nativa saca al
    operario aunque esté priorizado (la prioridad ordena, no habilita).
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import _crear_variables_y_dominios

OP_DOMAIN_VALS_IDX = 13  # posición de op_domain_vals en la tupla de retorno
DUMMY_OP_ID = 999999


def _dominio_operarios(op_skill_levels, nativas_off, operarios=None, skills_manuales=None):
    operarios = operarios or [(10, 7), (11, 7), (12, 8)]
    # _crear_variables_y_dominios usa el horizonte como global H (lo setea
    # _resolver_planificacion en la corrida real); acá lo fijamos a mano.
    ps.H = 100000
    model = cp_model.CpModel()
    # (orden, proc, sec, fecha, peso, dur, rangos_proc, nombre, usa_maquina, familia, op_skill_levels)
    procesos_norm = [(1, 100, 1, None, 5, 10, [7], "Torneado", False, None, op_skill_levels)]
    ret = _crear_variables_y_dominios(
        model, procesos_norm, operarios, [], set(), set(), nativas_off,
        skills_manuales=skills_manuales,
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


def test_prioridad_no_blinda_contra_la_desactivacion():
    # El operario 11 está marcado como SKILL 1 y además tiene la nativa apagada.
    # Apagada gana: la prioridad decide a quién preferir entre los elegibles, no
    # quién es elegible. (Antes el "modo skill-map" lo dejaba adentro.)
    vals = _dominio_operarios(op_skill_levels={11: 1}, nativas_off={100: {11}})
    assert 11 not in vals
    assert 10 in vals


def test_prioridad_no_excluye_a_las_demas_nativas():
    # Marcar al 11 como SKILL 1 no saca al 10, que tiene la misma nativa sin marcar.
    vals = _dominio_operarios(op_skill_levels={11: 1}, nativas_off={})
    assert 10 in vals and 11 in vals


def test_manual_habilita_fuera_del_rango():
    # El 12 es del rango 8, que no da este proceso: sin la manual no es elegible.
    # Cargarla a mano lo suma, y no toca a nadie más.
    vals = _dominio_operarios(op_skill_levels={}, nativas_off={}, skills_manuales={100: {12}})
    assert 12 in vals
    assert 10 in vals and 11 in vals


def test_manual_apagada_no_habilita():
    # Apagar gana sobre agregar: el repo ya filtra las manuales deshabilitadas, y si
    # igual llegaran, nativas_off las saca.
    vals = _dominio_operarios(
        op_skill_levels={}, nativas_off={100: {12}}, skills_manuales={100: {12}}
    )
    assert 12 not in vals


def test_manual_de_operario_sin_rango_se_ignora():
    # El 99 no está en `operarios` (sale de operario_rango): meterlo en el dominio lo
    # dejaría asignable sin calendario ni no-solape. Se ignora.
    vals = _dominio_operarios(op_skill_levels={}, nativas_off={}, skills_manuales={100: {99}})
    assert 99 not in vals


def test_manual_sobre_otro_proceso_no_afecta():
    vals = _dominio_operarios(op_skill_levels={}, nativas_off={}, skills_manuales={999: {12}})
    assert 12 not in vals
