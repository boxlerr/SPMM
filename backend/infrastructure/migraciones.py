"""Migraciones que se aplican solas al levantar el backend.

POR QUÉ EXISTE ESTO

El backend se deploya A MANO a Cloud Run: entre "subí la imagen" y "está andando"
no hay ningún paso donde alguien corra el .sql. Y una columna nueva no es opcional
para el que lee: SQLAlchemy arma el SELECT con TODAS las columnas del modelo, así
que si la base todavía no la tiene no se rompe la pantalla nueva — se rompe la
lectura de todas las OT. El día que eso pasa, el backend está deployado y la base
no, y desde afuera parece que el deploy salió mal.

Hasta ahora cada repositorio se curaba solo (`_ensure_tabla` en AuditoriaRepository,
`_ensure_columns` en PlanificacionRepository), pero eso sirve cuando la tabla la
escribe SQL a mano y el que la necesita es un solo método. Para una columna del
modelo no alcanza: tiene que estar ANTES de la primera lectura, no antes de la
primera escritura.

El .sql sigue siendo la fuente: vive en backend/scripts/migrations/ con la fecha
adelante, ahí está el POR QUÉ completo y es lo que se corre a mano contra una base
que la app no puede levantar. Acá va sólo el DDL, repetido a propósito: duplicar
unas líneas es más barato y más previsible que leer y ordenar los .sql en el
arranque. Que no se separen lo cuida un test
(tests/test_migraciones_al_arrancar.py), que compara las dos listas de sentencias.

REGLAS

- Idempotente siempre (IF NOT EXISTS): esto corre en CADA arranque y hay varias
  instancias levantando a la vez.
- Nunca levanta. Una base que no deja hacer el ALTER tiene que dar un error visible
  al usar la pantalla, no dejar el servicio sin arrancar.
- **Lo que se pone acá tiene que ser TODO el .sql**, no la parte que parece
  importante. Si el .sql crea un índice o deja un COMMENT y acá van sólo las
  columnas, la base de producción queda distinta del archivo que la documenta y el
  log dice "aplicada" igual. La primera versión de este módulo tenía ese bug.
- **Cada COMMENT es UN solo literal SQL**, aunque en Python vaya partido en varias
  strings: la comilla simple abre en la primera y cierra en la última, nada en el
  medio. El .sql sí puede partirlo en varios literales, porque ahí cada trozo va en
  su renglón y Postgres los pega. Acá quedan pegados sin salto de línea, y Postgres
  lee el `''` del medio como una comilla escapada: el comentario sale con apóstrofos
  sueltos y distinto del .sql, sin error y con el log diciendo "aplicada". Pasó en
  cinco migraciones hasta el 22/09. Las dos del 22/09 ya están corregidas: todavía
  no corrieron en producción, así que el primer arranque escribe el texto bueno.
  Las tres anteriores (09-11 no_lleva_materia_prima, 09-11 inicio_base_del_plan,
  09-15 proceso_no_lleva_maquina) ya corrieron en Supabase y se dejaron como están
  a propósito, hasta que se decida: como acá no hay registro de aplicadas y todo se
  repite en cada arranque, corregirlas reescribe su COMMENT en el próximo deploy
  (sólo el texto, ninguna fila). El test las marca como defecto conocido.
- Sólo Postgres. Producción es Supabase; los tests corren sobre SQLite, donde las
  tablas salen de `Base.metadata` y ya traen todas las columnas.

  OJO CON EL SQL SERVER: `db.py` todavía sabe caer al SQL Server on-prem si se saca
  `SUPABASE_DB_URL` —es el camino de rollback— y esa base NO tiene las columnas que
  se agregan acá ni las va a tener, porque este módulo la saltea. Ese rollback hoy
  rompe la lectura de órdenes con "Invalid column name", y no lo estrena esta
  migración: ya pasaba con `no_lleva_plano` (10/09). Queda dicho para que nadie lo
  descubra el día que necesita el rollback.
"""
import asyncio

from sqlalchemy import text

from backend.commons.loggers.logger import logger
from backend.infrastructure.db import engine

# Cuánto se espera por el lock antes de rendirse.
#
# Un ALTER TABLE toma ACCESS EXCLUSIVE sobre `orden_trabajo`, y Postgres lo toma
# ANTES de evaluar el IF NOT EXISTS: o sea que también el caso "ya estaba", que es
# el de todos los arranques menos el primero, se pone en la cola por el lock más
# fuerte que hay sobre la tabla más caliente de la app. Y la cola de PG es FIFO:
# mientras el ALTER espera, toda consulta nueva contra esa tabla se encola DETRÁS
# de él, también en las instancias que ya estaban andando.
#
# Sin este timeout, una instancia fría levantando justo mientras el planificador
# hace su lectura larga puede dejar `GET /ordenes` colgado en todo el servicio. Con
# 3 segundos, en el peor caso la migración se rinde, loguea el warning y el
# arranque sigue: la próxima instancia la aplica.
LOCK_TIMEOUT = "3s"

# Y un tope para todo el módulo, por si la base ni siquiera contesta: Cloud Run
# corta el arranque a los 240 s y quedarse esperando acá sería el síntoma
# "el deploy no levanta" que este archivo viene a evitar.
TOPE_TOTAL_SEG = 20

# (nombre del .sql, sentencias idempotentes). El nombre es sólo para el log: es lo
# que se busca en backend/scripts/migrations/ cuando algo no se aplicó.
MIGRACIONES: list[tuple[str, list[str]]] = [
    (
        "2026-09-11_modificado_en_ot",
        [
            "ALTER TABLE orden_trabajo "
            "ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(120)",
            "COMMENT ON COLUMN orden_trabajo.modificado_en IS "
            "'Cuándo se tocó esta OT por última vez DESDE SPMM. NULL = nunca se "
            "tocó acá (la trajo el sistema viejo), que no es lo mismo que se desconoce.'",
            "COMMENT ON COLUMN orden_trabajo.modificado_por IS "
            "'Quién la tocó. NULL = no se registró el usuario; nunca un autor inventado.'",
            "CREATE INDEX IF NOT EXISTS ix_orden_trabajo_modificado_en "
            "ON orden_trabajo (modificado_en DESC) WHERE modificado_en IS NOT NULL",
        ],
    ),
    (
        "2026-09-11_no_lleva_materia_prima",
        [
            "ALTER TABLE orden_trabajo "
            "ADD COLUMN IF NOT EXISTS no_lleva_materia_prima SMALLINT NOT NULL DEFAULT 0",
            "COMMENT ON COLUMN orden_trabajo.no_lleva_materia_prima IS "
            "'El taller marcó que esta orden NO necesita materia prima. Distinto de no tener '"
            "'ninguna fila en orden_trabajo_pieza, que sólo dice que nadie cargó la lista. '"
            "'La escribe SPMM; el sync del sistema viejo no la toca.'",
            "CREATE INDEX IF NOT EXISTS ix_orden_trabajo_falta_material "
            "ON orden_trabajo (id) WHERE COALESCE(no_lleva_materia_prima, 0) = 0",
        ],
    ),
    (
        "2026-09-15_numero_de_ot_unico",
        [
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_orden_trabajo_id_otvieja "
            "ON orden_trabajo (id_otvieja) WHERE id_otvieja IS NOT NULL",
        ],
    ),
    (
        "2026-09-15_proceso_no_lleva_maquina",
        [
            "ALTER TABLE orden_trabajo_proceso "
            "ADD COLUMN IF NOT EXISTS no_lleva_maquina SMALLINT NOT NULL DEFAULT 0",
            "COMMENT ON COLUMN orden_trabajo_proceso.no_lleva_maquina IS "
            "'El que cargó la OT marcó que este paso se hace a mano y NO usa máquina. Distinto '"
            "'de id_maquinaria NULL, que significa \"que elija el planificador\" y hace que salga '"
            "'a buscar una. Con esto en 1 el paso entra al plan sin reservar ninguna máquina.'",
            "CREATE INDEX IF NOT EXISTS ix_otp_no_lleva_maquina "
            "ON orden_trabajo_proceso (id_orden_trabajo) "
            "WHERE COALESCE(no_lleva_maquina, 0) = 1",
        ],
    ),
    (
        "2026-09-15_auditoria_movimiento",
        [
            "CREATE TABLE IF NOT EXISTS auditoria_movimiento ("
            "id BIGSERIAL PRIMARY KEY, "
            "creado_en TIMESTAMP NOT NULL, "
            "id_usuario INTEGER, "
            "usuario VARCHAR(120), "
            "accion VARCHAR(20) NOT NULL, "
            "entidad VARCHAR(80) NOT NULL, "
            "id_entidad VARCHAR(40), "
            "descripcion TEXT NOT NULL, "
            "metodo VARCHAR(10) NOT NULL, "
            "ruta VARCHAR(300) NOT NULL, "
            "estado SMALLINT, "
            "duracion_ms INTEGER, "
            "detalle TEXT)",
            "CREATE INDEX IF NOT EXISTS ix_auditoria_mov_creado_en "
            "ON auditoria_movimiento (creado_en DESC)",
            "CREATE INDEX IF NOT EXISTS ix_auditoria_mov_entidad "
            "ON auditoria_movimiento (entidad, id_entidad)",
        ],
    ),
    (
        "2026-09-17_auditoria_proceso_ot",
        [
            "CREATE TABLE IF NOT EXISTS auditoria_proceso_ot ("
            "id BIGSERIAL PRIMARY KEY, "
            "creado_en TIMESTAMP NOT NULL, "
            "id_usuario INTEGER, "
            "usuario VARCHAR(120), "
            "origen VARCHAR(60), "
            "id_orden_trabajo INTEGER NOT NULL, "
            "id_otp BIGINT, "
            "id_proceso INTEGER, "
            "nombre_proceso VARCHAR(200), "
            "accion VARCHAR(10) NOT NULL, "
            "paso INTEGER, "
            "cambios TEXT, "
            "descripcion TEXT NOT NULL, "
            "metodo VARCHAR(10), "
            "ruta VARCHAR(300))",
            "CREATE INDEX IF NOT EXISTS ix_auditoria_proc_ot "
            "ON auditoria_proceso_ot (id_orden_trabajo, creado_en DESC)",
            "CREATE INDEX IF NOT EXISTS ix_auditoria_proc_creado_en "
            "ON auditoria_proceso_ot (creado_en DESC)",
        ],
    ),
    (
        "2026-09-11_inicio_base_del_plan",
        [
            "ALTER TABLE planificacion ADD COLUMN IF NOT EXISTS inicio_base TIMESTAMP",
            "COMMENT ON COLUMN planificacion.inicio_base IS "
            "'El T=0 del plan: a qué momento corresponde inicio_min = 0. Sin esto las fechas '"
            "'del plan se recalculaban desde \"ahora\" en cada lectura y se movían todos los '"
            "'días. NULL = plan anterior al 11/09/2026; para esos se deduce de creado_en.'",
        ],
    ),
    (
        "2026-09-22_alerta_retraso_ot",
        [
            "ALTER TABLE notificacion ADD COLUMN IF NOT EXISTS id_orden_trabajo INTEGER",
            "COMMENT ON COLUMN notificacion.id_orden_trabajo IS "
            "'De qué orden de trabajo habla esta notificación. NULL = no habla de ninguna "
            "(altas de personas, cambios de usuario). Sin FK a propósito: borrar una OT no "
            "tiene que fallar por un aviso viejo. Es además lo que evita repetir el aviso de "
            "retraso en cada corrida del detector.'",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_notificacion_retraso_ot "
            "ON notificacion (id_orden_trabajo) WHERE tipo = 'OT_RETRASADA'",
        ],
    ),
    (
        "2026-09-22_no_conformidades",
        [
            "ALTER TABLE incidencia_proceso "
            "ADD COLUMN IF NOT EXISTS gravedad VARCHAR(10), "
            "ADD COLUMN IF NOT EXISTS estado VARCHAR(10) NOT NULL DEFAULT 'ABIERTA', "
            "ADD COLUMN IF NOT EXISTS piezas_afectadas INTEGER, "
            "ADD COLUMN IF NOT EXISTS accion_correctiva TEXT, "
            "ADD COLUMN IF NOT EXISTS id_usuario INTEGER, "
            "ADD COLUMN IF NOT EXISTS usuario VARCHAR(120), "
            "ADD COLUMN IF NOT EXISTS fecha_cierre TIMESTAMP",
            "COMMENT ON COLUMN incidencia_proceso.gravedad IS "
            "'Qué tan grave fue: LEVE, MEDIA o GRAVE. NULL = sin clasificar, que es como "
            "quedan las cargadas antes del 22/09/2026, cuando el campo no existía en "
            "pantalla. Nunca se completa por default: sería inventar una evaluación que "
            "nadie hizo.'",
            "COMMENT ON COLUMN incidencia_proceso.estado IS "
            "'ABIERTA o CERRADA. Arranca ABIERTA y sólo pasa a CERRADA cuando alguien la "
            "cierra desde la pantalla, que es además cuando se llena fecha_cierre. Las "
            "viejas quedan ABIERTA porque nunca existió la forma de cerrarlas: eso es un "
            "hecho, no un default.'",
            "COMMENT ON COLUMN incidencia_proceso.piezas_afectadas IS "
            "'Cuántas piezas salieron afectadas. NULL = no se registró, que NO es lo mismo "
            "que 0 (ninguna): la diferencia importa para contar rechazos.'",
            "COMMENT ON COLUMN incidencia_proceso.accion_correctiva IS "
            "'Qué se hizo para resolverla, en texto libre. NULL = todavía nada.'",
            "COMMENT ON COLUMN incidencia_proceso.id_usuario IS "
            "'Quién la reportó, tomado del token. NULL = no se registró (las anteriores al "
            "22/09/2026 y las que entren por script); nunca un autor inventado.'",
            "COMMENT ON COLUMN incidencia_proceso.usuario IS "
            "'Nombre y apellido de quien la reportó, congelado al momento de reportarla: si "
            "después se renombra el usuario, el registro de calidad tiene que seguir "
            "diciendo lo que decía.'",
            "COMMENT ON COLUMN incidencia_proceso.fecha_cierre IS "
            "'Cuándo se cerró, en hora local del taller y sin zona (como todas las fechas "
            "de esta base). NULL mientras siga abierta.'",
            "CREATE INDEX IF NOT EXISTS ix_incidencia_ot "
            "ON incidencia_proceso (id_orden_trabajo, fecha_registro DESC)",
            "CREATE INDEX IF NOT EXISTS ix_incidencia_estado "
            "ON incidencia_proceso (estado, fecha_registro DESC)",
        ],
    ),
    (
        # RF-08. Sin esto, el primer GET /maquinarias después del deploy rompe la lista
        # entera de máquinas —y con ella el planificador, que las carga todas—, no sólo
        # lo nuevo: SQLAlchemy pide las tres columnas en cada SELECT.
        "2026-09-22_maquina_tipo_estado_mantenimiento",
        [
            "ALTER TABLE maquinaria "
            "ADD COLUMN IF NOT EXISTS tipo VARCHAR(40), "
            "ADD COLUMN IF NOT EXISTS estado_operativo VARCHAR(20) NOT NULL DEFAULT 'operativa', "
            "ADD COLUMN IF NOT EXISTS frecuencia_mantenimiento_dias INTEGER",
            # Cada COMMENT es UN solo literal SQL partido en varias strings de Python (las
            # comillas simples van sólo al principio y al final). Partirlo en varios
            # literales SQL pegados sin salto de línea no los concatena: Postgres lee el
            # `''` del medio como una comilla escapada y la deja adentro del comentario.
            "COMMENT ON COLUMN maquinaria.tipo IS "
            "'Qué clase de máquina es, de una lista cerrada alineada con las familias del "
            "planificador (TORNO, FRESADORA, PRENSA...; ver MaquinariaService.TIPOS_MAQUINA). "
            "NULL = no se cargó; nunca se completa deduciéndolo del nombre.'",
            "COMMENT ON COLUMN maquinaria.estado_operativo IS "
            "'operativa, en_mantenimiento o fuera_de_servicio. Las máquinas cargadas antes del "
            "22/09/2026 quedaron en operativa por suposición (el taller las estaba usando). Por "
            "ahora es informativo: el planificador todavía no lo mira.'",
            "COMMENT ON COLUMN maquinaria.frecuencia_mantenimiento_dias IS "
            "'Cada cuántos días le toca mantenimiento. NULL = no se le lleva frecuencia, que no "
            "es lo mismo que 0.'",
        ],
    ),
    (
        # RF-15. Tabla nueva y nada más: no se agrega ninguna columna a una tabla que ya
        # se lee, así que si esto no llega a aplicarse lo único que falla es el consumo
        # (la ficha de la OT esconde la columna y sigue andando). No toca filas.
        "2026-09-22_consumo_material",
        [
            "CREATE TABLE IF NOT EXISTS consumo_material ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_orden_trabajo INTEGER NOT NULL REFERENCES orden_trabajo (id), "
            "id_pieza INTEGER NOT NULL REFERENCES pieza (id), "
            "id_orden_trabajo_pieza INTEGER, "
            "cantidad NUMERIC(18, 3) NOT NULL, "
            "unidad VARCHAR(40), "
            "fecha TIMESTAMP NOT NULL, "
            "id_usuario INTEGER, "
            "usuario VARCHAR(120), "
            "observaciones TEXT, "
            "anulado SMALLINT NOT NULL DEFAULT 0, "
            "anulado_en TIMESTAMP, "
            "anulado_por VARCHAR(120), "
            "motivo_anulacion TEXT, "
            "CONSTRAINT ck_consumo_material_cantidad_positiva CHECK (cantidad > 0))",
            # Un solo literal SQL por COMMENT (ver la nota de la migración de arriba).
            "COMMENT ON TABLE consumo_material IS "
            "'Consumo real de material por OT (RF-15). La escribe SPMM; el sync del sistema "
            "viejo no la mira ni la pisa. Distinta de orden_trabajo_pieza.cantidad, que es lo "
            "que la OT PIDE, y de orden_trabajo_pieza.cantusada, que es una copia de "
            "mp.cantstk del viejo. No descuenta stock.'",
            "COMMENT ON COLUMN consumo_material.id_orden_trabajo_pieza IS "
            "'La línea de material de la OT que se consumió, por PK (el par OT-pieza no es "
            "único). Sin FK a propósito: la línea es del sistema viejo y el consumo tiene que "
            "sobrevivir si la borran. NULL = material que no estaba en la lista de la OT.'",
            "COMMENT ON COLUMN consumo_material.cantidad IS "
            "'Cuánto se consumió en ESTA carga, en la unidad de la columna unidad. Siempre "
            "positiva: una carga equivocada se anula, no se compensa con un negativo.'",
            "COMMENT ON COLUMN consumo_material.unidad IS "
            "'La unidad de la línea de la OT (o de la pieza, si no hay línea), copiada al "
            "cargar. Se copia para que el renglón siga diciendo lo mismo aunque el sync cambie "
            "la unidad de la línea.'",
            "COMMENT ON COLUMN consumo_material.fecha IS "
            "'Cuándo se registró, en hora local del taller y sin zona, como todas las fechas de "
            "esta base.'",
            "COMMENT ON COLUMN consumo_material.usuario IS "
            "'Nombre y apellido de quien lo registró, tomado del token y congelado. NULL = no "
            "se registró (un script); nunca un autor inventado.'",
            "COMMENT ON COLUMN consumo_material.anulado IS "
            "'1 = anulado: deja de sumar pero sigue a la vista, con quién y cuándo en "
            "anulado_por y anulado_en. Los consumos no se borran.'",
            "CREATE INDEX IF NOT EXISTS ix_consumo_material_ot "
            "ON consumo_material (id_orden_trabajo, fecha DESC)",
            "CREATE INDEX IF NOT EXISTS ix_consumo_material_pieza "
            "ON consumo_material (id_pieza, fecha DESC)",
        ],
    ),
    (
        # RF-14. Hace falta ANTES de la primera lectura, no de la primera escritura:
        # SQLAlchemy pide `stock_minimo` y `stock_bajo_avisado_en` en cada SELECT de
        # piezas —la solapa Materia Prima, la materia prima de la OT, el consumo— e
        # `id_pieza` en cada lectura de la campanita. Tres columnas nullable: ninguna
        # fila existente cambia, todas quedan «sin mínimo, no se vigila».
        "2026-09-22_stock_minimo",
        [
            "ALTER TABLE pieza "
            "ADD COLUMN IF NOT EXISTS stock_minimo DOUBLE PRECISION, "
            "ADD COLUMN IF NOT EXISTS stock_bajo_avisado_en TIMESTAMP",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN pieza.stock_minimo IS "
            "'Stock mínimo que el pañol quiere vigilar (RF-14). Dato de SPMM: el sistema viejo "
            "no lo tiene y el sync no lo toca. NULL = no se vigila, que es como arrancan todas; "
            "nunca se completa con un valor inventado. Se avisa cuando stockactual < "
            "stock_minimo.'",
            "COMMENT ON COLUMN pieza.stock_bajo_avisado_en IS "
            "'Cuándo se avisó que la pieza quedó abajo del mínimo, en hora local del taller y "
            "sin zona. NULL = no hay aviso vigente. Lo escribe y lo limpia el detector de stock "
            "bajo: mientras siga abajo no se repite el aviso; cuando se recupera vuelve a NULL.'",
            "ALTER TABLE notificacion ADD COLUMN IF NOT EXISTS id_pieza INTEGER",
            "COMMENT ON COLUMN notificacion.id_pieza IS "
            "'De qué pieza (materia prima) habla esta notificación. NULL = de ninguna. Sin FK a "
            "propósito: borrar una pieza no tiene que fallar por un aviso viejo. Es lo que hace "
            "que tocar el aviso de stock bajo lleve a esa pieza.'",
        ],
    ),
    (
        # RF-26. La más delicada de todas para un deploy a mano: SQLAlchemy pide estas
        # dos columnas en CADA SELECT de usuario, y el login es un SELECT de usuario. Si
        # no llegaran a estar, no entra nadie. Por eso van con DEFAULT/NULL y nada más:
        # los usuarios que ya existen quedan en 0 intentos y sin bloqueo, o sea que
        # nadie queda afuera por la migración. No toca filas.
        "2026-09-22_bloqueo_por_intentos_fallidos",
        [
            "ALTER TABLE usuario "
            "ADD COLUMN IF NOT EXISTS intentos_fallidos INTEGER NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMP",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN usuario.intentos_fallidos IS "
            "'Contraseñas incorrectas SEGUIDAS en el login (RF-26). Vuelve a 0 con un ingreso "
            "bueno o cuando un administrador desbloquea la cuenta. Al llegar a 5 se llena "
            "bloqueado_hasta.'",
            "COMMENT ON COLUMN usuario.bloqueado_hasta IS "
            "'Hasta cuándo la cuenta no puede entrar, ni con la contraseña correcta (RF-26). "
            "NULL = no está bloqueada; si ya pasó, tampoco. Bloqueo temporal de 15 minutos que "
            "se levanta solo; un administrador lo puede levantar antes. Hora local del taller, "
            "sin zona.'",
        ],
    ),
    (
        # RF-24. Tablas nuevas, una columna nueva y la siembra del catálogo. Nada de esto
        # toca filas existentes: los usuarios de hoy son todos admin, y admin tiene todo
        # por regla sin mirar ninguna fila. Si no llega a aplicarse, el login y el alta
        # de usuarios siguen andando (admin_permanente está armada para eso en
        # domain/Usuario.py); lo único que no anda es asignar un rol que no sea admin.
        #
        # Esto corre en cada arranque y no puede pisar lo que se cambie desde la pantalla
        # de permisos: el catálogo va con ON CONFLICT DO NOTHING y los roles con su
        # matriz se siembran una sola vez. Un test (test_permisos_migracion) compara la
        # siembra con el .sql y con el catálogo de core/permisos.py.
        "2026-09-22_permisos_por_rol_y_area",
        [
            "CREATE TABLE IF NOT EXISTS area ("
            "codigo VARCHAR(40) PRIMARY KEY, "
            "nombre VARCHAR(80) NOT NULL, "
            "orden INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE IF NOT EXISTS seccion ("
            "codigo VARCHAR(40) PRIMARY KEY, "
            "area_codigo VARCHAR(40) NOT NULL REFERENCES area (codigo) ON DELETE CASCADE, "
            "nombre VARCHAR(80) NOT NULL, "
            "orden INTEGER NOT NULL DEFAULT 0, "
            "confidencial BOOLEAN NOT NULL DEFAULT FALSE)",
            "CREATE TABLE IF NOT EXISTS rol ("
            "codigo VARCHAR(20) PRIMARY KEY, "
            "nombre VARCHAR(80) NOT NULL)",
            "CREATE TABLE IF NOT EXISTS rol_area ("
            "rol_codigo VARCHAR(20) NOT NULL REFERENCES rol (codigo) ON DELETE CASCADE, "
            "area_codigo VARCHAR(40) NOT NULL REFERENCES area (codigo) ON DELETE CASCADE, "
            "nivel VARCHAR(10) NOT NULL, "
            "PRIMARY KEY (rol_codigo, area_codigo), "
            "CONSTRAINT ck_rol_area_nivel CHECK (nivel IN ('none', 'read', 'write', 'admin')))",
            "CREATE TABLE IF NOT EXISTS rol_seccion ("
            "rol_codigo VARCHAR(20) NOT NULL REFERENCES rol (codigo) ON DELETE CASCADE, "
            "seccion_codigo VARCHAR(40) NOT NULL REFERENCES seccion (codigo) ON DELETE CASCADE, "
            "nivel VARCHAR(10) NOT NULL, "
            "PRIMARY KEY (rol_codigo, seccion_codigo), "
            "CONSTRAINT ck_rol_seccion_nivel CHECK (nivel IN ('none', 'read', 'write', 'admin')))",
            "CREATE TABLE IF NOT EXISTS usuario_area ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_usuario INTEGER NOT NULL REFERENCES usuario (id_usuario) ON DELETE CASCADE, "
            "area_codigo VARCHAR(40) NOT NULL REFERENCES area (codigo) ON DELETE CASCADE, "
            "nivel VARCHAR(10) NOT NULL, "
            "vence_en TIMESTAMP, "
            "otorgado_por INTEGER REFERENCES usuario (id_usuario) ON DELETE SET NULL, "
            "motivo TEXT, "
            "creado_en TIMESTAMP NOT NULL, "
            "CONSTRAINT ux_usuario_area UNIQUE (id_usuario, area_codigo), "
            "CONSTRAINT ck_usuario_area_nivel CHECK (nivel IN ('none', 'read', 'write', 'admin')))",
            "CREATE TABLE IF NOT EXISTS usuario_seccion ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_usuario INTEGER NOT NULL REFERENCES usuario (id_usuario) ON DELETE CASCADE, "
            "seccion_codigo VARCHAR(40) NOT NULL REFERENCES seccion (codigo) ON DELETE CASCADE, "
            "nivel VARCHAR(10) NOT NULL, "
            "vence_en TIMESTAMP, "
            "otorgado_por INTEGER REFERENCES usuario (id_usuario) ON DELETE SET NULL, "
            "motivo TEXT, "
            "creado_en TIMESTAMP NOT NULL, "
            "CONSTRAINT ux_usuario_seccion UNIQUE (id_usuario, seccion_codigo), "
            "CONSTRAINT ck_usuario_seccion_nivel CHECK (nivel IN ('none', 'read', 'write', 'admin')))",
            "ALTER TABLE usuario "
            "ADD COLUMN IF NOT EXISTS admin_permanente BOOLEAN NOT NULL DEFAULT FALSE",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE area IS "
            "'Áreas del sistema para los permisos (RF-24): una por ítem del menú. Espeja el "
            "catálogo de backend/core/permisos.py (AREAS), que es el que manda.'",
            "COMMENT ON TABLE seccion IS "
            "'Secciones de un área: una solapa o una parte sensible de una pantalla. Heredan el "
            "nivel del área salvo que sean confidenciales. Espeja SECCIONES de "
            "backend/core/permisos.py.'",
            "COMMENT ON COLUMN seccion.confidencial IS "
            "'TRUE = cerrada para todo el que no sea admin aunque tenga el área, salvo que se le "
            "otorgue a propósito por rol (rol_seccion) o por persona (usuario_seccion).'",
            "COMMENT ON TABLE rol IS "
            "'Roles de usuario. codigo es el mismo string que se guarda en usuario.rol. El rol "
            "admin es admin en todo por regla, sin mirar sus filas de rol_area.'",
            "COMMENT ON TABLE rol_area IS "
            "'Nivel de un rol en un área: none, read, write o admin. Sin fila = none.'",
            "COMMENT ON TABLE rol_seccion IS "
            "'Override de un rol en una sección. En una no confidencial sólo restringe (nunca "
            "sube por encima del área); en una confidencial es lo que la abre.'",
            "COMMENT ON TABLE usuario_area IS "
            "'Permiso de más para una persona en un área. Sólo suma sobre lo que le da el rol, "
            "nunca resta. otorgado_por y motivo dicen quién lo dio y por qué.'",
            "COMMENT ON COLUMN usuario_area.vence_en IS "
            "'Hasta cuándo vale. NULL = permanente; si ya pasó, no cuenta. Hora local del "
            "taller, sin zona.'",
            "COMMENT ON TABLE usuario_seccion IS "
            "'Permiso de más para una persona en una sección: abre una confidencial sin "
            "abrírsela a todo el rol. Sólo suma, nunca resta.'",
            "COMMENT ON COLUMN usuario_seccion.vence_en IS "
            "'Hasta cuándo vale. NULL = permanente; si ya pasó, no cuenta. Hora local del "
            "taller, sin zona.'",
            "COMMENT ON COLUMN usuario.admin_permanente IS "
            "'Administrador permanente (los dueños): su rol queda fijo en admin y la API no deja "
            "cambiárselo, desactivarlo ni eliminarlo. Arranca en FALSE para todos; se marca a "
            "mano en la base.'",
            "INSERT INTO area (codigo, nombre, orden) VALUES "
            "('dashboard', 'Dashboard', 10), "
            "('operaciones', 'Operaciones', 20), "
            "('planos', 'Planos', 30), "
            "('recursos', 'Recursos', 40), "
            "('clientes', 'Clientes', 50), "
            "('no_conformidades', 'No conformidades', 60), "
            "('auditoria', 'Auditoría', 70), "
            "('configuracion', 'Configuración', 80) "
            "ON CONFLICT (codigo) DO NOTHING",
            "INSERT INTO seccion (codigo, area_codigo, nombre, orden, confidencial) VALUES "
            "('dashboard_rendimiento', 'dashboard', 'Rendimiento por persona', 10, TRUE), "
            "('operaciones_ordenes', 'operaciones', 'Órdenes de trabajo', 10, FALSE), "
            "('operaciones_planificador', 'operaciones', 'Planificador', 11, FALSE), "
            "('operaciones_recurso_humano', 'operaciones', 'Recurso humano', 12, FALSE), "
            "('operaciones_materia_prima', 'operaciones', 'Materia prima', 13, FALSE), "
            "('recursos_humano', 'recursos', 'Recurso humano', 10, FALSE), "
            "('recursos_maquinaria', 'recursos', 'Recurso maquinaria', 11, FALSE), "
            "('recursos_procesos', 'recursos', 'Procesos', 12, FALSE), "
            "('recursos_rangos', 'recursos', 'Rangos', 13, FALSE), "
            "('recursos_sectores', 'recursos', 'Sectores', 14, FALSE), "
            "('auditoria_movimientos', 'auditoria', 'Todo lo que se hizo', 10, FALSE), "
            "('auditoria_procesos', 'auditoria', 'Pasos de las OT', 11, FALSE), "
            "('auditoria_planificacion', 'auditoria', 'Planificaciones', 12, FALSE), "
            "('configuracion_usuarios', 'configuracion', 'Usuarios y permisos', 10, TRUE) "
            "ON CONFLICT (codigo) DO NOTHING",
            # Roles y matriz: UNA sola vez, juntos, cuando la tabla rol está vacía. Con ON
            # CONFLICT DO NOTHING en cada arranque, un override o un rol que se borre desde
            # la pantalla volvería solo con el deploy siguiente. Ver el .sql.
            "WITH roles_sembrados AS ("
            "INSERT INTO rol (codigo, nombre) "
            "SELECT v.codigo, v.nombre "
            "FROM (VALUES "
            "('admin', 'Administrador'), "
            "('supervisor', 'Supervisor'), "
            "('operario', 'Operario') "
            ") AS v (codigo, nombre) "
            "WHERE NOT EXISTS (SELECT 1 FROM rol) "
            "RETURNING codigo"
            "), "
            "matriz_por_area AS ("
            "INSERT INTO rol_area (rol_codigo, area_codigo, nivel) "
            "SELECT v.rol_codigo, v.area_codigo, v.nivel "
            "FROM (VALUES "
            "('admin', 'dashboard', 'admin'), "
            "('admin', 'operaciones', 'admin'), "
            "('admin', 'planos', 'admin'), "
            "('admin', 'recursos', 'admin'), "
            "('admin', 'clientes', 'admin'), "
            "('admin', 'no_conformidades', 'admin'), "
            "('admin', 'auditoria', 'admin'), "
            "('admin', 'configuracion', 'admin'), "
            "('supervisor', 'dashboard', 'read'), "
            "('supervisor', 'operaciones', 'write'), "
            "('supervisor', 'planos', 'write'), "
            "('supervisor', 'recursos', 'read'), "
            "('supervisor', 'clientes', 'read'), "
            "('supervisor', 'no_conformidades', 'write'), "
            "('supervisor', 'auditoria', 'none'), "
            "('supervisor', 'configuracion', 'read'), "
            "('operario', 'dashboard', 'read'), "
            "('operario', 'operaciones', 'read'), "
            "('operario', 'planos', 'read'), "
            "('operario', 'recursos', 'none'), "
            "('operario', 'clientes', 'none'), "
            "('operario', 'no_conformidades', 'read'), "
            "('operario', 'auditoria', 'none'), "
            "('operario', 'configuracion', 'read') "
            ") AS v (rol_codigo, area_codigo, nivel) "
            "WHERE v.rol_codigo IN (SELECT codigo FROM roles_sembrados) "
            "RETURNING rol_codigo"
            ") "
            "INSERT INTO rol_seccion (rol_codigo, seccion_codigo, nivel) "
            "SELECT v.rol_codigo, v.seccion_codigo, v.nivel "
            "FROM (VALUES "
            "('operario', 'operaciones_planificador', 'none') "
            ") AS v (rol_codigo, seccion_codigo, nivel) "
            "WHERE v.rol_codigo IN (SELECT codigo FROM roles_sembrados)",
            # El rol admin, siempre (y DESPUÉS de la siembra, que si no no corre nunca).
            "INSERT INTO rol (codigo, nombre) VALUES "
            "('admin', 'Administrador') "
            "ON CONFLICT (codigo) DO NOTHING",
        ],
    ),
    (
        # RF-28. Dos columnas NULL y nada más: nadie cambia de pantalla por la migración.
        # Va DESPUÉS de la de permisos, que crea `rol`; si aquélla no se aplicó, ésta
        # tampoco (misma transacción) y se reintenta en el arranque siguiente. El login no
        # depende de estas columnas (están `deferred` en el ORM y se leen aparte). No se
        # siembra ninguna pantalla por rol: es decisión del taller (ver el .sql).
        "2026-09-22_pantalla_de_inicio",
        [
            "ALTER TABLE usuario "
            "ADD COLUMN IF NOT EXISTS pantalla_inicio VARCHAR(80)",
            "ALTER TABLE rol "
            "ADD COLUMN IF NOT EXISTS pantalla_inicio VARCHAR(80)",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN usuario.pantalla_inicio IS "
            "'Pantalla a la que entra esta persona después del login (RF-28), por ejemplo "
            "/operaciones. Pisa la de su rol. NULL = la de su rol, y si su rol tampoco tiene, el "
            "inicio de siempre. Si no la puede abrir, entra al Dashboard (o a la primera que pueda "
            "ver). Los valores válidos los dice PANTALLAS_DE_INICIO de backend/core/permisos.py.'",
            "COMMENT ON COLUMN rol.pantalla_inicio IS "
            "'Pantalla a la que entran después del login los de este rol que no tienen una propia "
            "(RF-28). NULL = el inicio de siempre: el Dashboard, o la primera pantalla del menú que "
            "puedan ver.'",
        ],
    ),
    (
        # RF-03. Una tabla nueva y nada más: ninguna columna de las tablas que se leen
        # en cada pantalla, así que si esto no llegara a aplicarse las OT se siguen
        # leyendo igual. Lo único que no anda es pausar (y el planificador planifica
        # todo, como antes: lee las pausas en un savepoint y sin la tabla sigue).
        "2026-09-22_pausas_de_ot",
        [
            "CREATE TABLE IF NOT EXISTS orden_trabajo_pausa ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_orden_trabajo INTEGER NOT NULL REFERENCES orden_trabajo (id) ON DELETE CASCADE, "
            "id_otp BIGINT, "
            "paso INTEGER, "
            "nombre_proceso VARCHAR(200), "
            "motivo VARCHAR(30) NOT NULL, "
            "observacion VARCHAR(500), "
            "desde TIMESTAMP NOT NULL, "
            "hasta TIMESTAMP, "
            "cierre VARCHAR(20), "
            "id_usuario_pausa INTEGER, "
            "usuario_pausa VARCHAR(120), "
            "id_usuario_reanuda INTEGER, "
            "usuario_reanuda VARCHAR(120), "
            "CONSTRAINT ck_pausa_motivo CHECK (motivo IN ('FALTA_MATERIAL', 'MAQUINA_ROTA', "
            "'ESPERA_CLIENTE', 'CAMBIO_PRIORIDAD', 'OTRO')), "
            "CONSTRAINT ck_pausa_cierre CHECK (cierre IS NULL OR cierre IN ('REANUDADA', "
            "'PASO_EN_PROCESO', 'PASO_TERMINADO', 'OT_TERMINADA')), "
            "CONSTRAINT ck_pausa_hasta_despues CHECK (hasta IS NULL OR hasta >= desde))",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE orden_trabajo_pausa IS "
            "'Pausas de una OT entera o de uno de sus pasos (RF-03): motivo, desde, hasta y "
            "quién pausó y reanudó. La escribe SPMM; el sync no la mira. No cambia el estado "
            "de ningún paso: un paso en proceso que se pausa sigue en proceso.'",
            "COMMENT ON COLUMN orden_trabajo_pausa.id_otp IS "
            "'El paso pausado (orden_trabajo_proceso.id). NULL = la OT entera. Sin FK a "
            "propósito: el guardado completo de la OT borra y recrea pasos, y la pausa vieja "
            "no puede trabarlo. Por eso se copian paso y nombre_proceso.'",
            "COMMENT ON COLUMN orden_trabajo_pausa.motivo IS "
            "'FALTA_MATERIAL, MAQUINA_ROTA, ESPERA_CLIENTE, CAMBIO_PRIORIDAD u OTRO. Lista "
            "cerrada para poder contar por motivo; con OTRO la observacion es obligatoria.'",
            "COMMENT ON COLUMN orden_trabajo_pausa.desde IS "
            "'Cuándo se pausó, en hora local del taller y sin zona, como todas las fechas de "
            "esta base.'",
            "COMMENT ON COLUMN orden_trabajo_pausa.hasta IS "
            "'Cuándo se reanudó. NULL = sigue pausada. Una sola pausa abierta por OT entera y "
            "una por paso (los dos índices únicos parciales).'",
            "COMMENT ON COLUMN orden_trabajo_pausa.cierre IS "
            "'Cómo terminó: REANUDADA (alguien apretó Reanudar), PASO_EN_PROCESO o "
            "PASO_TERMINADO (se movió el paso pausado) u OT_TERMINADA (se terminaron todos los "
            "pasos). NULL mientras sigue abierta.'",
            "COMMENT ON COLUMN orden_trabajo_pausa.usuario_pausa IS "
            "'Nombre y apellido de quien pausó, tomado del token y congelado. NULL = no se "
            "registró (un script); nunca un autor inventado. Igual usuario_reanuda.'",
            "CREATE INDEX IF NOT EXISTS ix_pausa_ot "
            "ON orden_trabajo_pausa (id_orden_trabajo, desde)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_pausa_abierta_ot "
            "ON orden_trabajo_pausa (id_orden_trabajo) "
            "WHERE hasta IS NULL AND id_otp IS NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_pausa_abierta_paso "
            "ON orden_trabajo_pausa (id_otp) "
            "WHERE hasta IS NULL AND id_otp IS NOT NULL",
        ],
    ),
    (
        # RF-06. Una tabla nueva y nada más: ninguna columna de `operario`, que se lee en
        # cada pantalla, así que si esto no llegara a aplicarse las personas se siguen
        # leyendo igual. Lo único que no anda es la solapa Asistencia de la ficha; el
        # Activo / Ausente se sigue guardando (la anotación va en un savepoint).
        "2026-09-23_ausencias_de_operarios",
        [
            "CREATE TABLE IF NOT EXISTS operario_ausencia ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_operario INTEGER NOT NULL REFERENCES operario (id) ON DELETE CASCADE, "
            "desde DATE NOT NULL, "
            "vuelve DATE, "
            "motivo VARCHAR(20), "
            "observacion VARCHAR(300), "
            "origen VARCHAR(10) NOT NULL DEFAULT 'CARGA', "
            "cargada_en TIMESTAMP NOT NULL, "
            "id_usuario_carga INTEGER, "
            "usuario_carga VARCHAR(120), "
            "cerrada_en TIMESTAMP, "
            "id_usuario_cierre INTEGER, "
            "usuario_cierre VARCHAR(120), "
            "CONSTRAINT ck_ausencia_motivo CHECK (motivo IS NULL OR motivo IN ('VACACIONES', "
            "'ENFERMEDAD', 'LICENCIA', 'PERSONAL', 'OTRO')), "
            "CONSTRAINT ck_ausencia_origen CHECK (origen IN ('ESTADO', 'CARGA')), "
            "CONSTRAINT ck_ausencia_vuelve_despues CHECK (vuelve IS NULL OR vuelve >= desde), "
            "CONSTRAINT ck_ausencia_carga_con_fin CHECK (origen = 'ESTADO' OR vuelve IS NOT NULL))",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE operario_ausencia IS "
            "'Ausencias de cada persona (RF-06): las que abre y cierra el Activo / Ausente de la "
            "ficha y las que se cargan a mano (un día o un período). La escribe SPMM; el sync no "
            "la mira y el planificador tampoco: sigue usando operario.disponible.'",
            "COMMENT ON COLUMN operario_ausencia.desde IS "
            "'Primer día que faltó. Día del taller, sin hora ni zona.'",
            "COMMENT ON COLUMN operario_ausencia.vuelve IS "
            "'Primer día que ya NO falta (medio abierto: faltó de desde a vuelve menos un día). "
            "NULL = sigue ausente, sólo en origen ESTADO. Igual a desde = volvió el mismo día: "
            "queda el registro y suma cero días.'",
            "COMMENT ON COLUMN operario_ausencia.motivo IS "
            "'VACACIONES, ENFERMEDAD, LICENCIA, PERSONAL u OTRO, o NULL si no se dijo. Lista "
            "cerrada para poder contar por motivo; el detalle va en observacion.'",
            "COMMENT ON COLUMN operario_ausencia.origen IS "
            "'ESTADO: la abrió pasar a la persona a Ausente y la cierra volverla a Activo. "
            "CARGA: la cargó alguien a mano, con su fin.'",
            "COMMENT ON COLUMN operario_ausencia.usuario_carga IS "
            "'Nombre y apellido de quien la cargó (o la pasó a Ausente), tomado del token y "
            "congelado. NULL = no se registró; nunca un autor inventado. Igual usuario_cierre.'",
            "CREATE INDEX IF NOT EXISTS ix_ausencia_operario "
            "ON operario_ausencia (id_operario, desde)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_ausencia_abierta "
            "ON operario_ausencia (id_operario) "
            "WHERE vuelve IS NULL",
        ],
    ),
]


async def _aplicar_una(nombre: str, sentencias: list[str], motor=None) -> None:
    # Todas las sentencias de una migración van en la MISMA transacción: media
    # migración aplicada es peor que ninguna, porque el log diría "aplicada".
    async with (motor or engine).begin() as conn:
        await conn.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        for s in sentencias:
            await conn.execute(text(s))


async def aplicar_migraciones(motor=None) -> None:
    """Corre el DDL pendiente. No devuelve nada y no levanta nunca.

    `motor` existe para los tests y NO es un detalle menor: el engine de este módulo
    es el de producción, importado al cargar. Un test que llame a esto sin inyectar
    nada le corre el ALTER a Supabase.
    """
    motor = motor or engine
    if motor.dialect.name != "postgresql":
        logger.info(
            "Migraciones: la base es %s y no Postgres — no se aplica nada.",
            motor.dialect.name,
        )
        return

    for nombre, sentencias in MIGRACIONES:
        try:
            await asyncio.wait_for(_aplicar_una(nombre, sentencias, motor), timeout=TOPE_TOTAL_SEG)
            logger.info(
                "Migraciones: %s aplicada entera (o ya estaba) — %d sentencias.",
                nombre, len(sentencias),
            )
        except Exception as e:
            # Incluye el TimeoutError del wait_for y el lock_timeout de Postgres: en
            # los dos casos la base quedó como estaba y la próxima instancia
            # reintenta. Warning y seguimos: el arranque no se frena por esto.
            logger.warning(
                "Migraciones: NO se pudo aplicar %s: %s. "
                "Corré backend/scripts/migrations/%s.sql a mano.",
                nombre, e, nombre,
            )
