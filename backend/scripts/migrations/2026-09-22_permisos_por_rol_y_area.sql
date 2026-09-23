-- Permisos por rol, área y sección (RF-24)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-24) control de acceso por roles: Administrador, Supervisor y
-- Operario. Hasta hoy SPMM tenía un solo rol de hecho —`admin`, el único que aceptaba
-- el alta de usuarios— y cualquiera con sesión podía hacer todo.
--
-- Se copió el modelo de usuarios y permisos de Don Joaquín (pedido de Julián), que ya
-- anda en producción allá, menos el bloqueo por horario (descartado):
--
--   · Niveles: none < read < write < admin.
--   · Cada ROL tiene un nivel por ÁREA (rol_area). Un área = un ítem del menú.
--   · Una SECCIÓN (una solapa o una parte sensible) hereda el nivel de su área; el rol
--     la puede restringir (rol_seccion), nunca subirla por encima del área.
--   · Una sección CONFIDENCIAL no hereda: está cerrada salvo que se otorgue a
--     propósito, por rol o por persona.
--   · A una PERSONA se le pueden dar permisos de más (usuario_area, usuario_seccion),
--     con vencimiento opcional. Sólo suman, y los vencidos no cuentan.
--   · El rol `admin` es admin en todo por regla, sin mirar ninguna fila.
--
-- Las reglas viven en el código (backend/core/permisos.py) y se verifican en la API,
-- en cada pedido y contra estas tablas. SPMM no usa RLS: acá no hay policies.
--
-- LOS USUARIOS QUE YA EXISTEN
--
-- Hoy son todos `admin`, y `admin` tiene todo por regla: siguen entrando y viendo
-- exactamente lo mismo. Esta migración NO toca ninguna fila de `usuario`: ni el rol ni
-- la columna nueva, que queda en FALSE para todos.
--
-- ADMINISTRADORES PERMANENTES
--
-- `usuario.admin_permanente` marca a los dueños: su rol queda fijo en admin y la API no
-- deja cambiárselo, desactivarlos ni eliminarlos. NO se prende acá para nadie, porque
-- no se conocen los ids de producción: se marca a mano, por ejemplo
--     UPDATE usuario SET admin_permanente = TRUE WHERE username IN ('...');
-- Aparte de eso, la API nunca deja al sistema sin ningún admin activo.
--
-- LA MATRIZ INICIAL
--
-- Conservadora (ante la duda, menos) y PENDIENTE DE VALIDAR CON LUCAS. Está explicada
-- casilla por casilla en backend/core/permisos.py (MATRIZ_ROL_AREA), que es además de
-- donde la toman los tests: un test compara ese catálogo con los INSERT de acá.
--
--                     admin   supervisor  operario
--   dashboard         admin   read        read
--   operaciones       admin   write       read     (el operario no ve el planificador)
--   planos            admin   write       read
--   recursos          admin   read        none
--   clientes          admin   read        none
--   no_conformidades  admin   write       read
--   auditoria         admin   none        none
--   configuracion     admin   read        read
--
-- Confidenciales (cerradas salvo otorgamiento): «Rendimiento por persona» del
-- dashboard y «Usuarios y permisos» de Configuración.
--
-- Esto corre en cada arranque, así que nada de lo sembrado puede pisar lo que se cambie
-- desde la pantalla de permisos: el catálogo (áreas y secciones) va con ON CONFLICT DO
-- NOTHING, y los roles con su matriz se siembran UNA sola vez, cuando la tabla rol está
-- vacía (ver abajo: si no, un override o un rol que se borre volvería solo).
--
-- POR QUÉ ASÍ Y NO DE OTRA FORMA
--
--   · El nivel es VARCHAR + CHECK y no un ENUM: los tests corren en SQLite.
--   · Los roles van por CÓDIGO (el mismo string de usuario.rol): la tabla usuario no
--     se reescribe. usuario.rol NO lleva FK a rol: agregarla validaría todas las filas
--     de usuario y una sola con un rol raro frenaría la migración entera.
--   · Las fechas (vence_en, creado_en) son hora local del taller y sin zona, como
--     todas las de esta base. Sin DEFAULT now(): Supabase está en UTC.
--
-- LOCKS
--
-- Las FK a usuario toman SHARE ROW EXCLUSIVE sobre `usuario` mientras se crean
-- usuario_area y usuario_seccion (vacías: instantáneo). El ADD COLUMN toma ACCESS
-- EXCLUSIVE un instante. El lock_timeout de migraciones.py acota las dos cosas.
--
-- SI ESTO NO LLEGA A APLICARSE
--
-- El login y el alta de usuarios no dependen de nada de acá (la columna nueva está
-- armada para eso en domain/Usuario.py). Un admin sigue teniendo todo. Lo único que
-- falla es asignar un rol que no sea admin, que es justo lo que no tiene que pasar sin
-- estas tablas.
--
-- Crea:
--   area, seccion, rol, rol_area, rol_seccion, usuario_area, usuario_seccion
--   usuario.admin_permanente (BOOLEAN NOT NULL DEFAULT FALSE)
-- Siembra: 8 áreas, 14 secciones, 3 roles y la matriz inicial.
-- No toca ninguna fila existente.
--
-- Idempotente: se puede correr las veces que haga falta. Se aplica sola al levantar
-- el backend (backend/infrastructure/migraciones.py).

CREATE TABLE IF NOT EXISTS area (
    codigo VARCHAR(40) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS seccion (
    codigo VARCHAR(40) PRIMARY KEY,
    area_codigo VARCHAR(40) NOT NULL REFERENCES area (codigo) ON DELETE CASCADE,
    nombre VARCHAR(80) NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0,
    confidencial BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS rol (
    codigo VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS rol_area (
    rol_codigo VARCHAR(20) NOT NULL REFERENCES rol (codigo) ON DELETE CASCADE,
    area_codigo VARCHAR(40) NOT NULL REFERENCES area (codigo) ON DELETE CASCADE,
    nivel VARCHAR(10) NOT NULL,
    PRIMARY KEY (rol_codigo, area_codigo),
    CONSTRAINT ck_rol_area_nivel CHECK (nivel IN ('none', 'read', 'write', 'admin'))
);

CREATE TABLE IF NOT EXISTS rol_seccion (
    rol_codigo VARCHAR(20) NOT NULL REFERENCES rol (codigo) ON DELETE CASCADE,
    seccion_codigo VARCHAR(40) NOT NULL REFERENCES seccion (codigo) ON DELETE CASCADE,
    nivel VARCHAR(10) NOT NULL,
    PRIMARY KEY (rol_codigo, seccion_codigo),
    CONSTRAINT ck_rol_seccion_nivel CHECK (nivel IN ('none', 'read', 'write', 'admin'))
);

CREATE TABLE IF NOT EXISTS usuario_area (
    id BIGSERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL REFERENCES usuario (id_usuario) ON DELETE CASCADE,
    area_codigo VARCHAR(40) NOT NULL REFERENCES area (codigo) ON DELETE CASCADE,
    nivel VARCHAR(10) NOT NULL,
    vence_en TIMESTAMP,
    otorgado_por INTEGER REFERENCES usuario (id_usuario) ON DELETE SET NULL,
    motivo TEXT,
    creado_en TIMESTAMP NOT NULL,
    CONSTRAINT ux_usuario_area UNIQUE (id_usuario, area_codigo),
    CONSTRAINT ck_usuario_area_nivel CHECK (nivel IN ('none', 'read', 'write', 'admin'))
);

CREATE TABLE IF NOT EXISTS usuario_seccion (
    id BIGSERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL REFERENCES usuario (id_usuario) ON DELETE CASCADE,
    seccion_codigo VARCHAR(40) NOT NULL REFERENCES seccion (codigo) ON DELETE CASCADE,
    nivel VARCHAR(10) NOT NULL,
    vence_en TIMESTAMP,
    otorgado_por INTEGER REFERENCES usuario (id_usuario) ON DELETE SET NULL,
    motivo TEXT,
    creado_en TIMESTAMP NOT NULL,
    CONSTRAINT ux_usuario_seccion UNIQUE (id_usuario, seccion_codigo),
    CONSTRAINT ck_usuario_seccion_nivel CHECK (nivel IN ('none', 'read', 'write', 'admin'))
);

ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS admin_permanente BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON TABLE area IS
    'Áreas del sistema para los permisos (RF-24): una por ítem del menú. Espeja el '
    'catálogo de backend/core/permisos.py (AREAS), que es el que manda.';

COMMENT ON TABLE seccion IS
    'Secciones de un área: una solapa o una parte sensible de una pantalla. Heredan el '
    'nivel del área salvo que sean confidenciales. Espeja SECCIONES de '
    'backend/core/permisos.py.';

COMMENT ON COLUMN seccion.confidencial IS
    'TRUE = cerrada para todo el que no sea admin aunque tenga el área, salvo que se le '
    'otorgue a propósito por rol (rol_seccion) o por persona (usuario_seccion).';

COMMENT ON TABLE rol IS
    'Roles de usuario. codigo es el mismo string que se guarda en usuario.rol. El rol '
    'admin es admin en todo por regla, sin mirar sus filas de rol_area.';

COMMENT ON TABLE rol_area IS
    'Nivel de un rol en un área: none, read, write o admin. Sin fila = none.';

COMMENT ON TABLE rol_seccion IS
    'Override de un rol en una sección. En una no confidencial sólo restringe (nunca '
    'sube por encima del área); en una confidencial es lo que la abre.';

COMMENT ON TABLE usuario_area IS
    'Permiso de más para una persona en un área. Sólo suma sobre lo que le da el rol, '
    'nunca resta. otorgado_por y motivo dicen quién lo dio y por qué.';

COMMENT ON COLUMN usuario_area.vence_en IS
    'Hasta cuándo vale. NULL = permanente; si ya pasó, no cuenta. Hora local del '
    'taller, sin zona.';

COMMENT ON TABLE usuario_seccion IS
    'Permiso de más para una persona en una sección: abre una confidencial sin '
    'abrírsela a todo el rol. Sólo suma, nunca resta.';

COMMENT ON COLUMN usuario_seccion.vence_en IS
    'Hasta cuándo vale. NULL = permanente; si ya pasó, no cuenta. Hora local del '
    'taller, sin zona.';

COMMENT ON COLUMN usuario.admin_permanente IS
    'Administrador permanente (los dueños): su rol queda fijo en admin y la API no deja '
    'cambiárselo, desactivarlo ni eliminarlo. Arranca en FALSE para todos; se marca a '
    'mano en la base.';

INSERT INTO area (codigo, nombre, orden) VALUES
    ('dashboard', 'Dashboard', 10),
    ('operaciones', 'Operaciones', 20),
    ('planos', 'Planos', 30),
    ('recursos', 'Recursos', 40),
    ('clientes', 'Clientes', 50),
    ('no_conformidades', 'No conformidades', 60),
    ('auditoria', 'Auditoría', 70),
    ('configuracion', 'Configuración', 80)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO seccion (codigo, area_codigo, nombre, orden, confidencial) VALUES
    ('dashboard_rendimiento', 'dashboard', 'Rendimiento por persona', 10, TRUE),
    ('operaciones_ordenes', 'operaciones', 'Órdenes de trabajo', 10, FALSE),
    ('operaciones_planificador', 'operaciones', 'Planificador', 11, FALSE),
    ('operaciones_recurso_humano', 'operaciones', 'Recurso humano', 12, FALSE),
    ('operaciones_materia_prima', 'operaciones', 'Materia prima', 13, FALSE),
    ('recursos_humano', 'recursos', 'Recurso humano', 10, FALSE),
    ('recursos_maquinaria', 'recursos', 'Recurso maquinaria', 11, FALSE),
    ('recursos_procesos', 'recursos', 'Procesos', 12, FALSE),
    ('recursos_rangos', 'recursos', 'Rangos', 13, FALSE),
    ('recursos_sectores', 'recursos', 'Sectores', 14, FALSE),
    ('auditoria_movimientos', 'auditoria', 'Todo lo que se hizo', 10, FALSE),
    ('auditoria_procesos', 'auditoria', 'Pasos de las OT', 11, FALSE),
    ('auditoria_planificacion', 'auditoria', 'Planificaciones', 12, FALSE),
    ('configuracion_usuarios', 'configuracion', 'Usuarios y permisos', 10, TRUE)
ON CONFLICT (codigo) DO NOTHING;

-- Roles y matriz inicial: se siembran UNA SOLA VEZ y juntos, la primera vez que corre
-- esto (cuando la tabla rol está vacía). No van con ON CONFLICT DO NOTHING como el
-- catálogo porque esto se repite en cada arranque: un override que Lucas saque o un rol
-- que borre desde la pantalla de permisos volverían solos con el deploy siguiente.
-- (El CTE que inserta en rol_area no lo lee nadie: Postgres lo corre igual, entero.
-- Las FK a rol se verifican al final de la sentencia, con los roles ya insertados.)
WITH roles_sembrados AS (
    INSERT INTO rol (codigo, nombre)
    SELECT v.codigo, v.nombre
    FROM (VALUES
        ('admin', 'Administrador'),
        ('supervisor', 'Supervisor'),
        ('operario', 'Operario')
    ) AS v (codigo, nombre)
    WHERE NOT EXISTS (SELECT 1 FROM rol)
    RETURNING codigo
),
matriz_por_area AS (
    INSERT INTO rol_area (rol_codigo, area_codigo, nivel)
    SELECT v.rol_codigo, v.area_codigo, v.nivel
    FROM (VALUES
        ('admin', 'dashboard', 'admin'),
        ('admin', 'operaciones', 'admin'),
        ('admin', 'planos', 'admin'),
        ('admin', 'recursos', 'admin'),
        ('admin', 'clientes', 'admin'),
        ('admin', 'no_conformidades', 'admin'),
        ('admin', 'auditoria', 'admin'),
        ('admin', 'configuracion', 'admin'),
        ('supervisor', 'dashboard', 'read'),
        ('supervisor', 'operaciones', 'write'),
        ('supervisor', 'planos', 'write'),
        ('supervisor', 'recursos', 'read'),
        ('supervisor', 'clientes', 'read'),
        ('supervisor', 'no_conformidades', 'write'),
        ('supervisor', 'auditoria', 'none'),
        ('supervisor', 'configuracion', 'read'),
        ('operario', 'dashboard', 'read'),
        ('operario', 'operaciones', 'read'),
        ('operario', 'planos', 'read'),
        ('operario', 'recursos', 'none'),
        ('operario', 'clientes', 'none'),
        ('operario', 'no_conformidades', 'read'),
        ('operario', 'auditoria', 'none'),
        ('operario', 'configuracion', 'read')
    ) AS v (rol_codigo, area_codigo, nivel)
    WHERE v.rol_codigo IN (SELECT codigo FROM roles_sembrados)
    RETURNING rol_codigo
)
INSERT INTO rol_seccion (rol_codigo, seccion_codigo, nivel)
SELECT v.rol_codigo, v.seccion_codigo, v.nivel
FROM (VALUES
    ('operario', 'operaciones_planificador', 'none')
) AS v (rol_codigo, seccion_codigo, nivel)
WHERE v.rol_codigo IN (SELECT codigo FROM roles_sembrados);

-- El rol admin tiene que estar SIEMPRE: es el de todos los usuarios de hoy y el alta de
-- usuarios lo valida contra esta tabla. Éste sí va en cada arranque (va DESPUÉS de la
-- siembra: antes, la tabla ya no estaría vacía y la siembra no correría nunca).
INSERT INTO rol (codigo, nombre) VALUES
    ('admin', 'Administrador')
ON CONFLICT (codigo) DO NOTHING;
