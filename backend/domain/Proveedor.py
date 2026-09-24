from sqlalchemy import Column, DateTime, Integer, SmallInteger, String, Text

from backend.infrastructure.db import Base


class Proveedor(Base):
    """A quién se le compra.

    Hasta el 23/09/2026 SPMM no tenía proveedores: `pieza.proveedor` es un texto libre
    copiado del viejo (con 16.702 filas que son un espacio en blanco). Con la compra
    pasando a SPMM hace falta poder elegir uno de una lista, y que dos compras al mismo
    proveedor digan lo mismo.

    `id_legacy` es la clave de `dbo.Proveedor` del viejo: la importación hace upsert
    por ahí y así se puede correr varias veces. NULL = dado de alta en SPMM.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "proveedor"

    id = Column(Integer, primary_key=True, autoincrement=True)
    id_legacy = Column(Integer, nullable=True, unique=True)
    razon_social = Column(String(200), nullable=False)
    fantasia = Column(String(200), nullable=True)
    cuit = Column(String(20), nullable=True)
    telefono = Column(String(60), nullable=True)
    celular = Column(String(60), nullable=True)
    mail = Column(String(120), nullable=True)
    direccion = Column(String(200), nullable=True)
    localidad = Column(String(100), nullable=True)
    observaciones = Column(Text, nullable=True)
    # Un proveedor al que no se le compra más no se borra: lo nombran compras viejas.
    inactivo = Column(SmallInteger, nullable=False, default=0, server_default="0")
    # Hora local AR sin zona; quién, tomado del token. NULL = vino del viejo o de un
    # script: nunca un autor inventado.
    creado_en = Column(DateTime, nullable=True)
    creado_por = Column(String(120), nullable=True)
