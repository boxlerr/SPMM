-- «Estado y control» de la OT: las casillas de la ficha del sistema viejo que faltaban
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ (RF-11, «Controles de calidad por orden»)
--
-- La ficha de OT del sistema viejo tiene un recuadro de estado con ocho casillas:
-- PROGRAMADA, EN PROCESO, FINALIZADO TOTAL, FINALIZADO PARCIAL (con su «Cant.»),
-- CONTROLADO, FINALIZADO PARA PINTAR, FINALIZADO TERCERIZACIÓN FINAL y FINALIZADO
-- TERCERIZACIÓN INTERMEDIA. Julián, 23/09: «tiene que estar, hacelo, ponelo en las
-- órdenes de trabajo; si no está alguna opción creala en la db y en la orden».
--
-- Las cuatro primeras ya existían en `orden_trabajo` (programada, en_proceso,
-- finalizadototal, finalizadoparcial). Ésta agrega el resto:
--
--   controlado                           SMALLINT NOT NULL DEFAULT 0
--   finalizado_para_pintar               SMALLINT NOT NULL DEFAULT 0
--   finalizado_tercerizacion_intermedia  SMALLINT NOT NULL DEFAULT 0
--   finalizado_tercerizacion_final       SMALLINT NOT NULL DEFAULT 0
--   cantidad_finalizada_parcial          INTEGER NULL   (el «Cant.» de Finalizado parcial)
--   controlado_en                        TIMESTAMP NULL (cuándo se marcó Controlado)
--   controlado_por                       VARCHAR(120) NULL (quién la marcó)
--
-- POR QUÉ 0/1 Y NO BOOLEAN NI ENUM
--
-- Son marcas sí / no como sus vecinas (programada, suspendida, no_lleva_materia_prima...),
-- que la base guarda 0/1. Un ENUM de «estado» obligaría a elegir UNA, y en la ficha vieja
-- son casillas independientes: una OT puede estar Finalizado parcial y Controlada a la vez.
--
-- POR QUÉ EL «CANT.» NO ES `cantidad_entregada`
--
-- `cantidad_entregada` es otra casilla de la ficha (Cant Entregada) y registrar una
-- entrega mueve la fecha de entrega. Terminar piezas no es entregarlas. NULL = no se
-- cargó, que no es lo mismo que 0.
--
-- POR QUÉ `controlado_en` / `controlado_por` VAN NULL
--
-- Los escribe el backend cuando alguien marca Controlado desde SPMM (hora local AR, sin
-- zona) y los borra al desmarcarla. Ninguna OT de hoy está controlada, así que ninguna
-- fila tiene nada que llenar: un default inventaría un control que nunca ocurrió. Si no
-- se sabe quién la marcó, queda NULL: nunca un autor inventado. El historial de cada
-- cambio igual queda en Auditoría (auditoria_movimiento).
--
-- NO REESCRIBE NINGUNA FILA
--
-- En Postgres 11+ un ADD COLUMN con DEFAULT constante no reescribe la tabla: el valor
-- queda en el catálogo y las filas existentes lo leen de ahí. Las otras tres son NULL
-- sin default. El ALTER sí toma ACCESS EXCLUSIVE un instante; migraciones.py lo acota con
-- lock_timeout (3 s) y, si no llega, la próxima instancia lo reintenta.
--
-- QUIÉN MÁS ESCRIBE `orden_trabajo`
--
-- El sync del legacy está apagado desde el 2/9 y no nombra estas columnas; los scripts
-- que insertan OT con SQL a mano (migrar_ot_faltantes) tampoco: por el DEFAULT nacen en
-- 0 y no en NULL. Que ese script TRAIGA estas marcas del sistema viejo queda pendiente.
--
-- Idempotente: se puede correr las veces que haga falta. Además se aplica sola al
-- levantar el backend (backend/infrastructure/migraciones.py), porque el deploy a Cloud
-- Run es a mano y el modelo ya declara estas columnas: si la base no las tiene, se cae la
-- lectura de TODAS las OT, no sólo el dato nuevo.

ALTER TABLE orden_trabajo
    ADD COLUMN IF NOT EXISTS controlado SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS finalizado_para_pintar SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS finalizado_tercerizacion_intermedia SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS finalizado_tercerizacion_final SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cantidad_finalizada_parcial INTEGER,
    ADD COLUMN IF NOT EXISTS controlado_en TIMESTAMP,
    ADD COLUMN IF NOT EXISTS controlado_por VARCHAR(120);

COMMENT ON COLUMN orden_trabajo.controlado IS 'RF-11: la casilla CONTROLADO de la ficha del sistema viejo (0/1). La marca una persona desde SPMM; quién y cuándo quedan en controlado_por y controlado_en.';

COMMENT ON COLUMN orden_trabajo.finalizado_para_pintar IS 'RF-11: la casilla FINALIZADO PARA PINTAR de la ficha del sistema viejo (0/1).';

COMMENT ON COLUMN orden_trabajo.finalizado_tercerizacion_intermedia IS 'RF-11: la casilla FINALIZADO TERCERIZACIÓN INTERMEDIA de la ficha del sistema viejo (0/1).';

COMMENT ON COLUMN orden_trabajo.finalizado_tercerizacion_final IS 'RF-11: la casilla FINALIZADO TERCERIZACIÓN FINAL de la ficha del sistema viejo (0/1).';

COMMENT ON COLUMN orden_trabajo.cantidad_finalizada_parcial IS 'RF-11: el «Cant.» al lado de FINALIZADO PARCIAL: cuántas unidades se terminaron. No es cantidad_entregada (terminar no es entregar). NULL = no se cargó.';

COMMENT ON COLUMN orden_trabajo.controlado_en IS 'RF-11: cuándo se marcó CONTROLADO desde SPMM, hora local de Argentina sin zona. Lo pone el backend y lo borra al desmarcarla. NULL con controlado = 1: no se registró.';

COMMENT ON COLUMN orden_trabajo.controlado_por IS 'RF-11: quién marcó CONTROLADO (el nombre, no el id). Lo pone el backend y lo borra al desmarcarla. NULL = no se sabe quién: nunca un autor inventado.';
