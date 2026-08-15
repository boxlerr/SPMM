from datetime import date, datetime

from sqlalchemy import text

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from backend.infrastructure.ConfigRepository import ConfigRepository


class DiaBloqueadoRepository:
    """Días en los que no se trabaja (feriados, mantenimiento, paros).

    Antes vivían en backend/data/config.json, un archivo dentro del contenedor. En
    Cloud Run eso significa que se pierden en cada deploy y que cada instancia tiene su
    propia copia: se cargaba un feriado, funcionaba un rato, y después reaparecía como
    día laborable sin que nadie hubiera tocado nada. Ahora van a la base, que es el
    único lugar compartido y persistente que tiene la app.

    La primera vez que se consulta, si la tabla está vacía y el archivo tiene fechas,
    se importan solas: nadie tiene que acordarse de recargar los feriados a mano.
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
            return [f[0].strftime("%Y-%m-%d") for f in filas]
        except Exception as e:
            logger.error(f"Repository - Error al listar días bloqueados: {e}")
            raise InfrastructureException("Error al consultar los días no laborables.") from e

    async def agregar(self, fecha_str: str):
        await self._ensure_tabla()
        try:
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

    async def quitar(self, fecha_str: str):
        await self._ensure_tabla()
        try:
            await self.db.execute(
                text("DELETE FROM dia_bloqueado WHERE fecha = :f"),
                {"f": date.fromisoformat(fecha_str[:10])},
            )
            await self.db.commit()
        except ValueError as e:
            raise InfrastructureException(f"Fecha inválida: {fecha_str!r}") from e
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al desbloquear {fecha_str}: {e}")
            raise InfrastructureException("Error al quitar el día no laborable.") from e
