from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    and_,
    func,
)
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
    # Es el «Punto crítico» de la ficha del insumo, y lo carga sólo SPMM. El viejo tenía
    # el suyo («Pto. crítico», dbo.pieza.CRITICO), pero está en 0 en todas las filas:
    # nunca se usó. Por eso ni la importación (scripts/importar_materia_prima_legacy.py)
    # ni el paso 7b del sync (altas y precios) lo tocan: un 0 traído de allá sería un
    # mínimo que nadie puso. (Nació el 22/09, cuando el viejo todavía era el dueño de la
    # materia prima y el sync, paso 7, pisaba `stockactual`; ese paso se apagó el 23/09.)
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

    # ── Materia prima en SPMM (23/09/2026) ──
    #
    # Desde la reunión del 23/09 la gestión de materias primas pasa a SPMM: el viejo
    # queda sólo para facturas y remitos. Lo de arriba sigue igual (y conserva sus ids:
    # la referencian orden_trabajo_pieza, consumo_material y notificacion); esto es lo
    # que faltaba para dar de alta y describir un insumo acá. Todas NULL o con default:
    # la migración no reescribe ninguna fila.
    #
    # Dos columnas de arriba cambian de sentido:
    #   · `stockactual` pasa a ser el CACHÉ del saldo de pieza_movimiento. Lo recalcula
    #     application/materia_prima/stock.py en cada movimiento (y la importación);
    #     nadie más lo escribe. El sync deja de pisarlo.
    #   · `proveedor` (texto) queda como lo heredado del viejo, sólo lectura: el
    #     proveedor preferido de SPMM es `id_proveedor`.
    #
    # Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql

    # 'insumo' (material con formato y medidas: la descripción se ARMA), 'insumo_desc'
    # (insumo con descripción libre) o 'consumible'. Viejo `insumo`: 0→insumo,
    # 2→insumo_desc, 1→consumible. NULL = sin clasificar, se trata como insumo_desc.
    tipo = Column(String(12), nullable=True)
    id_material = Column(Integer, ForeignKey("material.id"), nullable=True)
    id_calidad = Column(Integer, ForeignKey("material_calidad.id"), nullable=True)
    id_formato = Column(Integer, ForeignKey("formato.id"), nullable=True)
    # En qué se CARGÓ ('mm' | 'pulgada'). Las medidas se guardan SIEMPRE en mm: esto
    # sólo decide cómo se escriben en la descripción (1 1/4" (31.75mm)).
    sistema_medida = Column(String(8), nullable=False, default="mm", server_default="mm")
    medida1 = Column(Numeric(12, 3, asdecimal=False), nullable=True)
    medida2 = Column(Numeric(12, 3, asdecimal=False), nullable=True)
    medida3 = Column(Numeric(12, 3, asdecimal=False), nullable=True)
    medida4 = Column(Numeric(12, 3, asdecimal=False), nullable=True)
    medida5 = Column(Numeric(12, 3, asdecimal=False), nullable=True)
    # Un insumo que ya no se usa no se borra (lo nombran OT, facturas y movimientos
    # viejos): se marca inactivo y deja de ofrecerse.
    inactivo = Column(SmallInteger, nullable=False, default=0, server_default="0")
    id_proveedor = Column(Integer, ForeignKey("proveedor.id"), nullable=True)
    # De cuándo es `unitario`. Sin esto, «el último precio» no decía de qué año era.
    fecha_ultimo_precio = Column(Date, nullable=True)
    # 'legacy' (vino del viejo) | 'spmm' (alta acá). NULL = fila anterior a la importación.
    origen = Column(String(10), nullable=True)
    creado_en = Column(DateTime, nullable=True)
    creado_por = Column(String(120), nullable=True)
    modificado_en = Column(DateTime, nullable=True)
    modificado_por = Column(String(120), nullable=True)

    __table_args__ = (
        CheckConstraint("tipo IN ('insumo', 'insumo_desc', 'consumible')", name="ck_pieza_tipo"),
        CheckConstraint("sistema_medida IN ('mm', 'pulgada')", name="ck_pieza_sistema_medida"),
        CheckConstraint("origen IN ('legacy', 'spmm')", name="ck_pieza_origen"),
        # Los códigos se comparan SIEMPRE normalizados (el viejo no distingue mayúsculas
        # y hay códigos con espacios adelante). NO es único: hay un duplicado heredado
        # (50%004) y la unicidad de los nuevos la cuida el servicio.
        Index("ix_pieza_cod_norm", func.upper(func.trim(cod_pieza))),
    )

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
