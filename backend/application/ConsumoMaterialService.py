"""El consumo de materiales de una orden (RF-15).

El SRS pide «asociar consumo de materiales a cada orden de producción». La lista de lo
que la OT lleva ya existía (`orden_trabajo_pieza`, del sistema viejo); lo que faltaba es
poder decir cuánto se consumió de verdad, quién lo cargó y cuándo.

TRES COSAS QUE NO SE HACEN, A PROPÓSITO

  · No se descuenta stock. `pieza.stockactual` lo reescribe el sync con el número del
    sistema viejo, así que un descuento hecho acá volvería solo en la próxima pasada.
    Pasar el stock a SPMM es sacarle ese dato al viejo, y de quién es cada dato lo
    decide el cliente. Hasta entonces esto registra; no mueve el stock.
  · No se toca `orden_trabajo_pieza`. Es del viejo y el sync la pisa (ver el docstring
    de domain/ConsumoMaterial.py).
  · No se borra. Una carga equivocada se ANULA: deja de sumar y queda a la vista con
    quién y cuándo. Por eso hay `anular()` y no `eliminar()`.

Tampoco se frena un consumo mayor a lo pedido: en el taller pasa (una pieza que salió
mal, un corte de más) y trabar la carga por eso haría que no se cargue. La pantalla lo
marca en otro color; el dato entra.
"""
from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder

from backend.application.IncidenciaProcesoService import nombre_de
from backend.application.validators.ConsumoMaterialValidator import (
    LARGO_OBSERVACIONES,
    consumoMaterialValidator,
)
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.dto.ConsumoMaterialRequestDTO import AnularConsumoDTO, ConsumoMaterialRequestDTO
from backend.infrastructure.ConsumoMaterialRepository import ConsumoMaterialRepository
from backend.infrastructure.auditoria_movimientos import ahora_ar

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger

# Largo de la columna `unidad`. La del viejo es texto libre ('SIN UNIDAD', 'KG'...): se
# recorta en vez de dejar que la base rechace el renglón entero por una unidad larga.
LARGO_UNIDAD = 40


def _texto(valor: str | None, largo: int) -> str | None:
    """Vacío es None, no ''. Así «sin observación» se guarda siempre igual."""
    if valor is None:
        return None
    limpio = str(valor).strip()
    return limpio[:largo] if limpio else None


def _misma_unidad(a: str | None, b: str | None) -> bool:
    return (a or "").strip().upper() == (b or "").strip().upper()


def consumo_a_dict(consumo: ConsumoMaterial, cod_pieza: str | None = None,
                   descripcion: str | None = None) -> dict:
    """Cómo sale un consumo por la API: igual en el alta, el listado y la anulación.

    `anulado` sale como booleano aunque en la base sea 0/1: el front no tiene por qué
    saber cómo se guarda una marca.
    """
    return jsonable_encoder({
        "id": consumo.id,
        "id_orden_trabajo": consumo.id_orden_trabajo,
        "id_orden_trabajo_pieza": consumo.id_orden_trabajo_pieza,
        "id_pieza": consumo.id_pieza,
        "cod_pieza": cod_pieza,
        "descripcion": descripcion,
        "cantidad": consumo.cantidad,
        "unidad": consumo.unidad,
        "fecha": consumo.fecha,
        "id_usuario": consumo.id_usuario,
        "usuario": consumo.usuario,
        "observaciones": consumo.observaciones,
        "anulado": bool(consumo.anulado),
        "anulado_en": consumo.anulado_en,
        "anulado_por": consumo.anulado_por,
        "motivo_anulacion": consumo.motivo_anulacion,
    })


class ConsumoMaterialService:
    def __init__(self, db_session):
        self.repository = ConsumoMaterialRepository(db_session)

    # ------------------------------------------------------------------
    # Alta
    # ------------------------------------------------------------------

    async def registrar(self, dto: ConsumoMaterialRequestDTO, usuario: dict | None = None):
        logger.info(
            f"Service - Registrar consumo OT={dto.id_orden_trabajo} "
            f"linea={dto.id_orden_trabajo_pieza} pieza={dto.id_pieza} cantidad={dto.cantidad}"
        )
        errores = consumoMaterialValidator(dto)
        if errores:
            raise BusinessException("; ".join(errores))

        if not await self.repository.existe_orden(dto.id_orden_trabajo):
            raise NotFoundException(f"No existe la orden de trabajo {dto.id_orden_trabajo}.")

        id_pieza, unidad = await self._material(dto)
        pieza = await self.repository.find_pieza(id_pieza)
        if pieza is None:
            raise NotFoundException(f"No existe la pieza {id_pieza}.")
        if unidad is None:
            unidad = pieza.unidad

        id_usuario, nombre = nombre_de(usuario)
        consumo = ConsumoMaterial(
            id_orden_trabajo=dto.id_orden_trabajo,
            id_pieza=id_pieza,
            id_orden_trabajo_pieza=dto.id_orden_trabajo_pieza,
            # Lo que se guarda es lo que se valida: 3 decimales, como la columna.
            cantidad=round(dto.cantidad, 3),
            unidad=_texto(unidad, LARGO_UNIDAD),
            # Hora del taller y usuario del token, nunca lo que diga el navegador.
            fecha=ahora_ar(),
            id_usuario=id_usuario,
            usuario=nombre,
            observaciones=_texto(dto.observaciones, LARGO_OBSERVACIONES),
            anulado=0,
        )
        guardado = await self.repository.save(consumo)
        return ResponseDTO(
            status=True,
            data=consumo_a_dict(guardado, pieza.cod_pieza, pieza.descripcion),
            errorDescription="",
        )

    async def _material(self, dto: ConsumoMaterialRequestDTO) -> tuple[int, str | None]:
        """De qué pieza es el consumo y en qué unidad va. Devuelve (id_pieza, unidad).

        Con línea, manda la línea: la pieza y la unidad salen de ahí, y si el pedido dice
        otra cosa se rechaza en vez de elegir una en silencio. Sumar en el mismo total un
        consumo en kilos contra una línea pedida en unidades daría un número que no
        significa nada.
        """
        if dto.id_orden_trabajo_pieza is None:
            return dto.id_pieza, _texto(dto.unidad, LARGO_UNIDAD)

        linea = await self.repository.find_linea(dto.id_orden_trabajo_pieza)
        if linea is None:
            raise NotFoundException(
                f"No existe la línea de material {dto.id_orden_trabajo_pieza}. "
                "Puede que el sistema viejo la haya sacado: reabrí la orden y volvé a probar."
            )
        if linea.id_orden_trabajo != dto.id_orden_trabajo:
            raise BusinessException("Esa línea de material es de otra orden de trabajo.")
        if dto.id_pieza is not None and dto.id_pieza != linea.id_pieza:
            raise BusinessException("La pieza no coincide con la de la línea de material.")
        if dto.unidad is not None and dto.unidad.strip() and not _misma_unidad(dto.unidad, linea.unidad):
            raise BusinessException(
                f"Esta línea se pidió en «{linea.unidad}»: el consumo se carga en la misma unidad."
            )
        return linea.id_pieza, linea.unidad

    # ------------------------------------------------------------------
    # Listado
    # ------------------------------------------------------------------

    async def listar_por_orden(self, id_orden_trabajo: int):
        """Todos los consumos de la OT, anulados incluidos (van marcados).

        No se chequea que la OT exista: una OT sin consumos y una que no existe dan lo
        mismo, una lista vacía, y así la ficha no tiene que distinguir un 404 de «este
        backend todavía no tiene la ruta».
        """
        logger.info(f"Service - Listar consumos de material de la OT {id_orden_trabajo}.")
        filas = await self.repository.find_by_orden_trabajo(id_orden_trabajo)
        data = [consumo_a_dict(f["consumo"], f["cod_pieza"], f["descripcion"]) for f in filas]
        return ResponseDTO(status=True, data=data, errorDescription="")

    # ------------------------------------------------------------------
    # Anulación
    # ------------------------------------------------------------------

    async def anular(self, id_consumo: int, dto: AnularConsumoDTO | None = None,
                     usuario: dict | None = None):
        """Deja de sumar, pero el renglón queda con quién y cuándo lo anuló.

        Anular dos veces no mueve nada: devuelve el consumo como quedó la primera vez.
        Pasa de verdad —un doble toque, o dos personas con la misma ficha abierta— y la
        segunda vez no puede pisar quién lo anuló.
        """
        consumo = await self.repository.find_by_id(id_consumo)
        if consumo is None:
            raise NotFoundException(f"No existe el consumo de material {id_consumo}.")

        self._puede_anular(consumo, usuario)

        if not consumo.anulado:
            _, nombre = nombre_de(usuario)
            consumo.anulado = 1
            consumo.anulado_en = ahora_ar()
            consumo.anulado_por = nombre
            consumo.motivo_anulacion = _texto(dto.motivo if dto else None, LARGO_OBSERVACIONES)
            consumo = await self.repository.guardar_cambios(consumo)

        pieza = await self.repository.find_pieza(consumo.id_pieza)
        return ResponseDTO(
            status=True,
            data=consumo_a_dict(
                consumo,
                pieza.cod_pieza if pieza else None,
                pieza.descripcion if pieza else None,
            ),
            errorDescription="",
        )

    @staticmethod
    def _puede_anular(consumo: ConsumoMaterial, usuario: dict | None) -> None:
        """Lo anula quien lo cargó, o un administrador.

        Es lo más cerrado que no traba al taller: el que se equivocó se corrige solo (la
        carga que acaba de hacer es suya) y nadie más le anula a otro lo que cargó sin
        ser admin. Quién más debería poder queda para definir con el cliente.

        403 con HTTPException porque no hay excepción de negocio para «no te toca»: el
        handler global la convierte en el mismo ResponseDTO que el resto de los errores.
        """
        if usuario and usuario.get("rol") == "admin":
            return
        propio = (
            usuario is not None
            and consumo.id_usuario is not None
            and usuario.get("id_usuario") == consumo.id_usuario
        )
        if not propio:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Este consumo lo cargó otra persona: lo puede anular ella o un administrador.",
            )
