import asyncio
import time
from sqlalchemy import text
from backend.infrastructure.db import engine, SessionLocal
from backend.commons.loggers.logger import logger
import logging

# Configurar logger para mostrar info en este script
logger.setLevel(logging.INFO)

# Consultas MERGE proporcionadas por el usuario
QUERY_MERGE_ORDEN_TRABAJO_PIEZA = """
MERGE dbo.orden_trabajo_pieza AS T
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
    JOIN dbo.orden_trabajo ot
        ON ot.id_otvieja = mp.idot
    JOIN dbo.pieza pz
        ON pz.cod_pieza = LTRIM(RTRIM(mp.idpieza))
) AS S
ON  T.id_orden_trabajo = S.id_orden_trabajo
AND T.id_pieza         = S.id_pieza

WHEN MATCHED AND (
       ISNULL(T.cantidad, 0)   <> ISNULL(S.cantidad, 0)
    OR ISNULL(T.unidad, '')    <> ISNULL(S.unidad, '')
    OR ISNULL(T.pedido, 0)     <> ISNULL(S.pedido, 0)
    OR ISNULL(T.disponible, 0) <> ISNULL(S.disponible, 0)
    OR ISNULL(T.cantusada, 0)  <> ISNULL(S.cantusada, 0)
) THEN
    UPDATE SET
        T.cantidad    = S.cantidad,
        T.unidad      = S.unidad,
        T.pedido      = S.pedido,
        T.disponible  = S.disponible,
        T.cantusada   = S.cantusada

WHEN NOT MATCHED THEN
    INSERT (id_orden_trabajo, id_pieza, cantidad, unidad, pedido, disponible, cantusada)
    VALUES (S.id_orden_trabajo, S.id_pieza, S.cantidad, S.unidad, S.pedido, S.disponible, S.cantusada)
;
"""

QUERY_MERGE_PIEZA = """
MERGE dbo.pieza AS T
USING (
    SELECT
        LTRIM(RTRIM(mp.idpieza)) AS cod_pieza,
        CAST(MAX(ISNULL(mp.cantstk, 0)) AS DECIMAL(18,2)) AS stockactual
    FROM metalurgica_db.dbo.otrabajoMprimas mp
    GROUP BY LTRIM(RTRIM(mp.idpieza))
) AS S
ON T.cod_pieza = S.cod_pieza

WHEN MATCHED
AND ISNULL(T.stockactual, 0) <> ISNULL(S.stockactual, 0)
THEN
    UPDATE SET T.stockactual = S.stockactual
;
"""

async def run_sync():
    logger.info("Iniciando sincronización de base de datos...")
    async with SessionLocal() as session:
        try:
            # Ejecutar MERGE para orden_trabajo_pieza
            logger.info("Ejecutando MERGE para orden_trabajo_pieza...")
            await session.execute(text(QUERY_MERGE_ORDEN_TRABAJO_PIEZA))
            
            # Ejecutar MERGE para pieza (stock)
            logger.info("Ejecutando MERGE para pieza (stock)...")
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
