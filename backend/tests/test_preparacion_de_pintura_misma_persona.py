"""La preparación de la pintura y la pintura de una OT las hace la misma persona.

Reunión con Lucas del 28/10/2026: Leonardo preparaba la pintura y la pintaba un pasante,
así que el trabajo cambiaba de manos en el medio. Se le cargó a Leonardo la pintura y a
los pasantes la preparación, y el plan las seguía eligiendo por separado (en la 15866 y la
15867, Leonardo preparaba y pintaba un pasante). La regla de preparación y trabajo de
siempre es de máquina —la pintura no usa ninguna— y esta va aparte: ata sólo a la persona.

Sin tocar la base.
"""
from ortools.sat.python import cp_model

from backend.application.PlanificacionService import (
    _agregar_misma_persona_preparacion_manual,
    _pares_preparacion_manual,
)

DUMMY = 999999
LEONARDO, PASANTE_1 = 29, 45


def fila(oid, seq, nombre, proc_id=1):
    # (orden_id, proc_id, secuencia, fecha_prom, peso, dur, rangos, nombre, usa_maquina, familia, skills)
    return (oid, proc_id, seq, None, 5, 30, [], nombre, False, None, {})


def test_empareja_la_preparacion_con_la_pintura_que_le_sigue():
    procesos = [
        fila(1, 1, "SOLDADURA CON MIG"),
        fila(1, 2, "PREPARACION DE PINTURA"),
        fila(1, 3, "PINTURA"),
        fila(1, 4, "EMBALADO"),
        fila(2, 1, "PINTURA"),                    # sin preparación: no se ata a nada
    ]
    assert _pares_preparacion_manual(procesos) == [([(1, 2)], [(1, 3)])]


def test_uno_a_uno_cuando_la_ot_pinta_dos_veces():
    procesos = [
        fila(1, 1, "PREPARACION  DE PINTURA"),   # con doble espacio, como viene del viejo
        fila(1, 2, "PINTURA"),
        fila(1, 3, "AMOLADO"),
        fila(1, 4, "PREPARACION DE PINTURA"),
        fila(1, 5, "PINTURA"),
    ]
    assert _pares_preparacion_manual(procesos) == [([(1, 1)], [(1, 2)]), ([(1, 4)], [(1, 5)])]


def _modelo(dominios):
    model = cp_model.CpModel()
    op = {k: model.NewIntVarFromDomain(cp_model.Domain.FromValues(v), f"op{k}") for k, v in dominios.items()}
    procesos = [fila(1, 1, "PREPARACION DE PINTURA"), fila(1, 2, "PINTURA")]
    return model, op, procesos


def test_la_misma_persona_prepara_y_pinta():
    dominios = {(1, 1): [LEONARDO, PASANTE_1, DUMMY], (1, 2): [LEONARDO, PASANTE_1, DUMMY]}
    model, op, procesos = _modelo(dominios)
    _agregar_misma_persona_preparacion_manual(model, procesos, op, dominios, dummy_op_id=DUMMY)
    model.Add(op[(1, 1)] == LEONARDO)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(op[(1, 2)]) == LEONARDO


def test_persona_elegida_a_mano_no_se_ata():
    dominios = {(1, 1): [LEONARDO, PASANTE_1, DUMMY], (1, 2): [PASANTE_1]}
    model, op, procesos = _modelo(dominios)
    _agregar_misma_persona_preparacion_manual(model, procesos, op, dominios, dummy_op_id=DUMMY)
    model.Add(op[(1, 1)] == LEONARDO)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)


def test_si_nadie_puede_las_dos_no_se_atan():
    dominios = {(1, 1): [LEONARDO, DUMMY], (1, 2): [PASANTE_1, DUMMY]}
    model, op, procesos = _modelo(dominios)
    _agregar_misma_persona_preparacion_manual(model, procesos, op, dominios, dummy_op_id=DUMMY)
    model.Add(op[(1, 1)] == LEONARDO)
    model.Add(op[(1, 2)] == PASANTE_1)
    solver = cp_model.CpSolver()
    assert solver.Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
