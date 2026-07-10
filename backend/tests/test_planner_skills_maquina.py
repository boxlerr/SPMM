"""
Skills = fuente de verdad para procesos de MÁQUINA (PRODUCCION_MAQUINA).

Verifica _crear_variables_y_dominios (sin tocar la base):
  - un proceso de máquina SIN skills cargadas queda "sin asignar" (solo DUMMY),
    NO se abre por rango a cualquiera;
  - con skills cargadas, solo esos operarios (+ DUMMY);
  - un proceso NO-máquina (manual) sin skills sigue usando el camino por rango.

Contexto: reunión 8/7 (skills = lo que sigue fallando) + auditoría
(backend/scripts/auditoria_skills.py): 98/137 procesos de máquina no tenían
skills explícitas y se abrían por rango, mal-asignando (ej. fresadora F7).
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import _crear_variables_y_dominios

OP_DOMAIN_VALS_IDX = 13
DUMMY_OP_ID = 999999
MAQUINAS = [(20, set(), "TORNO A", "TORNO-A"), (21, set(), "TORNO B", "TORNO-B")]


def _dominio_operarios(nombre, usa_maquina, op_skill_levels, rangos_proc,
                       operarios=None, nativas_off=None):
    operarios = operarios if operarios is not None else [(10, 7), (11, 7)]
    ps.H = 100000
    model = cp_model.CpModel()
    # (orden, proc, sec, fecha, peso, dur, rangos_proc, nombre, usa_maquina, familia, op_skill_levels)
    procesos_norm = [(1, 100, 1, None, 5, 60, rangos_proc, nombre, usa_maquina, "", op_skill_levels)]
    ret = _crear_variables_y_dominios(
        model, procesos_norm, operarios, MAQUINAS, set(), set(), nativas_off or {}
    )
    return ret[OP_DOMAIN_VALS_IDX][(1, 1)]


def test_maquina_sin_skills_queda_sin_asignar():
    # CILINDRADO = PRODUCCION_MAQUINA. Sin skills cargadas, aunque los operarios
    # tengan el rango [7], NO se asigna a nadie: solo DUMMY.
    dom = _dominio_operarios("CILINDRADO", True, {}, [7])
    assert dom == [DUMMY_OP_ID]
    assert 10 not in dom and 11 not in dom


def test_maquina_con_skills_solo_el_skilled():
    # Con skill cargada solo para el operario 10 -> solo 10 (+ DUMMY), nunca 11.
    dom = _dominio_operarios("CILINDRADO", True, {10: 1}, [7])
    assert 10 in dom
    assert 11 not in dom
    assert DUMMY_OP_ID in dom


def test_maquina_ignora_rango_sin_skill():
    # Aunque el proceso tenga rango y operarios que lo cumplen, sin skill cargada
    # el proceso de máquina no se abre por rango.
    dom = _dominio_operarios("FRESADORA F7 + ROSCADO", True, {}, [7])
    assert dom == [DUMMY_OP_ID]


def test_manual_sin_skill_sigue_por_rango():
    # Proceso NO-máquina (usa_maquina=False): el camino por rango sigue igual,
    # los operarios con el rango del proceso quedan válidos.
    dom = _dominio_operarios("armado", False, {}, [7])
    assert 10 in dom and 11 in dom


def test_manual_sin_rango_ni_skill_abre_a_todos():
    # Regresión: proceso manual sin rango ni skills -> abierto (comportamiento previo).
    dom = _dominio_operarios("armado", False, {}, [])
    assert 10 in dom and 11 in dom
