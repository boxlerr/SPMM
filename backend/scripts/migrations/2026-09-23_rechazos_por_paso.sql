-- Rechazos por paso y por persona (RF-12, segunda parte)
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- En la reunión del 23/09 Lucas explicó qué quiere del registro de no conformidades:
-- «si algo se rechazó, que quede el registro de que tuviste 10 piezas que se
-- rechazaron. Entonces, ¿quién la hizo? Tal empleado. Le tengo que llamar la
-- atención». La tabla `incidencia_proceso` ya es ese registro (2026-09-22_no_conformidades.sql)
-- y ya tiene a la persona (`id_operario`) y las piezas (`piezas_afectadas`). Le faltan
-- tres cosas para poder cargarlo desde donde pasa, que es el control de la OT:
--
--   · en qué PASO de la OT se rechazó. La pasada (orden_trabajo_proceso.id) y no el
--     proceso, porque el mismo proceso puede ir varias veces en una orden y «el torno»
--     no dice cuál de las trece veces. `id_proceso` se sigue llenando con el proceso de
--     ese paso: si el paso se saca de la OT, queda al menos qué trabajo era;
--   · de cuántas piezas CONTROLADAS salieron las rechazadas (10 de 50 no es lo mismo
--     que 10 de 10);
--   · qué se hace con lo rechazado: se retrabaja, se descarta, se acepta con concesión
--     o se devuelve al proveedor.
--
-- POR QUÉ `id_otp` NO TIENE FK
--
-- Mismo criterio que notificacion.id_orden_trabajo: sacar un paso de la OT (se hace
-- todos los días desde el plan y desde la ficha) no puede fallar por una no conformidad
-- vieja, y un ON DELETE que la borre se llevaría el registro de calidad. Si el paso se
-- borra, el número queda apuntando a nada y la pantalla muestra el proceso.
--
-- TODO NULLABLE Y SIN DEFAULT
--
-- Las filas que ya están no tienen ninguno de los tres datos porque no existían en
-- pantalla. NULL es «no se registró»: completarlos sería inventar. No se reescribe
-- ninguna fila.
--
-- Agrega:
--   incidencia_proceso.id_otp              (BIGINT NULL)
--   incidencia_proceso.piezas_controladas  (INTEGER NULL)
--   incidencia_proceso.disposicion         (VARCHAR(30) NULL)
--   ix_incidencia_operario — los rechazos de una persona (su ficha y el agrupado por
--                            persona de No conformidades), lo último primero
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE incidencia_proceso
    ADD COLUMN IF NOT EXISTS id_otp BIGINT,
    ADD COLUMN IF NOT EXISTS piezas_controladas INTEGER,
    ADD COLUMN IF NOT EXISTS disposicion VARCHAR(30);

COMMENT ON COLUMN incidencia_proceso.id_otp IS 'En qué paso de la OT se rechazó: orden_trabajo_proceso.id, la pasada y no el proceso (el mismo proceso puede ir varias veces en una orden). NULL = no se dijo, o se cargó antes del 23/09/2026. Sin FK a propósito: sacar un paso de la OT no tiene que fallar por una no conformidad vieja; id_proceso sigue diciendo qué trabajo era.';

COMMENT ON COLUMN incidencia_proceso.piezas_controladas IS 'De cuántas piezas controladas salieron las rechazadas (piezas_afectadas). NULL = no se dijo; nunca se completa con las unidades de la OT, porque no siempre se controla todo.';

COMMENT ON COLUMN incidencia_proceso.disposicion IS 'Qué se hace con lo rechazado: RETRABAJO, DESCARTE, CONCESION (se acepta con concesión) o DEVOLUCION_PROVEEDOR. NULL = todavía no se decidió. No es la acción correctiva: ésta dice qué se hizo para que no vuelva a pasar.';

CREATE INDEX IF NOT EXISTS ix_incidencia_operario
    ON incidencia_proceso (id_operario, fecha_registro DESC)
    WHERE id_operario IS NOT NULL;
