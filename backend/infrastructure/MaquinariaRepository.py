from sqlalchemy import select
from sqlalchemy.orm import joinedload

from backend.domain.Maquinaria import Maquinaria
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class MaquinariaRepository:
    """
    Repositorio asincrónico de `Maquinaria`.
    Maneja transacciones usando AsyncSession y errores con InfrastructureException.
    """

    def __init__(self, db):
        self.db = db

    async def find_by_id(self, id: int):
        try:
            result = await self.db.execute(select(Maquinaria).where(Maquinaria.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error al buscar Maquinaria {id}: {e}")
            raise InfrastructureException("Error al buscar la Maquinaria por ID.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todas las maquinarias desde la base de datos.")
            result = await self.db.execute(select(Maquinaria))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros)")
            return data
        except Exception as e:
            logger.error(f"Repository - Error al listar Maquinarias: {e}")
            raise InfrastructureException("Error al listar Maquinarias.") from e

    async def save(self, maquinaria: Maquinaria):
        try:
            self.db.add(maquinaria)
            await self.db.commit()
            await self.db.refresh(maquinaria)
            return maquinaria
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al guardar Maquinaria: {e}")
            raise InfrastructureException("Error al guardar una Maquinaria.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            result = await self.db.execute(select(Maquinaria).where(Maquinaria.id == id))
            maquinaria = result.scalar_one_or_none()
            if not maquinaria:
                logger.info(f"Repository - Maquinaria {id} no encontrada para actualizar.")
                return None

            # Solo campos válidos del modelo
            campos_validos = {"nombre", "cod_maquina", "limitacion", "capacidad", "especialidad"}
            for key, value in nueva_data.items():
                if key in campos_validos:
                    setattr(maquinaria, key, value)

            await self.db.commit()
            await self.db.refresh(maquinaria)
            logger.info(f"Repository - Maquinaria {id} actualizada correctamente.")
            return maquinaria

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al actualizar Maquinaria {id}: {e}")
            raise InfrastructureException("Error al actualizar la Maquinaria.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Inicio DELETE maquinaria id={id}")
            result = await self.db.execute(select(Maquinaria).where(Maquinaria.id == id))
            maquinaria = result.scalar_one_or_none()

            if not maquinaria:
                logger.info("Repository - Maquinaria no encontrada.")
                return False

            await self.db.delete(maquinaria)
            await self.db.commit()
            logger.info(f"Repository - Maquinaria {id} eliminada correctamente.")
            return True

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al eliminar Maquinaria {id}: {e}")
            raise InfrastructureException("Error al eliminar la Maquinaria.") from e

    async def find_with_rangos(self):
        try:
            logger.info("Repository - Obtener maquinarias con sus rangos asociados.")
            result = await self.db.execute(
                select(Maquinaria).options(joinedload(Maquinaria.rango_maquinarias))
            )
            data = result.unique().scalars().all()  # ✅ NO pierde rangos, solo agrupa bien

            logger.info(f"Repository - Resultado OK ({len(data)} maquinarias con rangos)")
            return data
        except Exception as e:
            logger.error(f"Repository - Error al listar Maquinarias con rangos: {e}")
            raise InfrastructureException("Error al listar Maquinarias con rangos.") from e