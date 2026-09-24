"""El catálogo de insumos de la sección Materia prima (spec §2.1).

Lo que persigue este archivo no es que los endpoints contesten 200, sino las formas en
que el catálogo deja de servir:

  1. **Que el código se rompa.** Un código repetido, uno editado después del alta o el
     «XXX001001» del viejo rompen las facturas, que se siguen haciendo allá.
  2. **Que la misma barra se cargue dos veces.** El aviso de duplicado compara la
     descripción normalizada (el viejo la escribe con 2 y con 4 espacios) y la
     descripción de un 'insumo' se arma en UN solo lugar.
  3. **Que la descripción mienta.** Cambiar medidas o material la regenera; tocar sólo
     la ubicación no la reescribe.
  4. **Que el stock no sea la suma de movimientos**, que un egreso deje negativo sin
     avisar, o que el saldo de la solapa no cuadre con el físico.
  5. **Que se borre algo que se usó** (se marca inactivo), o un precio viejo pise el
     vigente.
  6. **Que la lista sea N+1**: con 17.800 piezas, la página de 50 no puede hacer una
     consulta por pieza.
"""
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select

from backend.application.MateriaPrimaCatalogoService import MateriaPrimaCatalogoService
from backend.application.materia_prima import stock
from backend.application.materia_prima.catalogo_texto import norm_proveedor, tokens
from backend.application.materia_prima.semilla import sembrar_formatos
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user, get_usuario_verificado
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.Material import Material
from backend.domain.MaterialCalidad import MaterialCalidad
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.Pieza import Pieza
from backend.domain.PiezaPrecio import PiezaPrecio
from backend.domain.PiezaRecorte import PiezaRecorte
from backend.domain.Prioridad import Prioridad
from backend.domain.Proveedor import Proveedor
from backend.domain.Sector import Sector
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
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.presentation import MateriaPrimaCatalogoAPI

MAXI = {"id_usuario": 7, "username": "maxi", "nombre": "Maxi", "apellido": "Pérez", "rol": "supervisor"}

ACERO, ALUMINIO, BRONCE = 1, 2, 3
SAE1045, SAE1010, LATON = 11, 12, 13
# Piezas del mundo
ABC077, ABR203, COR, YG, PORC, VIEJO_INACTIVO, SIN_TIPO = 70, 71, 72, 73, 74, 75, 76
OT_A, OT_B = 10, 11  # números 15010 y 15011 (la B, terminada)


async def _mundo(session) -> dict[str, int]:
    """Materiales, calidades, los formatos de la semilla, dos OT y piezas como las del
    viejo: con 4 espacios, con espacio en el código, con % en el código, inactiva y sin
    clasificar."""
    formatos = await sembrar_formatos(session)
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja de acero", abreviatura="BAND"),
        Cliente(id=1, nombre="ACME SRL"),
        Material(id=ACERO, nombre="ACERO"),
        Material(id=ALUMINIO, nombre="ALUMINIO", letra_codigo="A"),
        Material(id=BRONCE, nombre="BRONCE"),
    ])
    await session.flush()
    session.add_all([
        MaterialCalidad(id=SAE1045, id_material=ACERO, nombre="SAE 1045"),
        MaterialCalidad(id=SAE1010, id_material=ACERO, nombre="SAE 1010"),
        MaterialCalidad(id=LATON, id_material=BRONCE, nombre="LATON"),
        OrdenTrabajo(id=OT_A, id_otvieja=15010, id_prioridad=1, id_sector=1, id_articulo=1,
                     id_cliente=1, unidades=3, fecha_orden=datetime(2026, 9, 1),
                     fecha_entrada=datetime(2026, 9, 1), fecha_prometida=datetime(2026, 10, 1),
                     finalizadototal=0),
        OrdenTrabajo(id=OT_B, id_otvieja=15011, id_prioridad=1, id_sector=1, id_articulo=1,
                     id_cliente=1, unidades=3, fecha_orden=datetime(2026, 8, 1),
                     fecha_entrada=datetime(2026, 8, 1), fecha_prometida=datetime(2026, 9, 1),
                     finalizadototal=1),
        # Como lo escribe el viejo: 4 espacios antes del material.
        Pieza(id=ABC077, cod_pieza="ABC077", descripcion="BARRA CUADRADO 38.1mm    ACERO SAE 1045",
              tipo="insumo", id_material=ACERO, id_calidad=SAE1045,
              id_formato=formatos["BARRA CUADRADO"], medida1=38.1, unidad="MTS",
              stockactual=0.0, estante="C1", letra="D", nro="6", origen="legacy",
              proveedor="HIERROS SA", unitario=1500.0, fecha_ultimo_precio=date(2026, 8, 10)),
        Pieza(id=ABR203, cod_pieza="ABR203", descripcion="BARRA REDONDO 19mm ACERO SAE 1010",
              tipo="insumo", id_material=ACERO, id_calidad=SAE1010,
              id_formato=formatos["BARRA REDONDO"], medida1=19, unidad="MTS", stockactual=0.0,
              origen="legacy"),
        Pieza(id=COR, cod_pieza="COR2550", descripcion="CORREA A-42", tipo="insumo_desc",
              unidad="UN", stockactual=0.0, origen="legacy"),
        Pieza(id=YG, cod_pieza="YG 008", descripcion="YUGO DE BRONCE", tipo="insumo_desc",
              unidad="UN", stockactual=0.0, origen="legacy"),
        Pieza(id=PORC, cod_pieza="50%004", descripcion="TUERCA 50% NYLON", tipo="consumible",
              unidad="UN", stockactual=0.0, origen="legacy"),
        Pieza(id=VIEJO_INACTIVO, cod_pieza="ABC010",
              descripcion="BARRA CUADRADO 20mm ACERO SAE 1045", tipo="insumo", inactivo=1,
              unidad="MTS", stockactual=0.0, origen="legacy"),
        Pieza(id=SIN_TIPO, cod_pieza=" CO002", descripcion="CODO 20 MM IPS", tipo=None,
              unidad="Un", stockactual=None),
    ])
    await session.commit()
    return formatos


def _svc(session) -> MateriaPrimaCatalogoService:
    return MateriaPrimaCatalogoService(session)


def _barra_cuadrada(formatos, lado=25.4, **extra) -> dict:
    datos = dict(tipo="insumo", id_material=ACERO, id_calidad=SAE1045,
                 id_formato=formatos["BARRA CUADRADO"], sistema_medida="mm",
                 medidas=[lado, None, None, None, None], unidad="MTS")
    datos.update(extra)
    return datos


# ─────────────────────── textos: búsqueda y proveedores ───────────────────────

def test_las_palabras_de_la_busqueda_sin_repetir_ni_vacias():
    assert tokens("  barra   19  Barra acero ") == ["barra", "19", "acero"]
    assert tokens(None) == [] and tokens("   ") == []


def test_un_proveedor_es_el_mismo_con_o_sin_sa_y_acentos():
    assert norm_proveedor("Aceros  Zapla S.A.") == norm_proveedor("ACEROS ZAPLA")
    assert norm_proveedor("Metalúrgica Sur SRL") == "METALURGICA SUR"
    assert norm_proveedor("Metalurgica Sur S.R.L.") == "METALURGICA SUR"
    assert norm_proveedor("ACEROS ZAPLA NORTE") != norm_proveedor("ACEROS ZAPLA")
    # Un nombre que ES sólo la sigla no se vacía.
    assert norm_proveedor("SA") == "SA"


# ─────────────────────── materiales, calidades, catálogos ───────────────────────

@pytest.mark.asyncio
async def test_material_y_calidad_nuevos_y_sus_duplicados(session):
    await _mundo(session)
    svc = _svc(session)
    r = await svc.crear_material(MaterialIn(nombre="  Plasticos  ", letra_codigo="p"))
    assert r.data == {"id": r.data["id"], "nombre": "Plasticos", "letra_codigo": "P", "calidades": []}

    # «Acero» es el ACERO que ya existe: mismo material con otra letra de caja.
    with pytest.raises(BusinessException, match="Ya existe el material ACERO"):
        await svc.crear_material(MaterialIn(nombre="acero"))
    with pytest.raises(BusinessException, match="1 o 2 letras"):
        await svc.crear_material(MaterialIn(nombre="GOMA", letra_codigo="ABC"))
    with pytest.raises(BusinessException, match="obligatorio"):
        await svc.crear_material(MaterialIn(nombre="   "))

    c = await svc.crear_calidad(ACERO, CalidadIn(nombre="SAE  4140"))
    assert c.data["nombre"] == "SAE 4140" and c.data["id_material"] == ACERO
    with pytest.raises(BusinessException, match="ya tiene la calidad SAE 1045"):
        await svc.crear_calidad(ACERO, CalidadIn(nombre="sae 1045"))
    # La misma calidad en OTRO material sí va.
    assert (await svc.crear_calidad(BRONCE, CalidadIn(nombre="SAE 1045"))).status
    with pytest.raises(NotFoundException):
        await svc.crear_calidad(999, CalidadIn(nombre="X"))

    cat = (await svc.catalogos()).data
    acero = next(m for m in cat["materiales"] if m["id"] == ACERO)
    assert [c["nombre"] for c in acero["calidades"]] == ["SAE 1010", "SAE 1045", "SAE 4140"]


# ─────────────────────── proveedores ───────────────────────

@pytest.mark.asyncio
async def test_proveedores_busqueda_por_palabras_y_alta_con_aviso_de_duplicado(session):
    await _mundo(session)
    session.add_all([
        Proveedor(id=1, razon_social="Aceros Zapla S.A.", fantasia="ZAPLA", cuit="30-11111111-9"),
        Proveedor(id=2, razon_social="Hierros del Sur SRL", cuit="30-22222222-9"),
        Proveedor(id=3, razon_social="Bulonera Vieja", inactivo=1),
    ])
    await session.commit()
    svc = _svc(session)

    r = await svc.listar_proveedores("sur hierros")
    assert [p["id"] for p in r.data] == [2]
    assert [p["id"] for p in (await svc.listar_proveedores("2222")).data] == [2]
    assert [p["id"] for p in (await svc.listar_proveedores("")).data] == [1, 2]
    todos = (await svc.listar_proveedores("", incluir_inactivos=True)).data
    assert [p["id"] for p in todos] == [1, 3, 2]
    assert todos[1]["inactivo"] is True

    # «ACEROS ZAPLA» es el mismo que «Aceros Zapla S.A.»: avisa.
    with pytest.raises(ConfirmacionRequeridaException, match="Aceros Zapla S.A."):
        await svc.crear_proveedor(ProveedorIn(razon_social="ACEROS ZAPLA"), MAXI)
    # El nombre de fantasía también cuenta.
    with pytest.raises(ConfirmacionRequeridaException):
        await svc.crear_proveedor(ProveedorIn(razon_social="Zapla"), MAXI)
    # Y el CUIT, con o sin guiones.
    with pytest.raises(ConfirmacionRequeridaException, match="mismo CUIT"):
        await svc.crear_proveedor(ProveedorIn(razon_social="Otro nombre", cuit="30222222229"), MAXI)

    nuevo = (await svc.crear_proveedor(ProveedorIn(razon_social="ACEROS ZAPLA"), MAXI,
                                       forzar=True)).data
    assert nuevo["razon_social"] == "ACEROS ZAPLA" and nuevo["inactivo"] is False
    guardado = await session.get(Proveedor, nuevo["id"])
    assert guardado.creado_por == "Maxi Pérez" and guardado.creado_en is not None

    with pytest.raises(BusinessException, match="razón social"):
        await svc.crear_proveedor(ProveedorIn(razon_social="  "), MAXI)


# ─────────────────────── vista previa: descripción, código, duplicados ───────────────────────

@pytest.mark.asyncio
async def test_la_vista_previa_arma_la_descripcion_el_codigo_y_encuentra_el_duplicado(session):
    formatos = await _mundo(session)
    svc = _svc(session)

    r = (await svc.previsualizar(PrevisualizarIn(**{
        k: v for k, v in _barra_cuadrada(formatos, 38.1).items() if k != "unidad"}))).data
    assert r["descripcion"] == "BARRA CUADRADO 38.1mm ACERO SAE 1045"
    # ABC077 es el máximo de A + BC; el inactivo ABC010 no cambia nada.
    assert r["codigo_sugerido"] == "ABC078"
    assert r["faltan"] == []
    # La del viejo tiene 4 espacios: es la misma barra.
    assert r["duplicados"] == [{"id": ABC077, "codigo": "ABC077",
                                "descripcion": "BARRA CUADRADO 38.1mm    ACERO SAE 1045"}]

    # En la edición, el propio insumo no es su duplicado.
    r = (await svc.previsualizar(PrevisualizarIn(**{
        **{k: v for k, v in _barra_cuadrada(formatos, 38.1).items() if k != "unidad"},
        "excluir_id": ABC077}))).data
    assert r["duplicados"] == []

    # Lo que falta, con el nombre que ve la pantalla.
    r = (await svc.previsualizar(PrevisualizarIn(
        tipo="insumo", id_formato=formatos["TUBO RECTANGULAR"], medidas=[70, None, 2]))).data
    assert r["descripcion"] is None and r["faltan"] == ["Lado B", "Material"]
    assert r["codigo_sugerido"] is None

    # En pulgadas la descripción dice la fracción y los mm.
    r = (await svc.previsualizar(PrevisualizarIn(
        tipo="insumo", id_material=ALUMINIO, id_formato=formatos["PLANCHUELA"],
        sistema_medida="pulgada", medidas=[25.4, 6.35]))).data
    assert r["descripcion"] == 'PLANCHUELA 1" (25.4mm) x 1/4" (6.35mm) ALUMINIO'
    assert r["codigo_sugerido"] == "AP001"

    # Una calidad de otro material en la vista previa no rompe: se ignora (el alta la rechaza).
    r = (await svc.previsualizar(PrevisualizarIn(
        tipo="insumo", id_material=ACERO, id_calidad=LATON, id_formato=formatos["BARRA REDONDO"],
        medidas=[19]))).data
    assert r["descripcion"] == "BARRA REDONDO 19mm ACERO"

    # Descripción libre: el prefijo son las 3 primeras letras o números.
    r = (await svc.previsualizar(PrevisualizarIn(tipo="insumo_desc", descripcion="Correa  B-50"))).data
    assert r["descripcion"] == "Correa B-50" and r["codigo_sugerido"] == "COR2551"
    r = (await svc.previsualizar(PrevisualizarIn(tipo="consumible", descripcion=" "))).data
    assert r["faltan"] == ["Descripción"] and r["codigo_sugerido"] is None


# ─────────────────────── alta ───────────────────────

@pytest.mark.asyncio
async def test_alta_con_codigo_sugerido_descripcion_armada_y_precio_inicial(session):
    formatos = await _mundo(session)
    r = await _svc(session).crear_insumo(InsumoIn(**_barra_cuadrada(
        formatos, 50.8, sistema_medida="pulgada",
        # Una segunda medida que el formato no pide no es un dato del insumo.
        medidas=[50.8, 9, None, None, None],
        # La descripción que mande la pantalla no manda: se arma.
        descripcion="cualquier cosa", unitario=2500, estante=" C1 ", stock_minimo=3,
    )), MAXI)
    ficha = r.data
    assert ficha["codigo"] == "ABC078"
    assert ficha["descripcion"] == 'BARRA CUADRADO 2" (50.8mm) ACERO SAE 1045'
    assert ficha["medidas"] == [50.8, None, None, None, None]
    assert ficha["sistema_medida"] == "pulgada" and ficha["tipo"] == "insumo"
    assert ficha["material"] == "ACERO" and ficha["calidad"] == "SAE 1045"
    assert ficha["formato"] == "BARRA CUADRADO"
    assert ficha["stock"] == 0.0 and ficha["libre"] == 0.0 and ficha["usos_en_ot"] == 0
    assert ficha["estante"] == "C1" and ficha["stock_minimo"] == 3.0
    assert ficha["origen"] == "spmm" and ficha["creado_por"] == "Maxi Pérez"
    assert ficha["unitario"] == 2500.0
    hoy = ahora_ar().date()
    assert ficha["fecha_ultimo_precio"] == hoy.isoformat()
    # Fecha sin zona ni microsegundos.
    assert len(ficha["creado_en"]) == 19 and "+" not in ficha["creado_en"]

    (precio,) = (await session.execute(select(PiezaPrecio))).scalars().all()
    assert (precio.origen, precio.precio, precio.fecha, precio.usuario) == \
        ("manual", 2500.0, hoy, "Maxi Pérez")

    # El siguiente del mismo prefijo sigue la serie.
    otro = await _svc(session).crear_insumo(InsumoIn(**_barra_cuadrada(formatos, 12)), MAXI)
    assert otro.data["codigo"] == "ABC079"
    assert otro.data["unitario"] is None and otro.data["fecha_ultimo_precio"] is None


@pytest.mark.asyncio
async def test_el_codigo_propio_no_puede_existir_ni_pasar_de_10(session):
    formatos = await _mundo(session)
    svc = _svc(session)
    # Normalizado: « abc077 » es ABC077.
    with pytest.raises(BusinessException, match="Ya existe el código ABC077"):
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, codigo=" abc077 ")), MAXI)
    with pytest.raises(BusinessException, match="Ya existe el código CO002"):
        await svc.crear_insumo(InsumoIn(tipo="consumible", descripcion="X", unidad="UN",
                                        codigo="co002"), MAXI)
    with pytest.raises(BusinessException, match="hasta 10"):
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, codigo="ABCDEFGHIJK")), MAXI)
    r = await svc.crear_insumo(InsumoIn(tipo="consumible", descripcion="Mecha 8mm",
                                        unidad="un", codigo="mec-8"), MAXI)
    assert r.data["codigo"] == "MEC-8" and r.data["unidad"] == "UN"


@pytest.mark.asyncio
async def test_descripcion_duplicada_avisa_y_con_forzar_se_crea(session):
    """El aviso compara la descripción normalizada y sólo contra insumos ACTIVOS: la
    barra de 20 mm está inactiva, así que cargarla de nuevo no avisa."""
    formatos = await _mundo(session)
    svc = _svc(session)
    with pytest.raises(ConfirmacionRequeridaException) as e:
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, 38.1)), MAXI)
    assert "Ya existe ABC077 – BARRA CUADRADO 38.1mm" in e.value.message
    # No quedó nada a medio guardar.
    assert (await session.execute(select(Pieza).where(Pieza.cod_pieza == "ABC078"))).first() is None

    r = await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, 38.1)), MAXI, forzar=True)
    assert r.data["codigo"] == "ABC078"

    r = await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, 20)), MAXI)
    assert r.data["descripcion"] == "BARRA CUADRADO 20mm ACERO SAE 1045"

    with pytest.raises(ConfirmacionRequeridaException, match="CORREA A-42"):
        await svc.crear_insumo(InsumoIn(tipo="insumo_desc", descripcion="correa  a-42",
                                        unidad="UN"), MAXI)


@pytest.mark.asyncio
async def test_el_alta_rechaza_lo_que_no_cierra(session):
    formatos = await _mundo(session)
    svc = _svc(session)
    with pytest.raises(BusinessException, match="falta: Lado"):
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, medidas=[])), MAXI)
    with pytest.raises(BusinessException, match="no es de ACERO"):
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, id_calidad=LATON)), MAXI)
    with pytest.raises(BusinessException, match="unidad"):
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, unidad="CAJA")), MAXI)
    with pytest.raises(BusinessException, match="tipo"):
        await svc.crear_insumo(InsumoIn(tipo="barra", descripcion="x", unidad="UN"), MAXI)
    with pytest.raises(BusinessException, match="descripción es obligatoria"):
        await svc.crear_insumo(InsumoIn(tipo="consumible", unidad="UN"), MAXI)
    with pytest.raises(BusinessException, match="milímetros"):
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, medidas=[-3])), MAXI)
    with pytest.raises(BusinessException, match="proveedor"):
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, id_proveedor=99)), MAXI)
    with pytest.raises(BusinessException, match="negativo"):
        await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, stock_minimo=-1)), MAXI)
    assert (await session.execute(select(Pieza).where(Pieza.origen == "spmm"))).first() is None


# ─────────────────────── edición ───────────────────────

@pytest.mark.asyncio
async def test_el_codigo_y_el_precio_no_se_editan(session):
    await _mundo(session)
    svc = _svc(session)
    with pytest.raises(BusinessException, match="código no se cambia"):
        await svc.editar_insumo(ABC077, InsumoCambiosIn(codigo="ABC999"), MAXI)
    with pytest.raises(BusinessException, match="solapa Precios"):
        await svc.editar_insumo(ABC077, InsumoCambiosIn(unitario=10), MAXI)
    # Iguales a lo que hay (la pantalla manda la ficha entera): no molestan.
    r = await svc.editar_insumo(ABC077, InsumoCambiosIn(codigo=" abc077", unitario=1500,
                                                         nro="7"), MAXI)
    assert r.data["codigo"] == "ABC077" and r.data["nro"] == "7"


@pytest.mark.asyncio
async def test_tocar_la_ubicacion_no_reescribe_la_descripcion_del_viejo(session):
    await _mundo(session)
    r = await _svc(session).editar_insumo(
        ABC077, InsumoCambiosIn(estante="C2", letra=None, observaciones="  al fondo  "), MAXI)
    assert r.data["descripcion"] == "BARRA CUADRADO 38.1mm    ACERO SAE 1045"
    assert (r.data["estante"], r.data["letra"], r.data["observaciones"]) == ("C2", None, "al fondo")
    assert r.data["modificado_por"] == "Maxi Pérez" and r.data["modificado_en"]


@pytest.mark.asyncio
async def test_cambiar_medidas_o_material_regenera_la_descripcion(session):
    formatos = await _mundo(session)
    svc = _svc(session)
    r = await svc.editar_insumo(ABC077, InsumoCambiosIn(medidas=[40]), MAXI)
    assert r.data["descripcion"] == "BARRA CUADRADO 40mm ACERO SAE 1045"

    # Cambiar el material sin cambiar la calidad deja una calidad de otro material: 422.
    with pytest.raises(BusinessException, match="no es de BRONCE"):
        await svc.editar_insumo(ABC077, InsumoCambiosIn(id_material=BRONCE), MAXI)
    r = await svc.editar_insumo(ABC077, InsumoCambiosIn(id_material=BRONCE, id_calidad=LATON), MAXI)
    assert r.data["descripcion"] == "BARRA CUADRADO 40mm BRONCE LATON"
    # El código NO cambia aunque ahora la letra sería otra: lo usan las facturas.
    assert r.data["codigo"] == "ABC077"

    # Una descripción distinta para un 'insumo' no se acepta: se arma sola.
    with pytest.raises(BusinessException, match="se arma sola"):
        await svc.editar_insumo(ABC077, InsumoCambiosIn(descripcion="BARRA LINDA"), MAXI)

    # Pasar un libre a 'insumo' arma la descripción; si faltan datos, dice cuáles.
    with pytest.raises(BusinessException, match="falta: Formato"):
        await svc.editar_insumo(COR, InsumoCambiosIn(tipo="insumo"), MAXI)
    r = await svc.editar_insumo(COR, InsumoCambiosIn(
        tipo="insumo", id_material=ACERO, id_formato=formatos["BARRA REDONDO"], medidas=[10]), MAXI)
    assert r.data["descripcion"] == "BARRA REDONDO 10mm ACERO" and r.data["codigo"] == "COR2550"

    # Y al revés: pasarlo a descripción libre deja escribirla.
    r = await svc.editar_insumo(COR, InsumoCambiosIn(tipo="insumo_desc",
                                                      descripcion="  Correa  A-42 larga "), MAXI)
    assert r.data["descripcion"] == "Correa A-42 larga" and r.data["tipo"] == "insumo_desc"
    with pytest.raises(BusinessException, match="obligatoria"):
        await svc.editar_insumo(COR, InsumoCambiosIn(descripcion=" "), MAXI)


@pytest.mark.asyncio
async def test_la_edicion_avisa_si_deja_dos_activos_con_la_misma_descripcion(session):
    """Mismo aviso que el alta: si la descripción que queda (o reactivar uno dado de baja)
    repite la de otro insumo activo, 409 y con forzar se guarda."""
    formatos = await _mundo(session)
    svc = _svc(session)
    igual_a_abc077 = InsumoCambiosIn(id_formato=formatos["BARRA CUADRADO"], id_calidad=SAE1045,
                                     medidas=[38.1])
    with pytest.raises(ConfirmacionRequeridaException, match="ABC077"):
        await svc.editar_insumo(ABR203, igual_a_abc077, MAXI)
    assert (await session.get(Pieza, ABR203)).descripcion == "BARRA REDONDO 19mm ACERO SAE 1010"
    r = await svc.editar_insumo(ABR203, igual_a_abc077, MAXI, forzar=True)
    assert r.data["descripcion"] == "BARRA CUADRADO 38.1mm ACERO SAE 1045"

    # ABC010 (inactivo) tiene la descripción de uno activo nuevo: reactivarlo avisa.
    await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, 20)), MAXI)
    with pytest.raises(ConfirmacionRequeridaException, match="ABC078"):
        await svc.editar_insumo(VIEJO_INACTIVO, InsumoCambiosIn(inactivo=False), MAXI)
    # Tocarle otra cosa sin reactivarlo no avisa (no hay dos activos).
    assert (await svc.editar_insumo(VIEJO_INACTIVO, InsumoCambiosIn(nro="3"), MAXI)).status


@pytest.mark.asyncio
async def test_inactivo_y_minimo_desde_la_ficha(session):
    await _mundo(session)
    pieza = await session.get(Pieza, ABC077)
    pieza.stock_minimo = 5
    pieza.stock_bajo_avisado_en = datetime(2026, 9, 20, 8)
    await session.commit()
    r = await _svc(session).editar_insumo(ABC077, InsumoCambiosIn(inactivo=True, stock_minimo=None), MAXI)
    assert r.data["inactivo"] is True and r.data["stock_minimo"] is None
    # Sin mínimo ya no está abajo: el aviso vigente deja de estarlo (como en /piezas).
    assert (await session.get(Pieza, ABC077)).stock_bajo_avisado_en is None
    with pytest.raises(NotFoundException):
        await _svc(session).editar_insumo(999, InsumoCambiosIn(nro="1"), MAXI)


# ─────────────────────── baja ───────────────────────

@pytest.mark.asyncio
async def test_se_borra_solo_lo_que_nunca_se_uso(session):
    formatos = await _mundo(session)
    svc = _svc(session)
    nuevo = (await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, 12, unitario=100)),
                                    MAXI)).data
    # El precio que se cargó en el alta es de SPMM: se va con el insumo.
    assert (await svc.eliminar_insumo(nuevo["id"])).data == {"id": nuevo["id"]}
    assert await session.get(Pieza, nuevo["id"]) is None
    assert (await session.execute(select(PiezaPrecio))).first() is None

    # Usado en una OT: 422 y qué hacer.
    otro = (await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, 13)), MAXI)).data
    session.add(OrdenTrabajoPieza(id=1, id_orden_trabajo=OT_A, id_pieza=otro["id"], cantidad=1))
    await session.commit()
    with pytest.raises(BusinessException, match="se usó en 1 OT. Marcalo como inactivo"):
        await svc.eliminar_insumo(otro["id"])

    # Con movimientos de stock o recortes, tampoco.
    tercero = (await svc.crear_insumo(InsumoIn(**_barra_cuadrada(formatos, 14)), MAXI)).data
    await svc.registrar_movimiento(tercero["id"], MovimientoIn(tipo="ingreso", cantidad=1), MAXI)
    await svc.crear_recorte(tercero["id"], RecorteIn(largo_mm=500), MAXI)
    with pytest.raises(BusinessException, match="tiene 1 movimiento de stock y tiene 1 recorte"):
        await svc.eliminar_insumo(tercero["id"])

    # Uno que vino del viejo volvería con el sync de altas.
    with pytest.raises(BusinessException, match="sistema viejo"):
        await svc.eliminar_insumo(ABR203)
    with pytest.raises(NotFoundException):
        await svc.eliminar_insumo(999)


# ─────────────────────── stock: movimientos y saldo ───────────────────────

@pytest.mark.asyncio
async def test_movimientos_saldo_acumulado_egreso_negativo_y_ajuste(session):
    await _mundo(session)
    svc = _svc(session)
    r = await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="ingreso", cantidad=10,
                                                            comentario="compra"), MAXI)
    r = await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="egreso", cantidad=3,
                                                            numero_ot=15010), MAXI)
    datos = r.data
    assert [(m["tipo"], m["ingreso"], m["egreso"], m["saldo"]) for m in datos["movimientos"]] == \
        [("ingreso", 10.0, None, 10.0), ("egreso", None, 3.0, 7.0)]
    assert datos["movimientos"][1]["numero_ot"] == 15010
    assert datos["movimientos"][1]["id_orden_trabajo"] == OT_A
    assert datos["movimientos"][0]["usuario"] == "Maxi Pérez"
    assert datos["fisico"] == 7.0 and datos["libre"] == 7.0
    assert (await session.get(Pieza, ABR203)).stockactual == 7.0

    # Un egreso que deja negativo avisa; con forzar entra.
    with pytest.raises(ConfirmacionRequeridaException, match="negativo"):
        await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="egreso", cantidad=8), MAXI)
    datos = (await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="egreso", cantidad=8),
                                            MAXI, forzar=True)).data
    assert datos["fisico"] == -1.0

    # El ajuste recibe lo contado y guarda la diferencia.
    datos = (await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="ajuste", saldo_nuevo=4.5),
                                            MAXI)).data
    ultimo = datos["movimientos"][-1]
    assert (ultimo["tipo"], ultimo["ingreso"], ultimo["saldo"]) == ("ajuste", 5.5, 4.5)
    assert ultimo["comentario"] == "Ajuste de inventario: -1 → 4.5"
    assert datos["fisico"] == 4.5
    with pytest.raises(BusinessException, match="ya es 4.5"):
        await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="ajuste", saldo_nuevo=4.5), MAXI)

    with pytest.raises(BusinessException, match="mayor a 0"):
        await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="ingreso", cantidad=-2), MAXI)
    with pytest.raises(BusinessException, match="obligatoria"):
        await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="egreso"), MAXI)
    with pytest.raises(BusinessException, match="retiro"):
        await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="retiro_ot", cantidad=1), MAXI)
    with pytest.raises(BusinessException, match="No existe la OT N° 99"):
        await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="ingreso", cantidad=1,
                                                            numero_ot=99), MAXI)
    with pytest.raises(NotFoundException):
        await svc.registrar_movimiento(999, MovimientoIn(tipo="ingreso", cantidad=1), MAXI)


@pytest.mark.asyncio
async def test_anular_recalcula_el_saldo_y_los_retiros_no_se_anulan_a_mano(session):
    await _mundo(session)
    svc = _svc(session)
    await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="ingreso", cantidad=10), MAXI)
    datos = (await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="egreso", cantidad=4), MAXI)).data
    id_egreso = datos["movimientos"][1]["id"]

    datos = (await svc.anular_movimiento(id_egreso, AnularMovimientoIn(motivo="era de otra barra"),
                                         MAXI)).data
    egreso = datos["movimientos"][1]
    assert egreso["anulado"] is True and egreso["saldo"] is None
    assert egreso["motivo_anulacion"] == "era de otra barra"
    assert egreso["anulado_por"] == "Maxi Pérez"
    assert datos["fisico"] == 10.0
    with pytest.raises(BusinessException, match="ya está anulado"):
        await svc.anular_movimiento(id_egreso, None, MAXI)

    retiro = await stock.registrar_movimiento(session, ABR203, "retiro_ot", -2, usuario=MAXI,
                                              id_orden_trabajo=OT_A)
    await session.commit()
    with pytest.raises(BusinessException, match="15010"):
        await svc.anular_movimiento(retiro.id, None, MAXI)
    with pytest.raises(NotFoundException):
        await svc.anular_movimiento(99999, None, MAXI)


@pytest.mark.asyncio
async def test_las_reservas_de_la_ficha_suman_lo_mismo_que_el_reservado(session):
    """La lista de reservas y el número «Reservado» salen de dos consultas: tienen que
    contar las mismas líneas (vigentes: reservada, usada y sin retirar)."""
    await _mundo(session)
    await _svc(session).registrar_movimiento(ABR203, MovimientoIn(tipo="ingreso", cantidad=20), MAXI)
    session.add_all([
        OrdenTrabajoPieza(id=1, id_orden_trabajo=OT_A, id_pieza=ABR203, cantidad=5, reserva=1,
                          cantidad_reservada=4, usado=1, disponible=0),
        OrdenTrabajoPieza(id=2, id_orden_trabajo=OT_B, id_pieza=ABR203, cantidad=3, reserva=1,
                          cantidad_reservada=3, usado=1, disponible=1),
        OrdenTrabajoPieza(id=3, id_orden_trabajo=OT_B, id_pieza=ABR203, cantidad=2, reserva=1,
                          cantidad_reservada=2, usado=0, disponible=0),
        OrdenTrabajoPieza(id=4, id_orden_trabajo=OT_B, id_pieza=ABR203, cantidad=1.5, reserva=1,
                          cantidad_reservada=1.5, usado=1, disponible=None),
    ])
    await session.commit()
    datos = (await _svc(session).movimientos(ABR203)).data
    assert datos["reservado"] == 5.5 and datos["libre"] == 14.5
    assert sum(r["cantidad_reservada"] for r in datos["reservas"]) == datos["reservado"]
    assert [(r["id_linea"], r["numero_ot"]) for r in datos["reservas"]] == [(1, 15010), (4, 15011)]


# ─────────────────────── recortes ───────────────────────

@pytest.mark.asyncio
async def test_recortes_alta_uso_en_ot_y_vuelta_atras(session):
    await _mundo(session)
    svc = _svc(session)
    corto = (await svc.crear_recorte(ABR203, RecorteIn(largo_mm=800), MAXI)).data
    largo = (await svc.crear_recorte(ABR203, RecorteIn(largo_mm=2777, cantidad=2,
                                                       observaciones="pintado"), MAXI)).data
    assert largo["estado"] == "disponible" and largo["creado_por"] == "Maxi Pérez"
    assert largo["cantidad"] == 2
    with pytest.raises(BusinessException, match="largo"):
        await svc.crear_recorte(ABR203, RecorteIn(), MAXI)
    with pytest.raises(BusinessException, match="entero"):
        await svc.crear_recorte(ABR203, RecorteIn(largo_mm=10, cantidad=0), MAXI)

    # Usarlo en una OT (por el número que ve la gente) deja quién y cuándo.
    usado = (await svc.editar_recorte(corto["id"], RecorteCambiosIn(estado="usado",
                                                                    numero_ot_uso=15010), MAXI)).data
    assert usado["estado"] == "usado" and usado["numero_ot_uso"] == 15010
    assert usado["id_orden_trabajo_uso"] == OT_A
    assert usado["usado_por"] == "Maxi Pérez" and usado["usado_en"]

    lista = (await svc.recortes(ABR203)).data
    # Disponibles primero.
    assert [r["id"] for r in lista] == [largo["id"], corto["id"]]
    # La fila de la lista cuenta los disponibles (2 del mismo largo).
    fila = (await svc.listar_insumos(search="ABR203")).data["data"][0]
    assert fila["recortes_disponibles"] == 2

    # Volver a disponible limpia el uso.
    vuelto = (await svc.editar_recorte(corto["id"], RecorteCambiosIn(estado="disponible",
                                                                     numero_ot_uso=None), MAXI)).data
    assert (vuelto["estado"], vuelto["usado_en"], vuelto["usado_por"], vuelto["numero_ot_uso"]) == \
        ("disponible", None, None, None)
    # Decir la OT sin el estado es «lo usé acá».
    otra = (await svc.editar_recorte(corto["id"], RecorteCambiosIn(numero_ot_uso=15011), MAXI)).data
    assert otra["estado"] == "usado" and otra["numero_ot_uso"] == 15011
    with pytest.raises(BusinessException, match="No existe la OT"):
        await svc.editar_recorte(corto["id"], RecorteCambiosIn(numero_ot_uso=1), MAXI)
    with pytest.raises(BusinessException, match="estado"):
        await svc.editar_recorte(corto["id"], RecorteCambiosIn(estado="perdido"), MAXI)

    assert (await svc.eliminar_recorte(corto["id"])).data == {"id": corto["id"]}
    assert await session.get(PiezaRecorte, corto["id"]) is None


# ─────────────────────── precios ───────────────────────

@pytest.mark.asyncio
async def test_un_precio_viejo_no_pisa_el_vigente(session):
    await _mundo(session)
    svc = _svc(session)
    lista = (await svc.cargar_precio(ABC077, PrecioIn(precio=1400, fecha=date(2026, 3, 1)), MAXI)).data
    pieza = await session.get(Pieza, ABC077)
    assert pieza.unitario == 1500.0 and pieza.fecha_ultimo_precio == date(2026, 8, 10)
    assert lista[0]["fecha"] == "2026-03-01" and lista[0]["origen"] == "manual"

    session.add(Proveedor(id=1, razon_social="HIERROS SA"))
    await session.commit()
    hoy = ahora_ar().date()
    lista = (await svc.cargar_precio(ABC077, PrecioIn(precio=1650.5, id_proveedor=1), MAXI)).data
    assert [p["precio"] for p in lista] == [1650.5, 1400.0]
    assert lista[0]["proveedor"] == "HIERROS SA" and lista[0]["usuario"] == "Maxi Pérez"
    pieza = await session.get(Pieza, ABC077)
    assert pieza.unitario == 1650.5 and pieza.fecha_ultimo_precio == hoy

    with pytest.raises(BusinessException, match="futura"):
        await svc.cargar_precio(ABC077, PrecioIn(precio=1, fecha=hoy + timedelta(days=1)), MAXI)
    with pytest.raises(BusinessException, match="mayor a 0"):
        await svc.cargar_precio(ABC077, PrecioIn(precio=0), MAXI)


# ─────────────────────── OT donde se usó ───────────────────────

@pytest.mark.asyncio
async def test_las_ot_donde_se_uso_mas_nuevas_primero(session):
    await _mundo(session)
    session.add_all([
        OrdenTrabajoPieza(id=1, id_orden_trabajo=OT_B, id_pieza=ABR203, cantidad=2,
                          unidad="Mts", pedido=1, disponible=1),
        OrdenTrabajoPieza(id=2, id_orden_trabajo=OT_A, id_pieza=ABR203, cantidad=1.5,
                          unidad="Mts", pedido=1, disponible=0, usado=0),
    ])
    await session.commit()
    ots = (await _svc(session).ots(ABR203)).data
    assert [o["numero_ot"] for o in ots] == [15010, 15011]
    assert ots[0] == {"id_linea": 2, "id_orden_trabajo": OT_A, "numero_ot": 15010,
                      "fecha_ot": "2026-09-01", "cliente": "ACME SRL",
                      "articulo": "Bandeja de acero", "cantidad": 1.5, "unidad": "Mts",
                      "pedido": True, "disponible": False, "reserva": False,
                      "cantidad_reservada": None, "usado": False, "finalizada": False}
    assert ots[1]["finalizada"] is True
    assert (await _svc(session).ficha(ABR203)).data["usos_en_ot"] == 2


# ─────────────────────── la lista ───────────────────────

@pytest.mark.asyncio
async def test_busqueda_por_palabras_en_cualquier_orden_y_con_espacios_del_viejo(session):
    await _mundo(session)
    svc = _svc(session)

    async def codigos(**filtros):
        return [f["codigo"] for f in (await svc.listar_insumos(**filtros)).data["data"]]

    # Todas las palabras, en cualquier orden, aunque el viejo tenga 4 espacios.
    assert await codigos(search="acero 38.1 barra") == ["ABC077"]
    assert await codigos(search="barra acero") == ["ABC077", "ABR203"]
    # «YG008» encuentra «YG 008».
    assert await codigos(search="yg008") == ["YG 008"]
    # El % del código no es un comodín.
    assert await codigos(search="50%") == ["50%004"]
    assert await codigos(search="0%0") == ["50%004"]
    # Por defecto sin inactivos; con el filtro, también ellos.
    assert "ABC010" not in await codigos(search="barra")
    assert "ABC010" in await codigos(search="barra", inactivos=True)
    # Sin clasificar cuenta como descripción libre.
    assert await codigos(tipo="insumo_desc") == ["CO002", "COR2550", "YG 008"]
    assert await codigos(tipo="consumible") == ["50%004"]
    with pytest.raises(BusinessException):
        await svc.listar_insumos(tipo="barra")


@pytest.mark.asyncio
async def test_paginado_orden_por_codigo_y_filtros_de_stock(session):
    await _mundo(session)
    svc = _svc(session)
    r = (await svc.listar_insumos(page=2, size=2)).data
    assert (r["total_count"], r["page"], r["size"], r["total_pages"]) == (6, 2, 2, 3)
    # Orden por código normalizado: « CO002» no va primero por el espacio.
    todos = [f["codigo"] for f in (await svc.listar_insumos(size=50)).data["data"]]
    assert todos == ["50%004", "ABC077", "ABR203", "CO002", "COR2550", "YG 008"]
    assert [f["codigo"] for f in r["data"]] == ["ABR203", "CO002"]

    await svc.registrar_movimiento(ABR203, MovimientoIn(tipo="ingreso", cantidad=3), MAXI)
    session.add(OrdenTrabajoPieza(id=1, id_orden_trabajo=OT_A, id_pieza=ABR203, cantidad=2,
                                  reserva=1, cantidad_reservada=2, usado=1, disponible=0))
    pieza = await session.get(Pieza, ABC077)
    pieza.stock_minimo = 1
    await session.commit()

    con_stock = (await svc.listar_insumos(con_stock=True)).data["data"]
    assert [f["codigo"] for f in con_stock] == ["ABR203"]
    assert (con_stock[0]["stock"], con_stock[0]["reservado"], con_stock[0]["libre"]) == (3.0, 2.0, 1.0)
    bajo = (await svc.listar_insumos(bajo_minimo=True)).data["data"]
    assert [f["codigo"] for f in bajo] == ["ABC077"] and bajo[0]["bajo_minimo"] is True
    assert [f["codigo"] for f in (await svc.listar_insumos(con_minimo=True)).data["data"]] == ["ABC077"]

    fila = next(f for f in (await svc.listar_insumos(search="ABC077")).data["data"])
    assert fila["proveedor"] == "HIERROS SA"  # el texto heredado, sin preferido
    assert fila["unitario"] == 1500.0 and fila["fecha_ultimo_precio"] == "2026-08-10"
    assert (fila["material"], fila["calidad"], fila["formato"]) == ("ACERO", "SAE 1045", "BARRA CUADRADO")


@pytest.mark.asyncio
async def test_la_pagina_no_hace_una_consulta_por_pieza(session):
    """Con 17.800 piezas, una consulta por fila es la pantalla colgada. La página de 5 y
    la de 40 tienen que hacer la MISMA cantidad de consultas."""
    await _mundo(session)
    for i in range(40):
        session.add(Pieza(cod_pieza=f"TOR{i:03d}", descripcion=f"TORNILLO {i}", tipo="consumible",
                          unidad="UN", stockactual=float(i)))
    await session.commit()
    ids = [p for p in (await session.execute(select(Pieza.id))).scalars().all()]
    for n, id_pieza in enumerate(ids[:10]):
        session.add(PiezaRecorte(id_pieza=id_pieza, largo_mm=100 + n, cantidad=1))
        session.add(OrdenTrabajoPieza(id_orden_trabajo=OT_A, id_pieza=id_pieza, cantidad=1,
                                      reserva=1, cantidad_reservada=0.5, usado=1, disponible=0))
    await session.commit()

    motor = session.bind.sync_engine
    consultas: list[str] = []

    def _contar(conn, cursor, statement, *args):
        consultas.append(statement)

    event.listen(motor, "before_cursor_execute", _contar)
    try:
        await _svc(session).listar_insumos(size=5)
        con_5 = len(consultas)
        consultas.clear()
        r = await _svc(session).listar_insumos(size=40)
        con_40 = len(consultas)
    finally:
        event.remove(motor, "before_cursor_execute", _contar)
    assert len(r.data["data"]) == 40
    assert con_5 == con_40 <= 5, (con_5, con_40)


# ─────────────────────── la ficha ───────────────────────

@pytest.mark.asyncio
async def test_la_ficha_trae_lo_heredado_y_lo_de_spmm(session):
    await _mundo(session)
    session.add(Proveedor(id=1, razon_social="HIERROS DEL SUR SRL"))
    pieza = await session.get(Pieza, ABC077)
    pieza.id_proveedor = 1
    await session.commit()
    f = (await _svc(session).ficha(ABC077)).data
    assert f["proveedor"] == "HIERROS DEL SUR SRL"
    assert f["proveedor_preferido"] == {"id": 1, "razon_social": "HIERROS DEL SUR SRL"}
    assert f["proveedor_heredado"] == "HIERROS SA"
    assert f["medidas"] == [38.1, None, None, None, None] and f["sistema_medida"] == "mm"
    assert f["origen"] == "legacy" and f["usos_en_ot"] == 0

    sin_tipo = (await _svc(session).ficha(SIN_TIPO)).data
    assert sin_tipo["tipo"] is None and sin_tipo["codigo"] == "CO002" and sin_tipo["stock"] == 0.0
    with pytest.raises(NotFoundException):
        await _svc(session).ficha(999)


# ─────────────────────── por HTTP, como lo llama la pantalla ───────────────────────

def _app(session, usuario=MAXI) -> FastAPI:
    """El router del catálogo con los handlers de la app, contra la base del test. Se
    pisa el `get_db` del propio módulo: el de fábrica abre el SessionLocal de PRODUCCIÓN."""
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(MateriaPrimaCatalogoAPI.router)

    async def _db():
        yield session

    app.dependency_overrides[MateriaPrimaCatalogoAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: usuario
    app.dependency_overrides[get_usuario_verificado] = lambda: usuario
    return app


def _cliente(session) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=_app(session)), base_url="http://t")


@pytest.mark.asyncio
async def test_por_http_el_alta_con_aviso_la_ficha_y_la_lista(session):
    formatos = await _mundo(session)
    cuerpo = _barra_cuadrada(formatos, 38.1)
    async with _cliente(session) as c:
        r = await c.post("/materia-prima/insumos/previsualizar", json={
            k: v for k, v in cuerpo.items() if k != "unidad"})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["codigo_sugerido"] == "ABC078"

        r = await c.post("/materia-prima/insumos", json=cuerpo)
        assert r.status_code == 409
        assert r.json()["data"] == {"requiere_confirmacion": True}
        assert "ABC077" in r.json()["errors"][0]["message"]

        r = await c.post("/materia-prima/insumos", params={"forzar": "true"}, json=cuerpo)
        assert r.status_code == 200, r.text
        nuevo = r.json()["data"]
        assert nuevo["codigo"] == "ABC078"

        r = await c.get(f"/materia-prima/insumos/{nuevo['id']}")
        assert r.status_code == 200 and r.json()["data"]["descripcion"] == nuevo["descripcion"]

        r = await c.put(f"/materia-prima/insumos/{nuevo['id']}", json={"codigo": "OTRO"})
        assert r.status_code == 422
        assert "código no se cambia" in r.json()["errors"][0]["message"]

        r = await c.get("/materia-prima/insumos", params={"search": "abc078", "size": 10})
        assert r.status_code == 200
        pagina = r.json()["data"]
        assert pagina["total_count"] == 1 and pagina["data"][0]["id"] == nuevo["id"]

        r = await c.get("/materia-prima/insumos/999")
        assert r.status_code == 404
        r = await c.post("/materia-prima/insumos", json={"tipo": "insumo"})
        assert r.status_code == 400  # falta la unidad: validación de Pydantic


@pytest.mark.asyncio
async def test_por_http_stock_recortes_precios_y_proveedores(session):
    await _mundo(session)
    async with _cliente(session) as c:
        r = await c.post(f"/materia-prima/insumos/{ABR203}/movimientos",
                         json={"tipo": "ingreso", "cantidad": 2.5, "comentario": "remito 44"})
        assert r.status_code == 200, r.text
        (mov,) = r.json()["data"]["movimientos"]
        # Sin zona ni microsegundos.
        assert len(mov["fecha"]) == 19 and not mov["fecha"].endswith("Z")

        r = await c.post(f"/materia-prima/insumos/{ABR203}/movimientos",
                         json={"tipo": "egreso", "cantidad": 3})
        assert r.status_code == 409 and r.json()["data"] == {"requiere_confirmacion": True}
        r = await c.post(f"/materia-prima/insumos/{ABR203}/movimientos",
                         params={"forzar": "true"}, json={"tipo": "egreso", "cantidad": 3})
        assert r.status_code == 200 and r.json()["data"]["fisico"] == -0.5

        r = await c.put(f"/materia-prima/movimientos/{mov['id']}/anular", json={"motivo": "no llegó"})
        assert r.status_code == 200 and r.json()["data"]["fisico"] == -3.0
        # Sin cuerpo también anda (el motivo es opcional).
        r = await c.get(f"/materia-prima/insumos/{ABR203}/movimientos")
        egreso = r.json()["data"]["movimientos"][1]["id"]
        r = await c.put(f"/materia-prima/movimientos/{egreso}/anular")
        assert r.status_code == 200 and r.json()["data"]["fisico"] == 0.0

        r = await c.post(f"/materia-prima/insumos/{ABR203}/recortes", json={"largo_mm": 1200})
        assert r.status_code == 200
        recorte = r.json()["data"]["id"]
        r = await c.put(f"/materia-prima/recortes/{recorte}", json={"estado": "descartado"})
        assert r.status_code == 200 and r.json()["data"]["estado"] == "descartado"
        r = await c.get(f"/materia-prima/insumos/{ABR203}/recortes")
        assert [x["id"] for x in r.json()["data"]] == [recorte]
        r = await c.delete(f"/materia-prima/recortes/{recorte}")
        assert r.status_code == 200

        r = await c.post(f"/materia-prima/insumos/{ABR203}/precios",
                         json={"precio": 900, "fecha": "2026-09-01"})
        assert r.status_code == 200 and r.json()["data"][0]["fecha"] == "2026-09-01"
        r = await c.get(f"/materia-prima/insumos/{ABR203}/precios")
        assert [p["precio"] for p in r.json()["data"]] == [900.0]
        r = await c.get(f"/materia-prima/insumos/{ABR203}/ots")
        assert r.status_code == 200 and r.json()["data"] == []

        r = await c.post("/materia-prima/proveedores", json={"razon_social": "Tornillos SA"})
        assert r.status_code == 200
        r = await c.post("/materia-prima/proveedores", json={"razon_social": "TORNILLOS"})
        assert r.status_code == 409
        r = await c.get("/materia-prima/proveedores", params={"search": "torni"})
        assert [p["razon_social"] for p in r.json()["data"]] == ["Tornillos SA"]

        r = await c.post("/materia-prima/materiales", json={"nombre": "Goma"})
        assert r.status_code == 200
        r = await c.post(f"/materia-prima/materiales/{r.json()['data']['id']}/calidades",
                         json={"nombre": "NEGRA"})
        assert r.status_code == 200 and r.json()["data"]["nombre"] == "NEGRA"

        r = await c.delete(f"/materia-prima/insumos/{ABR203}")
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_por_http_consumos_bloquean_el_borrado(session):
    """Un consumo cargado (RF-15) también es «se usó»."""
    await _mundo(session)
    session.add(Pieza(id=90, cod_pieza="XYZ001", descripcion="Algo", tipo="consumible",
                      unidad="UN", stockactual=0.0, origen="spmm"))
    await session.flush()
    session.add(ConsumoMaterial(id_orden_trabajo=OT_A, id_pieza=90, cantidad=1, unidad="UN",
                                fecha=ahora_ar(), anulado=0))
    await session.commit()
    async with _cliente(session) as c:
        r = await c.delete("/materia-prima/insumos/90")
    assert r.status_code == 422 and "consumo" in r.json()["errors"][0]["message"]
    assert await session.get(Pieza, 90) is not None
