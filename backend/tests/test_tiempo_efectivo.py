"""El tiempo efectivo de un paso (RF-06): la cuenta pura, con sus casos límite.

EFECTIVO = lo que cae adentro de la jornada del taller, menos lo que estuvo en pausa
(RF-03) adentro de esa jornada. Y el desglose cierra siempre:

    corrido = efectivo + en pausa + fuera de jornada

Lo que se persigue acá son las formas en que ese número miente:

  1. **Contar lo que no se trabaja**: la noche, el sábado a la tarde, el domingo, un
     feriado, el desayuno y el almuerzo.
  2. **Descontar dos veces lo mismo**: dos pausas que se pisan (la del paso y la de la
     OT), o una pausa en el almuerzo, que ya estaba afuera.
  3. **Descontar lo que no era del paso**: una pausa que empezó antes del arranque o
     terminó después del fin.
  4. **Una tercera jornada**: los tramos salen de los del planificador, y si alguien los
     cambia allá, esto lo sigue.

Semana de referencia: lunes 21/09/2026 a domingo 27/09/2026.
"""
import random
from datetime import date, datetime, timedelta

import pytest

from backend.application.PlanificacionService import (
    MIN_LABORAL_DIA,
    MIN_LABORAL_SABADO,
    _convertir_minutos_a_fecha,
)
from backend.application.TiempoEfectivo import (
    RELOJ_LV,
    RELOJ_SABADO,
    fecha_real,
    interseccion,
    jornada_en_palabras,
    minutos,
    tiempo_de_un_paso,
    tramos_de_jornada,
    unir,
)


def dia(d: int, hh: int, mm: int = 0) -> datetime:
    """Un momento de la semana del 21/09/2026 (lunes 21 … domingo 27)."""
    return datetime(2026, 9, d, hh, mm)


LEJOS = dia(30, 12)  # un «ahora» que no toca ningún caso terminado


def t(inicio, fin, pausas=(), ahora=LEJOS, feriados=()):
    r = tiempo_de_un_paso(inicio, fin, pausas, ahora=ahora, feriados=feriados)
    assert r is not None
    # El desglose cierra SIEMPRE, sea cual sea el caso.
    assert r.corrido == r.efectivo + r.en_pausa + r.fuera_de_jornada, r
    assert min(r) >= 0, r
    return r


# ─────────────────────── la jornada ───────────────────────

def test_la_jornada_es_la_del_planificador():
    """Los tramos de reloj se derivan de los del solver: 07–09, 09:15–12, 12:30–16."""
    assert RELOJ_LV == [(7 * 60, 9 * 60), (9 * 60 + 15, 12 * 60), (12 * 60 + 30, 16 * 60)]
    assert RELOJ_SABADO == [(7 * 60, 12 * 60)]
    assert sum(b - a for a, b in RELOJ_LV) == MIN_LABORAL_DIA
    assert sum(b - a for a, b in RELOJ_SABADO) == MIN_LABORAL_SABADO


def test_cada_minuto_de_trabajo_del_plan_cae_adentro_de_la_jornada():
    """La misma cuenta que usa el plan para pasar minutos a fechas cae siempre adentro de
    estos tramos: si mañana alguien cambia la jornada en un lado solo, esto se rompe.

    Se mira el FIN de cada minuto de trabajo (`es_fin`): el minuto 120 del plan es a la
    vez las 09:00 (fin del primer tramo) y las 09:15 (arranque del segundo), y el minuto
    de trabajo número 121 es el que termina a las 09:16."""
    base = dia(22, 7)
    for m in range(1, MIN_LABORAL_DIA + 1):
        fin = datetime.fromisoformat(_convertir_minutos_a_fecha(m, base, es_fin=True))
        hhmm = fin.hour * 60 + fin.minute
        assert any(a < hhmm <= b for a, b in RELOJ_LV), (
            f"el minuto de trabajo {m} del plan termina a las {fin:%H:%M}, fuera de la jornada")


def test_la_jornada_dicha_en_palabras():
    texto = jornada_en_palabras()
    assert texto.startswith("Lunes a viernes 07:00–09:00, 09:15–12:00 y 12:30–16:00")
    assert "sábados 07:00–12:00" in texto


# ─────────────────────── adentro de un día ───────────────────────

def test_un_paso_adentro_de_un_tramo_es_todo_efectivo():
    r = t(dia(22, 7, 30), dia(22, 8, 30))
    assert (r.corrido, r.efectivo, r.fuera_de_jornada, r.en_pausa) == (60, 60, 0, 0)
    assert r.en_curso is False


def test_el_desayuno_no_es_trabajo():
    r = t(dia(22, 8, 30), dia(22, 10))
    assert (r.corrido, r.efectivo, r.fuera_de_jornada) == (90, 75, 15)


def test_el_almuerzo_no_es_trabajo():
    r = t(dia(22, 11, 30), dia(22, 13))
    assert (r.corrido, r.efectivo, r.fuera_de_jornada) == (90, 60, 30)


def test_un_dia_entero_son_495_minutos():
    r = t(dia(22, 7), dia(22, 16))
    assert (r.corrido, r.efectivo) == (540, MIN_LABORAL_DIA)


# ─────────────────────── de un día para otro ───────────────────────

def test_la_noche_no_cuenta():
    """Arrancado el martes a las 15, terminado el miércoles a las 8: 17 horas de reloj,
    dos de trabajo."""
    r = t(dia(22, 15), dia(23, 8))
    assert (r.corrido, r.efectivo, r.fuera_de_jornada) == (17 * 60, 120, 17 * 60 - 120)


def test_el_fin_de_semana_cuenta_el_sabado_a_la_manana_y_nada_del_domingo():
    """Viernes 15 → lunes 8: 65 horas de reloj; una del viernes, cinco del sábado y una
    del lunes."""
    r = t(dia(25, 15), dia(28, 8))
    assert r.corrido == 65 * 60
    assert r.efectivo == 60 + 300 + 60


def test_un_feriado_no_cuenta():
    r = t(dia(25, 15), dia(28, 8), feriados=[date(2026, 9, 26)])
    assert r.efectivo == 60 + 60


def test_trabajar_un_domingo_queda_fuera_de_jornada_y_a_la_vista():
    r = t(dia(27, 8), dia(27, 10))
    assert (r.efectivo, r.fuera_de_jornada) == (0, 120)


def test_el_sabado_a_la_tarde_no_cuenta():
    r = t(dia(26, 11), dia(26, 13))
    assert (r.efectivo, r.fuera_de_jornada) == (60, 60)


# ─────────────────────── las pausas ───────────────────────

def test_una_pausa_adentro_se_descuenta():
    r = t(dia(22, 7), dia(22, 9), [(dia(22, 7, 30), dia(22, 8))])
    assert (r.efectivo, r.en_pausa) == (90, 30)


def test_una_pausa_que_empezo_antes_del_arranque_se_recorta():
    """La OT estaba pausada desde las 7; el paso arrancó a las 8 y se reanudó 8:30."""
    r = t(dia(22, 8), dia(22, 11), [(dia(22, 7), dia(22, 8, 30))])
    assert r.en_pausa == 30
    assert r.efectivo == (60 + 105) - 30


def test_una_pausa_que_termina_despues_del_fin_se_recorta():
    r = t(dia(22, 8), dia(22, 11), [(dia(22, 10, 30), dia(22, 14))])
    assert r.en_pausa == 30


def test_una_pausa_de_otro_momento_no_toca_nada():
    r = t(dia(22, 8), dia(22, 9), [(dia(21, 8), dia(21, 12)), (dia(23, 8), None)], ahora=dia(23, 9))
    assert (r.efectivo, r.en_pausa) == (60, 0)


def test_dos_pausas_que_se_pisan_se_descuentan_una_vez():
    """El torno roto (el paso) de 9:30 a 10:30 y el cliente que pidió esperar (la OT) de
    10 a 11: se paró de 9:30 a 11, hora y media, no dos horas."""
    r = t(dia(22, 7), dia(22, 12), [(dia(22, 9, 30), dia(22, 10, 30)), (dia(22, 10), dia(22, 11))])
    assert r.en_pausa == 90
    assert r.efectivo == 285 - 90


def test_una_pausa_en_el_almuerzo_no_se_descuenta_dos_veces():
    """El almuerzo ya estaba fuera de la jornada: de una pausa de 11:45 a 12:45 sólo se
    descuentan los 30 minutos que eran de trabajo."""
    r = t(dia(22, 11), dia(22, 14), [(dia(22, 11, 45), dia(22, 12, 45))])
    assert (r.corrido, r.fuera_de_jornada, r.en_pausa, r.efectivo) == (180, 30, 30, 120)


def test_una_pausa_que_cruza_la_noche_solo_descuenta_la_jornada():
    """Pausado el martes 15:30, reanudado el miércoles 7:30: media hora de cada día."""
    r = t(dia(22, 15), dia(23, 9), [(dia(22, 15, 30), dia(23, 7, 30))])
    assert r.en_pausa == 60
    assert r.efectivo == (60 + 120) - 60


def test_una_pausa_abierta_cuenta_hasta_ahora():
    r = t(dia(22, 8), None, [(dia(22, 10), None)], ahora=dia(22, 11))
    assert r.en_curso is True
    assert r.corrido == 180
    assert r.en_pausa == 60
    assert r.efectivo == (60 + 105) - 60


def test_una_pausa_abierta_de_un_paso_terminado_se_corta_en_el_fin():
    r = t(dia(22, 8), dia(22, 10, 30), [(dia(22, 10), None)], ahora=dia(22, 15))
    assert r.en_pausa == 30


def test_una_pausa_de_todo_el_paso_deja_cero_efectivo():
    r = t(dia(22, 8), dia(22, 9), [(dia(22, 7), dia(22, 10))])
    assert (r.efectivo, r.en_pausa) == (0, 60)


# ─────────────────────── sin fin, sin arranque, datos rotos ───────────────────────

def test_sin_fin_esta_en_curso_y_cuenta_hasta_ahora():
    r = t(dia(22, 7), None, ahora=dia(22, 8, 15))
    assert r.en_curso is True and (r.corrido, r.efectivo) == (75, 75)


def test_en_curso_desde_ayer():
    r = t(dia(22, 15), None, ahora=dia(23, 7, 30))
    assert r.en_curso is True and r.efectivo == 60 + 30


def test_sin_arranque_no_hay_tiempo():
    assert tiempo_de_un_paso(None, None, ahora=LEJOS) is None
    assert tiempo_de_un_paso(None, dia(22, 9), ahora=LEJOS) is None


def test_el_centinela_del_sistema_viejo_no_es_una_fecha():
    """El legacy guarda 1900-01-01 y 1950-01-01 donde no hay dato."""
    assert fecha_real(datetime(1900, 1, 1)) is None
    assert fecha_real(datetime(1950, 1, 1)) is None
    assert tiempo_de_un_paso(datetime(1900, 1, 1), dia(22, 9), ahora=LEJOS) is None
    # Un fin centinela es un paso sin fin: sigue en curso.
    r = t(dia(22, 7), datetime(1950, 1, 1), ahora=dia(22, 8))
    assert r.en_curso is True and r.corrido == 60


def test_un_fin_antes_del_arranque_da_cero():
    r = t(dia(22, 10), dia(22, 9))
    assert (r.corrido, r.efectivo) == (0, 0)


def test_los_segundos_no_descuadran_el_desglose():
    """Arranque 8:00:59 y fin 9:00:01: se cuenta al minuto, 60 y no 59 ni 61."""
    r = t(dia(22, 8).replace(second=59), dia(22, 9).replace(second=1),
          [(dia(22, 8, 30).replace(second=30), dia(22, 8, 40).replace(second=10))])
    assert (r.corrido, r.en_pausa, r.efectivo) == (60, 10, 50)


def test_el_desglose_cierra_siempre():
    """Mil pasos al azar, con pausas al azar: corrido = efectivo + pausa + fuera, y el
    efectivo nunca pasa de la jornada."""
    azar = random.Random(20260923)
    base = dia(21, 0)
    feriados = [date(2026, 9, 24)]
    for _ in range(1000):
        ini = base + timedelta(minutes=azar.randrange(0, 7 * 24 * 60))
        fin = ini + timedelta(minutes=azar.randrange(0, 3 * 24 * 60)) if azar.random() < 0.9 else None
        pausas = []
        for _ in range(azar.randrange(0, 4)):
            p0 = base + timedelta(minutes=azar.randrange(0, 9 * 24 * 60))
            p1 = p0 + timedelta(minutes=azar.randrange(1, 24 * 60)) if azar.random() < 0.8 else None
            pausas.append((p0, p1))
        ahora = base + timedelta(days=10)
        r = t(ini, fin, pausas, ahora=ahora, feriados=feriados)
        hasta = fin or ahora
        assert r.efectivo + r.en_pausa == minutos(tramos_de_jornada(ini, hasta, feriados))


# ─────────────────────── los tramos ───────────────────────

def test_unir_e_intersecar():
    a = [(dia(22, 8), dia(22, 10)), (dia(22, 9), dia(22, 11)), (dia(22, 11), dia(22, 12))]
    assert unir(a) == [(dia(22, 8), dia(22, 12))]
    b = [(dia(22, 7), dia(22, 8, 30)), (dia(22, 11, 30), dia(22, 13))]
    assert interseccion(a, b) == [(dia(22, 8), dia(22, 8, 30)), (dia(22, 11, 30), dia(22, 12))]
    assert minutos(a) == 240


@pytest.mark.parametrize("desde,hasta,esperado", [
    (dia(22, 6), dia(22, 7), 0),        # antes de abrir
    (dia(22, 16), dia(22, 23), 0),      # después de cerrar
    (dia(22, 9), dia(22, 9, 15), 0),    # el desayuno
    (dia(22, 12), dia(22, 12, 30), 0),  # el almuerzo
    (dia(21, 0), dia(28, 0), 5 * 495 + 300),  # una semana entera
])
def test_minutos_de_jornada(desde, hasta, esperado):
    assert minutos(tramos_de_jornada(desde, hasta)) == esperado
