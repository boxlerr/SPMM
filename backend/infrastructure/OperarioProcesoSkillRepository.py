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
        Filtra únicamente los registros habilitados y de nivel 1/2 (skills cargadas
        manualmente). Las nivel 0 (nativas, derivadas del rango) NO entran al mapa:
        no deben disparar el modo skill-map del planificador — pertenecen al camino
        rango. Su desactivación se maneja por separado (get_nativas_deshabilitadas).
        """
        try:
            logger.info("Repository - Obteniendo mapa de habilidades por proceso.")

            # Consulta: solo habilitadas y de nivel 1/2 (excluye nativas nivel 0)
            stmt = select(OperarioProcesoSkill).where(
                OperarioProcesoSkill.habilitado == True,
                OperarioProcesoSkill.nivel.in_([1, 2]),
            )
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

    async def get_nativas_deshabilitadas(self):
        """
        Devuelve las skills nativas (nivel 0) que fueron explícitamente desactivadas:
        {
          proceso_id: { operario_id, ... }
        }
        Son filas persistidas con nivel = 0 AND habilitado = False, usadas como
        "marca de nativa desactivada". El planificador las resta del set de operarios
        válidos en el camino rango.
        """
        try:
            stmt = select(OperarioProcesoSkill).where(
                OperarioProcesoSkill.nivel == 0,
                OperarioProcesoSkill.habilitado == False,
            )
            result = await self.db.execute(stmt)
            skills = result.scalars().all()

            mapping = {}
            for s in skills:
                mapping.setdefault(s.id_proceso, set()).add(s.id_operario)

            logger.info(f"Repository - Nativas desactivadas. Procesos afectados: {len(mapping)}")
            return mapping

        except Exception as e:
            logger.error(f"Repository - Error en get_nativas_deshabilitadas: {e}")
            raise InfrastructureException("Error al consultar las nativas desactivadas.") from e

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
