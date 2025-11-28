from fastapi import FastAPI, APIRouter, Depends
from backend.application.OrdenTrabajoService import OrdenTrabajoService
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger
from datetime import datetime

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para obtener sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session

# 🔹 Crear orden de trabajo
@router.post("/ordenes")
async def crear_orden(dto: OrdenTrabajoRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /ordenes")
    service = OrdenTrabajoService(db)
    return await service.crearOrdenTrabajo(dto)

# 🔹 Listar todas las órdenes
@router.get("/ordenes")
async def listar_ordenes(db=Depends(get_db)):
    logger.info("API - Inicio GET /ordenes")
    service = OrdenTrabajoService(db)
    return await service.listarOrdenes()

# 🔹 Listar órdenes por fechas
@router.get("/ordenes/por-fechas")
async def listar_por_fechas(desde: datetime, hasta: datetime, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /ordenes/por-fechas desde={desde} hasta={hasta}")
    service = OrdenTrabajoService(db)
    return await service.listarPorFechas(desde, hasta)

# 🔹 Obtener orden por ID
@router.get("/ordenes/{id}")
async def obtener_orden(id: int, db=Depends(get_db)):
    service = OrdenTrabajoService(db)
    return await service.obtenerOrdenPorId(id)

# 🔹 Modificar orden
@router.put("/ordenes/{id}")
async def modificar_orden(id: int, dto: OrdenTrabajoRequestDTO, db=Depends(get_db)):
    service = OrdenTrabajoService(db)
    return await service.modificarOrden(id, dto)

# 🔹 Eliminar orden
@router.delete("/ordenes/{id}")
async def eliminar_orden(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /ordenes/{id}")
    service = OrdenTrabajoService(db)
    return await service.eliminarOrden(id)

# 🔹 Listar órdenes por prioridad
@router.get("/ordenes/por-prioridad/{id_prioridad}")
async def listar_por_prioridad(id_prioridad: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /ordenes/por-prioridad/{id_prioridad}")
    service = OrdenTrabajoService(db)
    return await service.listarPorPrioridad(id_prioridad)

# 🔹 Obtener estadísticas de estados de órdenes
@router.get("/ordenes-estadisticas/estados")
async def obtener_estadisticas_estados(db=Depends(get_db)):
    logger.info("API - Inicio GET /ordenes-estadisticas/estados")
    service = OrdenTrabajoService(db)
    return await service.obtenerEstadisticasEstados()

# 🔹 Obtener órdenes críticas (próximas a vencer)
@router.get("/ordenes-estadisticas/criticas")
async def obtener_ordenes_criticas(dias: int = 7, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /ordenes-estadisticas/criticas?dias={dias}")
    service = OrdenTrabajoService(db)
    return await service.obtenerOrdenesCriticas(dias)

# 🔹 Obtener ocupación por sector
@router.get("/ordenes-estadisticas/ocupacion-sector")
async def obtener_ocupacion_sector(db=Depends(get_db)):
    logger.info("API - Inicio GET /ordenes-estadisticas/ocupacion-sector")
    service = OrdenTrabajoService(db)
    return await service.obtenerOcupacionPorSector()

# 🔹 Obtener timeline de próximas entregas (7 días)
@router.get("/ordenes-estadisticas/proximas-entregas")
async def obtener_proximas_entregas(dias: int = 7, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /ordenes-estadisticas/proximas-entregas?dias={dias}")
    service = OrdenTrabajoService(db)
    return await service.obtenerProximasEntregasTimeline(dias)

from pydantic import BaseModel

class EstadoUpdate(BaseModel):
    estado: str

@router.put("/ordenes/{id_orden}/procesos/{id_proceso}/estado")
async def actualizar_estado_proceso(id_orden: int, id_proceso: int, body: EstadoUpdate, db=Depends(get_db)):
    logger.info(f"API - Inicio PUT /ordenes/{id_orden}/procesos/{id_proceso}/estado")
    service = OrdenTrabajoService(db)
    return await service.actualizarEstadoProceso(id_orden, id_proceso, body.estado)

@router.put("/ordenes/{id_orden}/procesos/{id_proceso}/status")
async def update_process_status(id_orden: int, id_proceso: int, body: dict, db=Depends(get_db)):
    # Endpoint alternativo recibiendo JSON
    new_status = body.get("estado")
    logger.info(f"API - Update Status: {new_status}")
    service = OrdenTrabajoService(db)
    return await service.actualizarEstadoProceso(id_orden, id_proceso, new_status)





