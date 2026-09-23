-- La asistencia de cada persona, en su versión simple (RF-06)
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-06) «registrar la asistencia y el tiempo efectivo de trabajo de cada
-- operario en cada tarea asignada». Lo único que había era `operario.disponible`, un
-- sí/no sin fecha que se cambia en la ficha (Activo / Ausente): se sabía que alguien
-- faltaba HOY, pero no desde cuándo, ni cuántos días faltó en el mes, ni por qué.
--
-- Julián lo pidió simple: que el Activo / Ausente quede guardado con fecha, y poder
-- cargar una ausencia de un día o de un período (vacaciones, enfermedad) con motivo
-- opcional y quién la cargó. Las fichadas con reloj son la v2 (Módulo J).
--
-- CÓMO
--
-- Una fila por tramo ausente. Los días van MEDIO ABIERTOS: `desde` es el primer día
-- que faltó y `vuelve` el primer día que ya no falta. Así un «Ausente a las 7:30,
-- llegó a las 10» queda registrado con cero días en vez de sumar un día de falta (o de
-- no poder guardarse). `vuelve` vacío = sigue ausente: sólo las que abre el Activo /
-- Ausente (origen ESTADO), y una sola por persona (índice único parcial). Las cargadas
-- a mano (origen CARGA) siempre tienen fin.
--
-- `id_operario` lleva FK con ON DELETE CASCADE: borrar a la persona se lleva sus
-- ausencias. Sin el CASCADE, borrar a alguien que alguna vez faltó fallaría.
--
-- NO TOCA EL PLAN: el planificador sigue mirando sólo `operario.disponible`.
--
-- LOCKS
--
-- La primera vez, la FK toma SHARE ROW EXCLUSIVE sobre `operario` mientras se crea la
-- tabla (vacía: es instantáneo). No frena lecturas y el lock_timeout de migraciones.py
-- lo acota. Las veces siguientes el IF NOT EXISTS corta antes.
--
-- Crea:
--   operario_ausencia (+ 2 índices, uno de ellos único parcial)
-- No toca ninguna fila existente ni ninguna columna de otra tabla.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS operario_ausencia (
    id BIGSERIAL PRIMARY KEY,
    id_operario INTEGER NOT NULL REFERENCES operario (id) ON DELETE CASCADE,
    desde DATE NOT NULL,
    vuelve DATE,
    motivo VARCHAR(20),
    observacion VARCHAR(300),
    origen VARCHAR(10) NOT NULL DEFAULT 'CARGA',
    cargada_en TIMESTAMP NOT NULL,
    id_usuario_carga INTEGER,
    usuario_carga VARCHAR(120),
    cerrada_en TIMESTAMP,
    id_usuario_cierre INTEGER,
    usuario_cierre VARCHAR(120),
    CONSTRAINT ck_ausencia_motivo CHECK (motivo IS NULL OR motivo IN ('VACACIONES',
        'ENFERMEDAD', 'LICENCIA', 'PERSONAL', 'OTRO')),
    CONSTRAINT ck_ausencia_origen CHECK (origen IN ('ESTADO', 'CARGA')),
    CONSTRAINT ck_ausencia_vuelve_despues CHECK (vuelve IS NULL OR vuelve >= desde),
    CONSTRAINT ck_ausencia_carga_con_fin CHECK (origen = 'ESTADO' OR vuelve IS NOT NULL)
);

COMMENT ON TABLE operario_ausencia IS
    'Ausencias de cada persona (RF-06): las que abre y cierra el Activo / Ausente de la '
    'ficha y las que se cargan a mano (un día o un período). La escribe SPMM; el sync no '
    'la mira y el planificador tampoco: sigue usando operario.disponible.';

COMMENT ON COLUMN operario_ausencia.desde IS
    'Primer día que faltó. Día del taller, sin hora ni zona.';

COMMENT ON COLUMN operario_ausencia.vuelve IS
    'Primer día que ya NO falta (medio abierto: faltó de desde a vuelve menos un día). '
    'NULL = sigue ausente, sólo en origen ESTADO. Igual a desde = volvió el mismo día: '
    'queda el registro y suma cero días.';

COMMENT ON COLUMN operario_ausencia.motivo IS
    'VACACIONES, ENFERMEDAD, LICENCIA, PERSONAL u OTRO, o NULL si no se dijo. Lista '
    'cerrada para poder contar por motivo; el detalle va en observacion.';

COMMENT ON COLUMN operario_ausencia.origen IS
    'ESTADO: la abrió pasar a la persona a Ausente y la cierra volverla a Activo. '
    'CARGA: la cargó alguien a mano, con su fin.';

COMMENT ON COLUMN operario_ausencia.usuario_carga IS
    'Nombre y apellido de quien la cargó (o la pasó a Ausente), tomado del token y '
    'congelado. NULL = no se registró; nunca un autor inventado. Igual usuario_cierre.';

-- Lo que pide la ficha: las ausencias de UNA persona en un período.
CREATE INDEX IF NOT EXISTS ix_ausencia_operario
    ON operario_ausencia (id_operario, desde);

-- Una sola abierta por persona. El servicio lo mira antes de abrir otra; esto es para
-- dos personas apretando «Ausente» a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ausencia_abierta
    ON operario_ausencia (id_operario)
    WHERE vuelve IS NULL;
