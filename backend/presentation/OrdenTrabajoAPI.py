from fastapi import FastAPI, APIRouter,HTTPException
from backend.application.OrdenTrabajoService import OrdenTrabajoService
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO

from backend.commons.ResponseDTO import ResponseDTO


#El request de afuera entra aca.
app = FastAPI()
router = APIRouter()

@router.post("/ordenes-trabajo")
def crear_orden(orden_dto: OrdenTrabajoRequestDTO):
    # Creamos la entidad
    
    try:
        
        service = OrdenTrabajoService() ##llamo al servicio
        order = service.crearOrden(orden_dto)
        
        return order
    except Exception as e : 
       response = ResponseDTO(
                            status=False,
                            data={},
                            errorDescription= str(e))
          ##HTTPException recibe parametros, no el objeto dto completo.
    raise HTTPException(status_code=400,detail = response.model_dump())
app.include_router(router)



