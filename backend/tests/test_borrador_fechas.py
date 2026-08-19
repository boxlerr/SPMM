"""
El rango de fechas del borrador viaja como string desde el frontend y la columna
es DATE. asyncpg no convierte: revienta con "'str' object has no attribute
'toordinal'".

Importa más de lo que parece porque `guardar` se traga las excepciones a propósito
—es un autosave y no puede voltear la pantalla en la que alguien está trabajando—,
así que el fallo salía por el log y el borrador simplemente no se guardaba nunca en
la base. En silencio, y con la copia del navegador tapando el agujero.
"""
from datetime import date, datetime

from backend.infrastructure.PlanificacionBorradorRepository import _a_fecha


def test_string_iso_del_frontend():
    assert _a_fecha("2026-08-19") == date(2026, 8, 19)


def test_string_iso_con_hora():
    assert _a_fecha("2026-08-19T07:00:00") == date(2026, 8, 19)


def test_date_y_datetime_pasan_derecho():
    assert _a_fecha(date(2026, 8, 19)) == date(2026, 8, 19)
    assert _a_fecha(datetime(2026, 8, 19, 7, 30)) == date(2026, 8, 19)


def test_vacio_es_none():
    for v in (None, "", 0):
        assert _a_fecha(v) is None


def test_fecha_ilegible_no_pierde_el_borrador():
    # El rango es un dato de la lista, no el borrador: si no se entiende se guarda
    # sin rango antes que tirar el plan entero.
    assert _a_fecha("ayer") is None
    assert _a_fecha("19/08/2026") is None
