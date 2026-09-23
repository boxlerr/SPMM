"""Las pausas de las OT y de sus pasos (RF-03). Ver domain/PausaOrden.py.

Dos clases de llamada, con reglas distintas:

  · Las de la pantalla de pausas (pausar, reanudar, listar): son el pedido entero, y si
    la tabla no está la respuesta es un error, que es lo que corresponde.
  · Las que corren PEGADAS a otra cosa —cerrar la pausa de un paso que alguien termina,
    leer lo pausado antes de planificar—: ésas van en un SAVEPOINT y no levantan nunca.
    Si la migración todavía no corrió, en Postgres una consulta que falla deja la
    transacción abortada, y el COMMIT del usuario se convierte en un ROLLBACK que no
    avisa: marcar un paso como terminado no puede dejar de andar por una tabla de pausas.
"""
from sqlalchemy import case, func, select
from sqlalchemy.orm import selectinload

from backend.commons.loggers.logger import logger
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import PausaOrden


class PausaRepository:
    def __init__(self, db):
        self.db = db

    # ------------------------------------------------------------------
    # Lecturas de la pantalla
    # ------------------------------------------------------------------

    async def find_orden(self, id_orden: int):
        return (await self.db.execute(
            select(OrdenTrabajo).where(OrdenTrabajo.id == id_orden)
        )).scalar_one_or_none()

    async def find_pasos(self, id_orden: int) -> list[OrdenTrabajoProceso]:
        """Los pasos de la OT, en el orden de trabajo (mismo desempate que el resto)."""
        return list((await self.db.execute(
            select(OrdenTrabajoProceso)
            .where(OrdenTrabajoProceso.id_orden_trabajo == id_orden)
            # El nombre del proceso se copia en la pausa: cargarlo acá y no por lazy
            # load, que en la sesión async revienta.
            .options(selectinload(OrdenTrabajoProceso.proceso))
            .order_by(OrdenTrabajoProceso.orden, OrdenTrabajoProceso.id)
        )).scalars().all())

    async def abierta_de_la_ot(self, id_orden: int) -> PausaOrden | None:
        return (await self.db.execute(
            select(PausaOrden).where(
                PausaOrden.id_orden_trabajo == id_orden,
                PausaOrden.id_otp.is_(None),
                PausaOrden.hasta.is_(None),
            )
        )).scalars().first()

    async def abierta_del_paso(self, id_otp: int) -> PausaOrden | None:
        return (await self.db.execute(
            select(PausaOrden).where(
                PausaOrden.id_otp == id_otp,
                PausaOrden.hasta.is_(None),
            )
        )).scalars().first()

    async def de_la_orden(self, id_orden: int) -> list[PausaOrden]:
        """Todas las pausas de la OT, abiertas y cerradas, la última primero."""
        return list((await self.db.execute(
            select(PausaOrden)
            .where(PausaOrden.id_orden_trabajo == id_orden)
            .order_by(PausaOrden.desde.desc(), PausaOrden.id.desc())
        )).scalars().all())

    async def abiertas(self, ordenes_ids: list[int] | None = None) -> list[tuple[PausaOrden, int | None]]:
        """Las pausas vigentes, con el número visible de su OT: [(pausa, id_otvieja)].

        Las de un paso que ya no existe no salen: el guardado completo de la OT borra y
        recrea pasos, y esa pausa quedó apuntando a la nada. No pausa nada —no hay qué
        pausar— y mostrarla sería un cartel sobre un paso que no se encuentra.
        """
        q = (
            select(PausaOrden, OrdenTrabajo.id_otvieja)
            .join(OrdenTrabajo, OrdenTrabajo.id == PausaOrden.id_orden_trabajo)
            .outerjoin(OrdenTrabajoProceso, OrdenTrabajoProceso.id == PausaOrden.id_otp)
            .where(PausaOrden.hasta.is_(None))
            .where((PausaOrden.id_otp.is_(None)) | (OrdenTrabajoProceso.id.is_not(None)))
            .order_by(PausaOrden.desde, PausaOrden.id)
        )
        if ordenes_ids is not None:
            if not ordenes_ids:
                return []
            q = q.where(PausaOrden.id_orden_trabajo.in_(list(ordenes_ids)))
        return [(p, nro) for p, nro in (await self.db.execute(q)).all()]

    async def guardar(self, pausa: PausaOrden) -> PausaOrden:
        self.db.add(pausa)
        await self.db.flush()
        return pausa

    # ------------------------------------------------------------------
    # Las que van pegadas a otra operación: savepoint, y nunca levantan
    # ------------------------------------------------------------------

    async def abiertas_sin_romper(self, ordenes_ids: list[int] | None = None):
        """`abiertas`, para el planificador. Si la tabla no está (migración sin correr),
        devuelve None y el plan sale como antes de RF-03: con todo."""
        try:
            async with self.db.begin_nested():
                return await self.abiertas(ordenes_ids)
        except Exception as e:
            logger.warning(f"Pausas: no se pudieron leer las pausas abiertas: {e}")
            return None

    async def cerrar_al_cambiar_estado(self, *, id_orden: int, id_otp: int, id_estado: int,
                                       cuando, id_usuario: int | None,
                                       usuario: str | None) -> None:
        """Cierra lo que dejó de estar pausado porque alguien movió un paso.

        · El paso pausado pasa a «en proceso» o «terminado» → se cierra SU pausa. Si
          alguien lo está haciendo, ya no está parado; y un paso terminado no puede
          seguir diciendo «pausado» para siempre.
        · Con ese cambio quedan terminados TODOS los pasos de la OT → se cierra la pausa
          de la OT entera, por lo mismo.

        Poner un paso en proceso NO reanuda la OT entera, a propósito: que se arranque
        un paso no dice que se destrabó lo que la paró (el cliente puede seguir sin
        contestar). Eso lo decide alguien apretando «Reanudar».

        Por ORM y no con un UPDATE suelto: así el cierre queda en el historial de la OT
        solo (infrastructure/auditoria_procesos.py lo ve en el flush). Son una o dos
        filas, no cambia el costo de nada.

        Corre dentro de la transacción del cambio de estado —si se va al rollback, las
        pausas vuelven a quedar abiertas— pero en su propio savepoint: si falla, se
        pierde el cierre y el cambio de estado se guarda igual.
        """
        if id_estado not in (2, 3):
            return
        try:
            async with self.db.begin_nested():
                cierre = "PASO_TERMINADO" if id_estado == 3 else "PASO_EN_PROCESO"
                a_cerrar = [
                    (p, cierre) for p in (await self.db.execute(
                        select(PausaOrden).where(PausaOrden.id_otp == id_otp,
                                                 PausaOrden.hasta.is_(None))
                    )).scalars().all()
                ]
                if id_estado == 3 and await self._ot_terminada(id_orden):
                    a_cerrar += [(p, "OT_TERMINADA") for p in await self._abiertas_de_ots(
                        [id_orden], solo_ot_entera=True)]
                self._cerrar(a_cerrar, cuando, id_usuario, usuario)
        except Exception as e:
            logger.warning(f"Pausas: no se pudo cerrar la pausa del paso {id_otp}: {e}")

    async def cerrar_al_marcar_varias(self, *, ordenes_ids: list[int], id_estado: int,
                                      cuando, id_usuario: int | None,
                                      usuario: str | None) -> None:
        """Lo mismo, para «marcar como terminadas» / «en proceso» varias OT de una.

        Ese camino pone TODOS los pasos en el mismo estado, así que:
          · en proceso → se cierran las pausas de los pasos (la de la OT no: ver arriba);
          · terminado  → se cierra todo, pasos y OT entera.
        Las pausas abiertas son pocas (son la excepción), así que cargarlas por ORM para
        que queden en el historial no cambia el costo de la acción.
        """
        if id_estado not in (2, 3) or not ordenes_ids:
            return
        try:
            async with self.db.begin_nested():
                # Una OT sin pasos no «se termina» por marcarla: el UPDATE masivo no le
                # toca nada (ni la da por entregada), así que su pausa tampoco se cierra.
                con_pasos = set((await self.db.execute(
                    select(OrdenTrabajoProceso.id_orden_trabajo)
                    .where(OrdenTrabajoProceso.id_orden_trabajo.in_(list(ordenes_ids)))
                    .distinct()
                )).scalars().all())
                a_cerrar = []
                for p in await self._abiertas_de_ots(ordenes_ids):
                    if p.id_otp is not None:
                        a_cerrar.append((p, "PASO_TERMINADO" if id_estado == 3 else "PASO_EN_PROCESO"))
                    elif id_estado == 3 and p.id_orden_trabajo in con_pasos:
                        a_cerrar.append((p, "OT_TERMINADA"))
                self._cerrar(a_cerrar, cuando, id_usuario, usuario)
        except Exception as e:
            logger.warning(f"Pausas: no se pudieron cerrar las pausas de {ordenes_ids}: {e}")

    @staticmethod
    def _cerrar(pausas, cuando, id_usuario, usuario) -> None:
        for pausa, cierre in pausas:
            # Nunca antes de que empiece (el CHECK de la base lo exige): una pausa
            # cargada con el reloj de otra máquina un minuto adelantado no puede
            # voltear el cambio de estado.
            pausa.hasta = max(cuando, pausa.desde)
            pausa.cierre = cierre
            pausa.id_usuario_reanuda = id_usuario
            pausa.usuario_reanuda = usuario

    async def _abiertas_de_ots(self, ordenes_ids: list[int], solo_ot_entera: bool = False):
        q = select(PausaOrden).where(PausaOrden.id_orden_trabajo.in_(list(ordenes_ids)),
                                     PausaOrden.hasta.is_(None))
        if solo_ot_entera:
            q = q.where(PausaOrden.id_otp.is_(None))
        return list((await self.db.execute(q)).scalars().all())

    async def _ot_terminada(self, id_orden: int) -> bool:
        """Todos sus pasos terminados (y tiene alguno). Se mira DESPUÉS del cambio: el
        paso recién terminado ya está en la sesión, y la consulta lo flushea antes."""
        total, faltan = (await self.db.execute(
            select(
                func.count(),
                func.sum(case((OrdenTrabajoProceso.id_estado != 3, 1), else_=0)),
            ).select_from(OrdenTrabajoProceso)
            .where(OrdenTrabajoProceso.id_orden_trabajo == id_orden)
        )).one()
        return bool(total) and not (faltan or 0)
