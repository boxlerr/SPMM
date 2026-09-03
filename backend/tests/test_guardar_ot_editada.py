"""
Tests de "guardar una OT editada" (reporte de Camilo del 3-sep-2026: apretaba el botón
del modal y sólo salía «Error al actualizar la Orden de Trabajo», no guardaba nada).

La causa: el modal manda en el PUT la clave `cliente` con el NOMBRE del cliente, porque
es lo que muestra en pantalla. En `OrdenTrabajo` ese nombre lo ocupa la RELACIÓN al
objeto Cliente (el vínculo de verdad es `id_cliente`), y el repositorio hacía un setattr
ciego de todo lo que le llegaba. Asignarle un string a la relación mataba el flush con
"'str' object has no attribute '_sa_instance_state'" → rollback → no se guardaba NADA de
la orden, ni la cabecera ni los procesos.

Se fija acá:
  - el payload REAL del modal (con `cliente`) guarda;
  - el repositorio no escribe nada que no sea columna de la tabla;
  - y `id_otvieja` vacío no le pisa el número visible a la OT — el 0 del modal significa
    "generalo vos" sólo en el alta, y en el update no hay nada que lo genere.

Imports adentro de cada test para que una dependencia pesada no rompa la colección.
"""
from datetime import datetime

import pytest

from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector

OT_ID = 1
OT_NUMERO = 15802  # la del video del reporte


async def _seed_ot(session):
    """Una OT con un proceso, lista para editar."""
    session.add_all([
        Cliente(id=1, nombre="INDUSTRIAS CERAMICAS LOURDES S.A."),
        Cliente(id=2, nombre="BOLSAPEL SAICIFYA"),
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="CL00C107", descripcion="Cremallera", abreviatura="CRE"),
        Proceso(id=100, nombre="TRABAJO TERCERIZADO CORTE LASER"),
        Proceso(id=101, nombre="CONTROL DE MEDIDAS"),
        EstadoProceso(id=1, descripcion="Nuevo"),
    ])
    await session.commit()

    session.add(OrdenTrabajo(
        id=OT_ID, id_otvieja=OT_NUMERO, id_prioridad=1, id_sector=1, id_articulo=1,
        id_cliente=1, unidades=1, detalle="detalle original",
        fecha_orden=datetime(2026, 8, 31), fecha_entrada=datetime(2026, 8, 30),
        fecha_prometida=datetime(2026, 9, 20),
    ))
    await session.commit()

    session.add(OrdenTrabajoProceso(
        id_orden_trabajo=OT_ID, id_proceso=100, orden=1, id_estado=1,
        tiempo_proceso=10, cant_operarios=1,
    ))
    await session.commit()


def _payload_del_modal(**cambios):
    """
    Lo que arma performSubmission en CreateWorkOrderModal.tsx al editar. Se copia con
    `cliente` incluido a propósito: es la clave que rompía el guardado.
    """
    payload = {
        "id_otvieja": OT_NUMERO,
        "observaciones": "obs",
        "detalle": "detalle nuevo",
        "id_cliente": 1,
        "cliente": "INDUSTRIAS CERAMICAS LOURDES S.A.",
        "unidades": 1,
        "id_prioridad": 1,
        "id_sector": 1,
        "id_articulo": 1,
        "fecha_orden": "2026-08-31T00:00:00",
        "fecha_entrada": "2026-08-30T00:00:00",
        "fecha_prometida": "2026-09-25T00:00:00",
        "fecha_entrega": None,
        "cantidad_entregada": 0,
        "reclamo": 0,
        "finalizadototal": 0,
        "finalizadoparcial": 0,
        "procesos": [{
            "proceso_id": 100, "id_otp": 1, "tiempo_proceso": 15,
            "cant_operarios": 1, "maquinaria_id": None, "operario_id": None,
        }],
    }
    payload.update(cambios)
    return payload


async def _guardar(session, **cambios):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.dto.OrdenTrabajoUpdateDTO import OrdenTrabajoUpdateDTO

    dto = OrdenTrabajoUpdateDTO(**_payload_del_modal(**cambios))
    return await OrdenTrabajoService(session).modificarOrden(OT_ID, dto)


@pytest.mark.asyncio
async def test_guardar_ot_editada_con_nombre_de_cliente(session):
    await _seed_ot(session)

    # Antes esto tiraba InfrastructureException("Error al actualizar la Orden de Trabajo.")
    resp = await _guardar(session, detalle="detalle nuevo", fecha_prometida="2026-09-25T00:00:00")
    assert resp.status is True

    session.expire_all()
    orden = await session.get(OrdenTrabajo, OT_ID)
    assert orden.detalle == "detalle nuevo"
    assert orden.fecha_prometida == datetime(2026, 9, 25)
    # El nombre que vino de pantalla no se guardó en ningún lado, y el vínculo real quedó.
    assert orden.id_cliente == 1


@pytest.mark.asyncio
async def test_el_nombre_de_cliente_no_pisa_la_relacion(session):
    """
    Mandar un nombre que no es el del cliente vinculado no cambia el vínculo: `cliente`
    es de pantalla, manda `id_cliente`.
    """
    await _seed_ot(session)

    resp = await _guardar(session, id_cliente=2, cliente="NOMBRE QUE NO EXISTE SRL")
    assert resp.status is True

    session.expire_all()
    orden = await session.get(OrdenTrabajo, OT_ID)
    assert orden.id_cliente == 2


@pytest.mark.asyncio
async def test_tambien_guarda_los_procesos(session):
    """
    El update de la cabecera y el de los procesos son dos pasos: si el primero explota,
    el segundo no corre. Con la cabecera arreglada, los minutos editados llegan.
    """
    await _seed_ot(session)

    resp = await _guardar(session, procesos=[{
        "proceso_id": 100, "id_otp": 1, "tiempo_proceso": 45,
        "cant_operarios": 2, "maquinaria_id": None, "operario_id": None,
    }])
    assert resp.status is True

    session.expire_all()
    proc = await session.get(OrdenTrabajoProceso, 1)
    assert proc.tiempo_proceso == 45
    assert proc.cant_operarios == 2
    # La pasada es la MISMA fila (id_otp), así que no se perdió el estado/avance.
    assert proc.id_estado == 1


@pytest.mark.asyncio
async def test_borrar_el_numero_de_ot_no_lo_pisa_con_cero(session):
    """
    El modal manda `id_otvieja: 0` con sólo borrar el campo "Nº OT Vieja". En el alta el 0
    significa "generalo vos"; en el update no hay nada que lo genere, así que entraba tal
    cual y la OT 15802 se quedaba sin número.
    """
    await _seed_ot(session)

    resp = await _guardar(session, id_otvieja=0)
    assert resp.status is True

    session.expire_all()
    orden = await session.get(OrdenTrabajo, OT_ID)
    assert orden.id_otvieja == OT_NUMERO, "se perdió el número visible de la OT"


@pytest.mark.asyncio
async def test_cambiar_el_numero_de_ot_a_mano_sigue_funcionando(session):
    """El campo es editable a propósito: un número nuevo de verdad sí tiene que entrar."""
    await _seed_ot(session)

    resp = await _guardar(session, id_otvieja=15999)
    assert resp.status is True

    session.expire_all()
    orden = await session.get(OrdenTrabajo, OT_ID)
    assert orden.id_otvieja == 15999


@pytest.mark.asyncio
async def test_el_repositorio_no_escribe_lo_que_no_es_columna(session):
    """
    La red de contención: aunque llegue un campo que no existe en la tabla, el guardado
    tiene que seguir andando (y no crear un atributo basura en el objeto).
    """
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    await _seed_ot(session)
    repo = OrdenTrabajoRepository(session)

    orden = await repo.update(OT_ID, {
        "detalle": "algo",
        "cliente": "UN STRING EN LA RELACION",   # relación → reventaba el flush
        "campo_inventado": "cualquier cosa",     # ni columna ni relación
    })

    assert orden is not None
    assert orden.detalle == "algo"
    assert orden.id_cliente == 1
    # Se mira el __dict__ y no los atributos: leer `orden.cliente` dispararía la carga
    # perezosa de la relación, que en async no se puede hacer acá.
    assert not isinstance(orden.__dict__.get("cliente"), str)
    assert "campo_inventado" not in orden.__dict__


def test_el_dto_de_update_declara_cliente_como_texto_de_pantalla():
    """
    Si algún día `cliente` deja de ser un str en el DTO, este test avisa: la relación del
    modelo se llama igual y el filtro por columnas es lo único que los mantiene separados.
    """
    from sqlalchemy import inspect

    from backend.dto.OrdenTrabajoUpdateDTO import OrdenTrabajoUpdateDTO

    assert "cliente" in OrdenTrabajoUpdateDTO.model_fields
    mapper = inspect(OrdenTrabajo)
    assert "cliente" not in {a.key for a in mapper.column_attrs}
    assert "cliente" in {r.key for r in mapper.relationships}


# ---------------------------------------------------------------------------
# Segunda tanda (3-sep-2026, misma tarde): arreglado lo de `cliente`, el guardado
# volvió a fallar con EL MISMO cartel. En los logs del servidor era otra cosa:
#
#   asyncpg.exceptions.DataError: invalid input for query argument $2:
#   datetime.datetime(2026, 9, 3, 0, 0, tzinfo=...)
#   (can't subtract offset-naive and offset-aware datetimes)
#
# El navegador manda `new Date(x).toISOString()` —con la Z de UTC— y las columnas
# de fecha son `timestamp without time zone`. asyncpg no acepta la mezcla.
#
# SQLite se traga los datetime con zona, así que acá NO se puede reproducir el
# error de la base: lo que se fija es que el DTO entregue la fecha ya sin zona,
# que es lo que evita que llegue a asyncpg.

def test_las_fechas_del_navegador_llegan_sin_zona_horaria():
    from backend.dto.OrdenTrabajoUpdateDTO import OrdenTrabajoUpdateDTO

    # Tal cual lo manda el modal: new Date("2026-09-03").toISOString()
    dto = OrdenTrabajoUpdateDTO(
        fecha_orden="2026-09-03T00:00:00.000Z",
        fecha_entrada="2026-09-02T00:00:00.000Z",
        fecha_prometida="2026-09-25T00:00:00.000Z",
        f_disp_material="2026-09-10T00:00:00.000Z",
    )
    for campo in ("fecha_orden", "fecha_entrada", "fecha_prometida", "f_disp_material"):
        v = getattr(dto, campo)
        assert v.tzinfo is None, f"{campo} llegó con zona horaria y asyncpg lo rechaza"

    # Y sobre todo: NO se corre el día.
    assert dto.fecha_orden == datetime(2026, 9, 3, 0, 0)
    assert dto.fecha_prometida == datetime(2026, 9, 25, 0, 0)


def test_el_alta_tambien_manda_las_fechas_con_zona():
    """El modal usa el mismo `toISOString()` para crear; el DTO de alta también."""
    from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO

    dto = OrdenTrabajoRequestDTO(
        id_otvieja=0, id_prioridad=1, id_sector=1, id_articulo=1,
        fecha_orden="2026-09-03T00:00:00.000Z",
        fecha_entrada="2026-09-03T00:00:00.000Z",
        fecha_prometida="2026-09-30T00:00:00.000Z",
        procesos=[],
    )
    assert dto.fecha_orden.tzinfo is None
    assert dto.fecha_prometida == datetime(2026, 9, 30, 0, 0)


def test_una_fecha_sin_zona_pasa_intacta():
    """No se toca lo que ya venía bien (por ejemplo, lo que arma el sync)."""
    from backend.dto.fechas import sin_zona
    d = datetime(2026, 9, 3, 14, 30)
    assert sin_zona(d) is d
    assert sin_zona(None) is None
    assert sin_zona("no soy fecha") == "no soy fecha"


@pytest.mark.asyncio
async def test_guardar_con_fechas_del_navegador(session):
    """De punta a punta: el payload del modal con fechas ISO guarda y no corre el día."""
    await _seed_ot(session)

    resp = await _guardar(
        session,
        fecha_orden="2026-08-31T00:00:00.000Z",
        fecha_entrada="2026-08-30T00:00:00.000Z",
        fecha_prometida="2026-09-25T00:00:00.000Z",
    )
    assert resp.status is True

    session.expire_all()
    orden = await session.get(OrdenTrabajo, OT_ID)
    assert orden.fecha_prometida == datetime(2026, 9, 25, 0, 0)
    assert orden.fecha_orden == datetime(2026, 8, 31, 0, 0)


def test_el_error_de_guardado_dice_el_motivo():
    """
    El cartel tiene que contar QUÉ pasó. Con «Error al actualizar la Orden de Trabajo»
    a secas, dos bugs distintos se veían idénticos y hubo que ir a los logs del
    servidor para distinguirlos.
    """
    from backend.infrastructure.db_retry import motivo_error_db

    msg = motivo_error_db(ValueError("can't subtract offset-naive and offset-aware datetimes"),
                          "guardar los cambios de la Orden de Trabajo")
    assert "guardar los cambios de la Orden de Trabajo" in msg
    assert "offset-naive" in msg, "el motivo real tiene que viajar en el mensaje"


# ---------------------------------------------------------------------------
# Sacarle TODOS los procesos a una OT y guardar (pedido de Julián, 3-sep-2026).
#
# Había dos frenos encadenados: el modal exigía al menos un proceso para dejar
# guardar, y aunque lo dejara, el backend recibía la lista vacía y NO borraba nada
# —trataba igual "no me mandaron procesos" que "me mandaron cero"—, así que los
# procesos volvían a aparecer solos.

@pytest.mark.asyncio
async def test_guardar_sin_procesos_los_borra(session):
    await _seed_ot(session)

    resp = await _guardar(session, procesos=[])
    assert resp.status is True

    session.expire_all()
    from sqlalchemy import select
    quedan = (await session.execute(
        select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id_orden_trabajo == OT_ID)
    )).scalars().all()
    assert quedan == [], "se pidió sacar todos los procesos y volvieron a quedar"


@pytest.mark.asyncio
async def test_no_mandar_procesos_no_los_toca(session):
    """
    Distinto de mandar la lista vacía: si la clave no viene, los procesos que ya
    estaban se quedan como están (lo usan los guardados que sólo tocan la cabecera).
    """
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.dto.OrdenTrabajoUpdateDTO import OrdenTrabajoUpdateDTO

    await _seed_ot(session)
    payload = {k: v for k, v in _payload_del_modal().items() if k != "procesos"}
    resp = await OrdenTrabajoService(session).modificarOrden(OT_ID, OrdenTrabajoUpdateDTO(**payload))
    assert resp.status is True

    session.expire_all()
    from sqlalchemy import select
    quedan = (await session.execute(
        select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id_orden_trabajo == OT_ID)
    )).scalars().all()
    assert len(quedan) == 1, "sin mandar procesos no hay que tocar los que ya estaban"


# ---------------------------------------------------------------------------
# Editar UNA pasada desde la lista, sin abrir la OT entera.

@pytest.mark.asyncio
async def test_editar_una_pasada(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed_ot(session)
    resp = await OrdenTrabajoService(session).editarProceso(
        OT_ID, 1, {"tiempo_proceso": 99, "cant_operarios": 3})
    assert resp.status is True

    session.expire_all()
    proc = await session.get(OrdenTrabajoProceso, 1)
    assert proc.tiempo_proceso == 99
    assert proc.cant_operarios == 3
    # No se toca el avance ni el estado.
    assert proc.id_estado == 1


@pytest.mark.asyncio
async def test_editar_una_pasada_no_pisa_lo_que_no_mandaron(session):
    """Tocar los minutos no le tiene que borrar la máquina que ya tenía elegida."""
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    from backend.domain.Maquinaria import Maquinaria

    await _seed_ot(session)
    session.add(Maquinaria(id=7, nombre="TORNO T1"))
    await session.commit()
    proc = await session.get(OrdenTrabajoProceso, 1)
    proc.id_maquinaria = 7
    await session.commit()

    await OrdenTrabajoService(session).editarProceso(OT_ID, 1, {"tiempo_proceso": 20})

    session.expire_all()
    proc = await session.get(OrdenTrabajoProceso, 1)
    assert proc.tiempo_proceso == 20
    assert proc.id_maquinaria == 7, "se perdió la máquina preseleccionada"


@pytest.mark.asyncio
async def test_editar_una_pasada_que_no_existe_avisa(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.commons.exceptions.NotFoundException import NotFoundException

    await _seed_ot(session)
    with pytest.raises(NotFoundException):
        await OrdenTrabajoService(session).editarProceso(OT_ID, 9999, {"tiempo_proceso": 5})


def test_el_endpoint_de_editar_pasada_acepta_solo_lo_que_cambio():
    from backend.presentation.OrdenTrabajoAPI import EditarProcesoRequest

    body = EditarProcesoRequest(tiempo_proceso=45)
    # exclude_unset: lo que no vino no viaja, así no pisa lo guardado.
    assert body.model_dump(exclude_unset=True) == {"tiempo_proceso": 45}


# ---------------------------------------------------------------------------
# Vaciar una fecha obligatoria desde la edición en línea de la tabla de
# Planificación (hallazgo de la auditoría del 3-sep-2026).
#
# handleDateSave manda `null` cuando se vacía la celda, y fecha_orden / entrada /
# prometida son NOT NULL: el UPDATE moría con un error de la base. Y como el catch
# del frontend sólo logueaba, el usuario no veía nada: la celda volvía sola al valor
# viejo y parecía que el sistema le ignoraba el cambio.

@pytest.mark.asyncio
async def test_vaciar_una_fecha_obligatoria_no_rompe_el_guardado(session):
    await _seed_ot(session)

    resp = await _guardar(session, fecha_prometida=None, fecha_entrada=None)
    assert resp.status is True

    session.expire_all()
    orden = await session.get(OrdenTrabajo, OT_ID)
    # Conserva las que tenía: no se inventa una fecha ni se guarda null.
    assert orden.fecha_prometida == datetime(2026, 9, 20)
    assert orden.fecha_entrada == datetime(2026, 8, 30)


@pytest.mark.asyncio
async def test_vaciar_la_fecha_de_entrega_si_se_permite(session):
    """`fecha_entrega` vacía es un dato válido: quiere decir que todavía no se entregó."""
    await _seed_ot(session)

    orden = await session.get(OrdenTrabajo, OT_ID)
    orden.fecha_entrega = datetime(2026, 9, 10)
    await session.commit()

    resp = await _guardar(session, fecha_entrega=None)
    assert resp.status is True

    session.expire_all()
    orden = await session.get(OrdenTrabajo, OT_ID)
    assert orden.fecha_entrega is None
