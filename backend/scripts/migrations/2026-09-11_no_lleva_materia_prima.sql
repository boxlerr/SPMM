-- "Esta orden no lleva materia prima"
-- Fecha: 2026-09-11
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Decisión de Julián (11/09): el sistema viejo SIGUE siendo el dueño de las materias
-- primas y el sync las sigue trayendo cada media hora. O sea que la solapa de la OT
-- pasa a ser de sólo lectura: acá se miran, allá se cargan.
--
-- Pero quedaba adentro de esa solapa una casilla «NO LLEVA MATERIAS PRIMAS» que no
-- guardaba en ningún lado. Y hace falta, porque sin ella la columna Material no puede
-- distinguir DOS COSAS OPUESTAS:
--
--   sin_datos   → nadie cargó la lista. Hay que ir a cargarla.
--   no lleva    → esta pieza no necesita material. Hay que saltearla.
--
-- Es exactamente el mismo problema que se resolvió el 10/09 con los planos, donde
-- `tiene_plano = 0` tapaba «falta» y «no lleva», y por el mismo motivo se resuelve
-- igual: una columna propia. Hoy hay 17 OT abiertas en `sin_datos` y no hay forma de
-- saber cuáles de esas 17 están esperando que alguien cargue algo.
--
-- POR QUÉ UNA COLUMNA NUESTRA Y NO UN CAMPO DEL VIEJO
--
-- Porque no choca con la decisión de arriba. `orden_trabajo_pieza` la escribe el sync
-- y no se toca; esto es metadato de SPMM sobre la orden, que el sync no mira ni pisa.
-- Es la única parte de materias primas que puede ser nuestra sin discutir con nadie.
--
-- Agrega:
--   orden_trabajo.no_lleva_materia_prima (SMALLINT NOT NULL DEFAULT 0)
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE orden_trabajo
    ADD COLUMN IF NOT EXISTS no_lleva_materia_prima SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN orden_trabajo.no_lleva_materia_prima IS
    'El taller marcó que esta orden NO necesita materia prima. Distinto de no tener '
    'ninguna fila en orden_trabajo_pieza, que sólo dice que nadie cargó la lista. '
    'La escribe SPMM; el sync del sistema viejo no la toca.';

-- Para el filtro "mostrame las que hay que ir a cargar": las que no tienen ninguna
-- pieza y tampoco están marcadas como que no lleva. Parcial porque es el único caso
-- que se consulta y así el índice queda chico.
CREATE INDEX IF NOT EXISTS ix_orden_trabajo_falta_material
    ON orden_trabajo (id)
    WHERE COALESCE(no_lleva_materia_prima, 0) = 0;
