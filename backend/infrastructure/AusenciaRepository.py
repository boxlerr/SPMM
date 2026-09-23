"""Las ausencias de cada persona (RF-06). Ver domain/AusenciaOperario.py.

Dos clases de llamada, con reglas distintas (igual que PausaRepository):

  · Las de la pantalla de asistencia (listar, cargar, corregir, borrar): son el pedido
    entero, y si la tabla no está la respuesta es un error, que es lo que corresponde.
  · La que corre PEGADA al guardado de la persona —anotar que la pasaron a Ausente o a
    Activo—: va en un SAVEPOINT y no levanta nunca. Si la migración todavía no corrió,
    en Postgres una consulta que falla deja la transacción abortada y el COMMIT del
    guardado se convierte en un ROLLBACK que no avisa: cambiarle el estado a alguien no
    puede dejar de andar por una tabla de ausencias.
"""
from datetime import date, datetime

from sqlalchemy import func, select

from backend.commons.loggers.logger import logger
from backend.domain.AusenciaOperario import AusenciaOperario
from backend.domain.Operario import Operario
from backend.infrastructure.DiaBloqueadoRepository import feriados_sin_romper


class AusenciaRepository:
    def __init__(self, db):
        self.db = db

    # ------------------------------------------------------------------
    # Lecturas de la pantalla
    # ------------------------------------------------------------------

    async def find_operario(self, id_operario: int) -> Operario | None:
        return (await self.db.execute(
            select(Operario).where(Operario.id == id_operario)
        )).scalar_one_or_none()

    async def find(self, id_ausencia: int) -> AusenciaOperario | None:
        return (await self.db.execute(
            select(AusenciaOperario).where(AusenciaOperario.id == id_ausencia)
        )).scalar_one_or_none()

    async def de_la_persona(self, id_operario: int, desde: date | None = None,
                            hasta: date | None = None) -> list[AusenciaOperario]:
        """Las que tocan [desde, hasta] (las dos puntas incluidas), la última primero.

        Una abierta toca todo lo que viene después de su `desde`.
        """
        q = select(AusenciaOperario).where(AusenciaOperario.id_operario == id_operario)
        if hasta is not None:
            q = q.where(AusenciaOperario.desde <= hasta)
        if desde is not None:
            q = q.where((AusenciaOperario.vuelve.is_(None)) | (AusenciaOperario.vuelve > desde))
        q = q.order_by(AusenciaOperario.desde.desc(), AusenciaOperario.id.desc())
        return list((await self.db.execute(q)).scalars().all())

    async def abierta(self, id_operario: int) -> AusenciaOperario | None:
        return (await self.db.execute(
            select(AusenciaOperario).where(
                AusenciaOperario.id_operario == id_operario,
                AusenciaOperario.vuelve.is_(None),
            )
        )).scalars().first()

    async def cargadas_que_pisan(self, id_operario: int, desde: date, vuelve: date,
                                 salvo: int | None = None) -> list[AusenciaOperario]:
        """Las CARGADAS a mano que se pisan con [desde, vuelve). Las del Activo / Ausente
        no cuentan: pueden convivir con una carga (ver AusenciaService.cargar)."""
        q = select(AusenciaOperario).where(
            AusenciaOperario.id_operario == id_operario,
            AusenciaOperario.origen == "CARGA",
            AusenciaOperario.desde < vuelve,
            AusenciaOperario.vuelve > desde,
        )
        if salvo is not None:
            q = q.where(AusenciaOperario.id != salvo)
        return list((await self.db.execute(q.order_by(AusenciaOperario.desde))).scalars().all())

    async def feriados(self) -> list[date]:
        """Los días bloqueados del calendario del taller, o nada si no se pueden leer
        (la cuenta de laborables sale sin feriados y el resto del pedido sigue)."""
        return await feriados_sin_romper(self.db)

    async def guardar(self, ausencia: AusenciaOperario) -> AusenciaOperario:
        self.db.add(ausencia)
        await self.db.flush()
        return ausencia

    async def borrar(self, ausencia: AusenciaOperario) -> None:
        await self.db.delete(ausencia)
        await self.db.flush()

    # ------------------------------------------------------------------
    # La que va pegada al guardado de la persona: savepoint, y nunca levanta
    # ------------------------------------------------------------------

    async def anotar_cambio_de_estado(self, *, id_operario: int, estaba_disponible,
                                      queda_disponible, cuando: datetime,
                                      id_usuario: int | None, usuario: str | None,
                                      observacion: str | None = None) -> None:
        """Deja constancia de un Activo → Ausente o Ausente → Activo.

        · A Ausente: abre una ausencia ESTADO ese día (si no hay una abierta ya).
        · A Activo: cierra la abierta. `vuelve` es HOY: faltó hasta ayer. Si la habían
          marcado hoy mismo, queda de cero días —llegó tarde, o fue un clic equivocado—
          pero el cambio queda registrado con sus dos horas.
        · Sin cambio (se guardó la ficha con el mismo estado), nada.

        Si estaba Ausente desde antes de que existiera esto, no hay nada abierto que
        cerrar y no se inventa un «desde»: la ausencia vieja no tiene fecha y así queda.

        Corre dentro de la transacción del guardado —si se va al rollback, esto también—
        pero en su propio savepoint: si falla, se pierde la anotación y el guardado de la
        persona sigue.
        """
        antes = bool(estaba_disponible) if estaba_disponible is not None else True
        despues = bool(queda_disponible) if queda_disponible is not None else True
        if antes == despues:
            return
        try:
            async with self.db.begin_nested():
                abierta = await self.abierta(id_operario)
                if not despues:
                    if abierta is None:
                        self.db.add(AusenciaOperario(
                            id_operario=id_operario,
                            desde=cuando.date(),
                            vuelve=None,
                            origen="ESTADO",
                            observacion=(observacion or "").strip()[:300] or None,
                            cargada_en=cuando,
                            id_usuario_carga=id_usuario,
                            usuario_carga=usuario,
                        ))
                elif abierta is not None:
                    # Nunca antes de que empiece (lo exige el CHECK de la base).
                    abierta.vuelve = max(cuando.date(), abierta.desde)
                    abierta.cerrada_en = cuando
                    abierta.id_usuario_cierre = id_usuario
                    abierta.usuario_cierre = usuario
                await self.db.flush()
        except Exception as e:
            logger.warning(
                f"Ausencias: no se pudo anotar el cambio de estado de la persona {id_operario}: {e}")

    async def cuantas_sin_romper(self, id_operario: int) -> int:
        """Cuántas tiene cargadas, para el aviso de «borrar persona». 0 si no se puede
        saber (tabla sin crear): el aviso sale sin esa línea, no se traba el borrado."""
        try:
            async with self.db.begin_nested():
                return int((await self.db.execute(
                    select(func.count()).select_from(AusenciaOperario)
                    .where(AusenciaOperario.id_operario == id_operario)
                )).scalar() or 0)
        except Exception as e:
            logger.warning(f"Ausencias: no se pudieron contar las de la persona {id_operario}: {e}")
            return 0
