-- =============================================================================
-- Cleanup de SKILLS NATIVAS legacy (one-shot, opcional)
--
-- Contexto:
--   Antes del refactor "(skills) agregar SKILLS NATIVAS derivadas del rango"
--   (commit a4d5de7), las nativas se cargaban a mano como filas nivel=0 en
--   operario_proceso_skill. Hoy las nativas se DERIVAN de operario.rangos ×
--   rango_proceso y NO necesitan fila.
--
--   Las únicas filas nivel=0 que el sistema usa ahora son los OVERRIDES de
--   desactivación: nivel=0 AND habilitado=0 ("nativa apagada").
--   Las filas nivel=0 AND habilitado=1 son legacy redundantes.
--
-- ¿Es seguro borrarlas?
--   SÍ, es 100% neutral en comportamiento con el código actual:
--     * Planificador: get_map_por_proceso ya filtra nivel IN (1,2) → las nivel 0
--       no entran al mapa de skills.
--     * Perfil (_build_skills_payload): una nativa sin override se computa como
--       habilitado=True por defecto, idéntico a tener la fila legacy.
--   Borrarlas solo elimina filas redundantes; NO toca los overrides (habilitado=0)
--   ni las skills cargadas (nivel 1/2).
--
-- Pasos: 1) PREVIEW, 2) EJECUTAR (descomentar BEGIN TRAN/COMMIT), 3) VERIFICAR.
-- =============================================================================

-- =============================================================================
-- 1) PREVIEW: cuántas filas hay por nivel/estado
-- =============================================================================
SELECT
    legacy_nativas_a_borrar = (
        SELECT COUNT(*) FROM SMPP.dbo.operario_proceso_skill
        WHERE nivel = 0 AND habilitado = 1
    ),
    overrides_desactivacion_se_conservan = (
        SELECT COUNT(*) FROM SMPP.dbo.operario_proceso_skill
        WHERE nivel = 0 AND habilitado = 0
    ),
    skills_cargadas_se_conservan = (
        SELECT COUNT(*) FROM SMPP.dbo.operario_proceso_skill
        WHERE nivel IN (1, 2)
    );

-- =============================================================================
-- 2) EJECUTAR: descomentar el bloque
-- =============================================================================
-- BEGIN TRAN;
--
-- DELETE FROM SMPP.dbo.operario_proceso_skill
-- WHERE nivel = 0 AND habilitado = 1;
--
-- -- Verificar antes de commitear: deberían quedar 0 filas nivel=0 habilitado=1
-- SELECT COUNT(*) AS legacy_restantes
-- FROM SMPP.dbo.operario_proceso_skill
-- WHERE nivel = 0 AND habilitado = 1;
--
-- COMMIT;  -- o ROLLBACK;

-- =============================================================================
-- 3) VERIFICAR: distribución final por nivel/estado
-- =============================================================================
SELECT nivel, habilitado, COUNT(*) AS cantidad
FROM SMPP.dbo.operario_proceso_skill
GROUP BY nivel, habilitado
ORDER BY nivel, habilitado;
