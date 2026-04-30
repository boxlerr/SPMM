from fastapi import APIRouter, Depends
from backend.application.RangoService import RangoService
from backend.dto.RangoRequestDTO import RangoRequestDTO
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


@router.post("/rangos")
async def crear_rango(rango_dto: RangoRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /rangos")
    service = RangoService(db)
    return await service.crearRango(rango_dto)


@router.get("/rangos")
async def listar_rangos(db=Depends(get_db)):
    logger.info("API - Inicio GET /rangos")
    service = RangoService(db)
    return await service.listarRangos()


@router.get("/rangos/{id}")
async def obtener_rango(id: int, db=Depends(get_db)):
    service = RangoService(db)
    return await service.obtenerRangoPorId(id)


@router.put("/rangos/{id}")
async def modificar_rango(id: int, rango_dto: RangoRequestDTO, db=Depends(get_db)):
    service = RangoService(db)
    return await service.modificarRango(id, rango_dto)


@router.delete("/rangos/{id}")
async def eliminar_rango(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /rangos/{id}")
    service = RangoService(db)
    return await service.eliminarRango(id)
