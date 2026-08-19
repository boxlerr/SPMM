"""
Borradores de planificación: el plan calculado y todavía no confirmado.

Un borrador es opaco a propósito. `contenido` guarda el payload entero de la vista
previa —incluidos los retoques hechos a mano— y nadie lo consulta por adentro: se
abre completo o no se abre. Lo que sí sale afuera son los cuatro datos que hacen
falta para elegir cuál abrir (cuándo, quién, cuántas OTs, qué rango de fechas), y
esos van en columnas para no tener que leer el JSON entero por cada fila de la lista.
"""
import json
from datetime import date, datetime

from sqlalchemy import text

from backend.commons.loggers.logger import logger

# Un borrador es el plan de una semana: con 40 OTs el payload ronda el medio mega.
# El tope corta un envío absurdo (o corrupto) antes de que llegue a la base, no un
# uso normal.
MAX_BYTES = 8 * 1024 * 1024

# Cuántos se conservan. Son de trabajo, no historial: el de la semana pasada ya no
# sirve, y sin poda esto crece para siempre.
MAX_BORRADORES = 20


def _a_fecha(valor) -> date | None:
    """'2026-08-19' -> date(2026, 8, 19).

    El rango viaja como string desde el frontend, y asyncpg no convierte: a una
    columna DATE hay que pasarle un `date` o revienta con "'str' object has no
    attribute 'toordinal'". Como `guardar` se traga las excepciones —es un autosave
    y no puede voltear la pantalla—, el error salía por el log y el borrador
    simplemente no se guardaba nunca en la base, en silencio.

    Una fecha ilegible no vale perder el borrador entero: se guarda sin rango, que
    es solo un dato de la lista.
    """
    if not valor:
        return None
    if isinstance(valor, date) and not isinstance(valor, datetime):
        return valor
    if isinstance(valor, datetime):
        return valor.date()
    try:
        return date.fromisoformat(str(valor)[:10])
    except ValueError:
        logger.warning(f"Repository - Fecha de borrador ilegible: {valor!r}")
        return None


class PlanificacionBorradorRepository:
    def __init__(self, db):
        self.db = db

    async def _ensure_tabla(self):
        """Self-healing idempotente, igual que planificacion_borrada: la app se
        despliega a mano y no hay corrida automática de migraciones."""
        try:
            await self.db.execute(text("""
                CREATE TABLE IF NOT EXISTS planificacion_borrador (
                    id SERIAL PRIMARY KEY,
                    id_usuario INTEGER,
                    nombre_usuario VARCHAR(120),
                    cantidad_ots INTEGER NOT NULL DEFAULT 0,
                    cantidad_procesos INTEGER NOT NULL DEFAULT 0,
                    fecha_desde DATE,
                    fecha_hasta DATE,
                    ordenes_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                    contenido JSONB NOT NULL,
                    automatico BOOLEAN NOT NULL DEFAULT TRUE,
                    creado_en TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
                    actualizado_en TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
                )
            """))
            await self.db.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_planificacion_borrador_fecha
                    ON planificacion_borrador (actualizado_en DESC)
            """))
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo asegurar planificacion_borrador: {e}")

    async def guardar(
        self,
        *,
        borrador_id: int | None,
        contenido: dict,
        ordenes_ids: list[int],
        cantidad_procesos: int,
        fecha_desde=None,
        fecha_hasta=None,
        id_usuario: int | None = None,
        nombre_usuario: str | None = None,
        automatico: bool = True,
    ) -> int | None:
        """Crea o pisa un borrador. Devuelve su id, o None si no se pudo guardar.

        Devuelve None en vez de reventar: esto lo llama un autosave cada pocos
        segundos y que falle un guardado no puede voltear la pantalla en la que el
        usuario está trabajando. La copia del navegador cubre ese hueco.
        """
        await self._ensure_tabla()

        payload = json.dumps(contenido, ensure_ascii=False, default=str)
        if len(payload.encode("utf-8")) > MAX_BYTES:
            logger.warning(
                f"Repository - Borrador descartado por tamaño "
                f"({len(payload.encode('utf-8'))} bytes > {MAX_BYTES})"
            )
            return None

        params = {
            "contenido": payload,
            "ordenes_ids": json.dumps(sorted(set(ordenes_ids or []))),
            "cantidad_ots": len(set(ordenes_ids or [])),
            "cantidad_procesos": int(cantidad_procesos or 0),
            "fecha_desde": _a_fecha(fecha_desde),
            "fecha_hasta": _a_fecha(fecha_hasta),
            "id_usuario": id_usuario,
            "nombre_usuario": (nombre_usuario or "")[:120] or None,
            "automatico": bool(automatico),
            "ahora": datetime.utcnow(),
        }

        try:
            if borrador_id:
                # UPDATE ... RETURNING: si el id ya no existe (alguien lo borró desde
                # otra pantalla) no devuelve nada y se cae al INSERT de abajo, en vez
                # de perder el guardado en silencio.
                fila = (await self.db.execute(text("""
                    UPDATE planificacion_borrador
                       SET contenido = CAST(:contenido AS JSONB),
                           ordenes_ids = CAST(:ordenes_ids AS JSONB),
                           cantidad_ots = :cantidad_ots,
                           cantidad_procesos = :cantidad_procesos,
                           fecha_desde = :fecha_desde,
                           fecha_hasta = :fecha_hasta,
                           automatico = :automatico,
                           actualizado_en = :ahora
                     WHERE id = :id
                 RETURNING id
                """), {**params, "id": borrador_id})).first()
                if fila:
                    await self.db.commit()
                    return int(fila[0])

            fila = (await self.db.execute(text("""
                INSERT INTO planificacion_borrador
                    (id_usuario, nombre_usuario, cantidad_ots, cantidad_procesos,
                     fecha_desde, fecha_hasta, ordenes_ids, contenido, automatico,
                     creado_en, actualizado_en)
                VALUES
                    (:id_usuario, :nombre_usuario, :cantidad_ots, :cantidad_procesos,
                     :fecha_desde, :fecha_hasta, CAST(:ordenes_ids AS JSONB),
                     CAST(:contenido AS JSONB), :automatico, :ahora, :ahora)
             RETURNING id
            """), params)).first()
            await self.db.commit()
            nuevo = int(fila[0]) if fila else None
            await self._podar()
            return nuevo
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo guardar el borrador: {e}")
            return None

    async def _podar(self):
        """Deja solo los MAX_BORRADORES más recientes."""
        try:
            await self.db.execute(text("""
                DELETE FROM planificacion_borrador
                 WHERE id NOT IN (
                    SELECT id FROM planificacion_borrador
                     ORDER BY actualizado_en DESC
                     LIMIT :tope
                 )
            """), {"tope": MAX_BORRADORES})
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudieron podar los borradores: {e}")

    async def listar(self) -> list[dict]:
        """Los borradores para la lista: sin `contenido`, que es lo pesado."""
        await self._ensure_tabla()
        try:
            filas = (await self.db.execute(text("""
                SELECT id, id_usuario, nombre_usuario, cantidad_ots, cantidad_procesos,
                       fecha_desde, fecha_hasta, ordenes_ids, creado_en, actualizado_en
                  FROM planificacion_borrador
                 ORDER BY actualizado_en DESC
            """))).mappings().all()
            return [dict(f) for f in filas]
        except Exception as e:
            logger.warning(f"Repository - No se pudieron listar los borradores: {e}")
            return []

    async def obtener(self, borrador_id: int) -> dict | None:
        await self._ensure_tabla()
        try:
            fila = (await self.db.execute(text("""
                SELECT id, id_usuario, nombre_usuario, cantidad_ots, cantidad_procesos,
                       fecha_desde, fecha_hasta, ordenes_ids, contenido,
                       creado_en, actualizado_en
                  FROM planificacion_borrador
                 WHERE id = :id
            """), {"id": borrador_id})).mappings().first()
            return dict(fila) if fila else None
        except Exception as e:
            logger.warning(f"Repository - No se pudo leer el borrador {borrador_id}: {e}")
            return None

    async def borrar(self, borrador_id: int) -> bool:
        await self._ensure_tabla()
        try:
            res = await self.db.execute(
                text("DELETE FROM planificacion_borrador WHERE id = :id"),
                {"id": borrador_id},
            )
            await self.db.commit()
            return (res.rowcount or 0) > 0
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo borrar el borrador {borrador_id}: {e}")
            return False

    async def borrar_por_ordenes(self, ordenes_ids: list[int]) -> int:
        """Borra los borradores cuyo lote quedó contenido en las OTs recién
        confirmadas: ese plan dejó de ser un borrador, ya es el plan.

        Se compara por contención y no por igualdad porque el usuario puede haber
        confirmado un lote más grande del que tenía guardado (agregó OTs desde la
        vista previa antes de confirmar).
        """
        if not ordenes_ids:
            return 0
        await self._ensure_tabla()
        try:
            res = await self.db.execute(text("""
                DELETE FROM planificacion_borrador
                 WHERE ordenes_ids <@ CAST(:ids AS JSONB)
            """), {"ids": json.dumps(sorted(set(ordenes_ids)))})
            await self.db.commit()
            return res.rowcount or 0
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudieron borrar los borradores del lote: {e}")
            return 0
