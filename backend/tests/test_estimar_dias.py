"""La estimación de días del Paso 1 (EstimacionPlan.estimar_plan y POST /planificacion/estimar).

Lucas, 23/09/2026: el Paso 1 decía «≈ 4,9 días con 12 operarios» y no se movía al sumar
OT; el plan real dio 9 días hábiles. Estos tests fijan lo que la estimación nueva promete:
el mínimo nunca pasa al reparto, una OT en fila no baja de su suma, el que es único en algo
aparece como el que marca el ritmo, los sábados sin gente no cuentan y el rango dice qué
entra.
"""
from datetime import date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.application.EstimacionPlan import estimar_plan

LUNES = datetime(2026, 9, 21, 7, 0)     # lunes 21/9/2026, 07:00
VIERNES = datetime(2026, 9, 25, 7, 0)   # viernes 25/9/2026, 07:00

OFICIAL, PLEGADOR, AYUDANTE = 3, 20, 1

# Todos de lunes a viernes, 07:00-16:00 (495 min de trabajo).
def _cal(*ops):
    return {o: {"dias": {0, 1, 2, 3, 4}, "desde": 0, "hasta": 495, "desde_sab": 0, "hasta_sab": 300}
            for o in ops}


def _paso(ot, sec, minutos, rangos, nombre="ARMADO", proc=100, usa_maquina=False, prioridad="normal"):
    # Mismo formato que arma planificar() para el solver.
    return (ot, proc, sec, datetime(2026, 12, 31), prioridad, minutos, list(rangos), nombre,
            usa_maquina, None, {})


def _estimar(procesos, operarios, *, inicio=LUNES, fecha_hasta=None, maquinarias=None, cal=None):
    ops = {o for o, _r in operarios}
    return estimar_plan(
        procesos, operarios, maquinarias or [], None, fecha_hasta, {}, {}, {}, {}, set(), {},
        cal if cal is not None else _cal(*ops), [], {}, {}, inicio,
        nombres_operario={o: f"Persona {o}" for o in ops}, numero_ot={}, detalle=True)


def test_el_minimo_nunca_supera_al_reparto():
    procesos = [_paso(ot, s, 120 + 30 * s, [OFICIAL]) for ot in (1, 2, 3, 4) for s in (1, 2, 3)]
    r = _estimar(procesos, [(10, OFICIAL), (11, OFICIAL)])
    assert 0 < r["jornadas_minimas"] <= r["jornadas_estimadas"]
    assert r["dias_habiles_minimos"] <= r["dias_habiles_estimados"]


def test_una_ot_en_fila_no_baja_de_la_suma_de_sus_pasos():
    # Tres pasos de 300 min: van uno atrás del otro aunque sobre gente.
    procesos = [_paso(1, s, 300, [OFICIAL]) for s in (1, 2, 3)]
    r = _estimar(procesos, [(o, OFICIAL) for o in range(10, 20)])
    assert r["jornadas_minimas"] >= 900 / 495 - 1e-6
    assert r["_fin_min"] >= 900


def test_sumar_ot_mueve_los_dias():
    # Lo que se quejaba Lucas: sumar OT no movía el número.
    base = [_paso(ot, 1, 400, [OFICIAL]) for ot in range(1, 4)]
    mas = base + [_paso(ot, 1, 400, [OFICIAL]) for ot in range(4, 10)]
    r1 = _estimar(base, [(10, OFICIAL), (11, OFICIAL)])
    r2 = _estimar(mas, [(10, OFICIAL), (11, OFICIAL)])
    assert r2["jornadas_estimadas"] > r1["jornadas_estimadas"]
    assert r2["carga_min"] == 9 * 400


def test_el_unico_que_sabe_algo_marca_el_ritmo():
    # Sólo el 31 tiene el rango de plegador; lo demás lo hace cualquier oficial.
    procesos = [_paso(ot, 1, 400, [PLEGADOR], nombre="PLEGADO") for ot in range(1, 5)]
    procesos += [_paso(ot, 2, 100, [OFICIAL]) for ot in range(1, 5)]
    operarios = [(31, PLEGADOR), (31, OFICIAL), (32, OFICIAL), (33, OFICIAL)]
    r = _estimar(procesos, operarios)
    assert r["cuellos"][0]["nombre"] == "Persona 31"
    assert r["cuellos"][0]["exclusivas"] >= 1600 / 495 - 0.01
    # Y no le cargó a él lo que otros podían hacer: sus jornadas son ~las exclusivas.
    assert r["cuellos"][0]["jornadas"] <= r["cuellos"][0]["exclusivas"] + 0.5


def test_los_sabados_no_cuentan_si_nadie_los_trabaja():
    # Un solo operario y tres pasos de 210 min en fila. Con los tramos del solver, un paso
    # de 210 sólo arranca en el tramo de 12:30 a 16:00: uno por día. Arrancando un viernes
    # son viernes, lunes y martes: 3 días hábiles, no 4 con el sábado en el medio.
    procesos = [_paso(1, s, 210, [OFICIAL]) for s in (1, 2, 3)]
    r = _estimar(procesos, [(10, OFICIAL)], inicio=VIERNES)
    assert r["dias_habiles_estimados"] == 3
    fin = datetime.fromisoformat(r["fin_estimado"])
    assert fin.date() == date(2026, 9, 29)      # martes
    assert fin.weekday() < 5


def test_el_rango_dice_que_entra():
    # Dos personas, 6 OT de una jornada cada una y un rango de 2 días: no entra todo, pero
    # las más urgentes sí quedan terminadas.
    procesos = [_paso(ot, 1, 495, [OFICIAL], prioridad="urgente" if ot <= 2 else "normal")
                for ot in range(1, 7)]
    r = _estimar(procesos, [(10, OFICIAL), (11, OFICIAL)], fecha_hasta=date(2026, 9, 22))
    rango = r["rango"]
    assert rango["dias_habiles"] == 2
    assert rango["ots_total"] == 6
    assert 2 <= rango["ots_entran"] < 6
    assert 1 not in rango["no_entran"] and 2 not in rango["no_entran"]   # las urgentes entran
    assert 0 < rango["carga_entra_min"] < r["carga_min"]


def test_lo_que_no_puede_hacer_nadie_se_informa_aparte():
    # Un paso con un rango que no tiene nadie (tercerizado): no ocupa a nadie del taller.
    procesos = [_paso(1, 1, 200, [OFICIAL]), _paso(1, 2, 150, [99], nombre="TRABAJO TERCERIZADO")]
    r = _estimar(procesos, [(10, OFICIAL)])
    assert r["sin_asignar_min"] == 150


def test_sin_procesos_no_rompe():
    r = _estimar([], [(10, OFICIAL)])
    assert r["carga_min"] == 0 and r["dias_habiles_estimados"] == 0


def test_el_endpoint_pide_al_menos_una_ot():
    from backend.core.security import get_current_user
    from backend.presentation import PlanificacionAPI

    app = FastAPI()
    app.include_router(PlanificacionAPI.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1}

    async def _sin_base():
        yield None
    app.dependency_overrides[PlanificacionAPI.get_db] = _sin_base
    r = TestClient(app).post("/planificacion/estimar", json={"ordenes_ids": []})
    assert r.status_code == 400
