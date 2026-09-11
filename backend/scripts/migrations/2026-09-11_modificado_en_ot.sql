-- Quién y cuándo tocó una OT por última vez
-- Fecha: 2026-09-11
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- `orden_trabajo` no guardaba NADA sobre su propia edición. Los procesos sí —desde
-- el 10/09 cada cambio deja una foto en orden_trabajo_proceso_version—, pero la
-- cabecera (cliente, fechas, unidades, observaciones) se podía cambiar entera sin
-- que quedara rastro: la OT aparecía con otra fecha prometida y no había forma de
-- contestar la única pregunta que se hace en ese momento, que es quién la cambió.
--
-- Es el mismo agujero que se tapó en la planificación el 10/09 (planificacion_borrada
-- sin usuario, 105 filas desaparecidas y nadie a quién preguntarle), y se tapa igual.
--
-- POR QUÉ NULL NO ES "SE DESCONOCE"
--
-- Casi todas las OT de la base las trajo el sistema viejo, y el viejo no tiene este
-- dato. Para esas, NULL quiere decir "nunca se tocó desde SPMM" —una afirmación, no
-- una laguna—: si alguien la hubiera editado acá, estas dos columnas estarían
-- escritas. Por eso las columnas van NULL y sin default: un default (NOW(), o un
-- 'sistema') convertiría 1.400 órdenes importadas en 1.400 modificaciones que nunca
-- ocurrieron, y una auditoría que miente es peor que no tenerla.
--
-- El sync y los scripts de migración NO las escriben, por la misma razón: que el
-- legacy pise una OT importada no es una persona modificándola. El repositorio
-- tiene una forma explícita de no estampar (update(..., estampar=False)).
--
-- `modificado_por` guarda el NOMBRE, no el id de usuario: es lo que se muestra y lo
-- que se entiende seis meses después, aunque el usuario ya no exista. Mismo criterio
-- que planificacion_intento.usuario. Si no se sabe quién fue, queda NULL — nunca un
-- autor inventado.
--
-- Agrega:
--   orden_trabajo.modificado_en  (TIMESTAMP NULL, hora local AR)
--   orden_trabajo.modificado_por (VARCHAR(120) NULL)
--
-- Idempotente: se puede correr las veces que haga falta. Además se aplica sola al
-- levantar el backend (backend/infrastructure/migraciones.py), porque el deploy a
-- Cloud Run es a mano y el modelo ya declara estas columnas: si la base no las
-- tiene, se cae la lectura de TODAS las OT, no sólo el dato nuevo.

ALTER TABLE orden_trabajo
    ADD COLUMN IF NOT EXISTS modificado_en  TIMESTAMP,
    ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(120);

COMMENT ON COLUMN orden_trabajo.modificado_en IS
    'Cuándo se modificó la OT por última vez DESDE SPMM, en hora local de Argentina '
    '(sin zona, como todas las fechas de esta base). NULL significa "nunca se tocó '
    'desde SPMM" —es el caso de las OT que trajo el sistema viejo— y no "se '
    'desconoce cuándo": si alguien la hubiera editado acá, estaría escrita.';

COMMENT ON COLUMN orden_trabajo.modificado_por IS
    'Nombre de la persona que hizo la última modificación desde SPMM. NULL significa '
    '"no lo hizo nadie desde SPMM", o que el cambio entró por una puerta que no pudo '
    'identificar al usuario: antes que inventar un autor, se deja vacío. El sync y '
    'los scripts que pisan OT importadas no la escriben nunca, porque una máquina '
    'sincronizando no es una persona modificando.';

-- "¿Qué se tocó hoy?" es la consulta que justifica la columna. Parcial porque las OT
-- importadas y nunca editadas son la mayoría y no aportan nada al índice.
CREATE INDEX IF NOT EXISTS ix_orden_trabajo_modificado_en
    ON orden_trabajo (modificado_en DESC)
    WHERE modificado_en IS NOT NULL;
