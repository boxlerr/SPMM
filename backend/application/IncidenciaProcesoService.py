from fastapi.encoders import jsonable_encoder
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.dto.IncidenciaProcesoRequestDTO import IncidenciaProcesoRequestDTO
from backend.infrastructure.IncidenciaProcesoRepository import IncidenciaProcesoRepository
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class IncidenciaProcesoService:
    def __init__(self, db_session):
        self.repository = IncidenciaProcesoRepository(db_session)

    async def registrar(self, dto: IncidenciaProcesoRequestDTO):
        logger.info(f"Service - Registrar incidencia tipo={dto.tipo} OT={dto.id_orden_trabajo}")
        if not dto.id_orden_trabajo:
            raise BusinessException("La incidencia debe estar asociada a una orden de trabajo.")

        incidencia = IncidenciaProceso(
            id_orden_trabajo=dto.id_orden_trabajo,
            id_proceso=dto.id_proceso,
            id_operario=dto.id_operario,
            tipo=(dto.tipo or "INTERPRETACION_PLANOS"),
            minutos_perdidos=max(0, dto.minutos_perdidos or 0),
            operarios_extra=max(0, dto.operarios_extra or 0),
            descripcion=dto.descripcion,
        )
        creada = await self.repository.save(incidencia)
        return ResponseDTO(status=True, data=jsonable_encoder(creada), errorDescription="")

    async def listar(self, tipo: str = "INTERPRETACION_PLANOS", desde: str | None = None, hasta: str | None = None):
        data = await self.repository.find_recientes(tipo, desde, hasta, limit=50)
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")

    async def metricas(self, tipo: str = "INTERPRETACION_PLANOS", desde: str | None = None, hasta: str | None = None):
        """Métrica para el dashboard. Si la tabla aún no existe (migración pendiente),
        devuelve métricas vacías en vez de romper el dashboard."""
        try:
            metricas = await self.repository.metricas(tipo, desde, hasta)
            recientes = await self.repository.find_recientes(tipo, desde, hasta, limit=20)
            data = {**metricas, "recientes": jsonable_encoder(recientes)}
            return ResponseDTO(status=True, data=data, errorDescription="")
        except InfrastructureException as e:
            logger.error(f"Service - métricas incidencias no disponibles: {e}")
            return ResponseDTO(
                status=True,
                data={
                    "total_incidencias": 0,
                    "total_minutos": 0,
                    "total_operarios_extra": 0,
                    "por_operario": [],
                    "por_mes": [],
                    "recientes": [],
                },
                errorDescription="",
            )
