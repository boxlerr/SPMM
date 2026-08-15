import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo
from sqlalchemy import text

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

# El backend puede correr en un servidor con TZ=UTC (cloud). Guardamos los
# timestamps visibles al usuario en hora local de Argentina para evitar el
# desfasaje de 3 horas al mostrarlos.
_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")


def _ahora_ar() -> datetime:
    """Hora actual en Argentina, como datetime naive (compatible con columna datetime de MSSQL)."""
    return datetime.now(_TZ_AR).replace(tzinfo=None)


def _a_fecha(valor):
    """Normaliza la fecha prometida a `date` antes de insertarla.

    El solver la emite como string 'YYYY-MM-DD' (ver _extraer_resultados) y la
    columna es DATE. Con el driver viejo de SQL Server el string pasaba; asyncpg
    lo rechaza con "'str' object has no attribute 'toordinal'" y se caía TODO el
    guardado —de ahí que no se pudiera guardar ninguna planificación desde que
    la app pasó a Postgres—. Se convierte acá, en el borde con la base, para no
    cambiar lo que el servicio devuelve en la vista previa.
    """
    if valor is None or isinstance(valor, date) and not isinstance(valor, datetime):
        return valor
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, str):
        try:
            return date.fromisoformat(valor[:10])
        except ValueError:
            logger.warning(f"Repository - Fecha prometida ilegible ({valor!r}); se guarda NULL.")
            return None
    return valor


class PlanificacionRepository:
    """
    Repositorio asincrónico para inserción de planificaciones por lote.
    Respeta la estructura utilizada en los repositorios del proyecto.
    """

    def __init__(self, db):
        self.db = db  # AsyncSession

    async def _ensure_columns(self):
        """Self-healing: agrega columnas nuevas si no existen (idempotente)."""
        ensure_sql = text("""
            ALTER TABLE planificacion
            ADD COLUMN IF NOT EXISTS forzado_fuera_rango BOOLEAN NOT NULL DEFAULT FALSE
        """)
        try:
            await self.db.execute(ensure_sql)
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo asegurar columna forzado_fuera_rango: {e}")

    async def _ensure_historial(self):
        """Self-healing de la tabla de borrados (idempotente), igual que _ensure_columns."""
        try:
            await self.db.execute(text("""
                CREATE TABLE IF NOT EXISTS planificacion_borrada (
                    id SERIAL PRIMARY KEY,
                    id_planificacion_lote UUID,
                    descripcion_lote VARCHAR(200),
                    alcance VARCHAR(20) NOT NULL,
                    filas_borradas INTEGER NOT NULL DEFAULT 0,
                    ots_borradas INTEGER NOT NULL DEFAULT 0,
                    orden_ids TEXT,
                    creado_en_lote TIMESTAMP,
                    borrado_en TIMESTAMP NOT NULL
                )
            """))
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo asegurar planificacion_borrada: {e}")

    async def _registrar_borrado(self, alcance: str, id_lote: str | None, orden_ids: list[int] | None = None):
        """Deja constancia de lo que se está por borrar.

        Se llama ANTES del DELETE porque después ya no hay de dónde sacar el conteo.
        Si falla, avisa pero no corta el borrado: que la auditoría se rompa no es
        motivo para que el usuario no pueda sacar una planificación equivocada.
        """
        await self._ensure_historial()

        where = "WHERE id_planificacion_lote = :lote" if id_lote else "WHERE 1=1"
        params: dict = {}
        if id_lote:
            params["lote"] = id_lote
        if orden_ids:
            placeholders = ", ".join(f":oid_{i}" for i in range(len(orden_ids)))
            where += f" AND orden_id IN ({placeholders})"
            params.update({f"oid_{i}": oid for i, oid in enumerate(orden_ids)})

        try:
            resumen = (await self.db.execute(text(f"""
                SELECT COUNT(*) AS filas,
                       COUNT(DISTINCT orden_id) AS ots,
                       MIN(descripcion_lote) AS descripcion,
                       MIN(creado_en) AS creado
                FROM planificacion {where}
            """), params)).fetchone()

            await self.db.execute(text("""
                INSERT INTO planificacion_borrada (
                    id_planificacion_lote, descripcion_lote, alcance,
                    filas_borradas, ots_borradas, orden_ids, creado_en_lote, borrado_en
                ) VALUES (
                    :lote, :descripcion, :alcance,
                    :filas, :ots, :orden_ids, :creado, :borrado_en
                )
            """), {
                "lote": id_lote,
                "descripcion": resumen.descripcion if resumen else None,
                "alcance": alcance,
                "filas": (resumen.filas if resumen else 0) or 0,
                "ots": (resumen.ots if resumen else 0) or 0,
                "orden_ids": str(orden_ids) if orden_ids else None,
                "creado": resumen.creado if resumen else None,
                "borrado_en": _ahora_ar(),
            })
            await self.db.commit()
            logger.info(
                f"Repository - Borrado registrado ({alcance}): lote={id_lote} "
                f"filas={(resumen.filas if resumen else 0)}"
            )
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo registrar el borrado ({alcance}, lote={id_lote}): {e}")

    async def insertar_planificacion_lote(self, resultados: list):
        """
        Inserta múltiples registros de planificación dentro de un mismo lote.
        Genera un ID único y una descripción automática del lote.
        """

        await self._ensure_columns()

        id_lote = str(uuid.uuid4())
        ahora_ar = _ahora_ar()
        descripcion_lote = f"Planificación {ahora_ar:%B %Y}".capitalize()

        logger.info(
            f"Repository - Insertando planificación: {len(resultados)} registros "
            f"(Lote={id_lote})"
        )

        insert_query = text("""
            INSERT INTO planificacion (
                orden_id, proceso_id, id_operario, id_rango_operario, id_maquinaria,
                sin_maquinaria, inicio_min, fin_min, duracion_min, prioridad_peso,
                fecha_prometida, sin_asignar, nombre_proceso, rangos_permitidos,
                id_planificacion_lote, descripcion_lote, creado_en, forzado_fuera_rango
            )
            VALUES (
                :orden_id, :proceso_id, :id_operario, :id_rango_operario, :id_maquinaria,
                :sin_maquinaria, :inicio_min, :fin_min, :duracion_min, :prioridad_peso,
                :fecha_prometida, :sin_asignar, :nombre_proceso, :rangos_permitidos,
                :id_planificacion_lote, :descripcion_lote, :creado_en, :forzado_fuera_rango
            )
        """)

        try:
            for r in resultados:
                params = {
                    "orden_id": r["orden_id"],
                    "proceso_id": r["proceso_id"],
                    "id_operario": r.get("id_operario"),
                    "id_rango_operario": r.get("id_rango_operario"),
                    "id_maquinaria": r.get("id_maquinaria"),
                    "sin_maquinaria": r.get("sin_maquinaria", False),
                    "inicio_min": r["inicio_min"],
                    "fin_min": r["fin_min"],
                    "duracion_min": r["duracion_min"],
                    "prioridad_peso": r["prioridad_peso"],
                    "fecha_prometida": _a_fecha(r.get("fecha_prometida")),
                    "sin_asignar": r.get("sin_asignar", False),
                    "nombre_proceso": r.get("nombre_proceso"),
                    "rangos_permitidos": str(r.get("rangos_permitidos_proceso", [])),
                    "id_planificacion_lote": id_lote,
                    "descripcion_lote": descripcion_lote,
                    "creado_en": ahora_ar,
                    "forzado_fuera_rango": bool(r.get("forzado_fuera_rango", False)),
                }

                await self.db.execute(insert_query, params)

            await self.db.commit()

            logger.info(
                f"Repository - Planificación guardada con éxito "
                f"(Lote={id_lote}, Registros={len(resultados)})"
            )

            return {
                "mensaje": f"Planificación guardada ({len(resultados)} registros)",
                "id_planificacion_lote": id_lote,
                "descripcion_lote": descripcion_lote
            }

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al insertar planificación por lote: {e}")
            raise InfrastructureException(
                "Error al guardar la planificación en la base de datos."
            ) from e

    async def eliminar_ordenes(self, orden_ids: list[int], id_lote: str | None = None):
        """
        Saca OTs puntuales de la planificación (se planificaron por error o ya no van).
        A diferencia de `eliminar_lote`, acá el lote sigue existiendo con el resto de
        las OTs; solo desaparecen los procesos de las órdenes indicadas.

        Si `id_lote` viene, se acota el borrado a ese lote; si no, la OT se saca de
        todas las planificaciones donde aparezca.
        """
        if not orden_ids:
            return 0

        logger.info(
            f"Repository - Quitando {len(orden_ids)} orden(es) de la planificación "
            f"(lote={id_lote or 'TODOS'}): {orden_ids}"
        )

        await self._registrar_borrado("ordenes", id_lote, orden_ids)

        # IN con placeholders nombrados (no interpolamos los ids en el SQL) para que
        # funcione igual con cualquier driver.
        placeholders = ", ".join(f":oid_{i}" for i in range(len(orden_ids)))
        sql = f"DELETE FROM planificacion WHERE orden_id IN ({placeholders})"
        params: dict = {f"oid_{i}": oid for i, oid in enumerate(orden_ids)}
        if id_lote:
            sql += " AND id_planificacion_lote = :id_lote"
            params["id_lote"] = id_lote

        try:
            result = await self.db.execute(text(sql), params)
            await self.db.commit()
            borrados = result.rowcount or 0
            logger.info(f"Repository - {borrados} registro(s) de planificación eliminados.")
            return borrados
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al quitar órdenes de la planificación: {e}")
            raise InfrastructureException(
                "Error al quitar las órdenes de la planificación."
            ) from e

    async def eliminar_lote(self, id_lote: str):
        """
        Elimina los registros de planificación asociados a un ID de lote,
        PERO solo para aquellas órdenes que NO han sido finalizadas/entregadas aún.
        """
        logger.info(f"Repository - Eliminando lote de planificación (solo activas): {id_lote}")

        await self._registrar_borrado("lote", id_lote)

        # Eliminar todos los registros del lote sin importar el estado de entrega de la orden
        delete_query = text("""
            DELETE FROM planificacion
            WHERE id_planificacion_lote = :id_lote
        """)
        
        try:
            await self.db.execute(delete_query, {"id_lote": id_lote})
            await self.db.commit()
            logger.info(f"Repository - Lote {id_lote} (registros no terminados) eliminado con éxito.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al eliminar lote de planificación {id_lote}: {e}")
            raise InfrastructureException(
                f"Error al eliminar el lote de planificación {id_lote}."
            ) from e
