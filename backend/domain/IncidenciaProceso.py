from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import BigInteger, Column, Integer, String, Text, DateTime, ForeignKey

from backend.infrastructure.db import Base

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")


def _ahora_ar() -> datetime:
    """Hora del taller, naive: las columnas de esta base son timestamp sin zona.

    Antes esto era `datetime.utcnow`, que en Buenos Aires adelanta 3 horas: una
    incidencia cargada a las 22:30 quedaba registrada al día siguiente, y el reporte
    agrupado por mes movía de mes las de fin de mes. Las filas anteriores al 22/09/2026
    siguen en UTC a propósito: reescribirlas es tocar dato del cliente.
    """
    return datetime.now(_TZ_AR).replace(tzinfo=None)


class IncidenciaProceso(Base):
    """Una no conformidad detectada en una orden de trabajo (RF-12).

    Se llama `incidencia_proceso` por historia: nació el 25/06 para una sola pregunta
    —«¿cuánto tiempo se perdió porque alguien no interpretó un plano?»— y desde el
    22/09 es el registro de calidad completo que pide el SRS. No se creó una tabla
    aparte a propósito: ésta ya cuelga de la orden por `id_orden_trabajo`, que es
    justamente lo que el RF pide (la NC asociada a su OT), y dos tablas para lo mismo
    serían dos lugares donde buscar.

    Un renglón junta dos cosas que se miran distinto:
      · lo que costó — `minutos_perdidos` y `operarios_extra`, que alimentan la
        tarjeta del dashboard desde el día uno;
      · lo que pasó — `tipo`, `gravedad`, `piezas_afectadas` y cómo se resolvió
        (`estado`, `accion_correctiva`, `fecha_cierre`), que es lo que se lleva al
        reporte de no conformidades.
    """

    __tablename__ = "incidencia_proceso"

    id = Column(Integer, primary_key=True, autoincrement=True)
    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=False)
    id_proceso = Column(Integer, ForeignKey("proceso.id"), nullable=True)
    id_operario = Column(Integer, ForeignKey("operario.id"), nullable=True)
    # Qué clase de no conformidad. Los valores válidos viven en
    # application/IncidenciaProcesoService.py (TIPOS) y no en una tabla catálogo: el RF
    # no pide ABM de tipos y agregarlo sería inventar una pantalla que nadie pidió.
    tipo = Column(String(50), nullable=False, default="INTERPRETACION_PLANOS")
    minutos_perdidos = Column(Integer, nullable=False, default=0)
    operarios_extra = Column(Integer, nullable=False, default=0)
    descripcion = Column(String(500), nullable=True)

    # LEVE | MEDIA | GRAVE. Nullable a propósito: es el único dato que alguien tiene
    # que JUZGAR, y las filas cargadas antes de que el campo existiera en pantalla no
    # tienen ese juicio. NULL = sin clasificar; poner 'MEDIA' por default sería escribir
    # una evaluación que nadie hizo y perder la diferencia para siempre.
    gravedad = Column(String(10), nullable=True)
    # ABIERTA | CERRADA. Éste sí arranca con valor porque no es una opinión: una NC
    # vieja está abierta porque nunca existió la forma de cerrarla.
    estado = Column(String(10), nullable=False, default="ABIERTA", server_default="ABIERTA")
    # NULL = no se registró, que NO es lo mismo que 0 (ninguna pieza afectada).
    piezas_afectadas = Column(Integer, nullable=True)
    # Qué se hizo para resolverla. NULL = todavía nada.
    accion_correctiva = Column(Text, nullable=True)
    # Quién la reportó, tomado del token. NULL = no se registró; nunca un autor
    # inventado (misma regla que auditoría). El nombre queda congelado: si mañana se
    # renombra el usuario, el registro de calidad tiene que seguir diciendo lo que decía.
    id_usuario = Column(Integer, nullable=True)
    usuario = Column(String(120), nullable=True)

    fecha_registro = Column(DateTime, nullable=False, default=_ahora_ar)
    # Cuándo se cerró. NULL mientras siga abierta; las dos cosas se escriben juntas.
    fecha_cierre = Column(DateTime, nullable=True)

    # ── Los rechazos (23/09, lo que pidió Lucas en la reunión) ──
    # «Si algo se rechazó, que quede el registro de que tuviste 10 piezas que se
    # rechazaron. ¿Quién la hizo? Tal empleado.» Para eso hacen falta tres datos más.
    # Migración: 2026-09-23_rechazos_por_paso.sql.
    #
    # En qué PASO de la OT pasó: la pasada (orden_trabajo_proceso.id), no el proceso,
    # porque el mismo proceso puede ir varias veces en la misma orden (la 7497 tiene
    # TORNO CNC trece veces) y «el torno» no dice cuál de las trece. `id_proceso` se
    # sigue llenando con el proceso de ese paso: si mañana sacan el paso de la OT, queda
    # al menos qué trabajo era. Sin FK a propósito, como notificacion.id_orden_trabajo:
    # sacar un paso de la OT no puede fallar por una no conformidad vieja.
    id_otp = Column(BigInteger, nullable=True)
    # De cuántas piezas controladas salieron las rechazadas (`piezas_afectadas`).
    # NULL = no se dijo; no se completa con las unidades de la OT porque no siempre se
    # controla todo.
    piezas_controladas = Column(Integer, nullable=True)
    # Qué se hace con lo rechazado: RETRABAJO | DESCARTE | CONCESION |
    # DEVOLUCION_PROVEEDOR (DISPOSICIONES en el servicio). NULL = todavía no se decidió.
    # No es lo mismo que `accion_correctiva`: ésta dice qué pasa con ESAS piezas; la
    # acción correctiva, qué se hizo para que no vuelva a pasar (y es lo que la cierra).
    disposicion = Column(String(30), nullable=True)
