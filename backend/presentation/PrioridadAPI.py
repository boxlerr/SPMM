from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.PrioridadService import PrioridadService
from backend.dto.PrioridadRequestDTO import PrioridadRequestDTO

from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

app = FastAPI()
router = APIRouter()
service = PrioridadService()

@router.post("/prioridades")
def crear_prioridad(prioridad_dto: PrioridadRequestDTO):
    try:
        result = service.crearPrioridad(prioridad_dto)
        return result
    except (BusinessException, InfrastructureException) as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Listar todas las prioridades
@router.get("/prioridades")
def listar_prioridades():
    try:
        return service.listarPrioridades()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Obtener una prioridad por ID
@router.get("/prioridades/{id}")
def obtener_prioridad(id: int):
    try:
        return service.obtenerPrioridadPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Modificar una prioridad
@router.put("/prioridades/{id}")
def modificar_prioridad(id: int, prioridad_dto: PrioridadRequestDTO):
    try:
        return service.modificarPrioridad(id, prioridad_dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Eliminar una prioridad
@router.delete("/prioridades/{id}")
def eliminar_prioridad(id: int):
    try:
        return service.eliminarPrioridad(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)
