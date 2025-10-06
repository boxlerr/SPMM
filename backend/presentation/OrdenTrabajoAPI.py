from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.OrdenTrabajoService import OrdenTrabajoService
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.ResponseDTO import ResponseDTO
from datetime import datetime

app = FastAPI()
router = APIRouter()
service = OrdenTrabajoService()

@router.post("/ordenes")
def crear_orden(dto: OrdenTrabajoRequestDTO):
    try:
        return service.crearOrdenTrabajo(dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ordenes")
def listar_ordenes():
    try:
        return service.listarOrdenes()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.get("/ordenes/por-fechas")
def listar_por_fechas(desde: datetime, hasta: datetime):

    try:
        return service.listarPorFechas(desde, hasta)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/ordenes/{id}")
def obtener_orden(id: int):
    try:
        return service.obtenerOrdenPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/ordenes/{id}")
def modificar_orden(id: int, dto: OrdenTrabajoRequestDTO):
    try:
        return service.modificarOrden(id, dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/ordenes/{id}")
def eliminar_orden(id: int):
    try:
        return service.eliminarOrden(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ordenes/por-prioridad/{id_prioridad}")
def listar_por_prioridad(id_prioridad: int):
    try:
        return service.listarPorPrioridad(id_prioridad)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


app.include_router(router)



