from fastapi import FastAPI, APIRouter,HTTPException
from backend.application.OrdenTrabajoService import OrdenTrabajoService
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO

from backend.commons import ResponseDTO
from backend.commons.exceptions import ApplicationException,BusinessException,DomainException,InfrastructureException


#El request de afuera entra aca.
app = FastAPI()
router = APIRouter()

@router.post("/ordenes-trabajo") 
def crear_orden(orden_dto: OrdenTrabajoRequestDTO):
    # Creamos la entidad

    try:
        service = OrdenTrabajoService()
        order = service.crearOrden(orden_dto)
        return order

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


    


app.include_router(router)



