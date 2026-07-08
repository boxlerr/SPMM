"""
Reintento de operaciones de base de datos ante desconexiones/timeouts TRANSITORIOS.

La DB del cliente es un SQL Server on-prem detrás de una conexión con IP dinámica,
así que se corta cada tanto. `pool_pre_ping` (ver db.py) descarta conexiones que YA
estaban muertas al agarrarlas, pero no cubre un corte que ocurre DURANTE la operación
ni un timeout de red. Este helper reintenta la escritura completa unas pocas veces con
backoff, de modo que un parpadeo breve de la conexión termine guardando igual, sin que
el usuario tenga que hacer nada.

Solo reintenta errores de conexión/timeout. Cualquier otro error (validación, FK, etc.)
se propaga tal cual, sin reintentos.
"""
import asyncio

from sqlalchemy.exc import DBAPIError

from backend.commons.loggers.logger import logger

# Marcadores típicos de "se cortó la conexión / timeout" con SQL Server (pyodbc / WinSock).
_TRANSIENT_MARKERS = (
    "08s01",  # communication link failure
    "08001",  # client unable to establish connection
    "hyt00", "hyt01",  # query/connection timeout
    "communication link failure",
    "tcp provider",
    "timeout expired",
    "server closed the connection",
    "connection is busy",
    "connection reset",
    "10054", "10053", "10060",  # WinSock: reset / aborted / timed out
)


def es_desconexion_transitoria(exc: BaseException) -> bool:
    """True si la excepción parece un corte/timeout transitorio de la DB."""
    # SQLAlchemy marca connection_invalidated cuando detecta que la conexión murió.
    if getattr(exc, "connection_invalidated", False):
        return True
    msg = str(getattr(exc, "orig", exc)).lower()
    return any(m in msg for m in _TRANSIENT_MARKERS)


def motivo_error_db(exc: BaseException, accion: str = "guardar") -> str:
    """
    Arma un mensaje entendible con el MOTIVO del error para mostrarle al usuario.
    Si fue una desconexión transitoria, lo dice en criollo; si fue otra cosa,
    incluye el error real de la DB (recortado) para poder diagnosticar.
    """
    if es_desconexion_transitoria(exc):
        return (
            f"No se pudo {accion}: la base de datos se desconectó y no respondió tras "
            f"varios reintentos. Esperá unos segundos y volvé a intentar."
        )
    detalle = " ".join(str(getattr(exc, "orig", exc)).split())
    if len(detalle) > 220:
        detalle = detalle[:220] + "…"
    return f"No se pudo {accion}. Motivo: {detalle}"


async def run_with_db_retry(session, work, *, retries: int = 5, base_delay: float = 0.5,
                            max_delay: float = 4.0, label: str = "operacion"):
    """
    Ejecuta `work` (corutina sin argumentos que hace toda la escritura + commit y
    devuelve el resultado). Si falla por una desconexión/timeout transitorio, hace
    rollback y reintenta con backoff exponencial (0.5s, 1s, 2s, 4s...), topeado en
    `max_delay`. Ante cualquier otro error, o al agotar los reintentos, propaga.

    Se banca cortes breves (los reintentos suman ~7,5s en total): si la DB vuelve en
    ese rato, guarda solo. NO es infinito a propósito: un reintento sin fin colgaría
    el request HTTP y Render / el navegador lo cortarían igual. Si la DB sigue caída,
    corta con un motivo claro y el frontend conserva la carga para reintentar a mano.

    IMPORTANTE: `work` se re-ejecuta entero en cada intento, así que debe reconstruir
    los objetos ORM adentro (después del rollback los anteriores quedan inválidos).
    """
    last_exc = None
    for intento in range(1, retries + 1):
        try:
            return await work()
        except DBAPIError as e:
            if not es_desconexion_transitoria(e):
                raise
            last_exc = e
            try:
                await session.rollback()
            except Exception:
                pass
            if intento < retries:
                delay = min(base_delay * (2 ** (intento - 1)), max_delay)
                logger.warning(
                    f"DB retry - '{label}' falló por desconexión transitoria "
                    f"(intento {intento}/{retries}); reintento en {delay:.1f}s"
                )
                await asyncio.sleep(delay)
    logger.error(f"DB retry - '{label}' agotó los {retries} reintentos por desconexión.")
    raise last_exc
