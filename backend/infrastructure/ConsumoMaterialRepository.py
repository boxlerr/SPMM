from sqlalchemy import select

from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.Pieza import Pieza
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class ConsumoMaterialRepository:
    """Lectura y escritura de `consumo_material` (RF-15).

    Todo por el ORM y nada en SQL de dialecto: los tests corren sobre SQLite y lo que no
    se puede probar ahí no se puede cuidar.

    Usa la sesión que le llega del endpoint y no abre ninguna propia: el pooler de
    Supabase admite 15 conexiones para TODO el proyecto.
    """

    def __init__(self, db):
        self.db = db

    async def save(self, consumo: ConsumoMaterial) -> ConsumoMaterial:
        try:
            logger.info("Repository - Registrar ConsumoMaterial.")
            self.db.add(consumo)
            await self.db.commit()
            await self.db.refresh(consumo)
            logger.info(f"Repository - ConsumoMaterial {consumo.id} registrado.")
            return consumo
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en save ConsumoMaterial: {e}")
            raise InfrastructureException("Error al registrar el consumo de material.") from e

    async def guardar_cambios(self, consumo: ConsumoMaterial) -> ConsumoMaterial:
        """Confirma lo que el servicio ya le cambió al objeto (la anulación)."""
        try:
            await self.db.commit()
            await self.db.refresh(consumo)
            return consumo
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real al actualizar ConsumoMaterial: {e}")
            raise InfrastructureException("Error al anular el consumo de material.") from e

    async def find_by_id(self, id_consumo: int) -> ConsumoMaterial | None:
        try:
            result = await self.db.execute(
                select(ConsumoMaterial).where(ConsumoMaterial.id == id_consumo)
            )
            return result.scalars().first()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id ConsumoMaterial: {e}")
            raise InfrastructureException("Error al buscar el consumo de material.") from e

    async def find_by_orden_trabajo(self, id_orden_trabajo: int) -> list[dict]:
        """Los consumos de una OT, lo último primero, con el código y la descripción.

        Trae también los anulados (marcados): la pantalla los muestra tachados, que es
        justamente para lo que se anulan en vez de borrarse. LEFT JOIN a pieza por las
        dudas, aunque la FK garantice que está: un consumo no puede desaparecer de la
        lista porque falte un dato de catálogo.
        """
        try:
            logger.info(f"Repository - Consumos de material de la OT {id_orden_trabajo}.")
            query = (
                select(
                    ConsumoMaterial,
                    Pieza.cod_pieza,
                    Pieza.descripcion,
                )
                .outerjoin(Pieza, Pieza.id == ConsumoMaterial.id_pieza)
                .where(ConsumoMaterial.id_orden_trabajo == id_orden_trabajo)
                .order_by(ConsumoMaterial.fecha.desc(), ConsumoMaterial.id.desc())
            )
            filas = (await self.db.execute(query)).all()
            return [
                {"consumo": consumo, "cod_pieza": cod, "descripcion": desc}
                for consumo, cod, desc in filas
            ]
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_orden_trabajo ConsumoMaterial: {e}")
            raise InfrastructureException("Error al leer el consumo de material de la orden.") from e

    # ------------------------------------------------------------------
    # Lo que el servicio necesita mirar antes de registrar
    # ------------------------------------------------------------------

    async def existe_orden(self, id_orden_trabajo: int) -> bool:
        try:
            result = await self.db.execute(
                select(OrdenTrabajo.id).where(OrdenTrabajo.id == id_orden_trabajo)
            )
            return result.scalar_one_or_none() is not None
        except Exception as e:
            logger.error(f"Repository - Error real en existe_orden: {e}")
            raise InfrastructureException("Error al buscar la orden de trabajo.") from e

    async def find_linea(self, id_orden_trabajo_pieza: int) -> OrdenTrabajoPieza | None:
        try:
            result = await self.db.execute(
                select(OrdenTrabajoPieza).where(OrdenTrabajoPieza.id == id_orden_trabajo_pieza)
            )
            return result.scalars().first()
        except Exception as e:
            logger.error(f"Repository - Error real en find_linea: {e}")
            raise InfrastructureException("Error al buscar la línea de material.") from e

    async def find_pieza(self, id_pieza: int) -> Pieza | None:
        try:
            result = await self.db.execute(select(Pieza).where(Pieza.id == id_pieza))
            return result.scalars().first()
        except Exception as e:
            logger.error(f"Repository - Error real en find_pieza: {e}")
            raise InfrastructureException("Error al buscar la pieza.") from e
