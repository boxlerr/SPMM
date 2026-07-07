"""
Test de A2 (feedback Metlo 06/07): la preparación de máquina (SETUP) y su uso
(PRODUCCION_MAQUINA) de la misma OT deben quedar asignados al MISMO operario.

Verifica, sin tocar la base:
  - con `operario_vars`, el operario de la producción sigue al del setup,
  - sin `operario_vars`, NO se fuerza igualdad de operario (backward compatible),
  - la coordinación de máquina (comportamiento previo) se mantiene.
"""
from ortools.sat.python import cp_model

from backend.application.PlanificacionService import _agregar_coordinacion_maq_setup


def _armar_modelo():
    """OT 1 con un SETUP (seq 1) seguido de una PRODUCCION_MAQUINA (seq 2), ambos con máquina."""
    model = cp_model.CpModel()
    oid, seq_setup, seq_prod = 1, 1, 2

    op_setup = model.NewIntVar(10, 11, "op_setup")   # dominio {10, 11}
    op_prod = model.NewIntVar(10, 11, "op_prod")
    operario_vars = {(oid, seq_setup): op_setup, (oid, seq_prod): op_prod}

    maq_setup = model.NewIntVar(20, 21, "maq_setup")  # dominio {20, 21}
    maq_prod = model.NewIntVar(20, 21, "maq_prod")
    maq_vars = {(oid, seq_setup): maq_setup, (oid, seq_prod): maq_prod}

    # Tupla: (orden_id, proc_id, secuencia, fecha_prom, peso, dur, rangos, nombre, usa_maquina, familia, op_skill)
    procesos_norm = [
        (oid, 100, seq_setup, None, 5, 30, [], "PREPARACION TORNO", True, None, {}),
        (oid, 101, seq_prod, None, 5, 60, [], "CILINDRADO", True, None, {}),
    ]
    return model, procesos_norm, operario_vars, maq_vars, (op_setup, op_prod, maq_setup, maq_prod)


def test_a2_setup_y_produccion_mismo_operario():
    model, procesos_norm, operario_vars, maq_vars, (op_setup, op_prod, maq_setup, maq_prod) = _armar_modelo()

    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars)

    # Fijamos el operario y la máquina del SETUP; la producción debe seguirlos.
    model.Add(op_setup == 11)
    model.Add(maq_setup == 21)

    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(op_prod) == 11   # A2: mismo operario que el setup
    assert solver.Value(maq_prod) == 21  # comportamiento previo: misma máquina


def test_a2_sin_operario_vars_no_fuerza_operario():
    """Sin pasar operario_vars, la coordinación NO debe igualar operarios (backward compatible)."""
    model, procesos_norm, _operario_vars, maq_vars, (op_setup, op_prod, _maq_setup, _maq_prod) = _armar_modelo()

    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars)  # sin operario_vars

    # Pedimos operarios distintos: debe ser factible porque no hay igualdad forzada.
    model.Add(op_setup == 11)
    model.Add(op_prod == 10)

    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(op_setup) == 11
    assert solver.Value(op_prod) == 10
