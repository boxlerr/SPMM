"""El archivo de un plano vive en Supabase Storage, no adentro de la base.

POR QUÉ
    `plano.archivo` era un BLOB. Con los 600 planos del primer import pesaba 600 MB y
    entraba; con la biblioteca completa del taller (5341 carpetas de producto en Drive)
    son varios GB. El plan Pro incluye 8 GB de DISCO de base (US$0,125 el GB extra) y
    100 GB de STORAGE (US$0,0213 el GB extra): seis veces más barato, y además saca del
    pooler un blob de varios MB por cada plano que alguien abre.

CÓMO
    Bucket **privado** `planos` — son dibujos de clientes, ninguna URL de Storage llega
    al navegador. El backend sigue sirviendo el archivo por `/planos/{id}/archivo` con
    su token de siempre y lee el objeto acá adentro con la clave secreta del proyecto.
    El front no cambia.

    Se usa `urllib` de la stdlib y no httpx/requests a propósito: `requirements.txt`
    está en UTF-16 y no tiene ninguno de los dos, así que agregar una dependencia era
    tocar ese archivo y arriesgar el build del contenedor por un GET y un POST. Las
    llamadas son sincrónicas y las versiones async las corren en un thread, que es lo
    correcto igual: bloquear el event loop de FastAPI con una descarga de 6 MB frena
    todas las demás request del proceso.
"""
import asyncio
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid

BUCKET = "planos"

# La carpeta del mismo bucket donde quedan las copias de seguridad automáticas (RF-19,
# infrastructure/deposito_copias.py). Está acá para que el barrido de huérfanos de
# scripts/planos la saltee sin importar nada más.
#
# Esas copias traen TODOS los datos: nada que sirva o borre planos puede tocar esta
# carpeta. Lo cuidan `ruta_permitida_para_planos` (PlanoService no lee ni borra nada de
# acá, diga lo que diga la fila) y `es_ruta_de_plano` (una restauración no acepta una
# fila de `plano` que apunte fuera de las carpetas de planos).
CARPETA_COPIAS = "copias-de-seguridad/"

# Supabase corta las subidas grandes; el objeto más pesado de la carpeta del taller es
# de ~13 MB, así que con esto sobra y avisa temprano si alguien sube un video.
LIMITE_BYTES = 50 * 1024 * 1024


def _credenciales() -> tuple[str, str]:
    url = (os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    # `SUPABASE_SECRET_KEY` es la clave nueva (sb_secret_…); `SUPABASE_SERVICE_ROLE_KEY`
    # es como se llamaba antes. Se aceptan las dos para no romper un despliegue viejo.
    clave = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not clave:
        raise RuntimeError(
            "Falta la configuración de Supabase Storage: NEXT_PUBLIC_SUPABASE_URL y "
            "SUPABASE_SECRET_KEY (la clave secreta del proyecto, Settings → API Keys)."
        )
    return url, clave


def _pedir(metodo: str, ruta: str, datos: bytes | None = None,
           mime: str | None = None, upsert: bool = False) -> bytes:
    url, clave = _credenciales()
    headers = {"apikey": clave, "Authorization": f"Bearer {clave}"}
    if mime:
        headers["Content-Type"] = mime
    if upsert:
        # Sin esto, subir dos veces la misma ruta da 409. Pasa al reimportar un plano
        # que cambió en Drive: la fila es la misma y el objeto se reemplaza.
        headers["x-upsert"] = "true"
    pedido = urllib.request.Request(f"{url}/storage/v1/{ruta}", data=datos,
                                    headers=headers, method=metodo)
    try:
        with urllib.request.urlopen(pedido, timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"Storage {metodo} {ruta}: HTTP {e.code} {detalle}") from e


def _limpiar(nombre: str) -> str:
    """Deja el nombre apto para una key de Storage, sin perder de vista cuál era.

    Las keys aceptan poco más que letras, números y `-_./`; los nombres del taller
    tienen tildes, espacios, paréntesis, `#` y hasta `Ø`. Se reemplaza todo lo raro por
    guiones y se recorta, que el nombre real igual queda en `plano.nombre`.
    """
    limpio = re.sub(r"[^A-Za-z0-9._-]+", "-", nombre).strip("-")
    return (limpio or "archivo")[:120]


def ruta_para(nombre: str, id_articulo: int | None = None,
              id_orden: int | None = None) -> str:
    """Dónde va el objeto. El uuid evita pisar dos archivos con el mismo nombre en la
    misma carpeta, que en Drive pasa seguido ('Plano (1).pdf')."""
    carpeta = (f"articulo/{id_articulo}" if id_articulo
               else f"orden/{id_orden}" if id_orden else "sueltos")
    return f"{carpeta}/{uuid.uuid4().hex}-{_limpiar(nombre)}"


# La forma EXACTA de lo que arma ruta_para (el alta, la modificación, el import del
# Drive y la migración de los blobs pasan todos por ahí).
_RUTA_DE_PLANO = re.compile(r"^(?:articulo/\d+|orden/\d+|sueltos)/[A-Za-z0-9._-]+$")
_CARACTERES_DE_RUTA = re.compile(r"^[A-Za-z0-9._/-]+$")


def es_ruta_de_plano(ruta) -> bool:
    """¿Tiene la forma exacta de una ruta de plano? Es lo que exige una restauración
    (RF-19): una fila de `plano` que llega de un archivo y apunta a otra cosa —la carpeta
    de las copias, `..`— no entra."""
    if not isinstance(ruta, str) or not _RUTA_DE_PLANO.match(ruta):
        return False
    return ruta.rsplit("/", 1)[1] not in (".", "..")


def ruta_permitida_para_planos(ruta) -> bool:
    """Lo mínimo para leer o borrar un objeto COMO PLANO: que no se salga de los planos.

    Más flojo que es_ruta_de_plano a propósito: esto lo mira PlanoService en cada plano
    que se abre o se borra, y una ruta vieja con otra forma no puede dejar un plano sin
    abrir. Lo que no se acepta nunca: la carpeta de las copias de seguridad, un tramo
    vacío, `.` o `..`, una barra al principio y cualquier carácter que ruta_para no
    genera (un `%` se decodifica del otro lado y vuelve a abrir la puerta del `..`)."""
    if not isinstance(ruta, str) or not ruta or not _CARACTERES_DE_RUTA.match(ruta):
        return False
    if ruta.startswith(CARPETA_COPIAS):
        return False
    return all(tramo not in ("", ".", "..") for tramo in ruta.split("/"))


def subir_sync(ruta: str, datos: bytes, mime: str | None) -> str:
    if not datos:
        raise RuntimeError("No se sube un archivo vacío a Storage.")
    if len(datos) > LIMITE_BYTES:
        raise RuntimeError(f"El archivo pesa {len(datos)/1024/1024:.1f} MB y el máximo "
                           f"es {LIMITE_BYTES/1024/1024:.0f} MB.")
    _pedir("POST", f"object/{BUCKET}/{ruta}", datos,
           mime or "application/octet-stream", upsert=True)
    return ruta


def bajar_sync(ruta: str) -> bytes:
    return _pedir("GET", f"object/{BUCKET}/{ruta}")


def borrar_sync(ruta: str) -> None:
    _pedir("DELETE", f"object/{BUCKET}/{ruta}")


async def subir(ruta: str, datos: bytes, mime: str | None) -> str:
    return await asyncio.to_thread(subir_sync, ruta, datos, mime)


async def bajar(ruta: str) -> bytes:
    return await asyncio.to_thread(bajar_sync, ruta)


async def borrar(ruta: str) -> None:
    await asyncio.to_thread(borrar_sync, ruta)
