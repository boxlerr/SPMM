"""
Test de "preselección de máquina" (feature Metlo): si un proceso tiene una
máquina elegida (id_maquinaria), el planificador FUERZA esa máquina (dominio =
solo esa), sin fallback DUMMY. Verifica _crear_variables_y_dominios sin tocar la base.
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import _crear_variables_y_dominios

MAQ_DOMAIN_IDX = 14  # posición de maq_domain_vals en el tuple de retorno
MAQUINAS = [(20, set(), "Maq A", "TORNO-A"), (21, set(), "Maq B", "TORNO-B")]


def _crear(preseleccion):
    ps.H = 100000
    model = cp_model.CpModel()
    # (orden, proc, sec, fecha, prio, dur, rangos, nombre, usa_maquina, familia, op_skill)
    procesos_norm = [(1, 100, 1, None, 5, 60, [], "FABRICACION", True, "", {})]
    return _crear_variables_y_dominios(
        model, procesos_norm, [(10, 1)], MAQUINAS, set(), set(), {}, None, preseleccion
    )


def test_sin_preseleccion_domina_todas_las_maquinas():
    dom = _crear(None)[MAQ_DOMAIN_IDX][(1, 1)]
    assert 20 in dom and 21 in dom  # ambas máquinas quedan como candidatas


def test_preseleccion_fuerza_la_maquina_elegida():
    dom = _crear({(1, 1): 21})[MAQ_DOMAIN_IDX][(1, 1)]
    assert dom == [21]  # forzado: solo la máquina elegida, sin DUMMY


def test_preseleccion_inexistente_se_ignora():
    # Máquina que no existe (no está en REAL_MAQ_IDS) -> no se fuerza, dominio normal.
    dom = _crear({(1, 1): 999})[MAQ_DOMAIN_IDX][(1, 1)]
    assert 20 in dom and 21 in dom
