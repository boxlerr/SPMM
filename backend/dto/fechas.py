"""
Fechas que entran por la API, sin zona horaria.

El navegador manda las fechas con `new Date(...).toISOString()`, o sea con la Z de
UTC al final: `"2026-09-03T00:00:00.000Z"`. Pydantic las convierte en un datetime
CON zona, y las columnas de fecha de la base son `timestamp without time zone`.
asyncpg no acepta esa mezcla y corta el guardado con:

    asyncpg.exceptions.DataError: invalid input for query argument $2:
    datetime.datetime(2026, 9, 3, 0, 0, tzinfo=...)
    (can't subtract offset-naive and offset-aware datetimes)

que el usuario veía como «Error al actualizar la Orden de Trabajo» sin más.

Se normaliza acá, en la puerta de entrada, y no en cada repositorio: así vale para
el alta y para la edición sin repetir el arreglo en dos lados.

Las fechas del formulario salen de un `<input type="date">`, o sea que llegan como
medianoche UTC. Pasarlas a UTC y sacarles la zona deja exactamente el mismo día
—`2026-09-03 00:00:00`—, que es como están guardadas las 1252 filas que trajo el
sync del sistema viejo. No se corre ningún día.
"""
from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator


def sin_zona(v):
    """Datetime con zona -> el mismo instante en UTC, sin zona. El resto pasa igual."""
    if isinstance(v, datetime) and v.tzinfo is not None:
        return v.astimezone(timezone.utc).replace(tzinfo=None)
    return v


FechaSinZona = Annotated[datetime, AfterValidator(sin_zona)]
