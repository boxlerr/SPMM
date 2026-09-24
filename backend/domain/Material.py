from sqlalchemy import Column, Index, Integer, SmallInteger, String, func

from backend.infrastructure.db import Base


class Material(Base):
    """El material de un insumo: ACERO, ALUMINIO, BRONCE, PLASTICOS…

    Es el catálogo que en el sistema viejo vivía mezclado con la calidad (`dbo.Material`
    es una lista de pares material/calidad, y `pieza.material` un texto suelto). Acá va
    separado porque son dos cosas que se eligen por separado en el alta: primero el
    material, después su calidad filtrada por ese material (ver MaterialCalidad).

    El nombre es único sin mirar mayúsculas (índice sobre upper(nombre) en la base):
    «Acero» y «ACERO» serían el mismo material con dos filas, y el código del insumo
    saldría de cualquiera de las dos. NO se fusionan nombres parecidos (PLASTICO y
    PLASTICOS quedan como en el viejo: decisión del cliente).

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "material"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String(80), nullable=False)
    # La letra con la que empieza el código de los insumos de este material (ACERO → A,
    # BRONCE → B). NULL = la primera letra del nombre. Existe como columna porque hay
    # materiales cuya letra no es la inicial que uno esperaría y el código es de las
    # facturas del viejo: si la regla adivina mal, el código nuevo no sigue la serie.
    letra_codigo = Column(String(2), nullable=True)
    # 0/1 como el resto de las marcas. Un material que ya no se compra no se borra: lo
    # siguen nombrando los insumos viejos.
    activo = Column(SmallInteger, nullable=False, default=1, server_default="1")

    __table_args__ = (
        Index("ux_material_nombre", func.upper(nombre), unique=True),
    )
