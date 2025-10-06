
from fastapi import FastAPI, APIRouter,HTTPException
from backend.dto.ArticuloRequestDTO import ArticuloRequestDTO
from backend.application.ArticuloService import ArticuloService
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

#El request de afuera entra aca.
app = FastAPI()
router = APIRouter()
service = ArticuloService()

@router.post("/articulos")
def crear_articulo(articulo_dto: ArticuloRequestDTO):
    try:        
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
        response = service.eliminarArticulo(id)
        return response

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    
@router.get("/articulos")
def listar_articulos():
    try:
        return service.listarArticulos()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/articulos/{id}")
def obtener_articulo(id: int):
    try:
        return service.obtenerArticuloPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/articulos/{id}")
def modificar_articulo(id: int, dto: ArticuloRequestDTO):
    try:
        return service.modificarArticulo(id, dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))



app.include_router(router)
