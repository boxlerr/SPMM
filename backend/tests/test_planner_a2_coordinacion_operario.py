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

    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars, dummy_op_id=999999)

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

    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, dummy_op_id=999999)  # sin operario_vars

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
                                    op_domain_vals, dummy_op_id=999999)

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
                                    op_domain_vals, dummy_op_id=999999)

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
                                    op_domain_vals, dummy_op_id=DUMMY)

    model.Add(op_setup == 11)
    model.Add(op_prod == 10)

    solver = cp_model.CpSolver()
    assert solver.Solve(model) == cp_model.INFEASIBLE, "la igualdad tiene que seguir puesta"


# --------------------------------------------------------------------------
# La regla de oro con un proceso en el medio (OT 15708, Lucas 28/08)
# --------------------------------------------------------------------------

def _ot_con_proceso_en_el_medio():
    """Preparación de soldadora MIG → Ensamblaje (manual) → Soldadura con MIG.

    Es la OT 15708 tal como salió en la pantalla que Lucas marcó como error: preparó la
    soldadora uno y soldó otro, en otra máquina. En la MISMA OT el torno salía bien
    porque ahí la preparación y el uso eran consecutivos."""
    model = cp_model.CpModel()
    oid = 15708

    op_prep = model.NewIntVar(10, 11, "op_prep")
    op_medio = model.NewIntVar(10, 11, "op_medio")
    op_sold = model.NewIntVar(10, 11, "op_sold")
    operario_vars = {(oid, 1): op_prep, (oid, 2): op_medio, (oid, 3): op_sold}

    maq_prep = model.NewIntVar(20, 21, "maq_prep")
    maq_sold = model.NewIntVar(20, 21, "maq_sold")
    maq_vars = {(oid, 1): maq_prep, (oid, 3): maq_sold}

    procesos_norm = [
        (oid, 100, 1, None, 5, 30, [], "PREPARACION DE SOLDADORA MIG", True, None, {}),
        # El del medio es manual: no usa máquina. Es el que partía el par.
        (oid, 101, 2, None, 5, 45, [], "ENSAMBLAJE, PUNTEADO Y ESCUADRADO", False, None, {}),
        (oid, 102, 3, None, 5, 90, [], "SOLDADURA CON MIG", True, None, {}),
    ]
    return model, procesos_norm, operario_vars, maq_vars, (op_prep, op_sold, maq_prep, maq_sold)


def test_un_proceso_manual_en_el_medio_ya_no_rompe_la_regla():
    model, procesos_norm, operario_vars, maq_vars, (op_prep, op_sold, maq_prep, maq_sold) = \
        _ot_con_proceso_en_el_medio()
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars,
                                    dummy_op_id=999999)
    model.Add(op_prep == 11)
    model.Add(maq_prep == 21)

    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(op_sold) == 11, "el que prepara la soldadora es el que suelda"
    assert solver.Value(maq_sold) == 21, "y usa la misma soldadora que preparó"


def test_la_ot_que_repite_familia_empareja_uno_a_uno():
    """Una OT puede repetir la misma familia (la 7497 tiene torno CNC 13 veces). Cada
    preparación se lleva UNA producción, la primera que le toca: aparear todas contra
    todas ataría trabajos que no tienen nada que ver."""
    model = cp_model.CpModel()
    oid = 7497
    ops = {s: model.NewIntVar(10, 12, f"op{s}") for s in (1, 2, 3, 4)}
    maqs = {s: model.NewIntVar(20, 22, f"maq{s}") for s in (1, 2, 3, 4)}
    operario_vars = {(oid, s): v for s, v in ops.items()}
    maq_vars = {(oid, s): v for s, v in maqs.items()}
    procesos_norm = [
        (oid, 1, 1, None, 5, 10, [], "PREPARACION DE TORNO", True, None, {}),
        (oid, 2, 2, None, 5, 10, [], "PREPARACION DE TORNO", True, None, {}),
        (oid, 3, 3, None, 5, 10, [], "TORNO T1", True, None, {}),
        (oid, 4, 4, None, 5, 10, [], "TORNO T2", True, None, {}),
    ]
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars,
                                    dummy_op_id=999999)
    # 1ª preparación con 1ª producción, 2ª con 2ª. Los dos pares pueden ir por separado.
    model.Add(ops[1] == 10)
    model.Add(ops[2] == 11)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(ops[3]) == 10
    assert solver.Value(ops[4]) == 11


def test_una_produccion_sin_su_preparacion_no_se_ata_a_otra_familia():
    """Preparar el torno no ata la soldadura: son familias distintas."""
    model = cp_model.CpModel()
    oid = 1
    op_prep = model.NewIntVar(10, 11, "op_prep")
    op_sold = model.NewIntVar(10, 11, "op_sold")
    operario_vars = {(oid, 1): op_prep, (oid, 2): op_sold}
    maq_vars = {(oid, 1): model.NewIntVar(20, 21, "m1"), (oid, 2): model.NewIntVar(20, 21, "m2")}
    procesos_norm = [
        (oid, 1, 1, None, 5, 10, [], "PREPARACION DE TORNO", True, None, {}),
        (oid, 2, 2, None, 5, 10, [], "SOLDADURA CON MIG", True, None, {}),
    ]
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars,
                                    dummy_op_id=999999)
    model.Add(op_prep == 11)
    model.Add(op_sold == 10)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE), \
        "no comparten familia: no hay por qué atarlos"
