"""El rendimiento de cada persona (RF-07), en su ficha.

  GET /operarios/{id}/rendimiento?desde=AAAA-MM-DD&hasta=AAAA-MM-DD

Tareas completadas, tiempo promedio por tarea, eficiencia (estimado ÷ efectivo), horas
trabajadas, pausas y días de ausencia del período, y la tabla de tareas. Sin período,
los últimos 30 días. La cuenta: application/RendimientoOperarioService.py.

Es sólo lectura. La exportación a Excel y PDF se arma en el navegador con esto mismo
(RF-22): no hay un segundo endpoint que pueda contar distinto.

Qué pide: core/permisos_rutas.py, política «rendimiento_operario». Es la sección
confidencial «Rendimiento por persona», la misma del cuadro del Dashboard: pone un
número de eficiencia al lado de un nombre, y a quién se le abre lo decide Lucas.
"""
from fastapi import APIRouter, Depends

from backend.application.RendimientoOperarioService import RendimientoOperarioService
from backend.commons.loggers.logger import logger
from backend.infrastructure.db import SessionLocal

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


@router.get("/operarios/{id_operario}/rendimiento")
async def rendimiento(id_operario: int, desde: str | None = None, hasta: str | None = None,
                      db=Depends(get_db)):
    logger.info(f"API - Inicio GET /operarios/{id_operario}/rendimiento ({desde} → {hasta})")
    return await RendimientoOperarioService(db).reporte(id_operario, desde, hasta)
