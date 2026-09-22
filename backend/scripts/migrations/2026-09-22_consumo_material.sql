-- Consumo de materiales por orden de trabajo (RF-15)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-15) «asociar consumo de materiales a cada orden de producción». La
-- mitad ya estaba: `orden_trabajo_pieza` dice QUÉ material lleva cada OT y cuánto se
-- PIDIÓ. Lo que no existía en ningún lado es cuánto se CONSUMIÓ de verdad, quién lo
-- registró y cuándo.
--
-- POR QUÉ UNA TABLA NUEVA Y NO UNA COLUMNA DE orden_trabajo_pieza
--
-- Decisión del 11/09: el sistema viejo sigue siendo el dueño de las materias primas.
-- `orden_trabajo_pieza` la escribe el sync y la reescribe entera cada media hora
-- —incluida `cantusada`, que parecía el lugar natural y NO sirve: el sync la llena con
-- `mp.cantstk`, la misma columna del viejo que alimenta el stock—. Guardar el consumo
-- ahí es repetir el bug de las OT importadas: se escribe, a los minutos lo pisa el sync
-- y nadie entiende por qué. Esta tabla es de SPMM: el sync no la mira ni la pisa.
--
-- Y es un registro por EVENTO, no un total: el taller consume en tandas (tres chapas
-- hoy, dos mañana) y un solo número no deja ver quién cargó qué ni deshacer una carga
-- equivocada.
--
-- LO QUE ESTO NO HACE, A PROPÓSITO
--
-- No descuenta `pieza.stockactual`. Ese dato lo reescribe el sync con el del sistema
-- viejo (cols_update=["stockactual"]), así que un descuento hecho acá duraría hasta la
-- próxima pasada. Pasar el stock a SPMM es sacarle el dato al viejo, y de quién es cada
-- dato lo decide el cliente, no este lado. Hasta entonces esto REGISTRA el consumo; no
-- mueve el stock.
--
-- SE ANULA, NO SE BORRA
--
-- Un consumo mal cargado queda en la tabla con `anulado = 1`, quién y cuándo. Deja de
-- sumar, pero sigue a la vista: si alguien pregunta «¿no eran cinco chapas?», el
-- renglón tachado es la respuesta.
--
-- POR QUÉ `id_orden_trabajo_pieza` VA SIN FK
--
-- Es la línea de material que se estaba consumiendo, y se apunta por su PK y no por el
-- par (OT, pieza) porque ese par NO es único: el sync deduplica en Python porque el
-- viejo tiene pares repetidos. Va sin FK porque la línea es del sistema viejo: si
-- alguien la borra, el registro de lo que se consumió tiene que sobrevivir. `id_pieza`
-- sí lleva FK y queda siempre lleno, así que el consumo nunca pierde de qué material era.
-- NULL = se consumió algo que no estaba en la lista de la OT (hoy sólo por API).
--
-- LOCKS
--
-- La primera vez, las dos FK toman SHARE ROW EXCLUSIVE sobre `orden_trabajo` y `pieza`
-- mientras se crea la tabla (vacía, así que es instantáneo). No frena las lecturas,
-- sólo las escrituras de ese instante, y el lock_timeout de migraciones.py lo acota.
-- Las veces siguientes el IF NOT EXISTS corta antes de mirar las FK.
--
-- Crea:
--   consumo_material (+ 2 índices)
-- No toca ninguna fila existente.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS consumo_material (
    id BIGSERIAL PRIMARY KEY,
    id_orden_trabajo INTEGER NOT NULL REFERENCES orden_trabajo (id),
    id_pieza INTEGER NOT NULL REFERENCES pieza (id),
    id_orden_trabajo_pieza INTEGER,
    cantidad NUMERIC(18, 3) NOT NULL,
    unidad VARCHAR(40),
    fecha TIMESTAMP NOT NULL,
    id_usuario INTEGER,
    usuario VARCHAR(120),
    observaciones TEXT,
    anulado SMALLINT NOT NULL DEFAULT 0,
    anulado_en TIMESTAMP,
    anulado_por VARCHAR(120),
    motivo_anulacion TEXT,
    CONSTRAINT ck_consumo_material_cantidad_positiva CHECK (cantidad > 0)
);

COMMENT ON TABLE consumo_material IS
    'Consumo real de material por OT (RF-15). La escribe SPMM; el sync del sistema '
    'viejo no la mira ni la pisa. Distinta de orden_trabajo_pieza.cantidad, que es lo '
    'que la OT PIDE, y de orden_trabajo_pieza.cantusada, que es una copia de '
    'mp.cantstk del viejo. No descuenta stock.';

COMMENT ON COLUMN consumo_material.id_orden_trabajo_pieza IS
    'La línea de material de la OT que se consumió, por PK (el par OT-pieza no es '
    'único). Sin FK a propósito: la línea es del sistema viejo y el consumo tiene que '
    'sobrevivir si la borran. NULL = material que no estaba en la lista de la OT.';

COMMENT ON COLUMN consumo_material.cantidad IS
    'Cuánto se consumió en ESTA carga, en la unidad de la columna unidad. Siempre '
    'positiva: una carga equivocada se anula, no se compensa con un negativo.';

COMMENT ON COLUMN consumo_material.unidad IS
    'La unidad de la línea de la OT (o de la pieza, si no hay línea), copiada al '
    'cargar. Se copia para que el renglón siga diciendo lo mismo aunque el sync cambie '
    'la unidad de la línea.';

COMMENT ON COLUMN consumo_material.fecha IS
    'Cuándo se registró, en hora local del taller y sin zona, como todas las fechas de '
    'esta base.';

COMMENT ON COLUMN consumo_material.usuario IS
    'Nombre y apellido de quien lo registró, tomado del token y congelado. NULL = no '
    'se registró (un script); nunca un autor inventado.';

COMMENT ON COLUMN consumo_material.anulado IS
    '1 = anulado: deja de sumar pero sigue a la vista, con quién y cuándo en '
    'anulado_por y anulado_en. Los consumos no se borran.';

-- Lo que pide la ficha de la OT: los consumos de UNA orden, lo último primero.
CREATE INDEX IF NOT EXISTS ix_consumo_material_ot
    ON consumo_material (id_orden_trabajo, fecha DESC);

-- Para la pregunta que viene después: cuánto se gastó de un material y en qué OT.
CREATE INDEX IF NOT EXISTS ix_consumo_material_pieza
    ON consumo_material (id_pieza, fecha DESC);
