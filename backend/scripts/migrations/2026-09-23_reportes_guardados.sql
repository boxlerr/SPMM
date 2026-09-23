-- Los reportes personalizados que cada uno guarda con nombre (RF-23)
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-23) «reportes personalizados por el usuario, según filtros y criterios
-- configurables». Julián lo pidió en el Dashboard: un botón para armar un reporte a medida
-- (de qué, qué columnas, qué filtros, cómo agruparlo) y bajarlo en PDF, Excel o CSV. Uno
-- que se arma todos los meses tiene que poder guardarse con nombre y abrirse de un click.
--
-- CÓMO
--
-- Una fila por reporte guardado. Se guarda la RECETA (`config`: el JSON que arma la
-- pantalla, con códigos del catálogo cerrado de backend/application/ReportesCatalogo.py),
-- no el resultado: se vuelve a validar y a correr cada vez que se abre, con los permisos
-- de quien lo abre y los datos de ese momento.
--
-- Es de quien lo guardó: sólo esa persona lo cambia o lo borra. Un admin lo puede marcar
-- `compartido` y lo ven todos los que pueden leer su fuente.
--
-- `fuente` va sin CHECK ni ENUM a propósito: las fuentes las dice el catálogo del código,
-- y sumar una mañana no tiene que pedir una migración. Un código que ya no existe se avisa
-- al abrir el reporte.
--
-- Sin FK a `usuario`, como el resto de las tablas que anotan un autor: borrar una cuenta
-- no tiene que fallar ni llevarse los reportes que compartió.
--
-- Crea:
--   reporte_guardado (+ 2 índices)
-- No toca ninguna fila existente ni ninguna columna de otra tabla.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS reporte_guardado (
    id BIGSERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    descripcion VARCHAR(500),
    fuente VARCHAR(40) NOT NULL,
    config TEXT NOT NULL,
    id_usuario INTEGER NOT NULL,
    usuario VARCHAR(120),
    compartido BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP NOT NULL,
    modificado_en TIMESTAMP
);

COMMENT ON TABLE reporte_guardado IS
    'Reportes personalizados guardados con nombre (RF-23). Guarda la receta (fuente, '
    'columnas, filtros, agrupación y orden), no el resultado: se valida y se corre de nuevo '
    'cada vez que se abre. La escribe SPMM; el sync no la mira.';

COMMENT ON COLUMN reporte_guardado.config IS
    'El reporte como lo arma la pantalla: un JSON con códigos del catálogo cerrado '
    '(backend/application/ReportesCatalogo.py). Nunca SQL ni nombres de tabla o columna.';

COMMENT ON COLUMN reporte_guardado.fuente IS
    'El código de la fuente de datos (ordenes, pasos, personas...), repetido afuera del '
    'JSON para listar sin abrirlo. Sin CHECK: las fuentes las dice el catálogo del código.';

COMMENT ON COLUMN reporte_guardado.id_usuario IS
    'Quién lo guardó (usuario.id_usuario). Sólo esa persona lo cambia o lo borra.';

COMMENT ON COLUMN reporte_guardado.compartido IS
    'TRUE: lo marcó un admin para que lo vean todos, pero cada uno sólo si puede leer su '
    'fuente. FALSE: sólo lo ve quien lo guardó.';

-- La lista de cada persona: los suyos.
CREATE INDEX IF NOT EXISTS ix_reporte_guardado_usuario
    ON reporte_guardado (id_usuario);

-- Y los compartidos, que son pocos.
CREATE INDEX IF NOT EXISTS ix_reporte_guardado_compartido
    ON reporte_guardado (id)
    WHERE compartido;
