"""Las no conformidades (RF-12).

OJO CON EL ORDEN DE LAS RUTAS: las de nombre fijo (`/incidencias/tipos`,
`/incidencias/reporte`…) van ANTES que cualquier comodín `/incidencias/{id}`. FastAPI
se queda con la primera que encaja, así que al revés «tipos» entraría por la comodín y
contestaría 422 intentando leerlo como número. Lo cuida test_rutas_en_orden.py.
"""
from fastapi import APIRouter, Depends, Query, Response

from backend.core.security import get_current_user
from backend.infrastructure.db import SessionLocal
from backend.application.IncidenciaProcesoService import IncidenciaProcesoService, TOPE_REPORTE
from backend.dto.IncidenciaProcesoRequestDTO import (
    CerrarIncidenciaDTO,
    IncidenciaProcesoRequestDTO,
    IncidenciaProcesoUpdateDTO,
)
from backend.commons.loggers.logger import logger

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 Registrar una no conformidad contra una orden
@router.post("/incidencias")
async def registrar_incidencia(
    dto: IncidenciaProcesoRequestDTO,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    logger.info("API - Inicio POST /incidencias")
    service = IncidenciaProcesoService(db)
    return await service.registrar(dto, usuario)


# 🔹 Las listas para los desplegables (tipos, gravedades, estados)
@router.get("/incidencias/tipos")
async def tipos_de_incidencia(db=Depends(get_db)):
    logger.info("API - Inicio GET /incidencias/tipos")
    return IncidenciaProcesoService(db).catalogos()


# 🔹 Métrica agregada para el dashboard
@router.get("/incidencias/metricas")
async def metricas_incidencias(
    tipo: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    db=Depends(get_db),
):
    """Sin `tipo` ahora trae TODAS (antes se forzaba interpretación de planos).

    La tarjeta del dashboard manda el tipo explícito para que su número siga
    significando lo mismo que el día que se puso.
    """
    logger.info("API - Inicio GET /incidencias/metricas")
    service = IncidenciaProcesoService(db)
    return await service.metricas(tipo, desde, hasta)


# 🔹 El reporte del RF-12: listado con filtros + totales
@router.get("/incidencias/reporte")
async def reporte_incidencias(
    id_orden: int | None = None,
    nro_ot: int | None = None,
    tipo: str | None = None,
    gravedad: str | None = None,
    estado: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    limite: int = Query(TOPE_REPORTE, ge=1, le=5000),
    db=Depends(get_db),
):
    logger.info("API - Inicio GET /incidencias/reporte")
    service = IncidenciaProcesoService(db)
    return await service.reporte(
        id_orden=id_orden, nro_ot=nro_ot, tipo=tipo, gravedad=gravedad, estado=estado,
        desde=desde, hasta=hasta, limite=limite,
    )


# 🔹 El mismo reporte, para abrir en Excel
@router.get("/incidencias/reporte.csv")
async def reporte_incidencias_csv(
    id_orden: int | None = None,
    nro_ot: int | None = None,
    tipo: str | None = None,
    gravedad: str | None = None,
    estado: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    db=Depends(get_db),
):
    """El archivo va con `attachment`, pero el que dispara la descarga es el front con
    un blob: esta ruta pide token y un `<a href>` pelado se comería un 401."""
    logger.info("API - Inicio GET /incidencias/reporte.csv")
    service = IncidenciaProcesoService(db)
    contenido = await service.reporte_csv(
        id_orden=id_orden, nro_ot=nro_ot, tipo=tipo, gravedad=gravedad, estado=estado,
        desde=desde, hasta=hasta,
    )
    return Response(
        content=contenido,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="no-conformidades.csv"',
            # Un reporte no se cachea: se pide justamente para ver lo último.
            "Cache-Control": "no-store",
        },
    )


# 🔹 Listar (filtros opcionales) — lo que ya usaba el dashboard
@router.get("/incidencias")
async def listar_incidencias(
    tipo: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    db=Depends(get_db),
):
    logger.info("API - Inicio GET /incidencias")
    service = IncidenciaProcesoService(db)
    return await service.listar(tipo, desde, hasta)


# 🔹 Las no conformidades de UNA orden: la asociación que pide el RF, vista desde la OT
@router.get("/ordenes/{id_orden}/incidencias")
async def incidencias_de_la_orden(id_orden: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /ordenes/{id_orden}/incidencias")
    service = IncidenciaProcesoService(db)
    return await service.listar_por_orden(id_orden)


# 🔹 Cerrar una no conformidad (va antes que la comodín de abajo)
@router.put("/incidencias/{id_incidencia}/cerrar")
async def cerrar_incidencia(
    id_incidencia: int,
    dto: CerrarIncidenciaDTO | None = None,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    logger.info(f"API - Inicio PUT /incidencias/{id_incidencia}/cerrar")
    service = IncidenciaProcesoService(db)
    return await service.cerrar(id_incidencia, dto, usuario)


# 🔹 Corregir una no conformidad ya cargada
@router.put("/incidencias/{id_incidencia}")
async def actualizar_incidencia(
    id_incidencia: int,
    dto: IncidenciaProcesoUpdateDTO,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    logger.info(f"API - Inicio PUT /incidencias/{id_incidencia}")
    service = IncidenciaProcesoService(db)
    return await service.actualizar(id_incidencia, dto, usuario)
