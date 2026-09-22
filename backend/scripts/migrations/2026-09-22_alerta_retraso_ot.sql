-- De qué OT habla una notificación (y el aviso de orden retrasada)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-04) que el sistema avise solo cuando una orden se retrasa respecto
-- del cronograma previsto. Toda la cañería de avisos ya estaba —la tabla, la API, la
-- campanita de arriba a la derecha y su consulta cada 30 s— pero nadie la disparaba
-- por tiempo: las notificaciones sólo nacían cuando una persona hacía algo.
--
-- Para que el aviso lo pueda generar un trabajo automático falta UNA cosa en la base:
-- que la notificación sepa de qué orden habla. Sin eso, el detector no tiene forma de
-- preguntar «¿de esta OT ya avisé?» y cada corrida escribiría otra copia del mismo
-- aviso: a los diez días la campanita tendría diez renglones por cada orden vencida y
-- no serviría para nada.
--
-- La columna sirve además para lo que la gente espera al tocar el aviso: ir a la
-- orden. Hasta ahora todos los avisos llevaban a la misma pantalla de notificaciones.
--
-- POR QUÉ NO LLEVA FK A orden_trabajo
--
-- Mismo criterio que `auditoria_movimiento` (15/09): borrar una OT no puede fallar
-- —ni quedar a medias— por un aviso viejo que la nombra. El aviso es un rastro, no un
-- dato de la orden. Si la OT ya no está, el aviso queda huérfano y no pasa nada.
--
-- POR QUÉ EL ÍNDICE ES PARCIAL
--
-- Una misma OT puede tener varios avisos de otras clases (se creó, cambió de estado)
-- y eso está bien. Lo que no puede repetirse es el aviso de RETRASO: uno por orden y
-- listo. Por eso el UNIQUE vale sólo para tipo = 'OT_RETRASADA'.
--
-- OJO: el índice es la última defensa, no la primera. En los tests la base es SQLite
-- y este índice parcial no existe, así que la regla de «no repetir» tiene que estar
-- también en la consulta del detector (NOT EXISTS). Está en
-- backend/application/AlertaRetrasoService.py.
--
-- Agrega:
--   notificacion.id_orden_trabajo (INTEGER NULL)
--   ux_notificacion_retraso_ot (índice único parcial)
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE notificacion
    ADD COLUMN IF NOT EXISTS id_orden_trabajo INTEGER;

COMMENT ON COLUMN notificacion.id_orden_trabajo IS
    'De qué orden de trabajo habla esta notificación. NULL = no habla de ninguna '
    '(altas de personas, cambios de usuario). Sin FK a propósito: borrar una OT no '
    'tiene que fallar por un aviso viejo. Es además lo que evita repetir el aviso de '
    'retraso en cada corrida del detector.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_notificacion_retraso_ot
    ON notificacion (id_orden_trabajo)
    WHERE tipo = 'OT_RETRASADA';
