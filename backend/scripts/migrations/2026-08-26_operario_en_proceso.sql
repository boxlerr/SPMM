-- Operario preseleccionado por proceso de una OT
-- Fecha: 2026-08-26
-- Base: Supabase (Postgres) — desde el cutover del 28/07 la producción corre acá.
-- Pedido: Lucas, 26/08/2026 — "en orden, al crear trabajo, falta persona en proceso".
--         El alta de OT deja elegir proceso, minutos, MÁQUINA y cantidad de empleados,
--         pero no quién lo hace. La máquina ya tenía su preselección desde julio; esto
--         es exactamente lo mismo para la persona.
--
-- Agrega:
--   orden_trabajo_proceso.id_operario (INTEGER NULL, FK -> operario.id)
--     · NULL  = sin preselección: el planificador elige la persona (lo de hoy).
--     · <id>  = preselección: se fuerza ese proceso a esa persona.
--
-- Idempotente: se puede correr más de una vez sin error.
--
-- IMPORTANTE:
--   - Correr ESTA migración ANTES de desplegar el código nuevo. El modelo mapea la
--     columna y, si no existe, el ORM rompe al leer procesos — el mismo cuidado que
--     pidió id_maquinaria en 2026-07-05_maquina_en_proceso.sql.
--   - Es NULLABLE y sin default: las filas existentes quedan en NULL, o sea que el
--     comportamiento no cambia para nada de lo ya cargado.
--   - El sync (backend/scripts/sync_db.py) NO la toca: su MERGE no la nombra, igual
--     que cant_operarios y id_maquinaria. La persona elegida en SPMM no se pisa cada
--     5 minutos con lo que venga del legacy.

ALTER TABLE orden_trabajo_proceso
    ADD COLUMN IF NOT EXISTS id_operario INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_otp_operario'
    ) THEN
        ALTER TABLE orden_trabajo_proceso
            ADD CONSTRAINT fk_otp_operario
            FOREIGN KEY (id_operario) REFERENCES operario(id);
    END IF;
END $$;

-- Para la consulta del planificador, que lee los procesos de las OTs elegidas.
CREATE INDEX IF NOT EXISTS ix_otp_operario
    ON orden_trabajo_proceso (id_operario)
    WHERE id_operario IS NOT NULL;
