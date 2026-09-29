"""
Torno y fresadora CNC son otra familia que los convencionales (reunión con Lucas, 29/9/2026).

Lo que vio Lucas en la OT 15644: «Fresadora F6» —fresado convencional— salió en la
FRESADORA CNC. Torno y fresadora eran UNA sola familia, así que alcanzaba con que la CNC
aceptara el rango del proceso: en el borrador de las 48 OT alguien había aceptado el
consejo «sumar OFICIAL a la FRESADORA CNC» del aviso de cuello de máquina (que agrupaba las
cuatro fresadoras) y desde ahí el fresado convencional podía caer en la CNC. Con los tornos
pasaba lo mismo sin ajuste: los tres CNC aceptan OFICIAL, igual que «TORNO T1».

La regla de Lucas: «si no dice CNC y dice fresadora, es fresadora convencional», y lo
mismo el torno. Y el tipo de máquina cargado en Recursos le gana al nombre de la máquina.
"""
import inspect
import re

import pytest
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.MaquinariaService import TIPOS_MAQUINA
from backend.application.PlanificacionService import (
    FAMILIAS_MAQUINA,
    _crear_variables_y_dominios,
    _pares_setup_produccion,
    _partir_y_heredar,
    familia_base,
    familia_de_maquina,
    familia_from_maquina,
    familia_requerida_from_proceso,
)

MAQ_DOMAIN_IDX = 14  # maq_domain_vals

OFICIAL, OFICIAL_CNC = 6, 7
FRESADORA_1, FRESADORA_VN, FRESADORA_CNC = 9, 11, 12
TORNO_1, TORNO_CNC_1 = 1, 5
# (id, {rangos}, nombre, cod_maquina) — como están en el taller el 29/9, con el ajuste
# del borrador puesto: la FRESADORA CNC también acepta OFICIAL.
MAQUINAS = [
    (FRESADORA_1, {OFICIAL}, "FRESADORA 1", "FREY-1"),
    (FRESADORA_VN, {OFICIAL}, "FRESADORA VAN NORMAN ", "FVNP-1"),
    (FRESADORA_CNC, {OFICIAL, OFICIAL_CNC}, "FRESADORA CNC", None),
    (TORNO_1, {OFICIAL}, "TORNO 1", "TORY-1"),
    (TORNO_CNC_1, {OFICIAL, 8, 14}, "TORNO CNC 1", "TCNCY-1"),
]
OPERARIOS = [(10, OFICIAL), (11, OFICIAL_CNC)]


def _dominio(nombre_proceso, rangos=(OFICIAL,), maquinas=MAQUINAS):
    ps.H = 100000
    model = cp_model.CpModel()
    familia = familia_requerida_from_proceso(nombre_proceso)
    procesos_norm = [(1, 500, 1, None, 5, 60, list(rangos), nombre_proceso, True, familia, {})]
    salida = _crear_variables_y_dominios(model, procesos_norm, OPERARIOS, maquinas, set(), set())
    return set(salida[MAQ_DOMAIN_IDX][(1, 1)]) - {999998}


@pytest.mark.parametrize("nombre, familia", [
    ("TORNO T1", "TORNO"), ("TORNO T6", "TORNO"), ("TORNEADO", "TORNO"),
    ("PREPARACION DE TORNO", "TORNO"), ("ROSCADO", "TORNO"), ("REPUJADO EN TORNO", "TORNO"),
    ("TORNO CNC", "TORNO_CNC"), ("TORNEADO CNC", "TORNO_CNC"),
    ("PROGRAMACION TORNO CNC", "TORNO_CNC"), ("PREPARACION DE TORNO CNC", "TORNO_CNC"),
    ("FRESADORA F6", "FRESADORA"), ("FRESADO CONVENCIONAL", "FRESADORA"),
    ("AGUJEREADO EN FRESADORA", "FRESADORA"), ("TALLADO EN FRESADORA", "FRESADORA"),
    ("PREPARACION DE FRESADORA", "FRESADORA"),
    ("FRESADORA CNC", "FRESADORA_CNC"), ("FRESADO CNC", "FRESADORA_CNC"),
    ("TALLADO EN FRESADORA CNC", "FRESADORA_CNC"), ("PROGRAMACION FRESADORA CNC", "FRESADORA_CNC"),
])
def test_sin_cnc_en_el_nombre_es_convencional(nombre, familia):
    assert familia_requerida_from_proceso(nombre) == familia


@pytest.mark.parametrize("nombre, familia", [
    ("TORNO 1", "TORNO"), ("TORNO 6 CINDELMET", "TORNO"), ("TORNO CNC 3", "TORNO_CNC"),
    ("FRESADORA 1", "FRESADORA"), ("FRESADORA VAN NORMAN ", "FRESADORA"),
    ("FRESADORA CNC", "FRESADORA_CNC"),
])
def test_las_maquinas_del_taller_por_su_nombre(nombre, familia):
    assert familia_from_maquina(nombre, "") == familia


def test_el_fresado_convencional_no_cae_en_la_fresadora_cnc():
    """El caso de la OT 15644: aunque la CNC acepte OFICIAL, «Fresadora F6» no la toma."""
    for nombre in ("FRESADORA F6", "FRESADO CONVENCIONAL"):
        assert _dominio(nombre) == {FRESADORA_1, FRESADORA_VN}, nombre


def test_el_torno_convencional_no_cae_en_un_torno_cnc():
    for nombre in ("TORNO T1", "TORNEADO"):
        assert _dominio(nombre) == {TORNO_1}, nombre


def test_lo_cnc_va_solo_a_las_cnc():
    assert _dominio("FRESADO CNC", rangos=(OFICIAL_CNC,)) == {FRESADORA_CNC}
    assert _dominio("TORNEADO CNC", rangos=(OFICIAL,)) == {TORNO_CNC_1}


def test_el_tipo_cargado_le_gana_al_nombre_de_la_maquina():
    """Si en Recursos la máquina dice «Torno CNC», es CNC aunque el nombre no lo diga
    (y al revés): el tipo es lo que dijo el taller; el nombre, lo que deducimos."""
    assert familia_from_maquina("TORNO NUEVO", "", "TORNO_CNC") == "TORNO_CNC"
    assert familia_from_maquina("TORNO CNC 1", "TCNCY-1", "TORNO") == "TORNO"
    maquinas = [(77, {OFICIAL}, "TORNO NUEVO", "TN-1", "TORNO_CNC"), (TORNO_1, {OFICIAL}, "TORNO 1", "TORY-1", None)]
    assert _dominio("TORNEADO CNC", maquinas=maquinas) == {77}
    assert _dominio("TORNEADO", maquinas=maquinas) == {TORNO_1}


@pytest.mark.parametrize("tipo", [None, "", "OTRO", "CUALQUIERA"])
def test_sin_tipo_o_con_otro_decide_el_nombre(tipo):
    assert familia_from_maquina("FRESADORA CNC", None, tipo) == "FRESADORA_CNC"
    assert familia_from_maquina("FRESADORA 2", "FREY-2", tipo) == "FRESADORA"


def test_el_tipo_se_lee_como_lo_guarda_recursos():
    assert familia_from_maquina("X", "", "Torno CNC") == "TORNO_CNC"
    assert familia_from_maquina("X", "", " fresadora_cnc ") == "FRESADORA_CNC"


def test_tuplas_de_cuatro_y_de_cinco():
    assert familia_de_maquina((1, set(), "TORNO CNC 1", "TCNCY-1")) == "TORNO_CNC"
    assert familia_de_maquina((1, set(), "TORNO CNC 1", "TCNCY-1", "TORNO")) == "TORNO"


def test_familias_del_planificador_tipos_de_recursos_y_la_constante_son_lo_mismo():
    fuente = inspect.getsource(familia_requerida_from_proceso)
    devueltas = set(re.findall(r'return "([A-Z_]+)"', fuente))
    assert devueltas == set(FAMILIAS_MAQUINA)
    assert set(TIPOS_MAQUINA) - {"OTRO"} == set(FAMILIAS_MAQUINA)


def test_familia_base():
    assert familia_base("TORNO_CNC") == "TORNO"
    assert familia_base("FRESADORA_CNC") == "FRESADORA"
    assert familia_base("SOLDADORA_MIG") == "SOLDADORA_MIG"


# ── La preparación con su trabajo ────────────────────────────────────────────
def _pn(pasos):
    """[(secuencia, nombre)] → procesos_norm de una sola OT."""
    return [(1, 600 + s, s, None, 5, 30, [OFICIAL], n, True, familia_requerida_from_proceso(n), {})
            for s, n in pasos]


def _pares(pasos):
    return [(s[0][1], p[0][1]) for s, p in _pares_setup_produccion(_pn(pasos))]


def test_la_preparacion_generica_prepara_el_trabajo_cnc():
    """En el Integral hay OT con «PREPARACION DE TORNO» seguida de «TORNO CNC»: separar
    las familias no puede dejarlas sin pareja (misma máquina y misma persona)."""
    assert _pares([(1, "PREPARACION DE TORNO"), (2, "TORNO CNC")]) == [(1, 2)]
    assert _pares([(1, "PREPARACION DE FRESADORA"), (2, "FRESADO CNC")]) == [(1, 2)]


def test_la_preparacion_cnc_no_prepara_un_torno_convencional():
    assert _pares([(1, "PROGRAMACION TORNO CNC"), (2, "TORNEADO")]) == []


def test_la_preparacion_de_su_misma_familia_gana():
    pasos = [(1, "PREPARACION DE TORNO"), (2, "PROGRAMACION TORNO CNC"), (3, "TORNO CNC"), (4, "TORNEADO")]
    assert _pares(pasos) == [(2, 3), (1, 4)]


def test_la_preparacion_hereda_la_familia_cnc_de_su_trabajo():
    """Así la preparación reserva un torno CNC, el mismo que el trabajo."""
    procesos, *_ = _partir_y_heredar(_pn([(1, "PREPARACION DE TORNO"), (2, "TORNO CNC")]))
    # (la partición en tramos renumera las secuencias: se mira el orden, no el número)
    assert [(p[7], p[9]) for p in sorted(procesos, key=lambda p: p[2])] == [
        ("PREPARACION DE TORNO", "TORNO_CNC"), ("TORNO CNC", "TORNO_CNC")]


def test_lo_de_siempre_sigue_igual():
    assert _pares([(1, "PREPARACION DE TORNO"), (2, "TORNO T1")]) == [(1, 2)]
    assert _pares([(1, "PREPARACION DE FRESADORA"), (2, "FRESADORA F6")]) == [(1, 2)]
    assert _pares([(1, "PROGRAMACION FRESADORA CNC"), (2, "FRESADORA CNC")]) == [(1, 2)]
    assert _pares([(1, "PREPARACION DE SOLDADORA MIG"), (2, "TORNO T2")]) == []
