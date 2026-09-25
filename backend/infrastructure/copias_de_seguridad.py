"""Copias de seguridad desde la app (RF-19): bajar TODO en un archivo y volver a cargarlo.

QUÉ PIDIÓ QUIÉN

SRS de Metalúrgica Longchamps, RF-19: «el sistema deberá permitir al administrador
recuperar un backup desde una interfaz gráfica segura». Julián (22/09): «una opción
para descargar todo en forma de back up y de poder cargar un back up descargado …
hacelo en configuración». Los backups automáticos de Supabase (RF-18/RF-20) siguen
siendo la red grande; esto es la chica, en manos del administrador y sin pedirle nada
a nadie.

EL ARCHIVO

    spmm_backup_2026-09-22_1530.zip
      LEEME.txt              qué es y qué no trae, en castellano
      tablas/<tabla>.jsonl   una fila por renglón: un arreglo JSON con los valores en el
                             orden de `columnas` del manifiesto
      manifiesto.json        formato y versión, cuándo y quién, y por tabla: columnas y
                             tipos (la firma del esquema), cantidad de filas y el sha256
                             de su .jsonl. Y la FIRMA del servidor (ver abajo).

El manifiesto va AL FINAL del zip porque recién ahí se saben las cantidades y los
hashes: la copia se arma mientras se manda (streaming), sin juntar nada en memoria.

LA FIRMA: QUE LA COPIA LA HIZO ESTE SERVIDOR Y NADIE LA TOCÓ

Los sha256 de cada tabla solos no prueban nada: cualquiera que edite un .jsonl los
vuelve a calcular. Por eso el manifiesto va firmado con un HMAC-SHA256 cuya clave sale
de SECRET_KEY (la misma que firma los tokens: quien la tiene ya es dueño del sistema) y
que nunca sale del servidor. Como el manifiesto lleva el sha256 de cada tabla, la firma
cubre la copia entera.

Una copia sin firma válida —editada a mano, o hecha en otra instalación o con otra
SECRET_KEY— se revisa igual (que el zip esté sano, hashes, tipos) pero:
  · NUNCA con los usuarios: usuarios, roles y permisos sólo vuelven de una copia firmada.
  · Para los datos, el admin tiene que confirmarlo aparte («restaurar igual»), después
    de ver el aviso. Avisar y dejar decidir, como en el resto de la app; no frenar a
    quien cambió la clave del servidor y tiene sólo copias viejas.

LO QUE NO VIAJA EN LA COPIA, AUNQUE ESTÉ EN LA BASE

  · Las contraseñas (usuario.password_hash) y los tokens de recuperación
    (usuario.reset_token y su vencimiento): la columna va, con null en cada fila. Un zip
    termina en Descargas, en un mail o en un Drive; un hash se puede atacar fuera de
    línea y un token de recuperación vivo se usa tal cual. Al restaurar, nadie vuelve a
    una contraseña vieja (ver «usuarios», abajo).

QUÉ TABLAS: TODAS LAS QUE HAY EN LA BASE, LEÍDAS DE LA BASE

No una lista escrita a mano, y tampoco sólo los modelos de SQLAlchemy: se lee el
esquema real (MetaData.reflect). Los modelos se quedan cortos por dos lados:

  · Hay tablas del sistema que ningún modelo declara y que se escriben con SQL crudo:
    el calendario del taller (dia_bloqueado), los borradores del plan
    (planificacion_borrador), el historial para deshacer pasos de una OT
    (orden_trabajo_proceso_version), el registro de planificaciones. Una copia sin ellas
    no es una copia.
  · Hay claves foráneas que la base tiene y el modelo no dice: planificacion ->
    orden_trabajo_proceso (2026-08-28_proceso_repetido_en_ot.sql). Con el orden de los
    modelos, la recarga metería el plan antes que los pasos y Postgres la frenaría.

Los modelos igual son el piso: un test exige que toda tabla de un modelo registrado
esté en la copia.

LOS ARCHIVOS DE LOS PLANOS NO VIAJAN

Viven en Supabase Storage (storage_planos.py). La copia trae la tabla `plano` —nombre,
ruta del objeto, a qué OT o artículo cuelga— pero no el archivo. Las columnas binarias
(`plano.archivo`, el camino viejo del blob adentro de la base) tampoco viajan; al
restaurar, lo que haya en ellas se conserva para las filas que la copia trae.

RESTAURAR, EN ORDEN (todo en UNA transacción)

 1. Se revisa el archivo entero ANTES de tocar nada: formato y versión, que sea un zip
    sano y no una bomba, el hash y la cantidad de filas de cada tabla, que cada valor se
    pueda leer con el tipo que la columna tiene HOY. Una tabla o columna que hoy ya no
    existe se informa y se ignora; una columna nueva que la copia no trae queda en su
    valor por defecto (y si es obligatoria y no tiene, no se restaura).
 2. Se bloquean las tablas que se van a reemplazar (nadie escribe mientras tanto).
 3. Se arma una copia del estado actual —la misma de «Descargar»— y se guarda aparte
    (API: Storage, o la que el admin acaba de bajar). Si eso falla, no se sigue.
 4. Se vacían las tablas (TRUNCATE en Postgres) y se recargan en el orden de sus claves
    foráneas. Las secuencias de los id se ponen al máximo: nunca para atrás, así un id
    que ya se usó —y del que habla la auditoría, que se conserva— no se vuelve a dar.
 5. Commit. Si algo falla en el medio, rollback: no queda nada a medias.

LO QUE NO SE RESTAURA, A PROPÓSITO (decisión conservadora, pendiente de validar)

  · Usuarios, roles y permisos: quedan los de ahora. Si no, alguien puede perder el
    acceso a mitad de camino. Hay una opción avanzada que los incluye (sólo con una copia
    firmada), con las mismas reglas que la API de usuarios y permisos (RF-24, RF-26):
      - La cuenta del admin que restaura y las de los administradores permanentes
        (admin_permanente) quedan EXACTAMENTE como están hoy: rol, activa, contraseña.
      - Nadie vuelve a una contraseña vieja: la de cada cuenta que existe hoy queda la de
        hoy, igual que su bloqueo por intentos fallidos y la marca de administrador
        permanente (que sólo se pone a mano en la base, nunca desde una copia).
      - Ninguna cuenta desactivada hoy se reactiva. Una cuenta que hoy no existe y la
        copia trae vuelve DESACTIVADA y sin contraseña (se activa en Usuarios y entra con
        «Olvidé mi contraseña»).
      - La copia no puede dar lo que la API no deja dar: «administrar» en Configuración
        (o más que «ver» en Usuarios y permisos) a un rol que no sea admin o a una
        persona. Se revisa antes de tocar nada.
    La vista previa dice cuenta por cuenta qué pasa. No hay sesiones que cortar: el
    token dice quién sos y la base, en cada pedido, si seguís activo y qué podés.
  · La auditoría: es lo que registra la restauración misma. Borrarla con una copia vieja
    sería borrar justo quién la restauró.

SEGURIDAD DEL ARCHIVO

  · Ningún nombre de tabla o columna que venga del archivo llega a un SQL: se compara
    contra el esquema real y se usan los objetos de SQLAlchemy de la base (los
    identificadores los cita el dialecto). Lo que no coincide se ignora.
  · Nada de pickle ni eval: JSON y nada más, con topes de tamaño por archivo, por renglón
    y en total, y de relación comprimido/descomprimido (bomba de zip).
  · Una fila de `plano` sólo vuelve si su ruta tiene la forma exacta de una ruta de plano
    (storage_planos.es_ruta_de_plano): una que apunte a la carpeta de las copias
    automáticas —que traen todos los datos— haría que cualquiera que ve planos la baje.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import io
import json
import re
import tempfile
import uuid
import warnings
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, AsyncIterator, Awaitable, BinaryIO, Callable, Iterator, Optional

import anyio
from sqlalchemy import MetaData, Table, exc as sa_exc, func, null, select, text, tuple_, update
from sqlalchemy.sql import sqltypes

import backend.domain  # noqa: F401  registra los modelos en Base.metadata
from backend.core.config import settings
from backend.core.permisos import ROL_ADMIN, rango
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
from backend.domain.Permisos import (
    AreaPermiso,
    Rol,
    RolArea,
    RolSeccion,
    SeccionPermiso,
    UsuarioArea,
    UsuarioSeccion,
)
from backend.domain.Plano import Plano
from backend.domain.Usuario import Usuario
from backend.infrastructure import storage_planos
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.infrastructure.db import Base

# ─────────────────────────── el formato ───────────────────────────

FORMATO = "spmm-copia-de-seguridad"
VERSION = 1
# Las versiones que esta app sabe leer. Una copia de una versión más nueva se rechaza
# con un mensaje claro en vez de adivinar.
VERSIONES_QUE_SE_LEEN = (1,)

MANIFIESTO = "manifiesto.json"
LEEME = "LEEME.txt"
CARPETA = "tablas/"

# ─────────────────────────── los topes ───────────────────────────
#
# Cloud Run corta los pedidos de más de 32 MB: el archivo que se sube no puede pasar de
# acá (el resto del pedido multipart entra en lo que sobra). La copia comprimida de hoy
# anda muy por debajo; si algún día no entra, la pantalla lo dice al bajarla.
LIMITE_SUBIDA = 30 * 1024 * 1024
# Bomba de zip: lo que se descomprime. Un JSON de filas comprime 5-20 veces; 300 es
# holgado para una tabla muy repetida y todavía corta un zip armado para reventar.
LIMITE_DESCOMPRIMIDO = 1024 * 1024 * 1024
LIMITE_POR_ARCHIVO = 512 * 1024 * 1024
LIMITE_RELACION = 300
LIMITE_MANIFIESTO = 8 * 1024 * 1024
# Un renglón = una fila. El más grande es un borrador del plan (un JSON con cientos de
# pasos): unos pocos MB. Esto corta un «renglón» de cientos de MB sin salto de línea.
LIMITE_LINEA = 32 * 1024 * 1024
LIMITE_ENTRADAS = 2000

# Cuántas filas por INSERT al recargar y por lectura al copiar.
LOTE = 1000

# Cuánto puede tardar UNA página de la copia antes de darla por colgada (ver _pagina).
# Una página es una consulta corta por el índice de la clave: tarda milisegundos. Esto
# no es un tiempo esperable sino el techo para una base que no contesta.
TOPE_PAGINA_S = 120

# Identificadores válidos. No es la defensa (la defensa es no usar nunca un nombre del
# archivo en un SQL: se compara contra el esquema real), es para ni siquiera leer lo raro.
_NOMBRE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
NOMBRE_DE_ARCHIVO = re.compile(r"^spmm_backup_\d{4}-\d{2}-\d{2}_\d{4,6}(_antes-de-restaurar)?\.zip$")

# ─────────────────────────── los grupos ───────────────────────────
#
# Se nombran por el MODELO (un renombre se arrastra solo). Las dos del registro de
# planificaciones no tienen modelo: las escribe AuditoriaRepository con SQL crudo.
TABLAS_DE_ACCESO = frozenset(
    m.__tablename__ for m in (Usuario, AreaPermiso, SeccionPermiso, Rol, RolArea, RolSeccion,
                              UsuarioArea, UsuarioSeccion)
)
TABLAS_DE_AUDITORIA = frozenset({
    AuditoriaMovimiento.__tablename__,
    AuditoriaProcesoOT.__tablename__,
    "planificacion_intento",
    "planificacion_borrada",
})

# ─────────────────────────── lo que no viaja ───────────────────────────
#
# Columnas que van en la copia VACÍAS (null en cada fila): la columna está, el valor no.
# Ver «LO QUE NO VIAJA» arriba. Un test exige que sean columnas del modelo.
COLUMNAS_QUE_NO_VIAJAN = {
    Usuario.__tablename__: ("password_hash", "reset_token", "reset_token_expiry"),
}

# ─────────────────────────── usuarios (la opción avanzada) ───────────────────────────
#
# De una cuenta que existe hoy, esto queda como está hoy aunque la copia diga otra cosa:
# nadie vuelve a una contraseña vieja ni a un token de recuperación viejo, un bloqueo por
# intentos fallidos (RF-26) no se levanta restaurando, y la marca de administrador
# permanente (RF-24) sólo se pone a mano en la base. `activo` no está: se combina (ver
# restaurar_copia). Las que no existen en la base de hoy se saltean solas.
CAMPOS_DE_HOY = ("password_hash", "reset_token", "reset_token_expiry", "intentos_fallidos",
                 "bloqueado_hasta", "debe_cambiar_password", "admin_permanente")

# La contraseña de una cuenta que vuelve y hoy no existe. No es un hash de bcrypt: no
# coincide con ninguna clave (verify_password da False) y se reemplaza con «Olvidé mi
# contraseña». La cuenta vuelve además desactivada.
CLAVE_INUSABLE = "!sin-clave: volvió con una copia de seguridad"

# Lo que la API de permisos no deja dar a ningún rol que no sea admin ni a ninguna
# persona (PermisosAPI._TOPE_AREA y _TOPE_SECCION; un test exige que sean iguales). Una
# copia que lo trae no se restaura con los usuarios.
TOPE_AREA_NO_ADMIN = {"configuracion": "write"}
TOPE_SECCION_NO_ADMIN = {"configuracion_usuarios": "read"}
# tabla -> (columna del código, topes, columna del rol o None si es de una persona)
_TOPES_DE_PERMISOS = {
    RolArea.__tablename__: ("area_codigo", TOPE_AREA_NO_ADMIN, "rol_codigo"),
    RolSeccion.__tablename__: ("seccion_codigo", TOPE_SECCION_NO_ADMIN, "rol_codigo"),
    UsuarioArea.__tablename__: ("area_codigo", TOPE_AREA_NO_ADMIN, None),
    UsuarioSeccion.__tablename__: ("seccion_codigo", TOPE_SECCION_NO_ADMIN, None),
}
_DICHO_NIVEL = {"none": "sin acceso", "read": "ver", "write": "editar", "admin": "administrar"}

# ─────────────────────────── la firma ───────────────────────────

ALGORITMO_DE_FIRMA = "hmac-sha256"
# Separa esta clave de cualquier otro uso de SECRET_KEY (los tokens): la misma SECRET_KEY
# da claves distintas para cosas distintas.
_ETIQUETA_DE_LA_CLAVE = b"spmm/copias-de-seguridad/firma-del-manifiesto/v1"


def _clave_de_firma() -> bytes:
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), _ETIQUETA_DE_LA_CLAVE,
                    hashlib.sha256).digest()


def _manifiesto_canonico(manifiesto: dict) -> bytes:
    """El manifiesto sin la firma, en una sola forma posible (claves ordenadas, sin
    espacios): lo que se firma y lo que se vuelve a calcular al revisar."""
    sin_firma = {k: v for k, v in manifiesto.items() if k != "firma"}
    return json.dumps(sin_firma, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode("utf-8")


def firmar_manifiesto(manifiesto: dict) -> dict:
    valor = hmac.new(_clave_de_firma(), _manifiesto_canonico(manifiesto), hashlib.sha256)
    return {"algoritmo": ALGORITMO_DE_FIRMA, "valor": valor.hexdigest()}


def firma_valida(manifiesto: dict) -> bool:
    firma = manifiesto.get("firma")
    if not isinstance(firma, dict) or firma.get("algoritmo") != ALGORITMO_DE_FIRMA:
        return False
    valor = firma.get("valor")
    if not isinstance(valor, str) or not _SHA256.match(valor):
        return False
    return hmac.compare_digest(firmar_manifiesto(manifiesto)["valor"], valor)

# Cómo se llama cada tabla en el taller, para la pantalla. Sólo para mostrar: la que
# no esté acá se muestra con su nombre crudo, y eso no rompe nada.
NOMBRE_LLANO = {
    "orden_trabajo": "Órdenes de trabajo",
    "orden_trabajo_proceso": "Pasos de las órdenes",
    "orden_trabajo_proceso_version": "Historial para deshacer pasos",
    "orden_trabajo_pieza": "Materia prima de las órdenes",
    "orden_trabajo_pieza_corte": "Cortes de la materia prima de las órdenes",
    "orden_trabajo_pausa": "Pausas de las órdenes",
    "consumo_material": "Consumos de material",
    "planificacion": "Plan",
    "planificacion_borrador": "Borradores del plan",
    "planificacion_borrada": "Registro de planes borrados",
    "planificacion_intento": "Registro de planificaciones",
    "dia_bloqueado": "Calendario del taller (días sin trabajo)",
    "operario": "Personas",
    "operario_rango": "Categorías de cada persona",
    "operario_proceso_skill": "Habilidades de cada persona",
    "operario_ausencia": "Ausencias de cada persona",
    "maquinaria": "Máquinas",
    "rango": "Categorías",
    "rango_proceso": "Procesos de cada categoría",
    "rango_maquinaria": "Máquinas de cada categoría",
    "proceso_maquinaria": "Máquinas de cada proceso",
    "proceso": "Procesos",
    "estado_proceso": "Estados de los pasos",
    "cliente": "Clientes",
    "articulo": "Artículos",
    "pieza": "Materia prima (insumos)",
    "pieza_movimiento": "Movimientos de stock de la materia prima",
    "pieza_precio": "Historial de precios de la materia prima",
    "pieza_recorte": "Recortes de la materia prima",
    "material": "Materiales (acero, aluminio…)",
    "material_calidad": "Calidades de cada material",
    "formato": "Formatos de la materia prima (barra, tubo, placa…)",
    "proveedor": "Proveedores",
    "canera_ocupacion": "Cañera (qué OT ocupa cada casillero)",
    "plan_semanal": "Plan semanal del Sistema Integral (qué OT se programaron cada semana)",
    "plano":"Planos (los datos; el archivo no viaja)",
    "prioridad": "Prioridades",
    "sector": "Sectores",
    "incidencia_proceso": "No conformidades",
    "notificacion": "Notificaciones",
    "usuario": "Usuarios",
    "rol": "Roles",
    "area": "Áreas (permisos)",
    "seccion": "Secciones (permisos)",
    "rol_area": "Permisos de cada rol",
    "rol_seccion": "Permisos de cada rol por sección",
    "usuario_area": "Permisos de más por persona",
    "usuario_seccion": "Permisos de más por persona (secciones)",
    "auditoria_movimiento": "Auditoría: todo lo que se hizo",
    "auditoria_proceso_ot": "Auditoría: pasos de las órdenes",
}


def nombre_llano(tabla: str) -> str:
    return NOMBRE_LLANO.get(tabla, tabla)


def grupo_de(tabla: str) -> str:
    if tabla in TABLAS_DE_ACCESO:
        return "acceso"
    if tabla in TABLAS_DE_AUDITORIA:
        return "auditoria"
    return "datos"


def nombre_de_copia(cuando: datetime, antes_de_restaurar: bool = False) -> str:
    """spmm_backup_<aaaa-mm-dd_hhmm>.zip. La automática lleva los segundos (dos
    restauraciones en el mismo minuto no se pisan) y dice para qué es."""
    if antes_de_restaurar:
        return f"spmm_backup_{cuando:%Y-%m-%d_%H%M%S}_antes-de-restaurar.zip"
    return f"spmm_backup_{cuando:%Y-%m-%d_%H%M}.zip"


class CopiaInvalida(Exception):
    """El archivo no se puede restaurar. El mensaje es para la persona."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


# ─────────────────────────── el esquema real ───────────────────────────


async def leer_esquema(conn) -> MetaData:
    """Las tablas que hay HOY en la base, con sus columnas, tipos y claves foráneas."""
    esquema = MetaData()

    def _reflejar(c):
        with warnings.catch_warnings():
            # Un tipo que SQLAlchemy no conoce (un dominio, un tsvector) se refleja como
            # NullType y avisa. Se copia igual, tal cual viene.
            warnings.simplefilter("ignore", category=sa_exc.SAWarning)
            esquema.reflect(bind=c)

    await conn.run_sync(_reflejar)
    return esquema


def tablas_en_orden(esquema: MetaData) -> list[Table]:
    """En el orden de sus claves foráneas: primero las que no dependen de nada."""
    with warnings.catch_warnings():
        # Un ciclo de claves foráneas avisa y se ordena igual (se resuelve al cargar:
        # las autorreferencias van en un segundo paso).
        warnings.simplefilter("ignore", category=sa_exc.SAWarning)
        return list(esquema.sorted_tables)


def _es_archivo(columna) -> bool:
    return isinstance(columna.type, sqltypes._Binary)


def _tipo(columna, dialecto) -> str:
    try:
        return str(columna.type.compile(dialect=dialecto))
    except Exception:
        return type(columna.type).__name__


def firma_del_esquema(tablas: dict) -> str:
    """Un hash de {tabla: [[columna, tipo], ...]}: si dos copias tienen la misma, las
    tablas tenían las mismas columnas con los mismos tipos."""
    crudo = json.dumps(tablas, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(crudo.encode("utf-8")).hexdigest()


# ─────────────────────────── valores <-> JSON ───────────────────────────


def _json_default(valor):
    if isinstance(valor, datetime):
        return valor.isoformat()
    if isinstance(valor, (date, time)):
        return valor.isoformat()
    if isinstance(valor, Decimal):
        return str(valor)
    if isinstance(valor, uuid.UUID):
        return str(valor)
    if isinstance(valor, timedelta):
        return valor.total_seconds()
    if isinstance(valor, (set, frozenset, tuple)):
        return list(valor)
    if isinstance(valor, (bytes, bytearray, memoryview)):
        # Sólo llega acá un binario de una columna de tipo desconocido (los binarios
        # conocidos no viajan). Se guarda en hexa para que la fila siga siendo JSON.
        return bytes(valor).hex()
    return str(valor)


def _fila_a_json(fila) -> bytes:
    return json.dumps(list(fila), default=_json_default, ensure_ascii=False,
                      separators=(",", ":")).encode("utf-8")


def _a_datetime(v):
    if isinstance(v, datetime):
        return v
    if isinstance(v, str):
        return datetime.fromisoformat(v)
    raise ValueError("no es una fecha y hora")


def _a_date(v):
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, str):
        # Una columna que hoy es fecha y en la copia era fecha y hora: se toma el día.
        return datetime.fromisoformat(v).date() if "T" in v else date.fromisoformat(v)
    raise ValueError("no es una fecha")


def _a_time(v):
    if isinstance(v, time):
        return v
    if isinstance(v, str):
        return time.fromisoformat(v)
    raise ValueError("no es una hora")


def _a_intervalo(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return timedelta(seconds=v)
    raise ValueError("no es una duración")


def _a_bool(v):
    if isinstance(v, bool):
        return v
    if v in (0, 1):
        return bool(v)
    raise ValueError("no es sí/no")


def _a_int(v):
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and re.fullmatch(r"-?\d+", v.strip()):
        return int(v)
    raise ValueError("no es un número entero")


def _a_float(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str):
        return float(v)
    raise ValueError("no es un número")


def _a_decimal(v):
    if isinstance(v, bool):
        raise ValueError("no es un número")
    try:
        return Decimal(str(v))
    except InvalidOperation:
        raise ValueError("no es un número")


def _a_texto(v):
    if isinstance(v, str):
        return v
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


def convertidor(columna) -> Callable[[Any], Any]:
    """De lo que dice el JSON al valor que pide la columna TAL COMO ES HOY (no como era
    cuando se hizo la copia). Lo que no se puede convertir revienta con ValueError, y
    la revisión lo informa antes de tocar nada."""
    t = columna.type
    if isinstance(t, sqltypes.JSON):
        # Un None de la copia es una columna sin nada (SQL NULL). Pasado tal cual, el tipo
        # JSON lo guarda como el JSON «null» (none_as_null=False): se ve igual, pero un
        # `WHERE … IS NULL` deja de encontrar la fila. null() es cómo se le pide el NULL.
        return lambda v: null() if v is None else v
    elif isinstance(t, sqltypes.DateTime):
        base = _a_datetime
    elif isinstance(t, sqltypes.Date):
        base = _a_date
    elif isinstance(t, sqltypes.Time):
        base = _a_time
    elif isinstance(t, sqltypes.Interval):
        base = _a_intervalo
    elif isinstance(t, sqltypes.Boolean):
        base = _a_bool
    elif isinstance(t, sqltypes.Uuid):
        como_uuid = getattr(t, "as_uuid", True)
        base = (lambda v: uuid.UUID(str(v))) if como_uuid else (lambda v: str(uuid.UUID(str(v))))
    elif isinstance(t, sqltypes.Integer):
        base = _a_int
    elif isinstance(t, sqltypes.Float):
        base = _a_float
    elif isinstance(t, sqltypes.Numeric):
        base = _a_decimal if getattr(t, "asdecimal", True) else _a_float
    elif isinstance(t, sqltypes.String):
        base = _a_texto
    else:
        base = None

    if base is None:
        return lambda v: v

    def _convertir(v):
        return None if v is None else base(v)

    return _convertir


# ─────────────────────────── armar la copia (streaming) ───────────────────────────


class _Tubo(io.RawIOBase):
    """Adonde escribe el zip: junta los bytes hasta que el generador los manda.

    No se puede mover (no tiene seek ni tell), así que zipfile escribe cada archivo con
    «descriptor de datos» al final: es lo que deja armar el zip mientras se manda."""

    def __init__(self):
        super().__init__()
        self._buffer = bytearray()

    def writable(self) -> bool:
        return True

    def write(self, datos) -> int:
        self._buffer += datos
        return len(datos)

    def sacar(self) -> bytes:
        datos = bytes(self._buffer)
        self._buffer.clear()
        return datos


def _entrada(nombre: str, cuando: datetime) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(nombre, date_time=cuando.timetuple()[:6])
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    return info


def _texto_leeme(cuando: datetime, generado_por: Optional[dict]) -> str:
    quien = (generado_por or {}).get("nombre") or (generado_por or {}).get("usuario") or "—"
    return (
        "COPIA DE SEGURIDAD DE SPMM\n"
        "==========================\n\n"
        f"Hecha el {cuando:%d/%m/%Y a las %H:%M} (hora de Argentina) por {quien}.\n\n"
        "Qué trae: todos los datos del sistema, tabla por tabla (carpeta «tablas», un\n"
        "renglón por fila), y manifiesto.json con qué hay y cómo comprobar que nada\n"
        "se modificó.\n\n"
        "Qué NO trae: los archivos de los planos. Viven aparte, en el almacenamiento\n"
        "de Supabase; la copia tiene la lista de planos y dónde está cada archivo.\n"
        "Tampoco trae contraseñas ni enlaces para recuperarlas.\n\n"
        "Cuidado: trae todos los datos del taller y los usuarios del sistema (nombre,\n"
        "email, rol). Guardala en un lugar seguro.\n\n"
        "Para volver a cargarla: SPMM > Configuración > Copias de seguridad >\n"
        "Restaurar. No hace falta descomprimirla ni tocar nada adentro. La copia va\n"
        "firmada por el servidor que la hizo: si algo adentro se modificó, la app lo\n"
        "detecta y lo avisa antes de tocar nada, y no deja restaurar los usuarios con\n"
        "ella.\n"
    )


async def _pagina(conn, consulta) -> list:
    """Una página de la copia, leída entera aunque en el medio se corte la descarga.

    Cuando el navegador corta, Starlette cancela el envío. Si la cancelación cae con la
    consulta en vuelo, el driver queda con una lectura a medias: en SQLite (aiosqlite)
    el rollback del cierre falla («no active connection») y la transacción de lectura
    sigue viva y traba la base («database is locked»), así que ni se puede completar la
    fila de auditoría de esa descarga; en Postgres, asyncpg tiene que mandarle un cancel
    al servidor y SQLAlchemy descarta la conexión. Con el shield la cancelación espera a
    que la página termine y entra en el próximo await, con la conexión sana para cerrarla
    (el cierre en CopiaSeguridadAPI ya va con su propio shield). Cuánto antes caía el
    corte dependía de cuántas tablas hay: con las de materia prima fallaba siempre.

    ¿Puede colgar? El shield sólo posterga la cancelación de afuera, y lo normal es que
    la posterga milisegundos (una consulta por el índice de la clave, de a LOTE filas).
    Pero si la base no contesta, el corte del navegador ya no destraba la espera, y acá
    nada más le pone techo (el engine no le da command_timeout a asyncpg). Por eso el
    shield tiene su propio tope, TOPE_PAGINA_S: pasado ese tiempo se cancela igual —lo
    mismo que pasaba antes, pero sólo con la base colgada— y la copia falla con un error
    que lo dice, en vez de seguir esperando o salir cortada como si nada. La copia de
    antes de restaurar corre con las tablas bloqueadas: tampoco las retiene más que eso.
    """
    with anyio.move_on_after(TOPE_PAGINA_S, shield=True):
        return (await conn.execute(consulta)).all()
    raise TimeoutError(
        f"La base no devolvió una página de la copia en {TOPE_PAGINA_S} segundos: se corta la copia."
    )


async def _por_paginas(conn, tabla: Table, columnas: list) -> AsyncIterator[list]:
    """Las filas de una tabla de a LOTE, en el orden de su clave primaria.

    Por páginas (WHERE clave > la última LIMIT n) y no con un cursor del servidor: en
    Postgres, un cursor abierto sobre una tabla no deja vaciarla en la misma transacción
    («cannot TRUNCATE … being used by active queries»), y restaurar arma esta misma copia
    justo antes de vaciar. Cada página es una consulta corta que entra por el índice de
    la clave; dentro de la transacción (REPEATABLE READ o con las tablas bloqueadas)
    todas ven la misma foto."""
    clave = list(tabla.primary_key.columns)
    posiciones = [next((i for i, c in enumerate(columnas) if c.name == k.name), None) for k in clave]
    if not clave or None in posiciones:
        # Sin clave (las copias sueltas que dejaron algunas migraciones): de una vez.
        filas = await _pagina(conn, select(*columnas))
        for i in range(0, len(filas), LOTE):
            yield filas[i:i + LOTE]
        return
    ultima = None
    while True:
        consulta = select(*columnas).order_by(*clave).limit(LOTE)
        if ultima is not None:
            if len(clave) == 1:
                consulta = consulta.where(clave[0] > ultima[0])
            else:
                consulta = consulta.where(tuple_(*clave) > tuple_(*ultima))
        filas = await _pagina(conn, consulta)
        if filas:
            yield filas
        if len(filas) < LOTE:
            return
        ultima = [filas[-1][i] for i in posiciones]


def _columnas_de_la_copia(tabla: Table) -> tuple[list, list, set]:
    """(columnas que van, binarias que no van, posiciones que van vacías)."""
    columnas = [c for c in tabla.columns if not _es_archivo(c)]
    omitidas = [c.name for c in tabla.columns if _es_archivo(c)]
    no_viajan = set(COLUMNAS_QUE_NO_VIAJAN.get(tabla.name, ()))
    vacias = {i for i, c in enumerate(columnas) if c.name in no_viajan}
    return columnas, omitidas, vacias


async def _renglones_de(conn, tabla: Table, columnas: list, vacias: set) -> AsyncIterator[tuple[bytes, int]]:
    """El .jsonl de una tabla, de a lotes: (bytes, cuántas filas). Lo usan la copia y la
    huella del contenido, así las dos cuentan exactamente lo mismo."""
    async for lote in _por_paginas(conn, tabla, columnas):
        if vacias:
            lote = [[None if i in vacias else v for i, v in enumerate(f)] for f in lote]
        yield b"".join(_fila_a_json(f) + b"\n" for f in lote), len(lote)


@dataclass
class ResumenCopia:
    """Lo que se supo al terminar de armar una copia (para la auditoría y la pantalla)."""

    nombre: str = ""
    generado_en: Optional[datetime] = None
    filas_por_tabla: dict = field(default_factory=dict)
    # El sha256 del .jsonl de cada tabla: con esto se arma la huella del CONTENIDO
    # (huellas_de_contenido), que no depende de la hora ni de cómo se comprimió el zip.
    sha256_por_tabla: dict = field(default_factory=dict)
    bytes: int = 0
    completa: bool = False

    @property
    def total_filas(self) -> int:
        return sum(self.filas_por_tabla.values())


async def generar_copia(
    conn,
    esquema: MetaData,
    *,
    generado_por: Optional[dict],
    motivo: str,
    cuando: Optional[datetime] = None,
    resumen: Optional[ResumenCopia] = None,
) -> AsyncIterator[bytes]:
    """El zip de TODAS las tablas de `esquema`, en pedazos, leyendo de `conn`.

    Lee por lotes (stream) y manda lo comprimido a medida que sale: ni la base ni el
    zip se juntan enteros en memoria. `conn` tiene que estar en una transacción que vea
    una foto fija de la base (REPEATABLE READ, o las tablas bloqueadas): si no, una
    tabla puede salir de antes y otra de después de un guardado."""
    cuando = cuando or ahora_ar()
    resumen = resumen if resumen is not None else ResumenCopia()
    resumen.generado_en = cuando
    dialecto = conn.dialect

    tubo = _Tubo()
    zf = zipfile.ZipFile(tubo, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True)
    tablas_manifiesto: dict = {}
    firma: dict = {}

    def _salida() -> bytes:
        datos = tubo.sacar()
        resumen.bytes += len(datos)
        return datos

    try:
        zf.writestr(_entrada(LEEME, cuando), _texto_leeme(cuando, generado_por).encode("utf-8"))
        yield _salida()

        for tabla in tablas_en_orden(esquema):
            columnas, omitidas, vacias = _columnas_de_la_copia(tabla)
            suma = hashlib.sha256()
            filas = 0
            archivo = f"{CARPETA}{tabla.name}.jsonl"
            if columnas:
                with zf.open(_entrada(archivo, cuando), "w", force_zip64=True) as destino:
                    async for datos, cuantas in _renglones_de(conn, tabla, columnas, vacias):
                        suma.update(datos)
                        destino.write(datos)
                        filas += cuantas
                        trozo = _salida()
                        if trozo:
                            yield trozo
            else:
                zf.writestr(_entrada(archivo, cuando), b"")
            tablas_manifiesto[tabla.name] = {
                "archivo": archivo,
                "filas": filas,
                "sha256": suma.hexdigest(),
                "columnas": [c.name for c in columnas],
                "tipos": [_tipo(c, dialecto) for c in columnas],
                "columnas_omitidas": omitidas,
                "columnas_vaciadas": sorted(columnas[i].name for i in vacias),
            }
            firma[tabla.name] = [[c.name, _tipo(c, dialecto)] for c in columnas]
            resumen.filas_por_tabla[tabla.name] = filas
            resumen.sha256_por_tabla[tabla.name] = suma.hexdigest()
            trozo = _salida()
            if trozo:
                yield trozo

        manifiesto = {
            "formato": FORMATO,
            "version": VERSION,
            "generado_en": cuando.isoformat(timespec="seconds"),
            "generado_por": generado_por,
            "motivo": motivo,
            "motor": dialecto.name,
            "archivos_de_planos": (
                "No están en esta copia: viven en Supabase Storage (bucket «planos»). La tabla "
                "«plano» sí está, con la ruta de cada archivo."
            ),
            "contrasenas": (
                "No están en esta copia: usuario.password_hash, reset_token y "
                "reset_token_expiry van vacíos en cada fila."
            ),
            "firma_del_esquema": firma_del_esquema(firma),
            "total_filas": resumen.total_filas,
            "tablas": tablas_manifiesto,
        }
        manifiesto["firma"] = firmar_manifiesto(manifiesto)
        zf.writestr(_entrada(MANIFIESTO, cuando),
                    json.dumps(manifiesto, ensure_ascii=False, indent=2).encode("utf-8"))
        zf.close()
        resumen.completa = True
        yield _salida()
    finally:
        if not resumen.completa:
            # Se cortó a la mitad (el navegador cerró, se canceló el pedido): se cierra
            # el zip acá, en memoria, y no cuando lo junte el recolector de basura, que
            # lo intenta sobre un tubo ya cerrado y deja un error suelto en el log.
            try:
                zf.close()
            except Exception:
                pass


def huellas_de_contenido(sha256_por_tabla: dict) -> dict:
    """La huella de lo que hay en la base, por grupo: {"datos": …, "acceso": …}.

    Sale de los sha256 de cada tabla, no del zip: dos copias del mismo contenido hechas
    en minutos distintos tienen la misma huella. Es lo que prueba que la copia que un
    admin acaba de bajar ES cómo está todo ahora (ver CopiaSeguridadAPI, «ya la bajé»).
    La auditoría queda afuera: la escribe cada pedido, empezando por la revisión misma.
    """
    grupos: dict = {"datos": {}, "acceso": {}}
    for tabla, suma in sha256_por_tabla.items():
        grupo = grupo_de(tabla)
        if grupo in grupos:
            grupos[grupo][tabla] = suma
    return {
        grupo: hashlib.sha256(
            json.dumps(tablas, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        for grupo, tablas in grupos.items()
    }


async def huellas_actuales(conn, esquema: MetaData) -> dict:
    """huellas_de_contenido de cómo está la base ahora, sin armar ningún zip."""
    sumas = {}
    for tabla in tablas_en_orden(esquema):
        if grupo_de(tabla.name) == "auditoria":
            continue
        columnas, _, vacias = _columnas_de_la_copia(tabla)
        suma = hashlib.sha256()
        if columnas:
            async for datos, _cuantas in _renglones_de(conn, tabla, columnas, vacias):
                suma.update(datos)
        sumas[tabla.name] = suma.hexdigest()
    return huellas_de_contenido(sumas)


async def copia_a_archivo(conn, esquema: MetaData, **kwargs) -> tuple[BinaryIO, ResumenCopia]:
    """La misma copia, a un archivo temporal (para la automática de antes de restaurar).
    Hasta 16 MB queda en memoria; lo que pasa, a disco."""
    resumen = kwargs.pop("resumen", None) or ResumenCopia()
    destino = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024)
    async for trozo in generar_copia(conn, esquema, resumen=resumen, **kwargs):
        destino.write(trozo)
    destino.seek(0)
    return destino, resumen


# ─────────────────────────── leer el archivo ───────────────────────────


def huella_de(archivo: BinaryIO) -> tuple[str, int]:
    """sha256 y tamaño del archivo entero. La restauración exige la misma huella que la
    vista previa: se restaura EXACTAMENTE el archivo que se revisó."""
    archivo.seek(0)
    suma = hashlib.sha256()
    tamano = 0
    while True:
        trozo = archivo.read(1 << 20)
        if not trozo:
            break
        suma.update(trozo)
        tamano += len(trozo)
    archivo.seek(0)
    return suma.hexdigest(), tamano


def _abrir_zip(archivo: BinaryIO) -> zipfile.ZipFile:
    archivo.seek(0)
    try:
        zf = zipfile.ZipFile(archivo)
    except (zipfile.BadZipFile, OSError, ValueError):
        raise CopiaInvalida(
            "El archivo no es una copia de seguridad de SPMM: no es un .zip válido. "
            "Elegí el archivo spmm_backup_….zip tal como se descargó."
        )
    entradas = zf.infolist()
    if len(entradas) > LIMITE_ENTRADAS:
        raise CopiaInvalida("El archivo tiene demasiados archivos adentro para ser una copia de SPMM.")
    nombres = [e.filename for e in entradas]
    if len(set(nombres)) != len(nombres):
        raise CopiaInvalida("El archivo tiene nombres repetidos adentro: no es una copia de SPMM sana.")
    total = 0
    for e in entradas:
        if e.flag_bits & 0x1:
            raise CopiaInvalida("El archivo está protegido con contraseña: no es una copia de SPMM.")
        if e.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise CopiaInvalida("El archivo usa una compresión que SPMM no genera: no es una copia de SPMM.")
        if e.file_size > LIMITE_POR_ARCHIVO:
            raise CopiaInvalida(f"«{e.filename}» es demasiado grande una vez descomprimido.")
        # Bomba de zip: poco comprimido que se vuelve muchísimo. En los chicos no se mira
        # (un archivo de 100 bytes de ceros comprime mil veces y es inofensivo).
        if e.file_size > 1024 * 1024 and e.file_size > LIMITE_RELACION * max(e.compress_size, 1):
            raise CopiaInvalida(
                f"«{e.filename}» se descomprime a un tamaño desproporcionado: no se abre."
            )
        total += e.file_size
    if total > LIMITE_DESCOMPRIMIDO:
        raise CopiaInvalida("El archivo, descomprimido, es demasiado grande para restaurarlo desde la app.")
    if MANIFIESTO not in nombres:
        raise CopiaInvalida(
            "Al archivo le falta el manifiesto: no es una copia de seguridad de SPMM "
            "(o se armó a mano)."
        )
    return zf


def _leer_entrada_chica(zf: zipfile.ZipFile, nombre: str, limite: int) -> bytes:
    info = zf.getinfo(nombre)
    if info.file_size > limite:
        raise CopiaInvalida(f"«{nombre}» es demasiado grande.")
    try:
        with zf.open(info) as f:
            datos = f.read(limite + 1)
    except (zipfile.BadZipFile, OSError, EOFError, RuntimeError):
        raise CopiaInvalida(f"«{nombre}» está dañado: no se puede leer.")
    if len(datos) > limite:
        raise CopiaInvalida(f"«{nombre}» es demasiado grande.")
    return datos


def leer_manifiesto(zf: zipfile.ZipFile) -> dict:
    crudo = _leer_entrada_chica(zf, MANIFIESTO, LIMITE_MANIFIESTO)
    try:
        m = json.loads(crudo.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise CopiaInvalida("El manifiesto de la copia está dañado: no es un JSON válido.")
    if not isinstance(m, dict) or m.get("formato") != FORMATO:
        raise CopiaInvalida("El archivo no es una copia de seguridad de SPMM.")
    version = m.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise CopiaInvalida("El manifiesto de la copia no dice su versión.")
    if version not in VERSIONES_QUE_SE_LEEN:
        mas_nueva = version > max(VERSIONES_QUE_SE_LEEN)
        raise CopiaInvalida(
            f"La copia es de la versión {version} del formato y esta app lee la "
            f"{max(VERSIONES_QUE_SE_LEEN)}. "
            + ("Se hizo con una versión más nueva de SPMM: actualizá el servidor antes de restaurarla."
               if mas_nueva else "Es de una versión vieja que ya no se puede restaurar.")
        )
    if not isinstance(m.get("tablas"), dict):
        raise CopiaInvalida("El manifiesto de la copia no dice qué tablas trae.")
    return m


def fecha_del_manifiesto(m: dict) -> Optional[datetime]:
    try:
        cuando = datetime.fromisoformat(str(m.get("generado_en")))
    except (TypeError, ValueError):
        return None
    # Todas las fechas del sistema son hora local sin zona. Si alguien trae una con
    # zona, se muestra la hora que dice, sin convertir.
    return cuando.replace(tzinfo=None)


class _LectorDeTabla:
    """Recorre los renglones de un .jsonl del zip sin juntarlo entero, con topes, y
    calcula el sha256 de lo que leyó. `sha256` y `leidos` valen al terminar."""

    def __init__(self, zf: zipfile.ZipFile, info: zipfile.ZipInfo):
        self.zf = zf
        self.info = info
        self.sha256: Optional[str] = None
        self.leidos = 0

    def __iter__(self) -> Iterator[bytes]:
        suma = hashlib.sha256()
        buffer = bytearray()
        try:
            with self.zf.open(self.info) as f:
                while True:
                    trozo = f.read(1 << 16)
                    if not trozo:
                        break
                    self.leidos += len(trozo)
                    if self.leidos > self.info.file_size or self.leidos > LIMITE_POR_ARCHIVO:
                        raise CopiaInvalida(f"«{self.info.filename}» es más grande de lo que dice.")
                    suma.update(trozo)
                    desde = len(buffer)
                    buffer += trozo
                    inicio = 0
                    while True:
                        fin = buffer.find(b"\n", max(desde, inicio))
                        if fin < 0:
                            break
                        yield bytes(buffer[inicio:fin])
                        inicio = fin + 1
                    if inicio:
                        del buffer[:inicio]
                    if len(buffer) > LIMITE_LINEA:
                        raise CopiaInvalida(f"«{self.info.filename}» tiene un renglón desmesurado.")
        except (zipfile.BadZipFile, OSError, EOFError, RuntimeError) as e:
            # zipfile avisa acá un CRC que no da o un archivo cortado.
            raise CopiaInvalida(f"«{self.info.filename}» está dañado: no se puede leer ({e}).")
        if buffer:
            yield bytes(buffer)
        self.sha256 = suma.hexdigest()


# ─────────────────────────── la revisión (antes de tocar nada) ───────────────────────────


@dataclass
class PlanTabla:
    """Qué pasa con UNA tabla de la base al restaurar."""

    nombre: str
    grupo: str
    # reemplaza: se vacía y se carga con lo de la copia.
    # vacia:     la copia no la trae y depende de una que se reemplaza: queda vacía
    #            (es nueva; en la fecha de la copia no tenía nada).
    # conserva:  usuarios/permisos (salvo que se pidan) y auditoría: queda como está.
    # sin_copia: la copia no la trae y no depende de nada que cambie: queda como está.
    accion: str
    filas_copia: Optional[int] = None
    columnas_copia: list = field(default_factory=list)
    # (posición en el renglón de la copia, columna de hoy, convertidor)
    lectura: list = field(default_factory=list)
    # Columnas de hoy que la copia no trae y son obligatorias sin default en la base,
    # pero el modelo tiene un valor fijo por defecto: se completan con eso.
    completar: dict = field(default_factory=dict)


@dataclass
class Revision:
    huella: str
    tamano: int
    manifiesto: dict
    generado_en: Optional[datetime]
    tablas: list  # PlanTabla, en el orden de carga
    avisos: list
    ignoradas: list  # tablas de la copia que hoy no existen
    incluir_usuarios: bool = False
    usuarios_de_la_copia: list = field(default_factory=list)
    # ¿La firmó este servidor? (ver «LA FIRMA»). Sin firma: nunca con los usuarios, y
    # los datos sólo si el admin lo confirma aparte.
    firmada: bool = True
    # Con los usuarios: qué pasa cuenta por cuenta, en castellano, para la vista previa.
    cambios_de_usuarios: list = field(default_factory=list)
    # Planos de la copia que no tienen el archivo en ningún lado y no se restauran.
    planos_sin_archivo: int = 0

    def plan(self, nombre: str) -> Optional[PlanTabla]:
        return next((t for t in self.tablas if t.nombre == nombre), None)

    @property
    def a_reemplazar(self) -> list:
        return [t for t in self.tablas if t.accion in ("reemplaza", "vacia")]

    @property
    def generado_por(self) -> Optional[str]:
        g = self.manifiesto.get("generado_por")
        if isinstance(g, dict):
            return str(g.get("nombre") or g.get("usuario") or "") or None
        return None


def _default_del_modelo(tabla: str, columna: str):
    """El valor fijo por defecto que declara el modelo para una columna, si lo hay."""
    t = Base.metadata.tables.get(tabla)
    if t is None or columna not in t.c:
        return None
    d = t.c[columna].default
    if d is not None and getattr(d, "is_scalar", False):
        return d.arg
    return None


def _depende_de(tabla: Table, otras: set) -> set:
    return {fk.column.table.name for fk in tabla.foreign_keys
            if fk.column.table.name in otras and fk.column.table.name != tabla.name}


SIN_FIRMA = (
    "Esta copia no tiene la firma de este servidor: o se modificó algo adentro después "
    "de bajarla, o se hizo en otra instalación de SPMM (o antes de que cambiara la clave "
    "del servidor). El archivo está sano y completo, pero no se puede comprobar que nadie "
    "haya cambiado los datos."
)


def revisar_copia(
    archivo: BinaryIO,
    esquema: MetaData,
    *,
    incluir_usuarios: bool = False,
    admin_actual: Optional[dict] = None,
    usuarios_actuales: Optional[list] = None,
    planos_con_archivo_hoy: Optional[set] = None,
) -> Revision:
    """Revisa el archivo ENTERO contra la base de HOY, sin escribir nada.

    Lee cada tabla completa: hash, cantidad de filas y que cada valor se pueda cargar en
    la columna que hay hoy. Devuelve el plan tabla por tabla y los avisos. Cualquier
    cosa que impida restaurar levanta CopiaInvalida con el motivo en castellano.

    `usuarios_actuales` (las cuentas de hoy, con admin_permanente si la columna existe)
    hace falta para incluir los usuarios; `planos_con_archivo_hoy` (ids de los planos
    que hoy tienen su archivo en algún lado), para avisar qué planos no vuelven.

    Es sincrónica y hace CPU: desde la API se corre en un hilo aparte.
    """
    huella, tamano = huella_de(archivo)
    zf = _abrir_zip(archivo)
    m = leer_manifiesto(zf)
    avisos: list[str] = []
    ignoradas: list[str] = []
    firmada = firma_valida(m)
    if not firmada and incluir_usuarios:
        raise CopiaInvalida(
            f"{SIN_FIRMA} Con una copia así no se pueden incluir los usuarios, roles y "
            "permisos. Destildá esa opción para ver qué pasaría con el resto de los datos."
        )

    # ── Las tablas de la copia, contra las de hoy ──
    de_la_copia: dict = {}
    for nombre, datos in m["tablas"].items():
        if not isinstance(nombre, str) or not _NOMBRE.match(nombre) or nombre not in esquema.tables:
            ignoradas.append(str(nombre)[:80])
            continue
        if not isinstance(datos, dict):
            raise CopiaInvalida(f"El manifiesto está dañado en la tabla «{nombre}».")
        filas = datos.get("filas")
        columnas = datos.get("columnas")
        suma = datos.get("sha256")
        if (not isinstance(filas, int) or isinstance(filas, bool) or filas < 0
                or not isinstance(columnas, list) or not all(isinstance(c, str) for c in columnas)
                or len(set(columnas)) != len(columnas)
                or not isinstance(suma, str) or not _SHA256.match(suma)
                or datos.get("archivo") != f"{CARPETA}{nombre}.jsonl"):
            raise CopiaInvalida(f"El manifiesto está dañado en la tabla «{nombre}».")
        if datos["archivo"] not in zf.NameToInfo:
            raise CopiaInvalida(f"A la copia le falta el archivo de la tabla «{nombre}».")
        de_la_copia[nombre] = datos
    for nombre in ignoradas:
        avisos.append(f"La copia trae la tabla «{nombre}», que hoy ya no existe: se ignora.")

    # ── Qué pasa con cada tabla de hoy ──
    orden = tablas_en_orden(esquema)
    planes: dict[str, PlanTabla] = {}
    for t in orden:
        grupo = grupo_de(t.name)
        if grupo == "auditoria" or (grupo == "acceso" and not incluir_usuarios):
            accion = "conserva"
        elif t.name in de_la_copia:
            accion = "reemplaza"
        else:
            accion = "sin_copia"
        planes[t.name] = PlanTabla(nombre=t.name, grupo=grupo, accion=accion)

    # Las que la copia no trae pero cuelgan de una que se reemplaza, quedan vacías (y lo
    # que cuelgue de ellas, también): dejarlas apuntando a filas que ya no existen no se
    # puede.
    cambian = {n for n, p in planes.items() if p.accion == "reemplaza"}
    hubo_cambio = True
    while hubo_cambio:
        hubo_cambio = False
        for t in orden:
            p = planes[t.name]
            if p.accion == "sin_copia" and _depende_de(t, cambian):
                p.accion = "vacia"
                cambian.add(t.name)
                hubo_cambio = True
    for t in orden:
        p = planes[t.name]
        if p.accion == "conserva":
            dependencias = _depende_de(t, cambian)
            if dependencias:
                raise CopiaInvalida(
                    f"No se puede restaurar sin tocar «{nombre_llano(t.name)}», que se deja como "
                    f"está: depende de «{', '.join(sorted(dependencias))}», que se reemplaza."
                )
        elif p.accion == "vacia":
            avisos.append(
                f"La copia no trae «{nombre_llano(t.name)}» (no existía cuando se hizo): queda vacía."
            )
        elif p.accion == "sin_copia":
            avisos.append(
                f"La copia no trae «{nombre_llano(t.name)}» (no existía cuando se hizo): se deja como está."
            )

    # ── Columnas, tabla por tabla ──
    for t in orden:
        p = planes[t.name]
        if p.accion in ("reemplaza", "vacia"):
            for col in t.columns:
                identidad = getattr(col, "identity", None)
                if identidad is not None and getattr(identidad, "always", False):
                    raise CopiaInvalida(
                        f"«{t.name}.{col.name}» la genera siempre la base: no se puede recargar "
                        "con sus números de antes."
                    )
        if t.name not in de_la_copia:
            continue
        datos = de_la_copia[t.name]
        p.filas_copia = datos["filas"]
        p.columnas_copia = list(datos["columnas"])
        if p.accion != "reemplaza":
            continue
        actuales = {c.name: c for c in t.columns}
        for i, nombre in enumerate(p.columnas_copia):
            col = actuales.get(nombre) if _NOMBRE.match(nombre) else None
            if col is None:
                avisos.append(
                    f"La columna «{nombre[:60]}» de «{nombre_llano(t.name)}» ya no existe: se ignora."
                )
                continue
            if _es_archivo(col):
                continue  # los archivos no viajan; si la copia trae algo, no se usa
            p.lectura.append((i, nombre, convertidor(col)))
        traidas = {n for (_, n, _) in p.lectura}
        for col in t.columns:
            if col.name in traidas or _es_archivo(col):
                continue
            tiene_default = (
                col.nullable
                or col.server_default is not None
                or (col.primary_key and col.autoincrement in (True, "auto")
                    and isinstance(col.type, sqltypes.Integer) and len(t.primary_key.columns) == 1)
            )
            if tiene_default:
                avisos.append(
                    f"«{nombre_llano(t.name)}» tiene una columna nueva, «{col.name}», que la copia "
                    "no trae: queda en su valor por defecto."
                )
                continue
            fijo = _default_del_modelo(t.name, col.name)
            if fijo is not None:
                p.completar[col.name] = fijo
                avisos.append(
                    f"«{nombre_llano(t.name)}» tiene una columna nueva, «{col.name}», que la copia "
                    f"no trae: queda en {fijo!r}."
                )
                continue
            raise CopiaInvalida(
                f"«{nombre_llano(t.name)}» tiene hoy una columna obligatoria, «{col.name}», que la "
                "copia no trae y no tiene valor por defecto: no se puede restaurar."
            )

    # ── Leer todo: hash, cantidad y que cada valor entre ──
    usuarios: list[dict] = []
    planos_sin_archivo = 0
    for t in orden:
        p = planes[t.name]
        if t.name not in de_la_copia:
            continue
        datos = de_la_copia[t.name]
        info = zf.getinfo(datos["archivo"])
        convertir = p.accion == "reemplaza"
        ancho = len(p.columnas_copia)
        juntar_usuarios = incluir_usuarios and t.name == Usuario.__tablename__ and p.accion == "reemplaza"
        es_plano = convertir and t.name == Plano.__tablename__
        tope = _TOPES_DE_PERMISOS.get(t.name) if convertir else None
        lector = _LectorDeTabla(zf, info)
        n = 0
        for renglon in lector:
            n += 1
            if n > p.filas_copia:
                break
            fila = _decodificar(renglon, t.name, n, ancho)
            if convertir:
                valores = _convertir_fila(fila, p, t.name, n)
                if juntar_usuarios:
                    usuarios.append({k: valores.get(k) for k in (
                        "id_usuario", "username", "email", "nombre", "apellido", "rol", "activo")})
                if es_plano and not _plano_con_archivo(valores, n, planos_con_archivo_hoy):
                    planos_sin_archivo += 1
                if tope:
                    _revisar_tope(valores, t.name, n, tope)
        if n != p.filas_copia:
            raise CopiaInvalida(
                f"La tabla «{nombre_llano(t.name)}» no tiene las filas que dice el manifiesto "
                f"({n} en vez de {p.filas_copia}): el archivo se modificó o está incompleto. "
                "No se tocó nada."
            )
        if lector.sha256 != datos["sha256"]:
            raise CopiaInvalida(
                f"La tabla «{nombre_llano(t.name)}» no coincide con su huella: el archivo se "
                "modificó o se dañó después de descargarlo. No se tocó nada."
            )

    cambios_de_usuarios: list = []
    if incluir_usuarios:
        cambios_de_usuarios = _revisar_usuarios(
            planes.get(Usuario.__tablename__), usuarios, admin_actual, usuarios_actuales, avisos)
    if planos_sin_archivo:
        avisos.append(
            (f"{planos_sin_archivo} planos de la copia no tienen" if planos_sin_archivo > 1
             else "Un plano de la copia no tiene")
            + " el archivo en ningún lado (ni adentro de la base ni en el almacenamiento): "
            + ("no se restauran." if planos_sin_archivo > 1 else "no se restaura.")
        )

    return Revision(
        huella=huella,
        tamano=tamano,
        manifiesto=m,
        generado_en=fecha_del_manifiesto(m),
        tablas=[planes[t.name] for t in orden],
        avisos=avisos,
        ignoradas=ignoradas,
        incluir_usuarios=incluir_usuarios,
        usuarios_de_la_copia=usuarios,
        firmada=firmada,
        cambios_de_usuarios=cambios_de_usuarios,
        planos_sin_archivo=planos_sin_archivo,
    )


def _plano_con_archivo(valores: dict, n: int, con_archivo_hoy: Optional[set]) -> bool:
    """Revisa la ruta de un plano de la copia. False: no tiene el archivo en ningún lado
    (no viene con ruta y hoy, con ese número, no hay ni blob ni ruta) y no se restaura."""
    ruta = valores.get("storage_path")
    if ruta is not None and not storage_planos.es_ruta_de_plano(ruta):
        raise CopiaInvalida(
            f"La fila {n} de «{nombre_llano(Plano.__tablename__)}» apunta a algo que no es el "
            f"archivo de un plano ({str(ruta)[:80]!r}): esa copia no se puede restaurar."
        )
    if ruta is None and con_archivo_hoy is not None:
        return valores.get("id") in con_archivo_hoy
    return True


def _revisar_tope(valores: dict, tabla: str, n: int, tope: tuple) -> None:
    columna, topes, columna_rol = tope
    codigo = valores.get(columna)
    maximo = topes.get(codigo)
    if not maximo or (columna_rol and valores.get(columna_rol) == ROL_ADMIN):
        return
    nivel = valores.get("nivel")
    if rango(nivel) > rango(maximo):
        quien = (f"al rol «{valores.get(columna_rol)}»" if columna_rol
                 else f"a la persona #{valores.get('id_usuario')}")
        raise CopiaInvalida(
            f"La fila {n} de «{nombre_llano(tabla)}» le da «{_DICHO_NIVEL.get(nivel, nivel)}» en "
            f"«{codigo}» {quien}, y eso es sólo del rol Administrador (la pantalla de permisos "
            "no deja darlo). No se puede restaurar con los usuarios; sin ellos, sí."
        )


def _decodificar(renglon: bytes, tabla: str, n: int, ancho: int) -> list:
    try:
        fila = json.loads(renglon.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise CopiaInvalida(f"La fila {n} de «{nombre_llano(tabla)}» está dañada: no es un JSON válido.")
    if not isinstance(fila, list) or len(fila) != ancho:
        raise CopiaInvalida(
            f"La fila {n} de «{nombre_llano(tabla)}» no tiene las columnas que dice el manifiesto."
        )
    return fila


def _convertir_fila(fila: list, plan: PlanTabla, tabla: str, n: int) -> dict:
    valores = {}
    for i, columna, convertir in plan.lectura:
        try:
            valores[columna] = convertir(fila[i])
        except (ValueError, TypeError, ArithmeticError) as e:
            raise CopiaInvalida(
                f"La fila {n} de «{nombre_llano(tabla)}» tiene en «{columna}» un valor que hoy no "
                f"entra ({e}): no se puede restaurar."
            )
    valores.update(plan.completar)
    return valores


def _nombre_de_cuenta(u: dict) -> str:
    nombre = " ".join(str(p) for p in (u.get("nombre"), u.get("apellido")) if p).strip()
    usuario = u.get("username")
    if nombre and usuario:
        return f"{nombre} ({usuario})"
    return nombre or usuario or f"#{u.get('id_usuario')}"


def _lista(cuentas: list) -> str:
    return ", ".join(cuentas)


def _revisar_usuarios(plan: Optional[PlanTabla], usuarios: list, admin: Optional[dict],
                      usuarios_actuales: Optional[list], avisos: list) -> list:
    """La opción avanzada: los usuarios vuelven a los de la copia con las reglas de
    «LO QUE NO SE RESTAURA». Que eso sea posible se revisa acá, antes; y se devuelve,
    en castellano, qué pasa con cada cuenta que cambia."""
    if plan is None or plan.accion != "reemplaza":
        avisos.append("La copia no trae usuarios: se dejan los de ahora.")
        return []
    if not admin:
        raise CopiaInvalida("No se sabe quién restaura: no se pueden incluir los usuarios.")
    hoy = {u["id_usuario"]: u for u in (usuarios_actuales or []) if u.get("id_usuario") is not None}
    hoy.setdefault(admin["id_usuario"], admin)
    intocables = {admin["id_usuario"]} | {i for i, u in hoy.items() if u.get("admin_permanente")}

    # Una cuenta que queda como está no puede chocar con otra de la copia: mismo usuario
    # o email con otro número haría fallar la carga (o dejaría a esa persona afuera).
    for u in usuarios:
        if u.get("id_usuario") in intocables:
            continue
        for i in intocables:
            h = hoy.get(i) or {}
            if ((u.get("username") and u.get("username") == h.get("username"))
                    or (u.get("email") and u.get("email") == h.get("email"))):
                if i == admin["id_usuario"]:
                    raise CopiaInvalida(
                        "En la copia tu usuario (o tu email) es de otra cuenta, con otro número: "
                        "si se incluyen los usuarios quedarías afuera. Restaurá sin incluir usuarios."
                    )
                raise CopiaInvalida(
                    f"En la copia, el usuario (o el email) de {_nombre_de_cuenta(h)}, que es "
                    "administrador permanente, es de otra cuenta, con otro número: no se pueden "
                    "incluir los usuarios sin tocar su cuenta. Restaurá sin incluir usuarios."
                )

    de_la_copia = {u["id_usuario"]: u for u in usuarios if u.get("id_usuario") is not None}
    cambios: list[str] = []
    permanentes = [_nombre_de_cuenta(hoy[i]) for i in sorted(intocables)
                   if i != admin["id_usuario"] and i in hoy]
    cambios.append(
        "Tu cuenta" + (f" y la de los administradores permanentes ({_lista(permanentes)})"
                       if permanentes else "")
        + " quedan exactamente como están hoy: rol, contraseña y activas."
    )
    se_borran = [_nombre_de_cuenta(u) for i, u in sorted(hoy.items())
                 if i not in de_la_copia and i not in intocables]
    if se_borran:
        cambios.append(f"Se borran, porque no estaban en la copia: {_lista(se_borran)}.")
    vuelven = [_nombre_de_cuenta(u) for i, u in sorted(de_la_copia.items())
               if i not in hoy and i not in intocables]
    if vuelven:
        cambios.append(
            f"Vuelven desactivadas y sin contraseña, porque hoy no existen: {_lista(vuelven)}. "
            "Para que alguna vuelva a entrar, activala en Usuarios y que use «Olvidé mi contraseña»."
        )
    en_las_dos = [(hoy[i], u) for i, u in sorted(de_la_copia.items()) if i in hoy and i not in intocables]
    cambian_rol = [f"{_nombre_de_cuenta(h)} ({h.get('rol')} → {u.get('rol')})"
                   for h, u in en_las_dos if u.get("rol") != h.get("rol")]
    if cambian_rol:
        cambios.append(f"Cambian de rol: {_lista(cambian_rol)}.")
    se_desactivan = [_nombre_de_cuenta(h) for h, u in en_las_dos if h.get("activo") and not u.get("activo")]
    if se_desactivan:
        cambios.append(f"Quedan desactivadas, como en la copia: {_lista(se_desactivan)}.")
    siguen = [_nombre_de_cuenta(h) for h, u in en_las_dos if not h.get("activo") and u.get("activo")]
    if siguen:
        cambios.append(
            f"Siguen desactivadas aunque en la copia estaban activas (restaurar no reactiva a "
            f"nadie): {_lista(siguen)}."
        )
    cambios.append("Nadie vuelve a una contraseña vieja: cada cuenta que existe hoy conserva la suya.")
    avisos.append(
        "Los usuarios, roles y permisos vuelven a los de la copia, salvo lo que se detalla en "
        "«Qué pasa con las cuentas». Tu cuenta queda como está ahora."
    )
    return cambios


# ─────────────────────────── restaurar ───────────────────────────


class CopiaPreviaFallo(Exception):
    """No se pudo guardar la copia del estado actual: no se restaura."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _nombre_sql(conn, tabla: Table) -> str:
    """El nombre de la tabla citado por el dialecto. La tabla sale del esquema REAL
    (reflect), nunca del archivo."""
    return conn.dialect.identifier_preparer.format_table(tabla)


async def _bloquear(conn, tablas: list) -> None:
    if conn.dialect.name != "postgresql" or not tablas:
        return
    # Si algo tiene una tabla tomada, se espera un rato y no para siempre.
    await conn.execute(text("SET LOCAL lock_timeout = '20s'"))
    await conn.execute(text("SET LOCAL statement_timeout = '15min'"))
    nombres = ", ".join(_nombre_sql(conn, t) for t in tablas)
    await conn.execute(text(f"LOCK TABLE {nombres} IN ACCESS EXCLUSIVE MODE"))


async def _vaciar(conn, tablas: list) -> None:
    if not tablas:
        return
    if conn.dialect.name == "postgresql":
        # Sin CASCADE: si alguna tabla que NO se vacía apuntara a éstas, Postgres frena
        # en vez de vaciarla de rebote (la revisión ya lo descarta; esto es por si acaso).
        nombres = ", ".join(_nombre_sql(conn, t) for t in tablas)
        await conn.execute(text(f"TRUNCATE TABLE {nombres}"))
        return
    # SQLite (los tests): borrar de las hojas a la raíz, con las claves foráneas
    # chequeadas al commit (así la recarga no depende del orden entre tablas).
    await conn.execute(text("PRAGMA defer_foreign_keys = ON"))
    for t in reversed(tablas):
        await conn.execute(t.delete())


async def _ajustar_secuencias(conn, tablas: list) -> None:
    """Cada secuencia de id, al máximo: el mayor entre el id más alto que quedó y el
    último que ya se dio. Nunca para atrás: la auditoría (que no se toca) habla de ids
    que ya se usaron, y darlos de nuevo confundiría a quien la lea."""
    if conn.dialect.name == "postgresql":
        for t in tablas:
            for col in t.columns:
                if not isinstance(col.type, sqltypes.Integer):
                    continue
                secuencia = await conn.scalar(
                    text("SELECT pg_get_serial_sequence(:tabla, :columna)"),
                    {"tabla": _nombre_sql(conn, t), "columna": col.name},
                )
                if not secuencia:
                    continue
                maximo = await conn.scalar(select(func.max(t.c[col.name])))
                ultimo = await conn.scalar(
                    text("SELECT pg_sequence_last_value(CAST(CAST(:s AS text) AS regclass))"),
                    {"s": secuencia},
                )
                tope = max(int(maximo or 0), int(ultimo or 0))
                if tope > 0:
                    await conn.execute(
                        text("SELECT setval(CAST(CAST(:s AS text) AS regclass), :v, true)"),
                        {"s": secuencia, "v": tope},
                    )
        return
    if conn.dialect.name == "sqlite":
        # Sin AUTOINCREMENT, SQLite da max(id)+1 solo. Con AUTOINCREMENT lleva la cuenta
        # en sqlite_sequence: se sube al máximo, igual que en Postgres.
        hay = await conn.scalar(text(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
        ))
        if not hay:
            return
        for t in tablas:
            clave = list(t.primary_key.columns)
            if len(clave) != 1 or not isinstance(clave[0].type, sqltypes.Integer):
                continue
            maximo = await conn.scalar(select(func.max(clave[0])))
            if maximo is None:
                continue
            await conn.execute(
                text("UPDATE sqlite_sequence SET seq = max(seq, :m) WHERE name = :n"),
                {"m": int(maximo), "n": t.name},
            )


def _autorreferencias(tabla: Table) -> list:
    """Columnas que apuntan a la misma tabla (usuario.creado_por). Se cargan en un
    segundo paso: la fila a la que apuntan puede venir más abajo en el archivo."""
    return sorted({fk.parent.name for fk in tabla.foreign_keys if fk.column.table is tabla})


def _lotes(zf: zipfile.ZipFile, plan: PlanTabla, info: zipfile.ZipInfo, sha256: str) -> Iterator[list]:
    """Las filas de una tabla, ya convertidas, de a LOTE. Vuelve a verificar el hash:
    se restaura exactamente lo que se revisó."""
    lector = _LectorDeTabla(zf, info)
    lote: list = []
    n = 0
    for renglon in lector:
        n += 1
        fila = _decodificar(renglon, plan.nombre, n, len(plan.columnas_copia))
        lote.append(_convertir_fila(fila, plan, plan.nombre, n))
        if len(lote) >= LOTE:
            yield lote
            lote = []
    if lector.sha256 != sha256 or n != plan.filas_copia:
        raise CopiaInvalida(
            f"«{nombre_llano(plan.nombre)}» cambió entre la revisión y la carga. No se restauró nada."
        )
    if lote:
        yield lote


async def _en_hilo(funcion, *args):
    # Leer y descomprimir es CPU: en un hilo, para no frenar los demás pedidos.
    return await asyncio.to_thread(funcion, *args)


_FIN = object()


def _siguiente(iterador):
    return next(iterador, _FIN)


async def restaurar_copia(
    conn,
    esquema: MetaData,
    archivo: BinaryIO,
    revision: Revision,
    *,
    admin_actual: Optional[dict] = None,
    antes_de_borrar: Optional[Callable[[], Awaitable[Any]]] = None,
) -> dict:
    """Reemplaza los datos de la base por los de la copia, en la transacción de `conn`.

    NO hace commit: lo hace quien llama, y si esto levanta, hace rollback y la base
    queda como estaba. `antes_de_borrar` corre con las tablas ya bloqueadas y antes de
    vaciar nada: es donde se arma y se guarda la copia del estado actual. Si levanta, no
    se borra nada.
    """
    if conn.dialect.name not in ("postgresql", "sqlite"):
        raise CopiaInvalida("Restaurar sólo está disponible con la base en Postgres.")

    zf = _abrir_zip(archivo)
    tablas = {t.name: t for t in tablas_en_orden(esquema)}
    a_reemplazar = [tablas[p.nombre] for p in revision.a_reemplazar]

    await _bloquear(conn, a_reemplazar)
    if antes_de_borrar is not None:
        await antes_de_borrar()

    # Lo que no viaja en la copia y se conserva: los archivos adentro de la base (el
    # camino viejo de los planos), para las filas que vuelven. Se ponen EN el INSERT y no
    # con un UPDATE después: un plano del camino viejo no tiene ruta, y sin el archivo la
    # fila choca con ck_plano_tiene_archivo (archivo o ruta, alguno) al insertarla.
    archivos_guardados: dict = {}   # tabla -> {columna: {clave: contenido}}
    for t in a_reemplazar:
        clave = list(t.primary_key.columns)
        binarias = [c for c in t.columns if _es_archivo(c)]
        if len(clave) != 1 or not binarias or revision.plan(t.name).accion != "reemplaza":
            continue
        for col in binarias:
            filas = (await conn.execute(select(clave[0], col).where(col.is_not(None)))).all()
            if filas:
                archivos_guardados.setdefault(t.name, {})[col.name] = dict(filas)

    # Planos: la ruta de HOY de cada uno, para una fila que la copia trae sin ruta (era
    # del camino viejo) y que después se pasó a Storage.
    t_plano = tablas.get(Plano.__tablename__)
    plano_vuelve = (
        t_plano is not None and any(t is t_plano for t in a_reemplazar)
        and revision.plan(t_plano.name).accion == "reemplaza"
        and "storage_path" in t_plano.c and "id" in t_plano.c
    )
    rutas_de_hoy: dict = {}
    if plano_vuelve:
        rutas_de_hoy = dict((await conn.execute(
            select(t_plano.c.id, t_plano.c.storage_path).where(t_plano.c.storage_path.is_not(None))
        )).all())

    # Con los usuarios: las cuentas de hoy, enteras, antes de vaciar nada.
    t_usuario = tablas.get(Usuario.__tablename__)
    incluye_usuarios = (
        t_usuario is not None and revision.plan(t_usuario.name) is not None
        and revision.plan(t_usuario.name).accion == "reemplaza"
    )
    cuentas_de_hoy: dict = {}
    intocables: set = set()
    if incluye_usuarios:
        if not admin_actual or admin_actual.get("id_usuario") is None:
            raise CopiaInvalida("No se sabe quién restaura: no se pueden incluir los usuarios.")
        cuentas_de_hoy = {f["id_usuario"]: dict(f)
                          for f in (await conn.execute(select(t_usuario))).mappings().all()}
        if admin_actual["id_usuario"] not in cuentas_de_hoy:
            raise CopiaInvalida("Tu usuario no está en la base: no se pueden incluir los usuarios.")
        # Tu cuenta y las de los administradores permanentes: tal cual están hoy.
        intocables = {admin_actual["id_usuario"]} | {
            i for i, f in cuentas_de_hoy.items() if f.get("admin_permanente")}

    await _vaciar(conn, a_reemplazar)

    cargadas: dict = {}
    archivos_conservados = 0
    planos_sin_archivo = 0
    for t in a_reemplazar:
        plan = revision.plan(t.name)
        if plan.accion != "reemplaza":
            cargadas[t.name] = 0
            continue
        datos = revision.manifiesto["tablas"][t.name]
        info = zf.getinfo(datos["archivo"])
        autorreferencias = _autorreferencias(t)
        clave = [c.name for c in t.primary_key.columns]
        diferidas_cols = [c for c in autorreferencias if clave and any(n == c for (_, n, _) in plan.lectura)]
        son_usuarios = incluye_usuarios and t is t_usuario
        guardados = archivos_guardados.get(t.name, {})
        es_plano = plano_vuelve and t is t_plano
        diferidas: list = []  # (valores de la clave, {columna: valor})
        claves_cargadas: set = set()
        total = 0
        iterador = _lotes(zf, plan, info, datos["sha256"])
        while True:
            lote = await _en_hilo(_siguiente, iterador)
            if lote is _FIN:
                break
            if son_usuarios:
                lote = [_cuenta_que_vuelve(f, cuentas_de_hoy.get(f.get("id_usuario")), t)
                        for f in lote if f.get("id_usuario") not in intocables]
            if guardados:
                # Todas las filas con la columna (un INSERT de varias filas pide las
                # mismas columnas en todas): la que no tenía archivo, con NULL.
                for f in lote:
                    for columna, valores in guardados.items():
                        f[columna] = valores.get(f.get(clave[0]))
                        if f[columna] is not None:
                            archivos_conservados += 1
            if es_plano:
                quedan = []
                for f in lote:
                    ruta = f.get("storage_path")
                    if ruta is not None and not storage_planos.es_ruta_de_plano(ruta):
                        raise CopiaInvalida(
                            f"Un plano de la copia apunta a algo que no es un plano ({str(ruta)[:80]!r})."
                        )
                    f["storage_path"] = ruta
                    if ruta is None and f.get("archivo") is None:
                        f["storage_path"] = rutas_de_hoy.get(f.get("id"))
                        if f["storage_path"] is None:
                            # Ni blob ni ruta, ni en la copia ni hoy: no tiene archivo en
                            # ningún lado. La revisión ya lo avisó.
                            planos_sin_archivo += 1
                            continue
                    quedan.append(f)
                lote = quedan
            for f in lote:
                if diferidas_cols:
                    pendientes = {c: f[c] for c in diferidas_cols if f.get(c) is not None}
                    if pendientes:
                        diferidas.append(({k: f[k] for k in clave}, pendientes))
                    for c in diferidas_cols:
                        f[c] = None
                if len(clave) == 1 and (diferidas_cols or son_usuarios):
                    claves_cargadas.add(f.get(clave[0]))
            if lote:
                await conn.execute(t.insert(), lote)
                total += len(lote)
        if son_usuarios:
            propias = [dict(cuentas_de_hoy[i]) for i in sorted(intocables) if i in cuentas_de_hoy]
            for propia in propias:
                claves_cargadas.add(propia["id_usuario"])
            for propia in propias:
                pendientes = {c: propia[c] for c in autorreferencias if propia.get(c) is not None}
                for c in autorreferencias:
                    propia[c] = None
                # Quién la creó o la tocó por última vez, sólo si esa cuenta sigue existiendo.
                pendientes = {c: v for c, v in pendientes.items() if v in claves_cargadas}
                if pendientes:
                    diferidas.append(({"id_usuario": propia["id_usuario"]}, pendientes))
            if propias:
                await conn.execute(t.insert(), propias)
                total += len(propias)
        for valores_clave, pendientes in diferidas:
            condicion = [t.c[k] == v for k, v in valores_clave.items()]
            await conn.execute(update(t).where(*condicion).values(**pendientes))
        cargadas[t.name] = total

    await _ajustar_secuencias(conn, a_reemplazar)

    return {
        "filas_por_tabla": cargadas,
        "total_filas": sum(cargadas.values()),
        "archivos_conservados": archivos_conservados,
        "planos_sin_archivo": planos_sin_archivo,
    }


def _cuenta_que_vuelve(fila: dict, hoy: Optional[dict], tabla: Table) -> dict:
    """Una cuenta de la copia, con las reglas de «LO QUE NO SE RESTAURA» (usuarios).

    Todas las filas salen con las mismas columnas (un INSERT de varias filas lo pide):
    las de CAMPOS_DE_HOY que existan hoy, y `activo`."""
    columnas = set(tabla.c.keys())
    if hoy is not None:
        # Existe hoy: la contraseña, el bloqueo y la marca de permanente, los de hoy. Y
        # activa sólo si lo está en la copia Y hoy: restaurar no reactiva a nadie.
        for c in CAMPOS_DE_HOY:
            if c in columnas:
                fila[c] = hoy.get(c)
        if "activo" in columnas:
            fila["activo"] = bool(fila.get("activo", True)) and bool(hoy.get("activo"))
        return fila
    # Hoy no existe (se borró después de la copia): vuelve desactivada y sin contraseña.
    nueva = {
        "password_hash": CLAVE_INUSABLE,
        "reset_token": None,
        "reset_token_expiry": None,
        "intentos_fallidos": 0,
        "bloqueado_hasta": None,
        "debe_cambiar_password": True,
        "admin_permanente": False,
    }
    for c in CAMPOS_DE_HOY:
        if c in columnas:
            fila[c] = nueva[c]
    if "activo" in columnas:
        fila["activo"] = False
    return fila


async def contar_filas(conn, esquema: MetaData) -> dict:
    """Cuántas filas tiene hoy cada tabla (para la vista previa)."""
    cuentas = {}
    for t in tablas_en_orden(esquema):
        cuentas[t.name] = int(await conn.scalar(select(func.count()).select_from(t)) or 0)
    return cuentas
