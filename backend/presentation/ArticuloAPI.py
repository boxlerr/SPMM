
from fastapi import FastAPI, APIRouter,HTTPException
from backend.dto.ArticuloRequestDTO import ArticuloRequestDTO
from backend.application.ArticuloService import ArticuloService
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

#El request de afuera entra aca.
app = FastAPI()
router = APIRouter()

@router.post("/articulos")
def crear_articulo(articulo_dto: ArticuloRequestDTO):
    try:
        service = ArticuloService()
        
        articulo = service.crearArticulo(articulo_dto)
        return articulo

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/articulos/{id}")
def eliminar_articulo(id: int):
    try:
        service = ArticuloService()
        response = service.eliminarArticulo(id)
        return response

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



app.include_router(router)
