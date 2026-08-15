from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.infrastructure.db import SessionLocal
from backend.infrastructure.DiaBloqueadoRepository import DiaBloqueadoRepository

router = APIRouter(prefix="/config", tags=["Configuration"])


async def get_db():
    async with SessionLocal() as session:
        yield session


class BlockedDateDTO(BaseModel):
    date: str


# Los días no laborables pasaron del archivo de configuración a la base: en Cloud Run
# el archivo vive dentro del contenedor, así que se perdía en cada deploy y no se
# compartía entre instancias. La respuesta no cambia de forma, así que el front sigue
# igual.
@router.get("/availability")
async def get_blocked_dates(db=Depends(get_db)):
    return {"blocked_dates": await DiaBloqueadoRepository(db).listar()}


@router.post("/availability")
async def add_blocked_date(dto: BlockedDateDTO, db=Depends(get_db)):
    repo = DiaBloqueadoRepository(db)
    await repo.agregar(dto.date)
    return {"message": "Date blocked successfully", "blocked_dates": await repo.listar()}


@router.delete("/availability/{date_str}")
async def remove_blocked_date(date_str: str, db=Depends(get_db)):
    repo = DiaBloqueadoRepository(db)
    await repo.quitar(date_str)
    return {"message": "Date unblocked successfully", "blocked_dates": await repo.listar()}
