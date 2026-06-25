from fastapi import APIRouter, Depends
from backend.infrastructure.db import SessionLocal
from backend.application.IncidenciaProcesoService import IncidenciaProcesoService
from backend.dto.IncidenciaProcesoRequestDTO import IncidenciaProcesoRequestDTO
from backend.commons.loggers.logger import logger

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 Registrar una incidencia (ej. interpretación de planos)
@router.post("/incidencias")
async def registrar_incidencia(dto: IncidenciaProcesoRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /incidencias")
    service = IncidenciaProcesoService(db)
    return await service.registrar(dto)


# 🔹 Listar incidencias (filtros opcionales)
@router.get("/incidencias")
async def listar_incidencias(
    tipo: str = "INTERPRETACION_PLANOS",
    desde: str | None = None,
    hasta: str | None = None,
    db=Depends(get_db),
):
    logger.info("API - Inicio GET /incidencias")
    service = IncidenciaProcesoService(db)
    return await service.listar(tipo, desde, hasta)


# 🔹 Métrica agregada para el dashboard
@router.get("/incidencias/metricas")
async def metricas_incidencias(
    tipo: str = "INTERPRETACION_PLANOS",
    desde: str | None = None,
    hasta: str | None = None,
    db=Depends(get_db),
):
    logger.info("API - Inicio GET /incidencias/metricas")
    service = IncidenciaProcesoService(db)
    return await service.metricas(tipo, desde, hasta)
