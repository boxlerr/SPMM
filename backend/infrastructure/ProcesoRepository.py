"""from sqlalchemy import select,delete
from backend.domain.Proceso import Proceso
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class ProcesoRepository:
    def __init__(self,db):
        #self.db = SessionLocal()
        self.db = db

    def save(self, proceso: Proceso):
        try:
            self.db.add(proceso)
            self.db.commit()
            self.db.refresh(proceso)
            return proceso
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un Proceso.") from e

    # 🔹 Nuevo: Obtener todos los procesos
    async def find_all2(self):
        try:
            #return await self.db.query(Proceso).all()
            logger.info(f"Repository - Obtener de base de datos.")
            result = await self.db.execute(select(Proceso))
            logger.info(f"Repository - Resultado: {result}")
            return result.scalars().all()
        
        except Exception as e:
            raise InfrastructureException("Error al listar Procesos.") from e
        
    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los procesos desde la base de datos.")
            result = await self.db.execute(select(Proceso))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros)")
            return data
        except Exception as e:
            logger.error(f"Error real en find_all: {e}")
            raise InfrastructureException("Error al listar Procesos.") from e

    # 🔹 Nuevo: Buscar un proceso por ID
    def find_by_id(self, id: int):
        try:
            return self.db.query(Proceso).filter(Proceso.id == id).first()
        except Exception as e:
            raise InfrastructureException("Error al buscar el Proceso por ID.") from e

    # 🔹 Nuevo: Actualizar un proceso existente
    def update(self, id: int, nueva_data: dict):
        try:
            proceso = self.find_by_id(id)
            if not proceso:
                return None
            for key, value in nueva_data.items():
                setattr(proceso, key, value)
            self.db.commit()
            self.db.refresh(proceso)
            return proceso
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al actualizar el Proceso.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"REPOSITORY - Inicio DELETE proceso id={id}")

            # 🔹 1. Buscar si existe el proceso
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            proceso = result.scalar_one_or_none()

            if not proceso:
                logger.info("REPOSITORY - Proceso no encontrado.")
                return False

            # 🔹 2. Eliminar el proceso encontrado
            logger.info("Repository - eliminacion efectiva.")

            await self.db.delete(proceso)
            await self.db.commit()

            logger.info(f"REPOSITORY - Proceso {id} eliminado correctamente.")
            return True

        except Exception as e:
            logger.info("Repository - haciendo rollback.")

            await self.db.rollback()
            logger.error(f"REPOSITORY - Error al eliminar proceso {id}: {e}")
            raise InfrastructureException("Error al eliminar el Proceso.") from e
        
"""

from sqlalchemy import select, delete
from backend.domain.Proceso import Proceso
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class ProcesoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, proceso: Proceso):
        try:
            self.db.add(proceso)
            await self.db.commit()
            await self.db.refresh(proceso)
            return proceso
        except Exception as e:
            await self.db.rollback()
            raise InfrastructureException("Error al guardar un Proceso.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los procesos desde la base de datos.")
            result = await self.db.execute(select(Proceso))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros)")
            return data
        except Exception as e:
            logger.error(f"Error real en find_all: {e}")
            raise InfrastructureException("Error al listar Procesos.") from e

    async def find_by_id(self, id: int):
        try:
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            raise InfrastructureException("Error al buscar el Proceso por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            proceso = result.scalar_one_or_none()
            if not proceso:
                return None

            for key, value in nueva_data.items():
                setattr(proceso, key, value)

            await self.db.commit()
            await self.db.refresh(proceso)
            return proceso
        except Exception as e:
            await self.db.rollback()
            raise InfrastructureException("Error al actualizar el Proceso.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Inicio DELETE proceso id={id}")

            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            proceso = result.scalar_one_or_none()

            if not proceso:
                logger.info("Repository - Proceso no encontrado.")
                return False

            await self.db.delete(proceso)
            await self.db.commit()
            logger.info(f"Repository - Proceso {id} eliminado correctamente.")
            return True

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al eliminar proceso {id}: {e}")
            raise InfrastructureException("Error al eliminar el Proceso.") from e
