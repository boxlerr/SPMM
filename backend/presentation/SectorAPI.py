from fastapi import FastAPI, APIRouter, HTTPException
from backend.application.SectorService import SectorService
from backend.dto.SectorRequestDTO import SectorRequestDTO
from backend.commons import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException

app = FastAPI()
router = APIRouter()

@router.post("/sectores")
def crear_sector(sector_dto: SectorRequestDTO):
    try:
        service = SectorService()
        result = service.crearSector(sector_dto)
        return result

    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))

    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(router)

@router.delete("/sectores/{sector_id}")
def eliminar_sector(sector_id: int):
    try:
        service = SectorService()
        result = service.eliminarSector(sector_id)
        return result
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

