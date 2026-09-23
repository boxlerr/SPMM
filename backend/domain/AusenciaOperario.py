from datetime import date, timedelta
from typing import Iterable

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)

from backend.infrastructure.db import Base

# Por qué faltó. Lista CERRADA y OPCIONAL: se elige, no se escribe («Enfermedad» tipeado
# de cinco maneras no se puede contar), y se puede dejar vacío porque muchas veces el que
# marca «Ausente» a las 7 de la mañana todavía no sabe por qué no vino. Lo que no entra
# va como OTRO, con su texto en la observación. La base lo cuida con un CHECK y no con un
# ENUM de Postgres: sumar un motivo mañana es cambiar el CHECK, no migrar un tipo.
MOTIVOS = ("VACACIONES", "ENFERMEDAD", "LICENCIA", "PERSONAL", "OTRO")

MOTIVO_TEXTO = {
    "VACACIONES": "Vacaciones",
    "ENFERMEDAD": "Enfermedad",
    "LICENCIA": "Licencia",
    "PERSONAL": "Motivo personal",
    "OTRO": "Otro",
}

# De dónde salió la fila.
#   ESTADO  alguien pasó a la persona de «Activo» a «Ausente» en su ficha. Se abre sola
#           ese día y se cierra sola el día que la vuelven a poner «Activo».
#   CARGA   alguien la cargó a mano: un día o un período (vacaciones, una licencia).
#           Siempre tiene fin.
ORIGENES = ("ESTADO", "CARGA")

assert set(MOTIVO_TEXTO) == set(MOTIVOS)


def _lista_sql(valores) -> str:
    return ", ".join(f"'{v}'" for v in valores)


class AusenciaOperario(Base):
    """Un tramo en que una persona no vino a trabajar (RF-06, versión simple).

    El SRS pide «registrar la asistencia y el tiempo efectivo de trabajo de cada
    operario». Hasta el 23/09 lo único que había era `operario.disponible`, un sí/no sin
    fecha: se sabía que alguien estaba ausente HOY, pero no desde cuándo, ni cuántos días
    faltó en el mes, ni por qué. Julián lo pidió así: que el Activo / Ausente de la ficha
    quede guardado con fecha, y poder cargar una ausencia de un día o de un período. Las
    fichadas con reloj (entrada y salida de cada día) son la v2, en el Módulo J.

    LOS DÍAS VAN MEDIO ABIERTOS: [desde, vuelve)

    `desde` es el primer día que faltó y `vuelve` el primer día que ya NO falta. No es un
    capricho: el Activo / Ausente se aprieta durante el día, y el caso que decide es
    «se lo marcó Ausente a las 7:30 y a las 10 llegó». Con un `hasta` inclusivo ese día
    tenía que contar como un día entero de falta (y un clic equivocado, también) o no
    había forma de guardarlo. Con `vuelve` queda [10/09, 10/09): cero días, pero el
    cambio sigue registrado con sus dos horas. La API habla en `hasta` inclusivo (el
    último día que faltó), que es como se dice en el taller; la cuenta la hace
    `hasta_inclusivo`.

    `vuelve` vacío = sigue ausente (sólo una fila ESTADO, y una sola por persona: la
    cuida un índice único parcial). Una ausencia cargada siempre tiene fin.

    NO TOCA EL PLAN

    El planificador sigue mirando sólo `operario.disponible`, como hasta ahora. Cargar
    unas vacaciones deja el registro, no saca a la persona del plan: para eso se la pone
    «Ausente», que es lo que se hacía siempre. Que una ausencia cargada a futuro corte
    las ventanas del solver es otra cosa (excepciones por fecha en el calendario de cada
    persona) y queda para cuando se decida.

    Migración: backend/scripts/migrations/2026-09-23_ausencias_de_operarios.sql
    """

    __tablename__ = "operario_ausencia"

    # BIGSERIAL en Postgres; en SQLite (tests) INTEGER, el único que numera solo.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)

    # Borrar a la persona se lleva sus ausencias: sin el CASCADE el borrado reventaría
    # por una FK, que es exactamente lo que pasaba con operario_rango.
    id_operario = Column(Integer, ForeignKey("operario.id", ondelete="CASCADE"), nullable=False)

    desde = Column(Date, nullable=False)
    vuelve = Column(Date, nullable=True)

    motivo = Column(String(20), nullable=True)
    observacion = Column(String(300), nullable=True)
    origen = Column(String(10), nullable=False, default="CARGA", server_default="CARGA")

    # Quién la cargó (o quién lo pasó a Ausente) y cuándo, del token y del reloj del
    # taller. NULL = no se registró; nunca un autor inventado. El nombre queda congelado.
    cargada_en = Column(DateTime, nullable=False)
    id_usuario_carga = Column(Integer, nullable=True)
    usuario_carga = Column(String(120), nullable=True)

    # Sólo en las ESTADO: cuándo y quién lo volvió a poner «Activo».
    cerrada_en = Column(DateTime, nullable=True)
    id_usuario_cierre = Column(Integer, nullable=True)
    usuario_cierre = Column(String(120), nullable=True)

    __table_args__ = (
        CheckConstraint(f"motivo IS NULL OR motivo IN ({_lista_sql(MOTIVOS)})",
                        name="ck_ausencia_motivo"),
        CheckConstraint(f"origen IN ({_lista_sql(ORIGENES)})", name="ck_ausencia_origen"),
        CheckConstraint("vuelve IS NULL OR vuelve >= desde", name="ck_ausencia_vuelve_despues"),
        CheckConstraint("origen = 'ESTADO' OR vuelve IS NOT NULL", name="ck_ausencia_carga_con_fin"),
        # Lo que pide la ficha: las ausencias de UNA persona en un período.
        Index("ix_ausencia_operario", "id_operario", "desde"),
        # Una sola abierta por persona. El servicio ya lo mira; esto es para dos
        # personas apretando «Ausente» a la vez.
        Index(
            "ux_ausencia_abierta", "id_operario", unique=True,
            postgresql_where=text("vuelve IS NULL"),
            sqlite_where=text("vuelve IS NULL"),
        ),
    )

    @property
    def abierta(self) -> bool:
        return self.vuelve is None

    @property
    def hasta_inclusivo(self) -> date | None:
        """El último día que faltó, o None si sigue ausente o volvió el mismo día."""
        if self.vuelve is None:
            return None
        ultimo = self.vuelve - timedelta(days=1)
        return ultimo if ultimo >= self.desde else None


# ── La cuenta de días ─────────────────────────────────────────────────────────


def dias_trabajo_de(csv: str | None) -> set[int]:
    """«MON,TUE,...» (como lo guarda operario.dias_trabajo) a {0..6}. Vacío = L a V."""
    codigos = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}
    dias = {codigos[d.strip().upper()] for d in (csv or "").split(",")
            if d.strip().upper() in codigos}
    return dias or {0, 1, 2, 3, 4}


def dias_de_ausencia(tramos: Iterable[tuple[date, date | None]], periodo_desde: date,
                     periodo_hasta: date, hoy: date, dias_trabajo: set[int],
                     feriados: Iterable[date] = ()) -> tuple[int, int]:
    """(días, días laborables) de ausencia dentro de [periodo_desde, periodo_hasta].

    `tramos` son (desde, vuelve) medio abiertos, como en la tabla. Una abierta (`vuelve`
    vacío) cuenta hasta HOY inclusive: de lo que viene no se sabe nada.

    Días corridos, y aparte los LABORABLES: los que esa persona tenía que venir según
    sus días de trabajo (operario.dias_trabajo) y que no eran feriado del taller
    (dia_bloqueado). Las vacaciones se cuentan en corridos; una falta, en laborables.

    Los tramos se pueden pisar (una ESTADO y unas vacaciones cargadas encima): cada día
    cuenta una vez.
    """
    if periodo_hasta < periodo_desde:
        return 0, 0
    feriados = set(feriados)
    cubiertos: set[date] = set()
    for desde, vuelve in tramos:
        fin = vuelve if vuelve is not None else hoy + timedelta(days=1)
        d = max(desde, periodo_desde)
        tope = min(fin, periodo_hasta + timedelta(days=1))
        while d < tope:
            cubiertos.add(d)
            d += timedelta(days=1)
    laborables = sum(1 for d in cubiertos if d.weekday() in dias_trabajo and d not in feriados)
    return len(cubiertos), laborables
