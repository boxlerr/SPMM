"""Pausar y reanudar una OT o uno de sus pasos (RF-03).

El SRS: «permitir pausar y reanudar órdenes de producción, registrando el motivo de la
pausa y quién la ejecutó». El modelo y el porqué están en domain/PausaOrden.py; acá van
las reglas:

  · Se pausa la OT entera o un paso suelto. Pausar la OT para sus pasos en proceso sin
    tocarles el estado: siguen «en proceso», con su arranque, y quedan parados porque la
    OT lo está.
  · Lo que ya está pausado no se vuelve a pausar, y lo que no está pausado no se
    reanuda: 409 con el porqué, en castellano. Tampoco se pausa lo terminado o
    entregado: no hay nada que parar.
  · El motivo es de una lista cerrada; «Otro» pide texto.
  · Quién y cuándo salen del token y del reloj del taller, nunca del navegador.

LO QUE NO HACE, A PROPÓSITO

  · No cambia el estado de ningún paso ni sus ids: el tablero, el planificador y el
    sync dependen de ellos.
  · No saca la OT del plan ya confirmado. Deja de entrar en los planes NUEVOS (el
    planificador la saltea y lo avisa), pero borrar sus filas del plan vigente sería
    decidir por el planificador: queda a la vista con su cartel de «Pausada».
  · No toca `orden_trabajo.suspendida`, la tilde del sistema viejo. Conviven: aquélla
    no tiene motivo ni autor, y reemplazarla es una decisión del taller.
"""
from datetime import datetime
from typing import Iterable
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.exc import IntegrityError

from backend.application.IncidenciaProcesoService import nombre_de
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from backend.domain.PausaOrden import (  # noqa: F401 — los textos se re-exportan
    CIERRE_TEXTO,
    MOTIVO_EN_FRASE,
    MOTIVO_TEXTO,
    MOTIVOS,
    PausaOrden,
    duracion_corta,
    fecha_corta,
    minutos_entre,
    que_se_pauso,
    texto_del_motivo,
)
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.infrastructure.PausaRepository import PausaRepository

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

LARGO_OBSERVACION = 500


def ahora_ar() -> datetime:
    """Hora del taller, naive: las columnas son timestamp sin zona."""
    return datetime.now(_TZ_AR).replace(tzinfo=None)


def minutos_en_pausa(tramos: Iterable[tuple[datetime, datetime | None]],
                     desde: datetime, hasta: datetime, ahora: datetime | None = None) -> int:
    """Cuántos minutos de [desde, hasta] cayeron adentro de alguna pausa.

    Es la resta que convierte el tiempo corrido de un paso en tiempo EFECTIVO (RF-06):
    efectivo = (fin_real − inicio_real) − minutos_en_pausa(pausas del paso y de su OT).

    Los tramos se UNEN antes de contar, porque se pueden pisar: si el torno se rompió
    (pausa del paso) y encima el cliente pidió esperar (pausa de la OT), esa hora no se
    descuenta dos veces. Una pausa abierta (`hasta` vacío) cuenta hasta `ahora`.
    """
    if hasta <= desde:
        return 0
    ahora = ahora or ahora_ar()
    recortados = []
    for ini, fin in tramos:
        fin = fin or ahora
        ini, fin = max(ini, desde), min(fin, hasta)
        if fin > ini:
            recortados.append((ini, fin))
    total = 0
    actual = None
    for ini, fin in sorted(recortados):
        if actual is None or ini > actual[1]:
            if actual is not None:
                total += (actual[1] - actual[0]).total_seconds()
            actual = [ini, fin]
        else:
            actual[1] = max(actual[1], fin)
    if actual is not None:
        total += (actual[1] - actual[0]).total_seconds()
    return int(total // 60)


def pausas_del_paso(pausas: Iterable[PausaOrden], id_otp: int) -> list[PausaOrden]:
    """Las que paran ESE paso: las suyas y las de su OT entera."""
    return [p for p in pausas if p.id_otp is None or p.id_otp == id_otp]


def pausa_a_dict(pausa: PausaOrden, numero_ot=None, ahora: datetime | None = None) -> dict:
    """Cómo sale una pausa por la API: igual en el alta, la reanudación y los listados."""
    ahora = ahora or ahora_ar()
    return jsonable_encoder({
        "id": pausa.id,
        "id_orden_trabajo": pausa.id_orden_trabajo,
        # El número que el taller conoce (id_otvieja); el interno si no tiene.
        "numero_ot": numero_ot or pausa.id_orden_trabajo,
        "alcance": "ot" if pausa.id_otp is None else "paso",
        "id_otp": pausa.id_otp,
        "paso": pausa.paso,
        "nombre_proceso": pausa.nombre_proceso,
        "motivo": pausa.motivo,
        "motivo_texto": MOTIVO_TEXTO.get(pausa.motivo, pausa.motivo),
        "observacion": pausa.observacion,
        "desde": pausa.desde,
        "hasta": pausa.hasta,
        "abierta": pausa.hasta is None,
        "cierre": pausa.cierre,
        "cierre_texto": CIERRE_TEXTO.get(pausa.cierre) if pausa.cierre else None,
        "usuario_pausa": pausa.usuario_pausa,
        "usuario_reanuda": pausa.usuario_reanuda,
        # Lo que duró, o lo que lleva si sigue abierta.
        "minutos": minutos_entre(pausa.desde, pausa.hasta or ahora),
    })


def conflicto(mensaje: str) -> HTTPException:
    """409: lo pedido choca con cómo está la OT. No hay «hacerlo igual»: pausar lo
    pausado o reanudar lo que anda no tiene un sentido que se pueda forzar."""
    return HTTPException(status_code=status.HTTP_409_CONFLICT,
                         detail={"message": mensaje, "campo": "pausa"})


def _texto(valor: str | None, largo: int) -> str | None:
    if valor is None:
        return None
    limpio = str(valor).strip()
    return limpio[:largo] if limpio else None


def _esta_entregada(orden) -> bool:
    """Mismo criterio que isOrderDelivered() del front y resumenTodas(): el legacy marca
    «sin entregar» con fecha_entrega = 1950-01-01, no con NULL."""
    if orden.finalizadototal == 1:
        return True
    f = orden.fecha_entrega
    return bool(f and f.year > 1950)


class PausaService:
    def __init__(self, db_session):
        self.db = db_session
        self.repository = PausaRepository(db_session)

    # ------------------------------------------------------------------
    # Pausar
    # ------------------------------------------------------------------

    async def pausar(self, id_orden: int, motivo: str, observacion: str | None = None,
                     id_otp: int | None = None, usuario: dict | None = None) -> ResponseDTO:
        motivo = (motivo or "").strip().upper()
        if motivo not in MOTIVOS:
            raise BusinessException(
                "Elegí el motivo de la pausa: " + ", ".join(MOTIVO_TEXTO[m].lower() for m in MOTIVOS) + ".")
        observacion = _texto(observacion, LARGO_OBSERVACION)
        if motivo == "OTRO" and not observacion:
            raise BusinessException("Con «Otro» contá en una línea por qué se pausa.")

        orden = await self.repository.find_orden(id_orden)
        if orden is None:
            raise NotFoundException(f"No existe la orden de trabajo {id_orden}.")
        numero = orden.id_otvieja or orden.id
        pasos = await self.repository.find_pasos(id_orden)
        de_la_ot = await self.repository.abierta_de_la_ot(id_orden)

        paso = None
        if id_otp is not None:
            paso = next((p for p in pasos if p.id == id_otp), None)
            if paso is None:
                raise NotFoundException(
                    f"Ese paso no es de la OT {numero}. Puede que lo hayan sacado: reabrí la orden.")
            if paso.id_estado == 3:
                raise conflicto(f"El paso {paso.orden} ya está terminado: no hay nada que pausar.")
            if de_la_ot is not None:
                raise conflicto(
                    f"La OT {numero} entera está pausada desde el {fecha_corta(de_la_ot.desde)} "
                    f"({texto_del_motivo(de_la_ot).lower()}): este paso ya está parado.")
            ya = await self.repository.abierta_del_paso(id_otp)
            if ya is not None:
                raise conflicto(
                    f"El paso {paso.orden} ya está pausado desde el {fecha_corta(ya.desde)} "
                    f"({texto_del_motivo(ya).lower()}).")
        else:
            if de_la_ot is not None:
                raise conflicto(
                    f"La OT {numero} ya está pausada desde el {fecha_corta(de_la_ot.desde)} "
                    f"({texto_del_motivo(de_la_ot).lower()}).")
            if _esta_entregada(orden):
                raise conflicto(f"La OT {numero} ya se entregó: no hay nada que pausar.")
            if pasos and all(p.id_estado == 3 for p in pasos):
                raise conflicto(f"La OT {numero} ya tiene todos los pasos terminados: no hay nada que pausar.")

        id_usuario, nombre = nombre_de(usuario)
        pausa = PausaOrden(
            id_orden_trabajo=id_orden,
            id_otp=id_otp,
            paso=paso.orden if paso is not None else None,
            nombre_proceso=((paso.proceso.nombre or "").strip()[:200] or None)
            if paso is not None and getattr(paso, "proceso", None) is not None else None,
            motivo=motivo,
            observacion=observacion,
            # Hora del taller y usuario del token, nunca lo que diga el navegador.
            desde=ahora_ar(),
            id_usuario_pausa=id_usuario,
            usuario_pausa=nombre,
        )
        try:
            await self.repository.guardar(pausa)
            # Pausar es tocar la OT: queda el sello de quién y cuándo, como en toda
            # puerta que la modifica.
            await OrdenTrabajoRepository(self.db)._sellar_modificacion(id_orden, usuario)
            await self.db.commit()
        except IntegrityError:
            # Dos personas apretando «Pausar» a la vez: el índice único parcial frenó la
            # segunda. Se le dice lo mismo que si hubiera llegado un segundo tarde.
            await self.db.rollback()
            raise conflicto("Alguien la acaba de pausar. Actualizá la pantalla para ver el motivo.")

        salida = pausa_a_dict(pausa, numero)
        if id_otp is None:
            # «Pausar la OT pausa sus pasos en proceso»: no se les toca el estado, pero se
            # dice cuáles eran, para que quien apretó el botón sepa qué se paró.
            salida["pasos_en_proceso"] = [p.orden for p in pasos if p.id_estado == 2]
        logger.info(f"Pausas: {nombre or 'alguien'} pausó {que_se_pauso(pausa, numero)} ({motivo}).")
        return ResponseDTO(status=True, data=salida, errorDescription="")

    # ------------------------------------------------------------------
    # Reanudar
    # ------------------------------------------------------------------

    async def reanudar(self, id_orden: int, id_otp: int | None = None,
                       usuario: dict | None = None) -> ResponseDTO:
        orden = await self.repository.find_orden(id_orden)
        if orden is None:
            raise NotFoundException(f"No existe la orden de trabajo {id_orden}.")
        numero = orden.id_otvieja or orden.id

        if id_otp is not None:
            pausa = await self.repository.abierta_del_paso(id_otp)
            if pausa is None or pausa.id_orden_trabajo != id_orden:
                de_la_ot = await self.repository.abierta_de_la_ot(id_orden)
                if de_la_ot is not None:
                    raise conflicto(
                        f"Este paso está parado porque la OT {numero} entera está pausada: "
                        f"reanudá la OT.")
                raise conflicto("Ese paso no está pausado.")
        else:
            pausa = await self.repository.abierta_de_la_ot(id_orden)
            if pausa is None:
                pasos_pausados = [p for p, _ in await self.repository.abiertas([id_orden])
                                  if p.id_otp is not None]
                if pasos_pausados:
                    cuales = ", ".join(str(p.paso) for p in pasos_pausados if p.paso)
                    raise conflicto(
                        f"La OT {numero} no está pausada entera: tiene pausado el paso "
                        f"{cuales or 'que figura en la lista'}. Reanudalo desde el paso.")
                raise conflicto(f"La OT {numero} no está pausada.")

        id_usuario, nombre = nombre_de(usuario)
        # Nunca antes de que empiece (lo exige el CHECK de la base).
        pausa.hasta = max(ahora_ar(), pausa.desde)
        pausa.cierre = "REANUDADA"
        pausa.id_usuario_reanuda = id_usuario
        pausa.usuario_reanuda = nombre
        await OrdenTrabajoRepository(self.db)._sellar_modificacion(id_orden, usuario)
        await self.db.commit()

        salida = pausa_a_dict(pausa, numero)
        if id_otp is None:
            # Reanudar la OT no reanuda un paso que tenía su propia pausa (el torno puede
            # seguir roto): se avisa cuáles siguen parados.
            salida["pasos_que_siguen_pausados"] = [
                p.paso for p, _ in await self.repository.abiertas([id_orden])
                if p.id_otp is not None and p.paso
            ]
        logger.info(f"Pausas: {nombre or 'alguien'} reanudó {que_se_pauso(pausa, numero)}.")
        return ResponseDTO(status=True, data=salida, errorDescription="")

    # ------------------------------------------------------------------
    # Listados
    # ------------------------------------------------------------------

    async def activas(self) -> ResponseDTO:
        """Todo lo que está pausado ahora, para el cartel de las listas y el planificador.

        Una sola llamada para toda la pantalla, en vez de una columna nueva en cada
        listado de OT: son cinco endpoints distintos y el front los cruza por id.
        """
        ahora = ahora_ar()
        data = [pausa_a_dict(p, nro, ahora) for p, nro in await self.repository.abiertas()]
        return ResponseDTO(status=True, data=data, errorDescription="")

    async def de_la_orden(self, id_orden: int) -> ResponseDTO:
        """El historial de pausas de UNA OT, la última primero, abiertas incluidas.

        No se chequea que la OT exista: sin pausas y sin OT dan lo mismo, una lista vacía.
        """
        orden = await self.repository.find_orden(id_orden)
        numero = (orden.id_otvieja or orden.id) if orden is not None else id_orden
        ahora = ahora_ar()
        data = [pausa_a_dict(p, numero, ahora) for p in await self.repository.de_la_orden(id_orden)]
        return ResponseDTO(status=True, data=data, errorDescription="")
