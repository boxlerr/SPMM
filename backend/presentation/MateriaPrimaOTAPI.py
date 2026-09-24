"""Materia prima › las materias primas de cada OT (spec §2.2): la solapa «Materias
primas» de la OT, ahora editable (líneas, marcas pedido / reserva / disponible /
producción, cortes, traer historial), y las marcas que pone Pendientes.

Política «materia_prima_ot» (core/permisos_rutas.py): leer pide la sección Materia prima
de Operaciones; escribir, esa sección en «editar».

Las reglas viven en application/MateriaPrimaOTService.py; acá sólo se recibe, se llama y
se deja la frase para Auditoría › Todo lo que se hizo.

RUTAS FIJAS ANTES QUE LAS CON {id} (tests/test_rutas_en_orden.py): PUT
/materia-prima/lineas/lote va antes que PUT /materia-prima/lineas/{id_linea}; si no,
«lote» entraría como id y contestaría 422.

`?forzar=true` es el «Hacerlo igual» del 409 (avisar, no bloquear): la misma operación,
repetida después de que la persona vio el aviso.
"""
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from backend.application.MateriaPrimaOTService import MateriaPrimaOTService
from backend.application.materia_prima.dueno import solo_si_spmm_es_dueno
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user
from backend.dto.MateriaPrimaOTRequestDTO import (
    CambiosLinea,
    CambiosLoteIn,
    CortesIn,
    LineaIn,
    LoteLineasIn,
)
from backend.infrastructure.db import SessionLocal

# Con el Sistema Integral como dueño de las materias primas (la prueba piloto, ver
# application/materia_prima/dueno.py) toda escritura de este router contesta 422;
# las lecturas pasan. Va en el router y no en cada ruta: una ruta nueva queda
# cubierta sola.
router = APIRouter(dependencies=[Depends(solo_si_spmm_es_dueno)])


async def get_db():
    async with SessionLocal() as session:
        yield session


def _dejar_dicho(request: Request, frase: str | None) -> None:
    """La frase de Auditoría › Todo lo que se hizo (sin el autor: lo pone el middleware)."""
    if not frase:
        return
    try:
        request.state.auditoria = {"frase": frase}
    except Exception:
        pass


def _ok(data) -> ResponseDTO:
    return ResponseDTO(status=True, errorDescription="", data=data)


class NoLlevaDTO(BaseModel):
    no_lleva: bool


# ─────────────────────────── lectura ───────────────────────────


# 🔹 «Traer historial» para una OT que todavía no existe (el alta de la OT, antes de
#    guardarla): por artículo y unidades. La spec lo pide «para OT nueva o existente» y
#    la ruta por id no sirve sin id. Devuelve la MISMA forma que la de abajo
#    ({origen, factor, lineas}: es la misma función del servicio); `excluir_ot` es para
#    quien ya tiene id y no quiere copiarse a sí mismo. Sin `unidades`, factor 1.
@router.get("/materia-prima/historial")
async def ver_historial_por_articulo(
    id_articulo: int,
    unidades: float | None = None,
    excluir_ot: int | None = None,
    db=Depends(get_db),
):
    logger.info(f"API - Inicio GET /materia-prima/historial (id_articulo={id_articulo})")
    return _ok(await MateriaPrimaOTService(db).historial(id_articulo, unidades, excluir_ot))


# 🔹 La solapa de la OT: sus líneas, el estado del material, si ya arrancó y su cañera.
@router.get("/materia-prima/ot/{id_orden_trabajo}/lineas")
async def ver_lineas(id_orden_trabajo: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /materia-prima/ot/{id_orden_trabajo}/lineas")
    return _ok(await MateriaPrimaOTService(db).lineas_de_ot(id_orden_trabajo))


# 🔹 «Traer historial»: la vista previa (no escribe; el front confirma y manda el lote).
@router.get("/materia-prima/ot/{id_orden_trabajo}/historial")
async def ver_historial(id_orden_trabajo: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /materia-prima/ot/{id_orden_trabajo}/historial")
    return _ok(await MateriaPrimaOTService(db).historial_de_ot(id_orden_trabajo))


# ─────────────────────────── altas ───────────────────────────


# 🔹 Varias líneas de una vez: el alta de una OT nueva y «Traer historial». Todas o ninguna.
@router.post("/materia-prima/ot/{id_orden_trabajo}/lineas/lote")
async def agregar_lote(
    id_orden_trabajo: int,
    dto: LoteLineasIn,
    request: Request,
    forzar: bool = Query(False),
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio POST /materia-prima/ot/{id_orden_trabajo}/lineas/lote "
                f"({len(dto.lineas)} líneas)")
    r = await MateriaPrimaOTService(db).agregar(id_orden_trabajo, dto.lineas, usuario, forzar)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)


# 🔹 Una línea.
@router.post("/materia-prima/ot/{id_orden_trabajo}/lineas")
async def agregar_linea(
    id_orden_trabajo: int,
    dto: LineaIn,
    request: Request,
    forzar: bool = Query(False),
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio POST /materia-prima/ot/{id_orden_trabajo}/lineas")
    r = await MateriaPrimaOTService(db).agregar(id_orden_trabajo, [dto], usuario, forzar)
    _dejar_dicho(request, r.frase)
    return _ok(r.data[0] if r.data else None)


# 🔹 «No lleva materias primas»: la OT no necesita material (distinto de no tener
#    ninguna línea cargada, que es que falta cargarla).
@router.put("/materia-prima/ot/{id_orden_trabajo}/no-lleva")
async def cambiar_no_lleva(
    id_orden_trabajo: int,
    dto: NoLlevaDTO,
    request: Request,
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio PUT /materia-prima/ot/{id_orden_trabajo}/no-lleva")
    r = await MateriaPrimaOTService(db).cambiar_no_lleva(id_orden_trabajo, dto.no_lleva, usuario)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)


# ─────────────────────────── cambios ───────────────────────────


# 🔹 Los mismos cambios a muchas líneas (la barra de acciones de Pendientes). ANTES que
#    /lineas/{id_linea}.
@router.put("/materia-prima/lineas/lote")
async def cambiar_lote(
    dto: CambiosLoteIn,
    request: Request,
    forzar: bool = Query(False),
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio PUT /materia-prima/lineas/lote ({len(dto.ids)} líneas)")
    r = await MateriaPrimaOTService(db).cambiar_lote(dto.ids, dto.cambios, usuario, forzar)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)


# 🔹 Los cortes de una línea (reemplaza todos).
@router.put("/materia-prima/lineas/{id_linea}/cortes")
async def cambiar_cortes(
    id_linea: int,
    dto: CortesIn,
    request: Request,
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio PUT /materia-prima/lineas/{id_linea}/cortes")
    r = await MateriaPrimaOTService(db).reemplazar_cortes(id_linea, dto.cortes, usuario)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)


# 🔹 Una línea, sólo lo que cambia (una fecha en null explícito la borra).
@router.put("/materia-prima/lineas/{id_linea}")
async def cambiar_linea(
    id_linea: int,
    dto: CambiosLinea,
    request: Request,
    forzar: bool = Query(False),
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio PUT /materia-prima/lineas/{id_linea} "
                f"({', '.join(sorted(dto.model_fields_set)) or 'nada'})")
    r = await MateriaPrimaOTService(db).cambiar(id_linea, dto, usuario, forzar)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)


# 🔹 Borrar una línea (409 si tiene consumos o está pedida; ?forzar=true la borra igual).
@router.delete("/materia-prima/lineas/{id_linea}")
async def borrar_linea(
    id_linea: int,
    request: Request,
    forzar: bool = Query(False),
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio DELETE /materia-prima/lineas/{id_linea}")
    r = await MateriaPrimaOTService(db).borrar(id_linea, usuario, forzar)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)
