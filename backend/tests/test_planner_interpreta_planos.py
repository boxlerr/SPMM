"""
Interpretación de planos como filtro DURO del planificador.

Si la OT tiene plano adjunto (orden_trabajo.tiene_plano), sus procesos solo pueden
asignarse a operarios con `interpreta_planos = True`. No alcanza con tener la nativa:
si no sabe leer el plano, no puede hacer la tarea.

Hasta ahora la columna existía en la tabla operario y se editaba desde el form, pero
el planificador la ignoraba por completo.
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import _crear_variables_y_dominios

OP_DOMAIN_VALS_IDX = 13
DUMMY_OP_ID = 999999

# El operario 10 sabe leer planos, el 11 no. Ambos con el rango 7 del proceso.
OPERARIOS = [(10, 7), (11, 7)]
OP_PLANOS = {10: True, 11: False}


def _dominio(ots_con_plano, op_planos=None, nativas_off=None):
    ps.H = 100000
    model = cp_model.CpModel()
    # orden_id = 1
    procesos_norm = [(1, 100, 1, None, 5, 60, [7], "Torneado", False, "", {})]
    ret = _crear_variables_y_dominios(
        model, procesos_norm, OPERARIOS, [], set(), set(),
        nativas_off or {}, None, None,
        OP_PLANOS if op_planos is None else op_planos,
        ots_con_plano,
    )
    return ret[OP_DOMAIN_VALS_IDX][(1, 1)]


def test_ot_sin_plano_no_filtra():
    dom = _dominio(ots_con_plano=set())
    assert 10 in dom and 11 in dom


def test_ot_con_plano_deja_solo_a_quien_sabe_leerlo():
    dom = _dominio(ots_con_plano={1})
    assert 10 in dom
    assert 11 not in dom


def test_ot_con_plano_y_nadie_sabe_leerlo_queda_sin_asignar():
    dom = _dominio(ots_con_plano={1}, op_planos={10: False, 11: False})
    assert dom == [DUMMY_OP_ID]


def test_el_filtro_de_planos_se_suma_a_la_nativa_desactivada():
    # El 10 sabe leer planos pero tiene la nativa apagada; el 11 la tiene habilitada
    # pero no sabe leer planos. No queda nadie.
    dom = _dominio(ots_con_plano={1}, nativas_off={100: {10}})
    assert dom == [DUMMY_OP_ID]


def test_operario_sin_dato_de_planos_se_trata_como_que_no_sabe():
    # Ausente del mapa -> no habilitado. Es el default seguro: la columna es
    # NOT NULL default False, así que faltar significa "no sabe".
    dom = _dominio(ots_con_plano={1}, op_planos={})
    assert dom == [DUMMY_OP_ID]
