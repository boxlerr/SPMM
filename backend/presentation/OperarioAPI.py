from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.OperarioService import OperarioService
from backend.dto.OperarioRequestDTO import OperarioRequestDTO

from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

app = FastAPI()
router = APIRouter()

@router.post("/operarios")
def crear_operario(operario_dto: OperarioRequestDTO):
    """Endpoint para crear un Operario (POST /operarios)."""
    try:
        service = OperarioService()
        result = service.crearOperario(operario_dto)
        return result

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/operarios/{operario_id}")
def eliminar_operario(operario_id: int):
    try:
        service = OperarioService()
        result = service.eliminarOperario(operario_id)
        return result
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)
