"""Cuántos días da el plan: calendario, fecha prometida, horizonte y jerarquía del costo.

Lucas, 25/09/2026 («Cómo planifica SPMM»): con las 48 OT del piloto el plan dio 21 días
hábiles (28/9 -> 26/10) cuando con los mismos datos entra en ~10. Eran cuatro cosas del
cálculo, no del taller:

  1. el calendario se armaba para el peor caso (todo en fila: 240 franjas por paso) y el
     solver se cortaba por tiempo con un plan malo;
  2. la fecha prometida se leía en minutos de RELOJ como si fueran de TRABAJO: las OT
     del 2/10 «vencían» el 21/10;
  3. terminar antes casi no sumaba (1 punto por minuto), y con todo vencido la suma de
     atrasos daba casi lo mismo para un plan parejo de 10 días que para uno que deja la
     última OT colgada hasta el día 15;
  4. dejar un paso sin persona costaba un millón fijo: lo mismo que atrasarlo cuatro
     jornadas, así que cuando el plan se apretaba era la salida fácil.

Y dos del arranque del solver: el reparto rápido del Paso 1 separaba la preparación de
su producción (no servía de punto de partida), y sin un plan entero de partida el solver
se pasaba ~200 s sólo en meter todo adentro.

Y un quinto, del calendario: el domingo sumaba 300 minutos que la vuelta a fecha no
cuenta. Sin gente los sábados se compensaba de casualidad; con un sábado trabajado o
un sábado feriado, cada fin de semana corría 300 minutos todas las fechas. Además, lo
que arrancaba el viernes a la tarde podía «terminar» en el hueco del sábado.

Los tests que resuelven usan modelos chicos y el presupuesto del solver al mínimo.
"""
from datetime import date, datetime, timedelta

import pytest

from backend.application import PlanificacionService as PS
from backend.application.EstimacionPlan import estimar_plan
from backend.application.PlanificacionService import (
    ATRASO_MAX_EQUIV,
    ATRASO_MULT_POR_PRIORIDAD,
    MIN_LABORAL_DIA,
    MIN_LABORAL_SABADO,
    PESO_EXCED_POR_PRIO,
    W_FIN_OT,
    W_FIN_PLAN,
    W_FUERA,
    _convertir_minutos_a_fecha,
    construir_ventanas_semanales,
    dia_del_minimo,
    minuto_de_entrega,
    penal_sin_recurso,
)

LUNES = datetime(2026, 9, 28, 7, 0)
VIERNES = datetime(2026, 10, 2, 7, 0)
OFICIAL = 3


def _hora_del_tramo(ini_dia: int, sabado: bool) -> timedelta:
    """Hora de reloj del minuto de trabajo `ini_dia` (las pausas de antes corren el reloj).

    En el borde exacto entre dos tramos la vuelta a fecha da el cierre del anterior (el
    minuto 120 son las 09:00, no las 09:15): es la misma regla de siempre.
    """
    return timedelta(minutes=ini_dia + PS.minutos_muertos_del_dia(ini_dia, sabado))


# ───────────────────────── 5. el calendario ─────────────────────────

CASOS_CALENDARIO = [
    # (nombre, sábados trabajados, días bloqueados)
    ("nadie trabaja los sábados", False, []),
    ("se trabajan los sábados", True, []),
    ("sábado trabajado pero feriado", True, ["2026-10-03"]),
    ("sin sábados y feriado entre semana", False, ["2026-10-07"]),
    ("sin sábados y sábado feriado", False, ["2026-10-10"]),
]


@pytest.mark.parametrize("nombre,sabado,feriados", CASOS_CALENDARIO, ids=[c[0] for c in CASOS_CALENDARIO])
def test_cada_ventana_se_muestra_en_su_dia(nombre, sabado, feriados):
    """El minuto donde arranca cada ventana, pasado a fecha, cae en ESE día a esa hora.

    Es el contrato entre las dos puntas: el solver elige minutos sobre estas ventanas y
    la pantalla los lee con `_convertir_minutos_a_fecha`. Con el domingo sumando 300, a
    partir del primer fin de semana (con sábado trabajado) todo se corría a las 12:15.
    """
    ventanas = construir_ventanas_semanales(4, LUNES.date(), feriados, incluir_sabado=sabado)
    assert ventanas
    for v in ventanas:
        esperado = datetime.combine(v.fecha, PS.HORA_APERTURA) + _hora_del_tramo(v.ini_dia, v.weekday == 5)
        assert _convertir_minutos_a_fecha(v.ini, LUNES, feriados) == esperado.isoformat(), (
            f"{nombre}: la ventana del {v.fecha} ({v.ini_dia}) se muestra en otro lado")
        # Y el cierre de cada tramo, leído como FIN, también es de ese día.
        fin = datetime.fromisoformat(_convertir_minutos_a_fecha(v.fin, LUNES, feriados, es_fin=True))
        assert fin.date() == v.fecha
        assert v.weekday != 6 and v.fecha.strftime("%Y-%m-%d") not in feriados
        if not sabado:
            assert v.weekday != 5, f"{nombre}: hay una ventana un sábado sin gente"


def test_el_domingo_no_existe_en_la_linea_de_tiempo():
    """Una semana con sábado trabajado son 5 × 495 + 300 minutos, no 300 más."""
    ventanas = construir_ventanas_semanales(2, LUNES.date(), [], incluir_sabado=True)
    lunes_siguiente = next(v for v in ventanas if v.fecha == date(2026, 10, 5))
    assert lunes_siguiente.ini == 5 * MIN_LABORAL_DIA + MIN_LABORAL_SABADO
    # Sin gente el sábado igual ocupa sus 300 (así lo cuenta la vuelta a fecha, acá y en
    # plan-fechas.ts), pero sin ventanas.
    sin = construir_ventanas_semanales(2, LUNES.date(), [], incluir_sabado=False)
    assert next(v for v in sin if v.fecha == date(2026, 10, 5)).ini == lunes_siguiente.ini


def test_lo_que_arranca_antes_del_hueco_termina_ese_dia():
    """Las ventanas del viernes antes de un sábado sin gente llevan `tope` = cierre del viernes."""
    ventanas = construir_ventanas_semanales(2, LUNES.date(), [], incluir_sabado=False)
    viernes = [v for v in ventanas if v.fecha == date(2026, 10, 2)]
    assert viernes and all(v.tope == 5 * MIN_LABORAL_DIA for v in viernes)
    assert all(v.tope is None for v in ventanas if v.weekday < 4)
    # Con sábado trabajado no hay hueco: el viernes sigue al sábado sin corte.
    con = construir_ventanas_semanales(2, LUNES.date(), [], incluir_sabado=True)
    assert all(v.tope is None for v in con)
    # Y con fecha tope, el último día del rango también cierra.
    rango = construir_ventanas_semanales(1, LUNES.date(), [], fecha_hasta=date(2026, 9, 30),
                                         incluir_sabado=False)
    assert {v.tope for v in rango if v.fecha == date(2026, 9, 30)} == {3 * MIN_LABORAL_DIA}


# ───────────────────────── 2. la fecha prometida ─────────────────────────

def test_la_fecha_prometida_se_cuenta_en_jornadas_del_plan():
    """Prometida el viernes 2/10, planificando desde el lunes 28/9: cinco jornadas.

    Antes eran minutos de reloj desde AHORA: del viernes 25/9 a las 11 a la medianoche
    del 2/10 hay 9.410, que el solver leía como 19 jornadas de trabajo.
    """
    ventanas = construir_ventanas_semanales(4, LUNES.date(), [], incluir_sabado=False)
    assert minuto_de_entrega(date(2026, 10, 2), ventanas) == 5 * MIN_LABORAL_DIA
    # Como datetime o como texto de la base, lo mismo: cuenta el DÍA, hasta el cierre.
    assert minuto_de_entrega(datetime(2026, 10, 2, 0, 0), ventanas) == 5 * MIN_LABORAL_DIA
    assert minuto_de_entrega("2026-10-02T00:00:00", ventanas) == 5 * MIN_LABORAL_DIA
    # Sábado o domingo sin gente: el cierre del viernes.
    assert minuto_de_entrega(date(2026, 10, 3), ventanas) == 5 * MIN_LABORAL_DIA
    assert minuto_de_entrega(date(2026, 10, 4), ventanas) == 5 * MIN_LABORAL_DIA
    # El lunes siguiente: después del hueco del sábado (300) y de una jornada más.
    assert minuto_de_entrega(date(2026, 10, 5), ventanas) == 5 * MIN_LABORAL_DIA + MIN_LABORAL_SABADO + MIN_LABORAL_DIA
    # Vencida antes de arrancar: todo lo que falta llega tarde.
    assert minuto_de_entrega(date(2026, 9, 1), ventanas) == 0
    # Sin fecha, de relleno o después del horizonte: nada puede llegar tarde.
    assert minuto_de_entrega(None, ventanas) is None
    assert minuto_de_entrega(date(1950, 1, 1), ventanas) is None
    assert minuto_de_entrega(date(2027, 1, 1), ventanas) is None


def test_un_feriado_corre_la_entrega_una_jornada_para_atras():
    ventanas = construir_ventanas_semanales(2, LUNES.date(), ["2026-10-01"], incluir_sabado=False)
    # Prometida el jueves feriado: cuenta hasta el cierre del miércoles.
    assert minuto_de_entrega(date(2026, 10, 1), ventanas) == 3 * MIN_LABORAL_DIA
    assert minuto_de_entrega(date(2026, 10, 2), ventanas) == 4 * MIN_LABORAL_DIA


# ───────────────────────── 3 y 4. la jerarquía del costo ─────────────────────────

@pytest.mark.parametrize("H", [MIN_LABORAL_DIA, 5_000, 35_000, 200_000])
def test_la_jerarquia_del_objetivo(H):
    """afuera > sin persona / sin máquina > atraso > terminar tarde en general."""
    afuera_mas_barato = W_FUERA * min(PESO_EXCED_POR_PRIO.values())
    sin_recurso = penal_sin_recurso(H)
    # Lo más que puede ahorrar soltar a la persona de un paso: H minutos de atraso al
    # multiplicador más caro en ese paso y en la OT más atrasada, más lo que se gana
    # terminando antes con el plan y la OT enteros.
    peor = max(ATRASO_MULT_POR_PRIORIDAD.values())
    peor_atraso = H * (peor + ATRASO_MAX_EQUIV * peor + W_FIN_PLAN + W_FIN_OT)
    assert afuera_mas_barato > sin_recurso > peor_atraso
    # Terminar antes, por minuto, nunca vale más que un minuto de atraso.
    assert min(ATRASO_MULT_POR_PRIORIDAD.values()) > W_FIN_PLAN > W_FIN_OT > 1


# ───────────────────────── de punta a punta, con el solver ─────────────────────────

@pytest.fixture
def solver_rapido(monkeypatch):
    """Presupuesto al mínimo: son modelos de juguete y resuelven al óptimo enseguida."""
    monkeypatch.setenv("SOLVER_TECHO_SEG", "20")
    monkeypatch.setenv("SOLVER_CORTE_SIN_MEJORA_SEG", "3")
    monkeypatch.setenv("SOLVER_WORKERS", "4")


def _cal(*ops):
    return {o: {"dias": {0, 1, 2, 3, 4}, "desde": 0, "hasta": MIN_LABORAL_DIA,
                "desde_sab": 0, "hasta_sab": MIN_LABORAL_SABADO} for o in ops}


def _paso(ot, sec, minutos, prometida=None, prioridad="normal", proc=100):
    # Mismo formato que arma planificar() para el solver.
    return (ot, proc, sec, prometida, prioridad, minutos, [OFICIAL], "ARMADO", False, "", {})


def _resolver(procesos, ops=(10,), inicio=LUNES, fecha_hasta=None, preseleccion_op=None):
    operarios = [(o, OFICIAL) for o in ops]
    resultados, _ = PS._resolver_planificacion(
        procesos, operarios, [], None, fecha_hasta, {}, {}, {}, {}, set(), {},
        _cal(*ops), [], preseleccion_op or {}, {}, None, inicio)
    return resultados


@pytest.fixture
def calendarios_vistos(monkeypatch):
    """Cuántas ventanas tuvo cada intento del solver (uno por calendario probado)."""
    vistas = []
    real = PS._agregar_ventanas_horarias

    def _espia(model, procesos_norm, inicio_vars, dur_map, ventanas, **kw):
        vistas.append(len(ventanas))
        return real(model, procesos_norm, inicio_vars, dur_map, ventanas, **kw)

    monkeypatch.setattr(PS, "_agregar_ventanas_horarias", _espia)
    return vistas


def test_la_ot_que_vence_primero_va_primero(solver_rapido):
    """Una persona, dos OT de 900 min: la prometida para el martes tiene que ir primero.

    Con la fecha leída en reloj, el martes estaba a «más de tres días» de distancia y
    las dos órdenes le daban lo mismo al solver.
    """
    urgente = [_paso(2, s, 100, prometida=datetime(2026, 9, 29)) for s in range(1, 10)]
    tranquila = [_paso(1, s, 100, prometida=datetime(2026, 12, 31)) for s in range(1, 10)]
    res = _resolver(tranquila + urgente)
    assert not any(r["excedente"] for r in res)
    fin_urgente = max(r["fecha_fin_estimada"] for r in res if r["orden_id"] == 2)
    assert fin_urgente <= "2026-09-29T16:00:00", fin_urgente


def test_dejar_un_paso_sin_persona_no_es_la_salida_facil(solver_rapido):
    """Una persona, dos OT vencidas de 15 pasos cada una: los 30 los hace ella.

    Con el «sin persona» a un millón fijo, soltar uno de los primeros pasos le ahorraba
    100 min de atraso a los ~29 que la persona hace después (100 × 500 × 29 = 1,45
    millones): convenía dejarlo sin nadie —que nunca está ocupado— y adelantar el resto.
    """
    pasos = [_paso(ot, s, 100, prometida=datetime(2026, 9, 1)) for ot in (1, 2) for s in range(1, 16)]
    res = _resolver(pasos)
    assert not any(r["excedente"] for r in res)
    assert not any(r["sin_asignar"] for r in res), [r["secuencia"] for r in res if r["sin_asignar"]]


def test_lo_del_viernes_a_la_tarde_no_termina_el_sabado(solver_rapido):
    """Arrancando un viernes: tres pasos de 100 y uno de 200 que sólo entra de tarde.

    El de 200 no llega a empezar antes de las 13:15 y ya no termina el viernes. Antes
    arrancaba igual y se mostraba terminando el sábado —que nadie trabaja—; ahora va al
    lunes.
    """
    pasos = [_paso(1, 1, 100), _paso(1, 2, 100), _paso(1, 3, 100), _paso(1, 4, 200)]
    res = _resolver(pasos, inicio=VIERNES)
    ultimo = next(r for r in res if r["secuencia"] == 4)
    assert not ultimo["excedente"]
    for campo in ("fecha_inicio_estimada", "fecha_fin_estimada"):
        assert datetime.fromisoformat(ultimo[campo]).weekday() < 5, ultimo[campo]
    assert ultimo["fecha_inicio_estimada"].startswith("2026-10-05")


def test_sin_fecha_tope_el_calendario_se_arma_hasta_el_minimo(solver_rapido, calendarios_vistos):
    """Tres personas y 18 pasos de 100 (1.800 min): el mínimo son dos jornadas.

    Antes el calendario era el del peor caso (todo en fila por una persona: una semana
    de ventanas) y el solver no tenía nada que lo apurara. Ahora el primer intento es
    hasta el día del mínimo del Paso 1, como si se hubiera pedido esa fecha tope, y
    alcanza: un solo intento, todo adentro, todos con persona, en dos días.
    """
    pasos = [_paso(ot, s, 100) for ot in range(1, 7) for s in (1, 2, 3)]
    res = _resolver(pasos, ops=(10, 11, 12))
    assert calendarios_vistos == [6], calendarios_vistos   # 2 días × 3 tramos
    assert not any(r["excedente"] or r["sin_asignar"] for r in res)
    assert max(r["fecha_fin_estimada"] for r in res) <= "2026-09-29T16:00:00"


def test_el_dia_del_minimo_sale_del_paso_1_y_del_calendario():
    # 1,2 jornadas: el martes. Con feriado el martes, el miércoles.
    assert dia_del_minimo({"jornadas_minimas": 1.2}, LUNES.date(), [], False) == date(2026, 9, 29)
    assert dia_del_minimo({"jornadas_minimas": 1.2}, LUNES.date(), ["2026-09-29"], False) == date(2026, 9, 30)
    # Justo 5 jornadas: el viernes, no el lunes siguiente.
    assert dia_del_minimo({"jornadas_minimas": 5.0}, LUNES.date(), [], False) == date(2026, 10, 2)
    # 5,5 jornadas: sin sábados, el lunes; con sábado trabajado, el sábado.
    assert dia_del_minimo({"jornadas_minimas": 5.5}, LUNES.date(), [], False) == date(2026, 10, 5)
    assert dia_del_minimo({"jornadas_minimas": 5.5}, LUNES.date(), [], True) == date(2026, 10, 3)
    assert dia_del_minimo(None, LUNES.date(), [], False) is None
    assert dia_del_minimo({"jornadas_minimas": 0}, LUNES.date(), [], False) is None


def test_si_en_el_minimo_no_entra_todo_se_reintenta_con_mas_lugar(solver_rapido, calendarios_vistos, monkeypatch):
    """Si el día del mínimo queda corto, NADA queda afuera: se resuelve de nuevo con el
    horizonte del reparto rápido, donde el reparto entra entero."""
    # Un mínimo que miente: medio día para 1.800 minutos de una sola persona.
    monkeypatch.setattr(PS, "dia_del_minimo", lambda *a, **k: LUNES.date())
    pasos = [_paso(1, s, 100) for s in range(1, 19)]
    res = _resolver(pasos)
    assert len(calendarios_vistos) == 2 and calendarios_vistos[1] > calendarios_vistos[0]
    assert not any(r["excedente"] or r["sin_asignar"] for r in res)


def test_sin_estimacion_vuelve_al_peor_caso(solver_rapido, calendarios_vistos, monkeypatch):
    """Si la cuenta rápida falla, el plan sale igual: con el calendario de antes."""
    monkeypatch.setattr(PS, "reparto_rapido", lambda *a, **k: None)
    pasos = [_paso(1, s, 100) for s in range(1, 4)]
    res = _resolver(pasos)
    assert len(calendarios_vistos) == 1
    assert not any(r["excedente"] or r["sin_asignar"] for r in res)


def test_los_dos_intentos_entran_en_el_tiempo_del_navegador(monkeypatch):
    """El corto se lleva 2/3 y el de respaldo la mitad: juntos, no más de 7/6 del
    presupuesto (con el techo de 240 s, ~280 s contra los 420 s del navegador)."""
    monkeypatch.delenv("SOLVER_CORTE_SIN_MEJORA_SEG", raising=False)
    assert PS._presupuesto_del_intento(234, 39, 0, 1) == (234, 39)
    assert PS._presupuesto_del_intento(234, 39, 0, 2) == (156, 26)
    assert PS._presupuesto_del_intento(234, 39, 1, 2) == (117, 20)
    assert sum(PS._presupuesto_del_intento(240, 40, i, 2)[0] for i in (0, 1)) <= 280
    # Con el presupuesto mínimo, el de respaldo no baja del piso.
    assert PS._presupuesto_del_intento(60, 10, 1, 2) == (PS.SOLVER_MINIMO_SEG, 10)


def test_con_fecha_tope_manda_el_rango(solver_rapido, calendarios_vistos, monkeypatch):
    """Con fecha tope no se estima el calendario: es el rango pedido, en un intento."""
    llamadas = []
    monkeypatch.setattr(PS, "horizonte_sin_tope", lambda *a, **k: llamadas.append(1) or 250)
    monkeypatch.setattr(PS, "dia_del_minimo", lambda *a, **k: llamadas.append(2) or LUNES.date())
    pasos = [_paso(1, s, 100) for s in range(1, 4)]
    res = _resolver(pasos, fecha_hasta=date(2026, 9, 29))
    assert not llamadas
    assert calendarios_vistos == [6]
    assert not any(r["excedente"] for r in res)


# ───────────────────────── el punto de partida ─────────────────────────

def test_el_reparto_rapido_no_separa_la_preparacion_de_su_produccion():
    """La preparación y la soldadura van con la misma persona (y la misma máquina).

    El 35 sólo puede preparar la soldadora y el 38 sólo soldar; el 40 hace las dos. El
    reparto rápido elegía cada paso por separado: preparaba el 35 y soldaba el 38, un
    plan que el solver nunca acepta. Con las 48 OT del piloto así se le asignaban a
    Nahuel las 40 h de TIG de la OT 13348: la estimación daba de menos y el reparto no
    servía de punto de partida.
    """
    R35, R38 = 21, 22
    prometida = datetime(2026, 12, 31)
    procesos = [
        (1, 104, 1, prometida, "normal", 30, [OFICIAL], "PREPARACION DE SOLDADORA TIG", True, "SOLDADORA_TIG", {}),
        (1, 140, 2, prometida, "normal", 120, [OFICIAL], "SOLDADURA CON TIG", True, "SOLDADORA_TIG", {}),
    ]
    operarios = [(35, R35), (38, R38), (40, OFICIAL)]
    maquinas = [(26, {OFICIAL, R35, R38}, "SOLDADORA TIG", "TIG-1")]
    r = estimar_plan(procesos, operarios, maquinas, None, None, {}, {}, {}, {}, set(),
                     {104: {35}, 140: {38}}, _cal(35, 38, 40), [], {}, {}, LUNES, detalle=True)
    quien = {k[1]: (op, maq) for k, (_ini, op, maq, _x) in r["_asignacion"].items()}
    assert quien == {1000: (40, 26), 2000: (40, 26)}, quien


def test_la_semilla_se_completa_y_el_solver_arranca_con_todo_adentro(monkeypatch):
    """El solver recibe el reparto rápido como un plan ENTERO, no como una sugerencia suelta."""
    completadas = []
    real = PS._completar_semilla

    def _espia(model, *a, **k):
        ok = real(model, *a, **k)
        completadas.append((ok, len(model.Proto().solution_hint.vars), len(model.Proto().variables)))
        return ok

    monkeypatch.setattr(PS, "_completar_semilla", _espia)
    monkeypatch.setenv("SOLVER_TECHO_SEG", "20")
    monkeypatch.setenv("SOLVER_CORTE_SIN_MEJORA_SEG", "3")
    pasos = [_paso(ot, s, 100) for ot in range(1, 4) for s in (1, 2)]
    res = _resolver(pasos, ops=(10, 11))
    assert completadas and completadas[0][0], completadas
    ok, con_semilla, variables = completadas[0]
    assert con_semilla == variables, "la semilla tiene que traer TODAS las variables"
    assert not any(r["excedente"] for r in res)


# ───────────────────────── el plan parejo ─────────────────────────

@pytest.mark.parametrize("equiv,fin_de_la_ot_larga", [(ATRASO_MAX_EQUIV, 120), (0, 150)])
def test_el_plan_parejo_le_gana_a_dejar_una_ot_colgada(solver_rapido, monkeypatch, equiv, fin_de_la_ot_larga):
    """Dos personas; la OT 1 (120 min) sólo la puede hacer el 10, las otras cuatro (30 min
    cada una) cualquiera. Todas vencidas.

    Sumando sólo los atrasos de cada paso, conviene que el 10 haga primero una de las
    chicas y después la larga (suma 360 contra 420): la OT larga termina a los 150. Es lo
    que le pasaba a Guillermo. Contando también el atraso de la OT más atrasada, el plan
    parejo —el 10 sólo con lo suyo— gana, y todo termina a los 120.
    """
    monkeypatch.setattr(PS, "ATRASO_MAX_EQUIV", equiv)
    vencida = datetime(2026, 9, 1)
    pasos = [_paso(1, 1, 120, prometida=vencida)]
    pasos += [_paso(ot, 1, 30, prometida=vencida) for ot in range(2, 6)]
    res = _resolver(pasos, ops=(10, 11), preseleccion_op={(1, 1): 10})
    assert not any(r["excedente"] or r["sin_asignar"] for r in res)
    larga = next(r for r in res if r["orden_id"] == 1)
    assert larga["fin_min"] == fin_de_la_ot_larga, [(r["orden_id"], r["id_operario"], r["inicio_min"], r["fin_min"]) for r in res]
