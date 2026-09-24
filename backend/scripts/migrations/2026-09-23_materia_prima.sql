-- Materia prima en SPMM: catálogo de insumos, stock por movimientos, compras por OT y cañera
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Reunión del 23/09/2026 con Lucas: la gestión de materias primas PASA a SPMM. El sistema
-- viejo queda sólo para facturas y remitos. Hasta ahora SPMM tenía una copia de lo del
-- viejo que escribía el sync, y la copia estaba mal: el sync inventaba las marcas de las
-- líneas (pedido = cantidad > 0, disponible = 1) y ponía en 0 el stock de toda pieza que
-- alguna vez estuvo en una OT. SPMM mostraba material «ok» en OT sin pedir.
--
-- Esto agrega lo que falta para que la carga se haga acá:
--   · catálogos para describir un insumo: material, material_calidad, formato (con su
--     semilla) y proveedor;
--   · las columnas del viejo que faltaban en pieza (tipo, material, formato, medidas,
--     inactivo, proveedor preferido, fecha del último precio, quién y cuándo);
--   · el stock como SUMA DE MOVIMIENTOS (pieza_movimiento). pieza.stockactual pasa a ser
--     el caché de esa suma: lo recalcula el servicio en cada movimiento, nadie más;
--   · historial de precios (pieza_precio) y recortes (pieza_recorte);
--   · las columnas del viejo que faltaban en orden_trabajo_pieza (reserva, utilizado,
--     producción, proveedor de la compra, fechas, quién pidió y quién marcó disponible);
--   · los cortes de cada línea (orden_trabajo_pieza_corte) y la cañera (canera_ocupacion).
--
-- LO QUE ESTO NO HACE, A PROPÓSITO
--
-- No toca ninguna fila existente: todas las columnas nuevas son NULL o tienen DEFAULT
-- (en Postgres 11+ un DEFAULT constante no reescribe la tabla). Los datos del viejo los
-- trae backend/scripts/importar_materia_prima_legacy.py, aparte y con --aplicar. La única
-- escritura es la semilla de formato, que es un catálogo nuevo (ON CONFLICT DO NOTHING:
-- si alguien renombró o desactivó un formato, queda como está).
--
-- No le agrega UNIQUE a pieza.cod_pieza: hay un duplicado heredado (50%004, ids 4117 y
-- 4124). El índice sobre upper(trim(cod_pieza)) es para buscar; la unicidad de los
-- códigos nuevos la cuida el servicio, comparando normalizado como el viejo.
--
-- LAS MEDIDAS VAN SIEMPRE EN MILÍMETROS
--
-- pieza.medida1..5 guardan mm aunque el insumo se haya cargado en pulgadas: el sistema
-- sólo decide cómo se escribe la descripción (1 1/4" (31.75mm)). En el viejo los t1..t5
-- eran Val() de lo tipeado («1 1/4» quedaba 11) y en pulgadas la única verdad era la
-- descripción; acá el número es el número.
--
-- SE ANULA O SE CIERRA, NO SE BORRA
--
-- Un movimiento de stock equivocado se anula (deja de sumar, queda a la vista). Una
-- ocupación de la cañera se cierra con hasta (queda el historial de dónde estuvo cada
-- cosa). Mismo patrón que consumo_material.
--
-- OJO CON EL NOMBRE ix_otp_*: en esta base «otp» ya nombraba a orden_trabajo_proceso
-- (ix_otp_orden_trabajo, ix_otp_orden_proceso). Los ix_otp_ot / ix_otp_pieza de acá son
-- de orden_trabajo_pieza; los nombres no chocan, pero conviene saberlo al leer un plan.
--
-- LOCKS
--
-- Los dos ALTER TABLE toman ACCESS EXCLUSIVE sobre pieza y orden_trabajo_pieza, y las FK
-- nuevas SHARE ROW EXCLUSIVE sobre las tablas que apuntan (material, formato, proveedor,
-- orden_trabajo). La primera vez, con columnas nullable o DEFAULT constante, es un cambio
-- de catálogo más la validación de FK sobre columnas vacías (17 mil piezas, 4 mil
-- líneas): milisegundos. Los índices nuevos se construyen sobre esas mismas tablas.
-- El lock_timeout de migraciones.py lo acota; las veces siguientes el IF NOT EXISTS corta.
--
-- Crea:
--   material, material_calidad, formato (+ semilla), proveedor, pieza_movimiento,
--   pieza_precio, pieza_recorte, orden_trabajo_pieza_corte, canera_ocupacion
--   columnas nuevas en pieza y orden_trabajo_pieza, y sus índices.
--
-- Idempotente: se puede correr las veces que haga falta.

-- ─────────────────────────── catálogos ───────────────────────────

CREATE TABLE IF NOT EXISTS material (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    letra_codigo VARCHAR(2),
    activo SMALLINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE material IS
    'Material de un insumo (ACERO, ALUMINIO, BRONCE...). En el viejo vivía mezclado con '
    'la calidad (dbo.Material) y como texto suelto en pieza.material. Único sin mirar '
    'mayúsculas; los nombres parecidos NO se fusionan (decisión del cliente).';

COMMENT ON COLUMN material.letra_codigo IS
    'La letra con la que empieza el código de los insumos de este material (ACERO A, '
    'BRONCE B). NULL = la primera letra del nombre.';

-- Único sin mirar mayúsculas: «Acero» y «ACERO» serían el mismo material con dos filas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_material_nombre ON material (upper(nombre));

CREATE TABLE IF NOT EXISTS material_calidad (
    id SERIAL PRIMARY KEY,
    id_material INTEGER NOT NULL REFERENCES material (id),
    nombre VARCHAR(80) NOT NULL,
    activo SMALLINT NOT NULL DEFAULT 1,
    CONSTRAINT uq_material_calidad UNIQUE (id_material, nombre)
);

COMMENT ON TABLE material_calidad IS
    'Calidad de un material (SAE 1045 del ACERO, DELRIN de los PLASTICOS). Cuelga del '
    'material porque el combo se filtra por él. En el viejo la calidad sólo vivía en la '
    'descripción de la pieza, después del material.';

CREATE TABLE IF NOT EXISTS formato (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL UNIQUE,
    iniciales VARCHAR(4) NOT NULL,
    etiqueta1 VARCHAR(30),
    etiqueta2 VARCHAR(30),
    etiqueta3 VARCHAR(30),
    etiqueta4 VARCHAR(30),
    etiqueta5 VARCHAR(30),
    orden SMALLINT,
    activo SMALLINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE formato IS
    'Forma en que viene un insumo (BARRA REDONDO, PLACA...). En el viejo la lista estaba '
    'fija en el código; acá cada formato dice qué mide cada medida (etiqueta1..5) para que '
    'el alta pida exactamente esas y la descripción salga siempre igual.';

COMMENT ON COLUMN formato.iniciales IS
    'Las letras del formato en el código del insumo (ACERO + BARRA CUADRADO = ABC). '
    'Repiten las del viejo a propósito, choques incluidos (BR = redondo y rectangular): '
    'el número se comparte por prefijo y los códigos nuevos siguen la serie.';

COMMENT ON COLUMN formato.etiqueta1 IS
    'Qué es la primera medida (Ø, Lado, Espesor...). La cantidad de medidas del formato '
    'es la cantidad de etiquetas no nulas, siempre las primeras.';

-- La semilla. Misma lista que application/materia_prima/semilla.py (un test las compara).
-- ON CONFLICT DO NOTHING: si alguien cambió un formato desde la pantalla, no se pisa.
-- Va en un INSERT por cantidad de medidas para no escribir NULL en las etiquetas que
-- el formato no usa (la columna ya queda NULL sola).
INSERT INTO formato (nombre, iniciales, etiqueta1, orden) VALUES
    ('BARRA REDONDO', 'BR', 'Ø', 1),
    ('BARRA CUADRADO', 'BC', 'Lado', 2),
    ('BARRA HEXAGONAL', 'BH', 'Entre caras', 3)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO formato (nombre, iniciales, etiqueta1, etiqueta2, orden) VALUES
    ('BARRA RECTANGULAR', 'BR', 'Ancho', 'Espesor', 4),
    ('TUBO REDONDO', 'TR', 'Ø exterior', 'Ø interior', 5),
    ('TUBO CUADRADO', 'TC', 'Lado', 'Espesor', 6),
    ('PLANCHUELA', 'P', 'Ancho', 'Espesor', 9),
    ('ANGULOS IGUALES', 'AI', 'Ala', 'Espesor', 10),
    ('CORTE PANTOGRAFO', 'CP', 'Medida', 'Espesor', 14)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO formato (nombre, iniciales, etiqueta1, etiqueta2, etiqueta3, orden) VALUES
    ('TUBO RECTANGULAR', 'TR', 'Lado A', 'Lado B', 'Espesor', 7),
    ('PLACA', 'P', 'Espesor', 'Ancho', 'Largo', 8),
    ('ANGULOS DESIGUALES', 'AD', 'Ala A', 'Ala B', 'Espesor', 11),
    ('PERFIL U', 'PU', 'Alto', 'Ala', 'Espesor', 12),
    ('PERFIL T', 'PT', 'Alto', 'Ala', 'Espesor', 13)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO formato (nombre, iniciales, etiqueta1, etiqueta2, etiqueta3, etiqueta4, etiqueta5, orden) VALUES
    ('CORTE LASER', 'CL', 'Medida 1', 'Medida 2', 'Medida 3', 'Medida 4', 'Medida 5', 15)
ON CONFLICT (nombre) DO NOTHING;

CREATE TABLE IF NOT EXISTS proveedor (
    id SERIAL PRIMARY KEY,
    id_legacy INTEGER UNIQUE,
    razon_social VARCHAR(200) NOT NULL,
    fantasia VARCHAR(200),
    cuit VARCHAR(20),
    telefono VARCHAR(60),
    celular VARCHAR(60),
    mail VARCHAR(120),
    direccion VARCHAR(200),
    localidad VARCHAR(100),
    observaciones TEXT,
    inactivo SMALLINT NOT NULL DEFAULT 0,
    creado_en TIMESTAMP,
    creado_por VARCHAR(120)
);

COMMENT ON TABLE proveedor IS
    'A quién se le compra. Hasta el 23/09/2026 SPMM sólo tenía el texto libre '
    'pieza.proveedor copiado del viejo. Un proveedor que ya no se usa se marca inactivo, '
    'no se borra: lo nombran compras viejas.';

COMMENT ON COLUMN proveedor.id_legacy IS
    'Clave de dbo.Proveedor del sistema viejo; la importación hace upsert por acá. NULL = '
    'dado de alta en SPMM.';

-- ─────────────────────────── pieza (se extiende) ───────────────────────────

ALTER TABLE pieza
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(12)
        CONSTRAINT ck_pieza_tipo CHECK (tipo IN ('insumo', 'insumo_desc', 'consumible')),
    ADD COLUMN IF NOT EXISTS id_material INTEGER REFERENCES material (id),
    ADD COLUMN IF NOT EXISTS id_calidad INTEGER REFERENCES material_calidad (id),
    ADD COLUMN IF NOT EXISTS id_formato INTEGER REFERENCES formato (id),
    ADD COLUMN IF NOT EXISTS sistema_medida VARCHAR(8) NOT NULL DEFAULT 'mm'
        CONSTRAINT ck_pieza_sistema_medida CHECK (sistema_medida IN ('mm', 'pulgada')),
    ADD COLUMN IF NOT EXISTS medida1 NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS medida2 NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS medida3 NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS medida4 NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS medida5 NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS inactivo SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS id_proveedor INTEGER REFERENCES proveedor (id),
    ADD COLUMN IF NOT EXISTS fecha_ultimo_precio DATE,
    ADD COLUMN IF NOT EXISTS origen VARCHAR(10)
        CONSTRAINT ck_pieza_origen CHECK (origen IN ('legacy', 'spmm')),
    ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP,
    ADD COLUMN IF NOT EXISTS creado_por VARCHAR(120),
    ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMP,
    ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(120);

COMMENT ON COLUMN pieza.tipo IS
    'insumo (material + formato + medidas: la descripción se arma sola), insumo_desc '
    '(descripción libre) o consumible. Del viejo pieza.insumo: 0 insumo, 2 insumo_desc, 1 '
    'consumible. NULL = sin clasificar, se trata como insumo_desc.';

COMMENT ON COLUMN pieza.sistema_medida IS
    'En qué se cargaron las medidas: mm o pulgada. Sólo decide cómo se escriben en la '
    'descripción; medida1..5 se guardan SIEMPRE en milímetros.';

COMMENT ON COLUMN pieza.medida1 IS
    'Primera medida del formato, en milímetros (qué es cada una lo dicen '
    'formato.etiqueta1..5). Igual medida2..5.';

COMMENT ON COLUMN pieza.inactivo IS
    '1 = ya no se usa: deja de ofrecerse, pero no se borra porque lo nombran OT, facturas '
    'y movimientos viejos.';

COMMENT ON COLUMN pieza.id_proveedor IS
    'Proveedor preferido, de la lista. La columna de texto pieza.proveedor queda como lo '
    'heredado del viejo, sólo lectura.';

COMMENT ON COLUMN pieza.fecha_ultimo_precio IS
    'De cuándo es pieza.unitario. Se actualiza sólo con un precio de fecha igual o más '
    'nueva (ver pieza_precio).';

COMMENT ON COLUMN pieza.origen IS
    'legacy = vino del sistema viejo; spmm = alta en SPMM. NULL = fila anterior a la '
    'importación del 23/09/2026.';

-- Los códigos se comparan SIEMPRE normalizados: el viejo no distingue mayúsculas y hay
-- códigos con espacios adelante. NO único (duplicado heredado 50%004).
CREATE INDEX IF NOT EXISTS ix_pieza_cod_norm ON pieza (upper(trim(cod_pieza)));

-- ─────────────────────────── stock, precios y recortes ───────────────────────────

CREATE TABLE IF NOT EXISTS pieza_movimiento (
    id BIGSERIAL PRIMARY KEY,
    id_pieza INTEGER NOT NULL REFERENCES pieza (id),
    fecha TIMESTAMP NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    cantidad NUMERIC(18, 3) NOT NULL,
    comentario TEXT,
    id_orden_trabajo INTEGER,
    id_orden_trabajo_pieza INTEGER,
    id_usuario INTEGER,
    usuario VARCHAR(120),
    origen VARCHAR(10) NOT NULL DEFAULT 'spmm',
    anulado SMALLINT NOT NULL DEFAULT 0,
    anulado_en TIMESTAMP,
    anulado_por VARCHAR(120),
    motivo_anulacion TEXT,
    CONSTRAINT ck_pieza_movimiento_cantidad CHECK (cantidad <> 0),
    CONSTRAINT ck_pieza_movimiento_tipo CHECK (tipo IN ('ingreso', 'egreso', 'ajuste', 'retiro_ot')),
    CONSTRAINT ck_pieza_movimiento_signo CHECK ((tipo = 'ingreso' AND cantidad > 0)
        OR (tipo IN ('egreso', 'retiro_ot') AND cantidad < 0) OR tipo = 'ajuste'),
    CONSTRAINT ck_pieza_movimiento_origen CHECK (origen IN ('legacy', 'spmm'))
);

COMMENT ON TABLE pieza_movimiento IS
    'Movimientos de stock de cada insumo (la solapa Stock del viejo). El stock de SPMM es '
    'la SUMA de los no anulados; pieza.stockactual es el caché de esa suma y lo recalcula '
    'el servicio en cada movimiento. Se anula, no se borra.';

COMMENT ON COLUMN pieza_movimiento.tipo IS
    'ingreso (+), egreso (-), ajuste (la diferencia contra el saldo contado, con su signo) '
    'o retiro_ot (-, lo reservado para una OT que se retiró al marcarla disponible; lo '
    'crea y lo anula la línea de la OT, no una persona a mano).';

COMMENT ON COLUMN pieza_movimiento.cantidad IS
    'Con signo: + entra, - sale. Nunca cero. La suma de los no anulados es el stock físico.';

COMMENT ON COLUMN pieza_movimiento.id_orden_trabajo IS
    'La OT del movimiento, si tiene. Sin FK a propósito (igual id_orden_trabajo_pieza): el '
    'material ya salió aunque después se borre la OT o la línea.';

COMMENT ON COLUMN pieza_movimiento.origen IS
    'legacy = importado de MOVSTOCK del sistema viejo; spmm = cargado en SPMM.';

COMMENT ON COLUMN pieza_movimiento.anulado IS
    '1 = anulado: deja de sumar pero sigue a la vista, con quién, cuándo y por qué. Los '
    'movimientos no se borran.';

CREATE INDEX IF NOT EXISTS ix_pieza_movimiento_pieza ON pieza_movimiento (id_pieza, fecha);

CREATE TABLE IF NOT EXISTS pieza_precio (
    id BIGSERIAL PRIMARY KEY,
    id_pieza INTEGER NOT NULL REFERENCES pieza (id),
    fecha DATE NOT NULL,
    precio NUMERIC(18, 4) NOT NULL,
    origen VARCHAR(10) NOT NULL,
    id_proveedor INTEGER REFERENCES proveedor (id),
    usuario VARCHAR(120),
    creado_en TIMESTAMP,
    CONSTRAINT ck_pieza_precio_precio CHECK (precio >= 0),
    CONSTRAINT ck_pieza_precio_origen CHECK (origen IN ('compra', 'manual', 'import'))
);

COMMENT ON TABLE pieza_precio IS
    'Historial de precios de cada insumo. pieza.unitario es sólo el último; esto guarda '
    'cada precio con su fecha y de dónde salió.';

COMMENT ON COLUMN pieza_precio.origen IS
    'compra = factura del sistema viejo (las facturas se siguen haciendo allá); manual = '
    'cargado en SPMM; import = el historial del viejo (HistorialPieza) traído una vez.';

CREATE INDEX IF NOT EXISTS ix_pieza_precio_pieza ON pieza_precio (id_pieza, fecha DESC);

CREATE TABLE IF NOT EXISTS pieza_recorte (
    id BIGSERIAL PRIMARY KEY,
    id_pieza INTEGER NOT NULL REFERENCES pieza (id),
    largo_mm NUMERIC(10, 1),
    ancho_mm NUMERIC(10, 1),
    cantidad INTEGER NOT NULL DEFAULT 1,
    observaciones TEXT,
    texto_original VARCHAR(60),
    estado VARCHAR(12) NOT NULL DEFAULT 'disponible',
    id_orden_trabajo_uso INTEGER,
    creado_en TIMESTAMP,
    creado_por VARCHAR(120),
    usado_en TIMESTAMP,
    usado_por VARCHAR(120),
    origen VARCHAR(10) NOT NULL DEFAULT 'spmm',
    CONSTRAINT ck_pieza_recorte_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_pieza_recorte_estado CHECK (estado IN ('disponible', 'usado', 'descartado')),
    CONSTRAINT ck_pieza_recorte_origen CHECK (origen IN ('legacy', 'spmm'))
);

COMMENT ON TABLE pieza_recorte IS
    'Tramos sobrantes de un insumo (recortes de barra o de chapa). Cada fila es un recorte '
    'físico, o varios iguales con cantidad. Al usarlo no se borra: pasa a usado con la OT '
    'y quién.';

COMMENT ON COLUMN pieza_recorte.texto_original IS
    'Lo que decía el sistema viejo tal cual (1525x3, 3440 (pintado amarillo 1212)): la '
    'conversión a mm no siempre sale.';

COMMENT ON COLUMN pieza_recorte.id_orden_trabajo_uso IS
    'La OT donde se usó. Sin FK a propósito: el recorte ya se usó aunque la OT se borre.';

CREATE INDEX IF NOT EXISTS ix_pieza_recorte_pieza ON pieza_recorte (id_pieza, estado);

-- ─────────────────────────── orden_trabajo_pieza (se extiende) ───────────────────────────

ALTER TABLE orden_trabajo_pieza
    ADD COLUMN IF NOT EXISTS descripcion VARCHAR(255),
    ADD COLUMN IF NOT EXISTS orden SMALLINT,
    ADD COLUMN IF NOT EXISTS proveedor VARCHAR(200),
    ADD COLUMN IF NOT EXISTS id_proveedor INTEGER REFERENCES proveedor (id),
    ADD COLUMN IF NOT EXISTS observaciones TEXT,
    ADD COLUMN IF NOT EXISTS usado SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS reserva SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cantidad_reservada NUMERIC(18, 3)
        CONSTRAINT ck_otp_cantidad_reservada CHECK (cantidad_reservada > 0),
    ADD COLUMN IF NOT EXISTS en_produccion SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fecha_proveedor DATE,
    ADD COLUMN IF NOT EXISTS fecha_entrega DATE,
    ADD COLUMN IF NOT EXISTS pedido_en TIMESTAMP,
    ADD COLUMN IF NOT EXISTS pedido_por VARCHAR(120),
    ADD COLUMN IF NOT EXISTS disponible_en TIMESTAMP,
    ADD COLUMN IF NOT EXISTS disponible_por VARCHAR(120),
    ADD COLUMN IF NOT EXISTS id_movimiento_retiro BIGINT,
    ADD COLUMN IF NOT EXISTS origen VARCHAR(12)
        CONSTRAINT ck_otp_origen CHECK (origen IN ('legacy', 'spmm', 'historial')),
    ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP,
    ADD COLUMN IF NOT EXISTS creado_por VARCHAR(120),
    ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMP,
    ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(120);

COMMENT ON COLUMN orden_trabajo_pieza.descripcion IS
    'Descripción congelada al cargar (copia de pieza.descripcion). Editable sólo si la '
    'pieza no es tipo insumo. NULL = se muestra la de la pieza.';

COMMENT ON COLUMN orden_trabajo_pieza.proveedor IS
    'Proveedor de ESTA compra, como texto (lo que dijo el viejo, o uno que no está en la '
    'lista). id_proveedor es el de la lista cuando se eligió uno.';

COMMENT ON COLUMN orden_trabajo_pieza.usado IS
    'Utilizado del viejo. 0 = la línea no se usa o está a confirmar: no entra en '
    'Pendientes ni en el estado del material de la OT. Arranca en 1 para las que ya estaban.';

COMMENT ON COLUMN orden_trabajo_pieza.reserva IS
    '1 = se reserva del stock propio: cantidad_reservada sale del libre de la pieza hasta '
    'que la línea se marca disponible (ahí se genera el egreso retiro_ot).';

COMMENT ON COLUMN orden_trabajo_pieza.en_produccion IS
    'PRODUC del viejo: marca MANUAL de material en fabricación o tercerizado.';

COMMENT ON COLUMN orden_trabajo_pieza.fecha_proveedor IS
    'Fecha prov. del viejo: la que prometió el proveedor. Día sin hora ni zona.';

COMMENT ON COLUMN orden_trabajo_pieza.fecha_entrega IS
    'F. entrega del viejo: cuándo llegó o quedó disponible. Día sin hora ni zona.';

COMMENT ON COLUMN orden_trabajo_pieza.id_movimiento_retiro IS
    'El egreso retiro_ot (pieza_movimiento) que generó marcar disponible una línea '
    'reservada; desmarcar Disponible lo anula. Sin FK: los movimientos no se borran.';

COMMENT ON COLUMN orden_trabajo_pieza.origen IS
    'legacy = importada del viejo; spmm = cargada en SPMM; historial = copiada de otra OT '
    'con Traer historial. NULL = anterior a la importación del 23/09/2026.';

-- Las líneas de UNA OT (la solapa, el estado del material, Pendientes) y las de UN
-- insumo (su reserva, en qué OT se usó). Ninguna de las dos tenía índice.
CREATE INDEX IF NOT EXISTS ix_otp_ot ON orden_trabajo_pieza (id_orden_trabajo);
CREATE INDEX IF NOT EXISTS ix_otp_pieza ON orden_trabajo_pieza (id_pieza);

-- ─────────────────────────── cortes y cañera ───────────────────────────

CREATE TABLE IF NOT EXISTS orden_trabajo_pieza_corte (
    id BIGSERIAL PRIMARY KEY,
    id_orden_trabajo_pieza INTEGER NOT NULL REFERENCES orden_trabajo_pieza (id) ON DELETE CASCADE,
    cantidad INTEGER NOT NULL,
    largo_mm NUMERIC(10, 1),
    ancho_mm NUMERIC(10, 1),
    texto_original VARCHAR(60),
    orden SMALLINT,
    CONSTRAINT ck_otp_corte_cantidad CHECK (cantidad > 0)
);

COMMENT ON TABLE orden_trabajo_pieza_corte IS
    'Los cortes de una línea de materia prima de la OT (3 x 1093 mm). Con ellos la '
    'pantalla sugiere cuántos metros pedir, sumando el espesor de la sierra por corte. Se '
    'van con la línea (ON DELETE CASCADE).';

COMMENT ON COLUMN orden_trabajo_pieza_corte.texto_original IS
    'Lo que decía el sistema viejo cuando no se pudo leer como medida (80x200x20mm).';

CREATE INDEX IF NOT EXISTS ix_otp_corte_linea ON orden_trabajo_pieza_corte (id_orden_trabajo_pieza);

CREATE TABLE IF NOT EXISTS canera_ocupacion (
    id BIGSERIAL PRIMARY KEY,
    columna VARCHAR(1) NOT NULL,
    fila SMALLINT NOT NULL,
    id_orden_trabajo INTEGER REFERENCES orden_trabajo (id),
    ot_texto VARCHAR(20),
    desde TIMESTAMP NOT NULL,
    hasta TIMESTAMP,
    asignado_por VARCHAR(120),
    liberado_por VARCHAR(120),
    origen VARCHAR(10) NOT NULL DEFAULT 'spmm',
    CONSTRAINT ck_canera_columna CHECK (columna BETWEEN 'A' AND 'O'),
    CONSTRAINT ck_canera_fila CHECK (fila BETWEEN 1 AND 9),
    CONSTRAINT ck_canera_hasta_despues CHECK (hasta IS NULL OR hasta >= desde),
    CONSTRAINT ck_canera_con_ot CHECK (id_orden_trabajo IS NOT NULL OR ot_texto IS NOT NULL),
    CONSTRAINT ck_canera_origen CHECK (origen IN ('legacy', 'spmm'))
);

COMMENT ON TABLE canera_ocupacion IS
    'Qué OT ocupa cada casillero de la cañera (columnas A a O, filas 1 a 9) y desde '
    'cuándo. Liberar es poner hasta; no se borra, así queda el historial. Una OT puede '
    'ocupar varios casilleros; un casillero, una sola OT vigente.';

COMMENT ON COLUMN canera_ocupacion.id_orden_trabajo IS
    'La OT de SPMM. FK sin CASCADE a propósito: borrar la OT libera sus casilleros, copia '
    'el número a ot_texto y suelta esta columna, en la misma transacción.';

COMMENT ON COLUMN canera_ocupacion.ot_texto IS
    'El número tal cual cuando no es una OT de SPMM (la cañera del viejo tiene números que '
    'no existen acá) o cuando la OT se borró.';

COMMENT ON COLUMN canera_ocupacion.hasta IS
    'Cuándo se liberó, hora local del taller sin zona. NULL = ocupado ahora.';

-- Un casillero, una sola OT vigente.
CREATE UNIQUE INDEX IF NOT EXISTS ux_canera_celda_vigente
    ON canera_ocupacion (columna, fila)
    WHERE hasta IS NULL;
