"""El núcleo de la materia prima sobre la base (SQLite de tests): stock, estado del
material, cañera, el borrado de una OT con materiales y las tres rutas que ya existen.

Lo que persigue este archivo:

  1. **Que el stock deje de ser la suma de movimientos.** `pieza.stockactual` es un caché:
     cada movimiento (y cada anulación) lo recalcula, y nada lo pisa por otro lado.
  2. **Que una reserva vieja o ajena se cuente como reservada.** Sólo las vigentes
     (reserva, usada, sin retirar), y la línea que pregunta no compite consigo misma.
  3. **Que un movimiento mal firmado entre**: un «ingreso» negativo sumaría bien y se
     leería mal. Y que un retiro de una OT se anule por la línea, no a mano.
  4. **Que la columna Material diga «ok» con algo sin pedir** (el bug de origen), o que
     ignore la marca «No lleva materias primas».
  5. **Que borrar una OT con materiales tire 500** (pasaba: la FK frenaba) o que se lleve
     puesto el historial de la cañera o los movimientos de stock.
  6. **Que nada de esto haga commit por su cuenta**: el servicio que llama decide.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from backend.application.materia_prima import canera as canera_mod
from backend.application.materia_prima import estado as estado_mod
from backend.application.materia_prima import stock
from backend.application.materia_prima.semilla import FORMATOS_SEMILLA, sembrar_formatos
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user
from backend.domain.Articulo import Articulo
from backend.domain.CaneraOcupacion import CaneraOcupacion
from backend.domain.Cliente import Cliente
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.Formato import Formato
from backend.domain.Material import Material
from backend.domain.MaterialCalidad import MaterialCalidad
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.OrdenTrabajoPiezaCorte import OrdenTrabajoPiezaCorte
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Pieza import Pieza
from backend.domain.PiezaMovimiento import PiezaMovimiento
from backend.domain.PiezaRecorte import PiezaRecorte
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.infrastructure import migraciones
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.presentation import MateriaPrimaCatalogoAPI, MateriaPrimaOTAPI, MateriaPrimaPendientesAPI

MAXI = {"id_usuario": 7, "username": "maxi", "nombre": "Maxi", "apellido": "Pérez", "rol": "supervisor"}

BARRA, CHAPA, BULON = 70, 71, 72
OT_A, OT_B, OT_C = 10, 11, 12


async def _mundo(session):
    """Tres OT (números 15010..15012), tres insumos con stock en su caché y sin
    movimientos, y líneas con distintas marcas."""
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja de acero", abreviatura="BAND"),
        Cliente(id=1, nombre="ACME SRL"),
        Pieza(id=BARRA, cod_pieza="ABR203", descripcion="BARRA REDONDO 19mm ACERO SAE 1010",
              unidad="MTS", stockactual=12.0),
        Pieza(id=CHAPA, cod_pieza="AP145", descripcion="PLACA 10mm x 60mm x 230mm ALUMINIO",
              unidad="UN", stockactual=0.0),
        Pieza(id=BULON, cod_pieza="BUL001", descripcion="BULON M8", unidad="UN", stockactual=None),
    ])
    for id_ot in (OT_A, OT_B, OT_C):
        session.add(OrdenTrabajo(
            id=id_ot, id_otvieja=15000 + id_ot, id_prioridad=1, id_sector=1,
            id_articulo=1, id_cliente=1, unidades=3,
            fecha_orden=datetime(2026, 9, 1), fecha_entrada=datetime(2026, 9, 1),
            fecha_prometida=datetime(2026, 10, 1), finalizadototal=0,
        ))
    await session.commit()


def _linea(id, ot, pieza, cantidad=1, **marcas):
    return OrdenTrabajoPieza(id=id, id_orden_trabajo=ot, id_pieza=pieza, cantidad=cantidad,
                             unidad="Mts", **marcas)


# ─────────────────────── stock: físico, reservado, libre ───────────────────────

@pytest.mark.asyncio
async def test_libre_es_fisico_menos_las_reservas_vigentes(session):
    await _mundo(session)
    session.add_all([
        # vigente: cuenta
        _linea(1, OT_A, BARRA, 5, reserva=1, cantidad_reservada=4, usado=1, disponible=0),
        # ya retirada (disponible): el egreso ya bajó el físico, no se cuenta dos veces
        _linea(2, OT_B, BARRA, 3, reserva=1, cantidad_reservada=3, usado=1, disponible=1),
        # no se usa: su reserva no traba nada
        _linea(3, OT_C, BARRA, 2, reserva=1, cantidad_reservada=2, usado=0, disponible=0),
        # sin reserva
        _linea(4, OT_C, BARRA, 9, reserva=0, usado=1, disponible=0),
    ])
    await session.commit()

    s = await stock.stock_de(session, [BARRA, CHAPA, BULON, 999])
    assert s[BARRA] == {"fisico": 12.0, "reservado": 4.0, "libre": 8.0}
    assert s[CHAPA] == {"fisico": 0.0, "reservado": 0.0, "libre": 0.0}
    # Sin stock conocido cuenta como cero; la pieza que no existe no aparece.
    assert s[BULON]["fisico"] == 0.0
    assert 999 not in s


@pytest.mark.asyncio
async def test_la_linea_que_pregunta_no_compite_con_su_propia_reserva(session):
    await _mundo(session)
    session.add(_linea(1, OT_A, BARRA, 5, reserva=1, cantidad_reservada=4, usado=1, disponible=0))
    await session.commit()
    assert (await stock.stock_de(session, [BARRA], excluir_linea=1))[BARRA]["libre"] == 12.0


# ─────────────────────── movimientos ───────────────────────

@pytest.mark.asyncio
async def test_cada_movimiento_recalcula_el_cache(session):
    """El caché de antes (12, que venía del viejo) no es un saldo: después del primer
    movimiento, el físico es la suma de movimientos y nada más."""
    await _mundo(session)
    m1 = await stock.registrar_movimiento(session, BARRA, "ingreso", 6, "compra", MAXI)
    await stock.registrar_movimiento(session, BARRA, "egreso", -2.5, None, MAXI, id_orden_trabajo=OT_A)
    await stock.registrar_movimiento(session, BARRA, "ajuste", 0.1, "conteo", MAXI)
    await session.commit()

    pieza = await session.get(Pieza, BARRA)
    assert pieza.stockactual == pytest.approx(3.6)
    assert (await stock.stock_de(session, [BARRA]))[BARRA]["fisico"] == 3.6

    assert m1.usuario == "Maxi Pérez" and m1.id_usuario == 7 and m1.origen == "spmm"
    assert m1.fecha.tzinfo is None
    assert abs(m1.fecha - ahora_ar()) < timedelta(minutes=1)


@pytest.mark.asyncio
async def test_sin_usuario_no_se_inventa_autor(session):
    await _mundo(session)
    m = await stock.registrar_movimiento(session, BARRA, "ingreso", 1, origen="legacy")
    assert m.usuario is None and m.id_usuario is None and m.origen == "legacy"


@pytest.mark.asyncio
@pytest.mark.parametrize("tipo,cantidad", [
    ("ingreso", -1), ("egreso", 1), ("retiro_ot", 2), ("ajuste", 0), ("ingreso", 0),
    ("regalo", 1), ("ingreso", "mucho"),
])
async def test_un_movimiento_mal_firmado_no_entra(session, tipo, cantidad):
    await _mundo(session)
    with pytest.raises(BusinessException):
        await stock.registrar_movimiento(session, BARRA, tipo, cantidad, usuario=MAXI)
    assert (await session.execute(select(func.count(PiezaMovimiento.id)))).scalar() == 0


@pytest.mark.asyncio
async def test_un_movimiento_de_un_insumo_que_no_existe_es_404(session):
    await _mundo(session)
    with pytest.raises(NotFoundException):
        await stock.registrar_movimiento(session, 999, "ingreso", 1)


@pytest.mark.asyncio
async def test_dejar_el_fisico_negativo_se_avisa_y_con_forzar_entra(session):
    await _mundo(session)
    await stock.registrar_movimiento(session, BARRA, "ingreso", 2)
    with pytest.raises(ConfirmacionRequeridaException) as e:
        await stock.registrar_movimiento(session, BARRA, "egreso", -3, avisar_negativo=True)
    assert "-1" in e.value.message and "ABR203" in e.value.message
    assert (await stock.saldo_de_movimientos(session, BARRA)) == 2.0
    # «Hacerlo igual»: el servicio repite con avisar_negativo=False.
    await stock.registrar_movimiento(session, BARRA, "egreso", -3, avisar_negativo=False)
    assert (await session.get(Pieza, BARRA)).stockactual == -1.0


@pytest.mark.asyncio
async def test_anular_deja_de_sumar_y_queda_a_la_vista(session):
    await _mundo(session)
    m = await stock.registrar_movimiento(session, BARRA, "ingreso", 5)
    await stock.registrar_movimiento(session, BARRA, "ingreso", 1)
    await session.commit()

    anulado = await stock.anular_movimiento(session, m.id, MAXI, "  era de otra barra  ")
    await session.commit()
    assert anulado.anulado == 1 and anulado.anulado_por == "Maxi Pérez"
    assert anulado.motivo_anulacion == "era de otra barra"
    assert anulado.anulado_en.tzinfo is None
    assert (await session.get(Pieza, BARRA)).stockactual == 1.0
    assert (await session.execute(select(func.count(PiezaMovimiento.id)))).scalar() == 2

    with pytest.raises(BusinessException, match="ya está anulado"):
        await stock.anular_movimiento(session, m, MAXI)
    with pytest.raises(NotFoundException):
        await stock.anular_movimiento(session, 999, MAXI)


@pytest.mark.asyncio
async def test_un_retiro_de_ot_no_se_anula_a_mano(session):
    """Lo crea marcar Disponible una línea reservada y se anula desmarcándolo: anularlo
    desde el stock dejaría la línea diciendo que se retiró y el stock diciendo que no."""
    await _mundo(session)
    await stock.registrar_movimiento(session, BARRA, "ingreso", 5)
    retiro = await stock.registrar_movimiento(session, BARRA, "retiro_ot", -4,
                                              "OT N° 15010 – retirado para la orden",
                                              MAXI, id_orden_trabajo=OT_A)
    with pytest.raises(BusinessException, match="15010"):
        await stock.anular_movimiento(session, retiro, MAXI)
    await stock.anular_movimiento(session, retiro, MAXI, "Se desmarcó Disponible", desde_linea=True)
    assert (await session.get(Pieza, BARRA)).stockactual == 5.0


@pytest.mark.asyncio
async def test_nada_de_esto_hace_commit_solo(session):
    """El servicio decide cuándo termina la transacción: si después algo falla y hace
    rollback, el movimiento y el caché se van juntos."""
    await _mundo(session)
    await stock.registrar_movimiento(session, BARRA, "ingreso", 5)
    await session.rollback()
    session.expire_all()
    assert (await session.execute(select(func.count(PiezaMovimiento.id)))).scalar() == 0
    assert (await session.get(Pieza, BARRA)).stockactual == 12.0


@pytest.mark.asyncio
async def test_recortes_y_consumido(session):
    await _mundo(session)
    session.add_all([
        PiezaRecorte(id_pieza=BARRA, largo_mm=2777, cantidad=1),
        PiezaRecorte(id_pieza=BARRA, largo_mm=1525, cantidad=3),
        PiezaRecorte(id_pieza=BARRA, largo_mm=900, cantidad=1, estado="usado"),
        PiezaRecorte(id_pieza=CHAPA, largo_mm=100, cantidad=2, estado="descartado"),
        _linea(1, OT_A, BARRA, 5),
        _linea(2, OT_A, CHAPA, 1),
    ])
    await session.flush()
    for cantidad, anulado in ((1.5, 0), (0.25, 0), (9, 1)):
        session.add(ConsumoMaterial(id_orden_trabajo=OT_A, id_pieza=BARRA, id_orden_trabajo_pieza=1,
                                    cantidad=cantidad, fecha=datetime(2026, 9, 23), anulado=anulado))
    await session.commit()
    assert await stock.recortes_disponibles_de(session, [BARRA, CHAPA]) == {BARRA: 4}
    assert await stock.consumido_de_lineas(session, [1, 2]) == {1: 1.75}


# ─────────────────────── estado del material ───────────────────────

@pytest.mark.asyncio
async def test_la_columna_material_con_las_marcas_de_verdad(session):
    await _mundo(session)
    session.add_all([
        # A: una disponible y otra sin pedir → falta pedir (antes decía «ok» si el sync
        # le inventaba el disponible)
        _linea(1, OT_A, BARRA, disponible=1, pedido=1),
        _linea(2, OT_A, CHAPA, disponible=0, pedido=0),
        # B: una reservada y otra pedida → esperando
        _linea(3, OT_B, BARRA, reserva=1, cantidad_reservada=1, disponible=0),
        _linea(4, OT_B, CHAPA, pedido=1, disponible=0),
        # la que no se usa no cuenta
        _linea(5, OT_B, BULON, usado=0, disponible=0, pedido=0),
    ])
    await session.commit()
    estados = await estado_mod.estados_de_ots(session, [OT_A, OT_B, OT_C, 999])
    assert estados == {OT_A: "sin_stock", OT_B: "pedido", OT_C: "sin_datos", 999: "sin_datos"}

    (await session.get(OrdenTrabajo, OT_A)).no_lleva_materia_prima = 1
    await session.commit()
    # La misma cuenta es la de las listas de OT y el planificador.
    assert (await OrdenTrabajoRepository(session).get_material_status([OT_A, OT_B])) == {
        OT_A: "no_lleva", OT_B: "pedido"}
    assert await OrdenTrabajoRepository(session).get_material_status([]) == {}


@pytest.mark.asyncio
async def test_una_ot_arranco_si_algun_proceso_esta_en_curso_o_termino(session):
    await _mundo(session)
    session.add(Proceso(id=100, nombre="TORNO"))
    session.add_all([EstadoProceso(id=i, descripcion=d)
                     for i, d in ((1, "Pendiente"), (2, "En curso"), (3, "Completado"))])
    session.add_all([
        OrdenTrabajoProceso(id_orden_trabajo=OT_A, id_proceso=100, orden=1, id_estado=2),
        OrdenTrabajoProceso(id_orden_trabajo=OT_B, id_proceso=100, orden=1, id_estado=1,
                            inicio_real=datetime(2026, 9, 22, 8)),
        # El centinela del viejo no es un arranque.
        OrdenTrabajoProceso(id_orden_trabajo=OT_C, id_proceso=100, orden=1, id_estado=1,
                            inicio_real=datetime(1950, 1, 1)),
    ])
    await session.commit()
    assert await estado_mod.ots_en_curso(session, [OT_A, OT_B, OT_C]) == {OT_A, OT_B}


# ─────────────────────── cañera ───────────────────────

def test_los_casilleros_de_la_canera():
    assert canera_mod.parse_celda("E4") == ("E", 4)
    assert canera_mod.parse_celda(" o 9 ") == ("O", 9)
    for malo in ("P1", "A0", "A10", "", None, "44", "EE"):
        with pytest.raises(BusinessException):
            canera_mod.parse_celda(malo)
    assert canera_mod.celda_texto("E", 4) == "E4"


@pytest.mark.asyncio
async def test_la_canera_vigente_y_las_celdas_de_cada_ot(session):
    await _mundo(session)
    (await session.get(OrdenTrabajo, OT_B)).finalizadototal = 1
    session.add_all([
        _linea(1, OT_A, BARRA, disponible=1),
        CaneraOcupacion(columna="E", fila=4, id_orden_trabajo=OT_A, desde=datetime(2026, 9, 20, 9),
                        asignado_por="Maxi Pérez"),
        CaneraOcupacion(columna="A", fila=1, id_orden_trabajo=OT_A, desde=datetime(2026, 9, 20, 9)),
        CaneraOcupacion(columna="B", fila=2, id_orden_trabajo=OT_B, desde=datetime(2026, 9, 20, 9)),
        CaneraOcupacion(columna="J", fila=1, ot_texto="158010", desde=datetime(2026, 9, 1), origen="legacy"),
        # Liberada: ya no está.
        CaneraOcupacion(columna="C", fila=3, id_orden_trabajo=OT_C, desde=datetime(2026, 9, 1),
                        hasta=datetime(2026, 9, 2)),
    ])
    await session.commit()

    assert await canera_mod.celdas_de_ots(session, [OT_A, OT_B, OT_C]) == {
        OT_A: ["A1", "E4"], OT_B: ["B2"]}

    grilla = await canera_mod.canera_vigente(session)
    assert grilla["columnas"] == list("ABCDEFGHIJKLMNO") and grilla["filas"] == list(range(1, 10))
    por_celda = {o["celda"]: o for o in grilla["ocupaciones"]}
    assert set(por_celda) == {"A1", "B2", "E4", "J1"}
    e4 = por_celda["E4"]
    assert (e4["numero_ot"], e4["cliente"], e4["articulo"], e4["estado_material"],
            e4["finalizada"], e4["asignado_por"]) == (15010, "ACME SRL", "Bandeja de acero",
                                                      "ok", False, "Maxi Pérez")
    assert por_celda["B2"]["finalizada"] is True
    j1 = por_celda["J1"]
    assert (j1["numero_ot"], j1["ot_texto"], j1["estado_material"], j1["finalizada"]) == (
        None, "158010", None, False)


@pytest.mark.asyncio
async def test_un_casillero_no_puede_tener_dos_ot_vigentes(session):
    """El índice único parcial también está en SQLite: el servicio da el 409 claro, pero
    la base no deja pasar el error si alguien se lo saltea."""
    from sqlalchemy.exc import IntegrityError
    await _mundo(session)
    session.add(CaneraOcupacion(columna="E", fila=4, id_orden_trabajo=OT_A, desde=datetime(2026, 9, 20)))
    await session.commit()
    session.add(CaneraOcupacion(columna="E", fila=4, ot_texto="999", desde=datetime(2026, 9, 21)))
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()
    # Liberada la primera, el casillero se puede volver a usar.
    primera = (await session.execute(select(CaneraOcupacion))).scalar_one()
    primera.hasta = datetime(2026, 9, 21)
    session.add(CaneraOcupacion(columna="E", fila=4, ot_texto="999", desde=datetime(2026, 9, 21)))
    await session.commit()


# ─────────────────────── borrar una OT con materiales ───────────────────────

@pytest.mark.asyncio
async def test_borrar_una_ot_con_materiales_no_tira_500(session):
    """Antes la FK de orden_trabajo_pieza frenaba el borrado (1.298 OT con líneas). Ahora
    se van sus líneas, cortes y consumos; la cañera se libera y conserva el número; los
    movimientos de stock quedan (el material ya salió)."""
    await _mundo(session)
    session.add_all([
        _linea(1, OT_A, BARRA, 5, reserva=1, cantidad_reservada=4, disponible=1),
        _linea(2, OT_B, BARRA, 1),
    ])
    await session.flush()
    session.add_all([
        OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=1, cantidad=3, largo_mm=1093),
        OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=2, cantidad=1, largo_mm=500),
        ConsumoMaterial(id_orden_trabajo=OT_A, id_pieza=BARRA, id_orden_trabajo_pieza=1,
                        cantidad=1, fecha=datetime(2026, 9, 23)),
        CaneraOcupacion(columna="E", fila=4, id_orden_trabajo=OT_A, desde=datetime(2026, 9, 20)),
        CaneraOcupacion(columna="D", fila=1, id_orden_trabajo=OT_A, desde=datetime(2026, 9, 1),
                        hasta=datetime(2026, 9, 5), liberado_por="Lucas"),
    ])
    await stock.registrar_movimiento(session, BARRA, "retiro_ot", -4, "OT N° 15010", MAXI,
                                     id_orden_trabajo=OT_A, id_orden_trabajo_pieza=1)
    await session.commit()

    assert await OrdenTrabajoRepository(session).delete(OT_A, usuario=MAXI) is True
    session.expire_all()

    assert await session.get(OrdenTrabajo, OT_A) is None
    lineas = (await session.execute(select(OrdenTrabajoPieza.id))).scalars().all()
    assert lineas == [2]  # la de la otra OT sigue
    cortes = (await session.execute(select(OrdenTrabajoPiezaCorte.id_orden_trabajo_pieza))).scalars().all()
    assert cortes == [2]
    assert (await session.execute(select(func.count(ConsumoMaterial.id)))).scalar() == 0

    ocupaciones = {o.celda: o for o in (await session.execute(select(CaneraOcupacion))).scalars()}
    e4, d1 = ocupaciones["E4"], ocupaciones["D1"]
    assert e4.id_orden_trabajo is None and e4.ot_texto == "15010"
    assert e4.hasta is not None and e4.liberado_por == "Maxi Pérez"
    # La que ya estaba liberada conserva cuándo y quién.
    assert d1.hasta == datetime(2026, 9, 5) and d1.liberado_por == "Lucas" and d1.ot_texto == "15010"

    movimientos = (await session.execute(select(PiezaMovimiento))).scalars().all()
    assert len(movimientos) == 1 and movimientos[0].id_orden_trabajo == OT_A
    assert (await session.get(Pieza, BARRA)).stockactual == -4.0


@pytest.mark.asyncio
async def test_borrar_una_ot_que_no_existe_sigue_siendo_false(session):
    await _mundo(session)
    assert await OrdenTrabajoRepository(session).delete(999) is False


# ─────────────────────── el alta de OT guarda «No lleva» ───────────────────────

@pytest.mark.asyncio
async def test_el_alta_de_ot_guarda_no_lleva_materia_prima(session):
    """El modal lo manda desde siempre en el alta y se perdía: el DTO no lo tenía."""
    import json
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    await _mundo(session)
    datos = {
        "id_otvieja": 16000, "id_prioridad": 1, "id_sector": 1, "id_articulo": 1,
        "fecha_orden": "2026-09-23T00:00:00", "fecha_entrada": "2026-09-23T00:00:00",
        "fecha_prometida": "2026-10-23T00:00:00", "no_lleva_materia_prima": True,
    }
    r = await OrdenTrabajoService(session).crearOrdenTrabajo(json.dumps(datos))
    assert r.data["no_lleva_materia_prima"] == 1
    datos.update(id_otvieja=16001, no_lleva_materia_prima=False)
    r = await OrdenTrabajoService(session).crearOrdenTrabajo(json.dumps(datos))
    assert r.data["no_lleva_materia_prima"] == 0


# ─────────────────────── semilla ───────────────────────

@pytest.mark.asyncio
async def test_la_semilla_de_formatos_es_idempotente(session):
    ids = await sembrar_formatos(session)
    await session.commit()
    assert set(ids) == {n for n, _, _ in FORMATOS_SEMILLA}
    otra = await sembrar_formatos(session)
    await session.commit()
    assert otra == ids
    placa = (await session.execute(select(Formato).where(Formato.nombre == "PLACA"))).scalar_one()
    assert placa.etiquetas == ["Espesor", "Ancho", "Largo"] and placa.iniciales == "P"


# ─────────────────────── las rutas que ya existen ───────────────────────

def _app(session):
    app = FastAPI()
    registrar_exception_handlers(app)
    for modulo in (MateriaPrimaCatalogoAPI, MateriaPrimaOTAPI, MateriaPrimaPendientesAPI):
        app.include_router(modulo.router)

        async def _db():
            yield session
        app.dependency_overrides[modulo.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: MAXI
    return app


@pytest.mark.asyncio
async def test_get_catalogos(session):
    await _mundo(session)
    await sembrar_formatos(session)
    session.add(Material(id=1, nombre="ACERO", letra_codigo=None))
    session.add(Material(id=2, nombre="VIEJO", activo=0))
    await session.flush()
    session.add_all([MaterialCalidad(id_material=1, nombre="SAE 1045"),
                     MaterialCalidad(id_material=1, nombre="SAE 1010")])
    await session.commit()
    async with AsyncClient(transport=ASGITransport(app=_app(session)), base_url="http://t") as c:
        r = await c.get("/materia-prima/catalogos")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["materiales"] == [{"id": 1, "nombre": "ACERO", "letra_codigo": None,
                                   "calidades": [{"id": 2, "nombre": "SAE 1010"},
                                                 {"id": 1, "nombre": "SAE 1045"}]}]
    assert [f["nombre"] for f in data["formatos"]] == [n for n, _, _ in FORMATOS_SEMILLA]
    assert data["formatos"][0] == {"id": data["formatos"][0]["id"], "nombre": "BARRA REDONDO",
                                   "iniciales": "BR", "etiquetas": ["Ø"]}
    assert data["unidades_linea"] == ["Un", "Mts", "Kg", "Lts"]
    assert data["espesor_sierra_mm"] == 3
    assert data["tipos"][1] == {"valor": "insumo_desc", "nombre": "Insumo c/ descripción"}


@pytest.mark.asyncio
async def test_put_no_lleva(session):
    await _mundo(session)
    async with AsyncClient(transport=ASGITransport(app=_app(session)), base_url="http://t") as c:
        r = await c.put(f"/materia-prima/ot/{OT_A}/no-lleva", json={"no_lleva": True})
        assert r.status_code == 200 and r.json()["data"] == {"no_lleva_materia_prima": True}
        ot = await session.get(OrdenTrabajo, OT_A)
        assert ot.no_lleva_materia_prima == 1 and ot.modificado_por == "Maxi Pérez"
        r = await c.put(f"/materia-prima/ot/{OT_A}/no-lleva", json={"no_lleva": False})
        assert r.json()["data"] == {"no_lleva_materia_prima": False}
        r = await c.put("/materia-prima/ot/999/no-lleva", json={"no_lleva": True})
        assert r.status_code == 404
        r = await c.put(f"/materia-prima/ot/{OT_A}/no-lleva", json={})
        assert r.status_code == 400


@pytest.mark.asyncio
async def test_get_canera(session):
    await _mundo(session)
    session.add(CaneraOcupacion(columna="E", fila=4, id_orden_trabajo=OT_A,
                                desde=datetime(2026, 9, 20, 9, 30)))
    await session.commit()
    async with AsyncClient(transport=ASGITransport(app=_app(session)), base_url="http://t") as c:
        r = await c.get("/materia-prima/canera")
    assert r.status_code == 200
    (o,) = r.json()["data"]["ocupaciones"]
    assert o["celda"] == "E4" and o["numero_ot"] == 15010 and o["estado_material"] == "sin_datos"
    assert o["desde"] == "2026-09-20T09:30:00"  # sin zona


# ─────────────────────── la migración ───────────────────────

MIGRACION = dict(migraciones.MIGRACIONES)["2026-09-23_materia_prima"]


def test_la_migracion_no_toca_filas():
    """Sólo DDL y la semilla de un catálogo nuevo: nada de UPDATE/DELETE/DROP."""
    for s in MIGRACION:
        bajo = " ".join(s.lower().split())
        for prohibido in ("update ", "delete from", "drop ", "truncate", "alter column"):
            assert prohibido not in bajo.replace("on delete cascade", ""), (prohibido, s[:80])
        if bajo.startswith("insert"):
            assert bajo.startswith("insert into formato ") and bajo.endswith(
                "on conflict (nombre) do nothing"), s[:80]


@pytest.mark.parametrize("modelo,tabla", [(Pieza, "pieza"), (OrdenTrabajoPieza, "orden_trabajo_pieza")])
def test_el_orm_y_la_migracion_agregan_las_mismas_columnas(modelo, tabla):
    """Una columna del modelo que la migración no agrega rompe TODA lectura de esa tabla
    en producción (SQLAlchemy la pide en cada SELECT). Y al revés, una que la migración
    agrega y el modelo no, es un dato que nadie lee."""
    import re
    (alter,) = [s for s in MIGRACION if s.lower().startswith(f"alter table {tabla} ")]
    agregadas = set(re.findall(r"(?i)add column if not exists (\w+)", alter))
    nuevas_del_modelo = {c.name for c in modelo.__table__.columns} - COLUMNAS_DE_ANTES[tabla]
    assert agregadas == nuevas_del_modelo


COLUMNAS_DE_ANTES = {
    "pieza": {"id", "cod_pieza", "descripcion", "unitario", "unidad", "stockactual",
              "observaciones", "proveedor", "material", "formato", "estante", "letra", "nro",
              "id_otvieja", "stock_minimo", "stock_bajo_avisado_en"},
    "orden_trabajo_pieza": {"id", "id_orden_trabajo", "id_pieza", "cantidad", "unidad",
                            "pedido", "disponible", "cantusada"},
}
