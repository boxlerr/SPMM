-- Las huellas del sync: para no correrlo entero cuando no cambió nada
-- Fecha: 2026-09-25
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Julián, el 25/09: «hacelo cada 10 min al sync, y que funcione sólo si hay un cambio en
-- el Integral». Cada pasada del sync (Cloud Scheduler) corría todo aunque nadie hubiera
-- tocado nada: clientes, artículos, el espejo de la materia prima (unos 9 s leyendo el
-- Integral entero y SPMM entero) y el aviso de desfasaje. Ahora cada pasada arranca con dos
-- consultas baratas, una HUELLA del Integral (lo que el sync lee) y otra de SPMM (lo que
-- el sync y el espejo escriben), y las compara con las de la última pasada completa que
-- salió bien. Si son iguales, no hace nada más (backend/scripts/sync_huella.py).
--
-- La de SPMM está para que el sync se cure solo: si algo escribe en las tablas del espejo
-- sin que haya cambiado el Integral (el backend viejo de Render, si se despierta, corre un
-- sync de antes del 23/09 que inventa las marcas de la materia prima), la huella cambia,
-- la pasada siguiente corre entera, restituye lo del Integral y lo avisa en el log.
--
-- CÓMO
--
-- Una fila (clave 'sync'). Las huellas van como texto (un JSON de tabla → conteo y suma):
-- sólo se comparan, y así una tabla más no pide otra migración. Se escriben al final de
-- una pasada completa que salió bien; si la pasada falla, no se tocan (la siguiente corre
-- entera). Sin fila, o con la tabla vacía, el sync corre entero: nunca saltea por falta
-- de datos.
--
-- Crea:
--   sync_estado
-- No toca ninguna fila existente ni ninguna columna de otra tabla. Borrar la fila (o la
-- tabla) no rompe nada: la pasada siguiente corre entera y la vuelve a escribir.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS sync_estado (
    clave TEXT PRIMARY KEY,
    huella_integral TEXT,
    huella_spmm TEXT,
    ultima_completa TIMESTAMP,
    actualizado_en TIMESTAMP
);

COMMENT ON TABLE sync_estado IS
    'Las huellas de la última pasada completa del sync (backend/scripts/sync_huella.py). '
    'Si al empezar una pasada las dos son iguales a éstas, el sync no hace nada más. La '
    'escribe sólo el sync; borrarla hace que la pasada siguiente corra entera.';

COMMENT ON COLUMN sync_estado.huella_integral IS
    'JSON tabla del Integral → filas, CHECKSUM_AGG y suma de un MD5 por fila de las '
    'columnas que lee el sync, leída al EMPEZAR la última pasada completa que salió bien.';

COMMENT ON COLUMN sync_estado.huella_spmm IS
    'JSON tabla de SPMM → filas y suma de un hash de cada fila (las columnas que escriben '
    'el sync y el espejo), leída al TERMINAR esa pasada: lo que quedó escrito. De OT, '
    'clientes y artículos que cambiaron mientras corría, la de al empezar, para que la '
    'siguiente corra entera.';

COMMENT ON COLUMN sync_estado.ultima_completa IS
    'Cuándo empezó la última pasada completa que salió bien, hora local del taller sin '
    'zona. Pasadas RED_DE_SEGURIDAD (3 h) desde acá, se corre entera aunque nada cambie.';

COMMENT ON COLUMN sync_estado.actualizado_en IS
    'La última vez que el sync miró, haya corrido entero o no (hora local sin zona). Si '
    'se queda quieta, el Cloud Scheduler dejó de llamar.';
