"""Horas extra el sábado y un eventual, sólo para un plan.

Lucas, 28/10/2026, con la FRESADORA CNC cargada para 10 jornadas: que el plan diga
cuántas horas extra hacen falta y se puedan forzar, o que se pueda sumar un eventual del
grupo Z como CNC esa semana. En el taller la hora extra es el sábado a la mañana (07 a
12), y el sábado ya tiene su lugar en la línea de tiempo del plan: sumarlo para una
persona no corre ninguna fecha. El eventual es un puesto VACANTE que en ese plan cuenta
como una persona, sólo los sábados que le toquen.

Sin tocar la base.
"""
from datetime import date, datetime

from backend.application import PlanificacionService as PS
from backend.application.DiagnosticoPlanificacion import (
    _soluciones_de_horas_extra,
    _trabajo_en_puestos_vacantes,
)
from backend.application.PlanificacionService import (
    Ventana,
    _ventana_prohibida_para,
    con_horas_extra,
    sabados_del_periodo,
)
from backend.tests.test_planificador_dias import OFICIAL, VIERNES, _cal, _paso, solver_rapido  # noqa: F401

SABADO = date(2026, 10, 3)
OTRO_SABADO = date(2026, 10, 10)
VEGA, ZANOTTI, VACANTE_CNC = 37, 38, 20
FRESADORA_CNC = 12


def _ventana(fecha: date) -> Ventana:
    weekday = fecha.weekday()
    return Ventana(ini=0, fin=120, weekday=weekday, ini_dia=0, fin_dia=120, fecha=fecha, tope=None)


# ───────────────────────── el calendario ─────────────────────────

def test_el_sabado_de_horas_extra_es_de_esa_persona_y_de_ese_dia():
    cal = con_horas_extra(_cal(VEGA, ZANOTTI), [{"operario_id": VEGA, "fecha": SABADO}])
    assert not _ventana_prohibida_para(cal[VEGA], _ventana(SABADO))
    # Otro sábado no, y a los demás tampoco.
    assert _ventana_prohibida_para(cal[VEGA], _ventana(OTRO_SABADO))
    assert _ventana_prohibida_para(cal[ZANOTTI], _ventana(SABADO))
    # Y de semana sigue igual.
    assert not _ventana_prohibida_para(cal[VEGA], _ventana(date(2026, 10, 2)))


def test_no_toca_los_calendarios_de_la_base():
    base = _cal(VEGA)
    con_horas_extra(base, [{"operario_id": VEGA, "fecha": SABADO}])
    assert "sabados" not in base[VEGA] or not base[VEGA]["sabados"]


def test_la_fecha_puede_venir_como_texto():
    """Desde el navegador, el ajuste guardado en un borrador vuelve como texto."""
    cal = con_horas_extra(_cal(VEGA), [{"operario_id": VEGA, "fecha": "2026-10-03"}])
    assert not _ventana_prohibida_para(cal[VEGA], _ventana(SABADO))


def test_el_eventual_trabaja_solo_los_sabados_que_le_tocan():
    cal = con_horas_extra(_cal(VEGA), [{"operario_id": VACANTE_CNC, "fecha": SABADO}], [VACANTE_CNC])
    assert not _ventana_prohibida_para(cal[VACANTE_CNC], _ventana(SABADO))
    assert _ventana_prohibida_para(cal[VACANTE_CNC], _ventana(date(2026, 10, 2)))


def test_con_horas_extra_el_viernes_sigue_cerrando_a_las_16():
    """El sábado de horas extra tiene ventanas, pero lo del viernes termina el viernes:
    si no, lo que arranca el viernes a la tarde de cualquiera seguía el sábado."""
    viernes = date(2026, 10, 2)
    v = PS.construir_ventanas_semanales(1, viernes, [], fecha_hasta=SABADO, incluir_sabado=False,
                                        sabados_extra={SABADO})
    del_viernes = [x for x in v if x.fecha == viernes]
    del_sabado = [x for x in v if x.fecha == SABADO]
    assert del_sabado and del_viernes
    assert all(x.tope == del_viernes[-1].fin for x in del_viernes)
    # Y la línea de tiempo no se corre: el sábado arranca donde terminó el viernes.
    assert del_sabado[0].ini == del_viernes[-1].fin


# ───────────────────────── de punta a punta, con el solver ─────────────────────────

def _resolver(procesos, ops, calendarios, fecha_hasta):
    operarios = [(o, OFICIAL) for o in ops]
    resultados, _ = PS._resolver_planificacion(
        procesos, operarios, [], None, fecha_hasta, {}, {}, {}, {}, set(), {},
        calendarios, [], {}, {}, None, VIERNES)
    return resultados


def test_con_el_sabado_entra_lo_que_el_viernes_no(solver_rapido):
    """Arrancando el viernes y con tope el sábado: seis pasos de 100 para una persona.

    Un paso tiene que entrar entero en el tramo donde arranca (7-9, 9:15-12, 12:45-16):
    el viernes entran cuatro. Sin el sábado, dos quedan afuera; con el sábado de horas
    extra (7 a 12) entran todos, y los que no entraron el viernes se hacen el sábado.
    """
    pasos = [_paso(1, s, 100) for s in range(1, 7)]
    # (el «sin» igual: nadie trabaja los sábados, ni de horas extra)
    sin = _resolver(pasos, (VEGA,), _cal(VEGA), SABADO)
    assert any(r["excedente"] for r in sin)

    con = _resolver(pasos, (VEGA,), con_horas_extra(_cal(VEGA), [{"operario_id": VEGA, "fecha": SABADO}]), SABADO)
    assert not any(r["excedente"] for r in con), [r["secuencia"] for r in con if r["excedente"]]
    del_sabado = [r for r in con if r["fecha_inicio_estimada"].startswith("2026-10-03")]
    assert del_sabado, [r["fecha_inicio_estimada"] for r in con]
    # El sábado es de 7 a 12: nada termina después del mediodía.
    assert all(r["fecha_fin_estimada"] <= "2026-10-03T12:00:00" for r in del_sabado)


def _un_paso_el_sabado(maquina, maquinas_del_sabado):
    """Un paso que sólo puede ir el sábado, con Vega y en `maquina`: ¿se puede?"""
    from ortools.sat.python import cp_model
    model = cp_model.CpModel()
    key = (1, 1)
    inicio = {key: model.NewIntVar(0, 300, "ini")}
    op = {key: model.NewIntVarFromDomain(cp_model.Domain.FromValues([VEGA]), "op")}
    maq = {key: model.NewIntVarFromDomain(cp_model.Domain.FromValues([maquina]), "maq")}
    presente = {key: model.NewConstant(1)}
    sabado = Ventana(ini=0, fin=300, weekday=5, ini_dia=0, fin_dia=300, fecha=SABADO, tope=None)
    cal = con_horas_extra(_cal(VEGA), [{"operario_id": VEGA, "fecha": SABADO, "maquinarias": maquinas_del_sabado}])
    PS._agregar_ventanas_horarias(model, [(1, 100, 1)], inicio, {key: 60}, [sabado],
                                  presente_vars=presente, operario_vars=op, calendarios=cal, maq_vars=maq)
    return cp_model.CpSolver().Solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)


def test_el_sabado_de_horas_extra_no_es_para_pasos_sin_persona():
    """El paso sólo lo puede hacer «nadie» (el operario de mentira): el sábado no va."""
    from ortools.sat.python import cp_model
    model = cp_model.CpModel()
    key = (1, 1)
    inicio = {key: model.NewIntVar(0, 300, "ini")}
    op = {key: model.NewIntVarFromDomain(cp_model.Domain.FromValues([999999]), "op")}
    presente = {key: model.NewConstant(1)}
    sabado = Ventana(ini=0, fin=300, weekday=5, ini_dia=0, fin_dia=300, fecha=SABADO, tope=None)
    cal = con_horas_extra(_cal(VEGA), [{"operario_id": VEGA, "fecha": SABADO}])
    PS._agregar_ventanas_horarias(model, [(1, 100, 1)], inicio, {key: 60}, [sabado],
                                  presente_vars=presente, operario_vars=op, calendarios=cal)
    assert cp_model.CpSolver().Solve(model) == cp_model.INFEASIBLE


def test_el_sabado_de_horas_extra_es_para_esa_maquina():
    """Con Vega el sábado para la FRESADORA CNC, el plan lo usaba para soldar (31/10)."""
    assert _un_paso_el_sabado(FRESADORA_CNC, [FRESADORA_CNC])
    assert not _un_paso_el_sabado(24, [FRESADORA_CNC])
    # Sin máquinas, el sábado es para lo que sea.
    assert _un_paso_el_sabado(24, [])


# ───────────────────────── el período ─────────────────────────

def test_los_sabados_del_periodo():
    lunes = datetime(2026, 11, 2, 7, 0)
    assert sabados_del_periodo(lunes, date(2026, 11, 6), [], []) == []
    assert sabados_del_periodo(lunes, date(2026, 11, 14), [], []) == [date(2026, 11, 7), date(2026, 11, 14)]
    # Un sábado bloqueado (feriado) no cuenta.
    assert sabados_del_periodo(lunes, date(2026, 11, 14), [], ["2026-11-07"]) == [date(2026, 11, 14)]
    # Sin fecha tope, hasta el último paso del plan.
    plan = [{"fecha_fin_estimada": "2026-11-09T10:00:00"}]
    assert sabados_del_periodo(lunes, None, plan, []) == [date(2026, 11, 7)]


# ───────────────────────── el aviso ─────────────────────────

NOMBRES = {VEGA: "MATIAS VEGA", ZANOTTI: "PABLO ZANOTTI", VACANTE_CNC: "VACANTE OFICIAL CNC A CUBRIR"}
PLAN = [
    {"orden_id": 1, "secuencia": 1, "id_operario": VEGA, "id_maquinaria": FRESADORA_CNC, "duracion_min": 300},
    {"orden_id": 2, "secuencia": 1, "id_operario": ZANOTTI, "id_maquinaria": FRESADORA_CNC, "duracion_min": 100},
    {"orden_id": 3, "secuencia": 1, "id_operario": ZANOTTI, "id_maquinaria": 5, "duracion_min": 900},
]
HE = {"sabados": [date(2026, 11, 7)], "eventuales": set(),
      "vacantes": {VACANTE_CNC: ("VACANTE OFICIAL CNC A CUBRIR", {7})}}


def test_el_aviso_ofrece_el_sabado_a_quien_hace_esa_maquina_y_un_eventual():
    sol = _soluciones_de_horas_extra([FRESADORA_CNC], ["FRESADORA CNC"], {7}, 600, PLAN, HE, NOMBRES)
    sabado, eventual = sol
    # Vega y no Zanotti: Zanotti tiene más minutos en el plan, pero en otra máquina.
    assert sabado["accion"]["tipo"] == "sabado"
    assert sabado["accion"]["objetivos"] == [
        {"id": VEGA, "nombre": "Matias Vega", "fecha": "2026-11-07", "maquinas": [FRESADORA_CNC]}]
    assert "**5 h**" in sabado["texto"] and "faltan **10 h**" in sabado["texto"]
    assert eventual["accion"]["tipo"] == "eventual"
    assert eventual["accion"]["objetivos"][0]["id"] == VACANTE_CNC
    assert "OFICIAL CNC" in eventual["texto"]


def test_un_sabado_ya_puesto_en_esa_maquina_no_se_vuelve_a_ofrecer():
    """Una sola FRESADORA CNC: una segunda persona el mismo sábado no suma nada."""
    he = {**HE, "aplicados": [{"operario_id": VEGA, "fecha": date(2026, 11, 7), "maquinarias": [FRESADORA_CNC]}]}
    sol = _soluciones_de_horas_extra([FRESADORA_CNC], ["FRESADORA CNC"], {7}, 600, PLAN, he, NOMBRES)
    assert len(sol) == 1 and "accion" not in sol[0]
    assert "Ya sumaste horas extra el sábado 7/11" in sol[0]["texto"]
    # Puesto en OTRA máquina, no cuenta.
    he = {**HE, "aplicados": [{"operario_id": VEGA, "fecha": "2026-11-07", "maquinarias": [24]}]}
    sol = _soluciones_de_horas_extra([FRESADORA_CNC], ["FRESADORA CNC"], {7}, 600, PLAN, he, NOMBRES)
    assert sol[0]["accion"]["tipo"] == "sabado"


def test_el_eventual_tiene_que_tener_el_rango_del_trabajo():
    sol = _soluciones_de_horas_extra([FRESADORA_CNC], ["FRESADORA CNC"], {99}, 0, PLAN, HE, NOMBRES)
    assert [s["accion"]["tipo"] for s in sol] == ["sabado"]


def test_sin_sabado_en_el_periodo_lo_dice():
    sol = _soluciones_de_horas_extra([FRESADORA_CNC], ["FRESADORA CNC"], {7}, 600, PLAN,
                                     {**HE, "sabados": []}, NOMBRES)
    assert len(sol) == 1 and "accion" not in sol[0]
    assert "no tiene ningún sábado" in sol[0]["texto"]


def test_el_eventual_no_es_un_puesto_vacante_con_trabajo():
    plan = [{"orden_id": 1, "secuencia": 1, "id_operario": VACANTE_CNC, "duracion_min": 300}]
    assert _trabajo_en_puestos_vacantes(plan, NOMBRES)
    assert _trabajo_en_puestos_vacantes(plan, NOMBRES, eventuales={VACANTE_CNC}) == []
