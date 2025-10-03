from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.PrioridadService import PrioridadService
from backend.dto.PrioridadRequestDTO import PrioridadRequestDTO

from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

app = FastAPI()
router = APIRouter()

@router.post("/prioridades")
def crear_prioridad(prioridad_dto: PrioridadRequestDTO):
    try:
        service = PrioridadService()
        result = service.crearPrioridad(prioridad_dto)
        return result

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)
