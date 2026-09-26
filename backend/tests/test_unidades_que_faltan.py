"""El plan cuenta solo las unidades que faltan (Julián, 25/9/2026, OT 13348: 199 de 200)."""
from types import SimpleNamespace

from backend.application.PlanificacionService import (
    _marcar_lineas,
    minutos_de_lo_que_falta,
    unidades_hechas,
)


def test_produccion_se_achica_a_lo_que_falta():
    # 13348: soldadura TIG de 2.400 min para 200 unidades, 199 entregadas → 12 min.
    assert minutos_de_lo_que_falta(2400, "SOLDADURA CON TIG", 200, 199) == 12


def test_redondea_para_arriba_y_nunca_da_cero():
    assert minutos_de_lo_que_falta(100, "TORNO CNC", 3, 2) == 34
    assert minutos_de_lo_que_falta(1, "TORNO CNC", 200, 199) == 1


def test_preparacion_y_programacion_quedan_enteras():
    assert minutos_de_lo_que_falta(30, "PREPARACION DE SOLDADORA TIG", 200, 199) == 30
    assert minutos_de_lo_que_falta(40, "PROGRAMACION FRESADORA CNC", 200, 199) == 40


def test_sin_datos_o_sin_avance_no_toca_nada():
    assert minutos_de_lo_que_falta(900, "FRESADORA CNC", None, 0) == 900
    assert minutos_de_lo_que_falta(900, "FRESADORA CNC", 0, 5) == 900
    assert minutos_de_lo_que_falta(900, "FRESADORA CNC", 200, 0) == 900


def test_todo_hecho_pero_abierta_no_inventa_cero():
    # Dato raro (lo decide el taller): se planifica lo cargado.
    assert minutos_de_lo_que_falta(900, "FRESADORA CNC", 10, 10) == 900


def test_tiempo_vacio_cuenta_un_minuto_como_siempre():
    assert minutos_de_lo_que_falta(None, "TORNO", 10, 0) == 1
    assert minutos_de_lo_que_falta(0, "TORNO", 10, 0) == 1


def test_hechas_toma_lo_mayor_entre_entregadas_y_terminadas():
    assert unidades_hechas(SimpleNamespace(cantidad_entregada=10, cantidad_finalizada_parcial=None)) == 10
    assert unidades_hechas(SimpleNamespace(cantidad_entregada=10, cantidad_finalizada_parcial=25)) == 25
    assert unidades_hechas(SimpleNamespace(cantidad_entregada=None, cantidad_finalizada_parcial=None)) == 0


def test_la_fila_del_plan_lleva_el_lote_para_mostrarlo():
    filas = [{"orden_id": 7495, "secuencia": 6}, {"orden_id": 7495, "secuencia": 1}]
    _marcar_lineas(filas, {(7495, 6): 99}, {(7495, 6): (2400, 200, 1)})
    assert filas[0]["minutos_lote"] == 2400 and filas[0]["unidades_faltan"] == 1
    assert "minutos_lote" not in filas[1]
