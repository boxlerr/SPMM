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
    except BusinessException as e:
        # Un tipo o un estado fuera de la lista (RF-08): 422 con el motivo, igual que el alta.
        raise HTTPException(status_code=422, detail=str(e))
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 DELETE /maquinarias/{id}
@router.delete("/maquinarias/{id}")
async def eliminar_maquinaria(id: int, forzar: bool = False, db=Depends(get_db)):
    """Borra una máquina.

    Si algo la está usando, sin `forzar` responde 409 con el motivo (qué se lleva
    puesto) en vez de borrar; con `forzar=true` la borra igual. Mismo contrato que
    DELETE /procesos/{id}.
    """
    logger.info(f"API - Inicio DELETE /maquinarias/{id} (forzar={forzar})")
    # El 409 lo arma el service y lo traduce el handler global de
    # ConfirmacionRequeridaException: atraparlo acá con un `except Exception` lo
    # convertía en un 500 y el motivo se perdía.
    service = MaquinariaService(db)
    return await service.eliminarMaquinaria(id, forzar=forzar)


# 🔹 Registrar rutas
app.include_router(router)
