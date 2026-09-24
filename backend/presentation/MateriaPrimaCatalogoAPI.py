"""Materia prima › catálogo de insumos (spec §2.1): materiales, calidades, formatos,
proveedores, insumos, su stock, recortes, precios y las OT donde se usaron.

Política «materia_prima_catalogo» (core/permisos_rutas.py): leer pide la sección
Materia prima de Operaciones; escribir, esa sección en «editar». Ojo: previsualizar es
un POST que no escribe nada, pero la política mira el método; sólo la usa el alta, que
ya pide «editar».

Las reglas están en application/MateriaPrimaCatalogoService.py (y el núcleo que
comparten las tres APIs, en application/materia_prima/). Acá sólo se reciben los datos,
se pasa el usuario del token y se deja dicha la frase para Auditoría.

Rutas fijas ANTES que las con {id} (tests/test_rutas_en_orden.py): previsualizar va
antes que /insumos/{id_pieza}.

Los borrados de movimientos y consumos no existen: se ANULAN con un PUT a /anular (el
renglón queda, y el registro de auditoría no diría «eliminó» algo que sigue ahí).
"""
from fastapi import APIRouter, Depends, Request

from backend.application.MateriaPrimaCatalogoService import MateriaPrimaCatalogoService
from backend.application.materia_prima.dueno import aviso_dueno, dueno, solo_si_spmm_es_dueno
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user
from backend.dto.MateriaPrimaCatalogoDTO import (
    AnularMovimientoIn,
    CalidadIn,
    InsumoCambiosIn,
    InsumoIn,
    MaterialIn,
    MovimientoIn,
    PrecioIn,
    PrevisualizarIn,
    ProveedorIn,
    RecorteCambiosIn,
    RecorteIn,
)
from backend.infrastructure.db import SessionLocal
from backend.infrastructure.historial_cambios import dejar_dicho_alta, id_de_respuesta

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


def _dejar_dicha_alta(request: Request, servicio: MateriaPrimaCatalogoService, resultado) -> None:
    """En un alta el id todavía no está en la dirección: sin esto la fila del registro
    no se ata a lo que se creó."""
    dejar_dicho_alta(request, id_entidad=id_de_respuesta(resultado), frase=servicio.frase)


# ═══════════════════════════ catálogos chicos ═══════════════════════════

# 🔹 Los catálogos del alta de insumos: materiales (con sus calidades), formatos (con
#    qué mide cada medida), unidades, tipos y el espesor de la sierra. Y quién es el
#    dueño de las materias primas: `dueno` ('integral' | 'spmm') y `aviso_dueno`, el
#    texto del cartel (null con SPMM como dueño). Es el primer pedido de la sección, así
#    la pantalla sabe desde el arranque si mostrar el cartel y esconder lo que escribe.
@router.get("/materia-prima/catalogos")
async def catalogos(db=Depends(get_db)):
    logger.info("API - Inicio GET /materia-prima/catalogos")
    respuesta = await MateriaPrimaCatalogoService(db).catalogos()
    respuesta.data["dueno"] = dueno()
    respuesta.data["aviso_dueno"] = aviso_dueno()
    return respuesta


# 🔹 Alta de un material (422 si ya existe con otro uso de mayúsculas o espacios)
@router.post("/materia-prima/materiales")
async def crear_material(dto: MaterialIn, request: Request, db=Depends(get_db)):
    logger.info("API - Inicio POST /materia-prima/materiales")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.crear_material(dto)
    _dejar_dicha_alta(request, servicio, resultado)
    return resultado


# 🔹 Alta de una calidad de un material
@router.post("/materia-prima/materiales/{id_material}/calidades")
async def crear_calidad(id_material: int, dto: CalidadIn, request: Request, db=Depends(get_db)):
    logger.info(f"API - Inicio POST /materia-prima/materiales/{id_material}/calidades")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.crear_calidad(id_material, dto)
    _dejar_dicho(request, servicio.frase)
    return resultado


# ═══════════════════════════ proveedores ═══════════════════════════

# 🔹 Buscar proveedores (cada palabra en razón social, fantasía o CUIT)
@router.get("/materia-prima/proveedores")
async def listar_proveedores(search: str | None = None, limit: int = 30,
                             incluir_inactivos: bool = False, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /materia-prima/proveedores (search={search!r})")
    return await MateriaPrimaCatalogoService(db).listar_proveedores(search, limit, incluir_inactivos)


# 🔹 Alta rápida de un proveedor (409 si ya hay uno que se llama igual; ?forzar=true)
@router.post("/materia-prima/proveedores")
async def crear_proveedor(dto: ProveedorIn, request: Request, forzar: bool = False,
                          db=Depends(get_db), usuario: dict = Depends(get_current_user)):
    logger.info("API - Inicio POST /materia-prima/proveedores")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.crear_proveedor(dto, usuario, forzar)
    _dejar_dicha_alta(request, servicio, resultado)
    return resultado


# ═══════════════════════════ insumos ═══════════════════════════

# 🔹 La lista de insumos, paginada del lado del servidor
@router.get("/materia-prima/insumos")
async def listar_insumos(
    search: str | None = None,
    tipo: str | None = None,
    id_material: int | None = None,
    id_formato: int | None = None,
    con_stock: bool = False,
    bajo_minimo: bool = False,
    con_minimo: bool = False,
    inactivos: bool = False,
    page: int = 1,
    size: int = 50,
    db=Depends(get_db),
):
    logger.info(f"API - Inicio GET /materia-prima/insumos (search={search!r}, page={page})")
    return await MateriaPrimaCatalogoService(db).listar_insumos(
        search=search, tipo=tipo, id_material=id_material, id_formato=id_formato,
        con_stock=con_stock, bajo_minimo=bajo_minimo, con_minimo=con_minimo,
        inactivos=inactivos, page=page, size=size,
    )


# 🔹 Vista previa del alta: descripción armada, código sugerido, qué falta y duplicados.
#    Va ANTES que /insumos/{id_pieza}.
@router.post("/materia-prima/insumos/previsualizar")
async def previsualizar_insumo(dto: PrevisualizarIn, db=Depends(get_db)):
    logger.info("API - Inicio POST /materia-prima/insumos/previsualizar")
    return await MateriaPrimaCatalogoService(db).previsualizar(dto)


# 🔹 Alta de un insumo (409 si ya existe otro activo con la misma descripción; ?forzar=true)
@router.post("/materia-prima/insumos")
async def crear_insumo(dto: InsumoIn, request: Request, forzar: bool = False,
                       db=Depends(get_db), usuario: dict = Depends(get_current_user)):
    logger.info("API - Inicio POST /materia-prima/insumos")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.crear_insumo(dto, usuario, forzar)
    _dejar_dicha_alta(request, servicio, resultado)
    return resultado


# 🔹 La ficha de un insumo
@router.get("/materia-prima/insumos/{id_pieza}")
async def ficha_insumo(id_pieza: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /materia-prima/insumos/{id_pieza}")
    return await MateriaPrimaCatalogoService(db).ficha(id_pieza)


# 🔹 Edición parcial (sin código ni precio). 409 si la descripción nueva ya la tiene
#    otro insumo activo; ?forzar=true
@router.put("/materia-prima/insumos/{id_pieza}")
async def editar_insumo(id_pieza: int, dto: InsumoCambiosIn, request: Request,
                        forzar: bool = False, db=Depends(get_db),
                        usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio PUT /materia-prima/insumos/{id_pieza}")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.editar_insumo(id_pieza, dto, usuario, forzar)
    _dejar_dicho(request, servicio.frase)
    return resultado


# 🔹 Borrar un insumo que nunca se usó (si se usó: 422, se marca inactivo)
@router.delete("/materia-prima/insumos/{id_pieza}")
async def eliminar_insumo(id_pieza: int, request: Request, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /materia-prima/insumos/{id_pieza}")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.eliminar_insumo(id_pieza)
    _dejar_dicho(request, servicio.frase)
    return resultado


# ═══════════════════════════ stock ═══════════════════════════

# 🔹 Los movimientos de stock con su saldo, y las reservas vigentes
@router.get("/materia-prima/insumos/{id_pieza}/movimientos")
async def movimientos_insumo(id_pieza: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /materia-prima/insumos/{id_pieza}/movimientos")
    return await MateriaPrimaCatalogoService(db).movimientos(id_pieza)


# 🔹 Ingreso / egreso / ajuste a mano (409 si deja el stock negativo; ?forzar=true)
@router.post("/materia-prima/insumos/{id_pieza}/movimientos")
async def registrar_movimiento(id_pieza: int, dto: MovimientoIn, request: Request,
                               forzar: bool = False, db=Depends(get_db),
                               usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio POST /materia-prima/insumos/{id_pieza}/movimientos ({dto.tipo})")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.registrar_movimiento(id_pieza, dto, usuario, forzar)
    _dejar_dicho(request, servicio.frase)
    return resultado


# 🔹 Anular un movimiento: deja de sumar, el renglón queda
@router.put("/materia-prima/movimientos/{id_movimiento}/anular")
async def anular_movimiento(id_movimiento: int, request: Request,
                            dto: AnularMovimientoIn | None = None, db=Depends(get_db),
                            usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio PUT /materia-prima/movimientos/{id_movimiento}/anular")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.anular_movimiento(id_movimiento, dto, usuario)
    _dejar_dicho(request, servicio.frase)
    return resultado


# ═══════════════════════════ recortes ═══════════════════════════

@router.get("/materia-prima/insumos/{id_pieza}/recortes")
async def recortes_insumo(id_pieza: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /materia-prima/insumos/{id_pieza}/recortes")
    return await MateriaPrimaCatalogoService(db).recortes(id_pieza)


@router.post("/materia-prima/insumos/{id_pieza}/recortes")
async def crear_recorte(id_pieza: int, dto: RecorteIn, request: Request, db=Depends(get_db),
                        usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio POST /materia-prima/insumos/{id_pieza}/recortes")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.crear_recorte(id_pieza, dto, usuario)
    _dejar_dicho(request, servicio.frase)
    return resultado


@router.put("/materia-prima/recortes/{id_recorte}")
async def editar_recorte(id_recorte: int, dto: RecorteCambiosIn, request: Request,
                         db=Depends(get_db), usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio PUT /materia-prima/recortes/{id_recorte}")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.editar_recorte(id_recorte, dto, usuario)
    _dejar_dicho(request, servicio.frase)
    return resultado


@router.delete("/materia-prima/recortes/{id_recorte}")
async def eliminar_recorte(id_recorte: int, request: Request, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /materia-prima/recortes/{id_recorte}")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.eliminar_recorte(id_recorte)
    _dejar_dicho(request, servicio.frase)
    return resultado


# ═══════════════════════════ OT donde se usó y precios ═══════════════════════════

@router.get("/materia-prima/insumos/{id_pieza}/ots")
async def ots_del_insumo(id_pieza: int, limit: int = 200, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /materia-prima/insumos/{id_pieza}/ots")
    return await MateriaPrimaCatalogoService(db).ots(id_pieza, limit)


@router.get("/materia-prima/insumos/{id_pieza}/precios")
async def precios_del_insumo(id_pieza: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /materia-prima/insumos/{id_pieza}/precios")
    return await MateriaPrimaCatalogoService(db).precios(id_pieza)


# 🔹 Cargar un precio a mano (si es el más nuevo, pasa a ser el vigente)
@router.post("/materia-prima/insumos/{id_pieza}/precios")
async def cargar_precio(id_pieza: int, dto: PrecioIn, request: Request, db=Depends(get_db),
                        usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio POST /materia-prima/insumos/{id_pieza}/precios")
    servicio = MateriaPrimaCatalogoService(db)
    resultado = await servicio.cargar_precio(id_pieza, dto, usuario)
    _dejar_dicho(request, servicio.frase)
    return resultado
