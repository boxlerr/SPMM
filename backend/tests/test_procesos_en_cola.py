"""Procesos en cola: dejar el amolado o la pintura para hacerlos todos juntos.

Lucas, 28/10/2026: «acá poner sin asignar y que me quede tipo en cola… en vez de pintar
una pieza por vez, la pateamos todo para pintar todos juntos, y ponemos un pasante».

- Un paso en cola es una pausa del paso con motivo EN_COLA: el paso y los que le siguen
  no entran en el plan; los de antes sí.
- «Planificar juntos» (ajuste `juntos`): esos pasos entran aunque estén en cola, los hace
  la misma persona y van uno atrás del otro.
- El aviso es uno por proceso: «Pintura: 3 pasos en cola».

Sin tocar la base.
"""
from datetime import datetime
from types import SimpleNamespace

from ortools.sat.python import cp_model

from backend.application import PlanificacionService as PS
from backend.application.DiagnosticoPlanificacion import diagnosticos_de_pausas
from backend.domain.PausaOrden import MOTIVOS, MOTIVO_TEXTO
from backend.tests.test_planificador_dias import LUNES, OFICIAL, _cal, solver_rapido  # noqa: F401

PASANTE_1, PASANTE_2 = 45, 46


def _pausa(id_otp, motivo="EN_COLA", ot=10, nombre="PINTURA", paso=3):
    return SimpleNamespace(id_otp=id_otp, id_orden_trabajo=ot, motivo=motivo, nombre_proceso=nombre,
                           paso=paso, desde=datetime(2026, 10, 30, 9, 0), usuario_pausa="Lucas Santa Cruz",
                           observacion=None)


def _linea(id_, orden, minutos=60, estado=1):
    return SimpleNamespace(id=id_, orden=orden, tiempo_proceso=minutos, id_estado=estado)


def test_en_cola_es_un_motivo_de_pausa():
    assert "EN_COLA" in MOTIVOS and MOTIVO_TEXTO["EN_COLA"] == "En cola"


def test_el_paso_en_cola_y_lo_que_sigue_no_entran_y_lo_de_antes_si():
    soldadura, pintura, embalado = _linea(101, 1), _linea(102, 2), _linea(103, 3)
    orden = SimpleNamespace(id=10, id_otvieja=15866, procesos=[soldadura, pintura, embalado])
    _ot, por_paso = PS._indexar_pausas([(_pausa(102), 15866)])
    entran, saltado = PS._sacar_lo_pausado(orden, orden.procesos, None, por_paso)
    assert entran == [soldadura]
    assert saltado["despues"] == 1 and saltado["procesos"] == 2


def test_lo_que_sale_de_la_cola_en_este_plan_no_lo_frena():
    pausas = [(_pausa(102), 15866), (_pausa(205, ot=20), 15867),
              (_pausa(300, motivo="MAQUINA_ROTA", ot=30), 15900)]
    _ot, por_paso = PS._indexar_pausas(pausas, sale_de_la_cola={102, 300})
    # La de la cola que se planifica junta se ignora; la otra cola, no; y una pausa de
    # verdad (máquina rota) tampoco, aunque alguien mande su paso.
    assert set(por_paso) == {205, 300}


# ───────────────────────── misma persona, uno atrás del otro ─────────────────────────

def _paso_pintura(ot, minutos=60):
    return (ot, 200, 1, None, "normal", minutos, [OFICIAL], "PINTURA", False, "", {})


def _resolver(procesos, ops, juntos=None):
    operarios = [(o, OFICIAL) for o in ops]
    resultados, _ = PS._resolver_planificacion(
        procesos, operarios, [], None, None, {}, {}, {}, {}, set(), {},
        _cal(*ops), [], {}, {}, None, LUNES, juntos=juntos)
    return {r["orden_id"]: r for r in resultados}


def test_planificar_juntos_es_con_la_misma_persona_y_uno_atras_del_otro(solver_rapido):
    pasos = [_paso_pintura(ot) for ot in (1, 2, 3)]
    # Sin juntar, con dos pasantes, el plan reparte para terminar antes.
    sueltos = _resolver(pasos, (PASANTE_1, PASANTE_2))
    assert len({r["id_operario"] for r in sueltos.values()}) == 2

    juntos = _resolver(pasos, (PASANTE_1, PASANTE_2), juntos=[[(1, 1), (2, 1), (3, 1)]])
    assert not any(r["excedente"] for r in juntos.values())
    assert len({r["id_operario"] for r in juntos.values()}) == 1
    # Uno atrás del otro: 7 a 8, 8 a 9 y, después del desayuno (9 a 9:15), 9:15 a 10:15.
    # Son 3 × 60 minutos de trabajo sin ningún hueco en el medio.
    inicios = sorted(r["fecha_inicio_estimada"][11:16] for r in juntos.values())
    fines = sorted(r["fecha_fin_estimada"][11:16] for r in juntos.values())
    assert inicios[0] == "07:00" and fines[-1] == "10:15", (inicios, fines)


def test_si_nadie_puede_hacer_todos_no_se_atan():
    model = cp_model.CpModel()
    op = {(1, 1): model.NewIntVarFromDomain(cp_model.Domain.FromValues([PASANTE_1, 999]), "a"),
          (2, 1): model.NewIntVarFromDomain(cp_model.Domain.FromValues([PASANTE_2, 999]), "b")}
    dominios = {(1, 1): [PASANTE_1, 999], (2, 1): [PASANTE_2, 999]}
    PS._agregar_juntos(model, [[[(1, 1)], [(2, 1)]]], op, dominios, dummy_op_id=999)
    model.Add(op[(1, 1)] == PASANTE_1)
    model.Add(op[(2, 1)] == PASANTE_2)
    assert cp_model.CpSolver().Solve(model) == cp_model.OPTIMAL


# ───────────────────────── el aviso ─────────────────────────

def _saltado(ot, numero, nombre="PINTURA", minutos=60, despues=1):
    return {"orden_id": ot, "numero": numero, "pausa": _pausa(None, nombre=nombre, ot=ot),
            "alcance": "paso", "procesos": 1 + despues, "minutos": minutos, "despues": despues}


def test_el_aviso_es_uno_por_proceso():
    avisos = diagnosticos_de_pausas([
        _saltado(10, 15866), _saltado(20, 15867), _saltado(30, 15900, nombre="AMOLADO", despues=0),
    ])
    titulos = sorted(a["titulo"] for a in avisos)
    assert titulos == ["Amolado: 1 paso en cola", "Pintura: 2 pasos en cola"]
    pintura = next(a for a in avisos if a["titulo"].startswith("Pintura"))
    assert pintura["tipo"] == "en_cola"
    assert "15866 y 15867" in pintura["detalle"]
    assert "Planificar juntos" in pintura["soluciones"][0]["texto"]


def test_una_pausa_de_verdad_sigue_con_su_aviso():
    s = _saltado(10, 15866)
    s["pausa"] = _pausa(None, motivo="MAQUINA_ROTA")
    avisos = diagnosticos_de_pausas([s])
    assert len(avisos) == 1 and avisos[0]["tipo"] == "ot_pausada"
