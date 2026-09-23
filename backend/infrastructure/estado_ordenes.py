"""
El estado de una OT en el tablero (RF-02), escrito UNA vez para todo el Dashboard.

POR QUÉ ESTE ARCHIVO

El Dashboard contaba las OT por estado con una regla (las cuatro tarjetas) y armaba la
lista que se abre al tocar cada tarjeta con OTRA consulta, escrita aparte:

  · Pendientes y Retrasadas comparaban contra GETDATE, que es de SQL Server. En
    Postgres (producción desde el 28/07) esa consulta da error y la lista se abría
    VACÍA aunque la tarjeta dijera 40.
  · Aunque hubiera andado, no cerraba con la tarjeta: la lista cortaba con la hora de
    ahora y la tarjeta con el día (una OT prometida para hoy era «Retrasada» en la
    lista y «Pendiente» en la tarjeta), la lista contaba el 1950-01-01 como fecha real
    (la tarjeta no) y los JOIN obligatorios con artículo y sector se comían las OT sin
    esos datos.
  · El rótulo de cada fila decía «Completada» si fecha_entrega tenía CUALQUIER cosa, y
    el sistema viejo guarda «sin fecha» como 1950-01-01 (y hay listados con 3000-01-01):
    OT abiertas salían completadas.

Ahora la tarjeta, su lista, el rótulo de cada fila y las demás listas del Dashboard leen
el estado de la misma expresión SQL (`ESTADO_SQL`). Si cambia la regla, cambia en un solo
lugar y los números no se pueden separar.

LA REGLA (la de las tarjetas, sin tocar: es el número que Lucas mira todos los días)

  completadas  finalizadototal = 1
  en_curso     no finalizada y con algún paso arrancado (id_estado > 1)
  retrasadas   no finalizada, ningún paso arrancado y fecha prometida REAL anterior a hoy
  pendientes   no finalizada, ningún paso arrancado y prometida hoy, más adelante o sin
               fecha (NULL, 1950-01-01 o 3000-01-01)

Es un CASE: cada OT cae en UNO solo de los cuatro y los cuatro suman el total.

«Hoy» es el día del TALLER (hora local de Argentina, sin zona, como todas las fechas de
la base), no el CURRENT_DATE de Postgres: Supabase corre en UTC, y entre las 21:00 y la
medianoche de acá ya es mañana allá — una OT prometida para hoy saltaba a «Retrasada» a
las nueve de la noche.

LAS FECHAS «SIN FECHA»

El sistema viejo guarda «sin fecha» como 1950-01-01 y algunos listados usan 3000-01-01
para lo que no vence. Una fecha es real si es posterior a la primera y anterior a la
segunda (`fecha_real`). Los centinelas van como parámetros con tipo DateTime y no como
literales: así SQLite (los tests) compara igual que Postgres. Con el literal '1950-01-01'
SQLite compara TEXTO y '1950-01-01 00:00:00' le da mayor.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import DateTime, bindparam, text

# Los dos centinelas de «sin fecha» que conviven en esta base (mismos valores que
# AlertaRetrasoService).
SIN_FECHA_VIEJA = datetime(1950, 1, 1)
SIN_FECHA_NUEVA = datetime(3000, 1, 1)

# Hora del taller, sin zona. Offset fijo y no ZoneInfo: Argentina no tiene horario de
# verano y así no depende de que el servidor tenga la base de husos (mismo criterio que
# auditoria_movimientos.ahora_ar).
_AR = timezone(timedelta(hours=-3))


def ahora_ar() -> datetime:
    return datetime.now(_AR).replace(tzinfo=None)


def hoy_ar() -> datetime:
    """Hoy a las 00:00, hora del taller. Es el corte de «retrasada»: una OT prometida
    para hoy todavía no lo está."""
    return ahora_ar().replace(hour=0, minute=0, second=0, microsecond=0)


def leer_fecha(valor) -> datetime | None:
    """Un valor de fecha leído de la base, como datetime. Postgres lo da como datetime;
    SQLite, en una consulta de texto, como el string con que lo guardó."""
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor
    if isinstance(valor, date):
        return datetime(valor.year, valor.month, valor.day)
    try:
        return datetime.fromisoformat(str(valor).strip())
    except ValueError:
        return None


def es_fecha_real(valor) -> bool:
    """Lo mismo que `fecha_real()` pero para un valor ya leído (en Python)."""
    f = leer_fecha(valor)
    return f is not None and SIN_FECHA_VIEJA < f < SIN_FECHA_NUEVA


def fecha_o_nada(valor) -> str | None:
    """AAAA-MM-DD si es una fecha real; None si está vacía o es un centinela."""
    if not es_fecha_real(valor):
        return None
    return leer_fecha(valor).strftime("%Y-%m-%d")


def fecha_real(columna: str) -> str:
    """SQL: la columna tiene una fecha de verdad (ni vacía ni un centinela)."""
    return (f"({columna} IS NOT NULL AND {columna} > :sin_fecha_vieja "
            f"AND {columna} < :sin_fecha_nueva)")


def sin_fecha(columna: str) -> str:
    """SQL: la columna está vacía o tiene un centinela."""
    return (f"({columna} IS NULL OR {columna} <= :sin_fecha_vieja "
            f"OR {columna} >= :sin_fecha_nueva)")


# El estado de la OT `ot` (alias obligatorio). Ver la regla en el encabezado.
ESTADO_SQL = """
    CASE
        WHEN COALESCE(ot.finalizadototal, 0) = 1 THEN 'completadas'
        WHEN EXISTS (SELECT 1 FROM orden_trabajo_proceso otp_est
                     WHERE otp_est.id_orden_trabajo = ot.id
                       AND otp_est.id_estado > 1) THEN 'en_curso'
        WHEN ot.fecha_prometida > :sin_fecha_vieja
         AND ot.fecha_prometida < :hoy THEN 'retrasadas'
        ELSE 'pendientes'
    END
"""

ESTADOS = ("completadas", "en_curso", "pendientes", "retrasadas")

# Cómo se lee cada estado en una fila de las listas.
ROTULO = {
    "completadas": "Completada",
    "en_curso": "En Curso",
    "pendientes": "Pendiente",
    "retrasadas": "Retrasada",
}

# Los nombres con que la pantalla pide cada lista. «en_proceso» es el viejo y lo siguen
# mandando algunos clientes: se acepta igual.
ALIAS = {
    "completadas": "completadas",
    "en_curso": "en_curso",
    "en_proceso": "en_curso",
    "pendientes": "pendientes",
    "retrasadas": "retrasadas",
}

# Una OT que todavía tiene que salir del taller: no está finalizada ni tiene una
# entrega real. Es lo que miran las órdenes críticas y las próximas entregas: una OT ya
# finalizada no está «por vencer» aunque nadie le haya cargado la fecha de entrega.
POR_ENTREGAR_SQL = (
    f"(COALESCE(ot.finalizadototal, 0) <> 1 AND {sin_fecha('ot.fecha_entrega')})"
)

_FECHAS = ("hoy", "sin_fecha_vieja", "sin_fecha_nueva", "desde", "hasta")


def consulta(sql: str):
    """`text(sql)` con las fechas tipadas como DateTime (ver «LAS FECHAS» arriba)."""
    presentes = [n for n in _FECHAS if re.search(rf":{n}\b", sql)]
    return text(sql).bindparams(*(bindparam(n, type_=DateTime()) for n in presentes))


def parametros(hoy: datetime | None = None, **extra) -> dict:
    """Los parámetros de fecha que usan estas expresiones, más los que se agreguen."""
    return {
        "hoy": hoy or hoy_ar(),
        "sin_fecha_vieja": SIN_FECHA_VIEJA,
        "sin_fecha_nueva": SIN_FECHA_NUEVA,
        **extra,
    }
