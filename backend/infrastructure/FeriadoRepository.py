"""Los feriados de Argentina, traídos solos, y si el taller trabaja cada uno.

El 8/10/2026 dia_bloqueado no tenía nada después de febrero y el planificador ponía un
tercio de los pasos el lunes 12/10, feriado. Cargarlos a mano no funcionaba: nadie se
acordaba. Ahora el calendario oficial se trae de ArgentinaDatos (una API pública que
publica cada año con los traslados y los puentes decretados) y queda en la tabla
`feriado`; el taller sólo elige, al planificar, si trabaja o no cada día.

QUÉ BLOQUEA (`bloquea`)

    se_trabaja = True   → no bloquea.
    se_trabaja = False  → bloquea.
    se_trabaja = None   → nadie lo eligió: un feriado bloquea; un día no laborable
                          («puente») no, porque es optativo para el empleador.

El planificador no trabaja la UNIÓN de dia_bloqueado y de los feriados que bloquean (ver
DiaBloqueadoRepository). Así un feriado no se copia a dia_bloqueado y elegir «se
trabaja» no tiene que borrar nada de otra tabla.

CUÁNDO SE TRAE

`asegurar_anios` lo llama la pantalla (`GET /config/availability` y `/config/feriados`,
que se piden al abrir el Paso 1). Trae el año de hoy y el siguiente si no hay nada o si
la última vez fue hace más de una semana: a veces se decreta un feriado en el año (el
9/11/2026, por la visita del Papa). NUNCA lo llama el planificador: un cálculo no puede
depender de que conteste un servidor de afuera. Si la fuente no contesta, queda lo que
ya estaba y se reintenta a la hora; si un año todavía no está publicado (lista vacía),
no se borra nada.
"""
import asyncio
import json
import re
import time
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import text

from backend.commons.loggers.logger import logger

FUENTE = "https://api.argentinadatos.com/v1/feriados/{anio}"
TIMEOUT_SEG = 6
CADA_CUANTO = timedelta(days=7)
# Si la fuente falló, cuánto esperar antes de volver a pedirla (por instancia).
REINTENTO_SEG = 3600
TIPOS = ("inamovible", "trasladable", "puente")

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")
# año → time.monotonic() del último intento que falló. Por proceso, a propósito: no
# vale la pena guardar en la base que un servidor de afuera no contestó.
_FALLO: dict[int, float] = {}
# año → time.monotonic() de la última vez que la fuente contestó que ese año todavía no
# tiene feriados publicados (pasa con el año que viene hasta fin de año). Sin esto, como
# no queda ninguna fila de ese año, CADA GET /config/availability o /config/feriados
# volvía a salir a internet a preguntarlo (hasta 6 s, con la conexión a la base tomada).
# Se vuelve a preguntar a la hora, como después de un fallo.
_SIN_PUBLICAR: dict[int, float] = {}


def _ahora_ar() -> datetime:
    return datetime.now(_TZ_AR).replace(tzinfo=None)


def bloquea(tipo: str, se_trabaja: bool | None) -> bool:
    """¿El planificador saltea este feriado? Ver el docstring del módulo."""
    if se_trabaja is not None:
        return not se_trabaja
    return tipo != "puente"


# La misma regla en SQL, para leer sólo las fechas que bloquean.
SQL_BLOQUEA = "(se_trabaja = false OR (se_trabaja IS NULL AND tipo <> 'puente'))"


def _a_fecha(valor) -> date:
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    return date.fromisoformat(str(valor)[:10])


def _a_datetime(valor) -> datetime | None:
    if valor is None or isinstance(valor, datetime):
        return valor
    return datetime.fromisoformat(str(valor))


def leer_fuente(anio: int) -> list[dict]:
    """Los feriados de un año según ArgentinaDatos, ya validados. Bloqueante: va en un hilo.

    Levanta si no contesta o si lo que contesta no tiene la forma esperada: mejor no
    traer nada que guardar basura en el calendario del taller.
    """
    pedido = urllib.request.Request(
        FUENTE.format(anio=anio),
        headers={"Accept": "application/json", "User-Agent": "SPMM (planificador del taller)"},
    )
    with urllib.request.urlopen(pedido, timeout=TIMEOUT_SEG) as r:
        datos = json.loads(r.read().decode("utf-8"))
    return validar_fuente(datos, anio)


def validar_fuente(datos, anio: int) -> list[dict]:
    """Lo que contestó la fuente, como filas de `feriado`. Levanta si no tiene la forma esperada."""
    if not isinstance(datos, list):
        raise ValueError(f"La fuente de feriados devolvió {type(datos).__name__}, no una lista")
    salida = {}
    for d in datos:
        fecha = str(d.get("fecha", ""))
        if not re.fullmatch(rf"{anio}-\d{{2}}-\d{{2}}", fecha):
            raise ValueError(f"Fecha de feriado inesperada: {fecha!r}")
        tipo = str(d.get("tipo", "")).strip().lower()
        nombre = str(d.get("nombre", "")).strip()[:200]
        if tipo not in TIPOS or not nombre:
            raise ValueError(f"Feriado con tipo o nombre inesperado: {d!r}")
        # Dos feriados el mismo día (pasa: el 2/4 de algún año) quedan en un renglón.
        if fecha in salida:
            salida[fecha]["nombre"] = f"{salida[fecha]['nombre']} / {nombre}"[:200]
            if salida[fecha]["tipo"] == "puente":
                salida[fecha]["tipo"] = tipo
        else:
            salida[fecha] = {"fecha": date.fromisoformat(fecha), "tipo": tipo, "nombre": nombre}
    return list(salida.values())


class FeriadoRepository:
    def __init__(self, db, leer=leer_fuente):
        self.db = db
        # Se puede pisar en los tests: ninguno sale a internet.
        self._leer = leer

    async def _ultima_vez(self, anio: int) -> datetime | None:
        valor = await self.db.scalar(
            text("SELECT MAX(traido_en) FROM feriado WHERE fecha BETWEEN :a AND :b"),
            {"a": date(anio, 1, 1), "b": date(anio, 12, 31)},
        )
        return _a_datetime(valor)

    async def traer_anio(self, anio: int) -> int:
        """Trae un año de la fuente y lo guarda. Devuelve cuántos feriados quedaron.

        Pisa nombre y tipo, nunca se_trabaja. Lo que la fuente ya no trae se borra sólo
        si nadie lo eligió: lo que el taller decidió queda.
        """
        feriados = await asyncio.to_thread(self._leer, anio)
        if not feriados:
            # El año todavía no está publicado: no hay nada que guardar ni que borrar.
            return 0
        ahora = _ahora_ar()
        for f in feriados:
            await self.db.execute(
                text(
                    "INSERT INTO feriado (fecha, nombre, tipo, traido_en) "
                    "VALUES (:fecha, :nombre, :tipo, :ahora) "
                    "ON CONFLICT (fecha) DO UPDATE SET nombre = excluded.nombre, "
                    "tipo = excluded.tipo, traido_en = excluded.traido_en"
                ),
                {**f, "ahora": ahora},
            )
        fechas = [f["fecha"] for f in feriados]
        filas = (await self.db.execute(
            text("SELECT fecha FROM feriado WHERE fecha BETWEEN :a AND :b AND se_trabaja IS NULL"),
            {"a": date(anio, 1, 1), "b": date(anio, 12, 31)},
        )).all()
        for (fecha,) in filas:
            if _a_fecha(fecha) not in fechas:
                await self.db.execute(text("DELETE FROM feriado WHERE fecha = :f"), {"f": _a_fecha(fecha)})
        await self.db.commit()
        logger.info(f"Feriados: {len(feriados)} de {anio} traídos de ArgentinaDatos.")
        return len(feriados)

    async def asegurar_anios(self, anios: list[int] | None = None, forzar: bool = False) -> None:
        """Trae los años que falten o que hace más de una semana que no se miran.

        Nunca levanta: si la tabla no está o la fuente no contesta, la pantalla sigue con
        lo que haya.
        """
        if anios is None:
            hoy = _ahora_ar().date()
            anios = [hoy.year, hoy.year + 1]
        for anio in anios:
            try:
                if not forzar:
                    fallo = _FALLO.get(anio)
                    if fallo is not None and time.monotonic() - fallo < REINTENTO_SEG:
                        continue
                    vacio = _SIN_PUBLICAR.get(anio)
                    if vacio is not None and time.monotonic() - vacio < REINTENTO_SEG:
                        continue
                    ultima = await self._ultima_vez(anio)
                    if ultima is not None and _ahora_ar() - ultima < CADA_CUANTO:
                        continue
                traidos = await self.traer_anio(anio)
                _FALLO.pop(anio, None)
                if traidos:
                    _SIN_PUBLICAR.pop(anio, None)
                else:
                    _SIN_PUBLICAR[anio] = time.monotonic()
            except Exception as e:
                _FALLO[anio] = time.monotonic()
                try:
                    await self.db.rollback()
                except Exception:
                    pass
                logger.warning(f"Feriados: no se pudo traer {anio}: {e}")

    async def listar(self, desde: date | None = None, hasta: date | None = None) -> list[dict]:
        """Los feriados entre dos fechas (inclusive), con lo que eligió el taller."""
        condiciones, params = [], {}
        if desde:
            condiciones.append("fecha >= :desde")
            params["desde"] = desde
        if hasta:
            condiciones.append("fecha <= :hasta")
            params["hasta"] = hasta
        where = f"WHERE {' AND '.join(condiciones)}" if condiciones else ""
        filas = (await self.db.execute(
            text(f"SELECT fecha, nombre, tipo, se_trabaja, decidido_por, decidido_en "
                 f"FROM feriado {where} ORDER BY fecha"),
            params,
        )).all()
        salida = []
        for fecha, nombre, tipo, se_trabaja, por, en in filas:
            se_trabaja = None if se_trabaja is None else bool(se_trabaja)
            salida.append({
                "fecha": _a_fecha(fecha).isoformat(),
                "nombre": nombre,
                "tipo": tipo,
                "se_trabaja": se_trabaja,
                "bloquea": bloquea(tipo, se_trabaja),
                "decidido_por": por,
                "decidido_en": _a_datetime(en).isoformat(timespec="minutes") if en else None,
            })
        return salida

    async def obtener(self, fecha: date) -> dict | None:
        filas = await self.listar(fecha, fecha)
        return filas[0] if filas else None

    async def elegir(self, fecha: date, se_trabaja: bool | None, usuario: str | None) -> dict | None:
        """Guarda si el taller trabaja ese feriado. None vuelve a lo de siempre.

        Devuelve el feriado como queda, o None si esa fecha no es feriado.
        """
        await self.db.execute(
            text("UPDATE feriado SET se_trabaja = :s, decidido_por = :por, decidido_en = :en "
                 "WHERE fecha = :f"),
            {
                "s": se_trabaja,
                "por": usuario if se_trabaja is not None else None,
                "en": _ahora_ar() if se_trabaja is not None else None,
                "f": fecha,
            },
        )
        await self.db.commit()
        return await self.obtener(fecha)


async def fechas_que_bloquean(db) -> list[date]:
    """Los feriados que el planificador no trabaja. Sólo lee, en un savepoint: si la
    tabla no está (una base sin la migración, un test), devuelve nada y sigue."""
    try:
        async with db.begin_nested():
            filas = (await db.execute(text(f"SELECT fecha FROM feriado WHERE {SQL_BLOQUEA}"))).all()
        return [_a_fecha(f) for (f,) in filas]
    except Exception as e:
        logger.warning(f"Feriados: no se pudieron leer: {e}")
        return []
