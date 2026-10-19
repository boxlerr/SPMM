-- Quién hace afuera un paso tercerizado y cuántos días tarda en devolverlo
-- Fecha: 2026-10-19
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Reunión con Lucas del 17/10/2026. En la vista previa un paso tercerizado (rango
-- TERCERIZADO o EXTERNO) salía con «Recurso humano» y «Recurso maquinaria», cuando lo que
-- hay que decir es QUÉ PROVEEDOR lo hace (el que vulcaniza, por ejemplo), en vez del
-- genérico «tercerizado». Y el plan no esperaba al proveedor: el frente de carro se mandaba
-- a vulcanizar el 19 y el ensamblaje arrancaba el 20. Lucas: «cuando se manda a tercerizar
-- habría que ponerle cuándo te lo va a devolver el proveedor; si tarda 10 días, vos le
-- terminaste de hacer el 19, recién volvería al 29», y los pasos que siguen se corren.
--
-- CÓMO
--
--   proveedor.demora_dias              los días que tarda ESE proveedor, por defecto.
--   orden_trabajo_proceso.id_proveedor quién hace este paso.
--   orden_trabajo_proceso.demora_dias  los días de ESTE trabajo, si no son los de siempre.
--
-- Son días de calendario. El planificador usa los del paso y, si no tiene, los del
-- proveedor; si no hay ninguno, el paso dura lo que dice tiempo_proceso, como hasta hoy.
--
-- Agrega tres columnas, todas NULL. No toca ninguna fila existente: todo paso tercerizado
-- sigue planificándose igual que antes hasta que alguien le elija el proveedor.
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE proveedor
    ADD COLUMN IF NOT EXISTS demora_dias SMALLINT;

ALTER TABLE orden_trabajo_proceso
    ADD COLUMN IF NOT EXISTS id_proveedor INTEGER REFERENCES proveedor (id),
    ADD COLUMN IF NOT EXISTS demora_dias INTEGER;

COMMENT ON COLUMN proveedor.demora_dias IS
    'Cuántos días de calendario tarda en devolver un trabajo tercerizado. Lo usa el '
    'planificador cuando el paso no dice otra cosa. NULL = no se sabe; nunca un valor '
    'inventado. Dato de SPMM: el sistema viejo no lo tiene y el espejo no lo pisa.';

COMMENT ON COLUMN orden_trabajo_proceso.id_proveedor IS
    'Qué proveedor hace este paso, si es tercerizado. NULL = no se dijo (el plan lo muestra '
    'como «Tercerizado», igual que antes del 19/10/2026).';

COMMENT ON COLUMN orden_trabajo_proceso.demora_dias IS
    'Días de calendario que tarda el proveedor en devolver ESTE trabajo. NULL = los de '
    'proveedor.demora_dias. El planificador no arranca el paso que sigue hasta que vuelve.';

CREATE INDEX IF NOT EXISTS ix_otp_proveedor
    ON orden_trabajo_proceso (id_proveedor)
    WHERE id_proveedor IS NOT NULL;
