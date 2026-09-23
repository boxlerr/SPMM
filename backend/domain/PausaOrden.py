from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)

from backend.infrastructure.db import Base

# Los motivos de una pausa, en el orden en que se ofrecen en pantalla. Es una lista
# CERRADA a propósito (RF-03): «falta material» escrito de cinco maneras no se puede
# contar, y lo primero que se va a preguntar es cuánto se para el taller por cada cosa.
# Lo que no entra va como OTRO con su texto. La base lo cuida con un CHECK y no con un
# ENUM de Postgres: agregar un motivo mañana es cambiar el CHECK, no migrar un tipo.
MOTIVOS = ("FALTA_MATERIAL", "MAQUINA_ROTA", "ESPERA_CLIENTE", "CAMBIO_PRIORIDAD", "OTRO")

# Cómo terminó una pausa. NULL mientras sigue abierta.
#   REANUDADA        alguien apretó «Reanudar».
#   PASO_EN_PROCESO  el paso pausado se puso «en proceso»: si alguien lo está
#                    haciendo, ya no está parado.
#   PASO_TERMINADO   el paso pausado se dio por terminado.
#   OT_TERMINADA     se terminaron todos los pasos de la OT pausada.
# Las tres últimas las cierra el sistema al cambiar el estado, con el autor de ese
# cambio: sin esto un paso terminado seguiría diciendo «pausado» para siempre.
CIERRES = ("REANUDADA", "PASO_EN_PROCESO", "PASO_TERMINADO", "OT_TERMINADA")


def _lista_sql(valores) -> str:
    return ", ".join(f"'{v}'" for v in valores)


# ── Cómo se lee cada cosa ────────────────────────────────────────────────────
#
# Viven acá, al lado de la lista cerrada, y no en el servicio: las usan el servicio,
# la auditoría de procesos (que es infraestructura y no importa de application) y el
# aviso del planificador. Tres copias del «Falta material» serían tres textos distintos
# en un mes.

MOTIVO_TEXTO = {
    "FALTA_MATERIAL": "Falta material",
    "MAQUINA_ROTA": "Máquina rota",
    "ESPERA_CLIENTE": "Espera del cliente",
    "CAMBIO_PRIORIDAD": "Cambió la prioridad",
    "OTRO": "Otro",
}

# Dentro de una frase: «OT 15279: pausada por falta de material desde el 22/09».
MOTIVO_EN_FRASE = {
    "FALTA_MATERIAL": "por falta de material",
    "MAQUINA_ROTA": "por máquina rota",
    "ESPERA_CLIENTE": "esperando al cliente",
    "CAMBIO_PRIORIDAD": "porque cambió la prioridad",
    "OTRO": "por otro motivo",
}

CIERRE_TEXTO = {
    "REANUDADA": "Reanudada",
    "PASO_EN_PROCESO": "Se cerró sola al poner el paso en proceso",
    "PASO_TERMINADO": "Se cerró sola al terminar el paso",
    "OT_TERMINADA": "Se cerró sola al terminar la OT",
}

assert set(MOTIVO_TEXTO) == set(MOTIVOS) == set(MOTIVO_EN_FRASE)
assert set(CIERRE_TEXTO) == set(CIERRES)


def fecha_corta(cuando) -> str:
    """«22/09 10:30». El año sobra: una pausa de más de un año no es una pausa."""
    return cuando.strftime("%d/%m %H:%M") if cuando else ""


def minutos_entre(desde, hasta) -> int:
    return max(0, int((hasta - desde).total_seconds() // 60))


def duracion_corta(minutos: int) -> str:
    """«45 min», «2 h 15 min», «3 días». Días corridos, no jornadas: una pausa corre de
    noche y el fin de semana igual."""
    minutos = max(0, int(minutos or 0))
    if minutos < 60:
        return f"{minutos} min"
    if minutos < 24 * 60:
        h, m = divmod(minutos, 60)
        return f"{h} h {m} min" if m else f"{h} h"
    dias = round(minutos / (24 * 60))
    return f"{dias} día" if dias == 1 else f"{dias} días"


def texto_del_motivo(pausa) -> str:
    """«Falta material», o el texto de «Otro» (que es lo único que dice algo)."""
    if pausa.motivo == "OTRO" and pausa.observacion:
        return pausa.observacion
    return MOTIVO_TEXTO.get(pausa.motivo, pausa.motivo)


def que_se_pauso(pausa, numero_ot=None) -> str:
    """«la OT 15279» o «el paso 3 (TORNO CNC) de la OT 15279»."""
    ot = f"la OT {numero_ot}" if numero_ot else "la OT"
    if pausa.id_otp is None:
        return ot
    nombre = f" ({pausa.nombre_proceso})" if pausa.nombre_proceso else ""
    paso = f"el paso {pausa.paso}" if pausa.paso else "un paso"
    return f"{paso}{nombre} de {ot}"


class PausaOrden(Base):
    """Una pausa de una OT entera o de uno de sus pasos (RF-03).

    El SRS pide «pausar y reanudar órdenes de producción, registrando el motivo de la
    pausa y quién la ejecutó». Hasta el 22/09 no existía: un paso estaba pendiente, en
    proceso o terminado, y si se rompía la máquina o faltaba material la OT seguía «en
    proceso» con el reloj corriendo — y el operario parecía lento.

    POR QUÉ UN HISTORIAL Y NO UN CUARTO ESTADO

    `estado_proceso` tiene tres filas (1 pendiente, 2 en proceso, 3 terminado) y ese
    1-2-3 está escrito a mano en el tablero, el Gantt, dos SQL del dashboard, el
    planificador y el sync. Un «4 = pausado» dejaba todas esas pantallas diciendo
    «pendiente» a una OT pausada, y además borraba lo que el paso ERA: una pausa no
    deshace el arranque. Así que el estado no se toca —un paso en proceso que se pausa
    sigue en proceso, con su `inicio_real`— y la pausa vive acá, con su propio desde y
    hasta. Estar pausado es «tener una fila con `hasta` vacío».

    Y es un historial, una fila por pausa, porque el tiempo EFECTIVO de un paso (RF-06)
    es su tiempo corrido menos lo que estuvo parado: con un solo «está pausado sí/no»
    esa resta no se puede hacer.

    OT ENTERA O UN PASO

    `id_otp` vacío = la OT entera. Sus pasos no llevan fila propia: están parados porque
    la OT lo está, y al reanudarla vuelven todos juntos. `id_otp` lleno = sólo ese paso
    (la pasada de orden_trabajo_proceso). Las dos cosas pueden convivir: si el torno
    está roto (el paso) y además el cliente pidió esperar (la OT), reanudar la OT deja
    el paso pausado, porque el torno sigue roto.

    `id_otp` va SIN FK a propósito: el guardado completo de la OT borra y recrea pasos,
    y una FK trabaría ese guardado por una pausa vieja. Por eso se copian el paso y el
    nombre del proceso: el historial tiene que seguir diciendo qué se pausó aunque ese
    paso ya no esté.

    Migración: backend/scripts/migrations/2026-09-22_pausas_de_ot.sql
    """

    __tablename__ = "orden_trabajo_pausa"

    # BIGSERIAL en Postgres; en SQLite (tests) INTEGER, el único que numera solo.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)

    # Borrar la OT se lleva sus pausas: son de la orden, no un rastro suelto (el rastro
    # de quién la pausó queda en auditoria_proceso_ot, que no tiene FK).
    id_orden_trabajo = Column(
        Integer, ForeignKey("orden_trabajo.id", ondelete="CASCADE"), nullable=False
    )
    id_otp = Column(BigInteger().with_variant(Integer, "sqlite"), nullable=True)
    # Copias al momento de pausar (ver arriba). NULL en una pausa de la OT entera.
    paso = Column(Integer, nullable=True)
    nombre_proceso = Column(String(200), nullable=True)

    motivo = Column(String(30), nullable=False)
    # Obligatoria con OTRO (lo valida el servicio): «otro» sin texto no dice nada.
    observacion = Column(String(500), nullable=True)

    # Hora local del taller, sin zona, como todas las fechas de esta base.
    desde = Column(DateTime, nullable=False)
    # NULL = sigue pausada.
    hasta = Column(DateTime, nullable=True)
    cierre = Column(String(20), nullable=True)

    # Quién, tomado del token. NULL = no se registró; nunca un autor inventado. El
    # nombre queda congelado: si mañana se renombra el usuario, el historial dice lo
    # mismo que decía.
    id_usuario_pausa = Column(Integer, nullable=True)
    usuario_pausa = Column(String(120), nullable=True)
    id_usuario_reanuda = Column(Integer, nullable=True)
    usuario_reanuda = Column(String(120), nullable=True)

    __table_args__ = (
        CheckConstraint(f"motivo IN ({_lista_sql(MOTIVOS)})", name="ck_pausa_motivo"),
        CheckConstraint(
            f"cierre IS NULL OR cierre IN ({_lista_sql(CIERRES)})", name="ck_pausa_cierre"
        ),
        CheckConstraint("hasta IS NULL OR hasta >= desde", name="ck_pausa_hasta_despues"),
        # Lo que pide la ficha: las pausas de UNA orden, la última primero.
        Index("ix_pausa_ot", "id_orden_trabajo", "desde"),
        # Una sola pausa ABIERTA por OT entera y una sola por paso. El servicio ya lo
        # mira antes de insertar; esto es para dos personas apretando «Pausar» a la
        # vez, que es justo lo que el servicio no puede ver.
        Index(
            "ux_pausa_abierta_ot", "id_orden_trabajo", unique=True,
            postgresql_where=text("hasta IS NULL AND id_otp IS NULL"),
            sqlite_where=text("hasta IS NULL AND id_otp IS NULL"),
        ),
        Index(
            "ux_pausa_abierta_paso", "id_otp", unique=True,
            postgresql_where=text("hasta IS NULL AND id_otp IS NOT NULL"),
            sqlite_where=text("hasta IS NULL AND id_otp IS NOT NULL"),
        ),
    )
