"""Materia prima › Pendientes (la pantalla de compras por semana) y la cañera (spec §2.3).

Política «materia_prima_pendientes» (core/permisos_rutas.py): leer pide la sección
Materia prima de Operaciones; escribir, esa sección en «editar».

Las reglas viven en application/MateriaPrimaPendientesService.py (qué OT entran, la
semana por el plan, los filtros, la cañera); la grilla de la cañera la da su método
`canera()` (sobre application/materia_prima/canera.canera_vigente), que es también lo que
devuelven asignar, mover y liberar (la pantalla redibuja con eso y no vuelve a pedir).
Las fechas con hora salen sin microsegundos, como en toda la sección.

RUTAS FIJAS ANTES QUE LAS CON {id} (tests/test_rutas_en_orden.py): POST
/materia-prima/canera/liberar-terminadas va arriba de las rutas con {id_ocupacion}.

`?forzar=true` es el «Hacerlo igual» del 409 (avisar, no bloquear).
"""
from datetime import date

from fastapi import APIRouter, Depends, Query, Request

from backend.application.MateriaPrimaPendientesService import MateriaPrimaPendientesService
from backend.application.materia_prima.dueno import solo_si_spmm_es_dueno
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user
from backend.dto.MateriaPrimaPendientesRequestDTO import AsignarCeldaIn, MoverCeldaIn
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


# 🔹 Pendientes: las líneas a comprar de las OT de la semana (o de todas las abiertas, o
#    de una OT), con el resumen de las tarjetas.
@router.get("/materia-prima/pendientes")
async def ver_pendientes(
    semana: date | None = None,
    todas_abiertas: bool = False,
    ot: str | None = None,
    filtro: str = "pendientes",
    search: str | None = None,
    id_proveedor: int | None = None,
    proveedor: str | None = None,
    db=Depends(get_db),
):
    logger.info(f"API - Inicio GET /materia-prima/pendientes (semana={semana}, "
                f"todas_abiertas={todas_abiertas}, ot={ot}, filtro={filtro})")
    return _ok(await MateriaPrimaPendientesService(db).pendientes(
        semana=semana, todas_abiertas=todas_abiertas, ot=ot, filtro=filtro,
        search=search, id_proveedor=id_proveedor, proveedor=proveedor,
    ))


# 🔹 La cañera: la grilla A..O × 1..9 y qué OT ocupa cada casillero ahora.
@router.get("/materia-prima/canera")
async def ver_canera(db=Depends(get_db)):
    logger.info("API - Inicio GET /materia-prima/canera")
    return _ok(await MateriaPrimaPendientesService(db).canera())


# 🔹 Liberar los casilleros de las OT terminadas. ANTES que las rutas con {id_ocupacion}.
@router.post("/materia-prima/canera/liberar-terminadas")
async def liberar_terminadas(
    request: Request,
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info("API - Inicio POST /materia-prima/canera/liberar-terminadas")
    r = await MateriaPrimaPendientesService(db).liberar_terminadas(usuario)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)


# 🔹 Ubicar una OT en un casillero («E4»).
@router.post("/materia-prima/canera")
async def asignar_celda(
    dto: AsignarCeldaIn,
    request: Request,
    forzar: bool = Query(False),
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio POST /materia-prima/canera ({dto.celda} ← {dto.numero_ot})")
    r = await MateriaPrimaPendientesService(db).asignar(dto.celda, dto.numero_ot, usuario, forzar)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)


# 🔹 Pasar una OT a otro casillero.
@router.put("/materia-prima/canera/{id_ocupacion}/mover")
async def mover_celda(
    id_ocupacion: int,
    dto: MoverCeldaIn,
    request: Request,
    forzar: bool = Query(False),
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio PUT /materia-prima/canera/{id_ocupacion}/mover ({dto.celda})")
    r = await MateriaPrimaPendientesService(db).mover(id_ocupacion, dto.celda, usuario, forzar)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)


# 🔹 Liberar un casillero (la fila queda como historial).
@router.delete("/materia-prima/canera/{id_ocupacion}")
async def liberar_celda(
    id_ocupacion: int,
    request: Request,
    db=Depends(get_db),
    usuario: dict = Depends(get_current_user),
):
    logger.info(f"API - Inicio DELETE /materia-prima/canera/{id_ocupacion}")
    r = await MateriaPrimaPendientesService(db).liberar(id_ocupacion, usuario)
    _dejar_dicho(request, r.frase)
    return _ok(r.data)
