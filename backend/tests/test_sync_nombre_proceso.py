"""
Tests del normalizador de nombres de proceso del sync.

El catálogo se COSECHA de texto libre del legacy (Q_PROCESOS = DISTINCT de lo que
alguien tipeó en cada línea de OT), así que cada variante entra como un proceso NUEVO.
Y un proceso nuevo nace sin rango, que para el planificador significa "lo puede hacer
cualquiera". De ahí salieron gemelos como 'FRESADORA  ENGRASADO' / 'FRESADORA ENGRASADO'.

`_clave` ya empareja por mayúsculas y por espacios de las PUNTAS; lo que faltaba era
colapsar los de adentro, que es lo que agrega `_nombre_proceso`.
"""
from backend.scripts.sync_db import _clave, _nombre_proceso


def test_recorta_las_puntas():
    assert _nombre_proceso("  TORNEADO  ") == "TORNEADO"


def test_colapsa_los_espacios_de_adentro():
    # El caso real: los ids 3200 y 3201 eran esto mismo, dos filas distintas.
    assert _nombre_proceso("FRESADORA  ENGRASADO") == "FRESADORA ENGRASADO"


def test_los_gemelos_por_espacios_terminan_con_la_misma_clave():
    # Es lo que evita el INSERT duplicado: _upsert machea con _clave sobre el
    # nombre ya normalizado.
    a = _clave(_nombre_proceso("FRESADORA  ENGRASADO"))
    b = _clave(_nombre_proceso("fresadora engrasado "))
    assert a == b == "FRESADORA ENGRASADO"


def test_tabs_y_saltos_cuentan_como_espacio():
    assert _nombre_proceso("CORTE\tCON\nAMOLADORA") == "CORTE CON AMOLADORA"


def test_no_toca_lo_que_ya_esta_bien():
    assert _nombre_proceso("AGUJEREADO EN FRESADORA") == "AGUJEREADO EN FRESADORA"


def test_vacio_queda_vacio():
    # El paso del sync descarta los vacíos: esto garantiza que un nombre de puros
    # espacios caiga en ese descarte y no cree un proceso con el nombre en blanco
    # (que es exactamente lo que era el id 3177).
    assert _nombre_proceso("   ") == ""


def test_deja_pasar_lo_que_no_es_texto():
    assert _nombre_proceso(None) is None
