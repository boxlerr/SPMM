from collections.abc import Mapping

from backend.domain.Plano import Plano
from backend.dto.PlanoRequestDTO import PlanoRequestDTO, PlanoUpdateDTO
from backend.infrastructure.PlanoRepository import PlanoRepository
from backend.commons.ResponseDTO import ResponseDTO

# Excepciones
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException

from backend.commons.loggers.logger import logger
from fastapi.encoders import jsonable_encoder


def _campo(fila, nombre, default=None):
    """Lee un campo venga como venga: entidad Plano, Row de SQLAlchemy o dict.

    Los listados no devuelven entidades a propósito (no traen el blob `archivo`), así
    que llegan como filas; el alta y la modificación sí devuelven la entidad.
    """
    if isinstance(fila, Mapping):
        return fila.get(nombre, default)
    mapping = getattr(fila, "_mapping", None)
    if mapping is not None:
        return mapping.get(nombre, default)
    return getattr(fila, nombre, default)


class PlanoService:
    def __init__(self, db_session):
        self.repository = PlanoRepository(db_session)

    async def crearPlano(self, dto: PlanoRequestDTO):
        try:
            logger.info("Service - Crear Plano.")

            # El destino (OT o artículo) ya lo validó el DTO.
            plano = Plano(
                nombre=dto.nombre,
                descripcion=dto.descripcion,
                tipo_archivo=dto.tipo_archivo,
                archivo=dto.archivo,
                id_orden_trabajo=dto.id_orden_trabajo,
                id_articulo=dto.id_articulo,
                drive_file_id=dto.drive_file_id,
                drive_md5=dto.drive_md5,
                drive_modificado=dto.drive_modificado
            )

            plano_guardado = await self.repository.save(plano)

            return ResponseDTO(status=True, data=self._plano_to_dict(plano_guardado))

        except InfrastructureException:
            raise
        except Exception as e:
            logger.error(f"Service - Error inesperado creando Plano: {e}")
            raise ApplicationException("Error inesperado al crear el Plano.") from e

    async def obtenerPlanoPorId(self, id: int):
        logger.info(f"Service - Obtener Plano ID: {id}")

        plano = await self.repository.find_ficha(id)

        if not plano:
            raise NotFoundException(f"No se encontró el Plano con ID {id}")

        return ResponseDTO(status=True, data=self._plano_to_dict(plano))

    async def obtenerPlanosPorOrdenTrabajo(self, id_orden: int):
        """Lo que se ve abierto en la OT: sus planos y los del artículo que fabrica.

        Cada fila trae `origen` para que la pantalla sepa cuál puede borrar desde ahí
        (el de la OT) y cuál es del catálogo (el del artículo).
        """
        logger.info(f"Service - Obtener Planos por OrdenTrabajo ID: {id_orden}")

        planos = await self.repository.find_por_orden_con_articulo(id_orden)

        data = [self._plano_to_dict(p) for p in planos]
        return ResponseDTO(status=True, data=data)

    async def obtenerPlanosPorArticulo(self, id_articulo: int):
        logger.info(f"Service - Obtener Planos por Articulo ID: {id_articulo}")

        planos = await self.repository.find_by_articulo(id_articulo)

        data = [self._plano_to_dict(p) for p in planos]
        return ResponseDTO(status=True, data=data)

    async def obtenerOrdenesConPlanoDisponible(self) -> dict[str, list[int]]:
        """Las OTs que tienen un plano para abrir, separadas por de dónde sale.

        Es lo que necesita cualquier listado de OTs para mostrar la columna Plano: hasta
        ahora se calculaba con el conjunto del planificador, y como en producción no hay
        ni un plano pegado a una orden (los 1183 cuelgan del artículo), decía "Sin
        archivo" en todas las filas.

        Ojo con no confundirlo con lo que RESTRINGE la planificación: eso lo sigue
        decidiendo find_ordenes_con_plano, que mira solo la OT. El porqué de la
        separación está en el docstring de find_ordenes_con_plano_disponible.

        Van ordenados para que la respuesta sea estable entre llamadas y el front pueda
        compararla o buscar por bisección si el listado crece.
        """
        logger.info("Service - Obtener órdenes con plano disponible (para mostrar)")

        propios, del_producto = await self.repository.find_ordenes_con_plano_disponible()
        # Aparte de "¿hay algo?", hace falta "¿hay un DIBUJO?": 46 de las 198 órdenes que
        # muestran algo tienen solo fotos de la pieza, y llamarles plano a esas manda a
        # buscar un dibujo que no existe.
        # Cuántos dibujos y cuántas fotos tiene cada una. La columna no puede decir solo
        # "hay algo": "Plano" y "3 fotos" son cosas distintas para el que planifica.
        resumen = await self.repository.find_resumen_por_orden()

        return {
            "propios": sorted(propios),
            "del_producto": sorted(del_producto),
            # Las claves van como texto: JSON no admite números como clave de objeto.
            "ordenes": {str(k): v for k, v in resumen.items()},
        }

    async def obtenerArticulosConPlano(self) -> list[int]:
        logger.info("Service - Obtener artículos con plano")

        articulos = await self.repository.find_articulos_con_plano()
        return sorted(articulos)

    async def buscarPlanos(self, texto: str | None = None, limit: int = 50, offset: int = 0):
        """Biblioteca paginada. Devuelve el shape que espera la pantalla: data + total."""
        logger.info(f"Service - Buscar Planos (texto={texto!r}, limit={limit}, offset={offset})")

        filas, total = await self.repository.buscar(texto=texto, limit=limit, offset=offset)

        data = []
        for fila in filas:
            item = self._plano_to_dict(fila)
            item["cod_articulo"] = _campo(fila, "cod_articulo")
            item["descripcion_articulo"] = _campo(fila, "descripcion_articulo")
            data.append(item)

        return {"data": data, "total": total}

    async def obtenerContenidoPlano(self, id: int):
        logger.info(f"Service - Obtener Contenido Plano ID: {id}")
        plano = await self.repository.find_by_id(id)
        if not plano:
            raise NotFoundException(f"No se encontró el Plano con ID {id}")
        return plano.archivo, plano.tipo_archivo, plano.nombre

    async def eliminarPlano(self, id: int):
        logger.info(f"Service - Eliminar Plano ID: {id}")

        eliminado = await self.repository.delete(id)

        if not eliminado:
            raise NotFoundException(f"No se encontró el Plano con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})

    async def modificarPlano(self, id: int, dto: PlanoUpdateDTO):
        logger.info(f"Service - Modificar Plano ID: {id}")

        # No se busca antes para chequear que exista: find_by_id trae el archivo entero
        # y acá lo único que se hace con el viejo es pisarlo. update() ya devuelve None
        # cuando el plano no está, que es lo mismo que necesitábamos saber.
        actualizado = await self.repository.update(id, {
            "nombre": dto.nombre,
            "descripcion": dto.descripcion,
            "tipo_archivo": dto.tipo_archivo,
            "archivo": dto.archivo
        })

        if not actualizado:
            raise NotFoundException(f"No existe el Plano con ID {id}")

        return ResponseDTO(status=True, data=self._plano_to_dict(actualizado))

    def _plano_to_dict(self, plano) -> dict:
        """Un plano para la pantalla, sin el archivo.

        Recibe tanto la entidad Plano (alta, modificación) como las filas de los
        listados, que vienen sin blob justamente para no arrastrar cientos de megas.
        """
        tamanio = _campo(plano, "bytes")
        if tamanio is None:
            # Vino la entidad completa: el tamaño se saca del blob que ya está en
            # memoria, así el front no tiene que distinguir de dónde salió el dato.
            contenido = _campo(plano, "archivo")
            tamanio = len(contenido) if contenido is not None else None

        id_orden_trabajo = _campo(plano, "id_orden_trabajo")

        return {
            "id": _campo(plano, "id"),
            "nombre": _campo(plano, "nombre"),
            "descripcion": _campo(plano, "descripcion"),
            "tipo_archivo": _campo(plano, "tipo_archivo"),
            "fecha_subida": _campo(plano, "fecha_subida"),
            "bytes": tamanio,
            "id_orden_trabajo": id_orden_trabajo,
            "id_articulo": _campo(plano, "id_articulo"),
            # Solo find_por_orden_con_articulo lo manda explícito, porque es la única
            # lista que mezcla las dos procedencias. En el resto se deduce del destino.
            "origen": _campo(plano, "origen") or ("ot" if id_orden_trabajo is not None else "articulo"),
        }
