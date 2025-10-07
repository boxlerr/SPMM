from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.ProcesoService import ProcesoService
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO

from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

app = FastAPI() 
router = APIRouter()
service = ProcesoService()

@router.post("/procesos")
def crear_proceso(proceso_dto: ProcesoRequestDTO):
    try:
        result = service.crearProceso(proceso_dto)
        return result
    except (BusinessException, InfrastructureException) as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Listar todos los procesos
@router.get("/procesos")
def listar_procesos():
    try:
        return service.listarProcesos()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Obtener un proceso por ID
@router.get("/procesos/{id}")
def obtener_proceso(id: int):
    try:
        return service.obtenerProcesoPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Modificar un proceso
@router.put("/procesos/{id}")
def modificar_proceso(id: int, proceso_dto: ProcesoRequestDTO):
    try:
        return service.modificarProceso(id, proceso_dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 Nuevo: Eliminar un proceso
@router.delete("/procesos/{id}")
def eliminar_proceso(id: int):
    try:
        return service.eliminarProceso(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)
