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

QUERY_SYNC_CLIENTES = """
MERGE dbo.cliente AS tgt
USING (
    SELECT 
        idCliente AS id_viejo,
        LTRIM(RTRIM(Descripcion)) AS nombre,
        LTRIM(RTRIM(fantasia)) AS fantasia,
        LTRIM(RTRIM(abreviatura)) AS abreviatura,
        LTRIM(RTRIM(direccion)) AS direccion,
        LTRIM(RTRIM(localidad)) AS localidad,
        LTRIM(RTRIM(cuit)) AS cuit,
        LTRIM(RTRIM(telefono)) AS telefono,
        LTRIM(RTRIM(celular)) AS celular,
        LTRIM(RTRIM(mail)) AS mail,
        LTRIM(RTRIM(web)) AS web,
        LTRIM(RTRIM(obs)) AS obs
    FROM metalurgica_db.dbo.cliente
) AS src ON tgt.id_viejo = src.id_viejo
WHEN MATCHED AND (
    ISNULL(tgt.nombre,'') <> ISNULL(src.nombre,'') OR
    ISNULL(tgt.fantasia,'') <> ISNULL(src.fantasia,'') OR
    ISNULL(tgt.abreviatura,'') <> ISNULL(src.abreviatura,'') OR
    ISNULL(tgt.direccion,'') <> ISNULL(src.direccion,'') OR
    ISNULL(tgt.localidad,'') <> ISNULL(src.localidad,'') OR
    ISNULL(tgt.cuit,'') <> ISNULL(src.cuit,'') OR
    ISNULL(tgt.telefono,'') <> ISNULL(src.telefono,'') OR
    ISNULL(tgt.celular,'') <> ISNULL(src.celular,'') OR
    ISNULL(tgt.mail,'') <> ISNULL(src.mail,'') OR
    ISNULL(tgt.web,'') <> ISNULL(src.web,'') OR
    ISNULL(tgt.obs,'') <> ISNULL(src.obs,'')
) THEN UPDATE SET
    tgt.nombre = src.nombre,
    tgt.fantasia = src.fantasia,
    tgt.abreviatura = src.abreviatura,
    tgt.direccion = src.direccion,
    tgt.localidad = src.localidad,
    tgt.cuit = src.cuit,
    tgt.telefono = src.telefono,
    tgt.celular = src.celular,
    tgt.mail = src.mail,
    tgt.web = src.web,
    tgt.obs = src.obs
WHEN NOT MATCHED THEN
    INSERT (id_viejo, nombre, fantasia, abreviatura, direccion, localidad, cuit, telefono, celular, mail, web, obs)
    VALUES (src.id_viejo, src.nombre, src.fantasia, src.abreviatura, src.direccion, src.localidad, src.cuit, src.telefono, src.celular, src.mail, src.web, src.obs);
"""

QUERY_SYNC_ARTICULOS_CATALOG = """
MERGE dbo.articulo AS tgt
USING (
    SELECT 
        LTRIM(RTRIM(Idarticulo)) AS cod_articulo,
        LTRIM(RTRIM(descripcion)) AS descripcion,
        LTRIM(RTRIM(abreviatura)) AS abreviatura
    FROM metalurgica_db.dbo.articulo
    WHERE Idarticulo IS NOT NULL AND Idarticulo <> ''
) AS src ON tgt.cod_articulo = src.cod_articulo
WHEN MATCHED AND (
    ISNULL(tgt.descripcion,'') <> ISNULL(src.descripcion,'') OR
    ISNULL(tgt.abreviatura,'') <> ISNULL(src.abreviatura,'')
) THEN UPDATE SET
    tgt.descripcion = src.descripcion,
    tgt.abreviatura = src.abreviatura
WHEN NOT MATCHED THEN
    INSERT (cod_articulo, descripcion, abreviatura)
    VALUES (src.cod_articulo, src.descripcion, src.abreviatura);
"""


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
      id_cliente   = c.id,
      fecha_orden      = v.fecha,
      fecha_entrada    = v.fechaentrada,
      fecha_prometida  = v.fechaprometida,
      fecha_entrega    = CASE WHEN v.fechaentrega = '1950-01-01' THEN NULL ELSE v.fechaentrega END,
      unidades          = v.cantidad,
      cantidad_entregada = ISNULL(v.cantidadE, 0),
      reclamo           = ISNULL(v.reclamo, 0),
      revisada          = ISNULL(v.revisada, 0),
      finalizadoparcial = ISNULL(v.finalizadoparcial, 0),
      finalizadototal   = ISNULL(v.finalizadototal, 0),
      programada        = ISNULL(v.programada, 0),
      en_proceso        = ISNULL(v.enproceso, 0),
      suspendida        = ISNULL(v.suspendida, 0),
      email              = CASE WHEN ISNULL(v.email, '') <> '' THEN 1 ELSE 0 END, -- Adaptado a Integer según dominio
      tiene_plano        = CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(v.plano,''))), '') IS NOT NULL THEN 1 WHEN ISNULL(v.tplano,0) = 1 THEN 1 ELSE 0 END,
      n_ped_l            = '',
      n_pedido           = ISNULL(v.nropedido, ''),
      subsector          = ISNULL(v.subsector, ''),
      requerido_por      = ISNULL(v.requerido, ''),
      aprobado_por       = ISNULL(v.aprobado, ''),
      remitos_salida     = ISNULL(v.remitosalida, ''),
      f_disp_material    = CASE WHEN v.fmaterial = '1950-01-01' THEN NULL ELSE v.fmaterial END,
      fabricacion        = ISNULL(v.afabricar, 0),
      reparacion         = 0,
      sin_cargo          = 0,
      stock              = 0,
      interno            = 0,
      tercerizado_total  = ISNULL(v.ttotal, 0),
      tercerizado_parcial = ISNULL(v.tparcial, 0),
      fc                  = ISNULL(v.fc, 0),
      ttt1                = ISNULL(v.ttt1, 0)
    FROM metalurgica_db.dbo.otrabajo v
    LEFT JOIN dbo.prioridad p ON p.descripcion = LTRIM(RTRIM(v.prioridad))
    LEFT JOIN dbo.sector    s ON s.nombre      = LTRIM(RTRIM(v.sector))
    LEFT JOIN dbo.articulo  a ON a.cod_articulo= LTRIM(RTRIM(v.idarticulo))
    LEFT JOIN dbo.cliente   c ON c.id_viejo    = v.idcliente
    WHERE v.fecha >= :fecha_desde
       OR (
            -- Regla OFICIAL del sistema legacy (la que usa Jorge, el creador).
            -- Trae cualquier OT que sea "pendiente" según el viejo, sin importar la fecha.
            -- Diferencia clave con la regla estricta vieja: NO usa `remitido`. En el legacy,
            -- `remitido=1` solo indica que se generó un remito parcial; la OT sigue activa
            -- hasta que `fechaentrega` deje de ser '1950-01-01'.
                ISNULL(v.fc, 0)                  <> 1
            AND v.fechaentrega                    = '1950-01-01'
            AND v.fecha                           > '2021-01-01'
            AND ISNULL(v.cantidade, 0)           < ISNULL(v.cantidad, 0)
            AND ISNULL(v.ttt1, 0)                <> 1
            AND ISNULL(v.suspendida, 0)           = 0
       )
)
MERGE dbo.orden_trabajo AS tgt
USING src ON tgt.id_otvieja = src.id_otvieja
WHEN MATCHED AND (
       ISNULL(tgt.observaciones,'')   <> ISNULL(src.observaciones,'')
    OR ISNULL(tgt.id_prioridad,0)     <> ISNULL(src.id_prioridad,0)
    OR ISNULL(tgt.id_sector,0)        <> ISNULL(src.id_sector,0)
    OR ISNULL(tgt.id_articulo,0)      <> ISNULL(src.id_articulo,0)
    OR ISNULL(tgt.id_cliente,0)       <> ISNULL(src.id_cliente,0)
    OR ISNULL(tgt.fecha_orden,'1900-01-01')     <> ISNULL(src.fecha_orden,'1900-01-01')
    OR ISNULL(tgt.fecha_entrada,'1900-01-01')   <> ISNULL(src.fecha_entrada,'1900-01-01')
    OR ISNULL(tgt.fecha_prometida,'1900-01-01') <> ISNULL(src.fecha_prometida,'1900-01-01')
    OR ISNULL(tgt.fecha_entrega,'1900-01-01')   <> ISNULL(src.fecha_entrega,'1900-01-01')
    OR ISNULL(tgt.unidades,0)         <> ISNULL(src.unidades,0)
    OR ISNULL(tgt.cantidad_entregada,0) <> ISNULL(src.cantidad_entregada,0)
    OR ISNULL(tgt.reclamo,0)           <> ISNULL(src.reclamo,0)
    OR ISNULL(tgt.revisada,0)          <> ISNULL(src.revisada,0)
    OR ISNULL(tgt.finalizadoparcial,0) <> ISNULL(src.finalizadoparcial,0)
    OR ISNULL(tgt.finalizadototal,0)   <> ISNULL(src.finalizadototal,0)
    OR ISNULL(tgt.programada,0)        <> ISNULL(src.programada,0)
    OR ISNULL(tgt.en_proceso,0)        <> ISNULL(src.en_proceso,0)
    OR ISNULL(tgt.suspendida,0)        <> ISNULL(src.suspendida,0)
    OR ISNULL(tgt.email,0)             <> ISNULL(src.email,0)
    OR ISNULL(tgt.tiene_plano,0)       <> ISNULL(src.tiene_plano,0)
    OR ISNULL(tgt.n_ped_l,'')          <> ISNULL(src.n_ped_l,'')
    OR ISNULL(tgt.n_pedido,'')         <> ISNULL(src.n_pedido,'')
    OR ISNULL(tgt.subsector,'')        <> ISNULL(src.subsector,'')
    OR ISNULL(tgt.requerido_por,'')    <> ISNULL(src.requerido_por,'')
    OR ISNULL(tgt.aprobado_por,'')     <> ISNULL(src.aprobado_por,'')
    OR ISNULL(tgt.remitos_salida,'')   <> ISNULL(src.remitos_salida,'')
    OR ISNULL(tgt.f_disp_material,'1900-01-01') <> ISNULL(src.f_disp_material,'1900-01-01')
    OR ISNULL(tgt.fabricacion,0)       <> ISNULL(src.fabricacion,0)
    OR ISNULL(tgt.reparacion,0)        <> ISNULL(src.reparacion,0)
    OR ISNULL(tgt.sin_cargo,0)         <> ISNULL(src.sin_cargo,0)
    OR ISNULL(tgt.stock,0)             <> ISNULL(src.stock,0)
    OR ISNULL(tgt.interno,0)           <> ISNULL(src.interno,0)
    OR ISNULL(tgt.tercerizado_total,0) <> ISNULL(src.tercerizado_total,0)
    OR ISNULL(tgt.tercerizado_parcial,0) <> ISNULL(src.tercerizado_parcial,0)
    OR ISNULL(tgt.fc,0)                <> ISNULL(src.fc,0)
    OR ISNULL(tgt.ttt1,0)              <> ISNULL(src.ttt1,0)
)
THEN UPDATE SET
      tgt.observaciones   = src.observaciones,
      tgt.id_prioridad    = src.id_prioridad,
      tgt.id_sector       = src.id_sector,
      tgt.id_articulo     = src.id_articulo,
      tgt.id_cliente      = src.id_cliente,
      tgt.fecha_orden     = src.fecha_orden,
      tgt.fecha_entrada   = src.fecha_entrada,
      tgt.fecha_prometida = src.fecha_prometida,
      tgt.fecha_entrega   = src.fecha_entrega,
      tgt.unidades        = src.unidades,
      tgt.cantidad_entregada = src.cantidad_entregada,
      tgt.reclamo           = src.reclamo,
      tgt.revisada          = src.revisada,
      tgt.finalizadoparcial = src.finalizadoparcial,
      tgt.finalizadototal   = src.finalizadototal,
      tgt.programada        = src.programada,
      tgt.en_proceso        = src.en_proceso,
      tgt.suspendida        = src.suspendida,
      tgt.email             = src.email,
      tgt.tiene_plano       = src.tiene_plano,
      tgt.n_ped_l           = src.n_ped_l,
      tgt.n_pedido          = src.n_pedido,
      tgt.subsector         = src.subsector,
      tgt.requerido_por     = src.requerido_por,
      tgt.aprobado_por      = src.aprobado_por,
      tgt.remitos_salida    = src.remitos_salida,
      tgt.f_disp_material   = src.f_disp_material,
      tgt.fabricacion       = src.fabricacion,
      tgt.reparacion        = src.reparacion,
      tgt.sin_cargo         = src.sin_cargo,
      tgt.stock             = src.stock,
      tgt.interno           = src.interno,
      tgt.tercerizado_total = src.tercerizado_total,
      tgt.tercerizado_parcial = src.tercerizado_parcial,
      tgt.fc                = src.fc,
      tgt.ttt1              = src.ttt1
WHEN NOT MATCHED THEN
    INSERT (id_otvieja, observaciones, id_prioridad, id_sector, id_articulo, id_cliente, fecha_orden, fecha_entrada, fecha_prometida, fecha_entrega, unidades, cantidad_entregada, reclamo, revisada, finalizadoparcial, finalizadototal, programada, en_proceso, suspendida, email, tiene_plano, n_ped_l, n_pedido, subsector, requerido_por, aprobado_por, remitos_salida, f_disp_material, fabricacion, reparacion, sin_cargo, stock, interno, tercerizado_total, tercerizado_parcial, fc, ttt1)
    VALUES (src.id_otvieja, src.observaciones, src.id_prioridad, src.id_sector, src.id_articulo, src.id_cliente, src.fecha_orden, src.fecha_entrada, src.fecha_prometida, src.fecha_entrega, src.unidades, src.cantidad_entregada, src.reclamo, src.revisada, src.finalizadoparcial, src.finalizadototal, src.programada, src.en_proceso, src.suspendida, src.email, src.tiene_plano, src.n_ped_l, src.n_pedido, src.subsector, src.requerido_por, src.aprobado_por, src.remitos_salida, src.f_disp_material, src.fabricacion, src.reparacion, src.sin_cargo, src.stock, src.interno, src.tercerizado_total, src.tercerizado_parcial, src.fc, src.ttt1);
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
        MAX(ISNULL(mp.descripcion, '')) AS descripcion,
        CAST(MAX(ISNULL(mp.costo, 0)) AS DECIMAL(18,2)) AS unitario,
        MAX(ISNULL(NULLIF(LTRIM(RTRIM(mp.un)), ''), 'UN')) AS unidad,
        CAST(MAX(ISNULL(mp.cantstk, 0)) AS DECIMAL(18,2)) AS stockactual
    FROM metalurgica_db.dbo.otrabajoMprimas mp
    WHERE mp.idpieza IS NOT NULL AND LTRIM(RTRIM(mp.idpieza)) <> ''
    GROUP BY LTRIM(RTRIM(mp.idpieza))
) AS S ON T.cod_pieza = S.cod_pieza
WHEN MATCHED AND ISNULL(T.stockactual, 0) <> ISNULL(S.stockactual, 0)
THEN UPDATE SET T.stockactual = S.stockactual
WHEN NOT MATCHED THEN
    INSERT (cod_pieza, descripcion, unitario, unidad, stockactual)
    VALUES (S.cod_pieza, S.descripcion, S.unitario, S.unidad, S.stockactual);
"""

# --- Marca como finalizadas las OTs en SMPP que ya no son "pendientes" en legacy.
# Regla OFICIAL del sistema viejo (la que usa Jorge, su creador):
#   pendiente <=> fc<>1
#              AND fechaentrega='1950-01-01'
#              AND fecha>'2021-01-01'
#              AND cantidade<cantidad
#              AND ttt1<>1
#              AND suspendida=0
# Una OT es "zombie" cuando NO cumple esa regla → la marcamos finalizadototal=1.
# Notas importantes:
#   * NO se chequea `remitido`. En legacy `remitido=1` solo indica un remito parcial;
#     la OT sigue activa hasta que `fechaentrega` deje de ser '1950-01-01'.
#   * `fc=1` saca del circuito (probablemente "facturada cerrada" o "fuera de circuito").
#   * `ttt1=1` indica una variante de tercerizado que no debe estar en el listado de pendientes.
QUERY_FINALIZE_ZOMBIES = """
UPDATE tgt
SET tgt.finalizadototal = 1
FROM dbo.orden_trabajo tgt
LEFT JOIN metalurgica_db.dbo.otrabajo v ON v.idot = tgt.id_otvieja
WHERE tgt.id_otvieja IS NOT NULL
  AND ISNULL(tgt.finalizadototal, 0) = 0
  AND (
       v.idot IS NULL
    OR ISNULL(v.fc, 0)         = 1
    OR v.fechaentrega         <> '1950-01-01'
    OR ISNULL(v.cantidade, 0) >= ISNULL(v.cantidad, 0)
    OR ISNULL(v.ttt1, 0)       = 1
    OR ISNULL(v.suspendida, 0) = 1
    OR v.fecha                <= '2021-01-01'
  );
"""

# --- Reactivar OTs que fueron mal-zombificadas: en SMPP están finalizadototal=1
# pero en legacy SIGUEN siendo pendientes según la regla oficial. Esto puede pasar
# si el usuario (o un cron previo con bug) las marcó por error.
QUERY_REACTIVATE_FALSE_ZOMBIES = """
UPDATE tgt
SET tgt.finalizadototal = 0
FROM dbo.orden_trabajo tgt
INNER JOIN metalurgica_db.dbo.otrabajo v ON v.idot = tgt.id_otvieja
WHERE tgt.id_otvieja IS NOT NULL
  AND ISNULL(tgt.finalizadototal, 0) = 1
  AND ISNULL(v.fc, 0)         <> 1
  AND v.fechaentrega           = '1950-01-01'
  AND v.fecha                  > '2021-01-01'
  AND ISNULL(v.cantidade, 0)  < ISNULL(v.cantidad, 0)
  AND ISNULL(v.ttt1, 0)       <> 1
  AND ISNULL(v.suspendida, 0)  = 0;
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
            
            # 2. Sincronizar Catálogos (Clientes y Artículos) antes que las OTs
            logger.info("Actualizando catálogo de clientes...")
            await session.execute(text(QUERY_SYNC_CLIENTES))

            logger.info("Actualizando catálogo de artículos...")
            await session.execute(text(QUERY_SYNC_ARTICULOS_CATALOG))
            
            # 3. Sincronizar OTs (TODAS las del rango, finalizadas y pendientes,
            #    para que los flags se actualicen correctamente).
            fecha_desde = (datetime.now() - timedelta(days=60)).strftime('%Y-%m-01')
            logger.info(f"Sincronizando Ordenes de Trabajo desde {fecha_desde}...")
            await session.execute(text(QUERY_SYNC_OTS), {"fecha_desde": fecha_desde})

            # 4a. Reactivar las que estaban marcadas finalizadas pero en legacy
            #     siguen pendientes (caso típico: cron viejo con bug, edición manual).
            logger.info("Reactivando falsos zombies (pendientes en legacy marcadas como finalizadas en SMPP)...")
            result_react = await session.execute(text(QUERY_REACTIVATE_FALSE_ZOMBIES))
            logger.info(f"  -> Reactivadas: {result_react.rowcount}")

            # 4b. Marcar como finalizadas las OTs zombies (en legacy ya no son pendientes
            #     según la regla oficial pero quedaron activas en SMPP).
            logger.info("Marcando zombies (OTs ya cerradas/entregadas/suspendidas/fc=1 en legacy)...")
            result_zomb = await session.execute(text(QUERY_FINALIZE_ZOMBIES))
            logger.info(f"  -> Marcadas como finalizadas: {result_zomb.rowcount}")

            # 5. Sincronizar Catálogo de Procesos
            logger.info("Actualizando catálogo de procesos...")
            await session.execute(text(QUERY_SYNC_PROCESO_CATALOG))

            # 6. Sincronizar Procesos por OT
            logger.info("Sincronizando procesos por OT...")
            await session.execute(text(QUERY_SYNC_OT_PROCESOS))

            # 7. Actualizar / insertar catálogo de Piezas (debe correr ANTES de las MPs por OT,
            #    para que los inserts de orden_trabajo_pieza puedan resolver el id_pieza).
            logger.info("Actualizando catálogo y stock de piezas...")
            await session.execute(text(QUERY_MERGE_PIEZA))

            # 8. Sincronizar Materias Primas por OT
            logger.info("Sincronizando materias primas por OT...")
            await session.execute(text(QUERY_SYNC_MATERIA_PRIMA))
            
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
