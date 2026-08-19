-- Borradores de planificación: el plan calculado y todavía NO confirmado.
--
-- Hasta ahora la vista previa era pura ida y vuelta: `preview=true` devolvía el
-- resultado y no se guardaba en ningún lado. Cerrar el modal —o un corte de luz—
-- tiraba a la basura un cálculo de varios minutos, y con 34 OTs eso es la semana
-- entera del taller. Además cada retoque hecho a mano en la vista previa (cambiar
-- de máquina, de operario, correr un horario) se perdía igual.
--
-- Se guarda el payload completo en `contenido` (JSONB) en vez de normalizarlo en
-- filas: un borrador no se consulta por partes ni se cruza con nada, se abre
-- entero y se pisa entero. Normalizarlo sería una tabla espejo de `planificacion`
-- que hay que mantener en dos lugares cada vez que cambie el formato del plan.
--
-- El repositorio la crea sola (PlanificacionBorradorRepository._ensure_tabla),
-- igual que planificacion_borrada. Este archivo queda para aplicarla a mano.

CREATE TABLE IF NOT EXISTS planificacion_borrador (
    id SERIAL PRIMARY KEY,
    -- Quién lo dejó abierto. Es informativo: el borrador lo ve y lo abre cualquiera.
    id_usuario INTEGER,
    nombre_usuario VARCHAR(120),
    -- Para la lista, sin tener que abrir el JSON.
    cantidad_ots INTEGER NOT NULL DEFAULT 0,
    cantidad_procesos INTEGER NOT NULL DEFAULT 0,
    fecha_desde DATE,
    fecha_hasta DATE,
    -- OTs del lote: sirve para avisar si alguna se borró o cambió desde entonces.
    ordenes_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- El plan entero tal como lo muestra la vista previa, con los retoques a mano.
    contenido JSONB NOT NULL,
    -- `true` cuando lo escribió el autosave y no un guardado explícito. No cambia
    -- el comportamiento, sirve para no ofrecer basura si algo quedó a medio hacer.
    automatico BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    actualizado_en TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- La lista siempre pide "los últimos primero".
CREATE INDEX IF NOT EXISTS ix_planificacion_borrador_fecha
    ON planificacion_borrador (actualizado_en DESC);
