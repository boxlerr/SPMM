-- El registro de TODO lo que se crea, edita o elimina
-- Fecha: 2026-09-15
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Pedido de Julián: «log en auditoría de cada cosa que se haga, se agregue, edite o
-- elimine de TODO». Hasta hoy la pantalla de Auditoría mostraba UNA sola cosa —los
-- intentos de planificar, que se guardan en `planificacion_intento`— y nada más.
-- Borrar un operario, cambiarle los minutos a un proceso, renombrar una categoría o
-- tocar una OT no dejaba ningún rastro en ningún lado. Con el taller ya cargando los
-- datos de verdad, «¿quién cambió esto?» no tenía respuesta.
--
-- QUIÉN LA ESCRIBE
--
-- Nadie en particular, a propósito: la escribe el middleware de
-- backend/presentation/main.py, que ve pasar TODAS las llamadas que modifican datos.
-- Poner la llamada en cada servicio eran 78 endpoints, y el próximo que alguien
-- agregue no la tendría — que es exactamente cómo se llegó a esto.
--
-- POR QUÉ NO SE EXTENDIÓ `planificacion_intento`
--
-- Porque son dos cosas distintas. Un intento de planificar guarda cuántas OT entraron,
-- cuántos procesos, cuánto tardó el solver y por qué falló: columnas que no significan
-- nada para «editó la máquina 12». Mezclarlas dejaría una tabla mitad vacía en cada
-- fila. La pantalla de Auditoría muestra las dos, que es donde tienen que juntarse.
--
-- Crea:
--   auditoria_movimiento (+ 2 índices)
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS auditoria_movimiento (
    id BIGSERIAL PRIMARY KEY,
    -- Hora local del taller, sin zona, como TODAS las fechas de esta base.
    creado_en TIMESTAMP NOT NULL,
    -- Quién. NULL = no se registró el usuario (hay endpoints sin token); nunca un
    -- autor inventado.
    id_usuario INTEGER,
    usuario VARCHAR(120),
    -- creó / editó / eliminó, en castellano, que es como se lee en pantalla.
    accion VARCHAR(20) NOT NULL,
    entidad VARCHAR(80) NOT NULL,
    id_entidad VARCHAR(40),
    descripcion TEXT NOT NULL,
    -- El rastro técnico, para cuando la frase no alcanza.
    metodo VARCHAR(10) NOT NULL,
    ruta VARCHAR(300) NOT NULL,
    -- El código HTTP. Los intentos que fallaron se guardan igual: son los que más se
    -- preguntan.
    estado SMALLINT,
    duracion_ms INTEGER,
    -- Los datos que se mandaron, en JSON, sin contraseñas y sin archivos.
    detalle TEXT
);

-- La pantalla siempre pide lo último primero.
CREATE INDEX IF NOT EXISTS ix_auditoria_mov_creado_en
    ON auditoria_movimiento (creado_en DESC);

-- «Todo lo que le pasó a la OT 1081»: el otro modo de leer esta tabla.
CREATE INDEX IF NOT EXISTS ix_auditoria_mov_entidad
    ON auditoria_movimiento (entidad, id_entidad);
