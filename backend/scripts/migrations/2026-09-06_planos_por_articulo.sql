-- Planos colgados del ARTÍCULO, no solo de la OT
-- Fecha: 2026-09-06
-- Base: Supabase (Postgres) — desde el cutover del 28/07 la producción corre acá.
-- Pedido: el taller tiene ~600 planos de productos en Drive, uno por artículo, y hoy
--         no hay dónde ponerlos: `plano` solo sabe colgar de una orden de trabajo.
--         Cargar el mismo PDF en cada OT del mismo artículo es guardar el archivo
--         cientos de veces y volver a subirlo cada vez que se abre una OT nueva. El
--         plano es del producto: se carga una vez y lo ven todas las OTs de ese
--         artículo.
--
-- Agrega:
--   plano.id_articulo       (INTEGER NULL, FK -> articulo.id) — el plano del producto.
--   plano.drive_file_id     (VARCHAR(120) NULL) — id del archivo en Google Drive.
--   plano.drive_md5         (VARCHAR(64) NULL)  — checksum que devuelve Drive.
--   plano.drive_modificado  (TIMESTAMP NULL)    — última modificación en Drive.
--
-- Cambia:
--   plano.id_orden_trabajo pasa a NULLABLE. Un plano de artículo no cuelga de
--   ninguna OT, y hasta ahora la columna era obligatoria.
--
-- Los tres campos `drive_*` existen para poder REIMPORTAR la carpeta sin duplicar:
-- el importador busca por drive_file_id (índice único parcial), y si el md5 cambió
-- reemplaza el archivo de esa misma fila en vez de crear otra. Sin eso, cada corrida
-- del importador sumaría 600 planos más.
--
-- `ck_plano_destino` es la red de seguridad de que la columna se haya vuelto
-- nullable: un plano tiene que colgar de algo, de la OT o del artículo, pero no
-- puede quedar suelto porque no lo encontraría nadie.
--
-- Idempotente: se puede correr más de una vez sin error.
--
-- IMPORTANTE:
--   - Correr ESTA migración ANTES de desplegar el código nuevo. El ORM mapea las
--     columnas nuevas (backend/domain/Plano.py) y, si no existen, rompe al leer
--     cualquier plano — el mismo cuidado que pidió id_operario en
--     2026-08-26_operario_en_proceso.sql.
--   - Hoy `plano` tiene 0 filas en producción, así que no hay backfill ni riesgo de
--     que el CHECK falle sobre datos viejos.
--   - El sync (backend/scripts/sync_db.py) no toca esta tabla: los planos se cargan
--     en SPMM, no vienen del legacy.

ALTER TABLE plano
    ADD COLUMN IF NOT EXISTS id_articulo INTEGER;

ALTER TABLE plano
    ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(120);

ALTER TABLE plano
    ADD COLUMN IF NOT EXISTS drive_md5 VARCHAR(64);

ALTER TABLE plano
    ADD COLUMN IF NOT EXISTS drive_modificado TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_plano_articulo'
    ) THEN
        ALTER TABLE plano
            ADD CONSTRAINT fk_plano_articulo
            FOREIGN KEY (id_articulo) REFERENCES articulo(id);
    END IF;
END $$;

-- Para volver nullable una columna no hay IF NOT EXISTS: se pregunta primero.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'plano'
          AND column_name = 'id_orden_trabajo'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE plano ALTER COLUMN id_orden_trabajo DROP NOT NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_plano_destino'
    ) THEN
        ALTER TABLE plano
            ADD CONSTRAINT ck_plano_destino
            CHECK (id_articulo IS NOT NULL OR id_orden_trabajo IS NOT NULL);
    END IF;
END $$;

-- Para la pantalla de la OT, que pregunta si el artículo tiene plano.
CREATE INDEX IF NOT EXISTS ix_plano_articulo
    ON plano (id_articulo)
    WHERE id_articulo IS NOT NULL;

-- Único: es lo que evita que reimportar la carpeta de Drive duplique todo. Parcial
-- porque los planos cargados a mano no tienen archivo en Drive y quedan en NULL —
-- si el índice fuera total, el segundo plano manual chocaría con el primero.
CREATE UNIQUE INDEX IF NOT EXISTS ix_plano_drive_file_id
    ON plano (drive_file_id)
    WHERE drive_file_id IS NOT NULL;
