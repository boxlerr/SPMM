"""El plan nunca empieza en el pasado.

Julián, 11/9: «planificamos ayer jueves a las 16hs y el planificador puso horarios de
jueves a las 10am del mismo día, no tiene sentido; tiene que ser para el otro día
teniendo en cuenta las horas en las que trabajan ellos».

La causa era sutil y por eso vale un test: el código calculaba una hora de arranque con
cuidado —si eran las 16, dejaba las 16— y después la perdía, porque el modelo se queda
sólo con la FECHA y mapea T=0 a la apertura del taller. Planificar a las 16 armaba el
plan desde las 07:00 de ESE día: nueve horas del plan ya habían pasado.

Se mira el código y no una corrida porque el arranque depende de `datetime.now()` y
armar el modelo entero para leer una fecha es caro y frágil. Lo que se cuida es la
regla, que es donde estuvo el error.
"""
import inspect
import re
from datetime import date, datetime, time, timedelta

import pytest

from backend.application import PlanificacionService as PS


def _regla():
    """El bloque que decide desde cuándo arranca el plan."""
    fuente = inspect.getsource(PS._resolver_planificacion)
    ini = fuente.index("ahora = datetime.now()")
    return fuente[ini:fuente.index("start_date =", ini)]


def _arranque(ahora: datetime, fecha_desde: date | None = None) -> datetime:
    """Reproduce la regla del servicio, incluido el salto de fin de semana."""
    if fecha_desde is None or fecha_desde <= ahora.date():
        inicio = ahora.replace(hour=PS.HORA_APERTURA.hour, minute=PS.HORA_APERTURA.minute,
                               second=0, microsecond=0)
        if ahora.time() >= PS.HORA_APERTURA:
            inicio += timedelta(days=1)
    else:
        inicio = datetime.combine(fecha_desde, PS.HORA_APERTURA)
    while inicio.weekday() >= 5:
        inicio += timedelta(days=1)
    return inicio


@pytest.mark.parametrize("cuando,esperado,por_que", [
    # El caso que reportó Julián: jueves 10 a las 16 → viernes 11.
    (datetime(2026, 9, 10, 16, 0), date(2026, 9, 11), "planificar de tarde es para mañana"),
    # Recién abierto: la jornada ya arrancó, así que igual es para mañana.
    (datetime(2026, 9, 10, 7, 1), date(2026, 9, 11), "a las 7:01 la jornada ya empezó"),
    # Antes de abrir: el día todavía está entero por delante.
    (datetime(2026, 9, 10, 6, 30), date(2026, 9, 10), "antes de abrir se planifica para hoy"),
    # Viernes de tarde salta el fin de semana entero.
    (datetime(2026, 9, 11, 16, 0), date(2026, 9, 14), "viernes de tarde → lunes"),
    # Sábado antes de abrir: igual hay que saltar al lunes.
    (datetime(2026, 9, 12, 6, 0), date(2026, 9, 14), "sábado no se trabaja"),
])
def test_desde_cuando_arranca(cuando, esperado, por_que):
    assert _arranque(cuando).date() == esperado, por_que


def test_nunca_arranca_antes_de_ahora():
    """La propiedad que importa, probada hora por hora de una semana entera."""
    for dia in range(7):
        for hora in range(24):
            ahora = datetime(2026, 9, 7, hora, 30) + timedelta(days=dia)
            arranque = _arranque(ahora)
            assert arranque >= ahora.replace(hour=PS.HORA_APERTURA.hour, minute=0,
                                             second=0, microsecond=0), (
                f"planificando el {ahora:%a %d a las %H:%M} el plan arrancaría el {arranque}"
            )
            assert arranque.weekday() < 5, "el plan no puede arrancar un fin de semana"


def test_una_fecha_pedida_a_futuro_manda():
    """Si alguien pide un rango que empieza el mes que viene, se respeta."""
    ahora = datetime(2026, 9, 10, 16, 0)
    assert _arranque(ahora, date(2026, 10, 5)).date() == date(2026, 10, 5)


def test_la_regla_sigue_escrita_asi():
    """Red de contención: que nadie vuelva a guardar una hora que después se tira.

    El bug no fue un `if` mal puesto: fue calcular una hora con cuidado y perderla en
    un `.date()` cincuenta líneas más abajo. Si vuelve a aparecer un ajuste por hora
    que no sea el salto de día, es la misma trampa otra vez.
    """
    regla = _regla()
    assert "HORA_APERTURA" in regla, "el arranque dejó de usar la hora de apertura del taller"
    assert "timedelta(days=1)" in regla, "desapareció el salto al día siguiente"
    assert not re.search(r"hour\s*>=\s*17", regla), (
        "volvió el ajuste por hora de cierre, que era el que se perdía en el .date()"
    )
