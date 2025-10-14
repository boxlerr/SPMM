from fastapi import FastAPI, APIRouter, Depends
from backend.infrastructure.db import SessionLocal
from backend.dto.ArticuloRequestDTO import ArticuloRequestDTO
from backend.application.ArticuloService import ArticuloService
from backend.commons.loggers.logger import logger

#El request de afuera entra aca.
app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para obtener la sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 Crear artículo
@router.post("/articulos")
async def crear_articulo(articulo_dto: ArticuloRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /articulos")
    service = ArticuloService(db)
    result = await service.crearArticulo(articulo_dto)
    return result


@router.delete("/articulos/{id}")
async def eliminar_articulo(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /articulos/{id}")
    service = ArticuloService(db)
    result = await service.eliminarArticulo(id)
    return result


@router.get("/articulos")
async def listar_articulos(db=Depends(get_db)):
    logger.info("API - Inicio GET /articulos")
    service = ArticuloService(db)
    return await service.listarArticulos()


@router.get("/articulos/{id}")
async def obtener_articulo(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /articulos/{id}")
    service = ArticuloService(db)
    return await service.obtenerArticuloPorId(id)


@router.put("/articulos/{id}")
async def modificar_articulo(id: int, dto: ArticuloRequestDTO, db=Depends(get_db)):
    logger.info(f"API - Inicio PUT /articulos/{id}")
    service = ArticuloService(db)
    return await service.modificarArticulo(id, dto)


app.include_router(router)
