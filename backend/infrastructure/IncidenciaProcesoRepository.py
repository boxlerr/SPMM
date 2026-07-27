from sqlalchemy import select, text
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class IncidenciaProcesoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, incidencia: IncidenciaProceso):
        try:
            logger.info("Repository - Crear IncidenciaProceso.")
            self.db.add(incidencia)
            await self.db.commit()
            await self.db.refresh(incidencia)
            return incidencia
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en save IncidenciaProceso: {e}")
            raise InfrastructureException("Error al guardar la incidencia.") from e

    async def find_recientes(self, tipo: str, desde: str | None, hasta: str | None, limit: int = 50):
        """Lista las incidencias (con nombres de orden/proceso/operario) más recientes."""
        try:
            query = text(f"""
                SELECT
                    i.id,
                    i.id_orden_trabajo,
                    ot.id_otvieja            AS nro_ot,
                    i.id_proceso,
                    p.nombre                 AS proceso,
                    i.id_operario,
                    btrim(COALESCE(o.nombre,'') || ' ' || COALESCE(o.apellido,'')) AS operario,
                    i.minutos_perdidos,
                    i.operarios_extra,
                    i.descripcion,
                    i.fecha_registro
                FROM incidencia_proceso i
                LEFT JOIN orden_trabajo ot ON ot.id = i.id_orden_trabajo
                LEFT JOIN proceso p        ON p.id = i.id_proceso
                LEFT JOIN operario o       ON o.id = i.id_operario
                WHERE i.tipo = :tipo
                  AND (CAST(:desde AS date) IS NULL OR i.fecha_registro >= CAST(:desde AS date))
                  AND (CAST(:hasta AS date) IS NULL OR i.fecha_registro < CAST(:hasta AS date) + INTERVAL '1 day')
                ORDER BY i.fecha_registro DESC
                LIMIT {int(limit)}
            """)
            result = await self.db.execute(query, {"tipo": tipo, "desde": desde, "hasta": hasta})
            return [dict(r) for r in result.mappings().all()]
        except Exception as e:
            logger.error(f"Repository - Error real en find_recientes incidencias: {e}")
            raise InfrastructureException("Error al listar incidencias.") from e

    async def metricas(self, tipo: str, desde: str | None, hasta: str | None):
        """Totales + desglose por operario y por mes para el dashboard."""
        try:
            params = {"tipo": tipo, "desde": desde, "hasta": hasta}
            rango = (
                " AND (CAST(:desde AS date) IS NULL OR i.fecha_registro >= CAST(:desde AS date)) "
                " AND (CAST(:hasta AS date) IS NULL OR i.fecha_registro < CAST(:hasta AS date) + INTERVAL '1 day') "
            )

            totales_row = (await self.db.execute(text(f"""
                SELECT COUNT(*) AS total_incidencias,
                       COALESCE(SUM(i.minutos_perdidos), 0) AS total_minutos,
                       COALESCE(SUM(i.operarios_extra), 0)  AS total_operarios_extra
                FROM incidencia_proceso i
                WHERE i.tipo = :tipo {rango}
            """), params)).mappings().first() or {}

            por_operario = (await self.db.execute(text(f"""
                SELECT i.id_operario,
                       btrim(COALESCE(o.nombre,'') || ' ' || COALESCE(o.apellido,'')) AS operario,
                       COUNT(*) AS incidencias,
                       COALESCE(SUM(i.minutos_perdidos), 0) AS minutos
                FROM incidencia_proceso i
                LEFT JOIN operario o ON o.id = i.id_operario
                WHERE i.tipo = :tipo {rango}
                GROUP BY i.id_operario, o.nombre, o.apellido
                ORDER BY minutos DESC
            """), params)).mappings().all()

            por_mes = (await self.db.execute(text(f"""
                SELECT to_char(i.fecha_registro, 'YYYY-MM') AS mes,
                       COUNT(*) AS incidencias,
                       COALESCE(SUM(i.minutos_perdidos), 0) AS minutos
                FROM incidencia_proceso i
                WHERE i.tipo = :tipo {rango}
                GROUP BY to_char(i.fecha_registro, 'YYYY-MM')
                ORDER BY mes
            """), params)).mappings().all()

            return {
                "total_incidencias": int(totales_row.get("total_incidencias") or 0),
                "total_minutos": int(totales_row.get("total_minutos") or 0),
                "total_operarios_extra": int(totales_row.get("total_operarios_extra") or 0),
                "por_operario": [dict(r) for r in por_operario],
                "por_mes": [dict(r) for r in por_mes],
            }
        except Exception as e:
            logger.error(f"Repository - Error real en metricas incidencias: {e}")
            raise InfrastructureException("Error al calcular métricas de incidencias.") from e
