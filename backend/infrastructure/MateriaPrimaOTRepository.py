"""Lectura y escritura de las materias primas de la OT (orden_trabajo_pieza y sus cortes).

Todo por el ORM y nada en SQL de dialecto: los tests corren sobre SQLite y lo que no se
puede probar ahí no se puede cuidar. Usa la sesión que le llega del endpoint y no abre
ninguna propia (el pooler de Supabase admite 15 conexiones para TODO el proyecto).

EL COMMIT LO DECIDE EL SERVICIO

Una operación de la solapa toca varias cosas a la vez: marcar disponible una línea
reservada cambia la línea, crea el egreso de stock y recalcula el caché de la pieza
(application/materia_prima/stock.py). Las tres quedan o ninguna. Por eso acá no hay
commit escondido en cada escritura: el servicio hace todo con flush y al final llama a
`confirmar()` (o a `deshacer()` si algo no se pudo).

SIN N+1

La pantalla de Pendientes trae ~900 líneas de ~220 OT. Todo lo que se lee de a muchas
(las líneas con su pieza, los cortes) va en una consulta por tanda de ids, nunca una por
línea.
"""
from collections import defaultdict

from sqlalchemy import delete, func, select

from backend.application.materia_prima.stock import en_tandas
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.OrdenTrabajoPiezaCorte import OrdenTrabajoPiezaCorte
from backend.domain.Pieza import Pieza
from backend.domain.Proveedor import Proveedor

# El orden de las líneas dentro de una OT: el de carga (`orden`) y, a igualdad, el id.
# Las filas de antes de la importación no tienen `orden` (NULL): salen PRIMERO, por id,
# que es el orden en que se cargaron; las nuevas reciben max + 1 y van después.
ORDEN_LINEAS = (func.coalesce(OrdenTrabajoPieza.orden, 0), OrdenTrabajoPieza.id)


class MateriaPrimaOTRepository:
    def __init__(self, db):
        self.db = db

    # ─────────────────────────── transacción ───────────────────────────

    async def confirmar(self) -> None:
        try:
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al guardar materias primas de la OT: {e}")
            raise InfrastructureException("Error al guardar las materias primas de la OT.") from e

    async def deshacer(self) -> None:
        try:
            await self.db.rollback()
        except Exception as e:  # un rollback que falla no puede tapar el error original
            logger.warning(f"Repository - No se pudo deshacer: {e}")

    # ─────────────────────────── OT ───────────────────────────

    async def ot(self, id_orden_trabajo: int) -> OrdenTrabajo | None:
        return await self.db.get(OrdenTrabajo, id_orden_trabajo)

    async def ots(self, ids_ot) -> dict[int, OrdenTrabajo]:
        resultado: dict[int, OrdenTrabajo] = {}
        for tanda in en_tandas(ids_ot):
            filas = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id.in_(tanda)))
            for orden in filas.scalars().all():
                resultado[orden.id] = orden
        return resultado

    async def ot_origen_historial(self, id_articulo: int, excluir_id: int | None) -> OrdenTrabajo | None:
        """La OT más reciente (por fecha_orden, luego id) del mismo artículo, distinta de
        `excluir_id`, que tenga alguna línea que se usa (usado = 1). Mismo criterio que el
        «Traer historial» de procesos (OrdenTrabajoRepository.obtener_historial_procesos),
        pero mirando las materias primas."""
        con_lineas = (
            select(OrdenTrabajoPieza.id_orden_trabajo)
            .where(func.coalesce(OrdenTrabajoPieza.usado, 1) == 1)
            .distinct()
        )
        # NULLS LAST explícito: en Postgres un DESC pone los NULL PRIMERO (en SQLite, al
        # final), y una OT sin fecha pasaría por «la más reciente» sólo en producción.
        consulta = (
            select(OrdenTrabajo)
            .where(OrdenTrabajo.id_articulo == id_articulo, OrdenTrabajo.id.in_(con_lineas))
            .order_by(OrdenTrabajo.fecha_orden.desc().nulls_last(), OrdenTrabajo.id.desc())
            .limit(1)
        )
        if excluir_id is not None:
            consulta = consulta.where(OrdenTrabajo.id != excluir_id)
        return (await self.db.execute(consulta)).scalars().first()

    # ─────────────────────────── líneas ───────────────────────────

    async def linea(self, id_linea: int) -> OrdenTrabajoPieza | None:
        return await self.db.get(OrdenTrabajoPieza, id_linea)

    async def lineas(self, ids_linea) -> dict[int, OrdenTrabajoPieza]:
        resultado: dict[int, OrdenTrabajoPieza] = {}
        for tanda in en_tandas(ids_linea):
            filas = await self.db.execute(
                select(OrdenTrabajoPieza).where(OrdenTrabajoPieza.id.in_(tanda))
            )
            for linea in filas.scalars().all():
                resultado[linea.id] = linea
        return resultado

    async def lineas_con_pieza(self, *, ids_ot=None, ids_linea=None, solo_usadas: bool = False):
        """Las líneas con lo que se muestra de su insumo, en orden de carga dentro de cada
        OT: [(línea, código, descripción de la pieza, tipo, precio, unidad de la pieza,
        nombre del proveedor del catálogo)].

        `populate_existing`: si la línea ya está en la sesión (el servicio la acaba de
        cambiar), se relee de la base y no se devuelve la copia en memoria. Lo que ve la
        pantalla es lo que quedó guardado.
        """
        if ids_ot is None and ids_linea is None:
            return []
        columna = OrdenTrabajoPieza.id_orden_trabajo if ids_ot is not None else OrdenTrabajoPieza.id
        ids = ids_ot if ids_ot is not None else ids_linea
        resultado = []
        for tanda in en_tandas(ids):
            consulta = (
                select(OrdenTrabajoPieza, Pieza.cod_pieza, Pieza.descripcion, Pieza.tipo,
                       Pieza.unitario, Pieza.unidad, Proveedor.razon_social)
                .join(Pieza, Pieza.id == OrdenTrabajoPieza.id_pieza)
                .outerjoin(Proveedor, Proveedor.id == OrdenTrabajoPieza.id_proveedor)
                .where(columna.in_(tanda))
                .order_by(OrdenTrabajoPieza.id_orden_trabajo, *ORDEN_LINEAS)
                .execution_options(populate_existing=True)
            )
            if solo_usadas:
                consulta = consulta.where(func.coalesce(OrdenTrabajoPieza.usado, 1) == 1)
            resultado.extend((await self.db.execute(consulta)).all())
        return resultado

    async def siguiente_orden(self, id_orden_trabajo: int) -> int:
        """El `orden` que le toca a la próxima línea de la OT: el mayor + 1."""
        maximo = (await self.db.execute(
            select(func.max(OrdenTrabajoPieza.orden))
            .where(OrdenTrabajoPieza.id_orden_trabajo == id_orden_trabajo)
        )).scalar()
        return int(maximo or 0) + 1

    async def agregar(self, objeto) -> None:
        self.db.add(objeto)
        await self.db.flush()

    async def borrar_linea(self, linea: OrdenTrabajoPieza) -> None:
        """Borra la línea y sus cortes. Los cortes se van también por el CASCADE de la FK,
        pero se borran a mano para no depender de que la base lo tenga (mismo criterio que
        el borrado de la OT). Los consumos NO se tocan: tienen su id_pieza y su OT, y lo
        que se consumió no deja de haberse consumido porque se borre la línea."""
        await self.db.execute(
            delete(OrdenTrabajoPiezaCorte)
            .where(OrdenTrabajoPiezaCorte.id_orden_trabajo_pieza == linea.id)
            .execution_options(synchronize_session=False)
        )
        await self.db.delete(linea)
        await self.db.flush()

    # ─────────────────────────── cortes ───────────────────────────

    async def cortes_de_lineas(self, ids_linea) -> dict[int, list[OrdenTrabajoPiezaCorte]]:
        """{id_línea: [cortes en su orden]}. Sólo las líneas que tienen alguno."""
        resultado: dict[int, list[OrdenTrabajoPiezaCorte]] = defaultdict(list)
        for tanda in en_tandas(ids_linea):
            filas = await self.db.execute(
                select(OrdenTrabajoPiezaCorte)
                .where(OrdenTrabajoPiezaCorte.id_orden_trabajo_pieza.in_(tanda))
                .order_by(OrdenTrabajoPiezaCorte.id_orden_trabajo_pieza,
                          func.coalesce(OrdenTrabajoPiezaCorte.orden, 0),
                          OrdenTrabajoPiezaCorte.id)
                .execution_options(populate_existing=True)
            )
            for corte in filas.scalars().all():
                resultado[corte.id_orden_trabajo_pieza].append(corte)
        return dict(resultado)

    async def borrar_cortes(self, id_linea: int) -> None:
        await self.db.execute(
            delete(OrdenTrabajoPiezaCorte)
            .where(OrdenTrabajoPiezaCorte.id_orden_trabajo_pieza == id_linea)
            .execution_options(synchronize_session=False)
        )

    # ─────────────────────────── catálogo ───────────────────────────

    async def piezas(self, ids_pieza) -> dict[int, Pieza]:
        resultado: dict[int, Pieza] = {}
        for tanda in en_tandas(ids_pieza):
            filas = await self.db.execute(select(Pieza).where(Pieza.id.in_(tanda)))
            for pieza in filas.scalars().all():
                resultado[pieza.id] = pieza
        return resultado

    async def proveedores(self, ids_proveedor) -> dict[int, Proveedor]:
        resultado: dict[int, Proveedor] = {}
        for tanda in en_tandas(ids_proveedor):
            filas = await self.db.execute(select(Proveedor).where(Proveedor.id.in_(tanda)))
            for proveedor in filas.scalars().all():
                resultado[proveedor.id] = proveedor
        return resultado

    # ─────────────────────────── consumos ───────────────────────────

    async def consumos_de_linea(self, id_linea: int) -> tuple[int, float]:
        """(cuántos consumos no anulados tiene la línea, cuánto suman)."""
        cuantos, total = (await self.db.execute(
            select(func.count(ConsumoMaterial.id), func.coalesce(func.sum(ConsumoMaterial.cantidad), 0))
            .where(ConsumoMaterial.id_orden_trabajo_pieza == id_linea, ConsumoMaterial.anulado == 0)
        )).one()
        return int(cuantos or 0), float(total or 0)
