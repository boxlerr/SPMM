from fastapi import FastAPI, APIRouter, Depends
from backend.application.SectorService import SectorService
from backend.dto.SectorRequestDTO import SectorRequestDTO
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para obtener sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session

# 🔹 Crear sector
@router.post("/sectores")
async def crear_sector(sector_dto: SectorRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /sectores")
    service = SectorService(db)
    result = await service.crearSector(sector_dto)
    return result

# 🔹 Listar todos los sectores
@router.get("/sectores")
async def listar_sectores(db=Depends(get_db)):
    logger.info("API - Inicio GET /sectores")
    service = SectorService(db)
    return await service.listarSectores()

# 🔹 Obtener sector por ID
@router.get("/sectores/{id}")
async def obtener_sector(id: int, db=Depends(get_db)):
    service = SectorService(db)
    return await service.obtenerSectorPorId(id)

# 🔹 Modificar sector
@router.put("/sectores/{id}")
async def modificar_sector(id: int, sector_dto: SectorRequestDTO, db=Depends(get_db)):
    service = SectorService(db)
    return await service.modificarSector(id, sector_dto)

# 🔹 Eliminar sector
@router.delete("/sectores/{id}")
async def eliminar_sector(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /sectores/{id}")
    service = SectorService(db)
    return await service.eliminarSector(id)

app.include_router(router)