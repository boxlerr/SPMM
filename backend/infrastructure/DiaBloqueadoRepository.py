from datetime import date, datetime

from sqlalchemy import text

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from backend.infrastructure.ConfigRepository import ConfigRepository
from backend.infrastructure.FeriadoRepository import FeriadoRepository, SQL_BLOQUEA, fechas_que_bloquean


class DiaBloqueadoRepository:
    """Días en los que no se trabaja (feriados, mantenimiento, paros).

    Antes vivían en backend/data/config.json, un archivo dentro del contenedor. En
    Cloud Run eso significa que se pierden en cada deploy y que cada instancia tiene su
    propia copia: se cargaba un feriado, funcionaba un rato, y después reaparecía como
    día laborable sin que nadie hubiera tocado nada. Ahora van a la base, que es el
    único lugar compartido y persistente que tiene la app.

    La primera vez que se consulta, si la tabla está vacía y el archivo tiene fechas,
    se importan solas: nadie tiene que acordarse de recargar los feriados a mano.

    Desde el 8/10/2026 los feriados nacionales viven aparte, en `feriado`, y se traen
    solos (ver FeriadoRepository). Esta tabla queda para lo que se bloquea a mano
    (mantenimiento, un paro) y `listar` devuelve la UNIÓN: lo único que el planificador
    no trabaja. Bloquear o desbloquear un día que es feriado no toca esta tabla: guarda
    lo que eligió el taller en el feriado.
    """

    def __init__(self, db):
        self.db = db

    async def _ensure_tabla(self):
        try:
            await self.db.execute(text("""
                CREATE TABLE IF NOT EXISTS dia_bloqueado (
                    fecha DATE PRIMARY KEY,
                    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo asegurar dia_bloqueado: {e}")

    async def _migrar_desde_archivo(self):
        """Importa una única vez lo que haya quedado en el config.json."""
        try:
            ya_hay = await self.db.scalar(text("SELECT COUNT(*) FROM dia_bloqueado"))
            if ya_hay:
                return
            del_archivo = ConfigRepository().get_blocked_dates()
            if not del_archivo:
                return
            for f in del_archivo:
                await self.db.execute(
                    text("INSERT INTO dia_bloqueado (fecha) VALUES (:f) ON CONFLICT DO NOTHING"),
                    {"f": date.fromisoformat(f[:10])},
                )
            await self.db.commit()
            logger.info(f"Repository - {len(del_archivo)} feriado(s) migrados del archivo a la base.")
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudieron migrar los feriados del archivo: {e}")

    async def listar(self) -> list[str]:
        """Fechas bloqueadas como 'YYYY-MM-DD' (el formato que espera el planificador)."""
        await self._ensure_tabla()
        await self._migrar_desde_archivo()
        try:
            filas = await self.db.execute(text("SELECT fecha FROM dia_bloqueado ORDER BY fecha"))
            a_mano = [f[0] for f in filas]
        except Exception as e:
            logger.error(f"Repository - Error al listar días bloqueados: {e}")
            raise InfrastructureException("Error al consultar los días no laborables.") from e
        dias = {_a_fecha(f) for f in a_mano} | set(await fechas_que_bloquean(self.db))
        return [d.strftime("%Y-%m-%d") for d in sorted(dias)]

    async def _feriado(self, fecha_str: str):
        """El feriado de esa fecha, o None (tampoco si la tabla todavía no está)."""
        try:
            async with self.db.begin_nested():
                return await FeriadoRepository(self.db).obtener(date.fromisoformat(fecha_str[:10]))
        except ValueError:
            raise
        except Exception:
            return None

    async def agregar(self, fecha_str: str, usuario: str | None = None):
        await self._ensure_tabla()
        try:
            if await self._feriado(fecha_str):
                await FeriadoRepository(self.db).elegir(date.fromisoformat(fecha_str[:10]), False, usuario)
                return
            await self.db.execute(
                text("INSERT INTO dia_bloqueado (fecha) VALUES (:f) ON CONFLICT DO NOTHING"),
                {"f": date.fromisoformat(fecha_str[:10])},
            )
            await self.db.commit()
        except ValueError as e:
            raise InfrastructureException(f"Fecha inválida: {fecha_str!r}") from e
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al bloquear {fecha_str}: {e}")
            raise InfrastructureException("Error al marcar el día como no laborable.") from e

    async def quitar(self, fecha_str: str, usuario: str | None = None):
        await self._ensure_tabla()
        try:
            await self.db.execute(
                text("DELETE FROM dia_bloqueado WHERE fecha = :f"),
                {"f": date.fromisoformat(fecha_str[:10])},
            )
            await self.db.commit()
            # Si además es feriado, «desbloquearlo» es decir que ese día se trabaja.
            if await self._feriado(fecha_str):
                await FeriadoRepository(self.db).elegir(date.fromisoformat(fecha_str[:10]), True, usuario)
        except ValueError as e:
            raise InfrastructureException(f"Fecha inválida: {fecha_str!r}") from e
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al desbloquear {fecha_str}: {e}")
            raise InfrastructureException("Error al quitar el día no laborable.") from e


async def feriados_sin_romper(db) -> list[date]:
    """Los días bloqueados, para una cuenta que corre adentro de OTRO pedido.

    `listar()` crea la tabla y hace COMMIT, que está bien para la pantalla del
    calendario pero no para quien sólo necesita leerlos en medio de lo suyo (los días
    laborables de una ausencia, el tiempo efectivo de un paso — RF-06). Esto sólo lee,
    en un savepoint: si la tabla no está, devuelve nada y el pedido sigue.

    Incluye los feriados que bloquean (ver FeriadoRepository), igual que `listar()`.
    Va en UNA consulta (la pantalla de Pendientes cuenta sus consultas: ver
    test_pendientes_no_hace_una_consulta_por_linea). Si falla porque todavía no está la
    tabla de feriados, se vuelve a leer sólo dia_bloqueado.
    """
    try:
        async with db.begin_nested():
            filas = (await db.execute(text(
                f"SELECT fecha FROM dia_bloqueado UNION SELECT fecha FROM feriado WHERE {SQL_BLOQUEA}"
            ))).all()
        return sorted({_a_fecha(f) for (f,) in filas if f})
    except Exception:
        pass
    try:
        async with db.begin_nested():
            filas = (await db.execute(text("SELECT fecha FROM dia_bloqueado"))).all()
        return sorted({_a_fecha(f) for (f,) in filas if f})
    except Exception as e:
        logger.warning(f"Repository - No se pudieron leer los días bloqueados: {e}")
        return []


def _a_fecha(f) -> date:
    if isinstance(f, datetime):
        return f.date()
    if isinstance(f, date):
        return f
    return date.fromisoformat(str(f)[:10])
