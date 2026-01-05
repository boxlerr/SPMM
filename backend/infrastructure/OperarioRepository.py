from sqlalchemy import select, delete
from sqlalchemy.orm import joinedload, selectinload

from backend.domain.Operario import Operario
from backend.domain.OperarioRango import OperarioRango

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class OperarioRepository:
    """
    Repositorio asincrónico de `Operario`.
    Maneja transacciones usando AsyncSession y errores con InfrastructureException.
    """

    def __init__(self, db):
        self.db = db

    async def find_by_id(self, id: int):
        try:
            result = await self.db.execute(select(Operario).where(Operario.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error al buscar Operario {id}: {e}")
            raise InfrastructureException("Error al buscar el Operario por ID.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los operarios desde la base de datos.")
            result = await self.db.execute(
                select(Operario).options(selectinload(Operario.rangos))
            )
            data = result.scalars().unique().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros)")
            return data
        except Exception as e:
            logger.error(f"Repository - Error al listar Operarios: {e}")
            raise InfrastructureException("Error al listar Operarios.") from e

    async def save(self, operario: Operario):
        try:
            self.db.add(operario)
            await self.db.commit()
            await self.db.refresh(operario)
            return operario
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al guardar Operario: {e}")
            raise InfrastructureException("Error al guardar un Operario.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            result = await self.db.execute(select(Operario).where(Operario.id == id))
            operario = result.scalar_one_or_none()
            if not operario:
                logger.info(f"Repository - Operario {id} no encontrado para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(operario, key, value)

            await self.db.commit()
            await self.db.refresh(operario)
            logger.info(f"Repository - Operario {id} actualizado correctamente.")
            return operario

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al actualizar Operario {id}: {e}")
            raise InfrastructureException("Error al actualizar el Operario.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Inicio DELETE operario id={id}")
            result = await self.db.execute(select(Operario).where(Operario.id == id))
            operario = result.scalar_one_or_none()

            if not operario:
                logger.info("Repository - Operario no encontrado.")
                return False

            # Eliminar relaciones en operario_rango previamente
            await self.db.execute(delete(OperarioRango).where(OperarioRango.id_operario == id))

            await self.db.delete(operario)
            await self.db.commit()
            logger.info(f"Repository - Operario {id} eliminado correctamente.")
            return True

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al eliminar Operario {id}: {e}")
            raise InfrastructureException("Error al eliminar el Operario.") from e

    async def find_with_rangos(self):
        """
        Devuelve una lista de tuplas (id_operario, id_rango)
        """
        try:
            result = await self.db.execute(
                select(OperarioRango).options(joinedload(OperarioRango.operario))
            )
            relaciones = result.scalars().all()
            return [(r.id_operario, r.id_rango) for r in relaciones]

        except Exception as e:
            print(f"Error en find_with_rangos: {e}")
            raise