"""
Regresión de la OT #15279 (LKM, armario aisi304) tal como salió el 19/08/2026:

    3. Preparacion de soldadora tig   ->  Sin asignar
    4. Soldadura con tig              ->  "No necesita"      ← absurdo
    5. Pulido                         ->  SOLDADORA TIG      ← absurdo

Dos bugs sumados. «Soldadura con tig» decía "No necesita" porque la keyword "SOLDA"
la clasificaba como trabajo MANUAL; y «pulido», que no tiene familia de máquina,
heredaba las 31 máquinas del taller y se quedaba la SOLDADORA TIG porque cruzaba el
rango OFICIAL con ella. O sea: la soldadura no agarraba la soldadora, y el pulido sí
—y encima se la bloqueaba a la OT que la necesitaba de verdad—.

Los datos de abajo son los de producción: rangos reales de los procesos y de las
máquinas, verificados contra Supabase.
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import (
    _crear_variables_y_dominios,
    proceso_usa_maquina,
)

MAQ_DOMAIN_IDX = 14
DUMMY_MAQ_ID = 999998

OFICIAL, OFICIAL_PLEGADOR, OPERARIO_CALIFICADO, MEDIO_OFICIAL = 1, 2, 3, 4

# (id, {rangos}, nombre, cod_maquina) — como los devuelve el repositorio.
MAQUINAS = [
    (26, {OFICIAL}, "SOLDADORA TIG", "STIG-1"),
    (23, {MEDIO_OFICIAL}, "SOLDADORA MIG/MAG 450 1", "SM450-1"),
    (15, {OFICIAL_PLEGADOR}, "PLEGADORA", "PLE-1"),
    (1, {OFICIAL}, "TORNO 1", "TORY-1"),
]

# GUILLERMO CELIZ: OFICIAL + OFICIAL PLEGADOR + OPERARIO CALIFICADO
OPERARIOS = [(31, OFICIAL), (31, OFICIAL_PLEGADOR), (31, OPERARIO_CALIFICADO)]


def _dominios(nombre_proc, rangos_proc, familia):
    ps.H = 100000
    model = cp_model.CpModel()
    procesos_norm = [(
        7608, 100, 1, None, 5, 60, rangos_proc, nombre_proc,
        proceso_usa_maquina(nombre_proc), familia, {},
    )]
    salida = _crear_variables_y_dominios(
        model, procesos_norm, OPERARIOS, MAQUINAS, set(), set(),
    )
    return salida[MAQ_DOMAIN_IDX][(7608, 1)]


def test_la_soldadura_con_tig_usa_maquina():
    # Antes: MANUAL -> la columna Maquinaria decía "No necesita".
    assert proceso_usa_maquina("SOLDADURA CON TIG") is True


def test_la_soldadura_con_tig_se_reserva_la_soldadora_tig():
    dom = _dominios("SOLDADURA CON TIG", [OFICIAL], "SOLDADORA_TIG")
    assert 26 in dom, "la soldadura TIG tiene que poder tomar la SOLDADORA TIG"
    assert 23 not in dom, "la MIG no sustituye a la TIG"
    assert 1 not in dom and 15 not in dom


def test_el_pulido_ya_no_se_queda_la_soldadora_tig():
    # PULIDO tiene rango OFICIAL, igual que la SOLDADORA TIG: cruzaban, y como el
    # dominio arrancaba con las 31 máquinas, entraba como candidata.
    dom = _dominios("PULIDO", [OFICIAL], "")
    assert dom == [DUMMY_MAQ_ID]
    assert 26 not in dom


def test_el_plegado_sigue_sin_reservar_la_plegadora():
    # Este NO es un bug nuestro y no tiene que cambiar: la PLEGADORA pide OFICIAL
    # PLEGADOR y el proceso trae MEDIO OFICIAL / OPERARIO CALIFICADO. Es carga de
    # rangos del taller, y está restringida a propósito.
    dom = _dominios("PLEGADO", [MEDIO_OFICIAL, OPERARIO_CALIFICADO], "PLEGADORA")
    assert dom == [DUMMY_MAQ_ID]
