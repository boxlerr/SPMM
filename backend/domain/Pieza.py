from sqlalchemy import Column, DateTime, Integer, String, Float, and_
from sqlalchemy.ext.hybrid import hybrid_property
from backend.infrastructure.db import Base

def esta_bajo_minimo(stockactual, stock_minimo) -> bool:
    """La regla de «bajo mínimo» sobre dos números sueltos. Ver `Pieza.bajo_minimo`.

    Existe aparte de la propiedad para poder preguntar «¿con ESTE mínimo nuevo
    quedaría abajo?» antes de guardarlo, sin tocar la pieza de la sesión.
    """
    return (
        stock_minimo is not None
        and stockactual is not None
        and stockactual < stock_minimo
    )


class Pieza(Base):
    __tablename__ = "pieza"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    cod_pieza = Column(String, nullable=False)
    descripcion = Column(String, nullable=False)
    unitario = Column(Float, nullable=True)
    unidad = Column(String, nullable=True)
    stockactual = Column(Float, nullable=True)
    observaciones = Column(String, nullable=True)
    proveedor = Column(String, nullable=True)
    material = Column(String, nullable=True)
    formato = Column(String, nullable=True)
    estante = Column(String, nullable=True)
    letra = Column(String, nullable=True)
    nro = Column(String, nullable=True)
    id_otvieja = Column(Integer, nullable=True)

    # El stock mínimo que el pañol quiere vigilar (RF-14). NULL = no se vigila.
    #
    # Es un dato NUEVO de SPMM, no un dato de la materia prima que tenga el sistema
    # viejo: el 11/09 se decidió que el viejo sigue siendo el dueño de las materias
    # primas, y esto no se lo discute — el viejo nunca tuvo mínimo. El sync no lo pisa:
    # al machear una pieza sólo actualiza `stockactual` (sync_db.py, paso 7).
    #
    # Arranca en NULL para TODAS las piezas y así se queda hasta que alguien lo cargue:
    # inventar un mínimo sería llenar la campanita de avisos que nadie pidió.
    # Ver migrations/2026-09-22_stock_minimo.sql.
    stock_minimo = Column(Float, nullable=True)

    # Cuándo se avisó que esta pieza quedó abajo del mínimo. NULL = no hay aviso vigente.
    #
    # Es el anti-duplicado del aviso de stock bajo, y vive acá y no en un índice único
    # de la notificación porque un insumo, a diferencia de una OT, se perfora MUCHAS
    # veces: baja, se repone, vuelve a bajar, y cada bajada merece su aviso. Lo que hay
    # que saber es si la bajada DE AHORA ya se avisó. Lo escribe y lo limpia sólo el
    # detector (AlertaStockService) y el cambio de mínimo; no es para mostrar.
    # Hora local AR sin zona, como todas las fechas de esta base.
    stock_bajo_avisado_en = Column(DateTime, nullable=True)

    # 🔹 La regla de «bajo mínimo», UNA sola vez y en los dos idiomas.
    #
    # La misma regla la necesitan el detector (en SQL, para no traer miles de piezas),
    # el filtro de la solapa (en SQL) y el cambio de mínimo (en Python, sobre una pieza
    # ya cargada). Escrita dos veces, tarde o temprano una opina distinto; como
    # propiedad híbrida, las dos versiones quedan una abajo de la otra.
    #
    #   · Sin mínimo cargado  -> no se vigila, no está bajo nada.
    #   · Sin stock conocido  -> tampoco. NULL es «no sabemos», no «cero»: pintar en
    #                            rojo lo que nadie cargó es el error que ya se corrigió
    #                            en la columna Material (frontend/src/lib/materialOT.ts).
    #   · Estrictamente MENOR -> el SRS dice «por debajo del stock mínimo». Con 10 de
    #                            mínimo y 10 en stock, está justo en el mínimo, no abajo.
    @hybrid_property
    def bajo_minimo(self) -> bool:
        return esta_bajo_minimo(self.stockactual, self.stock_minimo)

    @bajo_minimo.inplace.expression
    @classmethod
    def _bajo_minimo_sql(cls):
        return and_(
            cls.stock_minimo.isnot(None),
            cls.stockactual.isnot(None),
            cls.stockactual < cls.stock_minimo,
        )
