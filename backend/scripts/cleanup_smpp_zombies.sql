-- =============================================================================
-- Cleanup one-shot para alinear SMPP con el estado real de metalurgica_db.
--
-- Marca como finalizadototal=1 cualquier OT en SMPP que en el legacy ya no sea
-- "pendiente" segun la regla del sistema viejo:
--    finalizadototal=0 AND suspendida=0 AND remitido=0
--    AND cantidad>0 AND cantidad>cantidadE AND cantidad>cantidadfinalizado
--
-- NO BORRA NADA. Preserva planificacion, orden_trabajo_pieza, orden_trabajo_proceso
-- y el historial de la OT. Cualquier vista que filtre por finalizadototal=0
-- (como "Ordenes No Planificadas") va a dejar de mostrar los zombies.
--
-- Recomendado: correr 1) preview, 2) ejecutar, 3) verificar.
-- Despues, el cron ya hace esto automaticamente cada 5 min (sync_db.py).
-- =============================================================================

-- 1) PREVIEW: cuantas OTs van a marcarse como finalizadas y por que
SELECT
    COUNT(*) AS total_a_marcar,
    SUM(CASE WHEN v.idot IS NULL                          THEN 1 ELSE 0 END) AS sin_origen_legacy,
    SUM(CASE WHEN ISNULL(v.finalizadototal,0) = 1         THEN 1 ELSE 0 END) AS legacy_finalizada_total,
    SUM(CASE WHEN ISNULL(v.suspendida,0)      = 1         THEN 1 ELSE 0 END) AS legacy_suspendida,
    SUM(CASE WHEN ISNULL(v.remitido,0)        = 1         THEN 1 ELSE 0 END) AS legacy_remitida,
    SUM(CASE WHEN v.fechaentrega <> '1950-01-01'          THEN 1 ELSE 0 END) AS legacy_con_fecha_entrega,
    SUM(CASE WHEN ISNULL(v.cantidad,0) <= 0               THEN 1 ELSE 0 END) AS legacy_cantidad_cero,
    SUM(CASE WHEN v.cantidad <= ISNULL(v.cantidadE,0)     THEN 1 ELSE 0 END) AS legacy_entregada_100,
    SUM(CASE WHEN v.cantidad <= ISNULL(v.cantidadfinalizado,0) THEN 1 ELSE 0 END) AS legacy_fabricada_100
FROM SMPP.dbo.orden_trabajo tgt
LEFT JOIN metalurgica_db.dbo.otrabajo v ON v.idot = tgt.id_otvieja
WHERE tgt.id_otvieja IS NOT NULL
  AND ISNULL(tgt.finalizadototal, 0) = 0
  AND (
       v.idot IS NULL
    OR ISNULL(v.finalizadototal, 0) = 1
    OR ISNULL(v.suspendida, 0)      = 1
    OR ISNULL(v.remitido, 0)        = 1
    OR ISNULL(v.cantidad, 0) <= 0
    OR v.cantidad <= ISNULL(v.cantidadE, 0)
    OR v.cantidad <= ISNULL(v.cantidadfinalizado, 0)
  );

-- 2) EJECUTAR: descomentar y correr.  Es idempotente (correr 2 veces no hace dano).
-- BEGIN TRAN;
-- UPDATE tgt
-- SET tgt.finalizadototal = 1
-- FROM SMPP.dbo.orden_trabajo tgt
-- LEFT JOIN metalurgica_db.dbo.otrabajo v ON v.idot = tgt.id_otvieja
-- WHERE tgt.id_otvieja IS NOT NULL
--   AND ISNULL(tgt.finalizadototal, 0) = 0
--   AND (
--        v.idot IS NULL
--     OR ISNULL(v.finalizadototal, 0) = 1
--     OR ISNULL(v.suspendida, 0)      = 1
--     OR ISNULL(v.remitido, 0)        = 1
-- --     OR ISNULL(v.cantidad, 0) <= 0
--     OR v.cantidad <= ISNULL(v.cantidadE, 0)
--     OR v.cantidad <= ISNULL(v.cantidadfinalizado, 0)
--   );
-- -- Verificar antes de commitear:
-- SELECT COUNT(*) AS pendientes_smpp_post_cleanup
-- FROM SMPP.dbo.orden_trabajo
-- WHERE ISNULL(finalizadototal, 0) = 0;
-- COMMIT;  -- o ROLLBACK; si los numeros no cuadran

-- 3) Comparar contra la app vieja (debe quedar parecido a las 143 pendientes estrictas)
SELECT
    (SELECT COUNT(*) FROM SMPP.dbo.orden_trabajo WHERE ISNULL(finalizadototal,0) = 0) AS pendientes_smpp,
    (SELECT COUNT(*) FROM metalurgica_db.dbo.otrabajo
       WHERE ISNULL(finalizadototal,0)=0 AND ISNULL(suspendida,0)=0 AND ISNULL(remitido,0)=0
         AND cantidad > 0
         AND cantidad > ISNULL(cantidadE,0)
         AND cantidad > ISNULL(cantidadfinalizado,0)) AS pendientes_legacy_estricto;
