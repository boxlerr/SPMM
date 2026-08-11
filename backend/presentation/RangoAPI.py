from fastapi import APIRouter, Depends
from backend.application.RangoService import RangoService
from backend.dto.RangoRequestDTO import RangoRequestDTO
from backend.dto.RangoAsignacionDTO import RangoProcesosDTO, RangoMaquinariasDTO
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


@router.post("/rangos")
async def crear_rango(rango_dto: RangoRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /rangos")
    service = RangoService(db)
    return await service.crearRango(rango_dto)


@router.get("/rangos")
async def listar_rangos(db=Depends(get_db)):
    logger.info("API - Inicio GET /rangos")
    service = RangoService(db)
    return await service.listarRangos()


@router.get("/rangos/procesos")
async def listar_procesos_por_rango(db=Depends(get_db)):
    """
    Mapa {id_rango: [id_proceso, ...]}: los procesos que habilita cada rango.

    Lo usa el editor de habilidades del operario para recalcular las SKILLS NATIVAS
    en vivo al cambiar los rangos, sin tener que guardar primero.

    Va declarada ANTES de /rangos/{id}: si no, FastAPI matchea "procesos" contra {id}
    y responde 422 por no poder parsearlo como int.
    """
    logger.info("API - Inicio GET /rangos/procesos")
    service = RangoService(db)
    return await service.listarProcesosPorRango()


@router.get("/rangos/maquinarias")
async def listar_maquinarias_por_rango(db=Depends(get_db)):
    """
    Mapa {id_rango: [id_maquinaria, ...]}.

    Igual que /rangos/procesos, va declarada ANTES de /rangos/{id} o FastAPI intenta
    parsear "maquinarias" como int y responde 422.
    """
    logger.info("API - Inicio GET /rangos/maquinarias")
    service = RangoService(db)
    return await service.listarMaquinariasPorRango()


@router.get("/rangos/{id}/detalle")
async def obtener_detalle_rango(id: int, db=Depends(get_db)):
    """El rango con sus procesos y maquinarias resueltos, y a cuántos operarios alcanza."""
    logger.info(f"API - Inicio GET /rangos/{id}/detalle")
    service = RangoService(db)
    return await service.obtenerDetalleRango(id)


@router.put("/rangos/{id}/procesos")
async def modificar_procesos_rango(id: int, dto: RangoProcesosDTO, db=Depends(get_db)):
    """
    Reemplaza el conjunto de procesos que habilita el rango.

    Cambia qué puede hacer todo operario que tenga este rango, no uno solo.
    """
    logger.info(f"API - Inicio PUT /rangos/{id}/procesos")
    service = RangoService(db)
    return await service.modificarProcesosRango(id, dto.procesos)


@router.put("/rangos/{id}/maquinarias")
async def modificar_maquinarias_rango(id: int, dto: RangoMaquinariasDTO, db=Depends(get_db)):
    """Reemplaza el conjunto de maquinarias del rango."""
    logger.info(f"API - Inicio PUT /rangos/{id}/maquinarias")
    service = RangoService(db)
    return await service.modificarMaquinariasRango(id, dto.maquinarias)


@router.get("/rangos/{id}")
async def obtener_rango(id: int, db=Depends(get_db)):
    service = RangoService(db)
    return await service.obtenerRangoPorId(id)


@router.put("/rangos/{id}")
async def modificar_rango(id: int, rango_dto: RangoRequestDTO, db=Depends(get_db)):
    service = RangoService(db)
    return await service.modificarRango(id, rango_dto)


@router.delete("/rangos/{id}")
async def eliminar_rango(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /rangos/{id}")
    service = RangoService(db)
    return await service.eliminarRango(id)
