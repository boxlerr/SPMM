"""«Cada uno en lo suyo»: si hay alguien de SKILL 1 para el proceso, el paso lo espera.

Reunión con Lucas del 28/10/2026, tarea 4: el plan le daba la fresadora a Gustavo (tornero,
SKILL 2 en fresado) cuando Alejandro (el fresador, SKILL 1) estaba ocupado. La preferencia
por el SKILL 1 pesa 2.000 por paso, lo mismo que un minuto de una OT abierta, así que casi
siempre convenía arrancar con quien estuviera libre. Medido el 2/11 con las 28 OT de esa
semana: siempre hay entre 6 y 13 horas de fresado hecho por no fresadores, y quién lo hace
cambia de una corrida a la otra.

La opción del plan `cada_uno_en_lo_suyo` saca a los de SKILL 2 de los pasos donde hay
alguien de SKILL 1: el paso espera a su especialista. Cuesta OT terminadas (23 en vez de
24-26 esa semana); por eso es una opción y no la regla de siempre.
"""
from datetime import datetime

from backend.application import PlanificacionService as PS
from backend.tests.test_planificador_dias import LUNES, OFICIAL, _cal, solver_rapido  # noqa: F401

ALEJANDRO, GUSTAVO = 34, 35
SKILLS = {ALEJANDRO: (1, 0), GUSTAVO: (2, 0)}


# Las dos ya vencidas: arrancar las dos a la vez es lo que le conviene al plan.
VENCIDA = datetime(2026, 9, 25)


def _fresado(ot, minutos=240):
    return (ot, 68, 1, VENCIDA, "normal", minutos, [OFICIAL], "FRESADO CONVENCIONAL", False, "", SKILLS)


def _resolver(en_lo_suyo):
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL)]
    resultados, _ = PS._resolver_planificacion(
        [_fresado(1), _fresado(2)], operarios, [], None, None, {}, {}, {}, {}, set(), {},
        _cal(ALEJANDRO, GUSTAVO), [], {}, {}, None, LUNES, cada_uno_en_lo_suyo=en_lo_suyo)
    return {r["orden_id"]: r for r in resultados}


def test_sin_la_opcion_el_tornero_agarra_la_fresadora_si_el_fresador_esta_ocupado(solver_rapido):
    plan = _resolver(False)
    assert {r["id_operario"] for r in plan.values()} == {ALEJANDRO, GUSTAVO}


def test_con_la_opcion_los_dos_fresados_son_del_fresador_uno_atras_del_otro(solver_rapido):
    plan = _resolver(True)
    assert {r["id_operario"] for r in plan.values()} == {ALEJANDRO}
    assert not any(r["excedente"] or r["sin_asignar"] for r in plan.values())
    inicios = sorted(r["fecha_inicio_estimada"][11:16] for r in plan.values())
    assert inicios[0] == "07:00" and inicios[1] > "08:00"


def test_si_no_hay_nadie_de_skill_1_lo_hace_el_de_skill_2(solver_rapido):
    solo_tornero = {GUSTAVO: (2, 0)}
    paso = (1, 68, 1, None, "normal", 60, [OFICIAL], "FRESADO CONVENCIONAL", False, "", solo_tornero)
    resultados, _ = PS._resolver_planificacion(
        [paso], [(GUSTAVO, OFICIAL)], [], None, None, {}, {}, {}, {}, set(), {},
        _cal(GUSTAVO), [], {}, {}, None, LUNES, cada_uno_en_lo_suyo=True)
    assert resultados[0]["id_operario"] == GUSTAVO
