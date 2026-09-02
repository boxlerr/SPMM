"""
Test de "preselección de persona" (pedido de Lucas, 26-ago-2026: "en orden, al crear
trabajo, falta persona en proceso"). Si un proceso de la OT tiene un operario elegido
(id_operario), el planificador FUERZA esa persona: dominio = solo esa, sin fallback
DUMMY. Es el mismo contrato que la máquina preseleccionada.

Lo importante es el último test: la preselección PISA el filtro por rango. Nace de
que el cruce de rangos es de igualdad exacta —un OFICIAL no puede usar una máquina
que pide MEDIO OFICIAL— y el taller no lo entiende así ("si lo puede usar un medio
oficial, claramente lo puede usar un oficial"). Mientras el motor siga cruzando
rangos exactos, elegir la persona a mano es la salida que le queda a quien carga la
OT, y tiene que ganarle al filtro para servir de algo.
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import (
    _agregar_distintos_operarios,
    _crear_variables_y_dominios,
)

OP_DOMAIN_IDX = 13  # posición de op_domain_vals en el tuple de retorno
OP_VARS_IDX = 3     # operario_vars
OP_EXTRA_IDX = 16   # op_extra_vars
DUMMY_OP_ID = 999999
OFICIAL, MEDIO = 1, 2
# (id_operario, id_rango)
OPERARIOS = [(10, OFICIAL), (11, MEDIO)]


def _crear(preseleccion_op, rangos_proc=(OFICIAL,)):
    ps.H = 100000
    model = cp_model.CpModel()
    # (orden, proc, sec, fecha, prio, dur, rangos, nombre, usa_maquina, familia, op_skill)
    procesos_norm = [(1, 100, 1, None, 5, 60, list(rangos_proc), "CONTROL DE MEDIDAS",
                      False, "", {})]
    return _crear_variables_y_dominios(
        model, procesos_norm, OPERARIOS, [], set(), set(), {}, None, None,
        preseleccion_op=preseleccion_op,
    )


def test_sin_preseleccion_domina_los_del_rango():
    dom = _crear(None)[OP_DOMAIN_IDX][(1, 1)]
    assert 10 in dom          # tiene OFICIAL, que es lo que pide el proceso
    assert 11 not in dom      # tiene MEDIO OFICIAL: hoy el cruce es exacto
    assert DUMMY_OP_ID in dom # y siempre queda la salida de "sin asignar"


def test_preseleccion_fuerza_la_persona_elegida():
    dom = _crear({(1, 1): 10})[OP_DOMAIN_IDX][(1, 1)]
    assert dom == [10]  # forzado: solo esa persona, sin DUMMY


def test_preseleccion_inexistente_se_ignora():
    # Operario que no existe (no está en REAL_OP_IDS) -> dominio normal, no se rompe.
    dom = _crear({(1, 1): 999})[OP_DOMAIN_IDX][(1, 1)]
    assert 10 in dom and DUMMY_OP_ID in dom


def test_preseleccion_le_gana_al_filtro_por_rango():
    # El proceso pide OFICIAL y el 11 tiene MEDIO OFICIAL: sin preselección no entra.
    # Elegido a mano, entra igual — es una decisión de quien carga la OT, que sabe
    # cosas que el rango no dice.
    dom = _crear({(1, 1): 11})[OP_DOMAIN_IDX][(1, 1)]
    assert dom == [11]


def test_persona_elegida_con_dos_operarios_no_tumba_el_modelo():
    """Una sola fila con persona elegida y cantidad de recurso humano 2 dejaba el modelo
    COMPLETO en INFEASIBLE.

    Los slots extra heredaban el dominio de un solo valor, así que los dos quedaban en
    la misma persona, y `_agregar_distintos_operarios` exige que sean reales y distintos
    (`AddBoolOr([eq.Not(), a_dummy])`). No es «esa OT sale sin asignar»: no salía ningún
    plan, y el diagnóstico tampoco podía explicar por qué. La elección de la carga es
    sobre quién hace el trabajo, no sobre con quién, así que el acompañante se elige del
    conjunto sin forzar.
    """
    ps.H = 100000
    model = cp_model.CpModel()
    procesos_norm = [(1, 100, 1, None, 5, 60, [OFICIAL], "ENSAMBLAJE", False, "", {})]
    salida = _crear_variables_y_dominios(
        model, procesos_norm, OPERARIOS, [], set(), set(),
        nativas_off={},
        cant_op_map={(1, 1): 2},
        preseleccion_op={(1, 1): 10},
    )
    dominios = salida[OP_DOMAIN_IDX]
    assert dominios[(1, 1)] == [10], "el principal sigue forzado en la persona elegida"

    # Y el modelo tiene que resolver: antes salía INFEASIBLE.
    operario_vars = salida[OP_VARS_IDX]
    op_extra_vars = salida[OP_EXTRA_IDX]
    assert op_extra_vars.get((1, 1)), "el proceso pide dos personas: tiene que haber un slot extra"
    _agregar_distintos_operarios(model, operario_vars, op_extra_vars, DUMMY_OP_ID)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(operario_vars[(1, 1)]) == 10
    assert solver.Value(op_extra_vars[(1, 1)][0]) != 10, "el acompañante tiene que ser otro"
