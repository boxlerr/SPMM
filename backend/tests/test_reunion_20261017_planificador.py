"""
Lo que pidió Lucas en la reunión del 17/10/2026 sobre el planificador, mirando el plan
del lunes 19 en la vista previa:

  · tercerizado: «cuando se manda a tercerizar habría que ponerle cuándo te lo va a
    devolver el proveedor. Si tarda 10 días, vos le terminaste de hacer el 19, recién
    volvería al 29», y lo que sigue de la OT se corre hasta ese día;
  · especialidad: «el fresador es Alejandro, Gustavo es tornero» — después de las fechas,
    que los de SKILL 1 en fresado o torneado se lleven la mayor cantidad de horas en lo
    suyo.
"""
from datetime import date, datetime

import pytest

import backend.application.PlanificacionService as PS
from backend.application.EstimacionPlan import estimar_plan
from backend.application.PlanificacionService import (
    familia_requerida_from_proceso,
    fecha_de_vuelta,
    tabla_de_vuelta,
)

LUNES_19 = datetime(2026, 10, 19, 7, 0)
LEJOS = datetime(2026, 12, 31)
OFICIAL, TERCERIZADO = 6, 13
ALEJANDRO, GUSTAVO = 34, 35
FRESADO, TORNEADO = 68, 151


def _cal(*ops):
    return {o: {"dias": {0, 1, 2, 3, 4}, "desde": 0, "hasta": PS.MIN_LABORAL_DIA,
                "desde_sab": 0, "hasta_sab": PS.MIN_LABORAL_SABADO} for o in ops}


def _paso(ot, sec, minutos, nombre, rangos, proc=100, skills=None, prometida=LEJOS):
    usa = PS.proceso_usa_maquina(nombre, es_tercerizado=TERCERIZADO in rangos)
    fam = familia_requerida_from_proceso(nombre) if usa else ""
    return (ot, proc, sec, prometida, "normal", minutos, list(rangos), nombre, usa, fam,
            skills or {})


def _resolver(procesos, operarios, maquinas=(), demoras=None):
    ops = sorted({o for o, _r in operarios})
    resultados, _ = PS._resolver_planificacion(
        procesos, list(operarios), list(maquinas), None, None, {}, {}, {}, {}, set(),
        {}, _cal(*ops), [], {}, {}, None, LUNES_19, demoras)
    return {(r["orden_id"], r["secuencia"]): r for r in resultados if not r.get("slot_extra")}


@pytest.fixture
def solver_rapido(monkeypatch):
    monkeypatch.setenv("SOLVER_TECHO_SEG", "20")
    monkeypatch.setenv("SOLVER_CORTE_SIN_MEJORA_SEG", "3")
    monkeypatch.setenv("SOLVER_WORKERS", "4")


# ── El día que vuelve del proveedor ─────────────────────────────────────────

def test_la_cuenta_de_lucas_sale_el_19_y_vuelve_el_29():
    assert fecha_de_vuelta(date(2026, 10, 19), 10) == date(2026, 10, 29)


def test_si_cae_domingo_feriado_o_sabado_sin_gente_vuelve_el_proximo_dia_que_se_trabaja():
    # 19/10 + 6 = domingo 25: vuelve el lunes 26.
    assert fecha_de_vuelta(date(2026, 10, 19), 6) == date(2026, 10, 26)
    # Sábado 24, sin nadie los sábados: también el lunes.
    assert fecha_de_vuelta(date(2026, 10, 19), 5, incluir_sabado=False) == date(2026, 10, 26)
    assert fecha_de_vuelta(date(2026, 10, 19), 5) == date(2026, 10, 24)
    # El 29 es feriado: vuelve el 30.
    assert fecha_de_vuelta(date(2026, 10, 19), 10, ["2026-10-29"]) == date(2026, 10, 30)


def test_la_tabla_del_modelo_dice_lo_mismo_que_el_calendario():
    ventanas = PS.construir_ventanas_semanales(4, date(2026, 10, 19), ["2026-10-29"],
                                               incluir_sabado=False)
    vuelta = tabla_de_vuelta(ventanas, 10)
    for idx, v in enumerate(ventanas):
        esperado = fecha_de_vuelta(v.fecha, 10, ["2026-10-29"], incluir_sabado=False)
        minuto = vuelta[idx]
        if minuto is None:
            assert esperado > ventanas[-1].fecha
            continue
        # Vuelve a la APERTURA de ese día: la primera ventana de esa fecha.
        primera = next(w for w in ventanas if w.fecha == esperado)
        assert minuto == primera.ini


# ── El plan espera al proveedor ─────────────────────────────────────────────

def _ot_con_tercerizado():
    torno = [(1, {OFICIAL}, "TORNO 1", "TORY-1", "TORNO")]
    procesos = [
        _paso(1, 1, 60, "TORNEADO", [OFICIAL], proc=TORNEADO),
        _paso(1, 2, 60, "VULCANIZADO EN CAUCHO", [TERCERIZADO], proc=175),
        _paso(1, 3, 60, "ARMADO", [OFICIAL], proc=10),
    ]
    return procesos, [(GUSTAVO, OFICIAL)], torno


def test_lo_que_sigue_al_tercerizado_arranca_cuando_vuelve_del_proveedor(solver_rapido):
    procesos, operarios, maquinas = _ot_con_tercerizado()
    filas = _resolver(procesos, operarios, maquinas, demoras={(1, 2): 10})

    torneado, afuera, armado = filas[(1, 1)], filas[(1, 2)], filas[(1, 3)]
    assert torneado["fecha_inicio_estimada"].startswith("2026-10-19")
    assert afuera["tercerizado"] is True
    assert afuera["vuelve_el"] == "2026-10-29"
    assert afuera["demora_dias"] == 10
    # Sale el mismo 19, cuando termina el torneado, y vuelve el 29 a primera hora.
    assert afuera["fecha_inicio_estimada"].startswith("2026-10-19")
    assert afuera["fecha_fin_estimada"] == "2026-10-29T07:00:00"
    assert afuera["id_operario"] is None and afuera["id_maquinaria"] is None
    assert armado["fecha_inicio_estimada"] >= "2026-10-29T07:00"
    assert not armado["excedente"]


# ── Lo que vuelve después del último día del plan ──────────────────────────

def _ventanas_19_al_23():
    return PS.construir_ventanas_semanales(1, date(2026, 10, 19), [], fecha_hasta=date(2026, 10, 23),
                                           incluir_sabado=False)


def test_los_dias_de_despues_del_plan_se_cuentan_como_si_el_plan_siguiera():
    ventanas = _ventanas_19_al_23()
    viernes = max(v.fin for v in ventanas if v.fecha == date(2026, 10, 23))
    # El lunes 26 abre donde cerró el viernes (sin sábados) y cierra una jornada después.
    assert PS._minuto_despues_del_plan(date(2026, 10, 26), ventanas, cierre=False) == viernes
    assert PS._minuto_despues_del_plan(date(2026, 10, 26), ventanas, cierre=True) == viernes + PS.MIN_LABORAL_DIA
    # Sale el lunes 19 → vuelve el jueves 29 (tres jornadas después del lunes 26);
    # sale el jueves 22 → domingo 1/11 → lunes 2/11 (cinco jornadas).
    vueltas = PS._vueltas_extendidas(ventanas, 10)
    lunes = next(i for i, v in enumerate(ventanas) if v.fecha == date(2026, 10, 19))
    jueves = next(i for i, v in enumerate(ventanas) if v.fecha == date(2026, 10, 22))
    assert vueltas[lunes] == viernes + 3 * PS.MIN_LABORAL_DIA
    assert vueltas[jueves] == viernes + 5 * PS.MIN_LABORAL_DIA
    # La fecha prometida de después del plan: el CIERRE de ese día.
    assert PS._entrega_extendida(date(2026, 10, 30), ventanas) == viernes + 5 * PS.MIN_LABORAL_DIA
    assert PS._entrega_extendida(date(2026, 10, 21), ventanas) == PS.minuto_de_entrega(date(2026, 10, 21), ventanas)
    assert PS._entrega_extendida(date(1950, 1, 1), ventanas) is None


def _vuelve_despues_del_plan():
    """Plan del 19 al 23/10, un solo tornero. La OT 1 va al proveedor 10 días y está
    prometida para el 29: mandada el lunes vuelve el 29 y llega; mandada el martes, ya
    no. La OT 2 es una semana de torno que ya viene atrasada (prometida el miércoles)."""
    torno = [(1, {OFICIAL}, "TORNO 1", "TORY-1", "TORNO")]
    el_29 = datetime(2026, 10, 29)
    procesos = [
        _paso(1, 1, 60, "TORNEADO", [OFICIAL], proc=TORNEADO, prometida=el_29),
        _paso(1, 2, 60, "VULCANIZADO EN CAUCHO", [TERCERIZADO], proc=175, prometida=el_29),
        _paso(1, 3, 120, "ARMADO", [OFICIAL], proc=10, prometida=el_29),
        *[_paso(2, s, 480, "TORNEADO", [OFICIAL], proc=TORNEADO, prometida=datetime(2026, 10, 21))
          for s in range(1, 5)],
    ]
    resultados, _ = PS._resolver_planificacion(
        procesos, [(GUSTAVO, OFICIAL)], torno, None, date(2026, 10, 23), {}, {}, {}, {}, set(),
        {}, _cal(GUSTAVO), [], {}, {}, None, LUNES_19, {(1, 2): 10})
    return {(r["orden_id"], r["secuencia"]): r for r in resultados if not r.get("slot_extra")}


def test_si_vuelve_despues_del_plan_igual_sale_a_tiempo_de_llegar(solver_rapido):
    """Medido el 19/10/2026 con el plan del 17/10: si la pieza volvía después del último
    día del plan, al solver le daba lo mismo cuándo mandarla (lo que sigue queda afuera
    igual) y la mandaba el jueves: volvía el 2/11, después de la fecha prometida."""
    filas = _vuelve_despues_del_plan()
    assert filas[(1, 1)]["fecha_inicio_estimada"].startswith("2026-10-19")
    assert filas[(1, 2)]["vuelve_el"] == "2026-10-29"
    # El armado es después del plan: queda afuera, para cuando vuelva.
    assert filas[(1, 3)]["excedente"]


def test_sin_cobrar_la_vuelta_la_mandaba_tarde(solver_rapido, monkeypatch):
    """El mismo caso sin el cobro de la vuelta: así estaba, y así se ve que la prueba de
    arriba mide algo."""
    monkeypatch.setattr(PS, "_vueltas_extendidas", lambda ventanas, dias: [None] * len(ventanas))
    filas = _vuelve_despues_del_plan()
    assert filas[(1, 2)]["vuelve_el"] > "2026-10-29"


def test_sin_dias_el_tercerizado_sigue_como_antes(solver_rapido):
    procesos, operarios, maquinas = _ot_con_tercerizado()
    filas = _resolver(procesos, operarios, maquinas)
    assert "vuelve_el" not in filas[(1, 2)]
    assert filas[(1, 3)]["fecha_inicio_estimada"].startswith("2026-10-19")


def test_con_fecha_tope_antes_de_la_vuelta_lo_que_sigue_queda_afuera(solver_rapido):
    procesos, operarios, maquinas = _ot_con_tercerizado()
    resultados, _ = PS._resolver_planificacion(
        procesos, list(operarios), list(maquinas), None, date(2026, 10, 23), {}, {}, {}, {},
        set(), {}, _cal(GUSTAVO), [], {}, {}, None, LUNES_19, {(1, 2): 10})
    filas = {(r["orden_id"], r["secuencia"]): r for r in resultados}
    assert filas[(1, 2)]["vuelve_el"] == "2026-10-29"
    assert filas[(1, 3)]["excedente"], "vuelve el 29: el armado no entra en una semana que termina el 23"


def test_el_paso_1_tambien_cuenta_los_dias_del_proveedor():
    procesos, operarios, maquinas = _ot_con_tercerizado()
    sin = estimar_plan(procesos, operarios, maquinas, None, None, {}, {}, {}, {}, set(), {},
                       _cal(GUSTAVO), [], {}, {}, LUNES_19)
    con = estimar_plan(procesos, operarios, maquinas, None, None, {}, {}, {}, {}, set(), {},
                       _cal(GUSTAVO), [], {}, {}, LUNES_19, demoras={(1, 2): 10})
    assert sin["fin_estimado"].startswith("2026-10-19")
    assert con["fin_estimado"] >= "2026-10-29"
    # La carga del cartel es la misma: los minutos de la OT no cambian.
    assert con["carga_min"] == sin["carga_min"] == 180


def test_la_fila_del_plan_lleva_el_proveedor_y_los_minutos_de_la_ot():
    filas = [{"orden_id": 1, "secuencia": 2, "duracion_min": 1, "demora_dias": 10,
              "vuelve_el": "2026-10-29", "tercerizado": True},
             {"orden_id": 1, "secuencia": 4, "duracion_min": 30, "tercerizado": False}]
    tercerizados = {
        (1, 2): {"id_proveedor": 7, "proveedor_nombre": "VULCANIZADORA DE PRUEBA SRL", "demora_dias": 10,
                 "demora_del_paso": None, "demora_del_proveedor": 10},
        # Tercerizado por el RANGO y no por el nombre, y sin días: la marca igual va.
        (1, 4): {"id_proveedor": None, "proveedor_nombre": None, "demora_dias": None,
                 "demora_del_paso": None, "demora_del_proveedor": None},
    }
    PS._marcar_tercerizados(filas, tercerizados, {(1, 2): 60, (1, 4): 30})
    assert filas[0]["proveedor_nombre"] == "VULCANIZADORA DE PRUEBA SRL"
    assert filas[0]["duracion_min"] == 60
    assert filas[1]["tercerizado"] is True and "vuelve_el" not in filas[1]


# ── Cada uno en lo suyo ─────────────────────────────────────────────────────

FRESAS = [(1, {OFICIAL}, "FRESADORA 1", "FRES-1", "FRESADORA"),
          (2, {OFICIAL}, "FRESADORA 2", "FRES-2", "FRESADORA")]
SKILLS_FRESADO = {ALEJANDRO: (1, 0), GUSTAVO: (2, 1)}


def test_el_fresado_largo_va_al_fresador(solver_rapido):
    """Dos fresados a la vez y dos personas: uno de los dos tiene que ir a Gustavo (SKILL 2).
    Para el solver los dos repartos cuestan lo mismo —la preferencia es por paso—; con los
    horarios ya fijos, el de 120 minutos tiene que ser de Alejandro (SKILL 1) y Gustavo se
    queda con el de 20."""
    procesos = [
        _paso(1, 1, 120, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
        _paso(2, 1, 20, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
    ]
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL)]
    for _ in range(3):   # el solver usa varios hilos: que salga igual siempre
        filas = _resolver(procesos, operarios, FRESAS)
        if filas[(1, 1)]["fecha_inicio_estimada"] == filas[(2, 1)]["fecha_inicio_estimada"]:
            assert filas[(1, 1)]["id_operario"] == ALEJANDRO
            assert filas[(2, 1)]["id_operario"] == GUSTAVO
        else:
            # Si el solver los puso uno detrás del otro, los dos son del fresador.
            assert {filas[(1, 1)]["id_operario"], filas[(2, 1)]["id_operario"]} == {ALEJANDRO}


def test_el_reparto_por_especialidad_no_mueve_horarios_ni_maquinas(solver_rapido, monkeypatch):
    """El caso del 19/10 en chico: un torneado y un fresado a la vez, cada uno en su máquina.
    Con el reparto apagado puede salir cruzado; con el reparto, cada uno en lo suyo, y los
    horarios y las máquinas son los del solver."""
    torno_y_fresa = [(1, {OFICIAL}, "TORNO 1", "TORY-1", "TORNO"),
                     (2, {OFICIAL}, "FRESADORA 1", "FRES-1", "FRESADORA")]
    procesos = [
        _paso(1, 1, 120, "TORNEADO", [OFICIAL], proc=TORNEADO,
              skills={GUSTAVO: (1, 0), ALEJANDRO: (2, 8)}),
        _paso(2, 1, 120, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
    ]
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL)]
    filas = _resolver(procesos, operarios, torno_y_fresa)
    assert filas[(1, 1)]["id_operario"] == GUSTAVO
    assert filas[(2, 1)]["id_operario"] == ALEJANDRO
    assert filas[(1, 1)]["id_maquinaria"] == 1 and filas[(2, 1)]["id_maquinaria"] == 2


class _PlanDado:
    """Hace de solver: devuelve el plan que se le da, para probar el reparto por
    especialidad sobre un plan cruzado a propósito (el solver, en casos chicos, ya sale
    bien y no dejaría ver nada)."""

    def __init__(self, valores):
        self.valores = valores

    def Value(self, var):  # noqa: N802 — la misma firma que cp_model.CpSolver
        return self.valores[var.Index()]


def _reparto_sobre(procesos, operarios, maquinas, plan, preseleccion_op=None, extra=None):
    """Arma el modelo como el solver y le pasa a `_reasignar_por_especialidad` el plan
    dado: {(ot, sec): (inicio, persona, máquina)}. Devuelve {(ot, sec): persona nueva}."""
    from ortools.sat.python import cp_model

    pn, _h = PS._normalizar_procesos(procesos, PS.PRIORIDAD_PESOS)
    pn, cant, pmaq, pop, partes = PS._partir_y_heredar(pn, extra or {}, {}, preseleccion_op or {})
    setup_de = PS._setup_hereda_de(pn, partes)
    modelo = cp_model.CpModel()
    (ini, fin, _itv, op, maq, dur, op_to_rango, _reales, DOP, _rmaq, DMAQ, maq_to_rangos,
     maq_to_familia, op_dom, maq_dom, pres, extras) = PS._crear_variables_y_dominios(
        modelo, pn, operarios, maquinas, {1, 11}, {8, 14}, {}, cant, pmaq, {}, set(), {},
        pop, {}, setup_de=setup_de)
    op_to_rangos = {}
    for o, r in operarios:
        op_to_rangos.setdefault(o, set()).add(r)
    pares = PS._pares_permitidos(pn, op_dom, maq_dom, op_to_rango, maq_to_rangos,
                                 maq_to_familia, DOP, DMAQ, op_to_rangos, {}, setup_de)
    valores = {}
    for (o_id, sec), (inicio, persona, maquina) in plan.items():
        k = partes[(o_id, sec)]["claves"][0]
        valores[ini[k].Index()] = inicio
        valores[fin[k].Index()] = inicio + dur[k]
        valores[pres[k].Index()] = 1
        valores[op[k].Index()] = persona
        valores[maq[k].Index()] = maquina
    for k, evs in extras.items():
        for ev in evs:
            valores[ev.Index()] = (extra or {}).get(("acompañante", k[0]), DOP)
    ventanas = PS.construir_ventanas_semanales(2, date(2026, 10, 19), [], incluir_sabado=False)
    ops = sorted({o for o, _r in operarios})
    cambios = PS._reasignar_por_especialidad(
        _PlanDado(valores), pn, partes, ini, fin, op, maq, pres, extras, op_dom, pares,
        _cal(*ops), ventanas, op_to_rangos, {1, 11}, 50, DOP)
    return {(k[0], k[1] // PS.ESCALA_SECUENCIA): o for k, o in cambios.items()}


TORNO_Y_FRESA = [(1, {OFICIAL}, "TORNO 1", "TORY-1", "TORNO"),
                 (2, {OFICIAL}, "FRESADORA 1", "FRES-1", "FRESADORA")]
SKILLS_TORNEADO = {GUSTAVO: (1, 0), ALEJANDRO: (2, 8)}


def test_con_el_plan_cruzado_del_19_cada_uno_vuelve_a_lo_suyo():
    """El plan que vio Lucas: a la misma hora, Alejandro en el torno y Gustavo en la
    fresadora. Con los mismos horarios y las mismas máquinas, se cambian las personas."""
    procesos = [
        _paso(1, 1, 120, "TORNEADO", [OFICIAL], proc=TORNEADO, skills=SKILLS_TORNEADO),
        _paso(2, 1, 120, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
    ]
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL)]
    cruzado = {(1, 1): (0, ALEJANDRO, 1), (2, 1): (0, GUSTAVO, 2)}
    assert _reparto_sobre(procesos, operarios, TORNO_Y_FRESA, cruzado) == {
        (1, 1): GUSTAVO, (2, 1): ALEJANDRO}


def test_el_que_ya_esta_en_lo_suyo_no_se_toca():
    procesos = [
        _paso(1, 1, 120, "TORNEADO", [OFICIAL], proc=TORNEADO, skills=SKILLS_TORNEADO),
        _paso(2, 1, 120, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
    ]
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL)]
    bien = {(1, 1): (0, GUSTAVO, 1), (2, 1): (0, ALEJANDRO, 2)}
    assert _reparto_sobre(procesos, operarios, TORNO_Y_FRESA, bien) == {}


def test_entre_dos_fresados_el_largo_es_del_fresador():
    """Dos fresados a la vez: uno es de Gustavo sí o sí. Para el solver da igual cuál (la
    preferencia es por paso); por minuto, el de 120 es de Alejandro."""
    procesos = [
        _paso(1, 1, 120, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
        _paso(2, 1, 20, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
    ]
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL)]
    al_reves = {(1, 1): (0, GUSTAVO, 1), (2, 1): (0, ALEJANDRO, 2)}
    assert _reparto_sobre(procesos, operarios, FRESAS, al_reves) == {
        (1, 1): ALEJANDRO, (2, 1): GUSTAVO}


def test_no_cambia_si_el_otro_esta_ocupado_en_ese_horario():
    """Alejandro está en un trabajo que no se puede mover (va de a dos, con Gustavo
    ayudando no: con otro): el fresado no puede pasar a él porque se pisarían."""
    procesos = [
        _paso(1, 1, 120, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
        _paso(2, 1, 120, "ARMADO", [OFICIAL], proc=10),
    ]
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL), (37, OFICIAL)]
    plan = {(1, 1): (0, GUSTAVO, 1), (2, 1): (0, ALEJANDRO, 999998)}
    # El armado va de a dos (Alejandro y Matías): queda fijo y ocupa a Alejandro.
    extra = {(2, 1): 2, ("acompañante", 2): 37}
    assert _reparto_sobre(procesos, operarios, FRESAS, plan, extra=extra) == {}


def test_la_persona_elegida_en_la_ot_no_se_cambia_en_el_reparto():
    procesos = [
        _paso(1, 1, 120, "TORNEADO", [OFICIAL], proc=TORNEADO, skills=SKILLS_TORNEADO),
        _paso(2, 1, 120, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
    ]
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL)]
    cruzado = {(1, 1): (0, ALEJANDRO, 1), (2, 1): (0, GUSTAVO, 2)}
    # El torneado lo eligió el que cargó la OT: Alejandro. El fresado queda en Gustavo,
    # porque Alejandro está ocupado en el torneado a esa hora.
    assert _reparto_sobre(procesos, operarios, TORNO_Y_FRESA, cruzado,
                          preseleccion_op={(1, 1): ALEJANDRO}) == {}


def test_una_persona_elegida_en_la_ot_no_se_cambia(solver_rapido):
    procesos = [
        _paso(1, 1, 120, "FRESADO CONVENCIONAL", [OFICIAL], proc=FRESADO, skills=SKILLS_FRESADO),
    ]
    operarios = [(ALEJANDRO, OFICIAL), (GUSTAVO, OFICIAL)]
    resultados, _ = PS._resolver_planificacion(
        procesos, list(operarios), list(FRESAS), None, None, {}, {}, {}, {}, set(), {},
        _cal(ALEJANDRO, GUSTAVO), [], {(1, 1): GUSTAVO}, {}, None, LUNES_19)
    assert resultados[0]["id_operario"] == GUSTAVO


# ── Guardar el proveedor en el paso de la OT ────────────────────────────────

async def _ot_con_paso_tercerizado(session, ots=(1,)):
    from backend.domain.Articulo import Articulo
    from backend.domain.Cliente import Cliente
    from backend.domain.EstadoProceso import EstadoProceso
    from backend.domain.OrdenTrabajo import OrdenTrabajo
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
    from backend.domain.Prioridad import Prioridad
    from backend.domain.Proceso import Proceso
    from backend.domain.Proveedor import Proveedor
    from backend.domain.Sector import Sector

    session.add_all([
        Prioridad(id=1, descripcion="Normal"), Sector(id=1, nombre="TALLER"),
        Articulo(id=1, cod_articulo="FC-1", descripcion="Frente de carro", abreviatura="FC"),
        Cliente(id=1, nombre="UN CLIENTE"), EstadoProceso(id=1, descripcion="Pendiente"),
        Proceso(id=175, nombre="VULCANIZADO EN CAUCHO"),
        Proveedor(id=7, razon_social="VULCANIZADORA DE PRUEBA SRL", fantasia="LA VULCA"),
        Proveedor(id=8, razon_social="OTRO PROVEEDOR SA", demora_dias=5),
    ])
    for n, ot in enumerate(ots):
        session.add(OrdenTrabajo(
            id=ot, id_otvieja=15800 + ot, id_prioridad=1, id_sector=1, id_articulo=1,
            id_cliente=1, fecha_orden=datetime(2026, 10, 1 + n), fecha_entrada=datetime(2026, 10, 1),
            fecha_prometida=datetime(2026, 10, 30)))
        session.add(OrdenTrabajoProceso(id=100 + ot, id_orden_trabajo=ot, id_proceso=175,
                                        orden=1, tiempo_proceso=60))
    await session.commit()


@pytest.mark.asyncio
async def test_elegir_el_proveedor_y_sus_dias_queda_en_el_paso(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.domain.Proveedor import Proveedor

    await _ot_con_paso_tercerizado(session)
    servicio = OrdenTrabajoService(session)

    r = await servicio.editarProceso(1, 101, {"id_proveedor": 7})
    assert r.data["id_proveedor"] == 7
    assert r.data["proveedor"]["nombre"] == "VULCANIZADORA DE PRUEBA SRL", "la razón social, como el buscador"
    assert r.data["demora_efectiva"] is None, "sin días cargados no se inventa ninguno"

    # Los días de este trabajo, y que se recuerden para el proveedor.
    r = await servicio.editarProceso(1, 101, {"demora_dias": 10, "demora_del_proveedor": 10})
    assert r.data["demora_dias"] == 10 and r.data["demora_efectiva"] == 10
    assert (await session.get(Proveedor, 7)).demora_dias == 10

    # Otro proveedor, con sus días de siempre: el paso conserva los suyos.
    r = await servicio.editarProceso(1, 101, {"id_proveedor": 8, "demora_dias": None})
    assert r.data["demora_efectiva"] == 5


@pytest.mark.asyncio
async def test_el_proveedor_se_recuerda_para_el_producto(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso

    await _ot_con_paso_tercerizado(session, ots=(1, 2))
    r = await OrdenTrabajoService(session).editarProceso(
        1, 101, {"id_proveedor": 7, "para_el_articulo": True})
    assert r.data["otras_del_articulo"] == 1
    session.expire_all()
    assert (await session.get(OrdenTrabajoProceso, 102)).id_proveedor == 7


@pytest.mark.asyncio
async def test_un_proveedor_que_no_existe_se_dice_con_su_nombre(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.commons.exceptions.NotFoundException import NotFoundException

    await _ot_con_paso_tercerizado(session)
    with pytest.raises(NotFoundException, match="proveedor 999"):
        await OrdenTrabajoService(session).editarProceso(1, 101, {"id_proveedor": 999})


# ── Las habilidades de todo el equipo, de una ───────────────────────────────

@pytest.mark.asyncio
async def test_el_equipo_dice_lo_mismo_que_ve_el_planificador(session):
    """SKILL 1 y 2 con su posición, lo que sabe por el rango sin marcar, lo cargado a mano
    y lo apagado; sólo la gente disponible (los «VACANTE» son puestos, no personas)."""
    from backend.application.EquipoService import armar_equipo
    from backend.domain.Maquinaria import Maquinaria
    from backend.domain.Operario import Operario
    from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
    from backend.domain.OperarioRango import OperarioRango
    from backend.domain.Proceso import Proceso
    from backend.domain.Rango import Rango
    from backend.domain.RangoMaquinaria import RangoMaquinaria
    from backend.domain.RangoProceso import RangoProceso
    from datetime import time
    HORARIO = {"hora_inicio": time(7), "hora_fin": time(16), "dias_trabajo": "MON,TUE,WED,THU,FRI"}

    session.add_all([
        Rango(id=OFICIAL, nombre="OFICIAL"),
        Proceso(id=FRESADO, nombre="FRESADO CONVENCIONAL"), Proceso(id=TORNEADO, nombre="TORNEADO"),
        Proceso(id=10, nombre="ARMADO"), Proceso(id=20, nombre="SOLDADURA MIG"),
        Operario(id=ALEJANDRO, nombre="ALEJANDRO", apellido="GUTIERREZ", categoria="OFICIAL",
                 disponible=True, interpreta_planos=True, **HORARIO),
        Operario(id=GUSTAVO, nombre="GUSTAVO", apellido="ROMERO", categoria="OFICIAL",
                 disponible=True, **HORARIO),
        Operario(id=17, nombre="VACANTE EXTERNO", apellido="A CUBRIR", categoria="EXTERNO",
                 disponible=False, **HORARIO),
        Maquinaria(id=1, nombre="FRESADORA 1", cod_maquina="FRES-1", tipo="FRESADORA"),
    ])
    await session.flush()
    session.add_all([
        OperarioRango(id_operario=ALEJANDRO, id_rango=OFICIAL),
        OperarioRango(id_operario=GUSTAVO, id_rango=OFICIAL),
        OperarioRango(id_operario=17, id_rango=OFICIAL),
        RangoProceso(id_rango=OFICIAL, id_proceso=FRESADO),
        RangoProceso(id_rango=OFICIAL, id_proceso=TORNEADO),
        RangoProceso(id_rango=OFICIAL, id_proceso=10),
        RangoMaquinaria(id_rango=OFICIAL, id_maquinaria=1),
        OperarioProcesoSkill(id_operario=ALEJANDRO, id_proceso=FRESADO, nivel=1, orden=0),
        OperarioProcesoSkill(id_operario=ALEJANDRO, id_proceso=TORNEADO, nivel=2, orden=8),
        OperarioProcesoSkill(id_operario=GUSTAVO, id_proceso=FRESADO, nivel=2, orden=1),
        OperarioProcesoSkill(id_operario=GUSTAVO, id_proceso=10, nivel=0, habilitado=False),
        OperarioProcesoSkill(id_operario=GUSTAVO, id_proceso=20, nivel=0, manual=True),
    ])
    await session.commit()

    equipo = await armar_equipo(session)
    personas = {p["nombre"]: p for p in equipo["operarios"]}
    assert set(personas) == {"ALEJANDRO GUTIERREZ", "GUSTAVO ROMERO"}

    ale = {h["proceso"]: h["prioridad"] for h in personas["ALEJANDRO GUTIERREZ"]["habilidades"]}
    assert ale == {"FRESADO CONVENCIONAL": "SKILL 1", "TORNEADO": "SKILL 2", "ARMADO": "Sabe (sin marcar)"}
    assert personas["ALEJANDRO GUTIERREZ"]["interpreta_planos"] is True
    assert personas["ALEJANDRO GUTIERREZ"]["horario"] == "07:00 a 16:00, lun a vie"

    gus = {h["proceso"]: h for h in personas["GUSTAVO ROMERO"]["habilidades"]}
    assert gus["FRESADO CONVENCIONAL"]["prioridad"] == "SKILL 2"
    assert gus["TORNEADO"]["prioridad"] == "Sabe (sin marcar)"
    assert gus["ARMADO"]["prioridad"] == "Apagada (no la hace)"
    assert gus["SOLDADURA MIG"]["origen"] == "a_mano"
    # Las apagadas, al final de la lista.
    assert personas["GUSTAVO ROMERO"]["habilidades"][-1]["proceso"] == "ARMADO"

    assert equipo["maquinas"] == [{
        "id": 1, "nombre": "FRESADORA 1", "tipo": "FRESADORA", "familia": "FRESADORA",
        "estado": "operativa", "rangos": ["OFICIAL"], "procesos": []}]
