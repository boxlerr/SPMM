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
