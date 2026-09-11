-- Deshacer un cambio de procesos de una OT
-- Fecha: 2026-09-10
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Hasta hoy, editar los procesos de una OT era definitivo. `update_processes_full`
-- manda la lista completa y borra lo que no viene, sin historial: si alguien sacaba
-- ocho pasos por error, no había de dónde volver. Se aguantaba porque editar
-- procesos era raro —había que salir de la planificación, buscar la OT y entrar al
-- modal—, pero desde el 10/09 se editan DESDE la planificación, que es donde más se
-- toca y más apurado se trabaja.
--
-- Julián (10/09), después de que el taller frenara la planificación creyendo que el
-- sistema le había roto los datos: "hacé lo de deshacer cambios de procesos de una OT".
--
-- QUÉ GUARDA
--
-- Una foto de los procesos ANTES de cada cambio, en JSON. No una tabla espejo con
-- las mismas columnas: lo que se guarda es un pedazo de historia, no datos vivos, y
-- que no tenga forma fija es una ventaja — el día que orden_trabajo_proceso gane una
-- columna, las fotos viejas siguen leyéndose igual.
--
-- Se guarda el estado PREVIO y no el posterior, para que "deshacer" sea abrir la
-- última foto y escribirla. Con el posterior habría que ir siempre una atrás.
--
-- Agrega:
--   orden_trabajo_proceso_version (id, id_orden_trabajo, creado_en, id_usuario,
--                                  usuario, motivo, procesos JSONB)
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS orden_trabajo_proceso_version (
    id               BIGSERIAL PRIMARY KEY,
    id_orden_trabajo INTEGER     NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE,
    creado_en        TIMESTAMP   NOT NULL,
    -- Quién lo cambió. Igual que en la auditoría de planificación: NULL significa
    -- "no se registró", que es distinto de un autor inventado.
    id_usuario       INTEGER,
    usuario          VARCHAR(120),
    -- De dónde salió el cambio: 'modal-ot', 'planificacion', 'restaurar'…
    motivo           VARCHAR(60),
    -- Los procesos tal como estaban ANTES del cambio.
    procesos         JSONB       NOT NULL
);

COMMENT ON TABLE orden_trabajo_proceso_version IS
    'Foto de los procesos de una OT ANTES de cada cambio, para poder deshacer. '
    'Se llena desde OrdenTrabajoRepository.update_processes_full.';

-- La consulta es siempre "las últimas versiones de ESTA OT".
CREATE INDEX IF NOT EXISTS ix_otp_version_orden
    ON orden_trabajo_proceso_version (id_orden_trabajo, creado_en DESC);
