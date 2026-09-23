"""Pausar y reanudar una OT o un paso (RF-03). Las reglas: application/PausaService.py.

Qué pide cada ruta (leer / escribir) está en core/permisos_rutas.py, política «pausas».
Pausar es tocar la OT: pide lo mismo que cambiarle el estado a un paso.

Pausar y reanudar son POST a su verbo y no un PUT a la OT: no se edita la orden, se
registra algo que le pasó. Y así el registro de auditoría dice «pausó» y «reanudó»
(ver VERBO en infrastructure/auditoria_movimientos.py) en vez de «creó».
"""
from fastapi import APIRouter, Depends, Request

from backend.application.PausaService import PausaService
from backend.domain.PausaOrden import duracion_corta, que_se_pauso, texto_del_motivo
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user
from backend.dto.PausaRequestDTO import PausarDTO, ReanudarDTO
from backend.infrastructure.db import SessionLocal

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


def _dejar_dicho(request: Request, frase: str) -> None:
    """La frase que se lee en Auditoría › Todo lo que se hizo. El pedido solo diría
    «pausó orden de trabajo #1081» con el id interno y sin el motivo."""
    try:
        request.state.auditoria = {"frase": frase}
    except Exception:
        pass


class _Pausa:
    """Lo mínimo para armar la frase desde el dict que devuelve el servicio."""

    def __init__(self, d: dict):
        self.id_otp = d.get("id_otp")
        self.paso = d.get("paso")
        self.nombre_proceso = d.get("nombre_proceso")
        self.motivo = d.get("motivo")
        self.observacion = d.get("observacion")


# 🔹 Todo lo que está pausado ahora (las listas de OT y el planificador lo cruzan por id).
#    Va con guion y no bajo /ordenes/: `/ordenes/{id}` la taparía.
@router.get("/ordenes-pausadas")
async def pausas_activas(db=Depends(get_db)):
    logger.info("API - Inicio GET /ordenes-pausadas")
    return await PausaService(db).activas()


# 🔹 El historial de pausas de una OT (la ficha).
@router.get("/ordenes/{id_orden}/pausas")
async def pausas_de_la_orden(id_orden: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /ordenes/{id_orden}/pausas")
    return await PausaService(db).de_la_orden(id_orden)


@router.post("/ordenes/{id_orden}/pausar")
async def pausar(
    id_orden: int,
    dto: PausarDTO,
    request: Request,
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio POST /ordenes/{id_orden}/pausar (paso={dto.id_otp}, motivo={dto.motivo})")
    salida = await PausaService(db).pausar(
        id_orden, dto.motivo, dto.observacion, id_otp=dto.id_otp, usuario=usuario)
    p = salida.data
    _dejar_dicho(request, f"pausó {que_se_pauso(_Pausa(p), p.get('numero_ot'))} — "
                          f"{texto_del_motivo(_Pausa(p))}")
    return salida


@router.post("/ordenes/{id_orden}/reanudar")
async def reanudar(
    id_orden: int,
    request: Request,
    dto: ReanudarDTO | None = None,
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    id_otp = dto.id_otp if dto else None
    logger.info(f"API - Inicio POST /ordenes/{id_orden}/reanudar (paso={id_otp})")
    salida = await PausaService(db).reanudar(id_orden, id_otp=id_otp, usuario=usuario)
    p = salida.data
    _dejar_dicho(request, f"reanudó {que_se_pauso(_Pausa(p), p.get('numero_ot'))} "
                          f"(estuvo parada {duracion_corta(p.get('minutos', 0))})")
    return salida
