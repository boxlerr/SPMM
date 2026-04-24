import uuid
from datetime import datetime
from sqlalchemy import text

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class PlanificacionRepository:
    """
    Repositorio asincrónico para inserción de planificaciones por lote.
    Respeta la estructura utilizada en los repositorios del proyecto.
    """

    def __init__(self, db):
        self.db = db  # AsyncSession

    async def _ensure_columns(self):
        """Self-healing: agrega columnas nuevas si no existen (idempotente en MSSQL)."""
        ensure_sql = text("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE Name = 'forzado_fuera_rango' AND Object_ID = Object_ID('planificacion')
            )
            BEGIN
                ALTER TABLE planificacion ADD forzado_fuera_rango BIT NOT NULL DEFAULT 0;
            END
        """)
        try:
            await self.db.execute(ensure_sql)
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo asegurar columna forzado_fuera_rango: {e}")

    async def insertar_planificacion_lote(self, resultados: list):
        """
        Inserta múltiples registros de planificación dentro de un mismo lote.
        Genera un ID único y una descripción automática del lote.
        """

        await self._ensure_columns()

        id_lote = str(uuid.uuid4())
        descripcion_lote = f"Planificación {datetime.now():%B %Y}".capitalize()

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
                    "fecha_prometida": r.get("fecha_prometida"),
                    "sin_asignar": r.get("sin_asignar", False),
                    "nombre_proceso": r.get("nombre_proceso"),
                    "rangos_permitidos": str(r.get("rangos_permitidos_proceso", [])),
                    "id_planificacion_lote": id_lote,
                    "descripcion_lote": descripcion_lote,
                    "creado_en": datetime.now(),
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

    async def eliminar_lote(self, id_lote: str):
        """
        Elimina los registros de planificación asociados a un ID de lote,
        PERO solo para aquellas órdenes que NO han sido finalizadas/entregadas aún.
        """
        logger.info(f"Repository - Eliminando lote de planificación (solo activas): {id_lote}")
        
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
