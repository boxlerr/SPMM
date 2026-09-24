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
import re
from typing import Optional

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
# arranque sigue (ver REINTENTOS más abajo: la MISMA instancia vuelve a probar).
LOCK_TIMEOUT = "3s"

# ── Si se rinde, la misma instancia reintenta ──
#
# Antes, una migración que perdía la carrera por el lock (una lectura larga del
# planificador, el sync, una transacción abierta) quedaba sin aplicar hasta que
# ARRANCARA OTRA instancia. Y una columna del modelo que falta tumba la lectura de
# todas las OT: verificado el 24/09 contra un Postgres descartable con un SELECT
# abierto sobre orden_trabajo, `GET /ordenes` quedaba en 500 en esa instancia hasta
# que se la reciclara — 18 rutas en total con la de «estado y control» (RF-11).
#
# Ahora hay dos rondas más:
#   1. Al arrancar, cada migración que falló se reintenta REINTENTOS_AL_ARRANCAR veces
#      con PAUSA_AL_ARRANCAR_SEG de por medio. Casi siempre alcanza: el lock que la
#      frenó era una consulta que ya terminó. Peor caso por migración trabada:
#      (1 + 2) × 3 s de lock + 2 × 2 s de pausa ≈ 13 s, lejos de los 240 s de Cloud Run.
#   2. Si igual quedó alguna, el arranque sigue (nunca se frena por esto) y una tarea
#      en segundo plano las reintenta, en orden, con las esperas de
#      ESPERAS_EN_SEGUNDO_PLANO_SEG (la última se repite) hasta TOPE_SEGUNDO_PLANO_SEG.
#      Cada intento es con el mismo lock_timeout: como mucho encola 3 s las consultas
#      de orden_trabajo, y las esperas crecen para que eso no pase seguido.
#   3. Lo que siga faltando al terminar el arranque sale como ERROR (con los .sql a
#      correr, en orden) y /health contesta 503 hasta que entre: así la revisión de
#      prueba (--set-tags) lo muestra antes de pasarle tráfico. El arranque en sí no
#      se frena: una instancia que no levanta es peor que una que avisa.
# Y antes de contar un intento como fallido se mira si la migración ya está (ver
# `_ya_aplicada`): perder la carrera contra otra instancia no es un error.
#
# Lo que NO cambia: correr los .sql a mano ANTES de subir la imagen sigue siendo lo
# más seguro (son idempotentes y la versión anterior de la app anda sobre la base
# migrada), y después del deploy hay que ver en los logs «aplicada entera» por cada
# una, o pedir /ordenes. Esto es la red por si ese paso se saltea.
REINTENTOS_AL_ARRANCAR = 2
PAUSA_AL_ARRANCAR_SEG = 2.0
ESPERAS_EN_SEGUNDO_PLANO_SEG: tuple[float, ...] = (10, 20, 40, 60, 120, 300)
TOPE_SEGUNDO_PLANO_SEG = 3600

# La tarea de segundo plano, guardada: asyncio sólo guarda una referencia débil a las
# tareas y una sin dueño la puede juntar el recolector a mitad de camino.
_TAREAS: set[asyncio.Task] = set()

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
    (
        # RF-25. Dos índices y un comentario, sobre la tabla del registro (la escribe el
        # middleware, nadie la lee en el día a día): ninguna pantalla depende de que esto
        # se aplique. Sin los índices la búsqueda por persona y la vista Ingresos andan
        # igual, recorriendo la tabla. No reescribe filas.
        "2026-09-23_auditoria_busqueda_e_ingresos",
        [
            "CREATE INDEX IF NOT EXISTS ix_auditoria_mov_usuario_fecha "
            "ON auditoria_movimiento (id_usuario, creado_en DESC)",
            "CREATE INDEX IF NOT EXISTS ix_auditoria_mov_accion_fecha "
            "ON auditoria_movimiento (accion, creado_en DESC)",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN auditoria_movimiento.accion IS "
            "'Qué pasó, en castellano: creó, editó o eliminó (sale del método HTTP) o un verbo "
            "propio (pausó, restauró, desbloqueó...). Desde el 23/09/2026 (RF-25) también los "
            "ingresos: ingresó, salió, intento fallido, cambió su clave, restableció clave, pidió "
            "recuperar y bloqueó. En esas filas id_entidad es la cuenta (usuario.id_usuario), y un "
            "intento fallido o un bloqueo no tienen autor: no se sabe quién tipeó.'",
        ],
    ),
    (
        # RF-17. Un índice PARCIAL (y su comentario) sobre la tabla del registro, para el
        # historial de una OT en Auditoría: los pedidos cuyo número va en el cuerpo. Sin
        # él el historial anda igual, un poco más lento (medido en el .sql). No reescribe
        # filas.
        "2026-09-23_historial_por_ot_y_persona",
        [
            "CREATE INDEX IF NOT EXISTS ix_auditoria_mov_sin_numero "
            "ON auditoria_movimiento (ruta, creado_en) "
            "WHERE id_entidad IS NULL",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON INDEX ix_auditoria_mov_sin_numero IS "
            "'RF-17: los pedidos cuyo número va en el cuerpo y no en la dirección (estado "
            "masivo, materia prima de la OT, consumos y no conformidades que no se pudieron "
            "guardar). Los busca el historial de una OT en Auditoría.'",
        ],
    ),
    (
        # Revisión de RF-25: Ingresos y Actividad por persona pasan a una sección
        # CONFIDENCIAL propia (core/permisos.py). Sólo agrega la fila; si ya está, no la
        # toca (ni su marca de confidencial, que se cambia desde la pantalla).
        "2026-09-23_seccion_ingresos_confidencial",
        [
            "INSERT INTO seccion (codigo, area_codigo, nombre, orden, confidencial) VALUES "
            "('auditoria_ingresos', 'auditoria', 'Ingresos y actividad por persona', 13, TRUE) "
            "ON CONFLICT (codigo) DO NOTHING",
        ],
    ),
    (
        # RF-11: las casillas de «Estado y control» de la ficha vieja que faltaban. Las
        # cuatro marcas van con DEFAULT constante (Postgres 11+ no reescribe la tabla) y
        # las otras tres NULL sin default: no reescribe ninguna fila del cliente. El
        # modelo ya las declara, así que sin esto se cae la lectura de todas las OT.
        "2026-09-23_estados_de_control_ot",
        [
            "ALTER TABLE orden_trabajo "
            "ADD COLUMN IF NOT EXISTS controlado SMALLINT NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS finalizado_para_pintar SMALLINT NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS finalizado_tercerizacion_intermedia SMALLINT NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS finalizado_tercerizacion_final SMALLINT NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS cantidad_finalizada_parcial INTEGER, "
            "ADD COLUMN IF NOT EXISTS controlado_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS controlado_por VARCHAR(120)",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN orden_trabajo.controlado IS "
            "'RF-11: la casilla CONTROLADO de la ficha del sistema viejo (0/1). La marca una "
            "persona desde SPMM; quién y cuándo quedan en controlado_por y controlado_en.'",
            "COMMENT ON COLUMN orden_trabajo.finalizado_para_pintar IS "
            "'RF-11: la casilla FINALIZADO PARA PINTAR de la ficha del sistema viejo (0/1).'",
            "COMMENT ON COLUMN orden_trabajo.finalizado_tercerizacion_intermedia IS "
            "'RF-11: la casilla FINALIZADO TERCERIZACIÓN INTERMEDIA de la ficha del sistema "
            "viejo (0/1).'",
            "COMMENT ON COLUMN orden_trabajo.finalizado_tercerizacion_final IS "
            "'RF-11: la casilla FINALIZADO TERCERIZACIÓN FINAL de la ficha del sistema viejo (0/1).'",
            "COMMENT ON COLUMN orden_trabajo.cantidad_finalizada_parcial IS "
            "'RF-11: el «Cant.» al lado de FINALIZADO PARCIAL: cuántas unidades se terminaron. "
            "No es cantidad_entregada (terminar no es entregar). NULL = no se cargó.'",
            "COMMENT ON COLUMN orden_trabajo.controlado_en IS "
            "'RF-11: cuándo se marcó CONTROLADO desde SPMM, hora local de Argentina sin zona. "
            "Lo pone el backend y lo borra al desmarcarla. NULL con controlado = 1: no se registró.'",
            "COMMENT ON COLUMN orden_trabajo.controlado_por IS "
            "'RF-11: quién marcó CONTROLADO (el nombre, no el id). Lo pone el backend y lo borra "
            "al desmarcarla. NULL = no se sabe quién: nunca un autor inventado.'",
        ],
    ),
    (
        # RF-12, los rechazos: en qué paso, de cuántas controladas y qué se hace con lo
        # rechazado. Sin esto el primer GET de no conformidades después del deploy
        # rompe (SQLAlchemy pide las tres columnas en cada SELECT). Todo nullable y sin
        # default: no reescribe filas.
        "2026-09-23_rechazos_por_paso",
        [
            "ALTER TABLE incidencia_proceso "
            "ADD COLUMN IF NOT EXISTS id_otp BIGINT, "
            "ADD COLUMN IF NOT EXISTS piezas_controladas INTEGER, "
            "ADD COLUMN IF NOT EXISTS disposicion VARCHAR(30)",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN incidencia_proceso.id_otp IS "
            "'En qué paso de la OT se rechazó: orden_trabajo_proceso.id, la pasada y no el "
            "proceso (el mismo proceso puede ir varias veces en una orden). NULL = no se dijo, "
            "o se cargó antes del 23/09/2026. Sin FK a propósito: sacar un paso de la OT no "
            "tiene que fallar por una no conformidad vieja; id_proceso sigue diciendo qué "
            "trabajo era.'",
            "COMMENT ON COLUMN incidencia_proceso.piezas_controladas IS "
            "'De cuántas piezas controladas salieron las rechazadas (piezas_afectadas). "
            "NULL = no se dijo; nunca se completa con las unidades de la OT, porque no "
            "siempre se controla todo.'",
            "COMMENT ON COLUMN incidencia_proceso.disposicion IS "
            "'Qué se hace con lo rechazado: RETRABAJO, DESCARTE, CONCESION (se acepta con "
            "concesión) o DEVOLUCION_PROVEEDOR. NULL = todavía no se decidió. No es la acción "
            "correctiva: ésta dice qué se hizo para que no vuelva a pasar.'",
            "CREATE INDEX IF NOT EXISTS ix_incidencia_operario "
            "ON incidencia_proceso (id_operario, fecha_registro DESC) "
            "WHERE id_operario IS NOT NULL",
        ],
    ),
    (
        # RF-23. Una tabla nueva y nada más: ninguna columna de las tablas que se leen en
        # cada pantalla. Si esto no llegara a aplicarse, el armador de reportes anda igual
        # (armar, ver y exportar no la tocan); lo único que no anda es guardar un reporte.
        "2026-09-23_reportes_guardados",
        [
            "CREATE TABLE IF NOT EXISTS reporte_guardado ("
            "id BIGSERIAL PRIMARY KEY, "
            "nombre VARCHAR(120) NOT NULL, "
            "descripcion VARCHAR(500), "
            "fuente VARCHAR(40) NOT NULL, "
            "config TEXT NOT NULL, "
            "id_usuario INTEGER NOT NULL, "
            "usuario VARCHAR(120), "
            "compartido BOOLEAN NOT NULL DEFAULT FALSE, "
            "creado_en TIMESTAMP NOT NULL, "
            "modificado_en TIMESTAMP)",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE reporte_guardado IS "
            "'Reportes personalizados guardados con nombre (RF-23). Guarda la receta (fuente, "
            "columnas, filtros, agrupación y orden), no el resultado: se valida y se corre de nuevo "
            "cada vez que se abre. La escribe SPMM; el sync no la mira.'",
            "COMMENT ON COLUMN reporte_guardado.config IS "
            "'El reporte como lo arma la pantalla: un JSON con códigos del catálogo cerrado "
            "(backend/application/ReportesCatalogo.py). Nunca SQL ni nombres de tabla o columna.'",
            "COMMENT ON COLUMN reporte_guardado.fuente IS "
            "'El código de la fuente de datos (ordenes, pasos, personas...), repetido afuera del "
            "JSON para listar sin abrirlo. Sin CHECK: las fuentes las dice el catálogo del código.'",
            "COMMENT ON COLUMN reporte_guardado.id_usuario IS "
            "'Quién lo guardó (usuario.id_usuario). Sólo esa persona lo cambia o lo borra.'",
            "COMMENT ON COLUMN reporte_guardado.compartido IS "
            "'TRUE: lo marcó un admin para que lo vean todos, pero cada uno sólo si puede leer su "
            "fuente. FALSE: sólo lo ve quien lo guardó.'",
            "CREATE INDEX IF NOT EXISTS ix_reporte_guardado_usuario "
            "ON reporte_guardado (id_usuario)",
            "CREATE INDEX IF NOT EXISTS ix_reporte_guardado_compartido "
            "ON reporte_guardado (id) "
            "WHERE compartido",
        ],
    ),
    (
        # RF-10. Cinco tablas nuevas y nada más: ninguna columna de `maquinaria`, que se
        # lee en cada pantalla, así que si esto no llegara a aplicarse las máquinas se
        # siguen leyendo igual. Lo único que no anda es el uso y el mantenimiento; el
        # cambio de estado de los pasos se guarda igual (el registro va en un savepoint).
        "2026-09-23_uso_y_mantenimiento_de_maquinas",
        [
            "CREATE TABLE IF NOT EXISTS uso_maquina (id BIGSERIAL PRIMARY KEY, id_maquinaria "
            "INTEGER NOT NULL REFERENCES maquinaria (id) ON DELETE CASCADE, origen_maquina "
            "VARCHAR(10) NOT NULL, id_orden_trabajo INTEGER NOT NULL, numero_ot INTEGER, id_otp "
            "BIGINT NOT NULL, paso INTEGER, id_proceso INTEGER, nombre_proceso VARCHAR(200), "
            "id_operario INTEGER, operario VARCHAR(200), inicio TIMESTAMP NOT NULL, fin "
            "TIMESTAMP, corrido_min INTEGER, efectivo_min INTEGER, no_suma VARCHAR(30), "
            "id_usuario_inicio INTEGER, usuario_inicio VARCHAR(120), id_usuario_fin INTEGER, "
            "usuario_fin VARCHAR(120), CONSTRAINT ck_uso_origen CHECK (origen_maquina IN ('OT', "
            "'PLAN')), CONSTRAINT ck_uso_no_suma CHECK (no_suma IS NULL OR no_suma IN "
            "('FUERA_DE_SERVICIO', 'VUELTA_A_PENDIENTE')), CONSTRAINT ck_uso_fin_despues CHECK "
            "(fin IS NULL OR fin >= inicio))",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE uso_maquina IS 'Cada tramo en que una máquina se usó en un paso de "
            "una OT (RF-10). Lo abre pasar el paso a En proceso y lo cierra pasarlo a Terminado. "
            "Si se reabre, abre otro. Máquina, persona, OT y proceso quedan congelados al abrir: "
            "no cambia si después cambia el plan. La escribe SPMM, el sync no la mira.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN uso_maquina.origen_maquina IS 'De dónde salió la máquina: OT = la "
            "eligieron a mano en el paso, PLAN = la del último plan que incluyó ese paso.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN uso_maquina.id_otp IS 'El paso (orden_trabajo_proceso.id). Sin FK "
            "a propósito: el guardado completo de la OT borra y recrea pasos. Por eso se copian "
            "numero_ot, paso y nombre_proceso.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN uso_maquina.operario IS 'Quién la usó: la persona elegida a mano "
            "en el paso o, si no hay, la del último plan (el sistema no registra quién lo hizo de "
            "verdad). Nombre congelado.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN uso_maquina.fin IS 'Cuándo se cerró el tramo. NULL = sigue en uso. "
            "Hora local del taller, sin zona, como inicio. Uno solo abierto por paso (índice "
            "único parcial).'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN uso_maquina.efectivo_min IS 'Minutos adentro de la jornada del "
            "taller menos las pausas de RF-03, medidos al cerrar. corrido_min es el reloj. NULL "
            "mientras sigue abierto.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN uso_maquina.no_suma IS 'Por qué este tramo no suma horas: "
            "FUERA_DE_SERVICIO (se arrancó con la máquina fuera de servicio) o VUELTA_A_PENDIENTE "
            "(el paso volvió a Pendiente). NULL = suma.'",
            "CREATE INDEX IF NOT EXISTS ix_uso_maquina_inicio ON uso_maquina (id_maquinaria, "
            "inicio)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_uso_maquina_abierto ON uso_maquina (id_otp) "
            "WHERE fin IS NULL",
            "CREATE TABLE IF NOT EXISTS maquina_mantenimiento (id_maquinaria INTEGER PRIMARY KEY "
            "REFERENCES maquinaria (id) ON DELETE CASCADE, cada_horas INTEGER, dias_aviso INTEGER "
            "NOT NULL DEFAULT 3, contar_desde DATE, actualizado_en TIMESTAMP, "
            "id_usuario_actualiza INTEGER, usuario_actualiza VARCHAR(120), CONSTRAINT "
            "ck_mant_cada_horas CHECK (cada_horas IS NULL OR cada_horas > 0), CONSTRAINT "
            "ck_mant_dias_aviso CHECK (dias_aviso >= 0 AND dias_aviso <= 60))",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE maquina_mantenimiento IS 'Configuración del mantenimiento "
            "preventivo de una máquina (RF-10). La frecuencia en días NO está acá: es "
            "maquinaria.frecuencia_mantenimiento_dias (RF-08).'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN maquina_mantenimiento.cada_horas IS 'Cada cuántas horas de uso "
            "efectivo le toca. NULL = no se cuenta por horas.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN maquina_mantenimiento.contar_desde IS 'Desde cuándo contar. Se "
            "cuenta desde el más nuevo entre esto y el último mantenimiento registrado. Sin "
            "ninguno de los dos no hay próxima fecha ni aviso.'",
            "CREATE TABLE IF NOT EXISTS maquina_mantenimiento_hecho (id BIGSERIAL PRIMARY KEY, "
            "id_maquinaria INTEGER NOT NULL REFERENCES maquinaria (id) ON DELETE CASCADE, fecha "
            "DATE NOT NULL, hecho_por VARCHAR(120), nota VARCHAR(500), cargado_en TIMESTAMP NOT "
            "NULL, id_usuario_carga INTEGER, usuario_carga VARCHAR(120))",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE maquina_mantenimiento_hecho IS 'Historial de mantenimientos hechos "
            "de cada máquina (RF-10): el botón Registrar mantenimiento hecho. El más nuevo es la "
            "base de la próxima fecha.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN maquina_mantenimiento_hecho.hecho_por IS 'Quién lo hizo, como lo "
            "escribió quien lo cargó: puede ser un técnico de afuera, sin usuario. Quien lo cargó "
            "va en usuario_carga, tomado del token.'",
            "CREATE INDEX IF NOT EXISTS ix_mant_hecho_maquina ON maquina_mantenimiento_hecho "
            "(id_maquinaria, fecha)",
            "CREATE TABLE IF NOT EXISTS maquina_mantenimiento_destinatario (id_maquinaria INTEGER "
            "NOT NULL REFERENCES maquinaria (id) ON DELETE CASCADE, id_usuario INTEGER NOT NULL, "
            "PRIMARY KEY (id_maquinaria, id_usuario))",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE maquina_mantenimiento_destinatario IS 'A qué usuarios les llega por "
            "email el aviso de mantenimiento de cada máquina (RF-10). Sin filas = a nadie, que es "
            "como arranca. Sin FK a usuario a propósito.'",
            "CREATE TABLE IF NOT EXISTS maquina_mantenimiento_aviso (id BIGSERIAL PRIMARY KEY, "
            "id_maquinaria INTEGER NOT NULL REFERENCES maquinaria (id) ON DELETE CASCADE, clave "
            "VARCHAR(80) NOT NULL, motivo VARCHAR(20) NOT NULL, vence DATE, creado_en TIMESTAMP "
            "NOT NULL, id_notificacion INTEGER, email_estado VARCHAR(20) NOT NULL DEFAULT "
            "'PENDIENTE', email_enviados INTEGER NOT NULL DEFAULT 0, email_fallidos INTEGER NOT "
            "NULL DEFAULT 0, email_detalle VARCHAR(500), CONSTRAINT ck_mant_aviso_motivo CHECK "
            "(motivo IN ('PROXIMO', 'VENCIDO_FECHA', 'VENCIDO_HORAS')), CONSTRAINT "
            "ck_mant_aviso_email CHECK (email_estado IN ('PENDIENTE', 'ENVIADO', 'PARCIAL', "
            "'FALLO', 'SIN_CONFIGURAR', 'SIN_DESTINATARIOS')))",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON TABLE maquina_mantenimiento_aviso IS 'Cada aviso de mantenimiento que "
            "salió (RF-10): la notificación de la campanita y qué pasó con el email. Uno solo por "
            "vencimiento: índice único por máquina y clave.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN maquina_mantenimiento_aviso.clave IS 'Qué vencimiento es: "
            "fecha:AAAA-MM-DD (la próxima fecha) u horas:AAAA-MM-DD:N (desde qué día y cada "
            "cuántas horas). Registrar un mantenimiento cambia la base y con ella la clave.'",
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "COMMENT ON COLUMN maquina_mantenimiento_aviso.email_estado IS 'PENDIENTE, ENVIADO, "
            "PARCIAL, FALLO, SIN_CONFIGURAR (el servidor no tiene con qué mandar mails) o "
            "SIN_DESTINATARIOS (nadie elegido, o nadie activo con email). No se reintenta.'",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_mant_aviso_clave ON maquina_mantenimiento_aviso "
            "(id_maquinaria, clave)",
        ],
    ),
    (
        # Materia prima en SPMM (reunión del 23/09/2026). La más grande de todas y la que
        # MÁS importa que esté antes de la primera lectura: agrega columnas a `pieza` y a
        # `orden_trabajo_pieza`, y SQLAlchemy las pide en cada SELECT de esas dos tablas
        # (la solapa Materias primas de la OT, el estado del material en las listas, los
        # consumos, la campanita de stock bajo). Todas nullable o con DEFAULT constante:
        # no reescribe filas. La semilla de `formato` es la única escritura y es sobre un
        # catálogo nuevo (ON CONFLICT DO NOTHING). Ver el .sql para el porqué de cada cosa.
        "2026-09-23_materia_prima",
        [
            # Un solo literal SQL por COMMENT (ver la nota de la de máquinas).
            "CREATE TABLE IF NOT EXISTS material ("
            "id SERIAL PRIMARY KEY, "
            "nombre VARCHAR(80) NOT NULL, "
            "letra_codigo VARCHAR(2), "
            "activo SMALLINT NOT NULL DEFAULT 1)",
            "COMMENT ON TABLE material IS 'Material de un insumo (ACERO, ALUMINIO, "
            "BRONCE...). En el viejo vivía mezclado con la calidad (dbo.Material) y como "
            "texto suelto en pieza.material. Único sin mirar mayúsculas; los nombres "
            "parecidos NO se fusionan (decisión del cliente).'",
            "COMMENT ON COLUMN material.letra_codigo IS 'La letra con la que empieza el "
            "código de los insumos de este material (ACERO A, BRONCE B). NULL = la primera "
            "letra del nombre.'",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_material_nombre ON material "
            "(upper(nombre))",
            "CREATE TABLE IF NOT EXISTS material_calidad ("
            "id SERIAL PRIMARY KEY, "
            "id_material INTEGER NOT NULL REFERENCES material (id), "
            "nombre VARCHAR(80) NOT NULL, "
            "activo SMALLINT NOT NULL DEFAULT 1, "
            "CONSTRAINT uq_material_calidad UNIQUE (id_material, nombre))",
            "COMMENT ON TABLE material_calidad IS 'Calidad de un material (SAE 1045 del "
            "ACERO, DELRIN de los PLASTICOS). Cuelga del material porque el combo se "
            "filtra por él. En el viejo la calidad sólo vivía en la descripción de la "
            "pieza, después del material.'",
            "CREATE TABLE IF NOT EXISTS formato ("
            "id SERIAL PRIMARY KEY, "
            "nombre VARCHAR(60) NOT NULL UNIQUE, "
            "iniciales VARCHAR(4) NOT NULL, "
            "etiqueta1 VARCHAR(30), "
            "etiqueta2 VARCHAR(30), "
            "etiqueta3 VARCHAR(30), "
            "etiqueta4 VARCHAR(30), "
            "etiqueta5 VARCHAR(30), "
            "orden SMALLINT, "
            "activo SMALLINT NOT NULL DEFAULT 1)",
            "COMMENT ON TABLE formato IS 'Forma en que viene un insumo (BARRA REDONDO, "
            "PLACA...). En el viejo la lista estaba fija en el código; acá cada formato "
            "dice qué mide cada medida (etiqueta1..5) para que el alta pida exactamente "
            "esas y la descripción salga siempre igual.'",
            "COMMENT ON COLUMN formato.iniciales IS 'Las letras del formato en el código "
            "del insumo (ACERO + BARRA CUADRADO = ABC). Repiten las del viejo a propósito, "
            "choques incluidos (BR = redondo y rectangular): el número se comparte por "
            "prefijo y los códigos nuevos siguen la serie.'",
            "COMMENT ON COLUMN formato.etiqueta1 IS 'Qué es la primera medida (Ø, Lado, "
            "Espesor...). La cantidad de medidas del formato es la cantidad de etiquetas "
            "no nulas, siempre las primeras.'",
            "INSERT INTO formato (nombre, iniciales, etiqueta1, orden) VALUES "
            "('BARRA REDONDO', 'BR', 'Ø', 1), "
            "('BARRA CUADRADO', 'BC', 'Lado', 2), "
            "('BARRA HEXAGONAL', 'BH', 'Entre caras', 3) "
            "ON CONFLICT (nombre) DO NOTHING",
            "INSERT INTO formato (nombre, iniciales, etiqueta1, etiqueta2, orden) VALUES "
            "('BARRA RECTANGULAR', 'BR', 'Ancho', 'Espesor', 4), "
            "('TUBO REDONDO', 'TR', 'Ø exterior', 'Ø interior', 5), "
            "('TUBO CUADRADO', 'TC', 'Lado', 'Espesor', 6), "
            "('PLANCHUELA', 'P', 'Ancho', 'Espesor', 9), "
            "('ANGULOS IGUALES', 'AI', 'Ala', 'Espesor', 10), "
            "('CORTE PANTOGRAFO', 'CP', 'Medida', 'Espesor', 14) "
            "ON CONFLICT (nombre) DO NOTHING",
            "INSERT INTO formato (nombre, iniciales, etiqueta1, etiqueta2, etiqueta3, "
            "orden) VALUES "
            "('TUBO RECTANGULAR', 'TR', 'Lado A', 'Lado B', 'Espesor', 7), "
            "('PLACA', 'P', 'Espesor', 'Ancho', 'Largo', 8), "
            "('ANGULOS DESIGUALES', 'AD', 'Ala A', 'Ala B', 'Espesor', 11), "
            "('PERFIL U', 'PU', 'Alto', 'Ala', 'Espesor', 12), "
            "('PERFIL T', 'PT', 'Alto', 'Ala', 'Espesor', 13) "
            "ON CONFLICT (nombre) DO NOTHING",
            "INSERT INTO formato (nombre, iniciales, etiqueta1, etiqueta2, etiqueta3, "
            "etiqueta4, etiqueta5, orden) VALUES "
            "('CORTE LASER', 'CL', 'Medida 1', 'Medida 2', 'Medida 3', 'Medida 4', 'Medida 5', 15) "
            "ON CONFLICT (nombre) DO NOTHING",
            "CREATE TABLE IF NOT EXISTS proveedor ("
            "id SERIAL PRIMARY KEY, "
            "id_legacy INTEGER UNIQUE, "
            "razon_social VARCHAR(200) NOT NULL, "
            "fantasia VARCHAR(200), "
            "cuit VARCHAR(20), "
            "telefono VARCHAR(60), "
            "celular VARCHAR(60), "
            "mail VARCHAR(120), "
            "direccion VARCHAR(200), "
            "localidad VARCHAR(100), "
            "observaciones TEXT, "
            "inactivo SMALLINT NOT NULL DEFAULT 0, "
            "creado_en TIMESTAMP, "
            "creado_por VARCHAR(120))",
            "COMMENT ON TABLE proveedor IS 'A quién se le compra. Hasta el 23/09/2026 SPMM "
            "sólo tenía el texto libre pieza.proveedor copiado del viejo. Un proveedor que "
            "ya no se usa se marca inactivo, no se borra: lo nombran compras viejas.'",
            "COMMENT ON COLUMN proveedor.id_legacy IS 'Clave de dbo.Proveedor del sistema "
            "viejo; la importación hace upsert por acá. NULL = dado de alta en SPMM.'",
            "ALTER TABLE pieza "
            "ADD COLUMN IF NOT EXISTS tipo VARCHAR(12) CONSTRAINT ck_pieza_tipo CHECK "
            "(tipo IN ('insumo', 'insumo_desc', 'consumible')), "
            "ADD COLUMN IF NOT EXISTS id_material INTEGER REFERENCES material (id), "
            "ADD COLUMN IF NOT EXISTS id_calidad INTEGER REFERENCES material_calidad (id), "
            "ADD COLUMN IF NOT EXISTS id_formato INTEGER REFERENCES formato (id), "
            "ADD COLUMN IF NOT EXISTS sistema_medida VARCHAR(8) NOT NULL DEFAULT 'mm' "
            "CONSTRAINT ck_pieza_sistema_medida CHECK (sistema_medida IN ('mm', "
            "'pulgada')), "
            "ADD COLUMN IF NOT EXISTS medida1 NUMERIC(12, 3), "
            "ADD COLUMN IF NOT EXISTS medida2 NUMERIC(12, 3), "
            "ADD COLUMN IF NOT EXISTS medida3 NUMERIC(12, 3), "
            "ADD COLUMN IF NOT EXISTS medida4 NUMERIC(12, 3), "
            "ADD COLUMN IF NOT EXISTS medida5 NUMERIC(12, 3), "
            "ADD COLUMN IF NOT EXISTS inactivo SMALLINT NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS id_proveedor INTEGER REFERENCES proveedor (id), "
            "ADD COLUMN IF NOT EXISTS fecha_ultimo_precio DATE, "
            "ADD COLUMN IF NOT EXISTS origen VARCHAR(10) CONSTRAINT ck_pieza_origen CHECK "
            "(origen IN ('legacy', 'spmm')), "
            "ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS creado_por VARCHAR(120), "
            "ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(120)",
            "COMMENT ON COLUMN pieza.tipo IS 'insumo (material + formato + medidas: la "
            "descripción se arma sola), insumo_desc (descripción libre) o consumible. Del "
            "viejo pieza.insumo: 0 insumo, 2 insumo_desc, 1 consumible. NULL = sin "
            "clasificar, se trata como insumo_desc.'",
            "COMMENT ON COLUMN pieza.sistema_medida IS 'En qué se cargaron las medidas: mm "
            "o pulgada. Sólo decide cómo se escriben en la descripción; medida1..5 se "
            "guardan SIEMPRE en milímetros.'",
            "COMMENT ON COLUMN pieza.medida1 IS 'Primera medida del formato, en milímetros "
            "(qué es cada una lo dicen formato.etiqueta1..5). Igual medida2..5.'",
            "COMMENT ON COLUMN pieza.inactivo IS '1 = ya no se usa: deja de ofrecerse, "
            "pero no se borra porque lo nombran OT, facturas y movimientos viejos.'",
            "COMMENT ON COLUMN pieza.id_proveedor IS 'Proveedor preferido, de la lista. La "
            "columna de texto pieza.proveedor queda como lo heredado del viejo, sólo "
            "lectura.'",
            "COMMENT ON COLUMN pieza.fecha_ultimo_precio IS 'De cuándo es pieza.unitario. "
            "Se actualiza sólo con un precio de fecha igual o más nueva (ver "
            "pieza_precio).'",
            "COMMENT ON COLUMN pieza.origen IS 'legacy = vino del sistema viejo; spmm = "
            "alta en SPMM. NULL = fila anterior a la importación del 23/09/2026.'",
            "CREATE INDEX IF NOT EXISTS ix_pieza_cod_norm ON pieza "
            "(upper(trim(cod_pieza)))",
            "CREATE TABLE IF NOT EXISTS pieza_movimiento ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_pieza INTEGER NOT NULL REFERENCES pieza (id), "
            "fecha TIMESTAMP NOT NULL, "
            "tipo VARCHAR(20) NOT NULL, "
            "cantidad NUMERIC(18, 3) NOT NULL, "
            "comentario TEXT, "
            "id_orden_trabajo INTEGER, "
            "id_orden_trabajo_pieza INTEGER, "
            "id_usuario INTEGER, "
            "usuario VARCHAR(120), "
            "origen VARCHAR(10) NOT NULL DEFAULT 'spmm', "
            "anulado SMALLINT NOT NULL DEFAULT 0, "
            "anulado_en TIMESTAMP, "
            "anulado_por VARCHAR(120), "
            "motivo_anulacion TEXT, "
            "CONSTRAINT ck_pieza_movimiento_cantidad CHECK (cantidad <> 0), "
            "CONSTRAINT ck_pieza_movimiento_tipo CHECK (tipo IN ('ingreso', 'egreso', "
            "'ajuste', 'retiro_ot')), "
            "CONSTRAINT ck_pieza_movimiento_signo CHECK ((tipo = 'ingreso' AND cantidad > "
            "0) OR (tipo IN ('egreso', 'retiro_ot') AND cantidad < 0) OR tipo = 'ajuste'), "
            ""
            "CONSTRAINT ck_pieza_movimiento_origen CHECK (origen IN ('legacy', 'spmm')))",
            "COMMENT ON TABLE pieza_movimiento IS 'Movimientos de stock de cada insumo (la "
            "solapa Stock del viejo). El stock de SPMM es la SUMA de los no anulados; "
            "pieza.stockactual es el caché de esa suma y lo recalcula el servicio en cada "
            "movimiento. Se anula, no se borra.'",
            "COMMENT ON COLUMN pieza_movimiento.tipo IS 'ingreso (+), egreso (-), ajuste "
            "(la diferencia contra el saldo contado, con su signo) o retiro_ot (-, lo "
            "reservado para una OT que se retiró al marcarla disponible; lo crea y lo "
            "anula la línea de la OT, no una persona a mano).'",
            "COMMENT ON COLUMN pieza_movimiento.cantidad IS 'Con signo: + entra, - sale. "
            "Nunca cero. La suma de los no anulados es el stock físico.'",
            "COMMENT ON COLUMN pieza_movimiento.id_orden_trabajo IS 'La OT del movimiento, "
            "si tiene. Sin FK a propósito (igual id_orden_trabajo_pieza): el material ya "
            "salió aunque después se borre la OT o la línea.'",
            "COMMENT ON COLUMN pieza_movimiento.origen IS 'legacy = importado de MOVSTOCK "
            "del sistema viejo; spmm = cargado en SPMM.'",
            "COMMENT ON COLUMN pieza_movimiento.anulado IS '1 = anulado: deja de sumar "
            "pero sigue a la vista, con quién, cuándo y por qué. Los movimientos no se "
            "borran.'",
            "CREATE INDEX IF NOT EXISTS ix_pieza_movimiento_pieza ON pieza_movimiento "
            "(id_pieza, fecha)",
            "CREATE TABLE IF NOT EXISTS pieza_precio ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_pieza INTEGER NOT NULL REFERENCES pieza (id), "
            "fecha DATE NOT NULL, "
            "precio NUMERIC(18, 4) NOT NULL, "
            "origen VARCHAR(10) NOT NULL, "
            "id_proveedor INTEGER REFERENCES proveedor (id), "
            "usuario VARCHAR(120), "
            "creado_en TIMESTAMP, "
            "CONSTRAINT ck_pieza_precio_precio CHECK (precio >= 0), "
            "CONSTRAINT ck_pieza_precio_origen CHECK (origen IN ('compra', 'manual', "
            "'import')))",
            "COMMENT ON TABLE pieza_precio IS 'Historial de precios de cada insumo. "
            "pieza.unitario es sólo el último; esto guarda cada precio con su fecha y de "
            "dónde salió.'",
            "COMMENT ON COLUMN pieza_precio.origen IS 'compra = factura del sistema viejo "
            "(las facturas se siguen haciendo allá); manual = cargado en SPMM; import = el "
            "historial del viejo (HistorialPieza) traído una vez.'",
            "CREATE INDEX IF NOT EXISTS ix_pieza_precio_pieza ON pieza_precio (id_pieza, "
            "fecha DESC)",
            "CREATE TABLE IF NOT EXISTS pieza_recorte ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_pieza INTEGER NOT NULL REFERENCES pieza (id), "
            "largo_mm NUMERIC(10, 1), "
            "ancho_mm NUMERIC(10, 1), "
            "cantidad INTEGER NOT NULL DEFAULT 1, "
            "observaciones TEXT, "
            "texto_original VARCHAR(60), "
            "estado VARCHAR(12) NOT NULL DEFAULT 'disponible', "
            "id_orden_trabajo_uso INTEGER, "
            "creado_en TIMESTAMP, "
            "creado_por VARCHAR(120), "
            "usado_en TIMESTAMP, "
            "usado_por VARCHAR(120), "
            "origen VARCHAR(10) NOT NULL DEFAULT 'spmm', "
            "CONSTRAINT ck_pieza_recorte_cantidad CHECK (cantidad > 0), "
            "CONSTRAINT ck_pieza_recorte_estado CHECK (estado IN ('disponible', 'usado', "
            "'descartado')), "
            "CONSTRAINT ck_pieza_recorte_origen CHECK (origen IN ('legacy', 'spmm')))",
            "COMMENT ON TABLE pieza_recorte IS 'Tramos sobrantes de un insumo (recortes de "
            "barra o de chapa). Cada fila es un recorte físico, o varios iguales con "
            "cantidad. Al usarlo no se borra: pasa a usado con la OT y quién.'",
            "COMMENT ON COLUMN pieza_recorte.texto_original IS 'Lo que decía el sistema "
            "viejo tal cual (1525x3, 3440 (pintado amarillo 1212)): la conversión a mm no "
            "siempre sale.'",
            "COMMENT ON COLUMN pieza_recorte.id_orden_trabajo_uso IS 'La OT donde se usó. "
            "Sin FK a propósito: el recorte ya se usó aunque la OT se borre.'",
            "CREATE INDEX IF NOT EXISTS ix_pieza_recorte_pieza ON pieza_recorte (id_pieza, "
            "estado)",
            "ALTER TABLE orden_trabajo_pieza "
            "ADD COLUMN IF NOT EXISTS descripcion VARCHAR(255), "
            "ADD COLUMN IF NOT EXISTS orden SMALLINT, "
            "ADD COLUMN IF NOT EXISTS proveedor VARCHAR(200), "
            "ADD COLUMN IF NOT EXISTS id_proveedor INTEGER REFERENCES proveedor (id), "
            "ADD COLUMN IF NOT EXISTS observaciones TEXT, "
            "ADD COLUMN IF NOT EXISTS usado SMALLINT NOT NULL DEFAULT 1, "
            "ADD COLUMN IF NOT EXISTS reserva SMALLINT NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS cantidad_reservada NUMERIC(18, 3) CONSTRAINT "
            "ck_otp_cantidad_reservada CHECK (cantidad_reservada > 0), "
            "ADD COLUMN IF NOT EXISTS en_produccion SMALLINT NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS fecha_proveedor DATE, "
            "ADD COLUMN IF NOT EXISTS fecha_entrega DATE, "
            "ADD COLUMN IF NOT EXISTS pedido_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS pedido_por VARCHAR(120), "
            "ADD COLUMN IF NOT EXISTS disponible_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS disponible_por VARCHAR(120), "
            "ADD COLUMN IF NOT EXISTS id_movimiento_retiro BIGINT, "
            "ADD COLUMN IF NOT EXISTS origen VARCHAR(12) CONSTRAINT ck_otp_origen CHECK "
            "(origen IN ('legacy', 'spmm', 'historial')), "
            "ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS creado_por VARCHAR(120), "
            "ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(120)",
            "COMMENT ON COLUMN orden_trabajo_pieza.descripcion IS 'Descripción congelada "
            "al cargar (copia de pieza.descripcion). Editable sólo si la pieza no es tipo "
            "insumo. NULL = se muestra la de la pieza.'",
            "COMMENT ON COLUMN orden_trabajo_pieza.proveedor IS 'Proveedor de ESTA compra, "
            "como texto (lo que dijo el viejo, o uno que no está en la lista). "
            "id_proveedor es el de la lista cuando se eligió uno.'",
            "COMMENT ON COLUMN orden_trabajo_pieza.usado IS 'Utilizado del viejo. 0 = la "
            "línea no se usa o está a confirmar: no entra en Pendientes ni en el estado "
            "del material de la OT. Arranca en 1 para las que ya estaban.'",
            "COMMENT ON COLUMN orden_trabajo_pieza.reserva IS '1 = se reserva del stock "
            "propio: cantidad_reservada sale del libre de la pieza hasta que la línea se "
            "marca disponible (ahí se genera el egreso retiro_ot).'",
            "COMMENT ON COLUMN orden_trabajo_pieza.en_produccion IS 'PRODUC del viejo: "
            "marca MANUAL de material en fabricación o tercerizado.'",
            "COMMENT ON COLUMN orden_trabajo_pieza.fecha_proveedor IS 'Fecha prov. del "
            "viejo: la que prometió el proveedor. Día sin hora ni zona.'",
            "COMMENT ON COLUMN orden_trabajo_pieza.fecha_entrega IS 'F. entrega del viejo: "
            "cuándo llegó o quedó disponible. Día sin hora ni zona.'",
            "COMMENT ON COLUMN orden_trabajo_pieza.id_movimiento_retiro IS 'El egreso "
            "retiro_ot (pieza_movimiento) que generó marcar disponible una línea "
            "reservada; desmarcar Disponible lo anula. Sin FK: los movimientos no se "
            "borran.'",
            "COMMENT ON COLUMN orden_trabajo_pieza.origen IS 'legacy = importada del "
            "viejo; spmm = cargada en SPMM; historial = copiada de otra OT con Traer "
            "historial. NULL = anterior a la importación del 23/09/2026.'",
            "CREATE INDEX IF NOT EXISTS ix_otp_ot ON orden_trabajo_pieza "
            "(id_orden_trabajo)",
            "CREATE INDEX IF NOT EXISTS ix_otp_pieza ON orden_trabajo_pieza (id_pieza)",
            "CREATE TABLE IF NOT EXISTS orden_trabajo_pieza_corte ("
            "id BIGSERIAL PRIMARY KEY, "
            "id_orden_trabajo_pieza INTEGER NOT NULL REFERENCES orden_trabajo_pieza (id) "
            "ON DELETE CASCADE, "
            "cantidad INTEGER NOT NULL, "
            "largo_mm NUMERIC(10, 1), "
            "ancho_mm NUMERIC(10, 1), "
            "texto_original VARCHAR(60), "
            "orden SMALLINT, "
            "CONSTRAINT ck_otp_corte_cantidad CHECK (cantidad > 0))",
            "COMMENT ON TABLE orden_trabajo_pieza_corte IS 'Los cortes de una línea de "
            "materia prima de la OT (3 x 1093 mm). Con ellos la pantalla sugiere cuántos "
            "metros pedir, sumando el espesor de la sierra por corte. Se van con la línea "
            "(ON DELETE CASCADE).'",
            "COMMENT ON COLUMN orden_trabajo_pieza_corte.texto_original IS 'Lo que decía "
            "el sistema viejo cuando no se pudo leer como medida (80x200x20mm).'",
            "CREATE INDEX IF NOT EXISTS ix_otp_corte_linea ON orden_trabajo_pieza_corte "
            "(id_orden_trabajo_pieza)",
            "CREATE TABLE IF NOT EXISTS canera_ocupacion ("
            "id BIGSERIAL PRIMARY KEY, "
            "columna VARCHAR(1) NOT NULL, "
            "fila SMALLINT NOT NULL, "
            "id_orden_trabajo INTEGER REFERENCES orden_trabajo (id), "
            "ot_texto VARCHAR(20), "
            "desde TIMESTAMP NOT NULL, "
            "hasta TIMESTAMP, "
            "asignado_por VARCHAR(120), "
            "liberado_por VARCHAR(120), "
            "origen VARCHAR(10) NOT NULL DEFAULT 'spmm', "
            "CONSTRAINT ck_canera_columna CHECK (columna BETWEEN 'A' AND 'O'), "
            "CONSTRAINT ck_canera_fila CHECK (fila BETWEEN 1 AND 9), "
            "CONSTRAINT ck_canera_hasta_despues CHECK (hasta IS NULL OR hasta >= desde), "
            "CONSTRAINT ck_canera_con_ot CHECK (id_orden_trabajo IS NOT NULL OR ot_texto "
            "IS NOT NULL), "
            "CONSTRAINT ck_canera_origen CHECK (origen IN ('legacy', 'spmm')))",
            "COMMENT ON TABLE canera_ocupacion IS 'Qué OT ocupa cada casillero de la "
            "cañera (columnas A a O, filas 1 a 9) y desde cuándo. Liberar es poner hasta; "
            "no se borra, así queda el historial. Una OT puede ocupar varios casilleros; "
            "un casillero, una sola OT vigente.'",
            "COMMENT ON COLUMN canera_ocupacion.id_orden_trabajo IS 'La OT de SPMM. FK sin "
            "CASCADE a propósito: borrar la OT libera sus casilleros, copia el número a "
            "ot_texto y suelta esta columna, en la misma transacción.'",
            "COMMENT ON COLUMN canera_ocupacion.ot_texto IS 'El número tal cual cuando no "
            "es una OT de SPMM (la cañera del viejo tiene números que no existen acá) o "
            "cuando la OT se borró.'",
            "COMMENT ON COLUMN canera_ocupacion.hasta IS 'Cuándo se liberó, hora local del "
            "taller sin zona. NULL = ocupado ahora.'",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_canera_celda_vigente ON canera_ocupacion "
            "(columna, fila) WHERE hasta IS NULL",
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


# ── ¿Ya quedó aplicada? ──
#
# Cuando un intento falla no siempre es porque la migración falte. Dos casos comunes:
#   - El lock: `ADD COLUMN IF NOT EXISTS` pide ACCESS EXCLUSIVE aunque la columna ya
#     esté (ver LOCK_TIMEOUT). En todos los arranques menos el primero, perder la carrera
#     por el lock NO significa que falte nada.
#   - Varias instancias a la vez: dos `CREATE TABLE IF NOT EXISTS` concurrentes chocan en
#     el índice único de pg_type/pg_class (duplicate key … pg_type_typname_nsp_index) y
#     la que pierde da error aunque la tabla quedó creada por la otra. Lo mismo un
#     `CREATE INDEX IF NOT EXISTS`.
# Antes los dos casos dejaban «NO se pudo aplicar… corré el .sql a mano» en el log con
# la base en orden. Ahora, después del error, se mira el catálogo: si está todo lo que
# la migración crea, alguien (otra instancia, o el .sql a mano) la aplicó entera —cada
# una va en una sola transacción, así que sus COMMENT también quedaron—.
#
# Sólo se afirma lo que se puede mirar: columnas, tablas e índices. Una migración que
# además carga filas (INSERT, WITH) o tiene algo que no se reconoce acá se da por NO
# aplicada, y sigue el camino de los reintentos: mejor un reintento de más que un
# «ya estaba» falso.
_RE_ALTER = re.compile(r"^alter table (\w+) ")
_RE_COLUMNA = re.compile(r"add column if not exists (\w+)")
_RE_TABLA = re.compile(r"^create table if not exists (\w+)")
_RE_INDICE = re.compile(r"^create (?:unique )?index if not exists (\w+)")


def _que_crea(sentencias: list[str]) -> Optional[list[tuple[str, str, Optional[str]]]]:
    """[(tipo, relación, columna)] de lo que deja la migración, o None si tiene algo
    que no se puede verificar mirando el catálogo."""
    objetos: list[tuple[str, str, Optional[str]]] = []
    for s in sentencias:
        t = " ".join(s.split()).lower()
        if t.startswith("comment on "):
            continue  # va en la misma transacción que lo que comenta
        if m := _RE_ALTER.match(t):
            columnas = _RE_COLUMNA.findall(t)
            # Un ALTER que hace otra cosa además de agregar columnas no se verifica.
            if not columnas or len(columnas) != t.count(" add "):
                return None
            objetos += [("columna", m.group(1), c) for c in columnas]
        elif m := _RE_TABLA.match(t):
            objetos.append(("tabla", m.group(1), None))
        elif m := _RE_INDICE.match(t):
            objetos.append(("indice", m.group(1), None))
        else:
            return None
    return objetos or None


async def _ya_aplicada(sentencias: list[str], motor) -> bool:
    """True si en la base está TODO lo que crea la migración. No toma locks sobre las
    tablas (to_regclass y pg_attribute son catálogo) y nunca levanta."""
    objetos = _que_crea(sentencias)
    if objetos is None:
        return False
    try:
        async with motor.connect() as conn:
            for tipo, relacion, columna in objetos:
                if tipo == "columna":
                    hay = await conn.scalar(text(
                        "SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass(:r) "
                        "AND attname = :c AND NOT attisdropped"
                    ), {"r": relacion, "c": columna})
                else:
                    hay = await conn.scalar(text("SELECT count(*) FROM (SELECT to_regclass(:r) "
                                                 "AS o) x WHERE o IS NOT NULL"), {"r": relacion})
                if not hay:
                    return False
    except Exception:
        return False
    return True


# Lo que quedó sin aplicar, para /health (ver `migraciones_pendientes`). Lo actualizan el
# arranque y la tarea de segundo plano.
_PENDIENTES: list[str] = []


def migraciones_pendientes() -> list[str]:
    """Nombres de las migraciones que esta instancia no pudo aplicar (vacío = todo bien).

    Lo mira GET /health, que con alguna pendiente contesta 503 en vez de 200: una columna
    del modelo que falta tumba la lectura de todas las OT, y eso tiene que verse en la
    revisión de prueba (--set-tags) ANTES de pasarle tráfico, no en la pantalla de Lucas.
    """
    return list(_PENDIENTES)


def sql_a_mano(nombre: str) -> str:
    return f"backend/scripts/migrations/{nombre}.sql"


async def _intentar(nombre: str, sentencias: list[str], motor, cuando: str) -> bool:
    """Un intento de una migración. True si quedó aplicada (por éste o por otro); nunca
    levanta."""
    try:
        await asyncio.wait_for(_aplicar_una(nombre, sentencias, motor), timeout=TOPE_TOTAL_SEG)
    except Exception as e:
        # Incluye el TimeoutError del wait_for y el lock_timeout de Postgres: en los
        # dos casos la transacción se deshizo y la base quedó como estaba.
        if await _ya_aplicada(sentencias, motor):
            logger.info(
                "Migraciones: %s ya estaba aplicada (%s); este intento chocó con otro "
                "(%s) y no hace falta nada.", nombre, cuando, type(e).__name__,
            )
            return True
        # Todavía no es para correr nada a mano: se reintenta. El que avisa fuerte es
        # el ERROR del final, si los reintentos no alcanzan.
        logger.warning(
            "Migraciones: %s no entró (%s): %s. Se reintenta sola.", nombre, cuando, e,
        )
        return False
    logger.info(
        "Migraciones: %s aplicada entera (o ya estaba) — %d sentencias%s.",
        nombre, len(sentencias), "" if cuando == "al arrancar" else f", {cuando}",
    )
    return True


async def _una_ronda(pendientes: list[tuple[str, list[str]]], motor,
                     cuando: str) -> list[tuple[str, list[str]]]:
    """Intenta cada una, EN ORDEN (una puede necesitar la anterior: una FK a una tabla
    que crea otra). Devuelve las que siguen sin aplicar."""
    quedan = []
    for nombre, sentencias in pendientes:
        if not await _intentar(nombre, sentencias, motor, cuando):
            quedan.append((nombre, sentencias))
    _PENDIENTES[:] = [n for n, _ in quedan]
    return quedan


def _avisar_fuerte(pendientes: list[tuple[str, list[str]]], cuando: str) -> None:
    """El ERROR que se tiene que ver en los logs de Cloud Run: qué falta y qué correr."""
    logger.error(
        "Migraciones: %s siguen SIN aplicar: %s. En esta instancia falla todo lo que lee "
        "esas tablas (con una columna nueva de orden_trabajo, TODAS las OT dan 500) y "
        "/health contesta 503. Corré a mano, en este orden: %s",
        cuando, ", ".join(n for n, _ in pendientes),
        " ; ".join(sql_a_mano(n) for n, _ in pendientes),
    )


async def _reintentar_en_segundo_plano(pendientes: list[tuple[str, list[str]]], motor,
                                       esperas: tuple[float, ...],
                                       tope_seg: float) -> list[tuple[str, list[str]]]:
    """Reintenta lo que quedó hasta que entre todo o se llegue al tope. Nunca levanta."""
    esperado = 0.0
    vuelta = 0
    try:
        while pendientes:
            espera = esperas[min(vuelta, len(esperas) - 1)]
            if esperado + espera > tope_seg:
                break
            await asyncio.sleep(espera)
            esperado += espera
            vuelta += 1
            pendientes = await _una_ronda(pendientes, motor,
                                          f"reintento {vuelta} en segundo plano")
    except asyncio.CancelledError:
        raise  # la instancia se apaga: nada que avisar
    except Exception as e:  # pragma: no cover — _una_ronda no levanta; por las dudas
        logger.error("Migraciones: se cortaron los reintentos en segundo plano: %s", e)
    if pendientes:
        _avisar_fuerte(pendientes, f"después de {vuelta} reintentos en segundo plano")
    else:
        logger.info("Migraciones: con los reintentos en segundo plano quedó todo aplicado.")
    return pendientes


async def aplicar_migraciones(motor=None, *, segundo_plano: bool = True,
                              pausa_seg: Optional[float] = None,
                              esperas: Optional[tuple[float, ...]] = None,
                              tope_seg: Optional[float] = None) -> list[str]:
    """Corre el DDL pendiente y no levanta nunca. Devuelve los nombres de las que
    quedaron SIN aplicar al terminar el arranque (vacío = todo bien); si hay alguna y
    `segundo_plano`, deja una tarea reintentándolas (ver REINTENTOS arriba). Lo que
    falta queda en `migraciones_pendientes()`, que es lo que mira /health.

    `motor` existe para los tests y NO es un detalle menor: el engine de este módulo
    es el de producción, importado al cargar. Un test que llame a esto sin inyectar
    nada le corre el ALTER a Supabase. `pausa_seg`, `esperas` y `tope_seg` también son
    para los tests (que no esperen minutos).
    """
    motor = motor or engine
    if motor.dialect.name != "postgresql":
        logger.info(
            "Migraciones: la base es %s y no Postgres — no se aplica nada.",
            motor.dialect.name,
        )
        _PENDIENTES.clear()
        return []

    pausa = PAUSA_AL_ARRANCAR_SEG if pausa_seg is None else pausa_seg
    pendientes = await _una_ronda(list(MIGRACIONES), motor, "al arrancar")
    for n in range(REINTENTOS_AL_ARRANCAR):
        if not pendientes:
            break
        await asyncio.sleep(pausa)
        pendientes = await _una_ronda(pendientes, motor, f"reintento {n + 1} al arrancar")

    if pendientes:
        # Fuerte desde ya, aunque siga reintentando: la instancia arranca y atiende
        # así, y el que mira los logs del deploy tiene que verlo sin buscar.
        _avisar_fuerte(pendientes, "al terminar el arranque"
                       + (" (se siguen reintentando en segundo plano)" if segundo_plano else ""))
    if pendientes and segundo_plano:
        tarea = asyncio.create_task(_reintentar_en_segundo_plano(
            pendientes, motor,
            ESPERAS_EN_SEGUNDO_PLANO_SEG if esperas is None else esperas,
            TOPE_SEGUNDO_PLANO_SEG if tope_seg is None else tope_seg,
        ))
        _TAREAS.add(tarea)
        tarea.add_done_callback(_TAREAS.discard)
    return [n for n, _ in pendientes]
