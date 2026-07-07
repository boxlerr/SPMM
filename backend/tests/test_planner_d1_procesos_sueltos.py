"""
Test de D1 (feedback Metlo 06/07): planificar procesos SUELTOS de una OT.
Verifica el filtro _filtrar_procesos_por_orden (sin tocar la base).
"""
from collections import namedtuple

from backend.application.PlanificacionService import _filtrar_procesos_por_orden

P = namedtuple("P", ["id_proceso"])


def test_sin_restriccion_devuelve_todos():
    procs = [P(1), P(2), P(3)]
    assert _filtrar_procesos_por_orden(procs, 10, None) == procs
    assert _filtrar_procesos_por_orden(procs, 10, {}) == procs
    # Restricción para OTRA orden: esta no se toca.
    assert _filtrar_procesos_por_orden(procs, 10, {99: [1]}) == procs


def test_restringe_a_un_proceso():
    procs = [P(1), P(2), P(3)]
    r = _filtrar_procesos_por_orden(procs, 10, {10: [2]})
    assert [p.id_proceso for p in r] == [2]


def test_restringe_a_varios_procesos():
    procs = [P(1), P(2), P(3)]
    r = _filtrar_procesos_por_orden(procs, 10, {10: [1, 3]})
    assert [p.id_proceso for p in r] == [1, 3]


def test_proceso_inexistente_da_vacio():
    procs = [P(1), P(2)]
    assert _filtrar_procesos_por_orden(procs, 10, {10: [999]}) == []
