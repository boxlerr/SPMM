
from fastapi import FastAPI, APIRouter,Depends

from backend.application.ProcesoService import ProcesoService
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para obtener sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session
    
# 🔹 Crear proceso
@router.post("/procesos")
async def crear_proceso(proceso_dto: ProcesoRequestDTO, db=Depends(get_db)):
    logger.info("API Crear proceso- Inicio POST /procesos")
    service = ProcesoService(db)
    result = await service.crearProceso(proceso_dto)
    return result

# 🔹 Listar todos los procesos
@router.get("/procesos")
async def listar_procesos(db=Depends(get_db)):
    logger.info("API - Inicio GET /procesos")
    service = ProcesoService(db)
    return await service.listarProcesos()

# 🔹 Obtener proceso por ID
@router.get("/procesos/{id}")
async def obtener_proceso(id: int, db=Depends(get_db)):
    service = ProcesoService(db)
    return await service.obtenerProcesoPorId(id)

# 🔹 Modificar proceso
@router.put("/procesos/{id}")
async def modificar_proceso(id: int, proceso_dto: ProcesoRequestDTO, db=Depends(get_db)):
    service = ProcesoService(db)
    return await service.modificarProceso(id, proceso_dto)

# 🔹 Eliminar proceso
@router.delete("/procesos/{id}")
async def eliminar_proceso(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /procesos/{id}")
    service = ProcesoService(db)
    return await service.eliminarProceso(id)

app.include_router(router)
