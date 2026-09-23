-- Horas de uso de cada máquina y su mantenimiento preventivo (RF-10)
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-10) «registrar las horas de uso de cada máquina y avisar el
-- mantenimiento». Julián lo pidió así: «que registre las horas al momento de arrancar el
-- proceso con esa máquina y vaya quedando registro de qué OT y proceso se hizo con el
-- tiempo, y una pequeña opción de configurar fechas con el mantenimiento preventivo, que
-- ellos aún no lo hacen, para tenerlo configurado, donde puedas elegir a qué usuario le
-- tiene que llegar el email con la notificación».
--
-- Hasta hoy no había ningún registro de uso: la máquina de un paso vivía en la
-- preselección (orden_trabajo_proceso.id_maquinaria) o en el plan (planificacion), y los
-- dos cambian. El plan se rehace seguido; el registro tiene que decir lo que pasó.
--
-- CÓMO
--
-- `uso_maquina`: un tramo por cada vez que un paso se usó en una máquina. Lo abre pasar
-- el paso a «En proceso» y lo cierra pasarlo a «Terminado» (con las horas corridas y las
-- efectivas); si se reabre, abre otro. La máquina es la elegida a mano en el paso o, si no
-- hay, la del último plan: `origen_maquina` dice cuál. Máquina, persona, OT y proceso se
-- CONGELAN al abrir. Lo escribe solo el backend (infrastructure/UsoMaquinaRepository.py),
-- en un savepoint: si esta tabla no está, el cambio de estado del paso se guarda igual.
--
-- `maquina_mantenimiento` (configuración), `maquina_mantenimiento_hecho` (historial),
-- `maquina_mantenimiento_destinatario` (a quién le llega el email; por defecto a nadie)
-- y `maquina_mantenimiento_aviso` (cada aviso que salió: el índice único por clave es el
-- «una sola vez por vencimiento», y guarda qué pasó con el email). La frecuencia en días
-- NO se duplica: es maquinaria.frecuencia_mantenimiento_dias (RF-08).
--
-- Tablas nuevas y ninguna columna en `maquinaria`, que la lee el planificador y cada
-- pantalla que elige una máquina: si esto no llegara a aplicarse, la lista de máquinas se
-- sigue leyendo igual y sólo no anda lo de RF-10.
--
-- FKs: sólo a `maquinaria`, con ON DELETE CASCADE (borrar una máquina se lleva su uso y
-- su mantenimiento; el borrado lo avisa antes y pide «Eliminar igual»). Sin FK al paso ni
-- a la OT a propósito, como las pausas de RF-03: el guardado completo de una OT borra y
-- recrea pasos, y borrar una OT no puede fallar por un registro viejo. Sin FK a `usuario`
-- en los destinatarios: borrar un usuario no puede fallar por esto (la lectura cruza con
-- usuario y se queda con los activos que tienen email).
--
-- LOCKS
--
-- La primera vez, cada FK toma SHARE ROW EXCLUSIVE sobre `maquinaria` mientras se crea su
-- tabla (vacía: es instantáneo). No frena lecturas y el lock_timeout de migraciones.py lo
-- acota. Las veces siguientes el IF NOT EXISTS corta antes.
--
-- Crea:
--   uso_maquina                          (+ 2 índices, uno de ellos único parcial)
--   maquina_mantenimiento
--   maquina_mantenimiento_hecho          (+ 1 índice)
--   maquina_mantenimiento_destinatario
--   maquina_mantenimiento_aviso          (+ 1 índice único)
-- No toca ninguna fila existente ni ninguna columna de otra tabla.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS uso_maquina (
    id BIGSERIAL PRIMARY KEY,
    id_maquinaria INTEGER NOT NULL REFERENCES maquinaria (id) ON DELETE CASCADE,
    origen_maquina VARCHAR(10) NOT NULL,
    id_orden_trabajo INTEGER NOT NULL,
    numero_ot INTEGER,
    id_otp BIGINT NOT NULL,
    paso INTEGER,
    id_proceso INTEGER,
    nombre_proceso VARCHAR(200),
    id_operario INTEGER,
    operario VARCHAR(200),
    inicio TIMESTAMP NOT NULL,
    fin TIMESTAMP,
    corrido_min INTEGER,
    efectivo_min INTEGER,
    no_suma VARCHAR(30),
    id_usuario_inicio INTEGER,
    usuario_inicio VARCHAR(120),
    id_usuario_fin INTEGER,
    usuario_fin VARCHAR(120),
    CONSTRAINT ck_uso_origen CHECK (origen_maquina IN ('OT', 'PLAN')),
    CONSTRAINT ck_uso_no_suma CHECK (no_suma IS NULL OR no_suma IN ('FUERA_DE_SERVICIO',
        'VUELTA_A_PENDIENTE')),
    CONSTRAINT ck_uso_fin_despues CHECK (fin IS NULL OR fin >= inicio)
);

COMMENT ON TABLE uso_maquina IS
    'Cada tramo en que una máquina se usó en un paso de una OT (RF-10). Lo abre pasar el '
    'paso a En proceso y lo cierra pasarlo a Terminado. Si se reabre, abre otro. Máquina, '
    'persona, OT y proceso quedan congelados al abrir: no cambia si después cambia el plan. '
    'La escribe SPMM, el sync no la mira.';

COMMENT ON COLUMN uso_maquina.origen_maquina IS
    'De dónde salió la máquina: OT = la eligieron a mano en el paso, PLAN = la del último '
    'plan que incluyó ese paso.';

COMMENT ON COLUMN uso_maquina.id_otp IS
    'El paso (orden_trabajo_proceso.id). Sin FK a propósito: el guardado completo de la OT '
    'borra y recrea pasos. Por eso se copian numero_ot, paso y nombre_proceso.';

COMMENT ON COLUMN uso_maquina.operario IS
    'Quién la usó: la persona elegida a mano en el paso o, si no hay, la del último plan '
    '(el sistema no registra quién lo hizo de verdad). Nombre congelado.';

COMMENT ON COLUMN uso_maquina.fin IS
    'Cuándo se cerró el tramo. NULL = sigue en uso. Hora local del taller, sin zona, como '
    'inicio. Uno solo abierto por paso (índice único parcial).';

COMMENT ON COLUMN uso_maquina.efectivo_min IS
    'Minutos adentro de la jornada del taller menos las pausas de RF-03, medidos al cerrar. '
    'corrido_min es el reloj. NULL mientras sigue abierto.';

COMMENT ON COLUMN uso_maquina.no_suma IS
    'Por qué este tramo no suma horas: FUERA_DE_SERVICIO (se arrancó con la máquina fuera de '
    'servicio) o VUELTA_A_PENDIENTE (el paso volvió a Pendiente). NULL = suma.';

CREATE INDEX IF NOT EXISTS ix_uso_maquina_inicio
    ON uso_maquina (id_maquinaria, inicio);

CREATE UNIQUE INDEX IF NOT EXISTS ux_uso_maquina_abierto
    ON uso_maquina (id_otp)
    WHERE fin IS NULL;

CREATE TABLE IF NOT EXISTS maquina_mantenimiento (
    id_maquinaria INTEGER PRIMARY KEY REFERENCES maquinaria (id) ON DELETE CASCADE,
    cada_horas INTEGER,
    dias_aviso INTEGER NOT NULL DEFAULT 3,
    contar_desde DATE,
    actualizado_en TIMESTAMP,
    id_usuario_actualiza INTEGER,
    usuario_actualiza VARCHAR(120),
    CONSTRAINT ck_mant_cada_horas CHECK (cada_horas IS NULL OR cada_horas > 0),
    CONSTRAINT ck_mant_dias_aviso CHECK (dias_aviso >= 0 AND dias_aviso <= 60)
);

COMMENT ON TABLE maquina_mantenimiento IS
    'Configuración del mantenimiento preventivo de una máquina (RF-10). La frecuencia en '
    'días NO está acá: es maquinaria.frecuencia_mantenimiento_dias (RF-08).';

COMMENT ON COLUMN maquina_mantenimiento.cada_horas IS
    'Cada cuántas horas de uso efectivo le toca. NULL = no se cuenta por horas.';

COMMENT ON COLUMN maquina_mantenimiento.contar_desde IS
    'Desde cuándo contar. Se cuenta desde el más nuevo entre esto y el último mantenimiento '
    'registrado. Sin ninguno de los dos no hay próxima fecha ni aviso.';

CREATE TABLE IF NOT EXISTS maquina_mantenimiento_hecho (
    id BIGSERIAL PRIMARY KEY,
    id_maquinaria INTEGER NOT NULL REFERENCES maquinaria (id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    hecho_por VARCHAR(120),
    nota VARCHAR(500),
    cargado_en TIMESTAMP NOT NULL,
    id_usuario_carga INTEGER,
    usuario_carga VARCHAR(120)
);

COMMENT ON TABLE maquina_mantenimiento_hecho IS
    'Historial de mantenimientos hechos de cada máquina (RF-10): el botón Registrar '
    'mantenimiento hecho. El más nuevo es la base de la próxima fecha.';

COMMENT ON COLUMN maquina_mantenimiento_hecho.hecho_por IS
    'Quién lo hizo, como lo escribió quien lo cargó: puede ser un técnico de afuera, sin '
    'usuario. Quien lo cargó va en usuario_carga, tomado del token.';

CREATE INDEX IF NOT EXISTS ix_mant_hecho_maquina
    ON maquina_mantenimiento_hecho (id_maquinaria, fecha);

CREATE TABLE IF NOT EXISTS maquina_mantenimiento_destinatario (
    id_maquinaria INTEGER NOT NULL REFERENCES maquinaria (id) ON DELETE CASCADE,
    id_usuario INTEGER NOT NULL,
    PRIMARY KEY (id_maquinaria, id_usuario)
);

COMMENT ON TABLE maquina_mantenimiento_destinatario IS
    'A qué usuarios les llega por email el aviso de mantenimiento de cada máquina (RF-10). '
    'Sin filas = a nadie, que es como arranca. Sin FK a usuario a propósito.';

CREATE TABLE IF NOT EXISTS maquina_mantenimiento_aviso (
    id BIGSERIAL PRIMARY KEY,
    id_maquinaria INTEGER NOT NULL REFERENCES maquinaria (id) ON DELETE CASCADE,
    clave VARCHAR(80) NOT NULL,
    motivo VARCHAR(20) NOT NULL,
    vence DATE,
    creado_en TIMESTAMP NOT NULL,
    id_notificacion INTEGER,
    email_estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    email_enviados INTEGER NOT NULL DEFAULT 0,
    email_fallidos INTEGER NOT NULL DEFAULT 0,
    email_detalle VARCHAR(500),
    CONSTRAINT ck_mant_aviso_motivo CHECK (motivo IN ('PROXIMO', 'VENCIDO_FECHA',
        'VENCIDO_HORAS')),
    CONSTRAINT ck_mant_aviso_email CHECK (email_estado IN ('PENDIENTE', 'ENVIADO', 'PARCIAL',
        'FALLO', 'SIN_CONFIGURAR', 'SIN_DESTINATARIOS'))
);

COMMENT ON TABLE maquina_mantenimiento_aviso IS
    'Cada aviso de mantenimiento que salió (RF-10): la notificación de la campanita y qué '
    'pasó con el email. Uno solo por vencimiento: índice único por máquina y clave.';

COMMENT ON COLUMN maquina_mantenimiento_aviso.clave IS
    'Qué vencimiento es: fecha:AAAA-MM-DD (la próxima fecha) u horas:AAAA-MM-DD:N (desde qué '
    'día y cada cuántas horas). Registrar un mantenimiento cambia la base y con ella la clave.';

COMMENT ON COLUMN maquina_mantenimiento_aviso.email_estado IS
    'PENDIENTE, ENVIADO, PARCIAL, FALLO, SIN_CONFIGURAR (el servidor no tiene con qué mandar '
    'mails) o SIN_DESTINATARIOS (nadie elegido, o nadie activo con email). No se reintenta.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_mant_aviso_clave
    ON maquina_mantenimiento_aviso (id_maquinaria, clave);
