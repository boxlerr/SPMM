"""El consumo de materiales de una orden (RF-15).

El SRS pide «asociar consumo de materiales a cada orden de producción». Lo que la OT
pide ya estaba (`orden_trabajo_pieza`, del sistema viejo); lo que se consumió no estaba
en ningún lado.

Lo que persigue este archivo no es que los endpoints contesten 200, sino las formas en
que un registro de consumo deja de servir:

  1. **Que lo pise el sync.** Por eso es una tabla propia: ni `cantusada` ni ninguna
     columna de `orden_trabajo_pieza`, que el sync reescribe cada media hora.
  2. **Que mueva el stock sin que nadie lo haya decidido.** `pieza.stockactual` es del
     viejo hasta que el cliente diga otra cosa: registrar un consumo no lo toca.
  3. **Que no se sepa quién ni cuándo.** Usuario del token y hora del taller, nunca lo
     que mande el navegador ni UTC.
  4. **Que un error se borre.** Se anula: deja de sumar y queda a la vista.
  5. **Que sume peras con manzanas.** Con línea, la pieza y la unidad son las de la
     línea; un consumo en otra unidad no entra en el mismo total.
"""
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from backend.application.ConsumoMaterialService import ConsumoMaterialService
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user, get_usuario_verificado
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.Pieza import Pieza
from backend.domain.Prioridad import Prioridad
from backend.domain.Sector import Sector
from backend.dto.ConsumoMaterialRequestDTO import AnularConsumoDTO, ConsumoMaterialRequestDTO
from backend.infrastructure import auditoria_movimientos as auditoria
from backend.infrastructure import migraciones
from backend.presentation import ConsumoMaterialAPI

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")
RAIZ = Path(__file__).resolve().parents[2]

# Quién carga, tal como llega del token.
LUCAS = {"id_usuario": 4, "username": "lucas", "nombre": "Lucas", "apellido": "Gómez", "rol": "operario"}
MATIAS = {"id_usuario": 5, "username": "matias", "nombre": "Matías", "apellido": "Ruiz", "rol": "operario"}
JULIAN = {"id_usuario": 1, "username": "julian", "nombre": "Julián", "apellido": "Boxler", "rol": "admin"}

# La línea 500 es de la OT 10 (chapa, en KG); la 501 de la OT 11 (misma chapa).
LINEA_CHAPA = 500
LINEA_DE_OTRA_OT = 501
LINEA_TORNILLOS = 502


async def _mundo(session):
    """Dos OT, dos piezas del catálogo con stock, y las líneas que trae el sync."""
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja de acero", abreviatura="BAND"),
        Cliente(id=1, nombre="ACME SRL"),
        Pieza(id=70, cod_pieza="CH-3MM", descripcion="Chapa 3mm", unidad="KG", stockactual=120.0),
        Pieza(id=71, cod_pieza="TOR-M8", descripcion="Tornillo M8", unidad="UN", stockactual=900.0),
    ])
    for id_ot in (10, 11):
        session.add(OrdenTrabajo(
            id=id_ot, id_otvieja=7000 + id_ot, id_prioridad=1, id_sector=1,
            id_articulo=1, id_cliente=1, unidades=3,
            fecha_orden=datetime(2026, 9, 1), fecha_entrada=datetime(2026, 9, 1),
            fecha_prometida=datetime(2026, 10, 1), finalizadototal=0,
        ))
    await session.flush()
    session.add_all([
        # `cantusada` es lo que el sync copia de mp.cantstk del viejo: no es consumo.
        OrdenTrabajoPieza(id=LINEA_CHAPA, id_orden_trabajo=10, id_pieza=70, cantidad=12.5,
                          unidad="KG", pedido=1, disponible=1, cantusada=120.0),
        OrdenTrabajoPieza(id=LINEA_DE_OTRA_OT, id_orden_trabajo=11, id_pieza=70, cantidad=4,
                          unidad="KG", pedido=1, disponible=1, cantusada=120.0),
        OrdenTrabajoPieza(id=LINEA_TORNILLOS, id_orden_trabajo=10, id_pieza=71, cantidad=40,
                          unidad="UN", pedido=1, disponible=0, cantusada=900.0),
    ])
    await session.commit()


def _alta(**extra) -> ConsumoMaterialRequestDTO:
    datos = dict(id_orden_trabajo=10, id_orden_trabajo_pieza=LINEA_CHAPA, cantidad=3)
    datos.update(extra)
    return ConsumoMaterialRequestDTO(**datos)


async def _consumos(session) -> list[ConsumoMaterial]:
    session.expire_all()
    return (await session.execute(
        select(ConsumoMaterial).order_by(ConsumoMaterial.id)
    )).scalars().all()


# ─────────────────────── el alta ───────────────────────

@pytest.mark.asyncio
async def test_queda_quien_lo_cargo_y_la_hora_del_taller_sin_zona(session):
    """Sin autor ni hora, un registro de consumo no contesta nada.

    La hora es la del taller y sin zona, como todas las fechas de esta base: Cloud Run
    corre en UTC y un `datetime.now()` pelado la guardaría tres horas adelantada.
    """
    await _mundo(session)
    await ConsumoMaterialService(session).registrar(_alta(observaciones="  corte 1  "), LUCAS)

    (c,) = await _consumos(session)
    assert c.usuario == "Lucas Gómez" and c.id_usuario == 4
    assert c.fecha.tzinfo is None
    ahora_ar = datetime.now(_TZ_AR).replace(tzinfo=None)
    assert abs((c.fecha - ahora_ar).total_seconds()) < 120, (
        f"quedó {c.fecha} y en el taller son las {ahora_ar}: se está estampando en UTC"
    )
    assert c.observaciones == "corte 1"
    assert c.anulado == 0


@pytest.mark.asyncio
async def test_sin_token_no_se_inventa_un_autor(session):
    """Lo que entra por un script no tiene usuario: queda vacío, no con uno puesto."""
    await _mundo(session)
    await ConsumoMaterialService(session).registrar(_alta(), None)

    (c,) = await _consumos(session)
    assert c.usuario is None and c.id_usuario is None


@pytest.mark.asyncio
async def test_con_linea_la_pieza_y_la_unidad_salen_de_la_linea(session):
    await _mundo(session)
    r = await ConsumoMaterialService(session).registrar(_alta(cantidad=2.25), LUCAS)

    (c,) = await _consumos(session)
    assert (c.id_pieza, c.unidad, c.id_orden_trabajo_pieza) == (70, "KG", LINEA_CHAPA)
    assert c.cantidad == pytest.approx(2.25)
    # Lo que devuelve el alta alcanza para dibujar el renglón sin volver a pedir la lista.
    assert r.data["cod_pieza"] == "CH-3MM" and r.data["descripcion"] == "Chapa 3mm"
    assert r.data["anulado"] is False


@pytest.mark.asyncio
async def test_se_guarda_con_tres_decimales_como_la_columna(session):
    await _mundo(session)
    await ConsumoMaterialService(session).registrar(_alta(cantidad=1.23456), LUCAS)
    (c,) = await _consumos(session)
    assert c.cantidad == pytest.approx(1.235)


@pytest.mark.asyncio
async def test_material_fuera_de_la_lista_va_con_la_unidad_de_la_pieza(session):
    """Sin línea: la pieza es obligatoria y la unidad sale del catálogo."""
    await _mundo(session)
    await ConsumoMaterialService(session).registrar(
        _alta(id_orden_trabajo_pieza=None, id_pieza=71, cantidad=6), LUCAS)

    (c,) = await _consumos(session)
    assert (c.id_pieza, c.unidad, c.id_orden_trabajo_pieza) == (71, "UN", None)


@pytest.mark.asyncio
@pytest.mark.parametrize("cantidad", [0, -3, 0.0004])
async def test_cero_o_negativo_no_entra_y_no_guarda_nada(session, cantidad):
    """Una carga de más se anula; no se compensa con un negativo.

    0,0004 también: redondeado a 3 decimales es 0, y la base lo rechazaría con un error
    que en el taller nadie entiende.
    """
    await _mundo(session)
    with pytest.raises(BusinessException) as e:
        await ConsumoMaterialService(session).registrar(_alta(cantidad=cantidad), LUCAS)
    assert "mayor a 0" in e.value.message
    assert await _consumos(session) == []


@pytest.mark.asyncio
async def test_un_numero_que_no_es_numero_no_entra(session):
    await _mundo(session)
    with pytest.raises(BusinessException):
        await ConsumoMaterialService(session).registrar(_alta(cantidad=float("nan")), LUCAS)
    assert await _consumos(session) == []


@pytest.mark.asyncio
async def test_sin_decir_que_material_no_entra(session):
    await _mundo(session)
    with pytest.raises(BusinessException) as e:
        await ConsumoMaterialService(session).registrar(
            _alta(id_orden_trabajo_pieza=None, id_pieza=None), LUCAS)
    assert "qué material" in e.value.message


@pytest.mark.asyncio
async def test_la_linea_de_otra_orden_no_se_puede_usar(session):
    """Si no, el consumo sumaría en la OT 10 contra lo pedido por la 11."""
    await _mundo(session)
    with pytest.raises(BusinessException) as e:
        await ConsumoMaterialService(session).registrar(
            _alta(id_orden_trabajo_pieza=LINEA_DE_OTRA_OT), LUCAS)
    assert "otra orden" in e.value.message
    assert await _consumos(session) == []


@pytest.mark.asyncio
async def test_una_pieza_que_no_coincide_con_la_linea_se_rechaza(session):
    await _mundo(session)
    with pytest.raises(BusinessException):
        await ConsumoMaterialService(session).registrar(_alta(id_pieza=71), LUCAS)


@pytest.mark.asyncio
async def test_no_se_carga_en_otra_unidad_que_la_pedida(session):
    """Kilos y unidades en el mismo total dan un número que no significa nada."""
    await _mundo(session)
    svc = ConsumoMaterialService(session)
    with pytest.raises(BusinessException) as e:
        await svc.registrar(_alta(unidad="UN"), LUCAS)
    assert "KG" in e.value.message

    # La misma unidad escrita distinto sí entra, y queda como la de la línea.
    await svc.registrar(_alta(unidad=" kg "), LUCAS)
    (c,) = await _consumos(session)
    assert c.unidad == "KG"


@pytest.mark.asyncio
async def test_orden_o_linea_que_no_existe_da_404_y_no_500(session):
    await _mundo(session)
    svc = ConsumoMaterialService(session)
    with pytest.raises(NotFoundException):
        await svc.registrar(_alta(id_orden_trabajo=999), LUCAS)
    with pytest.raises(NotFoundException):
        await svc.registrar(_alta(id_orden_trabajo_pieza=9999), LUCAS)
    with pytest.raises(NotFoundException):
        await svc.registrar(_alta(id_orden_trabajo_pieza=None, id_pieza=9999), LUCAS)


@pytest.mark.asyncio
async def test_la_base_tampoco_deja_entrar_un_consumo_en_cero(session):
    """El CHECK de la tabla cubre lo que no pase por el servicio (un script, a mano)."""
    await _mundo(session)
    with pytest.raises(IntegrityError):
        await session.execute(text(
            "INSERT INTO consumo_material (id_orden_trabajo, id_pieza, cantidad, fecha, anulado) "
            "VALUES (10, 70, 0, '2026-09-22 10:00:00', 0)"
        ))
        await session.commit()
    await session.rollback()


# ─────────────────────── lo que NO toca ───────────────────────

@pytest.mark.asyncio
async def test_no_mueve_el_stock_ni_la_linea_del_sistema_viejo(session):
    """El stock lo reescribe el sync con el del viejo: descontarlo acá sería un número
    que vuelve solo a la media hora. Pasar el stock a SPMM lo decide el cliente.

    Y la línea de materia prima es del viejo: ni `cantusada` ni nada se escribe ahí.
    """
    await _mundo(session)
    svc = ConsumoMaterialService(session)
    r = await svc.registrar(_alta(cantidad=5), LUCAS)
    await svc.anular(r.data["id"], None, LUCAS)

    session.expire_all()
    chapa = await session.get(Pieza, 70)
    linea = await session.get(OrdenTrabajoPieza, LINEA_CHAPA)
    assert chapa.stockactual == pytest.approx(120.0)
    assert (linea.cantidad, linea.cantusada) == (pytest.approx(12.5), pytest.approx(120.0))


def test_el_sync_no_sabe_que_existe_esta_tabla():
    """Que ningún cambio futuro del sync la meta en su lista: entonces sí la pisaría."""
    sync = (RAIZ / "backend" / "scripts" / "sync_db.py").read_text(encoding="utf-8")
    assert "consumo_material" not in sync


# ─────────────────────── el listado ───────────────────────

@pytest.mark.asyncio
async def test_varias_cargas_se_acumulan_y_salen_lo_ultimo_primero(session):
    """El taller consume en tandas: tres hoy, dos mañana. Cada una es un renglón."""
    await _mundo(session)
    svc = ConsumoMaterialService(session)
    await svc.registrar(_alta(cantidad=3), LUCAS)
    await svc.registrar(_alta(cantidad=2), MATIAS)
    await svc.registrar(_alta(id_orden_trabajo_pieza=LINEA_TORNILLOS, cantidad=10), LUCAS)
    # Uno de otra OT no se tiene que colar en la lista de la 10.
    await svc.registrar(_alta(id_orden_trabajo=11, id_orden_trabajo_pieza=LINEA_DE_OTRA_OT), LUCAS)

    data = (await svc.listar_por_orden(10)).data
    assert len(data) == 3
    assert [d["id"] for d in data] == sorted((d["id"] for d in data), reverse=True)
    chapa = sum(d["cantidad"] for d in data if d["id_orden_trabajo_pieza"] == LINEA_CHAPA)
    assert chapa == pytest.approx(5)
    assert {d["usuario"] for d in data} == {"Lucas Gómez", "Matías Ruiz"}


@pytest.mark.asyncio
async def test_una_orden_sin_consumos_da_lista_vacia(session):
    """Y no 404: en la ficha, un 404 quiere decir «este backend no tiene la ruta»."""
    await _mundo(session)
    assert (await ConsumoMaterialService(session).listar_por_orden(10)).data == []
    assert (await ConsumoMaterialService(session).listar_por_orden(999)).data == []


# ─────────────────────── anular ───────────────────────

@pytest.mark.asyncio
async def test_anular_no_borra_deja_el_renglon_con_quien_y_cuando(session):
    await _mundo(session)
    svc = ConsumoMaterialService(session)
    r = await svc.registrar(_alta(cantidad=3), LUCAS)
    await svc.registrar(_alta(cantidad=2), LUCAS)

    anulado = (await svc.anular(r.data["id"], AnularConsumoDTO(motivo="eran 2, no 3"), LUCAS)).data
    assert anulado["anulado"] is True
    assert anulado["anulado_por"] == "Lucas Gómez"
    assert anulado["motivo_anulacion"] == "eran 2, no 3"

    filas = await _consumos(session)
    assert len(filas) == 2, "anular no puede borrar el renglón"
    c = next(f for f in filas if f.id == r.data["id"])
    assert c.anulado == 1 and c.anulado_en is not None and c.anulado_en.tzinfo is None

    data = (await svc.listar_por_orden(10)).data
    vigente = sum(d["cantidad"] for d in data if not d["anulado"])
    assert vigente == pytest.approx(2), "lo anulado deja de sumar"
    assert any(d["anulado"] for d in data), "pero sigue a la vista"


@pytest.mark.asyncio
async def test_anular_dos_veces_no_pisa_quien_lo_anulo(session):
    """Un doble toque, o dos personas con la misma ficha abierta."""
    await _mundo(session)
    svc = ConsumoMaterialService(session)
    r = await svc.registrar(_alta(), LUCAS)
    primero = (await svc.anular(r.data["id"], None, LUCAS)).data
    segundo = (await svc.anular(r.data["id"], None, JULIAN)).data
    assert segundo["anulado_por"] == primero["anulado_por"] == "Lucas Gómez"
    assert segundo["anulado_en"] == primero["anulado_en"]


@pytest.mark.asyncio
async def test_lo_anula_quien_lo_cargo_o_un_admin_nadie_mas(session):
    from fastapi import HTTPException

    await _mundo(session)
    svc = ConsumoMaterialService(session)
    de_lucas = (await svc.registrar(_alta(), LUCAS)).data["id"]
    otro_de_lucas = (await svc.registrar(_alta(), LUCAS)).data["id"]
    de_script = (await svc.registrar(_alta(), None)).data["id"]

    with pytest.raises(HTTPException) as e:
        await svc.anular(de_lucas, None, MATIAS)
    assert e.value.status_code == 403
    # Uno cargado por un script no es de nadie: sólo un admin.
    with pytest.raises(HTTPException):
        await svc.anular(de_script, None, LUCAS)

    assert (await svc.anular(de_lucas, None, LUCAS)).data["anulado"] is True
    assert (await svc.anular(otro_de_lucas, None, JULIAN)).data["anulado"] is True
    assert (await svc.anular(de_script, None, JULIAN)).data["anulado"] is True


@pytest.mark.asyncio
async def test_anular_uno_que_no_existe_da_404(session):
    await _mundo(session)
    with pytest.raises(NotFoundException):
        await ConsumoMaterialService(session).anular(12345, None, JULIAN)


# ─────────────────────── por HTTP, como lo llama la ficha ───────────────────────

def _app(session, usuario) -> FastAPI:
    """El router del consumo con los handlers de la app, contra la base del test.

    Se pisa el `get_db` del propio módulo: el de fábrica abre el SessionLocal de
    PRODUCCIÓN. Ninguna ruta de este archivo puede llegar a Supabase.
    """
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(ConsumoMaterialAPI.router)

    async def _db():
        yield session

    app.dependency_overrides[ConsumoMaterialAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: usuario
    # Anular mira el rol de la BASE (RF-24): acá la base del test no tiene usuarios, así
    # que el verificado es el mismo dict.
    app.dependency_overrides[get_usuario_verificado] = lambda: usuario
    return app


def _cliente(session, usuario=LUCAS) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=_app(session, usuario)), base_url="http://t")


@pytest.mark.asyncio
async def test_el_camino_de_la_ficha_alta_listado_y_anulacion(session):
    await _mundo(session)
    async with _cliente(session) as c:
        r = await c.post("/consumos-material", json={
            "id_orden_trabajo": 10, "id_orden_trabajo_pieza": LINEA_CHAPA,
            "cantidad": 1.5, "observaciones": "primer corte",
        })
        assert r.status_code == 200, r.text
        creado = r.json()["data"]
        assert creado["usuario"] == "Lucas Gómez" and creado["unidad"] == "KG"
        # La fecha viaja sin zona: el navegador la lee como hora local.
        assert "+" not in creado["fecha"] and not creado["fecha"].endswith("Z")

        r = await c.get("/consumos-material", params={"id_orden_trabajo": 10})
        assert r.status_code == 200
        assert [d["id"] for d in r.json()["data"]] == [creado["id"]]

        r = await c.put(f"/consumos-material/{creado['id']}/anular")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["anulado"] is True


@pytest.mark.asyncio
async def test_por_http_los_errores_llegan_con_su_codigo_y_su_motivo(session):
    """La ficha revierte el renglón y muestra el motivo: tiene que venir en castellano."""
    await _mundo(session)
    async with _cliente(session) as c:
        r = await c.post("/consumos-material", json={
            "id_orden_trabajo": 10, "id_orden_trabajo_pieza": LINEA_CHAPA, "cantidad": 0,
        })
        assert r.status_code == 422
        assert "mayor a 0" in r.json()["errors"][0]["message"]

        r = await c.post("/consumos-material", json={"id_orden_trabajo": 10, "cantidad": "tres"})
        assert r.status_code == 400

        creado = (await c.post("/consumos-material", json={
            "id_orden_trabajo": 10, "id_orden_trabajo_pieza": LINEA_CHAPA, "cantidad": 1,
        })).json()["data"]

    async with _cliente(session, MATIAS) as c:
        r = await c.put(f"/consumos-material/{creado['id']}/anular")
        assert r.status_code == 403
        assert "otra persona" in r.json()["errors"][0]["message"]


# ─────────────────────── la migración y el registro ───────────────────────

def test_la_migracion_solo_crea_no_toca_filas():
    """Corre sola contra Supabase al arrancar: una tabla nueva y nada más."""
    sentencias = dict(migraciones.MIGRACIONES)["2026-09-22_consumo_material"]
    todo = " ".join(sentencias).lower()
    assert "update " not in todo and "delete " not in todo and "drop " not in todo
    assert "alter table" not in todo, "no se agrega nada a una tabla que ya se lee"
    assert "create table if not exists consumo_material" in todo


def test_los_comentarios_de_la_migracion_son_un_solo_literal():
    """`'a' 'b'` pegado sin salto de línea no concatena en Postgres: deja una comilla adentro."""
    for s in dict(migraciones.MIGRACIONES)["2026-09-22_consumo_material"]:
        if s.startswith("COMMENT"):
            assert "''" not in s, s


def test_el_registro_de_auditoria_lo_nombra_como_el_taller():
    assert auditoria.se_audita("POST", "/consumos-material")
    assert auditoria.se_audita("PUT", "/consumos-material/7/anular")
    _, entidad, id_entidad, _ = auditoria.describir(
        "PUT", "/consumos-material/7/anular", 200, "Lucas Gómez")
    assert entidad == "consumo de material › anulación" and id_entidad == "7"
