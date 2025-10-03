from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.ProcesoService import ProcesoService
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO

from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

app = FastAPI()
router = APIRouter()

@router.post("/procesos")
def crear_proceso(proceso_dto: ProcesoRequestDTO):
    try:
        service = ProcesoService()
        result = service.crearProceso(proceso_dto)
        return result

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)
