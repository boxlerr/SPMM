"""
Tests del soporte de N operarios por proceso en el planificador (CP-SAT).
Verifican, sin tocar la base, que:
  - k=1 no crea slots extra (backward compatible),
  - un proceso que pide 2 operarios reserva 2 operarios REALES distintos,
  - si no alcanza la gente, no "inventa" operarios (slots de más quedan dummy),
  - la restricción de distintos impide asignar el mismo operario dos veces.
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import (
    _crear_variables_y_dominios,
    _agregar_distintos_operarios,
    _agregar_no_solape_operarios,
)

DUMMY_OP_ID = 999999
OP_EXTRA_VARS_IDX = 16  # posición de op_extra_vars en la tupla de retorno


def _crear(operarios, cant_op_map):
    ps.H = 100000
    model = cp_model.CpModel()
    # (orden, proc, sec, fecha, prio, dur, rangos, nombre, usa_maquina, familia, op_skill_levels)
    procesos_norm = [(1, 100, 1, None, 5, 60, [], "armado", False, None, {})]
    ret = _crear_variables_y_dominios(
        model, procesos_norm, operarios, [], set(), set(), {}, cant_op_map
    )
    return model, ret


def test_k1_no_crea_slots_extra():
    _model, ret = _crear([(10, 1)], None)
    assert ret[OP_EXTRA_VARS_IDX] == {}


def test_dos_operarios_reales_distintos():
    model, ret = _crear([(10, 1), (11, 1), (12, 1)], {(1, 1): 2})
    operario_vars = ret[3]
    op_extra_vars = ret[OP_EXTRA_VARS_IDX]
    assert len(op_extra_vars[(1, 1)]) == 1  # principal + 1 extra = 2 slots

    _agregar_distintos_operarios(model, operario_vars, op_extra_vars, DUMMY_OP_ID)

    # Objetivo mínimo: incentivar llenar los slots (minimizar dummies),
    # igual que hace la función objetivo real.
    slots = [operario_vars[(1, 1)]] + op_extra_vars[(1, 1)]
    dummies = []
    for i, v in enumerate(slots):
        d = model.NewBoolVar(f"d{i}")
        model.Add(v == DUMMY_OP_ID).OnlyEnforceIf(d)
        model.Add(v != DUMMY_OP_ID).OnlyEnforceIf(d.Not())
        dummies.append(d)
    model.Minimize(sum(dummies))

    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    vals = [solver.Value(v) for v in slots]
    assert len(vals) == 2
    assert all(v != DUMMY_OP_ID for v in vals)   # con 3 disponibles, ambos llenos
    assert len(set(vals)) == 2                    # distintos


def test_no_inventa_gente_si_no_alcanza():
    model, ret = _crear([(10, 1), (11, 1)], {(1, 1): 3})
    operario_vars = ret[3]
    op_extra_vars = ret[OP_EXTRA_VARS_IDX]
    assert len(op_extra_vars[(1, 1)]) == 2  # 3 slots: principal + 2 extra

    _agregar_distintos_operarios(model, operario_vars, op_extra_vars, DUMMY_OP_ID)

    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    vals = [solver.Value(operario_vars[(1, 1)])] + [solver.Value(v) for v in op_extra_vars[(1, 1)]]
    reales = [v for v in vals if v != DUMMY_OP_ID]
    assert len(set(reales)) == len(reales)   # los reales son distintos
    assert len(reales) <= 2                  # no hay más de 2 reales (solo había 2)


def test_distintos_impide_mismo_operario_dos_veces():
    # Forzando ambos slots a ser reales, deben terminar siendo operarios distintos.
    model, ret = _crear([(10, 1), (11, 1)], {(1, 1): 2})
    operario_vars = ret[3]
    op_extra_vars = ret[OP_EXTRA_VARS_IDX]
    _agregar_distintos_operarios(model, operario_vars, op_extra_vars, DUMMY_OP_ID)

    principal = operario_vars[(1, 1)]
    extra = op_extra_vars[(1, 1)][0]
    model.Add(principal != DUMMY_OP_ID)
    model.Add(extra != DUMMY_OP_ID)

    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(principal) != solver.Value(extra)
