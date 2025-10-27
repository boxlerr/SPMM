from fastapi import FastAPI, APIRouter, HTTPException, Depends
from backend.application.MaquinariaService import MaquinariaService
from backend.dto.MaquinariaRequestDTO import MaquinariaRequestDTO
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para sesión asincrónica
async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 POST /maquinarias
@router.post("/maquinarias")
async def crear_maquinaria(maquinaria_dto: MaquinariaRequestDTO, db=Depends(get_db)):
    """Crea una nueva Maquinaria."""
    try:
        service = MaquinariaService(db)
        result = await service.crearMaquinaria(maquinaria_dto)
        return result
    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /maquinarias
@router.get("/maquinarias")
async def listar_maquinarias(db=Depends(get_db)):
    """Lista todas las Maquinarias."""
    try:
        logger.info("API - Inicio GET /maquinarias")
        service = MaquinariaService(db)
        return await service.listarMaquinarias()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /maquinarias/{id}
@router.get("/maquinarias/{id}")
async def obtener_maquinaria(id: int, db=Depends(get_db)):
    """Obtiene una Maquinaria por ID."""
    try:
        logger.info(f"API - Inicio GET /maquinarias/{id}")
        service = MaquinariaService(db)
        return await service.obtenerMaquinariaPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 PUT /maquinarias/{id}
@router.put("/maquinarias/{id}")
async def modificar_maquinaria(id: int, maquinaria_dto: MaquinariaRequestDTO, db=Depends(get_db)):
    """Actualiza una Maquinaria existente."""
    try:
        logger.info(f"API - Inicio PUT /maquinarias/{id}")
        service = MaquinariaService(db)
        return await service.modificarMaquinaria(id, maquinaria_dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 DELETE /maquinarias/{id}
@router.delete("/maquinarias/{id}")
async def eliminar_maquinaria(id: int, db=Depends(get_db)):
    """Elimina una Maquinaria por ID."""
    try:
        logger.info(f"API - Inicio DELETE /maquinarias/{id}")
        service = MaquinariaService(db)
        ok = await service.eliminarMaquinaria(id)

        if not ok.status:
            return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")

        return ResponseDTO(status=True, data={"deleted": id})
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 Registrar rutas
app.include_router(router)
