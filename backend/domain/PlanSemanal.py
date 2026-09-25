from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)

from backend.infrastructure.db import Base


class PlanSemanal(Base):
    """Qué OT están programadas cada semana, según el plan semanal del Sistema Integral.

    POR QUÉ EXISTE. En el Integral, «Semana del …» de la pantalla de Pendientes de compra
    muestra las materias primas de las OT de `dbo.plansemanal` con ese lunes: un plan
    semanal que el taller carga a mano y sigue vivo (55 a 93 OT por semana en 2026). La
    reunión con Lucas pidió que Maxi elija la semana en Metlosys y vea lo mismo. Mientras
    el Integral sea el dueño de la materia prima (la prueba piloto, application/
    materia_prima/dueno.py), el planificador de SPMM no tiene plan cargado (el 25/09 la
    tabla `planificacion` de producción estaba vacía) y la semana salía siempre en 0.

    Una fila = una OT en una semana. La trae el ESPEJO del sync (paso plan_semanal de
    scripts/importar_materia_prima_legacy.py), en una ventana alrededor de hoy: fuera de
    esa ventana no se toca nada, así que las semanas viejas quedan como estaban.

    · `semana` es SIEMPRE un lunes: el Integral guarda el lunes en 371 de sus 389 semanas
      y en las otras 18 un viernes, martes, miércoles o sábado (se normaliza al lunes de
      esa semana; el día que decía queda en `fecha_original`).
    · `numero_ot` es el número que ve la gente (el idot del Integral). `id_orden_trabajo`
      es la OT de SPMM sólo si ES la del Integral con ese número (mismo artículo, cliente
      y fecha: la misma identidad que el resto del espejo). Si no coincide o no existe,
      queda NULL y el número queda escrito.
    · FK con ON DELETE SET NULL: borrar la OT no se lleva el plan, deja el número.
    · Una OT se arrastra de semana en semana mientras no se termina (15240 y 15243 están
      en 8 semanas seguidas): una fila por cada semana. En el Integral hay pares (fecha,
      ot) repetidos (71); acá UNIQUE(semana, numero_ot).
    · `origen` 'legacy' = lo trajo el espejo; 'spmm' queda para cuando SPMM cargue su
      propio plan semanal (el espejo no las toca).

    Migración: backend/scripts/migrations/2026-09-25_plan_semanal.sql
    """

    __tablename__ = "plan_semanal"
    __table_args__ = (
        UniqueConstraint("semana", "numero_ot", name="ux_plan_semanal_semana_ot"),
        CheckConstraint("origen IN ('legacy', 'spmm')", name="ck_plan_semanal_origen"),
        Index("ix_plan_semanal_ot", "id_orden_trabajo"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    # El lunes de la semana (fecha sin hora).
    semana = Column(Date, nullable=False)
    # El día que decía el Integral (casi siempre el mismo lunes).
    fecha_original = Column(Date, nullable=True)
    numero_ot = Column(Integer, nullable=False)
    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id", ondelete="SET NULL"),
                              nullable=True)
    # «Normal», «Urgente», «Urgente 1», «Urgente 2» (texto del Integral).
    prioridad = Column(String(30), nullable=True)
    origen = Column(String(10), nullable=False, default="legacy", server_default="legacy")
    # Hora local AR sin zona.
    creado_en = Column(DateTime, nullable=True)
