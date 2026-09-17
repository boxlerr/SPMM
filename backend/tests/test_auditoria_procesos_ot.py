"""Quién agregó, cambió o sacó cada paso de cada OT.

Pedido de Julián (17/09): «auditoría de quién agregue, elimine o modifique cada proceso
en cada OT, siempre, en cualquier pantalla, con su usuario, hora y día bien completo,
por si hay dudas de que se duplican cosas y si lo agregó un usuario».

Lo que se fija acá es sobre todo lo que NO se puede romper sin que nadie se entere:

  - que el registro se escriba solo, enganchado al ORM, y no dependa de que cada
    endpoint se acuerde de llamarlo — son catorce los caminos que escriben procesos;
  - que un guardado que no cambió nada no deje ningún renglón. El guardado completo le
    reasigna el paso a TODAS las filas, así que sin comparar antes contra después cada
    guardado dejaría una fila por proceso diciendo «paso 3 → 3» y el registro sería
    ilegible justo el día que se necesita;
  - que dos pasadas del mismo proceso queden como dos renglones distintos, que es la
    pregunta que motivó todo esto;
  - que sin usuario no se invente un autor.
"""
import json
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import select

from backend.domain.Articulo import Articulo
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.infrastructure import auditoria_procesos as auditoria_proc


JULIAN = {"id_usuario": 3, "nombre": "Julián", "apellido": "Boxler", "username": "jboxler"}


@pytest_asyncio.fixture
async def taller(session):
    """La OT 1081, vacía, y dos procesos en el catálogo.

    Prioridad, sector y artículo son obligatorios en el modelo de la OT.
    """
    prioridad = Prioridad(descripcion="NORMAL")
    sector = Sector(nombre="SIN SECTOR")
    articulo = Articulo(cod_articulo="NO-DEF", descripcion="Sin definir", abreviatura="ND")
    session.add_all([
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=3, descripcion="Terminado"),
        Proceso(id=150, nombre="TORNO CNC"),
        Proceso(id=160, nombre="SOLDADURA"),
        Proceso(id=170, nombre="FRESADO"),
        prioridad, sector, articulo,
    ])
    await session.commit()

    hoy = datetime(2026, 9, 17)
    session.add(OrdenTrabajo(
        id=1081, id_prioridad=prioridad.id, id_sector=sector.id, id_articulo=articulo.id,
        ttt1=0, fc=0, fecha_orden=hoy, fecha_entrada=hoy, fecha_prometida=hoy,
    ))
    await session.commit()
    return session


async def _registros(session, **filtros):
    q = select(AuditoriaProcesoOT).order_by(AuditoriaProcesoOT.id)
    for campo, valor in filtros.items():
        q = q.where(getattr(AuditoriaProcesoOT, campo) == valor)
    return (await session.execute(q)).scalars().all()


@pytest.fixture
def como_julian():
    """Lo que deja el middleware en la llamada: quién y desde dónde."""
    token = auditoria_proc.poner_contexto(
        usuario=JULIAN, metodo="PUT", ruta="/ordenes/1081", parametros={},
    )
    yield
    auditoria_proc.limpiar_contexto(token)


async def test_agregar_un_paso_queda_registrado_con_usuario_y_momento(taller, como_julian):
    taller.add(OrdenTrabajoProceso(
        id_orden_trabajo=1081, id_proceso=150, orden=1, tiempo_proceso=45, id_estado=1,
    ))
    await taller.commit()

    filas = await _registros(taller)
    assert len(filas) == 1
    fila = filas[0]
    assert fila.accion == "alta"
    assert fila.id_orden_trabajo == 1081
    assert fila.usuario == "Julián Boxler"
    assert fila.id_usuario == 3
    assert fila.origen == "Guardado de la orden"
    # El nombre se copia al momento del cambio: el catálogo se puede borrar después.
    assert fila.nombre_proceso == "TORNO CNC"
    # Con segundos, y con el id de la pasada ya asignado: sin eso no se puede seguir
    # el rastro de ESA línea, que es de lo que se trata todo esto.
    assert fila.creado_en is not None and fila.creado_en.second is not None
    assert fila.id_otp is not None
    assert "agregó el paso 1" in fila.descripcion and "TORNO CNC" in fila.descripcion


async def test_cambiar_los_minutos_guarda_el_antes_y_el_despues(taller, como_julian):
    paso = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                               tiempo_proceso=45, id_estado=1)
    taller.add(paso)
    await taller.commit()

    paso.tiempo_proceso = 90
    await taller.commit()

    fila = (await _registros(taller, accion="edicion"))[0]
    cambios = json.loads(fila.cambios)
    assert cambios == [{"campo": "minutos", "antes": "45", "despues": "90"}]
    assert fila.id_otp == paso.id
    assert "45 → 90" in fila.descripcion


async def test_el_estado_se_guarda_en_castellano_y_no_como_numero(taller, como_julian):
    paso = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                               tiempo_proceso=45, id_estado=1)
    taller.add(paso)
    await taller.commit()

    paso.id_estado = 3
    await taller.commit()

    cambios = json.loads((await _registros(taller, accion="edicion"))[0].cambios)
    # «id_estado: 1 → 3» no le contesta nada a nadie.
    assert cambios == [{"campo": "estado", "antes": "Pendiente", "despues": "Terminado"}]


async def test_sacar_un_paso_queda_registrado(taller, como_julian):
    paso = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                               tiempo_proceso=45, id_estado=1)
    taller.add(paso)
    await taller.commit()
    id_pasada = paso.id

    await taller.delete(paso)
    await taller.commit()

    fila = (await _registros(taller, accion="baja"))[0]
    # El id sobrevive a la fila borrada: es con lo que se sigue el rastro hacia atrás.
    assert fila.id_otp == id_pasada
    assert fila.nombre_proceso == "TORNO CNC"
    assert "sacó el paso 1" in fila.descripcion


async def test_guardar_sin_cambiar_nada_no_deja_ningun_renglon(taller, como_julian):
    """El guardado completo reasigna el paso de TODAS las filas.

    SQLAlchemy las marca como tocadas aunque el número sea el mismo, así que sin
    comparar antes contra después cada guardado dejaría una fila por proceso diciendo
    «paso 1 → 1». El registro que se llena de ruido no se lee, y este se escribió para
    leerlo el día que algo no cierra.
    """
    paso = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                               tiempo_proceso=45, id_estado=1)
    taller.add(paso)
    await taller.commit()
    cuantas = len(await _registros(taller))

    paso.orden = 1            # el mismo valor que ya tenía
    paso.tiempo_proceso = 45
    await taller.commit()

    assert len(await _registros(taller)) == cuantas


async def test_dos_pasadas_del_mismo_proceso_son_dos_renglones(taller, como_julian):
    """«Este proceso está dos veces: ¿quién lo puso?» — la pregunta que motivó esto."""
    primera = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                                  tiempo_proceso=45, id_estado=1)
    taller.add(primera)
    await taller.commit()

    segunda = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=2,
                                  tiempo_proceso=30, id_estado=1)
    taller.add(segunda)
    await taller.commit()

    altas = await _registros(taller, accion="alta")
    assert len(altas) == 2
    # Cada pasada tiene su propio renglón y su propio id: se puede decir cuál de las
    # dos se agregó después, y quién.
    assert altas[0].id_otp != altas[1].id_otp
    assert altas[0].creado_en <= altas[1].creado_en
    assert {a.paso for a in altas} == {1, 2}


async def test_sin_usuario_no_se_inventa_un_autor(taller):
    """Un script que corre contra la base no tiene usuario, y eso hay que poder verlo.

    Es justamente la diferencia que se pregunta: si un paso lo agregó alguien o si
    vino de una migración.
    """
    taller.add(OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=160, orden=1,
                                   tiempo_proceso=10, id_estado=1))
    await taller.commit()

    fila = (await _registros(taller))[0]
    assert fila.usuario is None
    assert fila.id_usuario is None
    assert fila.origen == "Sistema"


async def test_el_origen_dice_la_accion_y_no_inventa_una_pantalla(taller):
    """Un paso que alguien sacó de la orden y uno que se fue de arrastre al borrar el
    proceso del catálogo se ven igual en la OT, y son dos problemas distintos.

    Pero el origen nombra LA ACCIÓN, no la pantalla: marcar un paso como terminado sale
    con la misma llamada desde Operaciones que desde la ficha de la persona en Recursos,
    así que decir «Ficha de la orden» mandaría a buscar al lugar equivocado. Sólo se
    nombra la pantalla cuando la llamada la identifica sin ambigüedad.
    """
    assert auditoria_proc.origen_de("/ordenes/1081", {"motivo": "planificacion"}) == "Planificador"
    assert auditoria_proc.origen_de("/ordenes/1081/procesos/restaurar/5", {}) == "Deshacer"
    assert auditoria_proc.origen_de("/procesos/12", {}) == "Al tocar el catálogo de procesos"
    assert auditoria_proc.origen_de("/ordenes/estado-masivo", {}) == "Varias OT a la vez"
    assert auditoria_proc.origen_de("/ordenes/1081", {}) == "Guardado de la orden"
    assert auditoria_proc.origen_de("", None) == "Sistema"

    # Las cuatro rutas que comparten pantalla: ninguna puede decir de dónde vino.
    assert auditoria_proc.origen_de("/ordenes/1081/procesos", {}) == "Alta de un paso"
    assert auditoria_proc.origen_de("/ordenes/1081/procesos/linea/55", {}) == "Edición de un paso"
    assert auditoria_proc.origen_de("/ordenes/1081/procesos/7/estado", {}) == "Cambio de estado"
    assert auditoria_proc.origen_de("/ordenes/1081/procesos/reorder", {}) == "Reordenar los pasos"


async def test_el_guardado_completo_de_la_ot_deja_el_alta_la_baja_y_el_cambio(taller, como_julian):
    """El camino más usado de todos: guardar la OT desde el modal o desde el plan.

    Manda la lista ENTERA de pasos, así que el backend compara contra lo que había:
    conserva lo que sigue, crea lo que llegó y borra lo que no vino. Es también el
    camino que más fácil ensucia el registro, porque de paso le reasigna el número de
    paso a todas las filas.
    """
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    torno = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                                tiempo_proceso=45, id_estado=1)
    soldadura = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=160, orden=2,
                                    tiempo_proceso=60, id_estado=1)
    taller.add_all([torno, soldadura])
    await taller.commit()
    id_torno, id_soldadura = torno.id, soldadura.id
    ya_estaban = len(await _registros(taller))

    # Se conserva el torno con otros minutos, se saca la soldadura y entra un fresado.
    repo = OrdenTrabajoRepository(taller)
    await repo.update_processes_full(1081, [
        {"proceso_id": 150, "id_otp": id_torno, "tiempo_proceso": 90},
        {"proceso_id": 170, "tiempo_proceso": 30},
    ], motivo="edicion", usuario=JULIAN)

    nuevos = (await _registros(taller))[ya_estaban:]
    por_accion = {f.accion: f for f in nuevos}

    # Exactamente tres cosas pasaron, y ninguna más: el paso que no cambió no deja rastro.
    assert sorted(f.accion for f in nuevos) == ["alta", "baja", "edicion"]
    assert por_accion["edicion"].id_otp == id_torno
    assert json.loads(por_accion["edicion"].cambios) == [
        {"campo": "minutos", "antes": "45", "despues": "90"}
    ]
    assert por_accion["baja"].id_otp == id_soldadura
    assert por_accion["baja"].nombre_proceso == "SOLDADURA"
    assert por_accion["alta"].id_otp not in (id_torno, id_soldadura)
    assert por_accion["alta"].nombre_proceso == "FRESADO"
    assert all(f.usuario == "Julián Boxler" for f in nuevos)


async def test_reenviar_un_paso_sin_su_id_reusa_la_fila_y_no_la_duplica(taller, como_julian):
    """Contra-intuitivo y conviene tenerlo escrito: un paso que llega SIN `id_otp` no
    es necesariamente uno nuevo.

    El guardado completo lo aparea con una pasada existente del mismo proceso (la
    primera libre, por orden de paso), así que el registro dice «cambió», no «agregó y
    sacó». Importa para leer el historial: si esto se rompiera, cada guardado hecho
    desde una pantalla que no manda el id —«Traer historial» arma las filas así—
    aparecería como que alguien borró todos los pasos y los cargó de nuevo.
    """
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    soldadura = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=160, orden=1,
                                    tiempo_proceso=60, id_estado=1)
    taller.add(soldadura)
    await taller.commit()
    id_original = soldadura.id
    ya_estaban = len(await _registros(taller))

    await OrdenTrabajoRepository(taller).update_processes_full(
        1081, [{"proceso_id": 160, "tiempo_proceso": 30}], usuario=JULIAN,
    )

    nuevos = (await _registros(taller))[ya_estaban:]
    assert [f.accion for f in nuevos] == ["edicion"]
    assert nuevos[0].id_otp == id_original


async def test_el_usuario_del_token_llega_hasta_la_fila(taller):
    """EL riesgo del diseño, y por eso este test existe.

    El autor no viaja por parámetro: lo deja el middleware en un ContextVar y lo lee
    el ORM tres capas más abajo. Pero el endpoint corre en una tarea HIJA del
    middleware (así funciona BaseHTTPMiddleware), y una tarea hija copia el contexto
    en el momento en que se crea. Si algún día ese seteo se mueve después del
    `call_next`, el contexto deja de copiarse y TODAS las filas pasan a decir
    «Sistema» sin que se rompa nada — el peor modo de falla posible: silencioso y
    justo en el dato que se vino a guardar.

    Se monta el middleware DE VERDAD, el de main.py, no una copia.
    """
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from starlette.middleware.base import BaseHTTPMiddleware

    from backend.core.security import create_access_token
    from backend.presentation import main

    app = FastAPI()
    app.add_middleware(BaseHTTPMiddleware, dispatch=main.auditar_movimientos)

    @app.post("/ordenes/{id_orden}/procesos")
    async def agregar(id_orden: int):
        taller.add(OrdenTrabajoProceso(
            id_orden_trabajo=id_orden, id_proceso=150, orden=1,
            tiempo_proceso=45, id_estado=1,
        ))
        await taller.commit()
        return {"ok": True}

    token = create_access_token({
        "sub": "jboxler", "id_usuario": 3, "rol": "admin",
        "nombre": "Julián", "apellido": "Boxler",
    })
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/ordenes/1081/procesos",
                         headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200

    fila = (await _registros(taller))[0]
    assert fila.usuario == "Julián Boxler", (
        "el usuario no llegó del middleware al ORM: el registro queda sin autor"
    )
    assert fila.id_usuario == 3
    assert fila.ruta == "/ordenes/1081/procesos"
    assert fila.metodo == "POST"


async def test_borrar_la_orden_entera_deja_escrito_que_pasos_se_llevo(taller, como_julian):
    """La pregunta del día después: «¿y los procesos que había cargado?».

    Este camino se reescribió de un DELETE masivo a un borrado por ORM justamente para
    que quedara registrado, así que si alguien lo vuelve a SQL crudo esto lo avisa.
    """
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    taller.add_all([
        OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                            tiempo_proceso=45, id_estado=1),
        OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=160, orden=2,
                            tiempo_proceso=60, id_estado=1),
    ])
    await taller.commit()
    ya_estaban = len(await _registros(taller))

    assert await OrdenTrabajoRepository(taller).delete(1081) is True

    bajas = (await _registros(taller))[ya_estaban:]
    assert [b.accion for b in bajas] == ["baja", "baja"]
    assert {b.nombre_proceso for b in bajas} == {"TORNO CNC", "SOLDADURA"}
    assert all(b.usuario == "Julián Boxler" for b in bajas)


async def test_borrar_un_proceso_del_catalogo_deja_el_nombre_de_lo_que_se_llevo(taller, como_julian):
    """Se lo lleva de TODAS las OT donde estaba, y después el proceso ya no existe.

    Por eso el renglón se escribe antes del borrado y con el nombre copiado: si se
    guardara sólo el id, el día que alguien pregunta por qué a esa orden le falta un
    paso no habría forma de decir cuál era.
    """
    from backend.application.ProcesoService import ProcesoService

    taller.add(OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=170, orden=1,
                                   tiempo_proceso=20, id_estado=1))
    await taller.commit()
    ya_estaban = len(await _registros(taller))

    await ProcesoService(taller).eliminarProceso(170, forzar=True)

    bajas = (await _registros(taller))[ya_estaban:]
    assert [b.accion for b in bajas] == ["baja"]
    assert bajas[0].nombre_proceso == "FRESADO"
    assert bajas[0].origen == "Al borrar el proceso del catálogo"
    # Y el proceso efectivamente se borró: la auditoría no le impidió al usuario borrar.
    assert await taller.get(Proceso, 170) is None


async def test_el_endpoint_devuelve_el_historial_de_una_orden(taller, como_julian):
    """Lo que consume la solapa Historial de la OT y la pantalla de Auditoría."""
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from backend.core.security import get_current_user
    from backend.presentation import AuditoriaAPI

    paso = OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                               tiempo_proceso=45, id_estado=1)
    taller.add(paso)
    await taller.commit()
    paso.tiempo_proceso = 90
    await taller.commit()

    app = FastAPI()
    app.include_router(AuditoriaAPI.router)
    app.dependency_overrides[AuditoriaAPI.get_db] = lambda: taller
    app.dependency_overrides[get_current_user] = lambda: {"id_usuario": 3}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/auditoria/procesos?id_orden=1081")
        de_otra = await c.get("/auditoria/procesos?id_orden=9999")

    assert r.status_code == 200
    datos = r.json()
    assert [c["accion"] for c in datos["cambios"]] == ["edicion", "alta"]  # lo último primero
    # El JSON llega desarmado, listo para pintar el antes → después.
    assert datos["cambios"][0]["cambios"] == [
        {"campo": "minutos", "antes": "45", "despues": "90"}
    ]
    assert datos["cambios"][0]["usuario"] == "Julián Boxler"
    # Desde cuándo hay registro: sin esto la pantalla no puede decir que lo anterior
    # no está porque nunca se guardó.
    assert datos["desde"] is not None
    # Y el historial es de ESA orden, no de todas.
    assert de_otra.json()["cambios"] == []


async def test_la_auditoria_no_puede_voltear_un_guardado(taller, como_julian, monkeypatch):
    """Si el registro falla, la OT se guarda igual.

    La regla de toda la auditoría del sistema: es peor no poder guardar una orden que
    quedarse sin el renglón. Por eso el INSERT va en un SAVEPOINT propio.
    """
    def _explota(*_, **__):
        raise RuntimeError("la tabla no está en esta base")

    monkeypatch.setattr(auditoria_proc, "_armar_filas", _explota)

    taller.add(OrdenTrabajoProceso(id_orden_trabajo=1081, id_proceso=150, orden=1,
                                   tiempo_proceso=45, id_estado=1))
    await taller.commit()

    guardados = (await taller.execute(
        select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id_orden_trabajo == 1081)
    )).scalars().all()
    assert len(guardados) == 1
