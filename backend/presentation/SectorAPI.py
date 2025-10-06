from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.SectorService import SectorService
from backend.dto.SectorRequestDTO import SectorRequestDTO
from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

app = FastAPI()
router = APIRouter()
service = SectorService()

@router.post("/sectores")
def crear_sector(sector_dto: SectorRequestDTO):
    try:
        result = service.crearSector(sector_dto)
        return result

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# GET all
@router.get("/sectores")
def listar_sectores():
    try:
        return service.listarSectores()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# GET by id
@router.get("/sectores/{id}")
def obtener_sector(id: int):
    try:
        return service.obtenerSectorPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# PUT
@router.put("/sectores/{id}")
def modificar_sector(id: int, sector_dto: SectorRequestDTO):
    try:
        return service.modificarSector(id, sector_dto)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/sectores/{id}")
def eliminar_sector(id: int):
    try:
        result = service.eliminarSector(id)
        return result
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)