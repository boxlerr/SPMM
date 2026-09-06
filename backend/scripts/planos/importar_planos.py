"""
Carga a la base los planos que el taller tiene en Google Drive, colgados del ARTÍCULO.

POR QUÉ
    En producción `plano` tiene 0 filas. Subir el PDF a mano, OT por OT, no lo hace
    nadie: son 150 órdenes abiertas y el plano ya existe, dibujado, en otro lado. Y esa
    tabla vacía no es inocente — el planificador usa "¿tiene plano adjunto?" como filtro
    DURO (ver PlanoRepository.find_ordenes_con_plano), así que hoy ninguna OT tiene
    plano y el filtro no filtra nada.

    Los planos sí existen: cientos de PDFs en una carpeta de Drive del taller, una
    subcarpeta por CÓDIGO DE ARTÍCULO. Se cargan contra el ARTÍCULO y no contra la OT
    porque así lo piensa el taller: el plano es del producto, no del pedido. Cargado una
    vez, aparece solo en todas las OT que fabrican ese producto — incluidas las que
    todavía no existen.

QUÉ NO TOCA
    Nada de `orden_trabajo`, y ninguna fila que haya subido una persona desde la app
    (esas quedan con `id_orden_trabajo` y sin `drive_file_id`). Solo escribe planos de
    artículo.

CÓMO SE CORRE
    Está contado paso a paso en el README.md de al lado. En dos líneas:
        .venv/bin/python -m backend.scripts.planos.importar_planos --desde-drive --dry-run
        .venv/bin/python -m backend.scripts.planos.importar_planos --desde-drive
"""
import argparse
import asyncio
import csv
import hashlib
import io
import mimetypes
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Iterator, Optional

from dotenv import load_dotenv

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
load_dotenv(os.path.join(RAIZ, ".env"))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

# ---------------------------------------------------------------------------
# La carpeta "O:" del taller, la que comparte lsantacruz@metlongchamps.com. Adentro
# hay una subcarpeta por código de artículo. Se deja como valor por defecto de
# --desde-drive para que nadie tenga que acordarse del id, pero se puede pasar otro.
# ---------------------------------------------------------------------------
CARPETA_RAIZ = "12vIaihvmPX-uSx5jw7ny7QYxwOAY3NMG"

SCOPE_DRIVE = "https://www.googleapis.com/auth/drive.readonly"
MIME_CARPETA = "application/vnd.google-apps.folder"

# Cada cuántos archivos se hace commit. Ni uno solo al final (si se corta, se pierde
# todo el laburo de bajar) ni uno por archivo (600 transacciones contra el pooler).
LOTE = 25

# El comando exacto que hay que correr si las credenciales no tienen el scope de Drive.
# Se imprime tal cual para poder copiarlo y pegarlo.
COMANDO_GCLOUD = (
    "gcloud auth application-default login "
    "--scopes=openid,https://www.googleapis.com/auth/drive.readonly,"
    "https://www.googleapis.com/auth/cloud-platform"
)

# ── Cómo termina cada archivo. Son los textos que ve el taller en el CSV, así que van
#    en castellano y sin jerga.
IMPORTADO = "Importado"
ACTUALIZADO = "Actualizado"
SIN_CAMBIOS = "Sin cambios"
CARPETA_VACIA = "Carpeta vacía"
SIN_ARTICULO = "El código no está en el sistema"
NO_SOPORTADO = "Archivo no soportado"
ERROR = "Error"

ORDEN_RESULTADOS = [IMPORTADO, ACTUALIZADO, SIN_CAMBIOS, CARPETA_VACIA,
                    SIN_ARTICULO, NO_SOPORTADO, ERROR]

COLUMNAS_CSV = [
    "resultado", "codigo_carpeta", "archivo", "id_articulo",
    "codigo_en_el_sistema", "descripcion_articulo", "tipo", "tamaño_kb",
    "codigo_repetido", "id_en_drive", "detalle",
]


# ═══════════════════════════════════════════════════════════════════════════
#  Códigos de artículo
# ═══════════════════════════════════════════════════════════════════════════

def normalizar_codigo(codigo: str) -> str:
    """Deja el código como para comparar carpeta contra base.

    En `articulo` hay 8 códigos con espacios en los bordes y otros con espacios de más
    en el medio; el nombre de la carpeta en Drive viene escrito a mano. Si se compara
    tal cual, esos no matchean nunca. Se recorta, se colapsa el blanco interno a un
    espacio y se pasa a mayúsculas.
    """
    return re.sub(r"\s+", " ", (codigo or "").strip()).upper()


# ═══════════════════════════════════════════════════════════════════════════
#  Las dos fuentes: Drive y una carpeta local
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class ArchivoPlano:
    nombre: str
    mime: str
    tamano: int
    md5: Optional[str]
    modificado: Optional[datetime]
    drive_id: Optional[str]
    descargar: Callable[[], bytes]


@dataclass
class CarpetaArticulo:
    codigo: str
    archivos: list
    nota: str = ""


# Lo que el visor del front puede abrir de verdad. Es una lista cerrada y no un
# `mime.startswith("image/")` porque eso deja pasar cosas que NO se ven en el navegador:
# `.dwg` (el CAD de donde salen los planos) es "image/vnd.dwg" para mimetypes, y cargarlo
# da una fila que después no abre nadie. Si aparece un DWG conviene que salga en el CSV
# como "no soportado" para que el taller mande el PDF.
MIMES_SOPORTADOS = {
    "application/pdf",
    "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp",
}


def _es_soportado(mime: str) -> bool:
    return (mime or "").lower() in MIMES_SOPORTADOS


# Las primeras firmas de cada formato. Se mira el CONTENIDO y no la extensión porque en
# la carpeta del taller hay archivos que dicen .pdf y no lo son:
#   · "~$e L.880 doble chav.pdf" y "~$H cava.pdf" — los archivos temporales que deja Word
#     cuando alguien tiene el documento abierto. Empiezan con \x02Pc.
#   · "Solid Edge V20.pdf" — un pedazo del instalador de Solid Edge que arranca con "[PDF]".
# Cargarlos daría una fila que después no abre nadie: se ve la tarjeta, se toca, y no pasa
# nada. Mejor que salgan en el CSV para que el taller los borre de Drive.
FIRMAS = {
    "application/pdf": (b"%PDF",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/jpg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/bmp": (b"BM",),
    "image/webp": (b"RIFF",),
}


def contenido_coincide(datos: bytes, mime: str) -> bool:
    """¿El archivo es de verdad lo que dice ser? Sin datos (dry-run) se da por bueno."""
    if not datos:
        return True
    firmas = FIRMAS.get((mime or "").lower())
    if not firmas:
        return True
    return any(datos.startswith(f) for f in firmas)


# ═══════════════════════════════════════════════════════════════════════════
#  Achicar las fotos
# ═══════════════════════════════════════════════════════════════════════════
#
# En la carpeta del taller hay 267 imágenes que pesan 278 MB, y 80 de ellas se llevan
# 248 MB: son fotos sacadas con el celular, de hasta 13 MB. Un plano en PDF, en cambio,
# tiene una mediana de 131 KB.
#
# El lugar NO es el problema: 634 MB entran cómodos en los 8 GB de disco que el plan Pro
# le da a ESTE proyecto. El problema es el tiempo. Cada vez que alguien abre el plano hay
# que bajarlo entero —y para dibujar la miniatura, también—, sobre la conexión del taller.
# Y encima, arriba de 3 MB la miniatura ni se intenta (ver MAX_BYTES_MINIATURA en
# PlanoThumb): esas fotos se ven como un ícono gris, que es justo lo que veníamos a evitar.
#
# Achicar a 2400 px de lado largo deja una foto que se lee de sobra en pantalla y se puede
# imprimir en A4, pesando una fracción. Convertirlas a PDF, que es lo primero que uno
# piensa, NO ahorra nada: un PDF con una foto adentro es la misma foto más el envoltorio.
# Lo que ahorra es reducir y recomprimir, que es lo que se hace acá.
LADO_MAX = 2400
CALIDAD_JPEG = 78


def optimizar_imagen(datos: bytes, mime: str) -> tuple[bytes, str, str]:
    """Devuelve (datos, mime, detalle). Si no conviene tocarla, la devuelve igual.

    Nunca falla hacia afuera: si Pillow no está instalado o la imagen está rota, se
    guarda el original. Perder el plano por no poder achicarlo sería peor que el peso.
    """
    if (mime or "").lower() not in {"image/jpeg", "image/jpg", "image/png", "image/bmp"}:
        return datos, mime, ""
    try:
        from PIL import Image
    except ImportError:
        return datos, mime, "sin Pillow, se guarda como vino"

    import io
    try:
        from PIL import ImageOps
        with Image.open(io.BytesIO(datos)) as im:
            im.load()

            # 1) Enderezarla ANTES que nada.
            #
            # Una foto sacada con el celular en vertical viene con los píxeles acostados
            # y una marca EXIF que dice "rotame 90°". Drive y el navegador la muestran
            # parada porque leen esa marca. Al recomprimir, la marca se pierde —y los
            # píxeles seguían acostados—, así que el plano aparecía girado en la
            # miniatura, en el visor y al imprimirlo. `exif_transpose` gira los píxeles
            # de verdad y saca la marca, que es lo único que deja la foto bien parada sin
            # depender de que quien la mire lea el EXIF.
            im = ImageOps.exif_transpose(im) or im

            ancho, alto = im.size
            escala = min(1.0, LADO_MAX / max(ancho, alto))
            if escala < 1.0:
                im = im.resize((max(1, int(ancho * escala)), max(1, int(alto * escala))),
                               Image.LANCZOS)

            # 2) Aplanar la transparencia SOBRE BLANCO.
            #
            # Un PNG exportado del CAD es el dibujo en líneas negras sobre fondo
            # transparente, y abajo del canal alfa el color suele ser negro. Un
            # `convert("RGB")` pelado tira el alfa y deja ese negro: el plano entra a la
            # base como una hoja negra con las líneas negras invisibles. (Pasó de verdad:
            # "Arandelas para reforma de rotula.png" quedó así en la primera importación.)
            #
            # Ojo con el chequeo: `"transparency" in im.info` NO alcanza, porque esa clave
            # es del chunk tRNS —PNG de paleta o con un color transparente— y no existe en
            # un PNG de 32 bits, que es justo el que exportan el CAD y el navegador. Hay
            # que mirar el modo.
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                rgba = im.convert("RGBA")
                fondo = Image.new("RGB", rgba.size, (255, 255, 255))
                fondo.paste(rgba, mask=rgba.split()[3])
                im = fondo

            salida = io.BytesIO()
            im.convert("RGB").save(salida, format="JPEG", quality=CALIDAD_JPEG,
                                   optimize=True, progressive=True)
            nuevo_mime = "image/jpeg"
            chico = salida.getvalue()
    except Exception as e:
        return datos, mime, f"no se pudo achicar ({type(e).__name__}), se guarda como vino"

    # Si no achicó nada, se queda el original: hay fotos ya optimizadas donde volver a
    # comprimir solo agrega artefactos.
    if len(chico) >= len(datos):
        return datos, mime, ""
    ahorro = 100 - (100 * len(chico) // max(1, len(datos)))
    return chico, nuevo_mime, f"{_kb(len(datos))} KB → {_kb(len(chico))} KB ({ahorro}% menos)"


def _md5_de_archivo(ruta: str) -> str:
    h = hashlib.md5()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1024 * 1024), b""):
            h.update(bloque)
    return h.hexdigest()


def _fecha_sin_zona(iso: Optional[str]) -> Optional[datetime]:
    """RFC3339 de Drive ("2025-03-11T14:02:07.331Z") → datetime naive en hora local.

    Todas las fechas del sistema son naive y en hora de Argentina; una fecha con zona
    la rechaza Postgres al insertar en un TIMESTAMP sin zona. Se pasa a local antes de
    sacarle el tzinfo para que la hora que se guarda sea la que ve la gente.
    """
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
    except ValueError:
        return None


# ── Drive ──────────────────────────────────────────────────────────────────

def _servicio_drive():
    """Cliente de Drive con las credenciales de gcloud (ADC).

    No hay service account ni client_secret.json en el repo a propósito: la carpeta es
    de una persona del taller y se comparte con la cuenta de Google de quien corre esto.
    Las credenciales salen de `gcloud auth application-default login`.
    """
    try:
        from google.auth import default as credenciales_por_defecto
        from googleapiclient.discovery import build
    except ImportError as e:
        sys.exit(
            f"Falta una librería de Google ({e.name}).\n"
            f"  .venv/bin/pip install -r requirements-dev.txt"
        )

    creds, proyecto = credenciales_por_defecto(scopes=[SCOPE_DRIVE])
    # cache_discovery=False: el cache en disco de googleapiclient tira warnings feos y
    # acá no gana nada, es un script que corre una vez.
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _explicar_error_drive(e: Exception) -> str:
    """Traduce los dos errores de Drive con los que uno se choca de verdad."""
    texto = str(e)
    if "insufficient authentication scopes" in texto or "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in texto:
        return ("Las credenciales de gcloud no tienen permiso de Drive. Corré:\n"
                f"  {COMANDO_GCLOUD}")
    if "has not been used in project" in texto or "accessNotConfigured" in texto:
        return ("La Drive API está apagada en el proyecto de GCP que usan tus credenciales.\n"
                "  Prendela en la consola (APIs y servicios → Habilitar → Google Drive API)\n"
                "  o corré el import con --desde-carpeta sobre el ZIP bajado a mano.")
    if "File not found" in texto or "notFound" in texto:
        return ("Drive dice que la carpeta no existe o no está compartida con tu cuenta.\n"
                "  Pedile a lsantacruz@metlongchamps.com que la comparta con el mail con el\n"
                "  que hiciste el login de gcloud.")
    return texto


def _transitorio(e: Exception) -> bool:
    estado = getattr(getattr(e, "resp", None), "status", None)
    return estado in (429, 500, 502, 503, 504)


def _reintentando(hacer, que: str, intentos: int = 3):
    """Drive contesta 500 o 429 cada tanto sin motivo. Reintentar tres veces con
    espera creciente evita tener que volver a arrancar el import entero."""
    for n in range(1, intentos + 1):
        try:
            return hacer()
        except Exception as e:
            if n == intentos or not _transitorio(e):
                raise
            espera = 2 ** n
            print(f"    ↻ {que}: {e}. Reintento en {espera}s.")
            time.sleep(espera)


def _listar_hijos(svc, id_padre: str) -> list:
    """Los hijos directos de una carpeta, paginando.

    supportsAllDrives / includeItemsFromAllDrives / corpora=allDrives: sin esos tres la
    API no ve nada que esté en una unidad compartida ni en una carpeta de otra cuenta,
    y contesta una lista vacía sin avisar de nada.
    """
    campos = "nextPageToken, files(id,name,mimeType,md5Checksum,size,modifiedTime,parents)"
    salida, token = [], None
    while True:
        resp = _reintentando(
            lambda: svc.files().list(
                q=f"'{id_padre}' in parents and trashed = false",
                fields=campos,
                pageSize=1000,
                orderBy="name",
                pageToken=token,
                corpora="allDrives",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            ).execute(),
            f"listar la carpeta {id_padre}",
        )
        salida.extend(resp.get("files", []))
        token = resp.get("nextPageToken")
        if not token:
            return salida


def _bajar_de_drive(svc, id_archivo: str) -> bytes:
    from googleapiclient.http import MediaIoBaseDownload

    def _hacerlo() -> bytes:
        buffer = io.BytesIO()
        pedido = svc.files().get_media(fileId=id_archivo, supportsAllDrives=True)
        bajada = MediaIoBaseDownload(buffer, pedido)
        listo = False
        while not listo:
            _, listo = bajada.next_chunk()
        return buffer.getvalue()

    return _reintentando(_hacerlo, f"bajar el archivo {id_archivo}")


def leer_drive(id_carpeta: str, limite: Optional[int]) -> Iterator[CarpetaArticulo]:
    svc = _servicio_drive()
    try:
        hijos = _listar_hijos(svc, id_carpeta)
    except Exception as e:
        sys.exit(_explicar_error_drive(e))

    subcarpetas = [h for h in hijos if h["mimeType"] == MIME_CARPETA]
    sueltos = [h for h in hijos if h["mimeType"] != MIME_CARPETA]
    suelto = f" (y {len(sueltos)} archivo{'s' if len(sueltos) != 1 else ''} suelto"
    suelto += f"{'s' if len(sueltos) != 1 else ''}, que se ignoran)"
    print(f"Drive: {len(subcarpetas)} subcarpetas en la raíz" + (suelto if sueltos else ""))

    for n, carpeta in enumerate(subcarpetas, start=1):
        if limite and n > limite:
            print(f"— corte por --limite {limite} —")
            return
        contenido = _listar_hijos(svc, carpeta["id"])
        anidadas = [c for c in contenido if c["mimeType"] == MIME_CARPETA]
        archivos = []
        for f in contenido:
            if f["mimeType"] == MIME_CARPETA:
                continue
            archivos.append(ArchivoPlano(
                nombre=f["name"],
                mime=f["mimeType"],
                tamano=int(f.get("size") or 0),
                # md5Checksum es el md5 del contenido: el mismo número que calcula
                # --desde-carpeta sobre el archivo bajado. Por eso los dos modos se
                # entienden entre sí. Los archivos nativos de Google (Docs, Sheets) no
                # lo traen; ahí queda en None y se baja siempre.
                md5=f.get("md5Checksum"),
                modificado=_fecha_sin_zona(f.get("modifiedTime")),
                drive_id=f["id"],
                descargar=(lambda fid=f["id"]: _bajar_de_drive(svc, fid)),
            ))
        nota = f"tiene {len(anidadas)} subcarpeta(s) adentro, que no se recorren" if anidadas else ""
        yield CarpetaArticulo(codigo=carpeta["name"], archivos=archivos, nota=nota)


# ── Carpeta local ──────────────────────────────────────────────────────────

def leer_carpeta_local(ruta: str, limite: Optional[int]) -> Iterator[CarpetaArticulo]:
    """Plan B: el ZIP de Drive bajado a mano y descomprimido.

    Misma estructura (una subcarpeta por código). Acá no hay id de Drive, así que la
    fila queda con `drive_file_id` en NULL y la idempotencia sale de (artículo, nombre
    de archivo) — ver `decidir()`. El md5 se calcula sobre el contenido, que da el
    mismo valor que informa Drive: si después se corre --desde-drive, ese import
    reconoce estas filas y les anota el id en vez de duplicarlas.
    """
    if not os.path.isdir(ruta):
        sys.exit(f"No existe la carpeta {ruta}")

    subcarpetas = sorted(
        (e for e in os.scandir(ruta) if e.is_dir()),
        key=lambda e: e.name,
    )
    print(f"Carpeta local: {len(subcarpetas)} subcarpetas en {ruta}")

    for n, carpeta in enumerate(subcarpetas, start=1):
        if limite and n > limite:
            print(f"— corte por --limite {limite} —")
            return
        archivos, anidadas = [], 0
        for entrada in sorted(os.scandir(carpeta.path), key=lambda e: e.name):
            if entrada.is_dir():
                anidadas += 1
                continue
            # Los ZIP de Drive traen basura de macOS (.DS_Store, ._archivo).
            if entrada.name.startswith("."):
                continue
            mime = mimetypes.guess_type(entrada.name)[0] or "application/octet-stream"
            stat = entrada.stat()
            archivos.append(ArchivoPlano(
                nombre=entrada.name,
                mime=mime,
                tamano=stat.st_size,
                md5=_md5_de_archivo(entrada.path),
                modificado=datetime.fromtimestamp(stat.st_mtime),
                drive_id=None,
                descargar=(lambda p=entrada.path: open(p, "rb").read()),
            ))
        nota = f"tiene {anidadas} subcarpeta(s) adentro, que no se recorren" if anidadas else ""
        yield CarpetaArticulo(codigo=carpeta.name, archivos=archivos, nota=nota)


# ═══════════════════════════════════════════════════════════════════════════
#  Base
# ═══════════════════════════════════════════════════════════════════════════

def _url_de_la_base() -> str:
    url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or ""
    if not url:
        sys.exit("No hay SUPABASE_DB_URL ni DATABASE_URL en el .env de la raíz.")
    for viejo in ("postgresql+psycopg2://", "postgresql+asyncpg://", "postgresql://", "postgres://"):
        if url.startswith(viejo):
            url = "postgresql+asyncpg://" + url[len(viejo):]
            break
    # El querystring (sslmode=..., pgbouncer=...) lo rechaza asyncpg.
    return re.sub(r"\?.*$", "", url)


def crear_engine():
    """Un pool de DOS conexiones, a propósito.

    El session pooler de Supabase admite 15 clientes para TODO el proyecto y producción
    ya se lleva la mayoría. Si este script abre el pool por defecto de SQLAlchemy (5
    fijas + 10 de overflow) tira abajo al backend con
    "(EMAXCONNSESSION) max clients reached in session mode". Con dos alcanza: el import
    es de a un archivo por vez.

    Se arma el engine acá y no se importa el de backend.infrastructure.db para no
    arrastrar la configuración de producción. Y NUNCA importar backend.presentation.main:
    al importarlo arranca sync_db, que escribe contra el sistema viejo cada 5 minutos.
    """
    return create_async_engine(
        _url_de_la_base(),
        pool_size=2,
        max_overflow=0,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )


SQL_INSERT = sa.text("""
    INSERT INTO plano (nombre, descripcion, tipo_archivo, archivo, fecha_subida,
                       id_orden_trabajo, id_articulo,
                       drive_file_id, drive_md5, drive_modificado)
    VALUES (:nombre, :descripcion, :tipo, :archivo, :subida,
            NULL, :id_articulo,
            :drive_id, :md5, :modificado)
    RETURNING id
""").bindparams(
    # asyncpg necesita que le digan que esto es bytea y no texto.
    sa.bindparam("archivo", type_=sa.LargeBinary()),
    sa.bindparam("subida", type_=sa.DateTime()),
    sa.bindparam("modificado", type_=sa.DateTime()),
)

# El COALESCE del drive_file_id no es adorno: si este reemplazo viene de
# --desde-carpeta el parámetro llega en NULL, y una asignación directa le borraría a la
# fila el id de Drive que ya tenía — que es justo la clave con la que el import de Drive
# la reconoce la próxima vez.
#
# (Y la explicación va acá arriba y no adentro del SQL a propósito: sa.text() busca
# parámetros `:nombre` en TODO el string, comentarios `--` incluidos, así que nombrar un
# parámetro dentro de un comentario SQL lo duplica y el execute revienta con
# "Incorrect number of bindings supplied".)
SQL_UPDATE = sa.text("""
    UPDATE plano
       SET nombre = :nombre,
           descripcion = :descripcion,
           tipo_archivo = :tipo,
           archivo = :archivo,
           fecha_subida = :subida,
           id_articulo = :id_articulo,
           drive_file_id = COALESCE(:drive_id, drive_file_id),
           drive_md5 = :md5,
           drive_modificado = :modificado
     WHERE id = :id
""").bindparams(
    sa.bindparam("archivo", type_=sa.LargeBinary()),
    sa.bindparam("subida", type_=sa.DateTime()),
    sa.bindparam("modificado", type_=sa.DateTime()),
)

# Cuando el contenido es el mismo y lo único que falta es anotar de qué archivo de
# Drive salió. No se vuelve a bajar el PDF ni se pisa el blob.
SQL_ANOTAR_DRIVE = sa.text("""
    UPDATE plano SET drive_file_id = :drive_id, drive_modificado = :modificado WHERE id = :id
""").bindparams(sa.bindparam("modificado", type_=sa.DateTime()))


async def verificar_esquema(conn) -> None:
    """Frena con un mensaje claro si todavía no corrió la migración.

    Sin esto el primer INSERT muere con un `UndefinedColumnError` de asyncpg, que no le
    dice a nadie que lo que falta es correr el SQL.
    """
    filas = (await conn.execute(sa.text("""
        SELECT column_name, is_nullable
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'plano'
    """))).all()
    if not filas:
        sys.exit("No existe la tabla `plano` en esta base. ¿Estás apuntando a la base correcta?")

    columnas = {f[0]: f[1] for f in filas}
    faltan = [c for c in ("id_articulo", "drive_file_id", "drive_md5", "drive_modificado")
              if c not in columnas]
    problemas = []
    if faltan:
        problemas.append("faltan las columnas: " + ", ".join(faltan))
    if columnas.get("id_orden_trabajo") == "NO":
        problemas.append("`id_orden_trabajo` todavía es NOT NULL")
    if problemas:
        sys.exit("La tabla `plano` no está migrada — " + "; ".join(problemas) + ".\n"
                 "  Corré primero backend/scripts/migrations/"
                 "2026-09-06_planos_por_articulo.sql")


async def cargar_articulos(conn) -> tuple[dict, dict]:
    """Índice código normalizado → artículo, más el mapa de los repetidos.

    Al normalizar (recortar + mayúsculas) hay 20 códigos que quedan apuntando a más de
    un artículo. Se elige el de id más bajo —el primero que dieron de alta— y el caso
    va al reporte: es un problema de datos del taller y lo tiene que ver alguien, no lo
    puede resolver este script.
    """
    filas = (await conn.execute(sa.text(
        "SELECT id, cod_articulo, descripcion FROM articulo ORDER BY id"
    ))).all()

    por_codigo, repetidos = {}, {}
    for id_art, cod, desc in filas:
        clave = normalizar_codigo(cod)
        if not clave:
            continue
        if clave in por_codigo:
            repetidos.setdefault(clave, [por_codigo[clave][0]]).append(id_art)
            continue      # las filas vienen ordenadas por id, así que gana la primera
        por_codigo[clave] = (id_art, cod, desc)
    return por_codigo, repetidos


async def cargar_planos_existentes(conn) -> tuple[dict, dict]:
    """Lo que ya está cargado, por id de Drive y por (artículo, nombre de archivo).

    No se trae la columna `archivo`: son blobs y traerlos todos para comparar un md5
    sería bajarse la base entera a memoria.
    """
    filas = (await conn.execute(sa.text("""
        SELECT id, nombre, id_articulo, drive_file_id, drive_md5
          FROM plano
         WHERE id_articulo IS NOT NULL OR drive_file_id IS NOT NULL
    """))).all()

    por_drive, por_articulo = {}, {}
    for id_plano, nombre, id_art, drive_id, md5 in filas:
        fila = {"id": id_plano, "drive_id": drive_id, "md5": md5}
        if drive_id:
            por_drive[drive_id] = fila
        if id_art:
            por_articulo[(id_art, (nombre or "").strip().lower())] = fila
    return por_drive, por_articulo


# ═══════════════════════════════════════════════════════════════════════════
#  El import
# ═══════════════════════════════════════════════════════════════════════════

def _kb(n: int) -> str:
    return f"{n / 1024:.1f}" if n else ""


async def importar(args) -> int:
    fuente = (leer_drive(args.desde_drive, args.limite) if args.desde_drive
              else leer_carpeta_local(args.desde_carpeta, args.limite))

    engine = crear_engine()
    filas_csv: list[dict] = []
    conteo = {r: 0 for r in ORDEN_RESULTADOS}
    ambiguos: dict[str, list] = {}
    cortado = False

    async with engine.connect() as conn:
        await verificar_esquema(conn)
        articulos, repetidos = await cargar_articulos(conn)
        por_drive, por_articulo = await cargar_planos_existentes(conn)
        # Ojo: una misma fila puede estar en los dos índices, así que se cuentan ids.
        ya_cargados = {f["id"] for f in (*por_drive.values(), *por_articulo.values())}
        print(f"Base: {len(articulos)} códigos de artículo, "
              f"{len(ya_cargados)} planos de artículo ya cargados.\n")

        pendientes_del_lote = 0

        def anotar(resultado, carpeta, archivo=None, art=None, detalle="", repetido=False):
            conteo[resultado] += 1
            filas_csv.append({
                "resultado": resultado,
                "codigo_carpeta": carpeta,
                "archivo": archivo.nombre if archivo else "",
                "id_articulo": art[0] if art else "",
                "codigo_en_el_sistema": art[1] if art else "",
                "descripcion_articulo": art[2] if art else "",
                "tipo": archivo.mime if archivo else "",
                "tamaño_kb": _kb(archivo.tamano) if archivo else "",
                "codigo_repetido": "sí" if repetido else "",
                "id_en_drive": (archivo.drive_id or "") if archivo else "",
                "detalle": detalle,
            })

        try:
            for n_carpeta, carpeta in enumerate(fuente, start=1):
                if n_carpeta % 50 == 0:
                    print(f"  … {n_carpeta} carpetas revisadas")

                clave = normalizar_codigo(carpeta.codigo)
                art = articulos.get(clave)
                repetido = clave in repetidos
                if repetido:
                    ambiguos[carpeta.codigo] = repetidos[clave]

                if not carpeta.archivos:
                    anotar(CARPETA_VACIA, carpeta.codigo, art=art,
                           detalle=carpeta.nota or "no hay ningún archivo adentro",
                           repetido=repetido)
                    continue

                # Las subcarpetas anidadas NO se recorren. En la carpeta de Drive son
                # cosas de una orden puntual y no el plano del producto: se llaman
                # "RECIBIDO OT 14012" / "ENTREGADO OT 14012" y adentro hay fotos de cómo
                # entró y cómo salió esa reparación. Meterlas acá le colgaría al artículo
                # fotos de una OT vieja como si fueran su dibujo. Quedan listadas en el
                # informe para que el taller decida qué hacer con ellas.
                if carpeta.nota:
                    print(f"  · {carpeta.codigo}: {carpeta.nota}")

                if art is None:
                    anotar(SIN_ARTICULO, carpeta.codigo,
                           detalle=f"{len(carpeta.archivos)} archivo(s) sin cargar: "
                                   + ", ".join(a.nombre for a in carpeta.archivos))
                    print(f"  ✗ {carpeta.codigo}: no hay ningún artículo con ese código")
                    continue

                id_art, cod_sistema, descripcion = art

                for archivo in carpeta.archivos:
                    if not _es_soportado(archivo.mime):
                        anotar(NO_SOPORTADO, carpeta.codigo, archivo, art,
                               detalle=f"solo se cargan PDF e imágenes; este es {archivo.mime}",
                               repetido=repetido)
                        print(f"  ✗ {carpeta.codigo} / {archivo.nombre}: {archivo.mime}")
                        continue

                    try:
                        # Cada archivo va en su propio SAVEPOINT. Si uno rompe (un
                        # nombre imposible, un blob que no entra), Postgres deja la
                        # transacción abortada y TODO lo que viene después falla en
                        # cadena hasta el commit del lote. Con el savepoint se cae ese
                        # archivo solo y los otros 24 del lote se guardan igual.
                        async with conn.begin_nested():
                            accion, detalle = await procesar_archivo(
                                conn, archivo, id_art, descripcion,
                                por_drive, por_articulo, args.dry_run, achicar=not args.sin_achicar,
                            )
                    except Exception as e:
                        anotar(ERROR, carpeta.codigo, archivo, art, detalle=str(e), repetido=repetido)
                        print(f"  ✗ {carpeta.codigo} / {archivo.nombre}: {e}")
                        continue

                    if repetido:
                        otros = ", ".join(str(i) for i in repetidos[clave])
                        detalle = (detalle + " · " if detalle else "") + (
                            f"el código está repetido en el sistema (artículos {otros}); "
                            f"se usó el {id_art}")
                    anotar(accion, carpeta.codigo, archivo, art, detalle=detalle, repetido=repetido)

                    if accion in (IMPORTADO, ACTUALIZADO):
                        print(f"  ✓ {carpeta.codigo} → {archivo.nombre} "
                              f"({_kb(archivo.tamano)} KB) — {accion.lower()}")
                        pendientes_del_lote += 1
                        if not args.dry_run and pendientes_del_lote >= LOTE:
                            await conn.commit()
                            pendientes_del_lote = 0

        except KeyboardInterrupt:
            # Se confirma lo que ya se bajó: la idempotencia por drive_file_id hace que
            # volver a correrlo retome donde quedó en vez de duplicar.
            cortado = True
            print("\n⚠️  Cortado a mano. Se guarda lo que ya estaba hecho; "
                  "volvé a correr el mismo comando para seguir.")

        if not args.dry_run:
            await conn.commit()
        else:
            await conn.rollback()

    await engine.dispose()

    ruta_csv = escribir_csv(filas_csv, args.csv, args.dry_run)
    imprimir_resumen(conteo, ambiguos, filas_csv, ruta_csv, args.dry_run, cortado)
    return 1 if conteo[ERROR] else 0


async def procesar_archivo(conn, archivo, id_art, descripcion,
                           por_drive, por_articulo, dry_run,
                           achicar: bool = True) -> tuple[str, str]:
    """Decide qué hacer con UN archivo y lo hace. Devuelve (resultado, detalle).

    El orden de búsqueda importa:
      1. por `drive_file_id` — la vía normal en la segunda corrida de --desde-drive.
      2. por (artículo, nombre de archivo) — para el plano que ya está cargado sin id
         de Drive: lo subió alguien desde la app, o entró por --desde-carpeta. Se lo
         adopta y se le anota el id en vez de dejar dos filas del mismo plano.
    """
    clave_nombre = (id_art, archivo.nombre.strip().lower())
    fila = (por_drive.get(archivo.drive_id) if archivo.drive_id else None) or \
        por_articulo.get(clave_nombre)

    # El nombre entra en varchar(255), la descripción en 500 y el mime en 20. Se
    # recorta acá y no en la base: un "value too long" a mitad del lote aborta la
    # transacción y se pierden los 24 archivos anteriores.
    campos = {
        "nombre": archivo.nombre[:255],
        "descripcion": (descripcion or "")[:500],
        "tipo": archivo.mime[:20],
        "id_articulo": id_art,
        "drive_id": archivo.drive_id,
        "modificado": archivo.modificado,
    }

    if fila is None:
        # En seco no se baja nada si Drive ya nos dio el md5: la primera corrida
        # recomendada (--desde-drive --dry-run) sale con la tabla vacía, o sea que TODOS
        # los archivos caen en esta rama, y bajarlos enteros para tirarlos es la
        # diferencia entre mirar el informe en un rato y esperar la carpeta completa.
        # Con --desde-carpeta no hay md5 de Drive y hay que leer el archivo igual.
        datos = None if (dry_run and archivo.md5) else archivo.descargar()
        # El md5 se calcula SIEMPRE sobre el archivo original, antes de achicarlo: es el
        # que se compara contra el de Drive en la próxima corrida. Si guardáramos el de
        # la versión achicada, cada corrida creería que el plano cambió y lo bajaría de
        # nuevo para siempre.
        md5 = archivo.md5 or hashlib.md5(datos).hexdigest()
        if not contenido_coincide(datos, archivo.mime):
            return NO_SOPORTADO, (
                f"dice ser {archivo.mime} pero el contenido no lo es "
                f"(¿un temporal de Word, o basura de un instalador?)")
        detalle_img = ""
        if datos is not None and achicar:
            datos, campos["tipo"], detalle_img = optimizar_imagen(datos, archivo.mime)
            campos["tipo"] = campos["tipo"][:20]
        if not dry_run:
            nuevo = (await conn.execute(SQL_INSERT, {
                **campos, "archivo": datos, "md5": md5, "subida": datetime.now(),
            })).scalar_one()
            nueva_fila = {"id": nuevo, "drive_id": archivo.drive_id, "md5": md5}
            if archivo.drive_id:
                por_drive[archivo.drive_id] = nueva_fila
            por_articulo[clave_nombre] = nueva_fila
        return IMPORTADO, detalle_img

    # Sabemos el md5 de Drive sin bajar el archivo: si no cambió, no se baja nada.
    if archivo.md5 and fila["md5"] == archivo.md5:
        if archivo.drive_id and fila["drive_id"] != archivo.drive_id:
            if not dry_run:
                await conn.execute(SQL_ANOTAR_DRIVE, {
                    "id": fila["id"], "drive_id": archivo.drive_id,
                    "modificado": archivo.modificado,
                })
                fila["drive_id"] = archivo.drive_id
                por_drive[archivo.drive_id] = fila
            return SIN_CAMBIOS, "ya estaba cargado; se le anotó el id de Drive"
        return SIN_CAMBIOS, ""

    datos = archivo.descargar()
    md5 = archivo.md5 or hashlib.md5(datos).hexdigest()
    if fila["md5"] == md5:
        return SIN_CAMBIOS, ""

    if not contenido_coincide(datos, archivo.mime):
        return NO_SOPORTADO, (
            f"dice ser {archivo.mime} pero el contenido no lo es")
    detalle_img = ""
    if achicar:
        datos, campos["tipo"], detalle_img = optimizar_imagen(datos, archivo.mime)
        campos["tipo"] = campos["tipo"][:20]

    # Se pisa el archivo de la fila que ya existe en vez de crear una nueva: así el
    # link que alguien haya guardado (/planos/{id}/archivo) sigue sirviendo y apunta a
    # la revisión nueva del plano.
    if not dry_run:
        await conn.execute(SQL_UPDATE, {
            **campos, "id": fila["id"], "archivo": datos, "md5": md5,
            # Se pisa la fecha de subida: el contenido es otro, decir que se subió en
            # marzo un PDF que llegó hoy confunde a cualquiera.
            "subida": datetime.now(),
        })
        fila["md5"] = md5
        fila["drive_id"] = archivo.drive_id or fila["drive_id"]
    return ACTUALIZADO, "; ".join(
        x for x in ("el plano cambió en Drive; se reemplazó el archivo", detalle_img) if x)


# ═══════════════════════════════════════════════════════════════════════════
#  Reporte
# ═══════════════════════════════════════════════════════════════════════════

def escribir_csv(filas, ruta_pedida, dry_run) -> str:
    if ruta_pedida:
        ruta = os.path.abspath(ruta_pedida)
    else:
        sello = datetime.now().strftime("%Y%m%d-%H%M")
        nombre = f"planos-{sello}{'-simulacro' if dry_run else ''}.csv"
        ruta = os.path.join(RAIZ, "tmp", nombre)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)

    # utf-8-sig: sin el BOM, el Excel en castellano abre los acentos rotos y la
    # planilla vuelve del taller con "Carpeta vacÃ­a".
    with open(ruta, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNAS_CSV)
        w.writeheader()
        w.writerows(sorted(filas, key=lambda r: (ORDEN_RESULTADOS.index(r["resultado"]),
                                                 r["codigo_carpeta"])))
    return ruta


def imprimir_resumen(conteo, ambiguos, filas, ruta_csv, dry_run, cortado):
    print("\n" + "─" * 72)
    print("SIMULACRO — no se escribió nada en la base" if dry_run else "IMPORT TERMINADO")
    if cortado:
        print("(cortado a mano, quedaron carpetas sin revisar)")
    print("─" * 72)
    for resultado in ORDEN_RESULTADOS:
        if conteo[resultado]:
            print(f"  {conteo[resultado]:>5}  {resultado}")

    def listar(resultado, titulo, cuantos=15):
        casos = [f for f in filas if f["resultado"] == resultado]
        if not casos:
            return
        print(f"\n{titulo} ({len(casos)}):")
        for f in casos[:cuantos]:
            detalle = f" — {f['detalle']}" if f["detalle"] else ""
            print(f"  · {f['codigo_carpeta']}{'/' + f['archivo'] if f['archivo'] else ''}{detalle}")
        if len(casos) > cuantos:
            print(f"  … y {len(casos) - cuantos} más (están todos en el CSV)")

    listar(SIN_ARTICULO, "Códigos de carpeta que no existen en el sistema")
    listar(NO_SOPORTADO, "Archivos que no son PDF ni imagen")
    listar(CARPETA_VACIA, "Carpetas sin ningún archivo")
    listar(ERROR, "Errores")

    if ambiguos:
        print(f"\nCódigos repetidos en `articulo` ({len(ambiguos)}) — se usó el id más bajo,\n"
              "pero hay que decidir en el sistema con cuál se queda cada uno:")
        for codigo, ids in sorted(ambiguos.items()):
            print(f"  · {codigo} → artículos {', '.join(str(i) for i in ids)}")

    print(f"\nCSV para el taller: {ruta_csv}")
    if dry_run:
        print("Si el CSV cierra, corré lo mismo sin --dry-run.")


# ═══════════════════════════════════════════════════════════════════════════

def parsear():
    p = argparse.ArgumentParser(
        prog="python -m backend.scripts.planos.importar_planos",
        description="Carga los planos del taller (Drive o carpeta local) contra el artículo.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Ejemplos:\n"
            "  --desde-drive --dry-run --limite 20   probar con 20 carpetas, sin escribir\n"
            "  --desde-drive                         el import de verdad\n"
            "  --desde-carpeta ~/Downloads/O         desde el ZIP de Drive descomprimido\n"
        ),
    )
    p.add_argument("--desde-drive", nargs="?", const=CARPETA_RAIZ, metavar="FOLDER_ID",
                   help=f"baja los planos de Drive. Sin valor usa la carpeta del taller ({CARPETA_RAIZ}).")
    p.add_argument("--desde-carpeta", metavar="RUTA",
                   help="lee un directorio local con la misma estructura (una subcarpeta por código).")
    p.add_argument("--dry-run", action="store_true",
                   help="no escribe nada en la base: solo revisa y arma el CSV.")
    p.add_argument("--sin-achicar", action="store_true",
                   help="guarda las fotos tal cual vienen, sin reducirlas ni recomprimir.")
    p.add_argument("--limite", type=int, metavar="N",
                   help="procesa solo las primeras N subcarpetas.")
    p.add_argument("--csv", metavar="RUTA",
                   help="dónde dejar el reporte (por defecto tmp/planos-<fecha>.csv).")

    args = p.parse_args()
    if bool(args.desde_drive) == bool(args.desde_carpeta):
        p.error("elegí una sola fuente: --desde-drive o --desde-carpeta.")
    return args


if __name__ == "__main__":
    sys.exit(asyncio.run(importar(parsear())))
