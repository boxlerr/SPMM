"""El mantenimiento preventivo de cada máquina (RF-10). Ver
application/MantenimientoMaquinaService.py.

El taller todavía no lo lleva: esto es para tenerlo configurado. Cuatro tablas chicas,
todas colgadas de la máquina con ON DELETE CASCADE:

  maquina_mantenimiento              la configuración (una fila por máquina, si tiene)
  maquina_mantenimiento_hecho        el historial: cada «Registrar mantenimiento hecho»
  maquina_mantenimiento_destinatario a qué usuarios les llega el aviso por email
  maquina_mantenimiento_aviso        cada aviso que ya salió (para no repetirlo) y qué
                                     pasó con el email

La frecuencia en DÍAS no está acá: es `maquinaria.frecuencia_mantenimiento_dias`, que ya
existía (RF-08). Acá va lo que faltaba: cada cuántas horas de uso, con cuántos días de
anticipación avisar y desde cuándo contar si todavía no se registró ninguno.

Tablas aparte y no columnas nuevas en `maquinaria` a propósito: esa tabla la lee el
planificador y cada pantalla que elige una máquina. Si esta migración no llegara a
aplicarse, sólo deja de andar el mantenimiento, no la lista de máquinas.

Migración: backend/scripts/migrations/2026-09-23_uso_y_mantenimiento_de_maquinas.sql
"""
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
)

from backend.infrastructure.db import Base

# Qué disparó el aviso.
MOTIVO_PROXIMO = "PROXIMO"              # faltan N días (o vence hoy)
MOTIVO_VENCIDO_FECHA = "VENCIDO_FECHA"  # ya pasó la fecha
MOTIVO_VENCIDO_HORAS = "VENCIDO_HORAS"  # ya llegó a las horas de uso
MOTIVOS_AVISO = (MOTIVO_PROXIMO, MOTIVO_VENCIDO_FECHA, MOTIVO_VENCIDO_HORAS)

# Qué pasó con el email de un aviso.
EMAIL_PENDIENTE = "PENDIENTE"              # el aviso se guardó y el email todavía no salió
EMAIL_ENVIADO = "ENVIADO"                  # salió a todos
EMAIL_PARCIAL = "PARCIAL"                  # a algunos sí y a otros no
EMAIL_FALLO = "FALLO"                      # a ninguno
EMAIL_SIN_CONFIGURAR = "SIN_CONFIGURAR"    # el servidor no tiene con qué mandar mails
EMAIL_SIN_DESTINATARIOS = "SIN_DESTINATARIOS"  # nadie elegido (o nadie con email)
ESTADOS_EMAIL = (EMAIL_PENDIENTE, EMAIL_ENVIADO, EMAIL_PARCIAL, EMAIL_FALLO,
                 EMAIL_SIN_CONFIGURAR, EMAIL_SIN_DESTINATARIOS)

DIAS_AVISO_POR_DEFECTO = 3


class MantenimientoConfig(Base):
    __tablename__ = "maquina_mantenimiento"

    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id", ondelete="CASCADE"), primary_key=True)
    # Cada cuántas horas de uso EFECTIVO le toca. NULL = no se cuenta por horas.
    cada_horas = Column(Integer, nullable=True)
    # Con cuántos días de anticipación avisar. 0 = el día que vence.
    dias_aviso = Column(Integer, nullable=False, default=DIAS_AVISO_POR_DEFECTO,
                        server_default=str(DIAS_AVISO_POR_DEFECTO))
    # Desde cuándo contar mientras no haya ningún mantenimiento registrado. Sin esto ni
    # un mantenimiento hecho no hay de dónde contar, y no se avisa nada.
    contar_desde = Column(Date, nullable=True)
    actualizado_en = Column(DateTime, nullable=True)
    id_usuario_actualiza = Column(Integer, nullable=True)
    usuario_actualiza = Column(String(120), nullable=True)

    __table_args__ = (
        CheckConstraint("cada_horas IS NULL OR cada_horas > 0", name="ck_mant_cada_horas"),
        CheckConstraint("dias_aviso >= 0 AND dias_aviso <= 60", name="ck_mant_dias_aviso"),
    )


class MantenimientoHecho(Base):
    __tablename__ = "maquina_mantenimiento_hecho"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id", ondelete="CASCADE"), nullable=False)
    # El día en que se hizo (del taller, sin hora).
    fecha = Column(Date, nullable=False)
    # Quién lo hizo, como lo escribió quien lo carga: puede ser un técnico de afuera,
    # que no tiene usuario.
    hecho_por = Column(String(120), nullable=True)
    nota = Column(String(500), nullable=True)
    cargado_en = Column(DateTime, nullable=False)
    id_usuario_carga = Column(Integer, nullable=True)
    usuario_carga = Column(String(120), nullable=True)

    __table_args__ = (
        Index("ix_mant_hecho_maquina", "id_maquinaria", "fecha"),
    )


class MantenimientoDestinatario(Base):
    """A quién le llega el aviso de UNA máquina. Por defecto, a nadie (sin filas).

    `id_usuario` sin FK a propósito: borrar un usuario no puede fallar por esto. La
    lectura cruza con `usuario` y se queda con los que existen, están activos y tienen
    email.
    """

    __tablename__ = "maquina_mantenimiento_destinatario"

    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id", ondelete="CASCADE"), primary_key=True)
    id_usuario = Column(Integer, primary_key=True)


class MantenimientoAviso(Base):
    """Cada aviso que salió. El índice único (máquina, clave) es el «una sola vez por
    vencimiento»: la clave dice qué vencimiento es (ver MantenimientoMaquinaService)."""

    __tablename__ = "maquina_mantenimiento_aviso"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id", ondelete="CASCADE"), nullable=False)
    clave = Column(String(80), nullable=False)
    motivo = Column(String(20), nullable=False)
    # El día que le toca (o tocaba). NULL en el de horas.
    vence = Column(Date, nullable=True)
    creado_en = Column(DateTime, nullable=False)
    # El aviso de la campanita que se escribió con éste (sin FK: se puede borrar).
    id_notificacion = Column(Integer, nullable=True)
    email_estado = Column(String(20), nullable=False, default=EMAIL_PENDIENTE,
                          server_default=EMAIL_PENDIENTE)
    email_enviados = Column(Integer, nullable=False, default=0, server_default="0")
    email_fallidos = Column(Integer, nullable=False, default=0, server_default="0")
    email_detalle = Column(String(500), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "motivo IN ('PROXIMO', 'VENCIDO_FECHA', 'VENCIDO_HORAS')", name="ck_mant_aviso_motivo"
        ),
        CheckConstraint(
            "email_estado IN ('PENDIENTE', 'ENVIADO', 'PARCIAL', 'FALLO', 'SIN_CONFIGURAR', "
            "'SIN_DESTINATARIOS')",
            name="ck_mant_aviso_email",
        ),
        Index("ux_mant_aviso_clave", "id_maquinaria", "clave", unique=True),
    )
