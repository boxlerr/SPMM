-- Pausar y reanudar una OT o un paso, con motivo y quién (RF-03)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-03) «permitir pausar y reanudar órdenes de producción, registrando
-- el motivo de la pausa y quién la ejecutó». No se podía: un paso estaba pendiente, en
-- proceso o terminado, y nada más. Si se rompía la máquina o faltaba material, la OT
-- seguía «en proceso», el reloj seguía corriendo y el operario parecía lento.
--
-- POR QUÉ UNA TABLA Y NO UN CUARTO ESTADO
--
-- `estado_proceso` tiene tres filas y el 1-2-3 está escrito a mano en el tablero, el
-- Gantt, el dashboard, el planificador y el sync. Un «4 = pausado» dejaba todas esas
-- pantallas diciendo «pendiente» a una OT pausada, y borraba lo que el paso era: una
-- pausa no deshace el arranque. El estado no se toca; la pausa vive acá, con su desde
-- y su hasta. Estar pausado es tener una fila con `hasta` vacío.
--
-- Y es un HISTORIAL (una fila por pausa) porque el tiempo efectivo de un paso (RF-06)
-- es el tiempo corrido menos lo que estuvo parado, y esa resta necesita cada tramo.
--
-- OT ENTERA O UN PASO
--
-- `id_otp` vacío = la OT entera; lleno = sólo ese paso (orden_trabajo_proceso.id). Va
-- sin FK a propósito: el guardado completo de la OT borra y recrea pasos, y una FK lo
-- trabaría por una pausa vieja. Por eso se copian el paso y el nombre del proceso.
--
-- `id_orden_trabajo` sí lleva FK, con ON DELETE CASCADE: borrar la OT se lleva sus
-- pausas. Sin el CASCADE, borrar una OT que alguna vez se pausó fallaría.
--
-- LOCKS
--
-- La primera vez, la FK toma SHARE ROW EXCLUSIVE sobre `orden_trabajo` mientras se crea
-- la tabla (vacía: es instantáneo). No frena lecturas y el lock_timeout de
-- migraciones.py lo acota. Las veces siguientes el IF NOT EXISTS corta antes.
--
-- Crea:
--   orden_trabajo_pausa (+ 3 índices, dos de ellos únicos parciales)
-- No toca ninguna fila existente.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS orden_trabajo_pausa (
    id BIGSERIAL PRIMARY KEY,
    id_orden_trabajo INTEGER NOT NULL REFERENCES orden_trabajo (id) ON DELETE CASCADE,
    id_otp BIGINT,
    paso INTEGER,
    nombre_proceso VARCHAR(200),
    motivo VARCHAR(30) NOT NULL,
    observacion VARCHAR(500),
    desde TIMESTAMP NOT NULL,
    hasta TIMESTAMP,
    cierre VARCHAR(20),
    id_usuario_pausa INTEGER,
    usuario_pausa VARCHAR(120),
    id_usuario_reanuda INTEGER,
    usuario_reanuda VARCHAR(120),
    CONSTRAINT ck_pausa_motivo CHECK (motivo IN ('FALTA_MATERIAL', 'MAQUINA_ROTA',
        'ESPERA_CLIENTE', 'CAMBIO_PRIORIDAD', 'OTRO')),
    CONSTRAINT ck_pausa_cierre CHECK (cierre IS NULL OR cierre IN ('REANUDADA',
        'PASO_EN_PROCESO', 'PASO_TERMINADO', 'OT_TERMINADA')),
    CONSTRAINT ck_pausa_hasta_despues CHECK (hasta IS NULL OR hasta >= desde)
);

COMMENT ON TABLE orden_trabajo_pausa IS
    'Pausas de una OT entera o de uno de sus pasos (RF-03): motivo, desde, hasta y '
    'quién pausó y reanudó. La escribe SPMM; el sync no la mira. No cambia el estado '
    'de ningún paso: un paso en proceso que se pausa sigue en proceso.';

COMMENT ON COLUMN orden_trabajo_pausa.id_otp IS
    'El paso pausado (orden_trabajo_proceso.id). NULL = la OT entera. Sin FK a '
    'propósito: el guardado completo de la OT borra y recrea pasos, y la pausa vieja '
    'no puede trabarlo. Por eso se copian paso y nombre_proceso.';

COMMENT ON COLUMN orden_trabajo_pausa.motivo IS
    'FALTA_MATERIAL, MAQUINA_ROTA, ESPERA_CLIENTE, CAMBIO_PRIORIDAD u OTRO. Lista '
    'cerrada para poder contar por motivo; con OTRO la observacion es obligatoria.';

COMMENT ON COLUMN orden_trabajo_pausa.desde IS
    'Cuándo se pausó, en hora local del taller y sin zona, como todas las fechas de '
    'esta base.';

COMMENT ON COLUMN orden_trabajo_pausa.hasta IS
    'Cuándo se reanudó. NULL = sigue pausada. Una sola pausa abierta por OT entera y '
    'una por paso (los dos índices únicos parciales).';

COMMENT ON COLUMN orden_trabajo_pausa.cierre IS
    'Cómo terminó: REANUDADA (alguien apretó Reanudar), PASO_EN_PROCESO o '
    'PASO_TERMINADO (se movió el paso pausado) u OT_TERMINADA (se terminaron todos los '
    'pasos). NULL mientras sigue abierta.';

COMMENT ON COLUMN orden_trabajo_pausa.usuario_pausa IS
    'Nombre y apellido de quien pausó, tomado del token y congelado. NULL = no se '
    'registró (un script); nunca un autor inventado. Igual usuario_reanuda.';

-- Lo que pide la ficha de la OT: sus pausas, la última primero.
CREATE INDEX IF NOT EXISTS ix_pausa_ot
    ON orden_trabajo_pausa (id_orden_trabajo, desde);

-- Una sola pausa abierta por OT entera y una sola por paso. El servicio lo mira
-- antes de insertar; esto es para dos personas apretando «Pausar» a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pausa_abierta_ot
    ON orden_trabajo_pausa (id_orden_trabajo)
    WHERE hasta IS NULL AND id_otp IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pausa_abierta_paso
    ON orden_trabajo_pausa (id_otp)
    WHERE hasta IS NULL AND id_otp IS NOT NULL;
