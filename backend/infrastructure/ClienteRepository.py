from sqlalchemy import select
from backend.domain.Cliente import Cliente
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class ClienteRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, cliente: Cliente):
        try:
            logger.info("Repository - Crear Cliente.")
            self.db.add(cliente)
            await self.db.commit()
            await self.db.refresh(cliente)
            logger.info("Repository - Crear Cliente OK.")
            return cliente
        except Exception as e:
            logger.error(f"Repository - Error real en save: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar el Cliente.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los clientes.")
            result = await self.db.execute(select(Cliente))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar los Clientes.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar cliente por ID {id}.")
            result = await self.db.execute(select(Cliente).where(Cliente.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar el Cliente por ID.") from e
