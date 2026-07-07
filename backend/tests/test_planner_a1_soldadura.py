"""
Test de A1 (feedback Metlo 06/07): la soldadura se clasifica como proceso MANUAL
(depende del soldador, no de una máquina) para que no quede "sin nadie".
"""
from backend.application.PlanificacionService import _get_tipo_proceso


def test_soldadura_mig_es_manual():
    assert _get_tipo_proceso("SOLDADURA MIG") == "MANUAL"


def test_variantes_soldadura_son_manuales():
    for nombre in ["SOLDADURA TIG", "SOLDAR", "SOLDADURA POR PUNTOS", "Soldadura de eje"]:
        assert _get_tipo_proceso(nombre) == "MANUAL", nombre


def test_no_rompe_otras_clasificaciones():
    # Sanidad: procesos de máquina y setup siguen igual.
    assert _get_tipo_proceso("CILINDRADO") == "PRODUCCION_MAQUINA"
    assert _get_tipo_proceso("PREPARACION TORNO") == "SETUP"
    assert _get_tipo_proceso("AJUSTE") == "MANUAL"
