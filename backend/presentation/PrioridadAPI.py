from fastapi import FastAPI, APIRouter, Depends
from backend.application.PrioridadService import PrioridadService
from backend.dto.PrioridadRequestDTO import PrioridadRequestDTO
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para obtener sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session

# 🔹 Crear prioridad
@router.post("/prioridades")
async def crear_prioridad(prioridad_dto: PrioridadRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /prioridades")
    service = PrioridadService(db)
    result = await service.crearPrioridad(prioridad_dto)
    return result

# 🔹 Listar todas las prioridades
@router.get("/prioridades")
async def listar_prioridades(db=Depends(get_db)):
    logger.info("API - Inicio GET /prioridades")
    service = PrioridadService(db)
    return await service.listarPrioridades()

# 🔹 Obtener prioridad por ID
@router.get("/prioridades/{id}")
async def obtener_prioridad(id: int, db=Depends(get_db)):
    service = PrioridadService(db)
    return await service.obtenerPrioridadPorId(id)

# 🔹 Modificar prioridad
@router.put("/prioridades/{id}")
async def modificar_prioridad(id: int, prioridad_dto: PrioridadRequestDTO, db=Depends(get_db)):
    service = PrioridadService(db)
    return await service.modificarPrioridad(id, prioridad_dto)

# 🔹 Eliminar prioridad
@router.delete("/prioridades/{id}")
async def eliminar_prioridad(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /prioridades/{id}")
    service = PrioridadService(db)
    return await service.eliminarPrioridad(id)

app.include_router(router)
