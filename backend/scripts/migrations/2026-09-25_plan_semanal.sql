-- El plan semanal del Sistema Integral: qué OT se programaron cada semana
-- Fecha: 2026-09-25
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- En el Integral, «Semana del …» de la pantalla de Pendientes de compra muestra las
-- materias primas de las OT de dbo.plansemanal con ese lunes: un plan semanal que el
-- taller carga a mano y que sigue vivo (55 a 93 OT por semana en 2026). La reunión con
-- Lucas pidió que Maxi elija la semana en Metlosys y vea lo mismo. Hasta hoy Metlosys la
-- sacaba del planificador de SPMM, pero durante la prueba piloto (desde el 28/09) el
-- dueño es el Integral y la tabla planificacion de producción está vacía: la semana salía
-- siempre en 0.
--
-- CÓMO
--
-- Una fila por (semana, OT). La escribe el ESPEJO del sync (paso plan_semanal de
-- backend/scripts/importar_materia_prima_legacy.py) en una ventana de semanas alrededor
-- de hoy, y la deja igual al Integral dentro de esa ventana; fuera de ella no toca nada.
-- `semana` es siempre el lunes (el Integral guarda otro día en 18 de sus 389 semanas: se
-- normaliza y el día que decía queda en fecha_original). La OT de SPMM se enlaza sólo si
-- ES la del Integral con ese número (mismo artículo, cliente y fecha); si no, queda el
-- número y id_orden_trabajo NULL. Borrar una OT no borra el plan: suelta la FK.
--
-- Crea:
--   plan_semanal (con su índice por OT)
-- No toca ninguna fila existente ni ninguna columna de otra tabla.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS plan_semanal (
    id SERIAL PRIMARY KEY,
    semana DATE NOT NULL,
    fecha_original DATE,
    numero_ot INTEGER NOT NULL,
    id_orden_trabajo INTEGER REFERENCES orden_trabajo (id) ON DELETE SET NULL,
    prioridad VARCHAR(30),
    origen VARCHAR(10) NOT NULL DEFAULT 'legacy',
    creado_en TIMESTAMP,
    CONSTRAINT ux_plan_semanal_semana_ot UNIQUE (semana, numero_ot),
    CONSTRAINT ck_plan_semanal_lunes CHECK (EXTRACT(ISODOW FROM semana) = 1),
    CONSTRAINT ck_plan_semanal_origen CHECK (origen IN ('legacy', 'spmm'))
);

COMMENT ON TABLE plan_semanal IS
    'Qué OT están programadas cada semana según el plan semanal del Sistema Integral '
    '(dbo.plansemanal). La escribe el espejo del sync en una ventana de semanas alrededor '
    'de hoy; es lo que muestra «Semana del …» en Pendientes mientras el Integral es el dueño '
    'de la materia prima.';

COMMENT ON COLUMN plan_semanal.semana IS
    'El lunes de la semana. El Integral a veces guarda otro día de la semana: se normaliza '
    'al lunes y el día original queda en fecha_original.';

COMMENT ON COLUMN plan_semanal.numero_ot IS
    'El número de OT que ve la gente (el idot del Integral), esté o no en SPMM.';

COMMENT ON COLUMN plan_semanal.id_orden_trabajo IS
    'La OT de SPMM, sólo si es la del Integral con ese número (mismo artículo, cliente y '
    'fecha). NULL si no coincide, si SPMM no la tiene o si se borró (ON DELETE SET NULL).';

COMMENT ON COLUMN plan_semanal.origen IS
    'legacy = la trajo el espejo del Integral (la reescribe en cada pasada); spmm = cargada '
    'en SPMM (el espejo no la toca).';

CREATE INDEX IF NOT EXISTS ix_plan_semanal_ot ON plan_semanal (id_orden_trabajo);
