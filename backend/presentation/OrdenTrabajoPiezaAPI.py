from fastapi import FastAPI, APIRouter, Depends
from backend.infrastructure.db import SessionLocal
from backend.dto.OrdenTrabajoPiezaRequestDTO import OrdenTrabajoPiezaRequestDTO
from backend.application.OrdenTrabajoPiezaService import OrdenTrabajoPiezaService
from backend.commons.loggers.logger import logger
from backend.core.security import require_admin

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para obtener la sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session


@router.post("/ordenes-trabajo-piezas")
async def crear_ot_pieza(dto: OrdenTrabajoPiezaRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /ordenes-trabajo-piezas")
    service = OrdenTrabajoPiezaService(db)
    result = await service.crearOrdenTrabajoPieza(dto)
    return result


@router.delete("/ordenes-trabajo-piezas/{id}", dependencies=[Depends(require_admin)])
async def eliminar_ot_pieza(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /ordenes-trabajo-piezas/{id}")
    service = OrdenTrabajoPiezaService(db)
    result = await service.eliminarOrdenTrabajoPieza(id)
    return result


@router.get("/ordenes-trabajo-piezas")
async def listar_ot_piezas(db=Depends(get_db)):
    logger.info("API - Inicio GET /ordenes-trabajo-piezas")
    service = OrdenTrabajoPiezaService(db)
    return await service.listarOrdenTrabajoPiezas()


@router.get("/ordenes-trabajo-piezas/{id}")
async def obtener_ot_pieza(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /ordenes-trabajo-piezas/{id}")
    service = OrdenTrabajoPiezaService(db)
    return await service.obtenerOrdenTrabajoPiezaPorId(id)


@router.put("/ordenes-trabajo-piezas/{id}")
async def modificar_ot_pieza(id: int, dto: OrdenTrabajoPiezaRequestDTO, db=Depends(get_db)):
    logger.info(f"API - Inicio PUT /ordenes-trabajo-piezas/{id}")
    service = OrdenTrabajoPiezaService(db)
    return await service.modificarOrdenTrabajoPieza(id, dto)


app.include_router(router)
