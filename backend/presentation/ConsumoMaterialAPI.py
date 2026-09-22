"""El consumo de materiales de una orden (RF-15).

Tres rutas y ninguna de borrado: un consumo se anula, no se borra (ver
application/ConsumoMaterialService.py).

La anulación es un PUT a `/anular` y no un DELETE a propósito: el renglón no se va, y
el registro de auditoría diría «eliminó» algo que sigue ahí.
"""
from fastapi import APIRouter, Depends

from backend.application.ConsumoMaterialService import ConsumoMaterialService
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user
from backend.dto.ConsumoMaterialRequestDTO import AnularConsumoDTO, ConsumoMaterialRequestDTO
from backend.infrastructure.db import SessionLocal

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 Registrar lo que se consumió de un material de la OT
@router.post("/consumos-material")
async def registrar_consumo(
    dto: ConsumoMaterialRequestDTO,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    logger.info("API - Inicio POST /consumos-material")
    return await ConsumoMaterialService(db).registrar(dto, usuario)


# 🔹 Los consumos de una OT (anulados incluidos, marcados)
@router.get("/consumos-material")
async def listar_consumos(id_orden_trabajo: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /consumos-material (id_orden_trabajo={id_orden_trabajo})")
    return await ConsumoMaterialService(db).listar_por_orden(id_orden_trabajo)


# 🔹 Anular una carga equivocada: deja de sumar, el renglón queda
@router.put("/consumos-material/{id_consumo}/anular")
async def anular_consumo(
    id_consumo: int,
    dto: AnularConsumoDTO | None = None,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    logger.info(f"API - Inicio PUT /consumos-material/{id_consumo}/anular")
    return await ConsumoMaterialService(db).anular(id_consumo, dto, usuario)
