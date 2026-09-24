from sqlalchemy import Column, Integer, SmallInteger, String

from backend.infrastructure.db import Base


class Formato(Base):
    """La forma en que viene un insumo: BARRA REDONDO, TUBO RECTANGULAR, PLACA…

    En el viejo la lista estaba fija en el código VB; acá es una tabla para que cada
    formato diga QUÉ MIDE cada una de sus medidas (las etiquetas). Con eso el alta
    pide exactamente las medidas del formato, con su nombre («Ø exterior», «Espesor»),
    y la descripción sale siempre igual.

    Se siembra en la migración (INSERT … ON CONFLICT (nombre) DO NOTHING) con la misma
    lista que usa application/materia_prima/semilla.py para los tests; un test compara
    las dos.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "formato"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String(60), nullable=False, unique=True)
    # Las letras del formato en el código del insumo (ACERO + BARRA CUADRADO = ABC).
    # Repiten las del viejo a propósito, choques incluidos (BARRA REDONDO y BARRA
    # RECTANGULAR son las dos BR): el número se comparte por prefijo y así los códigos
    # nuevos siguen la serie que ya usan las facturas.
    iniciales = Column(String(4), nullable=False)
    # Qué es cada medida, en orden. La cantidad de medidas que pide el formato es la
    # cantidad de etiquetas no nulas (siempre las primeras).
    etiqueta1 = Column(String(30), nullable=True)
    etiqueta2 = Column(String(30), nullable=True)
    etiqueta3 = Column(String(30), nullable=True)
    etiqueta4 = Column(String(30), nullable=True)
    etiqueta5 = Column(String(30), nullable=True)
    orden = Column(SmallInteger, nullable=True)
    activo = Column(SmallInteger, nullable=False, default=1, server_default="1")

    @property
    def etiquetas(self) -> list[str]:
        """Las etiquetas cargadas, en orden: una por medida que pide el formato."""
        return [e for e in (self.etiqueta1, self.etiqueta2, self.etiqueta3,
                            self.etiqueta4, self.etiqueta5) if e]
