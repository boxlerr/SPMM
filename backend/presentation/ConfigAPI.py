from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from backend.core.security import get_current_user
from backend.infrastructure.db import SessionLocal
from backend.infrastructure.DiaBloqueadoRepository import DiaBloqueadoRepository
from backend.infrastructure.FeriadoRepository import FeriadoRepository, _ahora_ar

router = APIRouter(prefix="/config", tags=["Configuration"])


async def get_db():
    async with SessionLocal() as session:
        yield session


class BlockedDateDTO(BaseModel):
    date: str


class EleccionFeriadoDTO(BaseModel):
    # True = se trabaja, False = no se trabaja, None = lo de siempre (ver FeriadoRepository).
    se_trabaja: bool | None


def _quien(usuario: dict | None) -> str | None:
    if not usuario:
        return None
    return " ".join(x for x in [usuario.get("nombre"), usuario.get("apellido")] if x) or usuario.get("username")


# Los días no laborables pasaron del archivo de configuración a la base: en Cloud Run
# el archivo vive dentro del contenedor, así que se perdía en cada deploy y no se
# compartía entre instancias. La respuesta no cambia de forma, así que el front sigue
# igual.
#
# Desde el 8/10/2026 `blocked_dates` trae también los feriados nacionales que no se
# trabajan (ver FeriadoRepository), y pedirla es lo que los trae de la fuente cuando
# hace falta: la piden el Paso 1 y «Configurar feriados» al abrirse.
@router.get("/availability")
async def get_blocked_dates(db=Depends(get_db)):
    await FeriadoRepository(db).asegurar_anios()
    return {"blocked_dates": await DiaBloqueadoRepository(db).listar()}


@router.post("/availability")
async def add_blocked_date(dto: BlockedDateDTO, db=Depends(get_db), usuario: dict = Depends(get_current_user)):
    repo = DiaBloqueadoRepository(db)
    await repo.agregar(dto.date, _quien(usuario))
    return {"message": "Date blocked successfully", "blocked_dates": await repo.listar()}


@router.delete("/availability/{date_str}")
async def remove_blocked_date(date_str: str, db=Depends(get_db), usuario: dict = Depends(get_current_user)):
    repo = DiaBloqueadoRepository(db)
    await repo.quitar(date_str, _quien(usuario))
    return {"message": "Date unblocked successfully", "blocked_dates": await repo.listar()}


# 🔹 Los feriados con nombre y lo que eligió el taller, para mostrarlos al planificar.
#
# Sin `desde`, desde hoy; sin `hasta`, hasta fin del año que viene. `blocked_dates` va
# en la misma respuesta para que la pantalla no tenga que pedir dos cosas al abrir.
@router.get("/feriados")
async def listar_feriados(desde: date | None = None, hasta: date | None = None, db=Depends(get_db)):
    repo = FeriadoRepository(db)
    await repo.asegurar_anios()
    try:
        feriados = await repo.listar(desde or _ahora_ar().date(), hasta)
    except Exception:
        # Sin la tabla (la migración no corrió) la pantalla sigue, sin feriados con nombre.
        await db.rollback()
        feriados = []
    return {"feriados": feriados, "blocked_dates": await DiaBloqueadoRepository(db).listar()}


# 🔹 Si el taller trabaja un feriado. Devuelve el feriado como quedó y los días que el
# planificador saltea ahora, para que la pantalla se ponga al día sin volver a pedir.
@router.put("/feriados/{fecha}")
async def elegir_feriado(
    fecha: date,
    body: EleccionFeriadoDTO,
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    repo = FeriadoRepository(db)
    if not await repo.obtener(fecha):
        raise HTTPException(status_code=404, detail="Ese día no es feriado.")
    feriado = await repo.elegir(fecha, body.se_trabaja, _quien(usuario))
    if body.se_trabaja:
        # Si además alguien lo había bloqueado a mano, «se trabaja» tiene que valer igual.
        await db.execute(text("DELETE FROM dia_bloqueado WHERE fecha = :f"), {"f": fecha})
        await db.commit()
    return {"feriado": feriado, "blocked_dates": await DiaBloqueadoRepository(db).listar()}
