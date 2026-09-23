"""Las horas trabajadas de una persona: una sola cuenta, y sin contar lo que no se trabajó.

En la ficha de la persona hay dos números que dicen lo mismo con otras palabras: el total
de la solapa Tiempos (RF-06) y las «horas trabajadas» del reporte de Rendimiento (RF-07).
Con el mismo período daban distinto —98 h 30 min contra 47 h 45 min— porque la solapa
sumaba el efectivo de cada paso ENTERO (lo de antes del período adentro) y las horas en
que tenía dos pasos abiertos, dos veces. Ahora las dos salen de la misma función
(TiemposOperarioService.horas_en_el_periodo) y la solapa muestra aparte la suma de los
pasos enteros, explicando la diferencia.

Y las horas dejan de contar lo que no se trabajó:
  1. **Los días en que figura ausente.** Un paso abierto del 28/8 al 3/9 con una
     ausencia cargada del 25/8 al 5/9 sumaba las jornadas del 1 al 3 como trabajadas.
  2. **Un paso PENDIENTE con arranque** (lo trae el sistema viejo o una OT migrada): se
     tomaba «en curso» porque no tiene fin y sumaba una jornada por cada día hábil desde
     el 1/8. En curso es sólo lo que está EN PROCESO.
  3. **Un paso en proceso que nadie cerró.** Sumaba 495 min por cada día hábil de cada
     período que venga. Pasadas cinco jornadas (y el doble de lo estimado) se marca
     «¿quedó abierto?» y no entra en las horas; se dice cuánto quedó afuera.

Reloj fijo: jueves 24/09/2026 12:00.
"""
from datetime import date

import pytest
import pytest_asyncio

from backend.application import AusenciaService as ausencia_mod
from backend.application import RendimientoOperarioService as rend_mod
from backend.application import TiemposOperarioService as tiempos_mod
from backend.application.RendimientoOperarioService import RendimientoOperarioService
from backend.application.TiemposOperarioService import TiemposOperarioService
from backend.domain.AusenciaOperario import AusenciaOperario
from backend.tests.test_rendimiento_operario import AHORA, JUAN, _base, _paso, dia

SEPTIEMBRE = {"desde": "2026-09-01", "hasta": "2026-09-30"}


@pytest.fixture(autouse=True)
def reloj_fijo(monkeypatch):
    for mod in (rend_mod, tiempos_mod, ausencia_mod):
        monkeypatch.setattr(mod, "ahora_ar", lambda: AHORA)


async def _tiempos(session, **periodo) -> dict:
    r = await TiemposOperarioService(session).tareas(JUAN, **periodo)
    assert r.status is True
    return r.data


async def _rendimiento(session, **periodo) -> dict:
    r = await RendimientoOperarioService(session).reporte(JUAN, **periodo)
    assert r.status is True
    return r.data


def _por_paso(data) -> dict:
    return {t["id_otp"]: t for t in data["tareas"]}


@pytest_asyncio.fixture
async def septiembre(session):
    """El caso de la verificación: un paso del 28/8 al 3/9 y dos en curso en paralelo
    desde el lunes 21/9 a las 8."""
    await _base(session)
    session.add_all([
        _paso(301, 10, 150, 1, 3, 600, dia(28, 8, mes=8), dia(3, 12)),
        _paso(302, 11, 150, 1, 2, 3000, dia(21, 8)),
        _paso(303, 11, 160, 2, 2, 3000, dia(21, 8)),
    ])
    await session.commit()
    return session


# ─────────────────────── una sola cuenta ───────────────────────

async def test_el_total_de_tiempos_es_el_mismo_que_las_horas_de_rendimiento(septiembre):
    t = (await _tiempos(septiembre, **SEPTIEMBRE))["resumen"]
    r = (await _rendimiento(septiembre, **SEPTIEMBRE))["resumen"]

    assert t["trabajado_min"] == r["horas_trabajadas_min"]
    assert t["superpuesto_min"] == r["superpuesto_min"] > 0
    # 301: del 1/9 (martes) al 3/9 a las 12 = 495 + 495 + 285. Los 302 y 303 del lunes
    # 21 a las 8 al jueves 24 a las 12, una sola vez: 435 + 495 + 495 + 285.
    assert t["trabajado_min"] == (495 + 495 + 285) + (435 + 495 + 495 + 285)

    # La suma de los pasos enteros es otra cosa, y la diferencia se explica entera: lo
    # que cae fuera del período y lo que se superpone.
    assert t["efectivo_min"] > t["trabajado_min"]
    assert t["efectivo_min"] == (t["trabajado_min"] + t["superpuesto_min"] + t["en_ausencia_min"]
                                 + t["abiertos_de_mas"]["minutos"] + t["fuera_del_periodo_min"])
    assert t["fuera_del_periodo_min"] > 0, "lo del 28 al 31/8 no es de septiembre"


async def test_el_resumen_se_cuenta_antes_de_recortar_la_lista(septiembre, monkeypatch):
    entero = (await _tiempos(septiembre, **SEPTIEMBRE))["resumen"]
    monkeypatch.setattr(tiempos_mod, "TOPE_TAREAS", 1)
    data = await _tiempos(septiembre, **SEPTIEMBRE)
    assert data["recortado"] is True and len(data["tareas"]) == 1
    assert data["resumen"] == entero, "los totales son de todas las tareas, no de las visibles"


# ─────────────────────── 1. ausencias ───────────────────────

async def test_los_dias_de_ausencia_no_son_horas_trabajadas(septiembre):
    septiembre.add(AusenciaOperario(id_operario=JUAN, desde=date(2026, 8, 25), vuelve=date(2026, 9, 6),
                                    motivo="ENFERMEDAD", origen="CARGA", cargada_en=dia(24, 8, mes=8)))
    await septiembre.commit()

    r = await _rendimiento(septiembre, **SEPTIEMBRE)
    t = await _tiempos(septiembre, **SEPTIEMBRE)
    # Del 1 al 3/9 estaba ausente: lo del 301 en esos días no cuenta.
    assert r["resumen"]["en_ausencia_min"] == 495 + 495 + 285
    assert r["resumen"]["horas_trabajadas_min"] == 435 + 495 + 495 + 285
    assert t["resumen"]["trabajado_min"] == r["resumen"]["horas_trabajadas_min"]
    assert t["ausencias_disponibles"] is True
    # El paso sigue diciendo lo suyo: se descuenta del total, no se esconde.
    assert _por_paso(r)[301]["efectivo_en_periodo_min"] == 495 + 495 + 285


async def test_una_ausencia_de_volvio_el_mismo_dia_no_descuenta_nada(septiembre):
    septiembre.add(AusenciaOperario(id_operario=JUAN, desde=date(2026, 9, 22), vuelve=date(2026, 9, 22),
                                    origen="ESTADO", cargada_en=dia(22, 7, 30)))
    await septiembre.commit()
    r = (await _rendimiento(septiembre, **SEPTIEMBRE))["resumen"]
    assert r["en_ausencia_min"] == 0


# ─────────────────────── 2. pendiente con arranque ───────────────────────

async def test_un_paso_pendiente_con_arranque_no_esta_en_curso_ni_suma(session):
    await _base(session)
    session.add(_paso(401, 10, 150, 1, 1, 60, dia(1, 8, mes=8)))
    await session.commit()

    r = await _rendimiento(session, desde="2026-08-01", hasta="2026-08-31")
    p = _por_paso(r)[401]
    assert p["estado"] == "Pendiente" and p["en_curso"] is False
    assert p["sin_datos"] is True and p["sin_datos_motivo"] == "pendiente_con_arranque"
    assert p["efectivo_min"] is None
    assert r["resumen"]["horas_trabajadas_min"] == 0 and r["resumen"]["en_curso"] == 0

    # Y no aparece en los meses que vienen, sumando jornadas.
    semana = await _rendimiento(session, desde="2026-09-21", hasta="2026-09-27")
    assert semana["tareas"] == [] and semana["resumen"]["horas_trabajadas_min"] == 0
    t = await _tiempos(session, desde="2026-09-21", hasta="2026-09-27")
    assert t["tareas"] == [] and t["resumen"]["trabajado_min"] == 0 and t["resumen"]["en_curso"] == 0
    # En la solapa Tiempos sale en el período en que arrancó, sin minutos y diciendo por qué.
    agosto = await _tiempos(session, desde="2026-08-01", hasta="2026-08-31")
    (fila,) = agosto["tareas"]
    assert fila["sin_datos_motivo"] == "pendiente_con_arranque" and fila["sin_datos_texto"]


# ─────────────────────── 3. en proceso que nadie cerró ───────────────────────

async def test_un_paso_en_proceso_olvidado_se_marca_y_no_suma_horas(session):
    await _base(session)
    session.add_all([
        # En proceso desde el 1/9 y 60 min estimados: más de cinco jornadas abierto.
        _paso(501, 10, 150, 1, 2, 60, dia(1, 8)),
        # En proceso desde ayer: normal.
        _paso(502, 11, 160, 1, 2, 600, dia(23, 8)),
        # En proceso desde el 14/9 pero con 40 h estimadas: todavía no es raro.
        _paso(503, 12, 170, 1, 2, 2400, dia(14, 8)),
    ])
    await session.commit()

    r = await _rendimiento(session, desde="2026-09-21", hasta="2026-09-27")
    pasos = _por_paso(r)
    assert pasos[501]["abierto_de_mas"] is True and pasos[501]["en_curso"] is True
    assert pasos[502]["abierto_de_mas"] is False and pasos[503]["abierto_de_mas"] is False
    abiertos = r["resumen"]["abiertos_de_mas"]
    assert abiertos["pasos"] == 1 and abiertos["minutos"] == 495 * 3 + 285
    # Las horas: 502 y 503, sin el 501 (que se superponía con el 503 toda la semana).
    assert r["resumen"]["horas_trabajadas_min"] == 495 * 3 + 285
    assert r["tope_jornadas_abierto"] == 5

    t = await _tiempos(session, desde="2026-09-21", hasta="2026-09-27")
    assert t["resumen"]["trabajado_min"] == r["resumen"]["horas_trabajadas_min"]
    assert t["resumen"]["abiertos_de_mas"] == abiertos
