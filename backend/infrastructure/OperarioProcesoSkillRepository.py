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
        Devuelve el mapa de PRIORIDADES por proceso:
        {
          proceso_id: { operario_id: (nivel, orden) }   # nivel ∈ {1, 2}
        }
        `orden` es la posición dentro de la lista de ese nivel (0 = primero =
        más preferido); None cuando la fila no tiene posición asignada.

        Ojo con la semántica: este mapa NO define quién puede hacer el proceso.
        La elegibilidad la dan las skills NATIVAS (rango del operario × rangos del
        proceso); una fila nivel 1/2 solo existe para una nativa y sirve para
        ordenar preferencia dentro de ese conjunto (SKILL 1 antes que SKILL 2, y
        ambas antes que una nativa sin marcar). El planificador lo usa únicamente
        en la función objetivo — ver PlanificacionService._agregar_objetivo.

        Las filas deshabilitadas quedan fuera: una nativa apagada no se asigna, así
        que su prioridad es irrelevante (la exclusión la aporta
        get_nativas_deshabilitadas).
        """
        try:
            logger.info("Repository - Obteniendo mapa de prioridades por proceso.")

            # Solo prioridades vigentes: nivel 1/2 y no desactivadas.
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
                mapping[s.id_proceso][s.id_operario] = (s.nivel, s.orden)

            logger.info(f"Repository - Mapa generado. Procesos encontrados: {len(mapping)}")
            return mapping

        except Exception as e:
            logger.error(f"Repository - Error en get_map_por_proceso: {e}")
            raise InfrastructureException("Error al consultar el mapa de habilidades de operarios.") from e

    async def get_nativas_deshabilitadas(self):
        """
        Devuelve las skills nativas que fueron explícitamente desactivadas:
        {
          proceso_id: { operario_id, ... }
        }
        Son filas persistidas con habilitado = False, usadas como "marca de nativa
        desactivada". El planificador las resta del set de operarios elegibles.

        El filtro es por `habilitado`, sin mirar el nivel: una nativa que quedó
        marcada como SKILL 1/2 y después se desactivó (nivel 1/2 + habilitado False)
        tiene que salir igual del set. Filtrar por nivel == 0 la dejaba adentro y el
        operario seguía siendo asignable pese a estar apagado.
        """
        try:
            stmt = select(OperarioProcesoSkill).where(
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

    async def get_manuales_por_proceso(self):
        """
        Devuelve las habilidades MANUALES vigentes:
        {
          proceso_id: { operario_id, ... }
        }

        Son filas cargadas a mano (manual = True): el operario sabe hacer ese proceso
        aunque su rango no se lo dé. El planificador las SUMA al set de elegibles —es
        el único mecanismo que agrega elegibilidad fuera del rango; `nivel` solo ordena
        preferencia y `habilitado` solo saca—.

        Se filtran las apagadas: una manual desactivada no se asigna, igual que una
        nativa apagada. Sumarla acá y restarla después vía get_nativas_deshabilitadas
        daría el mismo resultado, pero conviene que el mapa diga solo lo vigente.
        """
        try:
            stmt = select(OperarioProcesoSkill).where(
                OperarioProcesoSkill.manual == True,
                OperarioProcesoSkill.habilitado == True,
            )
            result = await self.db.execute(stmt)
            skills = result.scalars().all()

            mapping = {}
            for s in skills:
                mapping.setdefault(s.id_proceso, set()).add(s.id_operario)

            logger.info(f"Repository - Habilidades manuales. Procesos afectados: {len(mapping)}")
            return mapping

        except Exception as e:
            logger.error(f"Repository - Error en get_manuales_por_proceso: {e}")
            raise InfrastructureException("Error al consultar las habilidades manuales.") from e

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
