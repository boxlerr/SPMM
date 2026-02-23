from sqlalchemy import select
from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class OperarioProcesoSkillRepository:
    """
    Repositorio asincrónico para la gestión de habilidades de operarios por proceso.
    """
    def __init__(self, db):
        self.db = db

    async def get_map_por_proceso(self):
        """
        Devuelve un mapa anidado con la estructura:
        {
          proceso_id: { operario_id: nivel }
        }
        Filtra únicamente los registros donde habilitado = True.
        """
        try:
            logger.info("Repository - Obteniendo mapa de habilidades por proceso.")
            
            # Consulta filtrando por habilitados
            stmt = select(OperarioProcesoSkill).where(OperarioProcesoSkill.habilitado == True)
            result = await self.db.execute(stmt)
            skills = result.scalars().all()
            
            mapping = {}
            for s in skills:
                if s.id_proceso not in mapping:
                    mapping[s.id_proceso] = {}
                mapping[s.id_proceso][s.id_operario] = s.nivel
            
            logger.info(f"Repository - Mapa generado. Procesos encontrados: {len(mapping)}")
            return mapping

        except Exception as e:
            logger.error(f"Repository - Error en get_map_por_proceso: {e}")
            raise InfrastructureException("Error al consultar el mapa de habilidades de operarios.") from e

    async def save(self, skill: OperarioProcesoSkill):
        """
        Guarda o actualiza una habilidad de operario.
        """
        try:
            self.db.add(skill)
            await self.db.commit()
            await self.db.refresh(skill)
            return skill
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al guardar OperarioProcesoSkill: {e}")
            raise InfrastructureException("Error al guardar la habilidad del operario.") from e
