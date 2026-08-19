"""
La soldadura reserva la soldadora.

Historia: por el feedback A1 de Metlo (06/07) la soldadura se clasificaba como
proceso MANUAL, porque caía en PRODUCCION_MAQUINA, buscaba una familia de máquina
que no existía y el proceso quedaba "sin nadie". El agujero real estaba en
familia_requerida_from_proceso —no tenía rama de soldadura— y el parche dejaba las
cuatro soldadoras del taller sin reservarse nunca: en el plan del 19/08 «soldadura
con tig» salía con maquinaria «No necesita» mientras «pulido», que no tiene familia,
se reservaba la SOLDADORA TIG. Ahora las familias existen y la soldadura vuelve a
ser trabajo de máquina.
"""
from backend.application.PlanificacionService import (
    _get_tipo_proceso,
    familia_from_maquina,
    familia_requerida_from_proceso,
)


def test_la_soldadura_es_trabajo_de_maquina():
    for nombre in ["SOLDADURA CON TIG", "SOLDADURA CON MIG", "Soldadura de eje"]:
        assert _get_tipo_proceso(nombre) == "PRODUCCION_MAQUINA", nombre


def test_tig_y_mig_son_familias_distintas():
    # No se sustituyen: una OT de TIG no se puede hacer en la MIG.
    assert familia_requerida_from_proceso("SOLDADURA CON TIG") == "SOLDADORA_TIG"
    assert familia_requerida_from_proceso("SOLDADURA CON MIG") == "SOLDADORA_MIG"
    assert familia_requerida_from_proceso("SOLDADURA CON MIG EN INOXIDABLE") == "SOLDADORA_MIG"


def test_el_setup_cae_en_la_misma_familia_que_su_produccion():
    assert familia_requerida_from_proceso("PREPARACION DE SOLDADORA TIG") == "SOLDADORA_TIG"
    assert familia_requerida_from_proceso("PREPARACION DE SOLDADORA MIG") == "SOLDADORA_MIG"


def test_las_maquinas_del_taller_caen_en_esas_familias():
    # Los nombres son los que están cargados en producción.
    assert familia_from_maquina("SOLDADORA TIG", "STIG-1") == "SOLDADORA_TIG"
    assert familia_from_maquina("SOLDADORA MIG/MAG 450 1", "SM450-1") == "SOLDADORA_MIG"
    assert familia_from_maquina("SOLDADORA PORTATIL MIG/ELEC", "SOLDPORT-3") == "SOLDADORA_MIG"


def test_soldadura_a_secas_no_elige_maquina():
    # No dice si es TIG o MIG: sin familia va sin máquina, que es la verdad, en vez
    # de dejarla agarrar cualquiera de las dos.
    assert familia_requerida_from_proceso("SOLDADURA") == ""
    assert familia_requerida_from_proceso("SOLDADURA CON ELECTRODO") == ""


def test_una_familia_explicita_le_gana_a_la_soldadura():
    # La rama de soldadura va última justamente para esto.
    assert familia_requerida_from_proceso("BICELADO PARA SOLDADURA") == ""
    assert familia_requerida_from_proceso("PREPARACION DE TORNO") == "TORNO"


def test_no_rompe_otras_clasificaciones():
    # Sanidad: procesos de máquina, setup y manuales siguen igual.
    assert _get_tipo_proceso("CILINDRADO") == "PRODUCCION_MAQUINA"
    assert _get_tipo_proceso("PREPARACION TORNO") == "SETUP"
    assert _get_tipo_proceso("AJUSTE") == "MANUAL"
    assert _get_tipo_proceso("AMOLADO") == "MANUAL"
    assert familia_requerida_from_proceso("TORNO T1") == "TORNO"
    assert familia_requerida_from_proceso("PLEGADO") == "PLEGADORA"
    assert familia_requerida_from_proceso("AVELLANADO") == "AGUJEREADORA"
