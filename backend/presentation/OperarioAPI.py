from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.OperarioService import OperarioService
from backend.dto.OperarioRequestDTO import OperarioRequestDTO

from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

app = FastAPI()
router = APIRouter()
service = OperarioService()

@router.post("/operarios")
def crear_operario(operario_dto: OperarioRequestDTO):
    """Endpoint para crear un Operario (POST /operarios)."""
    try:
        result = service.crearOperario(operario_dto)
        return result

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/operarios/{id}")
def eliminar_operario(id: int):
    try:
        result = service.eliminarOperario(id)
        return result
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# GET all
@router.get("/operarios")
def listar_operarios():
    try:
        return service.listarOperarios()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# GET by id
@router.get("/operarios/{id}")
def obtener_operario(id: int):
    try:
        return service.obtenerOperarioPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# PUT
@router.put("/operarios/{id}")
def modificar_operario(id: int, operario_dto: OperarioRequestDTO):
    try:
        return service.modificarOperario(id, operario_dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)
