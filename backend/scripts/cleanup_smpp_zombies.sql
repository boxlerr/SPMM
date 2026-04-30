-- =============================================================================
-- Cleanup one-shot para alinear SMPP con el estado real de metalurgica_db
-- usando la REGLA OFICIAL del sistema viejo (la que usa Jorge, su creador).
--
-- Regla "OT pendiente" en legacy:
--    fc <> 1
--    AND fechaentrega = '1950-01-01'
--    AND fecha > '2021-01-01'
--    AND cantidade < cantidad
--    AND ttt1 <> 1
--    AND suspendida = 0
--
-- Notas:
--   * NO se chequea `remitido`. En legacy `remitido=1` solo indica un remito parcial;
--     la OT sigue activa hasta que `fechaentrega` deje de ser '1950-01-01'.
--   * `fc=1` saca del circuito (probablemente "facturada cerrada"/"fuera de circuito").
--   * `ttt1=1` es una variante de tercerizado que no aparece como pendiente.
--
-- IMPORTANTE: requiere que SMPP.dbo.orden_trabajo tenga las columnas `fc` y `ttt1`.
-- Si no las tiene, primero correr:
--     ALTER TABLE SMPP.dbo.orden_trabajo ADD fc   SMALLINT NOT NULL DEFAULT 0;
--     ALTER TABLE SMPP.dbo.orden_trabajo ADD ttt1 BIT      NOT NULL DEFAULT 0;
--
-- Pasos: 1) PREVIEW, 2) EJECUTAR (BEGIN TRAN/COMMIT), 3) VERIFICAR.
-- Después el cron (sync_db.py) lo mantiene automáticamente cada 5 min.
-- =============================================================================

-- =============================================================================
-- 1) PREVIEW: cuántas hay que reactivar y cuántas hay que finalizar
-- =============================================================================
SELECT
    -- Falsos zombies: en SMPP están finalizadas, pero en legacy SIGUEN siendo pendientes.
    a_reactivar = (
        SELECT COUNT(*)
        FROM SMPP.dbo.orden_trabajo tgt
        INNER JOIN metalurgica_db.dbo.otrabajo v ON v.idot = tgt.id_otvieja
        WHERE tgt.id_otvieja IS NOT NULL
          AND ISNULL(tgt.finalizadototal,0) = 1
          AND ISNULL(v.fc,0)         <> 1
          AND v.fechaentrega          = '1950-01-01'
          AND v.fecha                 > '2021-01-01'
          AND ISNULL(v.cantidade,0)  < ISNULL(v.cantidad,0)
          AND ISNULL(v.ttt1,0)       <> 1
          AND ISNULL(v.suspendida,0)  = 0
    ),
    -- Zombies: en SMPP están activas, pero en legacy ya NO son pendientes.
    a_finalizar = (
        SELECT COUNT(*)
        FROM SMPP.dbo.orden_trabajo tgt
        LEFT JOIN metalurgica_db.dbo.otrabajo v ON v.idot = tgt.id_otvieja
        WHERE tgt.id_otvieja IS NOT NULL
          AND ISNULL(tgt.finalizadototal,0) = 0
          AND (
                v.idot IS NULL
             OR ISNULL(v.fc,0)         = 1
             OR v.fechaentrega        <> '1950-01-01'
             OR ISNULL(v.cantidade,0) >= ISNULL(v.cantidad,0)
             OR ISNULL(v.ttt1,0)       = 1
             OR ISNULL(v.suspendida,0) = 1
             OR v.fecha               <= '2021-01-01'
          )
    ),
    pendientes_legacy_oficial = (
        SELECT COUNT(*) FROM metalurgica_db.dbo.otrabajo
        WHERE fc<>1 AND fechaentrega='1950-01-01' AND fecha>'2021-01-01'
          AND cantidade<cantidad AND ttt1<>1 AND suspendida=0
    ),
    pendientes_smpp_actual = (
        SELECT COUNT(*) FROM SMPP.dbo.orden_trabajo
        WHERE ISNULL(finalizadototal,0) = 0
    );

-- =============================================================================
-- 2) EJECUTAR: descomentar el BEGIN TRAN..COMMIT
-- =============================================================================
-- BEGIN TRAN;
--
-- -- 2a. Reactivar falsos zombies
-- UPDATE tgt SET tgt.finalizadototal = 0
-- FROM SMPP.dbo.orden_trabajo tgt
-- INNER JOIN metalurgica_db.dbo.otrabajo v ON v.idot = tgt.id_otvieja
-- WHERE tgt.id_otvieja IS NOT NULL
--   AND ISNULL(tgt.finalizadototal,0) = 1
--   AND ISNULL(v.fc,0)         <> 1
--   AND v.fechaentrega          = '1950-01-01'
--   AND v.fecha                 > '2021-01-01'
--   AND ISNULL(v.cantidade,0)  < ISNULL(v.cantidad,0)
--   AND ISNULL(v.ttt1,0)       <> 1
--   AND ISNULL(v.suspendida,0)  = 0;
--
-- -- 2b. Finalizar zombies
-- UPDATE tgt SET tgt.finalizadototal = 1
-- FROM SMPP.dbo.orden_trabajo tgt
-- LEFT JOIN metalurgica_db.dbo.otrabajo v ON v.idot = tgt.id_otvieja
-- WHERE tgt.id_otvieja IS NOT NULL
--   AND ISNULL(tgt.finalizadototal,0) = 0
--   AND (
--         v.idot IS NULL
--      OR ISNULL(v.fc,0)         = 1
--      OR v.fechaentrega        <> '1950-01-01'
--      OR ISNULL(v.cantidade,0) >= ISNULL(v.cantidad,0)
--      OR ISNULL(v.ttt1,0)       = 1
--      OR ISNULL(v.suspendida,0) = 1
--      OR v.fecha               <= '2021-01-01'
--   );
--
-- -- Verificar antes de commitear:
-- SELECT
--   pendientes_smpp = (SELECT COUNT(*) FROM SMPP.dbo.orden_trabajo WHERE ISNULL(finalizadototal,0)=0),
--   pendientes_legacy = (SELECT COUNT(*) FROM metalurgica_db.dbo.otrabajo
--                         WHERE fc<>1 AND fechaentrega='1950-01-01' AND fecha>'2021-01-01'
--                           AND cantidade<cantidad AND ttt1<>1 AND suspendida=0);
-- -- Tienen que ser iguales (o casi). Si cuadra:
-- COMMIT;  -- o ROLLBACK;

-- =============================================================================
-- 3) Comparar contra el legacy (deberían quedar iguales)
-- =============================================================================
SELECT
    pendientes_smpp = (SELECT COUNT(*) FROM SMPP.dbo.orden_trabajo WHERE ISNULL(finalizadototal,0)=0),
    pendientes_legacy_oficial = (
        SELECT COUNT(*) FROM metalurgica_db.dbo.otrabajo
        WHERE fc<>1 AND fechaentrega='1950-01-01' AND fecha>'2021-01-01'
          AND cantidade<cantidad AND ttt1<>1 AND suspendida=0
    );
