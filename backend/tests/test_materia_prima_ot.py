"""Las materias primas de la OT (spec §2.2 y las reglas de §1.7), por HTTP contra SQLite.

Lo que persigue este archivo:

  1. **Que una transición no arrastre lo que tiene que arrastrar.** Marcar disponible una
     línea reservada RETIRA el stock (movimiento retiro_ot) y desmarcarla lo anula; soltar
     «Utilizado» suelta la reserva; bajar la cantidad baja la reserva.
  2. **Que una reserva que deja el stock en negativo pase callada.** Es 409 («avisar, no
     bloquear») y con ?forzar=true entra.
  3. **Que un lote quede a medias.** Todo o nada, en el alta y en los cambios.
  4. **Que una fecha que no vino se borre, o que un null explícito no la borre.**
  5. **Que borrar una línea con consumos o pedida no avise**, o que se lleve los consumos.
  6. **Que «Traer historial» copie mal**: el factor, las unidades hacia arriba, los cortes;
     o que la ruta de una OT nueva (por artículo) devuelva otra forma que la de una OT.
  7. **Que la línea y el insumo cuenten stocks distintos** después de reservar, retirar,
     desmarcar o borrar (la ficha del insumo, sus reservas y «OT donde se usó»).
  8. **Que una fecha con hora salga con microsegundos** (spec §2: «YYYY-MM-DDTHH:MM:SS»).
"""
from contextlib import asynccontextmanager
from datetime import datetime

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from backend.application.materia_prima import stock
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user
from backend.domain.Articulo import Articulo
from backend.domain.CaneraOcupacion import CaneraOcupacion
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.OrdenTrabajoPiezaCorte import OrdenTrabajoPiezaCorte
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Pieza import Pieza
from backend.domain.PiezaMovimiento import PiezaMovimiento
from backend.domain.PiezaRecorte import PiezaRecorte
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Proveedor import Proveedor
from backend.domain.Sector import Sector
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.presentation import MateriaPrimaCatalogoAPI, MateriaPrimaOTAPI, MateriaPrimaPendientesAPI

MAXI = {"id_usuario": 7, "username": "maxi", "nombre": "Maxi", "apellido": "Pérez", "rol": "supervisor"}

# Insumos: uno de cada tipo y uno inactivo.
BARRA, CHAPA, BULON, VIEJA = 70, 71, 72, 73
# OT (números visibles 15010..): A y B del mismo artículo, C de otro.
OT_A, OT_B, OT_C = 10, 11, 12
PROV = 5
DESC_BARRA = "BARRA REDONDO 19mm ACERO SAE 1010"


async def mundo(session):
    """Tres OT, cuatro insumos (con 10 m de BARRA en stock por un ingreso) y un proveedor."""
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja de acero", abreviatura="BAND"),
        Articulo(id=2, cod_articulo="A-200", descripcion="Soporte", abreviatura="SOP"),
        Cliente(id=1, nombre="ACME SRL"),
        Proveedor(id=PROV, razon_social="ACEROS CAS SA", fantasia="CAS"),
        Pieza(id=BARRA, cod_pieza=" ABR203", descripcion=DESC_BARRA, tipo="insumo",
              unidad="MTS", unitario=1500.5, stockactual=0.0),
        Pieza(id=CHAPA, cod_pieza="CHA001", descripcion="CHAPA A MEDIDA", tipo="insumo_desc",
              unidad="UN", unitario=10.0, stockactual=0.0),
        Pieza(id=BULON, cod_pieza="BUL001", descripcion="BULON M8", tipo="consumible",
              unidad="UN", unitario=0.5, stockactual=0.0),
        Pieza(id=VIEJA, cod_pieza="VIE001", descripcion="INSUMO DADO DE BAJA", tipo="consumible",
              unidad="KG", inactivo=1),
    ])
    for id_ot, articulo, unidades, fecha in ((OT_A, 1, 3, datetime(2026, 9, 1)),
                                             (OT_B, 1, 6, datetime(2026, 8, 1)),
                                             (OT_C, 2, 1, datetime(2026, 9, 5))):
        session.add(OrdenTrabajo(
            id=id_ot, id_otvieja=15000 + id_ot, id_prioridad=1, id_sector=1,
            id_articulo=articulo, id_cliente=1, unidades=unidades,
            fecha_orden=fecha, fecha_entrada=fecha,
            fecha_prometida=datetime(2026, 10, 1), finalizadototal=0,
        ))
    await session.commit()
    await stock.registrar_movimiento(session, BARRA, "ingreso", 10, usuario=MAXI)
    await session.commit()


def linea(id, ot, pieza, cantidad=1.0, unidad="Mts", **campos):
    return OrdenTrabajoPieza(id=id, id_orden_trabajo=ot, id_pieza=pieza, cantidad=cantidad,
                             unidad=unidad, **campos)


def app_de_prueba(session, usuario=MAXI):
    """Los tres routers de la sección: el del catálogo está para mirar el stock desde el
    insumo (movimientos, reservas, OT donde se usa) después de tocar una línea."""
    app = FastAPI()
    registrar_exception_handlers(app)
    for modulo in (MateriaPrimaOTAPI, MateriaPrimaPendientesAPI, MateriaPrimaCatalogoAPI):
        app.include_router(modulo.router)

        async def _db():
            yield session
        app.dependency_overrides[modulo.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: usuario
    return app


@asynccontextmanager
async def cliente(session):
    async with AsyncClient(transport=ASGITransport(app=app_de_prueba(session)),
                           base_url="http://t") as c:
        yield c


async def fila(session, modelo, id_):
    """La fila como quedó en la base (no la copia que la sesión tenga en memoria)."""
    return (await session.execute(
        select(modelo).where(modelo.id == id_).execution_options(populate_existing=True)
    )).scalar_one_or_none()


async def stock_barra(session):
    return (await stock.stock_de(session, [BARRA]))[BARRA]


def mensaje(r) -> str:
    return r.json()["errors"][0]["message"]


# ─────────────────────────── leer ───────────────────────────


@pytest.mark.asyncio
async def test_get_lineas_trae_todo_lo_de_la_fila(session):
    await mundo(session)
    session.add_all([
        linea(1, OT_A, BARRA, 2.5, orden=2),
        linea(2, OT_A, CHAPA, 3, "Un", orden=1, descripcion="CHAPA 3MM A MEDIDA",
              id_proveedor=PROV),
        linea(3, OT_A, BULON, 4, "Un", usado=0),              # sin orden: sale primero
        linea(4, OT_B, BARRA, 4, reserva=1, cantidad_reservada=4, usado=1, disponible=0),
        Proceso(id=100, nombre="TORNO"),
        EstadoProceso(id=1, descripcion="Pendiente"), EstadoProceso(id=2, descripcion="En curso"),
    ])
    await session.flush()
    session.add_all([
        OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=1, cantidad=3, largo_mm=1093, orden=1),
        ConsumoMaterial(id_orden_trabajo=OT_A, id_pieza=BARRA, id_orden_trabajo_pieza=1,
                        cantidad=1.0, fecha=datetime(2026, 9, 20), anulado=0),
        ConsumoMaterial(id_orden_trabajo=OT_A, id_pieza=BARRA, id_orden_trabajo_pieza=1,
                        cantidad=0.25, fecha=datetime(2026, 9, 21), anulado=0),
        ConsumoMaterial(id_orden_trabajo=OT_A, id_pieza=BARRA, id_orden_trabajo_pieza=1,
                        cantidad=5, fecha=datetime(2026, 9, 21), anulado=1),
        PiezaRecorte(id_pieza=BARRA, largo_mm=2777, cantidad=2, estado="disponible"),
        PiezaRecorte(id_pieza=BARRA, largo_mm=300, cantidad=1, estado="usado"),
        CaneraOcupacion(columna="E", fila=4, id_orden_trabajo=OT_A, desde=datetime(2026, 9, 20)),
        OrdenTrabajoProceso(id_orden_trabajo=OT_A, id_proceso=100, orden=1, id_estado=2),
    ])
    await session.commit()

    async with cliente(session) as c:
        r = await c.get(f"/materia-prima/ot/{OT_A}/lineas")
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert (d["id_orden_trabajo"], d["numero_ot"]) == (OT_A, 15010)
        assert d["no_lleva_materia_prima"] is False
        assert d["ot_en_curso"] is True
        assert d["celdas"] == ["E4"]
        # BARRA sin pedir ni reservar: falta pedir (la línea que no se usa no cuenta).
        assert d["estado_material"] == "sin_stock"
        assert [l["id"] for l in d["lineas"]] == [3, 2, 1]

        barra = d["lineas"][2]
        assert barra["codigo"] == "ABR203"                   # sin el espacio del viejo
        assert barra["descripcion"] == DESC_BARRA            # la línea no tiene: la de la pieza
        assert barra["tipo_pieza"] == "insumo"
        assert barra["precio"] == 1500.5
        assert barra["consumido"] == 1.25                    # sin el anulado
        assert barra["cortes"] == [{"id": barra["cortes"][0]["id"], "cantidad": 3,
                                    "largo_mm": 1093.0, "ancho_mm": None, "texto_original": None}]
        assert barra["sugerido_m"] == 3.29                   # 3 × (1093 + 3) = 3,288 → 3,29
        assert barra["stock_libre"] == 6.0                   # 10 − 4 reservados por la OT B
        assert barra["recortes_disponibles"] == 2
        assert barra["usado"] is True and barra["pedido"] is False and barra["reserva"] is False

        chapa = d["lineas"][1]
        assert chapa["descripcion"] == "CHAPA 3MM A MEDIDA"
        assert chapa["proveedor"] == "ACEROS CAS SA"         # elegida del catálogo, sin texto
        assert chapa["consumido"] == 0.0 and chapa["cortes"] == [] and chapa["sugerido_m"] is None
        assert d["lineas"][0]["usado"] is False

        # El precio es el de la pieza HOY: no se congela en la línea.
        (await session.get(Pieza, BARRA)).unitario = 1700.0
        await session.commit()
        r = await c.get(f"/materia-prima/ot/{OT_A}/lineas")
        assert r.json()["data"]["lineas"][2]["precio"] == 1700.0

        assert (await c.get("/materia-prima/ot/999/lineas")).status_code == 404


@pytest.mark.asyncio
async def test_el_estado_material_de_la_ot_sigue_a_las_marcas(session):
    await mundo(session)
    async with cliente(session) as c:
        async def estado():
            return (await c.get(f"/materia-prima/ot/{OT_A}/lineas")).json()["data"]["estado_material"]

        assert await estado() == "sin_datos"                 # nadie cargó la lista
        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas/lote", json={"lineas": [
            {"id_pieza": BARRA, "cantidad": 2}, {"id_pieza": BULON, "cantidad": 4}]})
        a, b = [l["id"] for l in r.json()["data"]]
        assert await estado() == "sin_stock"                 # falta pedir
        await c.put(f"/materia-prima/lineas/{a}", json={"pedido": True})
        assert await estado() == "sin_stock"                 # todavía falta una
        await c.put(f"/materia-prima/lineas/{b}", json={"reserva": True, "cantidad_reservada": 1},
                    params={"forzar": "true"})
        assert await estado() == "pedido"                    # todo pedido o reservado
        await c.put("/materia-prima/lineas/lote", json={"ids": [a, b], "cambios": {"disponible": True}})
        assert await estado() == "ok"
        await c.put(f"/materia-prima/ot/{OT_A}/no-lleva", json={"no_lleva": True})
        assert await estado() == "no_lleva"


# ─────────────────────────── alta ───────────────────────────


@pytest.mark.asyncio
async def test_alta_de_una_linea(session):
    await mundo(session)
    async with cliente(session) as c:
        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas", json={"id_pieza": BARRA, "cantidad": 2.5})
        assert r.status_code == 200, r.text
        l = r.json()["data"]
        # Sin unidad: la de la pieza (MTS → Mts). La descripción se congela.
        assert (l["unidad"], l["descripcion"], l["origen"], l["orden"]) == ("Mts", DESC_BARRA, "spmm", 1)
        assert l["usado"] is True and not (l["pedido"] or l["reserva"] or l["disponible"] or l["en_produccion"])
        guardada = await fila(session, OrdenTrabajoPieza, l["id"])
        assert guardada.descripcion == DESC_BARRA and guardada.creado_por == "Maxi Pérez"
        assert guardada.creado_en is not None

        # La siguiente va después, con la unidad que se pida (cualquier capitalización),
        # el proveedor del catálogo y sus cortes.
        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas", json={
            "id_pieza": CHAPA, "cantidad": 3, "unidad": "kg", "descripcion": "CHAPA 3MM",
            "id_proveedor": PROV, "observaciones": "  ", "cortes": [{"cantidad": 2, "largo_mm": 500}]})
        l = r.json()["data"]
        assert (l["orden"], l["unidad"], l["descripcion"], l["proveedor"], l["id_proveedor"]) == \
            (2, "Kg", "CHAPA 3MM", "ACEROS CAS SA", PROV)
        assert l["observaciones"] is None
        assert [(k["cantidad"], k["largo_mm"]) for k in l["cortes"]] == [(2, 500.0)]
        assert l["sugerido_m"] == 1.01

        casos = [
            ({"id_pieza": BARRA, "cantidad": 1, "descripcion": "otra cosa"}, 422, "sale de sus medidas"),
            ({"id_pieza": BARRA, "cantidad": 0}, 422, "mayor que cero"),
            ({"id_pieza": BARRA, "cantidad": 1, "unidad": "XX"}, 422, "no es una unidad"),
            ({"id_pieza": BARRA, "cantidad": 1, "origen": "legacy"}, 422, "Origen"),
            ({"id_pieza": BARRA, "cantidad": 1, "cortes": [{"cantidad": 0, "largo_mm": 10}]}, 422, "corte"),
            ({"id_pieza": BARRA, "cantidad": 1, "id_proveedor": 999}, 404, "proveedor"),
            ({"id_pieza": 999, "cantidad": 1}, 404, "insumo"),
        ]
        for cuerpo, status, texto in casos:
            r = await c.post(f"/materia-prima/ot/{OT_A}/lineas", json=cuerpo)
            assert r.status_code == status, (cuerpo, r.text)
            assert texto in mensaje(r), (cuerpo, mensaje(r))
        # La descripción de un 'insumo' igual a la suya (espacios aparte) sí pasa.
        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas",
                         json={"id_pieza": BARRA, "cantidad": 1, "descripcion": DESC_BARRA.lower() + "  "})
        assert r.status_code == 200
        assert (await c.post("/materia-prima/ot/999/lineas", json={"id_pieza": BARRA, "cantidad": 1})
                ).status_code == 404

        # Un insumo inactivo: 409 que lo dice, y con forzar entra.
        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas", json={"id_pieza": VIEJA, "cantidad": 1})
        assert r.status_code == 409 and "VIE001 está inactivo" in mensaje(r)
        assert r.json()["data"] == {"requiere_confirmacion": True}
        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas", params={"forzar": "true"},
                         json={"id_pieza": VIEJA, "cantidad": 1})
        assert r.status_code == 200 and r.json()["data"]["unidad"] == "Kg"


@pytest.mark.asyncio
async def test_el_lote_es_todo_o_nada(session):
    await mundo(session)
    async with cliente(session) as c:
        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas/lote", json={"lineas": [
            {"id_pieza": BARRA, "cantidad": 2}, {"id_pieza": BULON, "cantidad": -1}]})
        assert r.status_code == 422 and mensaje(r).startswith("Línea 2 (BUL001):")
        cuantas = (await session.execute(select(func.count(OrdenTrabajoPieza.id)))).scalar()
        assert cuantas == 0

        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas/lote", json={"lineas": [
            {"id_pieza": BARRA, "cantidad": 2}, {"id_pieza": VIEJA, "cantidad": 1}]})
        assert r.status_code == 409
        assert (await session.execute(select(func.count(OrdenTrabajoPieza.id)))).scalar() == 0

        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas/lote", params={"forzar": "true"}, json={
            "lineas": [{"id_pieza": BARRA, "cantidad": 2, "origen": "historial"},
                       {"id_pieza": BULON, "cantidad": 4, "origen": "historial"}]})
        assert r.status_code == 200
        assert [(l["codigo"], l["orden"], l["origen"]) for l in r.json()["data"]] == \
            [("ABR203", 1, "historial"), ("BUL001", 2, "historial")]

        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas/lote", json={"lineas": []})
        assert r.status_code == 200 and r.json()["data"] == []


# ─────────────────────────── transiciones ───────────────────────────


@pytest.mark.asyncio
async def test_pedido_estampa_quien_y_cuando_y_desmarcar_lo_limpia(session):
    await mundo(session)
    session.add(linea(1, OT_A, BARRA, 2))
    await session.commit()
    async with cliente(session) as c:
        r = await c.put("/materia-prima/lineas/1", json={"pedido": True})
        l = r.json()["data"]
        assert l["pedido"] is True and l["pedido_por"] == "Maxi Pérez" and l["pedido_en"]
        assert l["modificado_por"] == "Maxi Pérez"
        assert l["falta"] == 0.0                               # pedida: ya no falta pedirla
        r = await c.put("/materia-prima/lineas/1", json={"pedido": False})
        l = r.json()["data"]
        assert l["pedido"] is False and l["pedido_en"] is None and l["pedido_por"] is None
        assert l["falta"] == 2.0


@pytest.mark.asyncio
async def test_la_reserva_contra_el_stock_libre(session):
    await mundo(session)
    session.add_all([
        # La OT B ya tiene 4 reservados: quedan 6 libres de los 10.
        linea(4, OT_B, BARRA, 4, reserva=1, cantidad_reservada=4, usado=1, disponible=0),
        linea(1, OT_A, BARRA, 8),
        linea(2, OT_C, BARRA, 3),
    ])
    await session.commit()
    async with cliente(session) as c:
        # Sin cantidad: lo que haya libre, hasta lo que lleva la línea.
        r = await c.put("/materia-prima/lineas/1", json={"reserva": True})
        assert r.status_code == 200 and r.json()["data"]["cantidad_reservada"] == 6.0
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 10.0, "libre": 0.0}

        # Ya no hay libre: la reserva deja el stock en negativo → 409, y no cambió nada.
        r = await c.put("/materia-prima/lineas/2", json={"reserva": True})
        assert r.status_code == 409
        assert mensaje(r) == ("Hay 0 libres de ABR203; la reserva de 3 para la OT N° 15012 deja el "
                              "stock en negativo. ¿Hacerlo igual?")
        assert (await fila(session, OrdenTrabajoPieza, 2)).reserva == 0
        r = await c.put("/materia-prima/lineas/2", params={"forzar": "true"}, json={"reserva": True})
        assert r.status_code == 200 and r.json()["data"]["cantidad_reservada"] == 3.0
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 13.0, "libre": -3.0}

        # Subir una reserva por encima de lo libre (sin contar la propia) avisa; bajarla no.
        r = await c.put("/materia-prima/lineas/1", json={"cantidad_reservada": 7})
        assert r.status_code == 409 and "Hay 3 libres" in mensaje(r)
        r = await c.put("/materia-prima/lineas/1", json={"cantidad_reservada": 2})
        assert r.status_code == 200 and r.json()["data"]["cantidad_reservada"] == 2.0
        # Más que lo que lleva la línea, no; y cero tampoco.
        assert (await c.put("/materia-prima/lineas/1", json={"cantidad_reservada": 9})).status_code == 422
        assert (await c.put("/materia-prima/lineas/1", json={"cantidad_reservada": 0})).status_code == 422
        # Una cantidad a reservar sin tildar la reserva no aparta nada: 422.
        session.add(linea(3, OT_C, CHAPA, 1, "Un"))
        await session.commit()
        assert (await c.put("/materia-prima/lineas/3", json={"cantidad_reservada": 1})).status_code == 422

        # Desmarcar la reserva la suelta.
        r = await c.put("/materia-prima/lineas/2", json={"reserva": False})
        assert r.json()["data"]["reserva"] is False and r.json()["data"]["cantidad_reservada"] is None
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 6.0, "libre": 4.0}


@pytest.mark.asyncio
async def test_disponible_retira_lo_reservado_y_desmarcarlo_lo_devuelve(session):
    await mundo(session)
    session.add(linea(1, OT_A, BARRA, 5))
    await session.commit()
    async with cliente(session) as c:
        await c.put("/materia-prima/lineas/1", json={"reserva": True, "cantidad_reservada": 4})
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 4.0, "libre": 6.0}

        r = await c.put("/materia-prima/lineas/1", json={"disponible": True})
        assert r.status_code == 200, r.text
        l = r.json()["data"]
        assert l["disponible"] is True and l["disponible_por"] == "Maxi Pérez"
        assert l["fecha_entrega"] == ahora_ar().date().isoformat()   # no tenía: hoy
        guardada = await fila(session, OrdenTrabajoPieza, 1)
        retiro = await fila(session, PiezaMovimiento, guardada.id_movimiento_retiro)
        assert (retiro.tipo, retiro.cantidad, retiro.id_orden_trabajo, retiro.id_orden_trabajo_pieza) == \
            ("retiro_ot", -4.0, OT_A, 1)
        assert retiro.comentario == "OT N° 15010 – retirado para la orden"
        assert retiro.usuario == "Maxi Pérez" and retiro.anulado == 0
        # Ya salió del depósito: el físico baja y lo reservado deja de contar.
        assert (await fila(session, Pieza, BARRA)).stockactual == 6.0
        assert await stock_barra(session) == {"fisico": 6.0, "reservado": 0.0, "libre": 6.0}
        # Lo reservado de una línea disponible no se cambia (ya se retiró), ni se re-reserva.
        assert (await c.put("/materia-prima/lineas/1", json={"cantidad_reservada": 3})).status_code == 422

        # Desmarcar: el retiro se anula, el stock vuelve y la reserva vuelve a contar. La
        # fecha de entrega queda.
        r = await c.put("/materia-prima/lineas/1", json={"disponible": False})
        l = r.json()["data"]
        assert l["disponible"] is False and l["disponible_en"] is None and l["disponible_por"] is None
        assert l["fecha_entrega"] == ahora_ar().date().isoformat()
        retiro = await fila(session, PiezaMovimiento, retiro.id)
        assert retiro.anulado == 1 and retiro.motivo_anulacion == "Se desmarcó Disponible"
        assert (await fila(session, OrdenTrabajoPieza, 1)).id_movimiento_retiro is None
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 4.0, "libre": 6.0}

        # «Quitar marcas» en un solo pedido: primero se anula el retiro, después se suelta
        # la reserva y el pedido.
        await c.put("/materia-prima/lineas/1", json={"disponible": True, "pedido": True})
        assert await stock_barra(session) == {"fisico": 6.0, "reservado": 0.0, "libre": 6.0}
        r = await c.put("/materia-prima/lineas/1",
                        json={"disponible": False, "reserva": False, "pedido": False})
        l = r.json()["data"]
        assert not (l["disponible"] or l["reserva"] or l["pedido"])
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 0.0, "libre": 10.0}
        vivos = (await session.execute(
            select(func.count(PiezaMovimiento.id)).where(PiezaMovimiento.tipo == "retiro_ot",
                                                         PiezaMovimiento.anulado == 0))).scalar()
        assert vivos == 0


@pytest.mark.asyncio
async def test_disponible_sin_reserva_no_mueve_stock_y_respeta_la_fecha_que_vino(session):
    await mundo(session)
    session.add_all([linea(1, OT_A, BARRA, 5), linea(2, OT_A, BARRA, 1)])
    await session.commit()
    async with cliente(session) as c:
        r = await c.put("/materia-prima/lineas/1", json={"disponible": True})
        assert r.json()["data"]["fecha_entrega"] == ahora_ar().date().isoformat()
        assert (await fila(session, OrdenTrabajoPieza, 1)).id_movimiento_retiro is None
        assert (await stock_barra(session))["fisico"] == 10.0
        # Una fecha que vino en el mismo pedido manda (aunque sea null).
        r = await c.put("/materia-prima/lineas/2", json={"disponible": True, "fecha_entrega": None})
        assert r.json()["data"]["fecha_entrega"] is None
        # Reservar lo que ya está disponible no tiene sentido.
        r = await c.put("/materia-prima/lineas/1", json={"reserva": True})
        assert r.status_code == 422 and "ya está disponible" in mensaje(r)


@pytest.mark.asyncio
async def test_utilizado_y_cantidad_arrastran_la_reserva(session):
    await mundo(session)
    session.add(linea(1, OT_A, BARRA, 5))
    await session.commit()
    async with cliente(session) as c:
        await c.put("/materia-prima/lineas/1", json={"reserva": True, "cantidad_reservada": 4})
        # Bajar la cantidad por debajo de lo reservado baja la reserva.
        r = await c.put("/materia-prima/lineas/1", json={"cantidad": 3})
        assert (r.json()["data"]["cantidad"], r.json()["data"]["cantidad_reservada"]) == (3.0, 3.0)
        for mala in (0, -2, None):
            r = await c.put("/materia-prima/lineas/1", json={"cantidad": mala})
            assert r.status_code == 422, mala
        # Dejar de usar la línea suelta la reserva.
        r = await c.put("/materia-prima/lineas/1", json={"usado": False})
        l = r.json()["data"]
        assert l["usado"] is False and l["reserva"] is False and l["cantidad_reservada"] is None
        assert (await stock_barra(session))["reservado"] == 0.0
        # Y una línea que no se usa no se reserva.
        r = await c.put("/materia-prima/lineas/1", json={"reserva": True})
        assert r.status_code == 422 and "Utilizado" in mensaje(r)
        r = await c.put("/materia-prima/lineas/1", json={"usado": True, "reserva": True})
        assert r.status_code == 200 and r.json()["data"]["cantidad_reservada"] == 3.0


@pytest.mark.asyncio
async def test_descripcion_fechas_proveedor_e_insumo(session):
    await mundo(session)
    session.add_all([linea(1, OT_A, CHAPA, 1, "Un"), linea(2, OT_A, BARRA, 1)])
    await session.commit()
    async with cliente(session) as c:
        # Descripción: libre en lo que no es 'insumo'; vacía vuelve a la del insumo.
        r = await c.put("/materia-prima/lineas/1", json={"descripcion": "CHAPA 2MM 300X400"})
        assert r.json()["data"]["descripcion"] == "CHAPA 2MM 300X400"
        r = await c.put("/materia-prima/lineas/1", json={"descripcion": ""})
        assert r.json()["data"]["descripcion"] == "CHAPA A MEDIDA"
        r = await c.put("/materia-prima/lineas/2", json={"descripcion": "BARRA CUALQUIERA"})
        assert r.status_code == 422 and "sale de sus medidas" in mensaje(r)

        # Fechas: lo que no vino no se toca; null explícito la borra.
        r = await c.put("/materia-prima/lineas/1", json={"fecha_proveedor": "2026-09-28",
                                                         "fecha_entrega": "2026-09-30"})
        assert (r.json()["data"]["fecha_proveedor"], r.json()["data"]["fecha_entrega"]) == \
            ("2026-09-28", "2026-09-30")
        r = await c.put("/materia-prima/lineas/1", json={"observaciones": "pedir a Daniel"})
        assert r.json()["data"]["fecha_proveedor"] == "2026-09-28"
        assert r.json()["data"]["observaciones"] == "pedir a Daniel"
        r = await c.put("/materia-prima/lineas/1", json={"fecha_proveedor": None})
        assert r.json()["data"]["fecha_proveedor"] is None
        assert r.json()["data"]["fecha_entrega"] == "2026-09-30"

        # Proveedor: el del catálogo pone su nombre; un texto a mano suelta el id.
        r = await c.put("/materia-prima/lineas/1", json={"id_proveedor": PROV})
        assert (r.json()["data"]["id_proveedor"], r.json()["data"]["proveedor"]) == (PROV, "ACEROS CAS SA")
        r = await c.put("/materia-prima/lineas/1", json={"proveedor": "LAVALLE"})
        assert (r.json()["data"]["id_proveedor"], r.json()["data"]["proveedor"]) == (None, "LAVALLE")
        r = await c.put("/materia-prima/lineas/1", json={"id_proveedor": PROV, "proveedor": "CAS"})
        assert (r.json()["data"]["id_proveedor"], r.json()["data"]["proveedor"]) == (PROV, "CAS")
        r = await c.put("/materia-prima/lineas/1", json={"id_proveedor": None, "proveedor": None})
        assert (r.json()["data"]["id_proveedor"], r.json()["data"]["proveedor"]) == (None, None)
        assert (await c.put("/materia-prima/lineas/1", json={"id_proveedor": 999})).status_code == 404

        # El insumo de la línea no se cambia (el mismo, sí: no cambia nada).
        r = await c.put("/materia-prima/lineas/1", json={"id_pieza": BULON})
        assert r.status_code == 422 and "borrala y agregá otra" in mensaje(r)
        assert (await c.put("/materia-prima/lineas/1", json={"id_pieza": CHAPA})).status_code == 200

        # Unidad, orden y PRODUC.
        r = await c.put("/materia-prima/lineas/1", json={"unidad": "MTS", "orden": 7, "en_produccion": True})
        assert (r.json()["data"]["unidad"], r.json()["data"]["orden"], r.json()["data"]["en_produccion"]) == \
            ("Mts", 7, True)
        assert (await c.put("/materia-prima/lineas/999", json={"pedido": True})).status_code == 404


# ─────────────────────────── lote ───────────────────────────


@pytest.mark.asyncio
async def test_cambios_en_lote(session):
    await mundo(session)
    session.add_all([linea(1, OT_A, BARRA, 4), linea(2, OT_B, BARRA, 4), linea(3, OT_C, CHAPA, 1, "Un")])
    await session.commit()
    async with cliente(session) as c:
        r = await c.put("/materia-prima/lineas/lote", json={
            "ids": [3, 1, 3, 2],
            "cambios": {"pedido": True, "id_proveedor": PROV, "fecha_proveedor": "2026-10-02"}})
        assert r.status_code == 200, r.text
        datos = r.json()["data"]
        assert [l["id"] for l in datos] == [3, 1, 2]                 # en el orden pedido, sin repetir
        assert all(l["pedido"] and l["proveedor"] == "ACEROS CAS SA"
                   and l["fecha_proveedor"] == "2026-10-02" for l in datos)

        # Reservar cuatro líneas de 4 con 10 en stock: cada una ve lo que ya apartaron las
        # anteriores del mismo lote. 4 + 4 entran, la tercera se lleva los 2 que quedan y a
        # la cuarta no le queda nada: un solo 409 para todo el lote, y nada reservado.
        session.add_all([linea(5, OT_C, BARRA, 4), linea(6, OT_A, BARRA, 4)])
        await session.commit()
        r = await c.put("/materia-prima/lineas/lote",
                        json={"ids": [1, 2, 5, 6], "cambios": {"reserva": True}})
        assert r.status_code == 409
        assert mensaje(r) == ("Hay 0 libres de ABR203; la reserva de 4 para la OT N° 15010 deja el "
                              "stock en negativo. ¿Hacerlo igual?")
        assert (await stock_barra(session))["reservado"] == 0.0
        r = await c.put("/materia-prima/lineas/lote", params={"forzar": "true"},
                        json={"ids": [1, 2, 5, 6], "cambios": {"reserva": True}})
        assert r.status_code == 200
        assert [l["cantidad_reservada"] for l in r.json()["data"]] == [4.0, 4.0, 2.0, 4.0]
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 14.0, "libre": -4.0}

        # Si una línea no puede, no cambia ninguna (y el mensaje dice cuál): la 2 se
        # reservaría, pero la 3 ya está disponible.
        await c.put("/materia-prima/lineas/2", json={"reserva": False})
        await c.put("/materia-prima/lineas/3", json={"disponible": True})
        r = await c.put("/materia-prima/lineas/lote",
                        json={"ids": [2, 3], "cambios": {"reserva": True}})
        assert r.status_code == 422 and mensaje(r).startswith("CHA001 (OT N° 15012):")
        assert (await fila(session, OrdenTrabajoPieza, 2)).reserva == 0

        r = await c.put("/materia-prima/lineas/lote", json={"ids": [1, 999], "cambios": {"pedido": False}})
        assert r.status_code == 404 and "999" in mensaje(r)
        assert (await fila(session, OrdenTrabajoPieza, 1)).pedido == 1
        r = await c.put("/materia-prima/lineas/lote", json={"ids": [], "cambios": {"pedido": True}})
        assert r.status_code == 422


# ─────────────────────────── cortes ───────────────────────────


@pytest.mark.asyncio
async def test_los_cortes_se_reemplazan_y_sugieren_metros(session):
    await mundo(session)
    session.add(linea(1, OT_A, BARRA, 2))
    await session.flush()
    session.add(OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=1, cantidad=9, texto_original="80x200x20mm"))
    await session.commit()
    async with cliente(session) as c:
        r = await c.put("/materia-prima/lineas/1/cortes", json={"cortes": [
            {"cantidad": 3, "largo_mm": 1093}, {"cantidad": 2, "largo_mm": 500, "ancho_mm": 20.25}]})
        l = r.json()["data"]
        assert [(k["cantidad"], k["largo_mm"], k["ancho_mm"]) for k in l["cortes"]] == \
            [(3, 1093.0, None), (2, 500.0, 20.2)]
        # 3 × 1096 + 2 × 503 = 4294 mm → 4,30 m (hacia arriba). La cantidad no cambia sola.
        assert l["sugerido_m"] == 4.3 and l["cantidad"] == 2.0
        assert l["modificado_por"] == "Maxi Pérez"
        # Uno sin largo: no hay sugerencia (sería corta).
        r = await c.put("/materia-prima/lineas/1/cortes", json={"cortes": [
            {"cantidad": 3, "largo_mm": 1093}, {"cantidad": 1}]})
        assert r.json()["data"]["sugerido_m"] is None
        r = await c.put("/materia-prima/lineas/1/cortes", json={"cortes": []})
        assert r.json()["data"]["cortes"] == [] and r.json()["data"]["sugerido_m"] is None
        assert (await session.execute(select(func.count(OrdenTrabajoPiezaCorte.id)))).scalar() == 0
        for malo in ({"cantidad": 0, "largo_mm": 10}, {"cantidad": 1.5}, {"cantidad": 1, "largo_mm": -3}):
            assert (await c.put("/materia-prima/lineas/1/cortes", json={"cortes": [malo]})).status_code == 422
        assert (await c.put("/materia-prima/lineas/9/cortes", json={"cortes": []})).status_code == 404


# ─────────────────────────── borrar ───────────────────────────


@pytest.mark.asyncio
async def test_borrar_avisa_lo_que_se_pierde(session):
    await mundo(session)
    session.add_all([
        linea(1, OT_A, BARRA, 2),
        linea(2, OT_A, BULON, 4, "Un", pedido=1, pedido_por="Maxi Pérez", proveedor="ROSSI"),
        linea(3, OT_A, CHAPA, 1, "Un"),
        linea(4, OT_A, BARRA, 5),
    ])
    await session.flush()
    session.add_all([
        ConsumoMaterial(id_orden_trabajo=OT_A, id_pieza=BARRA, id_orden_trabajo_pieza=1,
                        cantidad=1.5, unidad="Mts", fecha=datetime(2026, 9, 21), anulado=0),
        OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=3, cantidad=2, largo_mm=100),
    ])
    await session.commit()
    async with cliente(session) as c:
        r = await c.delete("/materia-prima/lineas/1")
        assert r.status_code == 409
        assert mensaje(r) == ("La línea ABR203 de la OT N° 15010 tiene 1 consumo cargado (1,5 Mts), "
                              "que queda registrado en la OT pero sin esta línea. ¿Borrarla igual?")
        r = await c.delete("/materia-prima/lineas/1", params={"forzar": "true"})
        assert r.status_code == 200 and r.json()["data"] == {"id": 1}
        assert await fila(session, OrdenTrabajoPieza, 1) is None
        # El consumo queda: se consumió igual.
        assert (await session.execute(select(func.count(ConsumoMaterial.id)))).scalar() == 1

        r = await c.delete("/materia-prima/lineas/2")
        assert r.status_code == 409 and "está pedida a ROSSI (la marcó Maxi Pérez)" in mensaje(r)
        assert (await c.delete("/materia-prima/lineas/2", params={"forzar": "true"})).status_code == 200

        # Sin nada que perder, se borra de una (y sus cortes con ella).
        assert (await c.delete("/materia-prima/lineas/3")).status_code == 200
        assert (await session.execute(select(func.count(OrdenTrabajoPiezaCorte.id)))).scalar() == 0

        # Si había retirado stock, el retiro se anula: el material vuelve.
        await c.put("/materia-prima/lineas/4", json={"reserva": True, "cantidad_reservada": 5,
                                                     "disponible": True})
        assert (await stock_barra(session))["fisico"] == 5.0
        assert (await c.delete("/materia-prima/lineas/4")).status_code == 200
        assert (await stock_barra(session))["fisico"] == 10.0
        assert (await c.delete("/materia-prima/lineas/4")).status_code == 404


# ─────────────────────────── traer historial ───────────────────────────


@pytest.mark.asyncio
async def test_traer_historial(session):
    await mundo(session)
    session.add_all([
        # OT B (6 unidades, 1/8): la más reciente del artículo 1 con líneas usadas.
        linea(1, OT_B, BARRA, 1.5, orden=1, descripcion="DESCRIPCIÓN VIEJA", proveedor="ACEROS CAS SA",
              pedido=1, disponible=1, observaciones="R-659"),
        linea(2, OT_B, BULON, 3, "Un", orden=2),
        linea(3, OT_B, CHAPA, 2, "Un", orden=3, usado=0),               # no se usa: no viene
        linea(4, OT_B, CHAPA, 0, "Un", orden=4),                        # en cero: no viene
        linea(5, OT_B, CHAPA, 5, "Un", orden=5, descripcion="CHAPA 3MM 200X300", id_proveedor=PROV),
    ])
    # Una más vieja del mismo artículo, y una más nueva que sólo tiene líneas que no se usan.
    for id_ot, fecha in ((20, datetime(2026, 7, 1)), (21, datetime(2026, 8, 15))):
        session.add(OrdenTrabajo(id=id_ot, id_otvieja=15000 + id_ot, id_prioridad=1, id_sector=1,
                                 id_articulo=1, unidades=1, fecha_orden=fecha, fecha_entrada=fecha,
                                 fecha_prometida=datetime(2026, 10, 1)))
    await session.flush()
    session.add_all([linea(6, 20, BARRA, 99), linea(7, 21, BARRA, 99, usado=0)])
    await session.flush()
    session.add_all([
        OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=1, cantidad=3, largo_mm=700, orden=1),
        OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=1, cantidad=1, largo_mm=250, ancho_mm=40, orden=2),
    ])
    await session.commit()

    async with cliente(session) as c:
        r = await c.get(f"/materia-prima/ot/{OT_A}/historial")
        assert r.status_code == 200, r.text
        h = r.json()["data"]
        assert h["origen"] == {"id": OT_B, "numero_ot": 15011, "fecha_ot": "2026-08-01", "unidades": 6}
        assert h["factor"] == 0.5                                       # 3 / 6
        assert [l["codigo"] for l in h["lineas"]] == ["ABR203", "BUL001", "CHA001"]
        barra, bulon, chapa = h["lineas"]
        assert barra == {"id_pieza": BARRA, "codigo": "ABR203", "descripcion": DESC_BARRA,
                         "cantidad": 0.75, "unidad": "Mts", "id_proveedor": None,
                         "proveedor": "ACEROS CAS SA",
                         "cortes": [{"cantidad": 2, "largo_mm": 700.0, "ancho_mm": None},   # 1,5 → 2
                                    {"cantidad": 1, "largo_mm": 250.0, "ancho_mm": 40.0}]}  # 0,5 → 1
        assert (bulon["cantidad"], bulon["unidad"]) == (2, "Un")       # 1,5 bulones son 2
        assert (chapa["descripcion"], chapa["cantidad"], chapa["proveedor"], chapa["id_proveedor"]) == \
            ("CHAPA 3MM 200X300", 3, "ACEROS CAS SA", PROV)            # 2,5 → 3

        # Para una OT que todavía no existe: por artículo y unidades.
        r = await c.get("/materia-prima/historial", params={"id_articulo": 1, "unidades": 12})
        h = r.json()["data"]
        assert h["origen"]["id"] == OT_B and h["factor"] == 2.0
        assert [l["cantidad"] for l in h["lineas"]] == [3.0, 6, 10]
        # Sin unidades: se copia tal cual.
        r = await c.get("/materia-prima/historial", params={"id_articulo": 1})
        assert r.json()["data"]["factor"] == 1.0

        # Sin historial: nada que traer.
        r = await c.get(f"/materia-prima/ot/{OT_C}/historial")
        assert r.json()["data"] == {"origen": None, "factor": 1.0, "lineas": []}
        assert (await c.get("/materia-prima/ot/999/historial")).status_code == 404

        # Lo que devuelve la vista previa entra tal cual por el lote.
        r = await c.get(f"/materia-prima/ot/{OT_A}/historial")
        lote = [{**l, "origen": "historial"} for l in r.json()["data"]["lineas"]]
        for l in lote:
            del l["codigo"]
        r = await c.post(f"/materia-prima/ot/{OT_A}/lineas/lote", json={"lineas": lote})
        assert r.status_code == 200, r.text
        nuevas = r.json()["data"]
        assert [(l["codigo"], l["cantidad"], l["origen"], l["pedido"]) for l in nuevas] == [
            ("ABR203", 0.75, "historial", False), ("BUL001", 2.0, "historial", False),
            ("CHA001", 3.0, "historial", False)]
        assert nuevas[0]["observaciones"] is None and len(nuevas[0]["cortes"]) == 2

        # La OT A ahora tiene historial propio, pero se excluye a sí misma.
        r = await c.get(f"/materia-prima/ot/{OT_A}/historial")
        assert r.json()["data"]["origen"]["id"] == OT_B


# ─────────────────────────── el stock, mirado desde el insumo ───────────────────────────


@pytest.mark.asyncio
async def test_la_linea_y_el_insumo_cuentan_el_mismo_stock(session):
    """Cada transición de una línea se ve igual desde la línea (stock_libre), desde la
    ficha del insumo (movimientos, reservas) y desde «OT donde se usó» (con su reserva:
    sin ella, una línea apartada del stock se leía «Falta pedir»)."""
    await mundo(session)
    session.add_all([linea(1, OT_A, BARRA, 4), linea(2, OT_B, BARRA, 3)])
    await session.commit()
    async with cliente(session) as c:
        async def ficha():
            r = await c.get(f"/materia-prima/insumos/{BARRA}/movimientos")
            assert r.status_code == 200, r.text
            return r.json()["data"]

        r = await c.put("/materia-prima/lineas/1", json={"reserva": True})
        assert r.json()["data"]["cantidad_reservada"] == 4.0
        assert r.json()["data"]["stock_libre"] == 6.0        # la respuesta ya lo cuenta
        f = await ficha()
        assert (f["fisico"], f["reservado"], f["libre"]) == (10.0, 4.0, 6.0)
        assert f["reservas"] == [{"id_linea": 1, "id_orden_trabajo": OT_A, "numero_ot": 15010,
                                  "cantidad_reservada": 4.0}]
        usos = {u["id_linea"]: u for u in (await c.get(f"/materia-prima/insumos/{BARRA}/ots")).json()["data"]}
        assert (usos[1]["reserva"], usos[1]["cantidad_reservada"]) == (True, 4.0)
        assert (usos[2]["reserva"], usos[2]["cantidad_reservada"]) == (False, None)

        # Disponible: sale del depósito (retiro_ot) y deja de estar reservado.
        await c.put("/materia-prima/lineas/1", json={"disponible": True})
        f = await ficha()
        assert (f["fisico"], f["reservado"], f["libre"]) == (6.0, 0.0, 6.0)
        retiro = f["movimientos"][-1]
        assert (retiro["tipo"], retiro["egreso"], retiro["saldo"], retiro["numero_ot"]) == \
            ("retiro_ot", 4.0, 6.0, 15010)
        # El retiro no se anula desde el stock: se anula desmarcando Disponible.
        r = await c.put(f"/materia-prima/movimientos/{retiro['id']}/anular", json={"motivo": "error"})
        assert r.status_code == 422 and "desmarcando «Disponible»" in mensaje(r)
        assert (await ficha())["fisico"] == 6.0

        await c.put("/materia-prima/lineas/1", json={"disponible": False})
        f = await ficha()
        assert (f["fisico"], f["reservado"], f["libre"]) == (10.0, 4.0, 6.0)
        assert f["movimientos"][-1]["anulado"] is True and f["movimientos"][-1]["saldo"] is None

        # Borrar una línea reservada suelta su reserva (sin movimiento: nunca salió nada).
        assert (await c.delete("/materia-prima/lineas/1")).status_code == 200
        f = await ficha()
        assert (f["fisico"], f["reservado"], f["libre"], f["reservas"]) == (10.0, 0.0, 10.0, [])


@pytest.mark.asyncio
async def test_reservar_en_lote_sin_cantidad(session):
    """«Reservar de stock» en Pendientes manda {reserva: true} sin cantidad: cada línea
    se lleva lo libre que haya, hasta su cantidad, y ve lo que apartaron las anteriores del
    mismo lote. Si a alguna no le queda nada, UN 409 que dice cuál; con forzar esa línea
    reserva su cantidad entera."""
    await mundo(session)
    session.add_all([linea(1, OT_A, BARRA, 4), linea(2, OT_B, BARRA, 8), linea(3, OT_C, BARRA, 3),
                     linea(4, OT_C, BULON, 5, "Un")])        # sin stock de bulones
    await session.commit()
    async with cliente(session) as c:
        # 4 y 6 de los 8 (lo que queda): alcanza para las dos, sin aviso.
        r = await c.put("/materia-prima/lineas/lote", json={"ids": [1, 2], "cambios": {"reserva": True}})
        assert r.status_code == 200, r.text
        assert [(l["id"], l["cantidad_reservada"], l["falta"]) for l in r.json()["data"]] == \
            [(1, 4.0, 0.0), (2, 6.0, 2.0)]
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 10.0, "libre": 0.0}

        # Ya no hay libre de la barra ni hubo nunca bulones: un aviso por cada una, juntos.
        r = await c.put("/materia-prima/lineas/lote", json={"ids": [3, 4], "cambios": {"reserva": True}})
        assert r.status_code == 409
        assert mensaje(r) == (
            "Hay 0 libres de ABR203; la reserva de 3 para la OT N° 15012 deja el stock en negativo. "
            "Hay 0 libres de BUL001; la reserva de 5 para la OT N° 15012 deja el stock en negativo. "
            "¿Hacerlo igual?")
        assert (await fila(session, OrdenTrabajoPieza, 3)).reserva == 0
        r = await c.put("/materia-prima/lineas/lote", params={"forzar": "true"},
                        json={"ids": [3, 4], "cambios": {"reserva": True}})
        assert [l["cantidad_reservada"] for l in r.json()["data"]] == [3.0, 5.0]
        assert [l["stock_libre"] for l in r.json()["data"]] == [-3.0, -5.0]


@pytest.mark.asyncio
async def test_disponible_en_lote_retira_cada_reserva_y_desmarcar_la_devuelve(session):
    await mundo(session)
    await stock.registrar_movimiento(session, BULON, "ingreso", 100, usuario=MAXI)
    await session.commit()
    session.add_all([
        linea(1, OT_A, BARRA, 4, reserva=1, cantidad_reservada=4),
        linea(2, OT_B, BULON, 30, "Un", reserva=1, cantidad_reservada=20),   # 20 de stock + 10 a pedir
        linea(3, OT_C, CHAPA, 1, "Un"),                                     # sin reserva
    ])
    await session.commit()
    async with cliente(session) as c:
        r = await c.put("/materia-prima/lineas/lote",
                        json={"ids": [1, 2, 3], "cambios": {"disponible": True, "pedido": True}})
        assert r.status_code == 200, r.text
        assert all(l["disponible"] and l["fecha_entrega"] for l in r.json()["data"])
        retiros = (await session.execute(
            select(PiezaMovimiento.id_orden_trabajo_pieza, PiezaMovimiento.cantidad)
            .where(PiezaMovimiento.tipo == "retiro_ot", PiezaMovimiento.anulado == 0)
            .order_by(PiezaMovimiento.id_orden_trabajo_pieza))).all()
        assert retiros == [(1, -4.0), (2, -20.0)]              # la chapa no tenía nada que retirar
        assert (await fila(session, Pieza, BULON)).stockactual == 80.0
        assert (await stock_barra(session))["fisico"] == 6.0

        # Todo o nada también al desmarcar: una línea que no existe no deja nada a medias.
        r = await c.put("/materia-prima/lineas/lote", json={"ids": [1, 2, 999], "cambios": {"disponible": False}})
        assert r.status_code == 404
        assert (await stock_barra(session))["fisico"] == 6.0

        r = await c.put("/materia-prima/lineas/lote", json={"ids": [1, 2, 3], "cambios": {"disponible": False}})
        assert r.status_code == 200
        vivos = (await session.execute(
            select(func.count(PiezaMovimiento.id))
            .where(PiezaMovimiento.tipo == "retiro_ot", PiezaMovimiento.anulado == 0))).scalar()
        assert vivos == 0
        assert (await fila(session, Pieza, BULON)).stockactual == 100.0
        # Las reservas vuelven a apartar: 4 de la barra y 20 de los bulones.
        assert await stock_barra(session) == {"fisico": 10.0, "reservado": 4.0, "libre": 6.0}
        assert (await stock.stock_de(session, [BULON]))[BULON]["reservado"] == 20.0


@pytest.mark.asyncio
async def test_reservar_con_el_stock_ya_en_negativo(session):
    """Un egreso forzado dejó el físico en −2: lo libre es negativo, el aviso dice «0
    libres» (no «-2 libres») y con forzar la reserva igual entra."""
    await mundo(session)
    await stock.registrar_movimiento(session, BARRA, "egreso", -12, usuario=MAXI)
    await session.commit()
    session.add(linea(1, OT_A, BARRA, 1.5))
    await session.commit()
    async with cliente(session) as c:
        r = await c.put("/materia-prima/lineas/1", json={"reserva": True})
        assert r.status_code == 409 and mensaje(r).startswith("Hay 0 libres de ABR203; la reserva de 1,5 ")
        r = await c.put("/materia-prima/lineas/1", params={"forzar": "true"}, json={"reserva": True})
        assert r.status_code == 200
        assert (r.json()["data"]["cantidad_reservada"], r.json()["data"]["stock_libre"]) == (1.5, -3.5)
        # Subir la cantidad de la línea no toca lo reservado (sólo bajarla lo recorta).
        r = await c.put("/materia-prima/lineas/1", json={"cantidad": 5})
        assert (r.json()["data"]["cantidad"], r.json()["data"]["cantidad_reservada"]) == (5.0, 1.5)
        assert r.json()["data"]["falta"] == 3.5


# ─────────────────────────── no lleva ───────────────────────────


@pytest.mark.asyncio
async def test_no_lleva_materias_primas(session):
    await mundo(session)
    async with cliente(session) as c:
        r = await c.put(f"/materia-prima/ot/{OT_A}/no-lleva", json={"no_lleva": True})
        assert r.status_code == 200 and r.json()["data"] == {"no_lleva_materia_prima": True}
        orden = await fila(session, OrdenTrabajo, OT_A)
        assert orden.no_lleva_materia_prima == 1 and orden.modificado_por == "Maxi Pérez"
        sello = orden.modificado_en
        # Marcar lo que ya está marcado no toca nada.
        r = await c.put(f"/materia-prima/ot/{OT_A}/no-lleva", json={"no_lleva": True})
        assert r.status_code == 200 and (await fila(session, OrdenTrabajo, OT_A)).modificado_en == sello
        r = await c.put(f"/materia-prima/ot/{OT_A}/no-lleva", json={"no_lleva": False})
        assert r.json()["data"] == {"no_lleva_materia_prima": False}
        assert (await c.get(f"/materia-prima/ot/{OT_A}/lineas")).json()["data"]["no_lleva_materia_prima"] is False
        assert (await c.put("/materia-prima/ot/999/no-lleva", json={"no_lleva": True})).status_code == 404


# ─────────────────────────── historial para una OT nueva ───────────────────────────


@pytest.mark.asyncio
async def test_el_historial_de_una_ot_nueva_tiene_la_misma_forma(session):
    """GET /materia-prima/historial (el alta de una OT, sin id todavía) y GET
    /materia-prima/ot/{id}/historial devuelven lo mismo para el mismo artículo y las
    mismas unidades: la pantalla usa un solo tipo (HistorialOT) para las dos."""
    await mundo(session)
    session.add_all([linea(1, OT_B, BARRA, 1.5, orden=1), linea(2, OT_B, BULON, 3, "Un", orden=2)])
    await session.flush()
    session.add(OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=1, cantidad=3, largo_mm=700, orden=1))
    await session.commit()
    async with cliente(session) as c:
        de_la_ot = (await c.get(f"/materia-prima/ot/{OT_A}/historial")).json()["data"]
        nueva = (await c.get("/materia-prima/historial", params={"id_articulo": 1, "unidades": 3})).json()["data"]
        assert nueva == de_la_ot
        assert set(nueva) == {"origen", "factor", "lineas"}
        assert set(nueva["origen"]) == {"id", "numero_ot", "fecha_ot", "unidades"}
        assert set(nueva["lineas"][0]) == {"id_pieza", "codigo", "descripcion", "cantidad", "unidad",
                                           "id_proveedor", "proveedor", "cortes"}
        # Una OT que ya existe y usa la ruta por artículo puede excluirse a sí misma.
        r = await c.get("/materia-prima/historial", params={"id_articulo": 1, "excluir_ot": OT_B})
        assert r.json()["data"] == {"origen": None, "factor": 1.0, "lineas": []}
        # Un artículo sin OT: nada que traer (no un error).
        r = await c.get("/materia-prima/historial", params={"id_articulo": 999})
        assert r.status_code == 200 and r.json()["data"]["origen"] is None


# ─────────────────────────── fechas ───────────────────────────


@pytest.mark.asyncio
async def test_las_fechas_con_hora_salen_sin_microsegundos(session):
    """Spec §2: «YYYY-MM-DDTHH:MM:SS», sin zona. ahora_ar() trae microsegundos y la base
    los guarda: se recortan al salir, en todas las respuestas de las dos APIs."""
    import re
    momento = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
    await mundo(session)
    con_micro = datetime(2026, 9, 23, 10, 15, 30, 123456)
    session.add_all([
        linea(1, OT_A, BARRA, 2, pedido=1, pedido_en=con_micro, pedido_por="Maxi",
              modificado_en=con_micro),
        CaneraOcupacion(columna="B", fila=3, id_orden_trabajo=OT_A, desde=con_micro),
        OrdenTrabajoProceso(id_orden_trabajo=OT_A, id_proceso=100, orden=1, id_estado=1),
        Proceso(id=100, nombre="TORNO"), EstadoProceso(id=1, descripcion="Pendiente"),
    ])
    await session.commit()

    def revisar(linea_api):
        for campo in ("pedido_en", "disponible_en", "modificado_en"):
            valor = linea_api[campo]
            assert valor is None or momento.match(valor), (campo, valor)

    async with cliente(session) as c:
        l = (await c.get(f"/materia-prima/ot/{OT_A}/lineas")).json()["data"]["lineas"][0]
        assert l["pedido_en"] == "2026-09-23T10:15:30"
        revisar(l)
        r = await c.put("/materia-prima/lineas/1", json={"disponible": True})
        revisar(r.json()["data"])
        assert r.json()["data"]["disponible_en"] is not None
        for l in (await c.put("/materia-prima/lineas/lote", json={"ids": [1], "cambios": {"pedido": False}})
                  ).json()["data"]:
            revisar(l)
        l = (await c.post(f"/materia-prima/ot/{OT_A}/lineas", json={"id_pieza": CHAPA, "cantidad": 1})).json()["data"]
        revisar(l)
        revisar((await c.put(f"/materia-prima/lineas/{l['id']}/cortes", json={"cortes": []})).json()["data"])
        d = (await c.get("/materia-prima/pendientes", params={"todas_abiertas": "true", "filtro": "todas"})
             ).json()["data"]
        for l in d["lineas"]:
            revisar(l)

        canera = (await c.get("/materia-prima/canera")).json()["data"]
        assert canera["ocupaciones"][0]["desde"] == "2026-09-23T10:15:30"
        r = await c.post("/materia-prima/canera", json={"celda": "C1", "numero_ot": 15011})
        assert all(momento.match(o["desde"]) for o in r.json()["data"]["ocupaciones"])
        r = await c.post("/materia-prima/canera/liberar-terminadas")
        assert all(momento.match(o["desde"]) for o in r.json()["data"]["canera"]["ocupaciones"])
