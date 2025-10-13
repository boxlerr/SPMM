"""from fastapi import FastAPI, APIRouter, HTTPException,Depends
from backend.application.ProcesoService import ProcesoService
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.infrastructure.db import SessionLocal

from backend.commons.loggers.logger import logger

app = FastAPI() 
router = APIRouter()
#service = ProcesoService()

@router.post("/procesos")
def crear_proceso(proceso_dto: ProcesoRequestDTO):
    try:
        result = ProcesoService.crearProceso(proceso_dto)
        return result
    except (BusinessException, InfrastructureException) as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Listar todos los procesos
@router.get("/procesos")
async def listar_procesos():
    try:
        logger.info(f"Presentacion - Inicio get procesos ")
        return await service.listarProcesos()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

async def get_db():
    async with SessionLocal() as session:
        yield session

@router.get("/procesos")
async def listar_procesos(db=Depends(get_db)):
    try:
        logger.info("API - Inicio GET /procesos")
        service = ProcesoService(db)
        return await service.listarProcesos()
    except InfrastructureException as e:
        logger.error(f"API - Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Obtener un proceso por ID
@router.get("/procesos/{id}")
def obtener_proceso(id: int):
    try:
        return ProcesoService.obtenerProcesoPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Modificar un proceso
@router.put("/procesos/{id}")
def modificar_proceso(id: int, proceso_dto: ProcesoRequestDTO):
    try:
        return ProcesoService.modificarProceso(id, proceso_dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Eliminar un proceso
# 🔹 Eliminar un proceso
@router.delete("/procesos/{id}")
async def eliminar_proceso(id: int, db=Depends(get_db)):
    try:
        logger.info("API - Inicio DEL /procesos/{id}")
        service = ProcesoService(db)  # ✅ crear la instancia del servicio
        ok = await service.eliminarProceso(id)  # ✅ usar la instancia

        if ok.status == False:
            return ResponseDTO(status=False, data={}, errorDescription="Proceso no encontrado")

        return ResponseDTO(status=True, data={"deleted": id})

    except InfrastructureException as e:
        logger.error(f"API - Error al eliminar proceso: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    


app.include_router(router)
"""

from fastapi import FastAPI, APIRouter, HTTPException, Depends
from backend.application.ProcesoService import ProcesoService
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
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
    try:
        logger.info("API - Inicio GET /procesos")
        service = ProcesoService(db)
        return await service.listarProcesos()
    except InfrastructureException as e:
        logger.error(f"API - Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Obtener proceso por ID
@router.get("/procesos/{id}")
async def obtener_proceso(id: int, db=Depends(get_db)):
    try:
        service = ProcesoService(db)
        return await service.obtenerProcesoPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Modificar proceso
@router.put("/procesos/{id}")
async def modificar_proceso(id: int, proceso_dto: ProcesoRequestDTO, db=Depends(get_db)):
    try:
        service = ProcesoService(db)
        return await service.modificarProceso(id, proceso_dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Eliminar proceso
@router.delete("/procesos/{id}")
async def eliminar_proceso(id: int, db=Depends(get_db)):
    try:
        logger.info("API - Inicio DEL /procesos/{id}")
        service = ProcesoService(db)
        ok = await service.eliminarProceso(id)

        if not ok.status:
            return ResponseDTO(status=False, data={}, errorDescription="Proceso no encontrado")

        return ResponseDTO(status=True, data={"deleted": id})
    except InfrastructureException as e:
        logger.error(f"API - Error al eliminar proceso: {e}")
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)
