import asyncio
import time
from sqlalchemy import text
from backend.infrastructure.db import engine, SessionLocal
from backend.commons.loggers.logger import logger
import logging
from datetime import datetime, timedelta

# Configurar logger para mostrar info en este script
logger.setLevel(logging.INFO)

# --- QUERIES DE SEMILLAS (SEEDS) ---
QUERY_SEED_ARTICULO = """
IF NOT EXISTS (SELECT 1 FROM dbo.articulo WHERE cod_articulo = 'NO-DEF')
  INSERT INTO dbo.articulo (cod_articulo, descripcion, abreviatura)
  VALUES ('NO-DEF', 'Articulo no definido (heredado)', 'N/D');
"""

QUERY_SEED_SECTOR = """
IF NOT EXISTS (SELECT 1 FROM dbo.sector WHERE nombre = 'SIN SECTOR')
  INSERT INTO dbo.sector (nombre) VALUES ('SIN SECTOR');
"""

QUERY_SEED_PRIORIDAD = """
IF NOT EXISTS (SELECT 1 FROM dbo.prioridad WHERE descripcion = 'SIN PRIORIDAD')
  INSERT INTO dbo.prioridad (descripcion) VALUES ('SIN PRIORIDAD');
"""

# --- QUERIES DE SINCRONIZACIÓN ---

QUERY_SYNC_OTS = """
DECLARE @id_articulo_nodef int = (SELECT TOP 1 id FROM dbo.articulo   WHERE cod_articulo='NO-DEF');
DECLARE @id_sector_nodef   int = (SELECT TOP 1 id FROM dbo.sector     WHERE nombre='SIN SECTOR');
DECLARE @id_prio_nodef     int = (SELECT TOP 1 id FROM dbo.prioridad  WHERE descripcion='SIN PRIORIDAD');

WITH src AS (
    SELECT
      v.idot AS id_otvieja,
      observaciones = ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(v.obs  + ' ', '') + ISNULL(v.obs1 + ' ', '') + ISNULL(v.obs2 + ' ', '') + ISNULL(v.obs3, ''))), ''), 'Sin observaciones'),
      id_prioridad = COALESCE(p.id, @id_prio_nodef),
      id_sector    = COALESCE(s.id, @id_sector_nodef),
      id_articulo  = COALESCE(a.id, @id_articulo_nodef),
      fecha_orden      = v.fecha,
      fecha_entrada    = v.fechaentrada,
      fecha_prometida  = v.fechaprometida,
      fecha_entrega    = CASE WHEN v.fechaentrega = '1950-01-01' THEN NULL ELSE v.fechaentrega END,
      unidades         = v.cantidad,
      requerido         = ISNULL(v.requerido, 0),
      aprobado          = ISNULL(v.aprobado, 0),
      reclamo           = ISNULL(v.reclamo, 0),
      revisada          = ISNULL(v.revisada, 0),
      finalizadoparcial = ISNULL(v.finalizadoparcial, 0),
      finalizadototal   = ISNULL(v.finalizadototal, 0),
      programada        = ISNULL(v.programada, 0),
      en_proceso        = ISNULL(v.enproceso, 0),
      suspendida        = ISNULL(v.suspendida, 0),
      email            = CASE WHEN ISNULL(v.email, '') <> '' THEN 1 ELSE 0 END, -- Adaptado a Integer según dominio
      tiene_plano = CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(v.plano,''))), '') IS NOT NULL THEN 1 WHEN ISNULL(v.tplano,0) = 1 THEN 1 ELSE 0 END
    FROM metalurgica_db.dbo.otrabajo v
    LEFT JOIN dbo.prioridad p ON p.descripcion = LTRIM(RTRIM(v.prioridad))
    LEFT JOIN dbo.sector    s ON s.nombre      = LTRIM(RTRIM(v.sector))
    LEFT JOIN dbo.articulo  a ON a.cod_articulo= LTRIM(RTRIM(v.idarticulo))
    WHERE v.fecha >= :fecha_desde
      AND (:incluir_terminadas = 1 OR v.fechaentrega = '1950-01-01')
)
MERGE dbo.orden_trabajo AS tgt
USING src ON tgt.id_otvieja = src.id_otvieja
WHEN MATCHED AND (
       ISNULL(tgt.observaciones,'')   <> ISNULL(src.observaciones,'')
    OR ISNULL(tgt.id_prioridad,0)     <> ISNULL(src.id_prioridad,0)
    OR ISNULL(tgt.id_sector,0)        <> ISNULL(src.id_sector,0)
    OR ISNULL(tgt.id_articulo,0)      <> ISNULL(src.id_articulo,0)
    OR ISNULL(tgt.fecha_orden,'1900-01-01')     <> ISNULL(src.fecha_orden,'1900-01-01')
    OR ISNULL(tgt.fecha_entrada,'1900-01-01')   <> ISNULL(src.fecha_entrada,'1900-01-01')
    OR ISNULL(tgt.fecha_prometida,'1900-01-01') <> ISNULL(src.fecha_prometida,'1900-01-01')
    OR ISNULL(tgt.fecha_entrega,'1900-01-01')   <> ISNULL(src.fecha_entrega,'1900-01-01')
    OR ISNULL(tgt.unidades,0)         <> ISNULL(src.unidades,0)
    OR ISNULL(tgt.requerido,0)         <> ISNULL(src.requerido,0)
    OR ISNULL(tgt.aprobado,0)          <> ISNULL(src.aprobado,0)
    OR ISNULL(tgt.reclamo,0)           <> ISNULL(src.reclamo,0)
    OR ISNULL(tgt.revisada,0)          <> ISNULL(src.revisada,0)
    OR ISNULL(tgt.finalizadoparcial,0) <> ISNULL(src.finalizadoparcial,0)
    OR ISNULL(tgt.finalizadototal,0)   <> ISNULL(src.finalizadototal,0)
    OR ISNULL(tgt.programada,0)        <> ISNULL(src.programada,0)
    OR ISNULL(tgt.en_proceso,0)        <> ISNULL(src.en_proceso,0)
    OR ISNULL(tgt.suspendida,0)        <> ISNULL(src.suspendida,0)
    OR ISNULL(tgt.email,0)             <> ISNULL(src.email,0)
    OR ISNULL(tgt.tiene_plano,0)       <> ISNULL(src.tiene_plano,0)
)
THEN UPDATE SET
      tgt.observaciones   = src.observaciones,
      tgt.id_prioridad    = src.id_prioridad,
      tgt.id_sector       = src.id_sector,
      tgt.id_articulo     = src.id_articulo,
      tgt.fecha_orden     = src.fecha_orden,
      tgt.fecha_entrada   = src.fecha_entrada,
      tgt.fecha_prometida = src.fecha_prometida,
      tgt.fecha_entrega   = src.fecha_entrega,
      tgt.unidades        = src.unidades,
      tgt.requerido         = src.requerido,
      tgt.aprobado          = src.aprobado,
      tgt.reclamo           = src.reclamo,
      tgt.revisada          = src.revisada,
      tgt.finalizadoparcial = src.finalizadoparcial,
      tgt.finalizadototal   = src.finalizadototal,
      tgt.programada        = src.programada,
      tgt.en_proceso        = src.en_proceso,
      tgt.suspendida        = src.suspendida,
      tgt.email             = src.email,
      tgt.tiene_plano       = src.tiene_plano
WHEN NOT MATCHED THEN
    INSERT (id_otvieja, observaciones, id_prioridad, id_sector, id_articulo, fecha_orden, fecha_entrada, fecha_prometida, fecha_entrega, unidades, requerido, aprobado, reclamo, revisada, finalizadoparcial, finalizadototal, programada, en_proceso, suspendida, email, tiene_plano)
    VALUES (src.id_otvieja, src.observaciones, src.id_prioridad, src.id_sector, src.id_articulo, src.fecha_orden, src.fecha_entrada, src.fecha_prometida, src.fecha_entrega, src.unidades, src.requerido, src.aprobado, src.reclamo, src.revisada, src.finalizadoparcial, src.finalizadototal, src.programada, src.en_proceso, src.suspendida, src.email, src.tiene_plano);
"""

QUERY_SYNC_PROCESO_CATALOG = """
WITH nombres AS (
    SELECT DISTINCT
      nombre = LTRIM(SUBSTRING(op.proceso, CHARINDEX('-', op.proceso) + 1, LEN(op.proceso)))
    FROM metalurgica_db.dbo.otrabajoProceso op
    WHERE op.proceso IS NOT NULL AND CHARINDEX('-', op.proceso) > 0
)
INSERT INTO dbo.proceso (nombre)
SELECT n.nombre
FROM nombres n
LEFT JOIN dbo.proceso p ON p.nombre = n.nombre
WHERE p.id IS NULL;
"""

QUERY_SYNC_OT_PROCESOS = """
WITH srcp AS (
    SELECT
      ot_new.id AS id_orden_trabajo,
      p.id      AS id_proceso,
      orden = MIN(op.orden),
      id_estado = 1,
      tiempo_proceso = SUM(DATEDIFF(MINUTE, 0, TRY_CONVERT(time(0), op.total)))
    FROM metalurgica_db.dbo.otrabajoProceso op
    INNER JOIN dbo.orden_trabajo ot_new ON ot_new.id_otvieja = op.Idot
    INNER JOIN dbo.proceso p ON p.nombre = LTRIM(SUBSTRING(op.proceso, CHARINDEX('-', op.proceso) + 1, LEN(op.proceso)))
    GROUP BY ot_new.id, p.id
)
MERGE dbo.orden_trabajo_proceso AS tgt
USING srcp AS src ON tgt.id_orden_trabajo = src.id_orden_trabajo AND tgt.id_proceso = src.id_proceso
WHEN MATCHED AND (
       ISNULL(tgt.orden,0)          <> ISNULL(src.orden,0)
    OR ISNULL(tgt.id_estado,0)      <> ISNULL(src.id_estado,0)
    OR ISNULL(tgt.tiempo_proceso,0) <> ISNULL(src.tiempo_proceso,0)
)
THEN UPDATE SET
      tgt.orden          = src.orden,
      tgt.id_estado      = src.id_estado,
      tgt.tiempo_proceso = src.tiempo_proceso
WHEN NOT MATCHED THEN
    INSERT (id_orden_trabajo, id_proceso, orden, id_estado, tiempo_proceso)
    VALUES (src.id_orden_trabajo, src.id_proceso, src.orden, src.id_estado, src.tiempo_proceso);
"""

QUERY_SYNC_MATERIA_PRIMA = """
MERGE dbo.orden_trabajo_pieza AS tgt
USING (
    SELECT
      ot.id AS id_orden_trabajo,
      pz.id AS id_pieza,
      CAST(ISNULL(mp.cantidad, 0) AS DECIMAL(18,2)) AS cantidad,
      COALESCE(NULLIF(LTRIM(RTRIM(mp.un)), ''), 'SIN UNIDAD') AS unidad,
      CASE WHEN ISNULL(mp.cantidad, 0) > 0 THEN 1 ELSE 0 END AS pedido,
      CASE WHEN ISNULL(mp.pendiente, 0) = 0 THEN 1 ELSE 0 END AS disponible,
      CAST(ISNULL(mp.cantstk, 0) AS DECIMAL(18,2)) AS cantusada
    FROM metalurgica_db.dbo.otrabajoMprimas mp
    JOIN dbo.orden_trabajo ot ON ot.id_otvieja = mp.idot
    JOIN dbo.pieza pz ON pz.cod_pieza = LTRIM(RTRIM(mp.idpieza))
) AS src ON tgt.id_orden_trabajo = src.id_orden_trabajo AND tgt.id_pieza = src.id_pieza
WHEN MATCHED AND (
       ISNULL(tgt.cantidad,0)   <> ISNULL(src.cantidad,0)
    OR ISNULL(tgt.unidad,'')    <> ISNULL(src.unidad,'')
    OR ISNULL(tgt.pedido,0)     <> ISNULL(src.pedido,0)
    OR ISNULL(tgt.disponible,0) <> ISNULL(src.disponible,0)
    OR ISNULL(tgt.cantusada,0)  <> ISNULL(src.cantusada,0)
)
THEN UPDATE SET
      tgt.cantidad   = src.cantidad,
      tgt.unidad     = src.unidad,
      tgt.pedido     = src.pedido,
      tgt.disponible = src.disponible,
      tgt.cantusada  = src.cantusada
WHEN NOT MATCHED THEN
    INSERT (id_orden_trabajo, id_pieza, cantidad, unidad, pedido, disponible, cantusada)
    VALUES (src.id_orden_trabajo, src.id_pieza, src.cantidad, src.unidad, src.pedido, src.disponible, src.cantusada);
"""

QUERY_MERGE_PIEZA = """
MERGE dbo.pieza AS T
USING (
    SELECT
        LTRIM(RTRIM(mp.idpieza)) AS cod_pieza,
        CAST(MAX(ISNULL(mp.cantstk, 0)) AS DECIMAL(18,2)) AS stockactual
    FROM metalurgica_db.dbo.otrabajoMprimas mp
    GROUP BY LTRIM(RTRIM(mp.idpieza))
) AS S ON T.cod_pieza = S.cod_pieza
WHEN MATCHED AND ISNULL(T.stockactual, 0) <> ISNULL(S.stockactual, 0)
THEN UPDATE SET T.stockactual = S.stockactual;
"""

async def run_sync():
    logger.info("Iniciando sincronización de base de datos completa...")
    async with SessionLocal() as session:
        try:
            # 1. Semillas
            logger.info("Asegurando datos semilla (Articulo, Sector, Prioridad)...")
            await session.execute(text(QUERY_SEED_ARTICULO))
            await session.execute(text(QUERY_SEED_SECTOR))
            await session.execute(text(QUERY_SEED_PRIORIDAD))
            
            # 2. Sincronizar OTs (Desde 2025 por defecto, o personalizable)
            fecha_desde = (datetime.now() - timedelta(days=60)).strftime('%Y-%m-01')
            logger.info(f"Sincronizando Ordenes de Trabajo desde {fecha_desde}...")
            await session.execute(text(QUERY_SYNC_OTS), {"fecha_desde": fecha_desde, "incluir_terminadas": 0})
            
            # 3. Sincronizar Catálogo de Procesos
            logger.info("Actualizando catálogo de procesos...")
            await session.execute(text(QUERY_SYNC_PROCESO_CATALOG))
            
            # 4. Sincronizar Procesos por OT
            logger.info("Sincronizando procesos por OT...")
            await session.execute(text(QUERY_SYNC_OT_PROCESOS))
            
            # 5. Sincronizar Materias Primas por OT
            logger.info("Sincronizando materias primas por OT...")
            await session.execute(text(QUERY_SYNC_MATERIA_PRIMA))
            
            # 6. Actualizar Stock de Piezas
            logger.info("Actualizando stock actual de piezas...")
            await session.execute(text(QUERY_MERGE_PIEZA))
            
            await session.commit()
            logger.info("Sincronización completada exitosamente.")
        except Exception as e:
            await session.rollback()
            logger.error(f"Error durante la sincronización: {e}")

async def main():
    while True:
        try:
            await run_sync()
        except Exception as e:
            logger.error(f"Error inesperado en el loop principal: {e}")
        
        logger.info("Esperando 5 minutos para la próxima sincronización...")
        await asyncio.sleep(300) # 5 minutos

if __name__ == "__main__":
    asyncio.run(main())
