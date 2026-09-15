"""Lo que muestra la pantalla de Auditoría.

El historial de planificación vive en PlanificacionAPI (`/auditoria/planificacion`)
porque lo escribe el propio endpoint de planificar. Esto es lo otro: TODO lo demás
que alguien creó, editó o eliminó, que lo escribe el middleware de main.py.
"""
from fastapi import APIRouter, Depends, Query

from sqlalchemy import func, select

from backend.core.security import get_current_user
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.infrastructure.db import SessionLocal

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


def _fila(m: AuditoriaMovimiento) -> dict:
    return {
        "id": m.id,
        "cuando": m.creado_en.isoformat() if m.creado_en else None,
        "usuario": m.usuario,
        "id_usuario": m.id_usuario,
        "accion": m.accion,
        "entidad": m.entidad,
        "id_entidad": m.id_entidad,
        "descripcion": m.descripcion,
        "metodo": m.metodo,
        "ruta": m.ruta,
        "estado": m.estado,
        "salio_bien": (m.estado or 0) < 400,
        "duracion_ms": m.duracion_ms,
        "detalle": m.detalle,
    }


@router.get("/auditoria/movimientos")
async def movimientos(
    limite: int = Query(300, ge=1, le=2000),
    entidad: str | None = None,
    accion: str | None = None,
    usuario: str | None = None,
    buscar: str | None = None,
    solo_fallidos: bool = False,
    db=Depends(get_db),
    _u=Depends(get_current_user),
):
    """Lo último primero, con los filtros que usa la pantalla.

    El tope por defecto es 300 y el máximo 2000: la tabla crece con cada guardado y
    traerla entera al navegador sería el mismo error que ya se pagó con /ordenes.
    """
    q = select(AuditoriaMovimiento).order_by(AuditoriaMovimiento.creado_en.desc())

    if entidad:
        q = q.where(AuditoriaMovimiento.entidad.like(f"{entidad}%"))
    if accion:
        q = q.where(AuditoriaMovimiento.accion == accion)
    if usuario:
        q = q.where(AuditoriaMovimiento.usuario == usuario)
    if solo_fallidos:
        q = q.where(AuditoriaMovimiento.estado >= 400)
    if buscar:
        patron = f"%{buscar.strip()}%"
        q = q.where(AuditoriaMovimiento.descripcion.ilike(patron))

    filas = (await db.execute(q.limit(limite))).scalars().all()

    # Para armar los desplegables de filtro sin que el front tenga que adivinar qué
    # hay. Salen de los datos, así que una entidad nueva aparece sola.
    entidades = (await db.execute(
        select(AuditoriaMovimiento.entidad, func.count().label("cuantos"))
        .group_by(AuditoriaMovimiento.entidad)
        .order_by(func.count().desc())
    )).all()
    usuarios = (await db.execute(
        select(AuditoriaMovimiento.usuario)
        .where(AuditoriaMovimiento.usuario.isnot(None))
        .group_by(AuditoriaMovimiento.usuario)
        .order_by(AuditoriaMovimiento.usuario)
    )).scalars().all()

    return {
        "movimientos": [_fila(m) for m in filas],
        "entidades": [{"entidad": e, "cuantos": c} for e, c in entidades],
        "usuarios": list(usuarios),
        "tope": limite,
    }


@router.get("/auditoria/movimientos/de/{entidad}/{id_entidad}")
async def movimientos_de(
    entidad: str,
    id_entidad: str,
    db=Depends(get_db),
    _u=Depends(get_current_user),
):
    """Todo lo que le pasó a UNA cosa: «mostrame el historial de la OT 1081».

    Es la pregunta que motivó todo esto, así que tiene su propia dirección en vez de
    depender de que alguien acierte el filtro."""
    q = (
        select(AuditoriaMovimiento)
        .where(AuditoriaMovimiento.entidad.like(f"{entidad}%"))
        .where(AuditoriaMovimiento.id_entidad == str(id_entidad))
        .order_by(AuditoriaMovimiento.creado_en.desc())
        .limit(500)
    )
    filas = (await db.execute(q)).scalars().all()
    return {"movimientos": [_fila(m) for m in filas]}
