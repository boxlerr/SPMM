"""Las consultas del catálogo de insumos (spec §2.1). Sólo ORM: corren igual en la
SQLite de los tests y en el Postgres de producción.

Nada de acá hace commit: lee, agrega a la sesión o borra, y el servicio decide cuándo
termina la transacción (como el núcleo de application/materia_prima/).

LA LISTA DE INSUMOS, SIN N+1

El catálogo tiene ~17.800 piezas. La lista pide una página con UNA consulta (la pieza
con los nombres de material, calidad, formato y proveedor por outer join), cuenta el
total con otra, y el stock reservado y los recortes de ESA página se piden después con
las funciones agregadas del núcleo (stock.stock_de, stock.recortes_disponibles_de), que
van por tandas de ids y no por pieza. El físico sale del caché `pieza.stockactual`, que
es lo mismo que filtran «con stock» y «bajo mínimo»: la fila y el filtro no pueden
opinar distinto.
"""
from __future__ import annotations

from sqlalchemy import and_, case, delete, distinct, func, or_, select

from backend.application.materia_prima.catalogo_texto import tokens
from backend.application.materia_prima.reglas import TIPOS_INSUMO, norm_desc
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.Formato import Formato
from backend.domain.Material import Material
from backend.domain.MaterialCalidad import MaterialCalidad
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.Pieza import Pieza
from backend.domain.PiezaMovimiento import PiezaMovimiento
from backend.domain.PiezaPrecio import PiezaPrecio
from backend.domain.PiezaRecorte import PiezaRecorte
from backend.domain.Proveedor import Proveedor

# El código comparado como lo compara el viejo: sin espacios en los bordes y sin mirar
# mayúsculas. Es la expresión del índice ix_pieza_cod_norm.
CODIGO_NORM = func.upper(func.trim(Pieza.cod_pieza))

# Cuántos duplicados se muestran en el aviso: con uno alcanza para frenar; más de unos
# pocos es que la descripción es genérica y la lista no ayuda.
MAX_DUPLICADOS = 10


def _contiene(columna, texto):
    """ILIKE '%texto%' con los comodines del texto escapados: hay códigos con % y _
    («50%004») y no pueden volverse comodines de la búsqueda."""
    return columna.icontains(texto, autoescape=True)


class MateriaPrimaCatalogoRepository:
    def __init__(self, db):
        self.db = db

    # ─────────────────────────── catálogos chicos ───────────────────────────

    async def materiales_activos(self):
        return (await self.db.execute(
            select(Material).where(Material.activo == 1).order_by(Material.nombre)
        )).scalars().all()

    async def calidades_activas(self):
        return (await self.db.execute(
            select(MaterialCalidad).where(MaterialCalidad.activo == 1)
            .order_by(MaterialCalidad.nombre)
        )).scalars().all()

    async def formatos_activos(self):
        return (await self.db.execute(
            select(Formato).where(Formato.activo == 1).order_by(Formato.orden, Formato.nombre)
        )).scalars().all()

    async def materiales_todos(self):
        """Todos, dados de baja incluidos: el nombre es único entre todos (el índice de
        la base no mira `activo`). Son unas decenas de filas."""
        return (await self.db.execute(select(Material))).scalars().all()

    async def calidades_de(self, id_material: int):
        return (await self.db.execute(
            select(MaterialCalidad).where(MaterialCalidad.id_material == id_material)
        )).scalars().all()

    async def material(self, id_material):
        return await self.db.get(Material, id_material) if id_material is not None else None

    async def calidad(self, id_calidad):
        return await self.db.get(MaterialCalidad, id_calidad) if id_calidad is not None else None

    async def formato(self, id_formato):
        return await self.db.get(Formato, id_formato) if id_formato is not None else None

    async def proveedor(self, id_proveedor):
        return await self.db.get(Proveedor, id_proveedor) if id_proveedor is not None else None

    # ─────────────────────────── proveedores ───────────────────────────

    async def buscar_proveedores(self, search: str | None, limit: int, incluir_inactivos: bool):
        """Cada palabra tiene que aparecer en la razón social, el nombre de fantasía o el
        CUIT (en cualquiera de los tres)."""
        filtros = [
            or_(_contiene(Proveedor.razon_social, t), _contiene(Proveedor.fantasia, t),
                _contiene(Proveedor.cuit, t))
            for t in tokens(search)
        ]
        if not incluir_inactivos:
            filtros.append(func.coalesce(Proveedor.inactivo, 0) == 0)
        return (await self.db.execute(
            select(Proveedor).where(*filtros)
            .order_by(func.upper(Proveedor.razon_social), Proveedor.id).limit(limit)
        )).scalars().all()

    async def proveedores_para_comparar(self):
        """(id, razón social, fantasía, cuit, inactivo) de todos: el aviso de duplicado
        compara nombres normalizados (sin acentos ni «S.A.») y eso no se puede pedir en
        SQL portable. Son ~900 filas de cuatro columnas."""
        return (await self.db.execute(
            select(Proveedor.id, Proveedor.razon_social, Proveedor.fantasia, Proveedor.cuit,
                   Proveedor.inactivo)
        )).all()

    # ─────────────────────────── insumos: lista ───────────────────────────

    @staticmethod
    def _filtros_insumos(search=None, tipo=None, id_material=None, id_formato=None,
                         con_stock=False, bajo_minimo=False, con_minimo=False,
                         inactivos=False) -> list:
        """Los filtros de la lista, iguales para la página y para el total: si se
        aplicaran sólo a uno, el «Mostrando 50 de 4.000» mentiría."""
        filtros = []
        for t in tokens(search):
            filtros.append(or_(
                _contiene(Pieza.cod_pieza, t),
                # «YG008» encuentra «YG 008»: el viejo tiene 218 códigos con un espacio
                # adentro y nadie lo tipea.
                _contiene(func.replace(Pieza.cod_pieza, " ", ""), t),
                _contiene(Pieza.descripcion, t),
            ))
        if tipo == "insumo_desc":
            # Sin clasificar (NULL, lo anterior a la importación) se trata como
            # descripción libre en todos lados: también acá.
            filtros.append(or_(Pieza.tipo == "insumo_desc", Pieza.tipo.is_(None),
                               Pieza.tipo.not_in(TIPOS_INSUMO)))
        elif tipo:
            filtros.append(Pieza.tipo == tipo)
        if id_material is not None:
            filtros.append(Pieza.id_material == id_material)
        if id_formato is not None:
            filtros.append(Pieza.id_formato == id_formato)
        if con_stock:
            filtros.append(Pieza.stockactual > 0)
        if con_minimo:
            filtros.append(Pieza.stock_minimo.isnot(None))
        if bajo_minimo:
            filtros.append(Pieza.bajo_minimo)
        if not inactivos:
            filtros.append(func.coalesce(Pieza.inactivo, 0) == 0)
        return filtros

    @staticmethod
    def _con_nombres(consulta):
        """La pieza con los nombres que muestra la fila, por outer join (una pieza sin
        material, sin formato o sin proveedor preferido igual sale)."""
        return (
            consulta
            .outerjoin(Material, Material.id == Pieza.id_material)
            .outerjoin(MaterialCalidad, MaterialCalidad.id == Pieza.id_calidad)
            .outerjoin(Formato, Formato.id == Pieza.id_formato)
            .outerjoin(Proveedor, Proveedor.id == Pieza.id_proveedor)
        )

    _COLUMNAS_NOMBRES = (
        Material.nombre.label("material"),
        MaterialCalidad.nombre.label("calidad"),
        Formato.nombre.label("formato"),
        Proveedor.razon_social.label("proveedor"),
    )

    async def pagina_insumos(self, page: int, size: int, **filtros_pedidos):
        """(filas, total). Cada fila: (Pieza, material, calidad, formato, proveedor).
        Orden: código normalizado (un código con espacio adelante no va primero)."""
        filtros = self._filtros_insumos(**filtros_pedidos)
        total = (await self.db.execute(
            select(func.count()).select_from(Pieza).where(*filtros)
        )).scalar() or 0
        filas = (await self.db.execute(
            self._con_nombres(select(Pieza, *self._COLUMNAS_NOMBRES))
            .where(*filtros)
            .order_by(CODIGO_NORM, Pieza.id)
            .offset((page - 1) * size)
            .limit(size)
        )).all()
        return filas, total

    async def insumo_con_nombres(self, id_pieza: int):
        """(Pieza, material, calidad, formato, proveedor) o None."""
        return (await self.db.execute(
            self._con_nombres(select(Pieza, *self._COLUMNAS_NOMBRES))
            .where(Pieza.id == id_pieza)
        )).first()

    async def pieza(self, id_pieza: int):
        return await self.db.get(Pieza, id_pieza)

    # ─────────────────────────── insumos: código y duplicados ───────────────────────────

    async def codigos_con_prefijo(self, prefijo: str) -> list[str]:
        """Los códigos (normalizados) que empiezan con el prefijo. La regla de cuál sigue
        (reglas.siguiente_codigo) se queda sólo con los de «prefijo + dígitos»."""
        return list((await self.db.execute(
            select(CODIGO_NORM).where(CODIGO_NORM.startswith(prefijo.upper(), autoescape=True))
        )).scalars().all())

    async def pieza_con_codigo(self, codigo_norm: str, excluir_id: int | None = None):
        consulta = select(Pieza).where(CODIGO_NORM == codigo_norm)
        if excluir_id is not None:
            consulta = consulta.where(Pieza.id != excluir_id)
        return (await self.db.execute(consulta.order_by(Pieza.id).limit(1))).scalars().first()

    async def activas_con_descripcion(self, descripcion: str, excluir_id: int | None = None):
        """Insumos ACTIVOS con la misma descripción normalizada (mayúsculas, espacios
        simples): [(id, código, descripción)].

        Normalizar espacios en SQL no es portable (regexp_replace no existe en SQLite),
        así que se busca en dos pasos: la base trae las que contienen todas las palabras
        (ILIKE, cualquier cantidad de espacios en el medio) y acá se compara exacto.
        """
        clave = norm_desc(descripcion)
        if not clave:
            return []
        consulta = select(Pieza.id, Pieza.cod_pieza, Pieza.descripcion).where(
            func.coalesce(Pieza.inactivo, 0) == 0,
            *[_contiene(Pieza.descripcion, t) for t in clave.split(" ")[:12]],
        )
        if excluir_id is not None:
            consulta = consulta.where(Pieza.id != excluir_id)
        filas = (await self.db.execute(consulta.order_by(CODIGO_NORM, Pieza.id))).all()
        return [f for f in filas if norm_desc(f.descripcion) == clave][:MAX_DUPLICADOS]

    # ─────────────────────────── insumos: usos ───────────────────────────

    async def usos(self, id_pieza: int) -> dict:
        """Dónde aparece la pieza, en UNA consulta: lo que decide si se puede borrar.

        Los precios cargados a mano ('manual') no cuentan como uso: son de SPMM y se van
        con la pieza. Los de factura ('compra') y los importados sí: dicen que el código
        está en facturas del viejo.
        """
        def contar(expr, *condiciones):
            return select(func.count(expr)).where(*condiciones).scalar_subquery()

        fila = (await self.db.execute(select(
            contar(OrdenTrabajoPieza.id, OrdenTrabajoPieza.id_pieza == id_pieza).label("lineas"),
            contar(distinct(OrdenTrabajoPieza.id_orden_trabajo),
                   OrdenTrabajoPieza.id_pieza == id_pieza).label("ots"),
            contar(PiezaMovimiento.id, PiezaMovimiento.id_pieza == id_pieza).label("movimientos"),
            contar(PiezaPrecio.id, PiezaPrecio.id_pieza == id_pieza,
                   PiezaPrecio.origen != "manual").label("precios"),
            contar(PiezaRecorte.id, PiezaRecorte.id_pieza == id_pieza).label("recortes"),
            contar(ConsumoMaterial.id, ConsumoMaterial.id_pieza == id_pieza).label("consumos"),
        ))).one()
        return dict(fila._mapping)

    async def cantidad_de_ots(self, id_pieza: int) -> int:
        return (await self.db.execute(
            select(func.count(distinct(OrdenTrabajoPieza.id_orden_trabajo)))
            .where(OrdenTrabajoPieza.id_pieza == id_pieza)
        )).scalar() or 0

    async def borrar_pieza(self, pieza) -> None:
        """Borra la pieza y sus precios cargados a mano (lo único que puede tener si
        `usos` dio todo en cero)."""
        await self.db.execute(
            delete(PiezaPrecio).where(PiezaPrecio.id_pieza == pieza.id)
        )
        await self.db.delete(pieza)
        await self.db.flush()

    # ─────────────────────────── OT ───────────────────────────

    async def ot_por_numero(self, numero: int):
        """La OT por el número que ve la gente (id_otvieja)."""
        return (await self.db.execute(
            select(OrdenTrabajo).where(OrdenTrabajo.id_otvieja == numero)
            .order_by(OrdenTrabajo.id).limit(1)
        )).scalars().first()

    async def numero_de_ot(self, id_orden_trabajo):
        if id_orden_trabajo is None:
            return None
        return (await self.db.execute(
            select(OrdenTrabajo.id_otvieja).where(OrdenTrabajo.id == id_orden_trabajo)
        )).scalar()

    # ─────────────────────────── stock ───────────────────────────

    async def movimientos_de(self, id_pieza: int):
        """[(PiezaMovimiento, número de OT)] del más viejo al más nuevo (el saldo se
        acumula en ese orden)."""
        return (await self.db.execute(
            select(PiezaMovimiento, OrdenTrabajo.id_otvieja)
            .outerjoin(OrdenTrabajo, OrdenTrabajo.id == PiezaMovimiento.id_orden_trabajo)
            .where(PiezaMovimiento.id_pieza == id_pieza)
            .order_by(PiezaMovimiento.fecha, PiezaMovimiento.id)
        )).all()

    async def reservas_de(self, id_pieza: int):
        """Las reservas VIGENTES de la pieza (reservada, usada y todavía sin retirar): el
        mismo criterio con que stock.stock_de suma el reservado. Un test compara la suma
        de esta lista con ese número."""
        return (await self.db.execute(
            select(OrdenTrabajoPieza.id, OrdenTrabajoPieza.id_orden_trabajo,
                   OrdenTrabajo.id_otvieja, OrdenTrabajoPieza.cantidad_reservada)
            .outerjoin(OrdenTrabajo, OrdenTrabajo.id == OrdenTrabajoPieza.id_orden_trabajo)
            .where(
                OrdenTrabajoPieza.id_pieza == id_pieza,
                OrdenTrabajoPieza.reserva == 1,
                OrdenTrabajoPieza.usado == 1,
                func.coalesce(OrdenTrabajoPieza.disponible, 0) == 0,
                OrdenTrabajoPieza.cantidad_reservada.isnot(None),
            )
            .order_by(OrdenTrabajo.id_otvieja, OrdenTrabajoPieza.id)
        )).all()

    async def movimiento(self, id_movimiento: int):
        return await self.db.get(PiezaMovimiento, id_movimiento)

    # ─────────────────────────── recortes ───────────────────────────

    async def recortes_de(self, id_pieza: int):
        """[(PiezaRecorte, número de OT de uso)]: los disponibles primero, y entre ellos
        los más largos (el que sirve para más); después los usados y descartados, los
        últimos arriba."""
        return (await self.db.execute(
            select(PiezaRecorte, OrdenTrabajo.id_otvieja)
            .outerjoin(OrdenTrabajo, OrdenTrabajo.id == PiezaRecorte.id_orden_trabajo_uso)
            .where(PiezaRecorte.id_pieza == id_pieza)
            .order_by(
                case((PiezaRecorte.estado == "disponible", 0), else_=1),
                case((and_(PiezaRecorte.estado == "disponible",
                           PiezaRecorte.largo_mm.isnot(None)), 0), else_=1),
                case((PiezaRecorte.estado == "disponible", -PiezaRecorte.largo_mm), else_=None),
                PiezaRecorte.id.desc(),
            )
        )).all()

    async def recorte(self, id_recorte: int):
        return await self.db.get(PiezaRecorte, id_recorte)

    # ─────────────────────────── OT donde se usó y precios ───────────────────────────

    async def ots_de(self, id_pieza: int, limit: int):
        """Las líneas de OT de la pieza con su OT, las más nuevas primero."""
        return (await self.db.execute(
            select(
                OrdenTrabajoPieza.id.label("id_linea"),
                OrdenTrabajoPieza.id_orden_trabajo,
                OrdenTrabajo.id_otvieja,
                OrdenTrabajo.fecha_orden,
                Cliente.nombre.label("cliente"),
                Articulo.descripcion.label("articulo"),
                OrdenTrabajoPieza.cantidad,
                OrdenTrabajoPieza.unidad,
                OrdenTrabajoPieza.pedido,
                OrdenTrabajoPieza.disponible,
                OrdenTrabajoPieza.usado,
                OrdenTrabajoPieza.reserva,
                OrdenTrabajoPieza.cantidad_reservada,
                OrdenTrabajo.finalizadototal,
            )
            .join(OrdenTrabajo, OrdenTrabajo.id == OrdenTrabajoPieza.id_orden_trabajo)
            .outerjoin(Cliente, Cliente.id == OrdenTrabajo.id_cliente)
            .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
            .where(OrdenTrabajoPieza.id_pieza == id_pieza)
            .order_by(OrdenTrabajo.fecha_orden.desc(), OrdenTrabajo.id.desc(),
                      OrdenTrabajoPieza.id)
            .limit(limit)
        )).all()

    async def precios_de(self, id_pieza: int):
        """[(PiezaPrecio, razón social del proveedor)], el más nuevo primero."""
        return (await self.db.execute(
            select(PiezaPrecio, Proveedor.razon_social)
            .outerjoin(Proveedor, Proveedor.id == PiezaPrecio.id_proveedor)
            .where(PiezaPrecio.id_pieza == id_pieza)
            .order_by(PiezaPrecio.fecha.desc(), PiezaPrecio.id.desc())
        )).all()
