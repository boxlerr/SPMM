from sqlalchemy import BigInteger, Boolean, Column, DateTime, Integer, String, Text, false

from backend.infrastructure.db import Base


class ReporteGuardado(Base):
    """Un reporte personalizado que alguien armó y guardó con nombre (RF-23).

    Guarda la RECETA, no el resultado: la fuente, las columnas, los filtros, la
    agrupación y el orden, como el JSON que arma la pantalla (`config`). Cada vez que se
    abre se vuelve a validar contra el catálogo y contra los permisos de QUIEN LO ABRE, y
    se corre con los datos de ese momento. Un «este mes» guardado es el mes en que se abre.

    Es de quien lo guardó (`id_usuario`): sólo esa persona lo cambia o lo borra. Un admin
    puede marcarlo `compartido` y entonces lo ven todos —pero sólo quien puede leer su
    fuente: un reporte de Auditoría compartido no le abre la Auditoría a nadie—.

    Sin FK a `usuario` a propósito, como el resto de las tablas que anotan un autor: si
    alguna vez se borra una cuenta, sus reportes compartidos siguen sirviendo.

    Migración: backend/scripts/migrations/2026-09-23_reportes_guardados.sql (se aplica sola
    al arrancar, ver infrastructure/migraciones.py).
    """

    __tablename__ = "reporte_guardado"

    # BIGSERIAL en Postgres; en SQLite (tests) un INTEGER, que es el único que numera solo.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    nombre = Column(String(120), nullable=False)
    descripcion = Column(String(500), nullable=True)
    # El código de la fuente (ReportesCatalogo.FUENTES). Repetido afuera del JSON para poder
    # listar y contar sin abrirlo.
    fuente = Column(String(40), nullable=False)
    config = Column(Text, nullable=False)
    id_usuario = Column(Integer, nullable=False)
    # Nombre y apellido de quien lo guardó, del token y congelado (para «compartido por»).
    usuario = Column(String(120), nullable=True)
    compartido = Column(Boolean, nullable=False, default=False, server_default=false())
    # Hora local del taller, sin zona, como todas las fechas de esta base.
    creado_en = Column(DateTime, nullable=False)
    modificado_en = Column(DateTime, nullable=True)
