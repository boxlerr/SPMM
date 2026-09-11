-- Desde cuándo arranca cada plan, guardado con el plan
-- Fecha: 2026-09-11
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- La tabla `planificacion` guarda MINUTOS (inicio_min, fin_min), no fechas. La fecha
-- real de cada trabajo se calcula al leer, sumando esos minutos a un arranque. Y ese
-- arranque se venía calculando desde AHORA, cada vez que alguien miraba el plan.
--
-- O sea que las fechas del plan se movían solas: el mismo plan guardado un viernes se
-- leía el lunes con fechas de lunes. Nadie lo podía notar mirando la pantalla, porque
-- siempre se veía "coherente" — sólo que decía otra cosa cada día.
--
-- Julián lo destapó desde el otro lado el 11/9: la vista previa decía lunes 14 y lo
-- guardado decía viernes 11 a las 07:00, o sea nueve horas antes del momento en que se
-- había planificado.
--
-- Con el arranque guardado, las fechas de un plan son las que tenía cuando se armó, y
-- no cambian nunca más.
--
-- NULL = plan viejo, guardado antes de esto. Para esos se deduce del `creado_en` de la
-- fila, que es lo más cerca que se puede estar del momento en que se planificó.
--
-- Agrega:
--   planificacion.inicio_base (TIMESTAMP NULL)
--
-- Idempotente.

ALTER TABLE planificacion
    ADD COLUMN IF NOT EXISTS inicio_base TIMESTAMP;

COMMENT ON COLUMN planificacion.inicio_base IS
    'El T=0 del plan: a qué momento corresponde inicio_min = 0. Sin esto las fechas '
    'del plan se recalculaban desde "ahora" en cada lectura y se movían todos los '
    'días. NULL = plan anterior al 11/09/2026; para esos se deduce de creado_en.';
