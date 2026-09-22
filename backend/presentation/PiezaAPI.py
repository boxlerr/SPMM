from fastapi import FastAPI, APIRouter, Depends
from backend.infrastructure.db import SessionLocal
from backend.dto.PiezaRequestDTO import PiezaRequestDTO, PiezaStockMinimoDTO
from backend.application.PiezaService import PiezaService
from backend.commons.loggers.logger import logger
from backend.core.security import require_admin

#El request de afuera entra aca.
app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para obtener la sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 Crear pieza
@router.post("/piezas")
async def crear_pieza(pieza_dto: PiezaRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /piezas")
    service = PiezaService(db)
    result = await service.crearPieza(pieza_dto)
    return result


@router.delete("/piezas/{id}", dependencies=[Depends(require_admin)])
async def eliminar_pieza(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /piezas/{id}")
    service = PiezaService(db)
    result = await service.eliminarPieza(id)
    return result


@router.get("/piezas")
async def listar_piezas(page: int = 1, size: int = 50, search: str = "", only_with_ot: bool = False,
                        con_minimo: bool = False, bajo_minimo: bool = False, db=Depends(get_db)):
    # `con_minimo` y `bajo_minimo` (RF-14) son opcionales y por defecto apagados: la
    # pantalla vieja no los manda y sigue recibiendo exactamente la misma lista.
    logger.info(f"API - Inicio GET /piezas page={page} search='{search}' only_with_ot={only_with_ot} "
                f"con_minimo={con_minimo} bajo_minimo={bajo_minimo}")
    service = PiezaService(db)
    return await service.listarPiezas(page, size, search, only_with_ot, con_minimo, bajo_minimo)


@router.get("/piezas/{id}")
async def obtener_pieza(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /piezas/{id}")
    service = PiezaService(db)
    return await service.obtenerPiezaPorId(id)


@router.put("/piezas/{id}")
async def modificar_pieza(id: int, dto: PiezaRequestDTO, db=Depends(get_db)):
    logger.info(f"API - Inicio PUT /piezas/{id}")
    service = PiezaService(db)
    return await service.modificarPieza(id, dto)


# 🔹 Stock mínimo de una pieza (RF-14): se edita en línea desde la solapa Materia Prima.
#    Ruta propia y no el PUT de arriba porque aquél exige reenviar código y descripción
#    —datos del sistema viejo— para cambiar un número que es sólo de SPMM.
@router.put("/piezas/{id}/stock-minimo")
async def definir_stock_minimo(id: int, dto: PiezaStockMinimoDTO, db=Depends(get_db)):
    logger.info(f"API - Inicio PUT /piezas/{id}/stock-minimo")
    service = PiezaService(db)
    return await service.definirStockMinimo(id, dto)


app.include_router(router)
