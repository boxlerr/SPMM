-- Un paso «en cola»: amolado o pintura que se deja para hacerlo junto con los de otras OT
-- Fecha: 2026-10-31
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Lucas, reunión del 28/10/2026: en vez de cortar lo que alguien está haciendo para amolar
-- o pintar UNA pieza, la OT avanza hasta antes de ese paso, el paso queda en cola, y cuando
-- se juntan varias se hacen todas de una vez (un pasante pinta todo junto). Se guarda como
-- una pausa del paso con motivo EN_COLA: hace lo mismo que una pausa (el paso y los que le
-- siguen no entran en el plan hasta que salga de la cola) y ya tiene quién y desde cuándo.
--
-- Sólo se agrega EN_COLA a la lista cerrada de motivos (ver backend/domain/PausaOrden.py).
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE orden_trabajo_pausa DROP CONSTRAINT IF EXISTS ck_pausa_motivo;

ALTER TABLE orden_trabajo_pausa ADD CONSTRAINT ck_pausa_motivo CHECK (motivo IN ('FALTA_MATERIAL',
    'MAQUINA_ROTA', 'ESPERA_CLIENTE', 'CAMBIO_PRIORIDAD', 'OTRO', 'EN_COLA'));
