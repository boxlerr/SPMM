-- Stock mínimo por insumo y aviso cuando se perfora (RF-14)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-14) «alertar automáticamente cuando un insumo esté por debajo del
-- stock mínimo definido». El stock ya estaba: `pieza.stockactual` lo trae el sync del
-- sistema viejo. Lo que no existía era el MÍNIMO —nadie lo había definido nunca, ni
-- acá ni en el viejo— ni quién mirara la diferencia.
--
-- DE QUIÉN ES CADA DATO (y por qué esto no choca con el sync)
--
-- El 11/09 se decidió que el sistema viejo sigue siendo el dueño de las materias
-- primas. `stock_minimo` NO es un dato de la materia prima que el viejo tenga y SPMM
-- le pise: es un dato NUEVO, que sólo existe en SPMM, sobre qué nivel quiere vigilar
-- el pañol. Es el mismo razonamiento con el que entró `no_lleva_materia_prima` en la
-- OT: metadato de SPMM sobre un dato del viejo.
--
-- Y el sync no lo toca, verificado en el código (backend/scripts/sync_db.py, paso 7):
-- el upsert de `pieza` inserta sólo cod_pieza, descripcion, unitario, unidad y
-- stockactual, y al machear una pieza que ya existe actualiza SÓLO `stockactual`
-- (cols_update=["stockactual"]). Una pieza nueva que traiga el sync nace con las dos
-- columnas de acá en NULL, que es exactamente «sin mínimo, no se vigila».
--
-- LAS DOS COLUMNAS DE `pieza`
--
--   stock_minimo           el umbral. NULL = no se vigila (y es como arrancan TODAS:
--                          no se inventa un mínimo para nadie). 0 se puede cargar y
--                          quiere decir «avisame sólo si el stock queda negativo».
--   stock_bajo_avisado_en  cuándo se avisó que esta pieza quedó abajo del mínimo.
--                          NULL = no hay aviso vigente. Es el anti-duplicado: mientras
--                          la pieza siga abajo, el detector no vuelve a avisar; cuando
--                          el stock se recupera (o le sacan el mínimo) el detector la
--                          vuelve a NULL y la próxima vez que baje avisa de nuevo.
--
-- POR QUÉ EL ANTI-DUPLICADO VIVE EN LA PIEZA Y NO EN UN ÍNDICE ÚNICO
--
-- El aviso de OT retrasada (RF-04) se cuida con un índice único parcial: una OT se
-- retrasa una sola vez. Un insumo no: baja, se repone, vuelve a bajar, y cada bajada
-- merece su aviso. Un UNIQUE sobre la notificación impediría justamente eso. Lo que
-- sí hay que saber es si la bajada DE AHORA ya se avisó, y eso es un estado de la
-- pieza. Además, así la regla funciona igual en SQLite (tests), donde un índice
-- parcial de Postgres no existiría.
--
-- LA COLUMNA DE `notificacion`
--
--   id_pieza   de qué pieza habla el aviso. NULL = de ninguna. Sin FK a propósito,
--              mismo criterio que `id_orden_trabajo` (ver 2026-09-22_alerta_retraso_ot):
--              borrar una pieza no puede fallar por un aviso viejo que la nombra. Es lo
--              que hace que tocar el aviso en la campanita lleve a esa pieza.
--
-- Agrega:
--   pieza.stock_minimo            (DOUBLE PRECISION NULL; mismo tipo que stockactual)
--   pieza.stock_bajo_avisado_en   (TIMESTAMP NULL, hora local AR sin zona)
--   notificacion.id_pieza         (INTEGER NULL)
--
-- No reescribe ni borra ninguna fila: las columnas nacen en NULL para todas.
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE pieza
    ADD COLUMN IF NOT EXISTS stock_minimo DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS stock_bajo_avisado_en TIMESTAMP;

COMMENT ON COLUMN pieza.stock_minimo IS
    'Stock mínimo que el pañol quiere vigilar (RF-14). Dato de SPMM: el sistema viejo no '
    'lo tiene y el sync no lo toca. NULL = no se vigila, que es como arrancan todas; '
    'nunca se completa con un valor inventado. Se avisa cuando stockactual < stock_minimo.';

COMMENT ON COLUMN pieza.stock_bajo_avisado_en IS
    'Cuándo se avisó que la pieza quedó abajo del mínimo, en hora local del taller y sin '
    'zona. NULL = no hay aviso vigente. Lo escribe y lo limpia el detector de stock bajo: '
    'mientras siga abajo no se repite el aviso; cuando se recupera vuelve a NULL.';

ALTER TABLE notificacion
    ADD COLUMN IF NOT EXISTS id_pieza INTEGER;

COMMENT ON COLUMN notificacion.id_pieza IS
    'De qué pieza (materia prima) habla esta notificación. NULL = de ninguna. Sin FK a '
    'propósito: borrar una pieza no tiene que fallar por un aviso viejo. Es lo que hace '
    'que tocar el aviso de stock bajo lleve a esa pieza.';
