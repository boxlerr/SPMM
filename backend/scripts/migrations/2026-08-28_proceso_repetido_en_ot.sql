-- El mismo proceso, varias veces en una OT
-- Fecha: 2026-08-28
-- Base: Supabase (Postgres) — desde el cutover del 28/07 la producción corre acá.
-- Pedido: Julián, 28/08/2026 — "hay que copiar los procesos tal cual las filas".
--
-- POR QUÉ
--   El legacy carga una fila por PASADA: la OT 7497 tiene TORNO CNC en 13 pasadas
--   distintas (pasos 2, 3, 6, 7, 9, 10, 11, 13, 15, 19, 21, 22, 23), intercaladas con
--   los otros procesos. En SPMM eso no entraba: la PK de orden_trabajo_proceso era
--   (id_orden_trabajo, id_proceso), o sea UNA sola fila por proceso y por OT. La
--   migración de julio se comía las repetidas al chocar contra la PK y el script de
--   agosto (migrar_procesos_faltantes.py) las sumaba en una sola línea.
--
--   Medido contra el legacy el 28/08: 43 OTs abiertas con procesos repetidos, 158
--   filas que no existían en SPMM y ~11.912 minutos que el planificador no veía.
--
--   Si el taller cargó 13 veces el CNC es porque así trabaja. No se toca el dato: se
--   copia como está y ellos deciden al planificar.
--
-- QUÉ HACE
--   1. orden_trabajo_proceso.id  — PK propia (BIGSERIAL). La fila pasa a tener
--      identidad propia; (id_orden_trabajo, id_proceso) deja de ser única.
--   2. planificacion.id_orden_trabajo_proceso — a qué PASADA corresponde la fila del
--      plan. Sin esto, dos pasadas del mismo proceso en la misma OT dan dos filas de
--      plan indistinguibles.
--
-- OJO CON `orden`
--   NO se le pone único a (id_orden_trabajo, orden): hoy hay 263 grupos / 531 filas
--   que ya comparten paso (ej. la OT 7533 tiene 3 procesos en el paso 1). Ponerle
--   único obligaría a renumerar procesos del cliente, y eso no se toca. El
--   planificador deja de indexar por `orden` y pasa a indexar por esta PK nueva
--   (ver PlanificacionService._clave_linea).
--
-- Idempotente: se puede correr más de una vez sin error.
--
-- IMPORTANTE: correr ANTES de desplegar el código nuevo. El modelo mapea las dos
-- columnas y, si no existen, el ORM rompe al leer procesos — mismo cuidado que
-- pidieron 2026-07-05_maquina_en_proceso.sql y 2026-08-26_operario_en_proceso.sql.

-- ---------------------------------------------------------------------------
-- 1) id propio en orden_trabajo_proceso
-- ---------------------------------------------------------------------------
-- BIGSERIAL en ADD COLUMN numera solo las filas que ya están (reescribe la tabla).
ALTER TABLE orden_trabajo_proceso
    ADD COLUMN IF NOT EXISTS id BIGSERIAL;

DO $$
BEGIN
    -- La PK vieja (id_orden_trabajo, id_proceso) es justo lo que impide repetir.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orden_trabajo_proceso_pkey'
          AND conrelid = 'orden_trabajo_proceso'::regclass
          AND array_length(conkey, 1) = 2
    ) THEN
        ALTER TABLE orden_trabajo_proceso DROP CONSTRAINT orden_trabajo_proceso_pkey;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orden_trabajo_proceso_pkey'
          AND conrelid = 'orden_trabajo_proceso'::regclass
    ) THEN
        ALTER TABLE orden_trabajo_proceso
            ADD CONSTRAINT orden_trabajo_proceso_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- La PK vieja también servía de índice para buscar los procesos de una OT y para
-- las FKs; al soltarla hay que reponer los índices a mano.
CREATE INDEX IF NOT EXISTS ix_otp_orden_trabajo
    ON orden_trabajo_proceso (id_orden_trabajo);

CREATE INDEX IF NOT EXISTS ix_otp_orden_proceso
    ON orden_trabajo_proceso (id_orden_trabajo, id_proceso);

-- ---------------------------------------------------------------------------
-- 2) planificacion: a qué pasada corresponde cada fila del plan
-- ---------------------------------------------------------------------------
ALTER TABLE planificacion
    ADD COLUMN IF NOT EXISTS id_orden_trabajo_proceso BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_planificacion_otp'
    ) THEN
        ALTER TABLE planificacion
            ADD CONSTRAINT fk_planificacion_otp
            FOREIGN KEY (id_orden_trabajo_proceso)
            REFERENCES orden_trabajo_proceso(id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_planificacion_otp
    ON planificacion (id_orden_trabajo_proceso)
    WHERE id_orden_trabajo_proceso IS NOT NULL;

-- Backfill del plan que ya está guardado: mientras no hubo repetidos, el par
-- (orden_id, proceso_id) alcanza para saber de qué fila hablaba. Se completa sólo
-- donde no hay ambigüedad; si mañana hay dos pasadas, el plan viejo queda en NULL y
-- se resuelve al replanificar (que es lo que corresponde: ese plan es de antes).
UPDATE planificacion p
   SET id_orden_trabajo_proceso = o.id
  FROM orden_trabajo_proceso o
 WHERE p.id_orden_trabajo_proceso IS NULL
   AND o.id_orden_trabajo = p.orden_id
   AND o.id_proceso = p.proceso_id
   AND (SELECT COUNT(*) FROM orden_trabajo_proceso x
         WHERE x.id_orden_trabajo = p.orden_id AND x.id_proceso = p.proceso_id) = 1;

-- ---------------------------------------------------------------------------
-- Para revertir (sólo tiene sentido si todavía NO se copiaron las filas repetidas;
-- con repetidas cargadas, volver a la PK vieja falla por duplicados, que es
-- justamente el punto):
--   ALTER TABLE planificacion DROP CONSTRAINT fk_planificacion_otp;
--   ALTER TABLE planificacion DROP COLUMN id_orden_trabajo_proceso;
--   ALTER TABLE orden_trabajo_proceso DROP CONSTRAINT orden_trabajo_proceso_pkey;
--   ALTER TABLE orden_trabajo_proceso DROP COLUMN id;
--   ALTER TABLE orden_trabajo_proceso
--       ADD CONSTRAINT orden_trabajo_proceso_pkey PRIMARY KEY (id_orden_trabajo, id_proceso);
-- ---------------------------------------------------------------------------
