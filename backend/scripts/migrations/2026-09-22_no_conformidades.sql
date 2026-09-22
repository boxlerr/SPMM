-- No conformidades asociadas a las órdenes (RF-12)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-12) generar reportes de no conformidades y asociarlos a la orden que
-- corresponde. En la app eso ya existía a medias con otro nombre: la tabla
-- `incidencia_proceso`, que nació el 25/06 para una sola pregunta —«¿cuánto tiempo se
-- perdió porque alguien no interpretó un plano?»— y que ya cuelga de la orden por
-- `id_orden_trabajo`.
--
-- Así que no se crea ninguna tabla nueva: se le agrega a esa lo que le falta para ser
-- el registro de calidad que el RF pide. Una tabla nueva significaría dos lugares donde
-- buscar lo mismo, y habría que decidir qué pasa con lo ya cargado.
--
-- Lo que faltaba es lo que hace que un renglón sirva para el que revisa calidad y no
-- sólo para el que mira productividad:
--   · qué tan grave fue (hoy todas pesan igual),
--   · si está abierta o ya se resolvió (hoy una NC resuelta queda abierta para siempre),
--   · cuántas piezas salieron afectadas,
--   · qué se hizo al respecto,
--   · quién la reportó y cuándo se cerró.
--
-- POR QUÉ `gravedad` Y `piezas_afectadas` ADMITEN NULL
--
-- Son los dos únicos datos que alguien tiene que JUZGAR. Las filas que ya están cargadas
-- se hicieron sin ese campo en pantalla: ponerles 'MEDIA' y 0 por default sería escribir
-- una evaluación que nadie hizo, y después nadie podría distinguir la que evaluaron de
-- la que completó la migración. Con NULL la pantalla las muestra como «sin clasificar»,
-- que es la verdad. Misma regla que el «sin registrar» de Auditoría.
--
-- `estado`, en cambio, sí va NOT NULL DEFAULT 'ABIERTA': que una NC vieja nunca se cerró
-- no es una opinión, es un hecho —no existía la forma de cerrarla—.
--
-- OJO CON EL TIPO DE LAS COLUMNAS VIEJAS
--
-- El .sql que creó esta tabla (2026-06-25_planos_habilidad_incidencias.sql) está escrito
-- en SQL Server y NO es lo que corre en producción: en Supabase la tabla la creó
-- `Base.metadata.create_all` desde el modelo (backend/scripts/migrate_to_supabase.py).
-- La fuente de verdad de los tipos es el modelo ORM, no aquel archivo.
--
-- LAS FECHAS VIEJAS ESTÁN EN UTC
--
-- `fecha_registro` se venía estampando con `datetime.utcnow`, contra la convención de la
-- casa (hora local AR, sin zona). Desde hoy se estampa con la hora del taller, así que
-- conviven filas con 3 horas de corrimiento: una incidencia cargada 22:30 figura al día
-- siguiente. NO se reescriben acá: es dato del cliente y un UPDATE masivo sobre fechas
-- ya cargadas se decide con él, no de este lado.
--
-- Agrega:
--   incidencia_proceso.gravedad          (VARCHAR(10) NULL)
--   incidencia_proceso.estado            (VARCHAR(10) NOT NULL DEFAULT 'ABIERTA')
--   incidencia_proceso.piezas_afectadas  (INTEGER NULL)
--   incidencia_proceso.accion_correctiva (TEXT NULL)
--   incidencia_proceso.id_usuario        (INTEGER NULL)
--   incidencia_proceso.usuario           (VARCHAR(120) NULL)
--   incidencia_proceso.fecha_cierre      (TIMESTAMP NULL)
--   ix_incidencia_ot     — las NC de una orden, lo último primero
--   ix_incidencia_estado — el reporte abre filtrado por «abiertas»
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE incidencia_proceso
    ADD COLUMN IF NOT EXISTS gravedad VARCHAR(10),
    ADD COLUMN IF NOT EXISTS estado VARCHAR(10) NOT NULL DEFAULT 'ABIERTA',
    ADD COLUMN IF NOT EXISTS piezas_afectadas INTEGER,
    ADD COLUMN IF NOT EXISTS accion_correctiva TEXT,
    ADD COLUMN IF NOT EXISTS id_usuario INTEGER,
    ADD COLUMN IF NOT EXISTS usuario VARCHAR(120),
    ADD COLUMN IF NOT EXISTS fecha_cierre TIMESTAMP;

COMMENT ON COLUMN incidencia_proceso.gravedad IS
    'Qué tan grave fue: LEVE, MEDIA o GRAVE. NULL = sin clasificar, que es como quedan '
    'las cargadas antes del 22/09/2026, cuando el campo no existía en pantalla. Nunca '
    'se completa por default: sería inventar una evaluación que nadie hizo.';

COMMENT ON COLUMN incidencia_proceso.estado IS
    'ABIERTA o CERRADA. Arranca ABIERTA y sólo pasa a CERRADA cuando alguien la cierra '
    'desde la pantalla, que es además cuando se llena fecha_cierre. Las viejas quedan '
    'ABIERTA porque nunca existió la forma de cerrarlas: eso es un hecho, no un default.';

COMMENT ON COLUMN incidencia_proceso.piezas_afectadas IS
    'Cuántas piezas salieron afectadas. NULL = no se registró, que NO es lo mismo que 0 '
    '(ninguna): la diferencia importa para contar rechazos.';

COMMENT ON COLUMN incidencia_proceso.accion_correctiva IS
    'Qué se hizo para resolverla, en texto libre. NULL = todavía nada.';

COMMENT ON COLUMN incidencia_proceso.id_usuario IS
    'Quién la reportó, tomado del token. NULL = no se registró (las anteriores al '
    '22/09/2026 y las que entren por script); nunca un autor inventado.';

COMMENT ON COLUMN incidencia_proceso.usuario IS
    'Nombre y apellido de quien la reportó, congelado al momento de reportarla: si '
    'después se renombra el usuario, el registro de calidad tiene que seguir diciendo '
    'lo que decía.';

COMMENT ON COLUMN incidencia_proceso.fecha_cierre IS
    'Cuándo se cerró, en hora local del taller y sin zona (como todas las fechas de '
    'esta base). NULL mientras siga abierta.';

CREATE INDEX IF NOT EXISTS ix_incidencia_ot
    ON incidencia_proceso (id_orden_trabajo, fecha_registro DESC);

CREATE INDEX IF NOT EXISTS ix_incidencia_estado
    ON incidencia_proceso (estado, fecha_registro DESC);
