-- Historial de planificaciones borradas.
--
-- Hasta ahora, borrar un lote (o sacar OTs sueltas) era un DELETE a secas: no
-- quedaba rastro de qué se había borrado ni cuándo. Esta tabla guarda el resumen
-- antes del DELETE, así se puede auditar después.
--
-- El repositorio la crea solo (PlanificacionRepository._ensure_historial), igual
-- que hace con forzado_fuera_rango. Este archivo queda para poder aplicarla a
-- mano si se prefiere no depender del self-healing.
--
-- alcance: 'lote'    -> se borró la planificación entera
--          'ordenes' -> se sacaron OTs puntuales del lote

CREATE TABLE IF NOT EXISTS planificacion_borrada (
    id SERIAL PRIMARY KEY,
    id_planificacion_lote UUID,
    descripcion_lote VARCHAR(200),
    alcance VARCHAR(20) NOT NULL,
    filas_borradas INTEGER NOT NULL DEFAULT 0,
    ots_borradas INTEGER NOT NULL DEFAULT 0,
    orden_ids TEXT,
    creado_en_lote TIMESTAMP,
    borrado_en TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_planificacion_borrada_lote
    ON planificacion_borrada (id_planificacion_lote);

CREATE INDEX IF NOT EXISTS ix_planificacion_borrada_fecha
    ON planificacion_borrada (borrado_en DESC);
