from fastapi import FastAPI, APIRouter,HTTPException
from backend.application.OrdenTrabajoService import OrdenTrabajoService
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO

from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

#El request de afuera entra aca.
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


@router.delete("/ordenes-trabajo/{id}")
def eliminar_orden(id: int):
    print(f"✅ [API] Recibida solicitud DELETE para ID: {id}")  # 👈

    try:
        service = OrdenTrabajoService()
        response = service.eliminarOrden(id)
        print(f"✅ [API] Respuesta enviada: {response}")  # 👈
        return response

    except BusinessException as e:
        print(f"❌ [API] BusinessException: {e}")  # 👈
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        print(f"❌ [API] InfrastructureException: {e}")  # 👈
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        print(f"❌ [API] Excepción inesperada: {e}")  # 👈
        raise HTTPException(status_code=500, detail=str(e))








app = FastAPI()
app.include_router(router)

