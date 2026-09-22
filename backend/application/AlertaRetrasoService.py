"""El aviso automático de orden retrasada (RF-04).

QUÉ PIDE EL REQUISITO

«El sistema deberá generar alertas automáticas si una orden de producción se retrasa
respecto a su cronograma previsto.»

Toda la cañería de avisos ya existía —la tabla, la API, la campanita de arriba a la
derecha y su consulta cada 30 s— pero ninguna notificación nacía sola: todas las
disparaba una persona haciendo algo. Esto es la parte que faltaba: quién MIRA el
reloj y decide que una orden se pasó de fecha.

QUÉ SE CONSIDERA «EL CRONOGRAMA PREVISTO» — DECISIÓN A CONFIRMAR

Se toma la **fecha prometida de la orden**, que es el compromiso con el cliente, está
cargada en TODAS las OT y no depende de que la orden esté planificada.

La otra lectura posible era el fin planificado que calcula el planificador. Se
descartó a propósito: sólo una parte de las órdenes está planificada, el plan se
rehace seguido y un desvío del plan es otra cosa —«esto no va a llegar»— distinta de
«esto ya se pasó de la fecha que le prometimos al cliente». Si Lucas quiere lo otro,
es un aviso NUEVO y no un cambio de éste. **Queda pendiente de confirmar con él.**

QUÉ CUENTA COMO RETRASADA ACÁ, Y POR QUÉ NO ES LO MISMO QUE EN EL TABLERO

El tablero (`/api/dashboard/estadisticas`) tiene su propio bucket «Retrasadas» que
además exige que la orden **no haya arrancado**: una OT que se está fabricando y ya
venció aparece ahí como «En Curso», no como retrasada. Para un aviso eso no sirve —
que el taller ya le haya puesto la mano encima no hace que llegue a tiempo, y son
justo las órdenes de las que hay que hablar hoy.

Se dejó UNA sola regla para el aviso y **no se tocó el número del tablero**: es el que
Lucas mira todos los días y cambiarlo sin que nadie lo pida es cambiarle el piso abajo
de los pies. (Hay incluso una tercera definición, en
`OrdenTrabajoRepository.get_estadisticas_estados`, que se apoya en `fecha_entrega`.)
Consecuencia conocida y esperada: el aviso va a nombrar órdenes que el tablero muestra
como «En Curso». Está anotado para avisarlo, no es un bug.

La regla del aviso, entonces:

  · no está finalizada          (COALESCE(finalizadototal, 0) = 0)
  · no está entregada           (fecha_entrega nula o el 1950-01-01 que usa la base
                                 como «sin fecha»): si ya salió, no hay nada que
                                 hacer, aunque nadie haya tildado «finalizada».
  · tiene fecha prometida REAL  (ni 1950-01-01 ni 3000-01-01, los dos centinelas de
                                 «sin fecha» que conviven en esta base; sin filtrar
                                 los dos, TODA orden sin fecha entraría como retrasada)
  · esa fecha ya pasó           (fecha_prometida < hoy a las 00:00, hora del taller)
  · y todavía no se avisó de ella (NOT EXISTS contra notificacion.id_orden_trabajo)

El «todavía no se avisó» va en la CONSULTA y no sólo en el índice único de Postgres:
los tests corren sobre SQLite, donde el índice parcial no existe, y un anti-duplicado
que sólo viviera en el índice pasaría en verde acá y duplicaría en producción.

EL TOPE POR CORRIDA: POR QUÉ EXISTE

Hay ~194 órdenes abiertas y el taller está sobrevendido. La primera corrida contra
producción puede encontrar decenas de órdenes vencidas de una y escribir todas juntas:
la campanita quedaría con cien renglones el día uno y nadie la volvería a mirar —el
aviso se rompe solo por exceso. Por eso cada corrida escribe como mucho `tope` avisos,
los demás quedan para la próxima (no se pierden: la consulta los vuelve a encontrar) y
el endpoint devuelve cuántos creó y cuántos quedaron sin avisar, para que la primera
pasada se haga a mano y mirando.

El orden con el que se elige a cuáles avisar primero es **las que se retrasaron más
recientemente**. En régimen normal da igual (son una o dos por día), y para la
primera pasada es lo que deja arriba lo que está pasando ahora en vez de la mora
vieja, que ya se conoce.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.Notificacion import Notificacion
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.infrastructure.NotificacionRepository import NotificacionRepository

# El tipo con el que viaja el aviso hasta la campanita. La pantalla lo usa para el
# ícono y el rótulo; el índice único de Postgres, para no repetirlo.
TIPO_ALERTA = "OT_RETRASADA"

# Cuántos avisos como mucho escribe UNA corrida. Conservador a propósito: ver el
# encabezado. Se puede subir por parámetro en la llamada.
TOPE_POR_CORRIDA = 25

# Los dos centinelas de «sin fecha» que conviven en esta base (los trajo el sistema
# viejo). Sin filtrar los dos, toda orden sin fecha real entraría como retrasada.
SIN_FECHA_VIEJA = datetime(1950, 1, 1)
SIN_FECHA_NUEVA = datetime(3000, 1, 1)

# Hora local de Argentina y sin zona, como TODAS las fechas de esta base. Acá no es
# sólo prolijidad: con `utcnow()` el corte de «hoy» se calcularía en UTC y entre las
# 21:00 y las 00:00 hora del taller el sistema ya estaría en el día siguiente, así que
# avisaría un día antes de tiempo.
_TZ_AR = timezone(timedelta(hours=-3))


def _ahora_ar() -> datetime:
    return datetime.now(_TZ_AR).replace(tzinfo=None)


def _solo_fecha(valor):
    """El día, venga como venga de la base (datetime en Postgres, date en algún borde)."""
    return valor.date() if isinstance(valor, datetime) else valor


def armar_mensaje(numero, fecha_prometida, dias: int) -> str:
    """La frase que se lee en la campanita. Cabe en los 500 caracteres de la columna.

    Dice el número con el que el taller conoce la orden, la fecha que se prometió y
    cuánto hace que venció: las tres cosas que alguien necesita para decidir si va a
    buscarla ahora o después, sin abrir nada.
    """
    dia = _solo_fecha(fecha_prometida)
    cuanto = "1 día" if dias == 1 else f"{dias} días"
    return (
        f"La OT #{numero} está retrasada: se prometió para el "
        f"{dia.strftime('%d/%m/%Y')} y hace {cuanto} que venció."
    )[:500]


def armar_motivo(articulo: str | None, cliente: str | None, unidades) -> str:
    """El detalle de abajo: de qué es la orden y de quién. Lo que se pregunta después."""
    partes = [f"Artículo: {articulo or 'sin artículo'}"]
    partes.append(f"Cliente: {cliente or 'sin cliente'}")
    if unidades:
        partes.append(f"Unidades: {unidades}")
    return ". ".join(partes) + "."


class AlertaRetrasoService:
    """Capa de aplicación del aviso de orden retrasada.

    No la llama ninguna pantalla: la dispara `POST /internal/alertas-retraso`, que a su
    vez lo llama un cron externo (mismo patrón que el sync). Ver main.py.
    """

    def __init__(self, db_session):
        self.db = db_session
        self.repository = NotificacionRepository(db_session)

    # 🔹 La regla, en un solo lugar
    def _condiciones(self, corte: datetime):
        """Qué hace que una orden esté retrasada Y todavía sin avisar.

        `corte` es hoy a las 00:00: una orden prometida para HOY no está retrasada.
        """
        ya_avisada = (
            select(Notificacion.id_notificacion)
            .where(
                Notificacion.tipo == TIPO_ALERTA,
                Notificacion.id_orden_trabajo == OrdenTrabajo.id,
            )
            .exists()
        )

        return [
            func.coalesce(OrdenTrabajo.finalizadototal, 0) == 0,
            (OrdenTrabajo.fecha_entrega.is_(None))
            | (OrdenTrabajo.fecha_entrega <= SIN_FECHA_VIEJA),
            OrdenTrabajo.fecha_prometida > SIN_FECHA_VIEJA,
            OrdenTrabajo.fecha_prometida < SIN_FECHA_NUEVA,
            OrdenTrabajo.fecha_prometida < corte,
            ~ya_avisada,
        ]

    # 🔹 Detectar y avisar
    async def detectarYAvisarRetrasos(self, tope: int = TOPE_POR_CORRIDA, ahora: datetime = None):
        """Busca las órdenes vencidas sin aviso y escribe hasta `tope` avisos.

        Devuelve cuántos avisos creó y cuántas órdenes quedaron esperando el suyo: sin
        ese segundo número, una corrida topeada se ve igual que una en la que ya no
        queda nada por avisar.
        """
        try:
            ahora = ahora or _ahora_ar()
            corte = ahora.replace(hour=0, minute=0, second=0, microsecond=0)
            tope = max(int(tope), 1)

            condiciones = self._condiciones(corte)

            # Dos consultas a propósito: el total se cuenta en la base (no se traen
            # filas que no se van a usar) y sólo se leen las `tope` que se van a
            # escribir. Los dos usan LAS MISMAS condiciones, así que los números no se
            # pueden separar.
            pendientes = (
                await self.db.execute(
                    select(func.count()).select_from(OrdenTrabajo).where(*condiciones)
                )
            ).scalar_one()

            if not pendientes:
                logger.info("Alertas de retraso: no hay órdenes vencidas sin avisar.")
                return ResponseDTO(
                    status=True,
                    data={"creadas": 0, "sin_avisar": 0, "tope": tope,
                          "corte": corte.isoformat()},
                    errorDescription="",
                )

            filas = (
                await self.db.execute(
                    select(
                        OrdenTrabajo.id,
                        OrdenTrabajo.id_otvieja,
                        OrdenTrabajo.fecha_prometida,
                        OrdenTrabajo.unidades,
                        Articulo.descripcion.label("articulo"),
                        Cliente.nombre.label("cliente"),
                    )
                    .select_from(OrdenTrabajo)
                    # LEFT JOIN los dos: si a una orden le falta el artículo (dato del
                    # sistema viejo), con un INNER se caería de la lista en silencio y
                    # los dos números de arriba dejarían de coincidir.
                    .outerjoin(Articulo, OrdenTrabajo.id_articulo == Articulo.id)
                    .outerjoin(Cliente, OrdenTrabajo.id_cliente == Cliente.id)
                    .where(*condiciones)
                    .order_by(OrdenTrabajo.fecha_prometida.desc(), OrdenTrabajo.id.desc())
                    .limit(tope)
                )
            ).all()

            avisos = []
            for fila in filas:
                dias = (corte.date() - _solo_fecha(fila.fecha_prometida)).days
                avisos.append(Notificacion(
                    # El taller conoce la orden por el número del sistema viejo; el id
                    # interno es el de adentro y no le dice nada a nadie.
                    mensaje=armar_mensaje(fila.id_otvieja or fila.id, fila.fecha_prometida, dias),
                    tipo=TIPO_ALERTA,
                    leida=False,
                    motivo=armar_motivo(fila.articulo, fila.cliente, fila.unidades),
                    # No la generó una persona: la generó el reloj.
                    id_usuario_creador=None,
                    id_orden_trabajo=fila.id,
                    # EXPLÍCITO: el default del modelo es `utcnow` y deja los avisos
                    # tres horas adelantados («hace un rato» para algo que todavía no
                    # pasó). Ver NotificacionService, que arregló lo mismo del otro lado.
                    fecha_creacion=ahora,
                ))

            creadas = await self.repository.guardar_varias(avisos)
            sin_avisar = max(pendientes - creadas, 0)

            logger.info(
                "Alertas de retraso: %d avisos creados, %d órdenes quedaron para la "
                "próxima corrida (tope=%d).", creadas, sin_avisar, tope,
            )

            return ResponseDTO(
                status=True,
                data={"creadas": creadas, "sin_avisar": sin_avisar, "tope": tope,
                      "corte": corte.isoformat()},
                errorDescription="",
            )

        except InfrastructureException:
            raise
        except Exception as e:
            logger.error(f"Service - Error al detectar órdenes retrasadas: {e}")
            raise InfrastructureException("Error al generar las alertas de retraso.") from e
