from fastapi import FastAPI, APIRouter, HTTPException, Depends
from backend.application.OperarioService import OperarioService
from backend.dto.OperarioRequestDTO import OperarioRequestDTO
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


# 🔹 POST /operarios
@router.post("/operarios")
async def crear_operario(operario_dto: OperarioRequestDTO, db=Depends(get_db)):
    """Endpoint para crear un Operario (POST /operarios)."""
    try:
        service = OperarioService(db)
        result = await service.crearOperario(operario_dto)
        return result
    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 DELETE /operarios/{id}
@router.delete("/operarios/{id}")
async def eliminar_operario(id: int, db=Depends(get_db)):
    try:
        logger.info(f"API - Inicio DELETE /operarios/{id}")
        service = OperarioService(db)
        ok = await service.eliminarOperario(id)

        if not ok.status:
            return ResponseDTO(status=False, data={}, errorDescription="Operario no encontrado")

        return ResponseDTO(status=True, data={"deleted": id})

    except InfrastructureException as e:
        logger.error(f"API - Error al eliminar operario: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /operarios
@router.get("/operarios")
async def listar_operarios(db=Depends(get_db)):
    try:
        logger.info("API - Inicio GET /operarios")
        service = OperarioService(db)
        return await service.listarOperarios()
    except InfrastructureException as e:
        logger.error(f"API - Error al listar operarios: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /operarios/{id}
@router.get("/operarios/{id}")
async def obtener_operario(id: int, db=Depends(get_db)):
    try:
        logger.info(f"API - Inicio GET /operarios/{id}")
        service = OperarioService(db)
        return await service.obtenerOperarioPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 PUT /operarios/{id}
@router.put("/operarios/{id}")
async def modificar_operario(id: int, operario_dto: OperarioRequestDTO, db=Depends(get_db)):
    try:
        logger.info(f"API - Inicio PUT /operarios/{id}")
        service = OperarioService(db)
        return await service.modificarOperario(id, operario_dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 Registrar rutas
app.include_router(router)

