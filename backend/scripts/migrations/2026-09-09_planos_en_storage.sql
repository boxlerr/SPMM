-- Los archivos de los planos se van a Supabase Storage
-- Fecha: 2026-09-09
-- Base: Supabase (Postgres).
-- Pedido: el archivo del plano estaba guardado como BLOB adentro de la tabla. Con los
--         ~600 planos del primer import eso pesaba 600 MB y entraba; con la biblioteca
--         completa del taller (5341 carpetas de producto en Drive, 2,6 GB de PDF y
--         fotos, más los DXF/SolidWorks que faltan) el disco de la base no es el lugar:
--           · el plan Pro incluye 8 GB de DISCO de base y cobra US$0,125 por GB extra;
--           · el mismo plan incluye 100 GB de STORAGE y cobra US$0,0213 por GB extra.
--         Seis veces más barato, y además saca del camino del pooler un blob de varios
--         MB por cada plano que alguien abre.
--
-- Agrega:
--   plano.storage_path (VARCHAR(400) NULL) — ruta del objeto dentro del bucket `planos`.
--   plano.tamano       (INTEGER NULL)      — bytes del archivo.
--
-- Cambia:
--   plano.archivo pasa a NULLABLE.
--
-- POR QUÉ `tamano` Y NO seguir midiendo el blob: los listados muestran el peso del
-- archivo (y el front decide con eso si vale la pena bajarlo para dibujar la miniatura).
-- Eso salía de octet_length(archivo); con el archivo afuera de la base, si no se guarda
-- el tamaño, no hay forma de saberlo sin ir a buscar el objeto a Storage por cada fila
-- del listado. Se llena para todos en la migración de datos.
--
-- POR QUÉ `archivo` QUEDA (nullable) Y NO SE BORRA: la columna sigue siendo el camino
-- de los planos que ya estaban antes de mover nada, y el código lee storage_path
-- primero y cae al blob si no hay. Eso permite migrar los archivos en tandas, con la
-- app andando, sin una ventana donde un plano no se puede abrir. Cuando
-- `migrar_planos_a_storage` deje 0 filas con archivo, se puede borrar la columna en
-- otra migración —y recién ahí conviene el VACUUM FULL, porque el espacio de un bytea
-- no vuelve solo—.
--
-- El bucket `planos` es PRIVADO: los planos son dibujos de clientes. El backend los
-- sirve por /planos/{id}/archivo como siempre, leyendo el objeto con la clave secreta
-- del proyecto. Ninguna URL de Storage llega al navegador.

BEGIN;

ALTER TABLE plano ADD COLUMN IF NOT EXISTS storage_path VARCHAR(400);
ALTER TABLE plano ADD COLUMN IF NOT EXISTS tamano INTEGER;

-- El tamaño de los que ya están, mientras el blob todavía se puede medir.
UPDATE plano SET tamano = octet_length(archivo) WHERE tamano IS NULL AND archivo IS NOT NULL;

ALTER TABLE plano ALTER COLUMN archivo DROP NOT NULL;

-- Un plano tiene que tener el archivo en algún lado: adentro (blob) o afuera (Storage).
-- Sin esto, un bug que se olvide de subir el objeto deja una fila que se lista, se abre
-- y no muestra nada.
ALTER TABLE plano DROP CONSTRAINT IF EXISTS ck_plano_tiene_archivo;
ALTER TABLE plano ADD CONSTRAINT ck_plano_tiene_archivo
    CHECK (archivo IS NOT NULL OR storage_path IS NOT NULL);

-- Para no subir dos veces el mismo objeto y para poder ir de un objeto huérfano del
-- bucket a su fila.
CREATE UNIQUE INDEX IF NOT EXISTS ux_plano_storage_path
    ON plano (storage_path) WHERE storage_path IS NOT NULL;

COMMIT;
