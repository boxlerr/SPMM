"""Las no conformidades (RF-12).

OJO CON EL ORDEN DE LAS RUTAS: las de nombre fijo (`/incidencias/tipos`,
`/incidencias/reporte`…) van ANTES que cualquier comodín `/incidencias/{id}`. FastAPI
se queda con la primera que encaja, así que al revés «tipos» entraría por la comodín y
contestaría 422 intentando leerlo como número. Lo cuida test_rutas_en_orden.py.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from backend.core.permisos_rutas import rechazo, seccion
from backend.core.security import get_current_user, get_permisos_actuales
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


# ─────────────────────────── el filtro por persona ───────────────────────────
#
# Revisión del 23/09. Lo que pone las no conformidades al lado de UN nombre (el agrupado
# /incidencias/por-persona y los rechazos de la ficha, /operarios/{id}/rechazos) pide la
# sección confidencial «Rendimiento por persona» (core/permisos_rutas.py, «incidencias»).
# Pero el reporte de siempre, con `?id_operario=`, devolvía lo mismo —sus filas y el
# resumen con piezas, controladas y porcentaje de rechazo— con sólo el área No
# conformidades: el supervisor y el operario esquivaban la sección con un filtro.
#
# DECISIÓN ABIERTA (opción conservadora, a confirmar con Lucas): filtrar el reporte o su
# CSV por persona pide la misma sección. Sin filtro sigue como estaba: la lista dice quién
# hizo cada una, como siempre lo dijo. Si Lucas decide que es información abierta, se
# saca esta función y la sección de las dos rutas de arriba, y el comentario de la
# política se corrige.
#
# Va acá y no en el mapa de políticas porque el mapa sólo sabe «con este parámetro
# alcanza con menos» (`con_parametro`), no «con este parámetro hace falta más».

SECCION_POR_PERSONA = "dashboard_rendimiento"


def _exigir_seccion_si_filtra_por_persona(id_operario: int | None, permisos) -> None:
    if id_operario is None:
        return
    try:
        ve = bool(permisos and permisos.tiene_seccion(SECCION_POR_PERSONA, "read"))
    except Exception:
        ve = False  # un permiso que no se pudo mirar no abre nada
    if not ve:
        raise HTTPException(
            status_code=403,
            detail={"message": rechazo((seccion(SECCION_POR_PERSONA),)), "campo": "permiso"},
        )


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


# 🔹 Las listas para los desplegables (tipos, gravedades, estados, qué se hace)
@router.get("/incidencias/tipos")
async def tipos_de_incidencia(db=Depends(get_db)):
    logger.info("API - Inicio GET /incidencias/tipos")
    return IncidenciaProcesoService(db).catalogos()


# 🔹 Para cargar una desde la OT: la orden, sus pasos y quién hizo cada uno (23/09)
@router.get("/incidencias/para-registrar")
async def para_registrar_incidencia(
    id_orden: int | None = None,
    nro_ot: int | None = None,
    db=Depends(get_db),
):
    """Por `id_orden` (desde la ficha de la OT) o por `nro_ot`, el número que se ve
    (desde No conformidades, mientras se escribe). Una OT que no existe no da 404:
    vuelve `orden: null`, así el front no la confunde con un servidor sin esta ruta."""
    logger.info(f"API - Inicio GET /incidencias/para-registrar ({id_orden=} {nro_ot=})")
    return await IncidenciaProcesoService(db).para_registrar(id_orden=id_orden, nro_ot=nro_ot)


# 🔹 Agrupadas por quién hizo las piezas (23/09). Sección confidencial «Rendimiento por
# persona»: ver core/permisos_rutas.py, política «incidencias».
@router.get("/incidencias/por-persona")
async def incidencias_por_persona(
    nro_ot: int | None = None,
    tipo: str | None = None,
    gravedad: str | None = None,
    estado: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    id_operario: int | None = None,
    db=Depends(get_db),
):
    logger.info("API - Inicio GET /incidencias/por-persona")
    return await IncidenciaProcesoService(db).por_persona(
        nro_ot=nro_ot, tipo=tipo, gravedad=gravedad, estado=estado, desde=desde,
        hasta=hasta, id_operario=id_operario,
    )


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
    id_operario: int | None = None,
    limite: int = Query(TOPE_REPORTE, ge=1, le=5000),
    db=Depends(get_db),
    permisos=Depends(get_permisos_actuales),
):
    logger.info("API - Inicio GET /incidencias/reporte")
    # Filtrado por persona es «Rendimiento por persona»: ver arriba.
    _exigir_seccion_si_filtra_por_persona(id_operario, permisos)
    service = IncidenciaProcesoService(db)
    return await service.reporte(
        id_orden=id_orden, nro_ot=nro_ot, tipo=tipo, gravedad=gravedad, estado=estado,
        desde=desde, hasta=hasta, id_operario=id_operario, limite=limite,
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
    id_operario: int | None = None,
    db=Depends(get_db),
    permisos=Depends(get_permisos_actuales),
):
    """El archivo va con `attachment`, pero el que dispara la descarga es el front con
    un blob: esta ruta pide token y un `<a href>` pelado se comería un 401."""
    logger.info("API - Inicio GET /incidencias/reporte.csv")
    _exigir_seccion_si_filtra_por_persona(id_operario, permisos)
    service = IncidenciaProcesoService(db)
    contenido = await service.reporte_csv(
        id_orden=id_orden, nro_ot=nro_ot, tipo=tipo, gravedad=gravedad, estado=estado,
        desde=desde, hasta=hasta, id_operario=id_operario,
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


# 🔹 Las no conformidades de las que una persona hizo las piezas: su ficha (23/09).
# Vive en este router porque son no conformidades, pero pide la sección confidencial
# «Rendimiento por persona», la misma del reporte de RF-07 que está al lado en la ficha
# (core/permisos_rutas.py, política «incidencias»).
@router.get("/operarios/{id_operario}/rechazos")
async def rechazos_de_la_persona(
    id_operario: int,
    desde: str | None = None,
    hasta: str | None = None,
    db=Depends(get_db),
):
    logger.info(f"API - Inicio GET /operarios/{id_operario}/rechazos ({desde} → {hasta})")
    return await IncidenciaProcesoService(db).rechazos_de_persona(id_operario, desde, hasta)


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
