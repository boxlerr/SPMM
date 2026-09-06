from typing import Optional
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, UploadFile, File, Form, Response, HTTPException
from backend.infrastructure.db import SessionLocal
from backend.application.PlanoService import PlanoService
from backend.dto.PlanoRequestDTO import PlanoRequestDTO, PlanoUpdateDTO
from backend.commons.loggers.logger import logger

router = APIRouter()


# `plano.tipo_archivo` es un VARCHAR(20). El navegador manda el tipo que se le canta:
# cuando no reconoce la extensión manda "application/octet-stream", que son 24 caracteres
# y hace fallar el INSERT con un 500 sin explicación. El tipo largo no aporta nada —el
# visor solo mira si empieza con "image/" o si es PDF—, así que se recorta.
def _tipo_corto(tipo: Optional[str]) -> str:
    return (tipo or "application/octet-stream").strip()[:20]


def _content_disposition(disposition: str, nombre: str) -> str:
    """Arma el Content-Disposition sin romperse con el nombre del archivo.

    Starlette codifica los headers en latin-1, así que meter el nombre crudo hace
    explotar la respuesta con UnicodeEncodeError —o sea 500 y el plano no se puede ver,
    ni imprimir, ni bajar— en cuanto el nombre trae un carácter que no entra ahí. Los
    acentos y la ñ sí entran, por eso no salta en las pruebas; lo que lo dispara es el
    guion largo o las comillas tipográficas que quedan al pegar un nombre desde Word, y
    los nombres los escribe el taller a mano (el importador guarda el de Drive tal cual).

    Se manda el nombre dos veces, como pide el RFC 6266: `filename` con lo que sobrevive
    en ASCII para los navegadores viejos, y `filename*` con el nombre completo en UTF-8.
    Las comillas dobles de la versión ASCII también se sacan: cerrarían el valor.
    """
    # Los saltos de línea y demás caracteres de control se sacan ANTES que nada: no son
    # una inyección de encabezado (el servidor la ataja), pero parten el header y hacen
    # fallar la respuesta entera con un error de protocolo. O sea que un plano con un
    # "\n" en el nombre —macOS los permite, y el `nombre` del alta es texto libre— no se
    # podría ni ver, ni imprimir, ni bajar: la tarjeta queda muerta.
    limpio = "".join(c for c in nombre if c.isprintable())
    ascii_seguro = limpio.encode("ascii", "ignore").decode("ascii").replace('"', "")
    if not ascii_seguro.strip():
        ascii_seguro = "plano"
    return (
        f'{disposition}; filename="{ascii_seguro}"; '
        f"filename*=UTF-8''{quote(limpio, safe='')}"
    )

# Dependencia para obtener la sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 Crear Plano
#
# El plano va a una OT o a un artículo. Los dos llegan opcionales porque el de
# producto no tiene OT y el de una modificación puntual no tiene artículo; que venga
# al menos uno lo controla el DTO, y acá se corta antes con un 400 para que el
# mensaje sea claro y no un error de validación de pydantic.
@router.post("/planos")
async def crear_plano(
    nombre: str = Form(...),
    descripcion: str = Form(None),
    tipo_archivo: str = Form(...),
    id_orden_trabajo: Optional[int] = Form(None),
    id_articulo: Optional[int] = Form(None),
    drive_file_id: Optional[str] = Form(None),
    drive_md5: Optional[str] = Form(None),
    drive_modificado: Optional[datetime] = Form(None),
    archivo: UploadFile = File(...),
    db=Depends(get_db)
):
    logger.info("API - Inicio POST /planos")

    if id_orden_trabajo is None and id_articulo is None:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Elegí a dónde va el plano: a una orden de trabajo o a un artículo.",
                "campo": "id_articulo",
            },
        )

    contenido = await archivo.read()

    if not contenido:
        # Un archivo de 0 bytes entraba como plano válido: la pantalla decía "se subió"
        # y quedaba una tarjeta que no abre nada. Pasa de verdad cuando se elige un
        # archivo que quedó a medio copiar o en una carpeta de red que se desconectó.
        raise HTTPException(
            status_code=400,
            detail={"message": "El archivo está vacío. Fijate que se haya copiado bien y volvé a subirlo.",
                    "campo": "archivo"},
        )

    dto = PlanoRequestDTO(
        nombre=nombre,
        descripcion=descripcion,
        tipo_archivo=_tipo_corto(tipo_archivo),
        archivo=contenido,
        id_orden_trabajo=id_orden_trabajo,
        id_articulo=id_articulo,
        drive_file_id=drive_file_id,
        drive_md5=drive_md5,
        drive_modificado=drive_modificado
    )

    service = PlanoService(db)
    result = await service.crearPlano(dto)
    return result


# 🔹 Qué OTs tienen plano REALMENTE adjunto
#
# Va declarado ANTES que /planos/{id}: FastAPI resuelve por orden y, si no,
# "ordenes-con-plano" entraría como el parámetro {id} y devolvería 422.
#
# Lo usa el planificador en el front para distinguir la OT que está marcada con
# plano en el legacy (orden_trabajo.tiene_plano) de la que tiene el archivo
# cargado de verdad. Solo esta última restringe a operarios que leen planos.
#
# Ojo: acá NO entran las OTs cuyo artículo tiene plano, aunque la pantalla de la OT
# los muestre. Ver la REGLA CRÍTICA en PlanoRepository.find_ordenes_con_plano.
@router.get("/planos/ordenes-con-plano")
async def obtener_ordenes_con_plano(db=Depends(get_db)):
    logger.info("API - Inicio GET /planos/ordenes-con-plano")
    from backend.infrastructure.PlanoRepository import PlanoRepository
    ordenes = await PlanoRepository(db).find_ordenes_con_plano()
    return {"ordenes_con_plano": sorted(ordenes)}


# 🔹 Qué OTs tienen un plano PARA VER (propio o heredado del producto)
#
# También antes de /planos/{id}, por lo mismo que la de arriba: si quedara después,
# "ordenes-con-plano-disponible" entraría como el parámetro {id} y devolvería 422.
#
# Este es el dato de PANTALLA, el que va en la columna Plano de Operaciones y en
# cualquier listado donde se vean OTs. Es distinto del de arriba a propósito: acá sí
# entran las OTs cuyo artículo tiene el plano cargado (hoy, 198 de las que decían
# "Sin archivo"), porque para el que va a mirar el dibujo son lo mismo. Sumarlas acá no
# le saca el trabajo a ningún operario: el filtro duro sigue leyendo la otra ruta.
#
# Se devuelven los dos conjuntos por separado, sin mezclar, para que la pantalla pueda
# decir de dónde sale el plano (el propio se borra desde la OT, el del producto se
# toca en el catálogo) y no para que el front tenga que adivinarlo.
@router.get("/planos/ordenes-con-plano-disponible")
async def obtener_ordenes_con_plano_disponible(db=Depends(get_db)):
    logger.info("API - Inicio GET /planos/ordenes-con-plano-disponible")
    service = PlanoService(db)
    return await service.obtenerOrdenesConPlanoDisponible()


# 🔹 Qué artículos ya tienen el plano cargado
#
# También antes de /planos/{id}, por lo mismo. Es para marcar el catálogo: solo
# informa, no filtra nada de la planificación.
@router.get("/planos/articulos-con-plano")
async def obtener_articulos_con_plano(db=Depends(get_db)):
    logger.info("API - Inicio GET /planos/articulos-con-plano")
    service = PlanoService(db)
    return {"articulos_con_plano": await service.obtenerArticulosConPlano()}


# 🔹 Biblioteca de planos (buscador paginado)
#
# Antes de /planos/{id}, por lo mismo. Se pagina porque son cientos de planos y
# ninguna respuesta trae los archivos, solo su tamaño.
@router.get("/planos/biblioteca")
async def obtener_biblioteca(
    buscar: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db=Depends(get_db)
):
    logger.info(f"API - Inicio GET /planos/biblioteca (buscar={buscar!r}, limit={limit}, offset={offset})")
    service = PlanoService(db)
    return await service.buscarPlanos(texto=buscar, limit=limit, offset=offset)


# 🔹 Listar planos de un artículo
#
# Antes de /planos/{id}, por lo mismo.
@router.get("/planos/articulo/{id_articulo}")
async def obtener_planos_por_articulo(id_articulo: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /planos/articulo/{id_articulo}")
    service = PlanoService(db)
    return await service.obtenerPlanosPorArticulo(id_articulo)


# 🔹 Listar planos de una Orden de Trabajo
#
# Antes de /planos/{id}, por lo mismo. Devuelve los de la OT MÁS los del artículo que
# fabrica: para el que está en la máquina son lo mismo. Cada fila trae `origen`
# ("ot" o "articulo") para saber cuál se puede borrar desde la OT.
@router.get("/planos/orden/{id_orden}")
async def obtener_planos_por_orden(id_orden: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /planos/orden/{id_orden}")
    service = PlanoService(db)
    return await service.obtenerPlanosPorOrdenTrabajo(id_orden)


# 🔹 Obtener plano por ID
@router.get("/planos/{id}")
async def obtener_plano(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /planos/{id}")
    service = PlanoService(db)
    return await service.obtenerPlanoPorId(id)


# 🔹 Obtener contenido (archivo) del plano
@router.get("/planos/{id}/archivo")
async def obtener_contenido_plano(id: int, download: bool = False, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /planos/{id}/archivo")
    service = PlanoService(db)
    contenido, tipo_archivo, nombre_archivo = await service.obtenerContenidoPlano(id)

    # Set disposition based on download param
    disposition = "attachment" if download else "inline"
    headers = {
        "Content-Disposition": _content_disposition(disposition, nombre_archivo),
        # Un plano se abre muchas veces —el visor, la miniatura y la impresión pasan
        # todos por acá— y sin esto se bajaba entero cada vez que alguien entraba a la
        # OT. `private` porque va con token: lo guarda el navegador que lo pidió y
        # ningún proxy del camino.
        #
        # OJO con el día de caché: el archivo de un id SÍ puede cambiar. Tanto el PUT
        # de acá como el importador de Drive (backend/scripts/planos/importar_planos.py)
        # reemplazan el contenido en la misma fila a propósito, para no romper los links
        # guardados. O sea que al que ya lo abrió le puede quedar hasta 24 h la versión
        # vieja. Se acepta porque un plano cambia muy de vez en cuando; si empieza a
        # molestar, la salida es que el reemplazo genere un id nuevo, no bajar el caché.
        "Cache-Control": "private, max-age=86400",
    }

    return Response(content=contenido, media_type=tipo_archivo, headers=headers)


# 🔹 Modificar plano (incluye reemplazar archivo)
@router.put("/planos/{id}")
async def modificar_plano(
    id: int,
    nombre: str = Form(...),
    descripcion: str = Form(None),
    tipo_archivo: str = Form(...),
    archivo: UploadFile = File(...),
    db=Depends(get_db)
):
    logger.info(f"API - Inicio PUT /planos/{id}")

    contenido = await archivo.read()

    # El destino (OT o artículo) no se edita: un plano no se muda. Por eso va el DTO
    # de edición y no el de alta.
    dto = PlanoUpdateDTO(
        nombre=nombre,
        descripcion=descripcion,
        tipo_archivo=_tipo_corto(tipo_archivo),
        archivo=contenido
    )

    service = PlanoService(db)
    return await service.modificarPlano(id, dto)


# 🔹 Eliminar Plano
@router.delete("/planos/{id}")
async def eliminar_plano(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /planos/{id}")
    service = PlanoService(db)
    return await service.eliminarPlano(id)
