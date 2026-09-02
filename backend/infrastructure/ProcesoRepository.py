
from sqlalchemy import select, delete as sa_delete
from backend.domain.Proceso import Proceso
from backend.commons.exceptions.InfrastructureException import InfrastructureException

from backend.commons.loggers.logger import logger

class ProcesoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, proceso: Proceso):
        try:
            logger.info("Repository - Crear Proceso.")
            self.db.add(proceso)
            await self.db.commit()
            await self.db.refresh(proceso)
            logger.info("Repository - Crear Proceso OK.")
            return proceso
        except Exception as e:
            logger.error(f"Repository - Error real en save: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar el Proceso.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los procesos.")
            result = await self.db.execute(select(Proceso))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar los Procesos.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar proceso por ID {id}.")
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar el Proceso por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar proceso ID {id}.")
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            proceso = result.scalar_one_or_none()
            if not proceso:
                logger.info(f"Repository - Proceso {id} no encontrado para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(proceso, key, value)

            await self.db.commit()
            await self.db.refresh(proceso)
            logger.info(f"Repository - Proceso {id} actualizado correctamente.")
            return proceso
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar el Proceso.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar proceso ID {id}.")
            result = await self.db.execute(select(Proceso).where(Proceso.id == id))
            proceso = result.scalar_one_or_none()

            if not proceso:
                logger.info(f"Repository - Proceso {id} no encontrado para eliminar.")
                return False

            await self.db.delete(proceso)
            await self.db.commit()
            logger.info(f"Repository - Proceso {id} eliminado correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar el Proceso.") from e

    # ── En qué máquinas se hace cada proceso ────────────────────────────────────
    #
    # Vacío no es "no usa máquina": es "todavía no lo cargaron". El planificador lo
    # distingue y sigue deduciendo por nombre cuando no hay filas. Ver la migración
    # 2026-09-02_maquina_en_proceso_catalogo.sql.

    async def set_maquinarias_de_proceso(self, id_proceso: int, ids_maquinaria: list[int]):
        """Reemplaza la lista de máquinas donde se hace un proceso."""
        try:
            from backend.domain.ProcesoMaquinaria import ProcesoMaquinaria

            logger.info(
                f"Repository - Set maquinarias del proceso {id_proceso}: "
                f"{len(ids_maquinaria)} máquinas."
            )
            await self.db.execute(
                sa_delete(ProcesoMaquinaria).where(ProcesoMaquinaria.id_proceso == id_proceso)
            )
            for id_maquinaria in dict.fromkeys(ids_maquinaria):
                self.db.add(ProcesoMaquinaria(id_proceso=id_proceso, id_maquinaria=id_maquinaria))
            await self.db.commit()
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en set_maquinarias_de_proceso: {e}")
            raise InfrastructureException(
                "Error al actualizar las máquinas del proceso."
            ) from e

    async def find_maquinarias_por_proceso(self) -> dict[int, list[int]]:
        """{proceso_id: [maquinaria_id]} de TODOS los procesos que tengan el dato.

        Una sola consulta: el planificador la pide una vez por corrida y necesita el
        mapa entero, no proceso por proceso.
        """
        try:
            from backend.domain.ProcesoMaquinaria import ProcesoMaquinaria

            result = await self.db.execute(
                select(ProcesoMaquinaria.id_proceso, ProcesoMaquinaria.id_maquinaria)
            )
            mapa: dict[int, list[int]] = {}
            for id_proceso, id_maquinaria in result.all():
                mapa.setdefault(id_proceso, []).append(id_maquinaria)
            return mapa
        except Exception as e:
            logger.error(f"Repository - Error en find_maquinarias_por_proceso: {e}")
            raise InfrastructureException(
                "Error al leer las máquinas de los procesos."
            ) from e
