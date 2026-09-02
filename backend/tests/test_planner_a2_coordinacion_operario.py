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


# --------------------------------------------------------------------------
# La excepción: persona elegida a mano al cargar la OT (Lucas, 28/08)
# --------------------------------------------------------------------------

def test_persona_elegida_a_mano_rompe_la_igualdad_de_operario():
    """El torno CNC lo puede preparar uno y ejecutarlo un operario calificado.

    Si al cargar el proceso en la OT se eligió a alguien, esa elección manda y el par
    no se ata. Sin la guarda, la igualdad y el dominio de un solo valor se pelean: el
    modelo sale INFEASIBLE o la elección se le contagia al otro proceso."""
    model, procesos_norm, operario_vars, maq_vars, (op_setup, op_prod, maq_setup, maq_prod) = _armar_modelo()

    # En la producción se eligió al 10 a mano: su dominio quedó en una sola persona.
    op_domain_vals = {(1, 1): [10, 11, 999999], (1, 2): [10]}
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars,
                                    op_domain_vals, 999999)

    model.Add(op_setup == 11)
    model.Add(op_prod == 10)

    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(op_setup) == 11
    assert solver.Value(op_prod) == 10
    # La máquina SÍ se sigue igualando: eso no lo discutió nadie.
    assert solver.Value(maq_setup) == solver.Value(maq_prod)


def test_sin_eleccion_a_mano_la_regla_de_oro_sigue_valiendo():
    """La guarda no puede convertirse en una puerta abierta: sin elección, se ata."""
    model, procesos_norm, operario_vars, maq_vars, (op_setup, op_prod, _ms, _mp) = _armar_modelo()

    # Los dos con dominio de dos personas: nadie eligió nada a mano.
    op_domain_vals = {(1, 1): [10, 11, 999999], (1, 2): [10, 11, 999999]}
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars,
                                    op_domain_vals, 999999)

    model.Add(op_setup == 11)
    model.Add(op_prod == 10)

    solver = cp_model.CpSolver()
    assert solver.Solve(model) == cp_model.INFEASIBLE


def test_preseleccion_que_el_solver_ignoro_no_saltea_la_regla():
    """Si la persona elegida no existe entre los operarios reales, el dominio queda
    entero y la igualdad tiene que seguir valiendo: mirar el dominio y no el
    diccionario de preselección es lo que evita saltear la regla por una elección
    que el solver descartó."""
    model, procesos_norm, operario_vars, maq_vars, (op_setup, op_prod, _ms, _mp) = _armar_modelo()

    op_domain_vals = {(1, 1): [10, 11, 999999], (1, 2): [10, 11, 999999]}
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars,
                                    op_domain_vals, 999999)

    model.Add(op_setup == 11)
    model.Add(op_prod == 10)

    solver = cp_model.CpSolver()
    assert solver.Solve(model) == cp_model.INFEASIBLE


def test_dominio_de_un_solo_valor_por_dummy_no_saltea_la_regla():
    """Cuando NADIE puede hacer el proceso, el dominio también queda en un solo valor
    —el dummy—, y ese caso tiene que seguir arrastrando a la producción a «sin
    asignar». Si la guarda mirara solo el largo del dominio, la preparación quedaría
    sin nadie y la producción saldría con una persona: el dibujo exacto que Lucas
    marcó como error."""
    model, procesos_norm, operario_vars, maq_vars, (op_setup, op_prod, _ms, _mp) = _armar_modelo()

    DUMMY = 999999
    # El setup no lo puede hacer nadie: su dominio es [DUMMY]. (En el modelo de prueba
    # las variables van de 10 a 11, así que alcanza con declarar el dominio.)
    op_domain_vals = {(1, 1): [DUMMY], (1, 2): [10, 11, DUMMY]}
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars,
                                    op_domain_vals, DUMMY)

    model.Add(op_setup == 11)
    model.Add(op_prod == 10)

    solver = cp_model.CpSolver()
    assert solver.Solve(model) == cp_model.INFEASIBLE, "la igualdad tiene que seguir puesta"
