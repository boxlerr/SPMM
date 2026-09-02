"""
En qué máquinas se hace un proceso, como DATO y no deducido del nombre.

Pedido de Julián el 2/9: «esto se tiene que hacer al momento de crear el proceso, o
sea cualquier proceso se le podría seleccionar». Hasta ahora el planificador lo
deducía del nombre, y por eso «reparación de rosca» se planificaba sin reservar
ningún torno — y por eso Lucas tuvo que contestar en la planilla en qué máquina se
hace cada cosa: el sistema no tenía dónde guardar la respuesta.

Lo que NO puede pasar: que cargar el dato en unos pocos procesos cambie el plan de los
otros 400. Vacío tiene que seguir queriendo decir «deducilo del nombre».
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import (
    _crear_variables_y_dominios,
    familia_requerida_from_proceso,
)

MAQ_DOMAIN_IDX = 14  # maq_domain_vals

TORNO_1, TORNO_2, SOLDADORA = 201, 202, 203
# (id, {rangos}, nombre, cod_maquina)
MAQUINAS = [
    (TORNO_1, set(), "TORNO T1", "TOR-1"),
    (TORNO_2, set(), "TORNO T2", "TOR-2"),
    (SOLDADORA, set(), "SOLDADORA MIG/MAG 450 1", "SOL-1"),
]
OPERARIOS = [(10, 1)]


def _dominio_de_maquina(nombre_proceso, maquinas_por_proceso=None, proc_id=500):
    ps.H = 100000
    model = cp_model.CpModel()
    # (orden, proc, sec, fecha, prio, dur, rangos, nombre, usa_maquina, familia, skills)
    # La familia va calculada como la calcula la normalización de verdad: es un campo de
    # la tupla, no algo que el constructor de dominios deduzca por su cuenta.
    familia = familia_requerida_from_proceso(nombre_proceso)
    procesos_norm = [(1, proc_id, 1, None, 5, 60, [], nombre_proceso, True, familia, {})]
    salida = _crear_variables_y_dominios(
        model, procesos_norm, OPERARIOS, MAQUINAS, set(), set(),
        maquinas_por_proceso=maquinas_por_proceso,
    )
    return salida[MAQ_DOMAIN_IDX][(1, 1)]


def test_sin_el_dato_se_sigue_deduciendo_del_nombre():
    """Los 415 procesos que hoy no lo tienen cargado se comportan igual que siempre."""
    dom = _dominio_de_maquina("TORNO T1")
    assert TORNO_1 in dom and TORNO_2 in dom, "la familia TORNO sigue valiendo"
    assert SOLDADORA not in dom


def test_el_dato_cargado_le_gana_a_la_deduccion():
    """Reparación de rosca no tiene familia por el nombre, así que hoy va sin máquina.
    Con las máquinas cargadas, reserva los tornos convencionales que dijo Lucas."""
    sin_dato = _dominio_de_maquina("REPARACION DE ROSCA")
    assert TORNO_1 not in sin_dato, "hoy no reserva nada: el nombre no dice la máquina"

    con_dato = _dominio_de_maquina("REPARACION DE ROSCA", {500: [TORNO_1, TORNO_2]})
    assert TORNO_1 in con_dato and TORNO_2 in con_dato
    assert SOLDADORA not in con_dato


def test_el_dato_de_un_proceso_no_toca_a_los_demas():
    """Cargar una máquina en un proceso no puede cambiarle el plan a los otros."""
    dom = _dominio_de_maquina("TORNO T1", {999: [SOLDADORA]})   # el dato es de OTRO proceso
    assert TORNO_1 in dom and SOLDADORA not in dom


def test_una_maquina_dada_de_baja_no_rompe_el_dominio():
    """Si la máquina elegida ya no existe, se cae al comportamiento de siempre en vez
    de dejar el proceso sin ninguna candidata."""
    dom = _dominio_de_maquina("TORNO T1", {500: [999999]})
    assert TORNO_1 in dom, "la máquina cargada no existe: vale la deducción por nombre"
