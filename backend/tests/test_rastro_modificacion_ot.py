"""Quién y cuándo tocó una OT por última vez.

El 11/09: `orden_trabajo` no guardaba nada sobre su propia edición. Los procesos sí
—desde el 10/09 cada cambio deja una foto en orden_trabajo_proceso_version—, pero la
cabecera se podía cambiar entera sin rastro: la OT aparecía con otra fecha prometida
y no se podía contestar quién la cambió. Y ni siquiera todos los cambios de procesos
quedaban: la PRIMERA carga sobre una OT vacía se salteaba la foto, que es justo el
cambio que más se deshace.

Lo que se fija acá:
  - editar SÓLO la cabecera deja rastro (era el agujero grande);
  - tocar los procesos también, por cualquiera de las puertas;
  - una OT sin procesos ahora sí versiona, así esa primera carga se puede deshacer;
  - sin usuario queda NULL y NUNCA un autor inventado;
  - el sync tiene por dónde entrar sin estampar, porque una máquina sincronizando
    no es una persona modificando;
  - y las horas son de Argentina, no del reloj UTC del contenedor.

Imports adentro de cada test, igual que en test_guardar_ot_editada.py.
"""
from datetime import datetime

import pytest
from sqlalchemy import select

from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector

OT_ID = 1
OT_NUMERO = 15802

# Lo que devuelve el dep de seguridad (core/security.py: get_current_user).
LUCAS = {"username": "lbianchi", "id_usuario": 4, "rol": "admin",
         "nombre": "Lucas", "apellido": "Bianchi"}


async def _seed(session, con_procesos: bool = True):
    session.add_all([
        Cliente(id=1, nombre="BOLSAPEL SAICIFYA"),
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="CL00C107", descripcion="Cremallera", abreviatura="CRE"),
        Proceso(id=100, nombre="CORTE LASER"),
        Proceso(id=101, nombre="CONTROL DE MEDIDAS"),
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=2, descripcion="En Proceso"),
        EstadoProceso(id=3, descripcion="Finalizado"),
    ])
    await session.commit()

    session.add(OrdenTrabajo(
        id=OT_ID, id_otvieja=OT_NUMERO, id_prioridad=1, id_sector=1, id_articulo=1,
        id_cliente=1, unidades=2, detalle="detalle original",
        fecha_orden=datetime(2026, 9, 1), fecha_entrada=datetime(2026, 9, 1),
        fecha_prometida=datetime(2026, 9, 20),
    ))
    await session.commit()

    if con_procesos:
        session.add(OrdenTrabajoProceso(
            id=1, id_orden_trabajo=OT_ID, id_proceso=100, orden=1, id_estado=1,
            tiempo_proceso=10, cant_operarios=1,
        ))
        await session.commit()


async def _releer(session) -> OrdenTrabajo:
    session.expire_all()
    return await session.get(OrdenTrabajo, OT_ID)


def _payload_cabecera(**cambios):
    """Sólo la cabecera: sin la clave `procesos`, que es el caso que no dejaba rastro."""
    payload = {
        "id_otvieja": OT_NUMERO,
        "detalle": "detalle nuevo",
        "id_cliente": 1,
        "cliente": "BOLSAPEL SAICIFYA",
        "unidades": 2,
        "id_prioridad": 1,
        "id_sector": 1,
        "id_articulo": 1,
        "fecha_orden": "2026-09-01T00:00:00",
        "fecha_entrada": "2026-09-01T00:00:00",
        "fecha_prometida": "2026-09-25T00:00:00",
    }
    payload.update(cambios)
    return payload


# ---------------------------------------------------------------------------
# El agujero grande: la cabecera sola.

@pytest.mark.asyncio
async def test_una_ot_recien_traida_no_tiene_rastro(session):
    """NULL quiere decir «nunca se tocó desde SPMM», y tiene que seguir siendo NULL
    hasta que alguien la toque de verdad. Si el alta o una lectura lo escribieran,
    las 1.400 OT importadas dirían que fueron modificadas y la columna no serviría
    para nada."""
    await _seed(session)
    orden = await _releer(session)
    assert orden.modificado_en is None
    assert orden.modificado_por is None


@pytest.mark.asyncio
async def test_editar_solo_la_cabecera_deja_rastro(session):
    """El caso del reporte: cambiar la fecha prometida y que el sistema no sepa quién."""
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.dto.OrdenTrabajoUpdateDTO import OrdenTrabajoUpdateDTO

    await _seed(session)
    antes = datetime.now()

    dto = OrdenTrabajoUpdateDTO(**_payload_cabecera())
    resp = await OrdenTrabajoService(session).modificarOrden(OT_ID, dto, usuario=LUCAS)
    assert resp.status is True

    orden = await _releer(session)
    assert orden.fecha_prometida == datetime(2026, 9, 25), "no guardó el cambio"
    assert orden.modificado_por == "Lucas Bianchi"
    assert orden.modificado_en is not None
    # Naive y de ahora: si quedara con zona, asyncpg no la acepta en producción.
    assert orden.modificado_en.tzinfo is None
    assert abs((orden.modificado_en - antes).total_seconds()) < 60 * 60 * 4


@pytest.mark.asyncio
async def test_sin_usuario_el_autor_queda_en_null(session):
    """Nunca un autor inventado. Que no se sepa quién fue tiene que poder decirse."""
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.dto.OrdenTrabajoUpdateDTO import OrdenTrabajoUpdateDTO

    await _seed(session)
    dto = OrdenTrabajoUpdateDTO(**_payload_cabecera())
    await OrdenTrabajoService(session).modificarOrden(OT_ID, dto, usuario=None)

    orden = await _releer(session)
    assert orden.modificado_por is None, "se inventó un autor"
    # Pero el cuándo SÍ queda: hubo una modificación, sólo que no se supo de quién.
    assert orden.modificado_en is not None


@pytest.mark.asyncio
async def test_el_cliente_no_puede_escribir_el_sello(session):
    """El sello lo pone el backend. Son columnas de la tabla, así que el filtro por
    columnas del repositorio las dejaría pasar — y entonces cualquiera podría decir
    que la OT la tocó otro."""
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    await _seed(session)
    await OrdenTrabajoRepository(session).update(OT_ID, {
        "detalle": "algo",
        "modificado_por": "EL QUE YO DIGA",
        "modificado_en": datetime(1999, 1, 1),
    }, usuario=LUCAS)

    orden = await _releer(session)
    assert orden.modificado_por == "Lucas Bianchi"
    assert orden.modificado_en.year != 1999


# ---------------------------------------------------------------------------
# El sync: una máquina sincronizando no es una persona modificando.

@pytest.mark.asyncio
async def test_el_sync_puede_guardar_sin_estampar(session):
    """El legacy pisa las OT importadas. Si eso estampara, toda la base terminaría
    diciendo que la última modificación la hizo el sync de madrugada — el ruido que
    haría inútil la columna."""
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    await _seed(session)
    await OrdenTrabajoRepository(session).update(
        OT_ID, {"detalle": "lo que dice el viejo"}, estampar=False)

    orden = await _releer(session)
    assert orden.detalle == "lo que dice el viejo", "no guardó el cambio"
    assert orden.modificado_en is None
    assert orden.modificado_por is None


# ---------------------------------------------------------------------------
# Los procesos, por todas las puertas.

@pytest.mark.asyncio
async def test_guardar_procesos_deja_rastro(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    from backend.dto.OrdenTrabajoUpdateDTO import OrdenTrabajoUpdateDTO

    await _seed(session)
    dto = OrdenTrabajoUpdateDTO(**_payload_cabecera(procesos=[
        {"proceso_id": 100, "id_otp": 1, "tiempo_proceso": 45, "cant_operarios": 1},
        {"proceso_id": 101, "tiempo_proceso": 20, "cant_operarios": 1},
    ]))
    await OrdenTrabajoService(session).modificarOrden(OT_ID, dto, usuario=LUCAS)

    orden = await _releer(session)
    assert orden.modificado_por == "Lucas Bianchi"
    assert orden.modificado_en is not None


@pytest.mark.asyncio
async def test_agregar_una_pasada_deja_rastro(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed(session)
    await OrdenTrabajoService(session).agregarProceso(
        OT_ID, 101, 30, usuario=LUCAS)

    assert (await _releer(session)).modificado_por == "Lucas Bianchi"


@pytest.mark.asyncio
async def test_editar_una_pasada_deja_rastro(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed(session)
    await OrdenTrabajoService(session).editarProceso(
        OT_ID, 1, {"tiempo_proceso": 99}, usuario=LUCAS)

    assert (await _releer(session)).modificado_por == "Lucas Bianchi"


@pytest.mark.asyncio
async def test_borrar_una_pasada_deja_rastro(session):
    """Es el cambio más destructivo de todos y era el más anónimo."""
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed(session)
    await OrdenTrabajoService(session).eliminarProceso(OT_ID, 100, id_otp=1, usuario=LUCAS)

    assert (await _releer(session)).modificado_por == "Lucas Bianchi"


@pytest.mark.asyncio
async def test_cambiar_el_estado_de_un_proceso_deja_rastro(session):
    """«¿Quién lo dio por terminado?» es la pregunta que más se hace."""
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed(session)
    await OrdenTrabajoService(session).actualizarEstadoProceso(OT_ID, 100, 3, user=LUCAS)

    assert (await _releer(session)).modificado_por == "Lucas Bianchi"


@pytest.mark.asyncio
async def test_observaciones_y_reorden_dejan_rastro(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed(session)
    svc = OrdenTrabajoService(session)

    await svc.actualizarObservacionesProceso(OT_ID, 100, "falta material", usuario=LUCAS)
    assert (await _releer(session)).modificado_por == "Lucas Bianchi"

    await svc.actualizarOrdenProcesos(
        OT_ID, [{"id_proceso": 100, "orden": 5, "id_otp": 1}],
        usuario={"nombre": "Camilo", "apellido": "Ruiz"})
    assert (await _releer(session)).modificado_por == "Camilo Ruiz"


@pytest.mark.asyncio
async def test_registrar_entrega_deja_rastro(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed(session)
    await OrdenTrabajoService(session).registrarEntrega(OT_ID, 1, usuario=LUCAS)

    orden = await _releer(session)
    assert orden.cantidad_entregada == 1, "no registró la entrega"
    assert orden.modificado_por == "Lucas Bianchi"


@pytest.mark.asyncio
async def test_todas_las_puertas_del_repositorio_reciben_usuario(session):
    """Red de contención: si mañana aparece otro método que modifica la OT, que sea
    una decisión y no un olvido. Lo que se mira es la firma — un método que escribe
    la OT y no sabe recibir al usuario no puede estampar."""
    import inspect as _inspect

    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    puertas = [
        "update", "update_processes_full", "update_proceso_status",
        "update_proceso_observaciones", "update_procesos_order",
        "update_cantidad_entregada", "agregarProceso", "editarProceso",
        "eliminarProceso",
    ]
    for nombre in puertas:
        firma = _inspect.signature(getattr(OrdenTrabajoRepository, nombre))
        assert "usuario" in firma.parameters, f"{nombre}() no sabe quién la llamó"


# ---------------------------------------------------------------------------
# HUECO A: la primera carga de procesos sobre una OT vacía.

@pytest.mark.asyncio
async def test_una_ot_sin_procesos_tambien_versiona(session):
    """Antes se salteaba la foto cuando la OT no tenía procesos, y así la PRIMERA
    carga era el único cambio de procesos que no se podía deshacer. Una foto de cero
    procesos no es una foto vacía: es exactamente lo que hace falta para volver atrás
    esa carga."""
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    await _seed(session, con_procesos=False)
    repo = OrdenTrabajoRepository(session)

    fotos = []

    async def _espiar(id_orden, procesos, motivo, usuario=None):
        fotos.append({"ot": id_orden, "procesos": list(procesos),
                      "motivo": motivo, "usuario": usuario})

    repo._guardar_version_procesos = _espiar

    await repo.update_processes_full(
        OT_ID,
        [{"proceso_id": 100, "tiempo_proceso": 15, "cant_operarios": 1}],
        motivo="planificacion", usuario=LUCAS)

    assert len(fotos) == 1, "la primera carga de procesos quedó sin foto previa"
    assert fotos[0]["procesos"] == [], "la foto tiene que decir que antes no había ninguno"
    assert fotos[0]["motivo"] == "planificacion"
    assert fotos[0]["usuario"] == LUCAS

    # Y el cambio se guardó igual.
    quedan = (await session.execute(
        select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id_orden_trabajo == OT_ID)
    )).scalars().all()
    assert len(quedan) == 1


@pytest.mark.asyncio
async def test_una_ot_con_procesos_sigue_versionando(session):
    """Lo que ya andaba tiene que seguir andando."""
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    await _seed(session)
    repo = OrdenTrabajoRepository(session)

    fotos = []

    async def _espiar(id_orden, procesos, motivo, usuario=None):
        fotos.append(list(procesos))

    repo._guardar_version_procesos = _espiar
    await repo.update_processes_full(OT_ID, [], motivo="edicion", usuario=LUCAS)

    assert len(fotos) == 1
    assert [p.id_proceso for p in fotos[0]] == [100]


# ---------------------------------------------------------------------------
# La hora: el contenedor de Cloud Run no fija TZ.

def test_la_hora_que_se_estampa_es_la_de_argentina():
    from zoneinfo import ZoneInfo

    from backend.infrastructure.OrdenTrabajoRepository import _ahora_ar

    ahora = _ahora_ar()
    esperada = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).replace(tzinfo=None)
    assert ahora.tzinfo is None, "con zona, asyncpg rechaza el guardado"
    assert abs((ahora - esperada).total_seconds()) < 5


def test_no_queda_ningun_datetime_now_pelado_en_el_repositorio():
    """El Dockerfile no fija TZ: en Cloud Run datetime.now() da UTC y todo lo que se
    estampe desde acá queda 3 horas adelantado respecto del resto de la auditoría y
    del reloj del taller. Es un bug que no se ve en desarrollo —la máquina de casa ya
    está en hora de Argentina— y por eso lo tiene que atajar un test."""
    import re
    from pathlib import Path

    fuente = (Path(__file__).resolve().parents[1]
              / "infrastructure" / "OrdenTrabajoRepository.py").read_text(encoding="utf-8")

    # Los comentarios nombran el bug a propósito: lo que se busca es código.
    sospechosas = [l.strip() for l in fuente.splitlines()
                   if re.search(r"datetime\.now\(\s*\)", l)
                   and not l.strip().startswith("#")]
    assert not sospechosas, (
        "usá _ahora_ar() en vez de datetime.now(): " + " | ".join(sospechosas))


# ---------------------------------------------------------------------------
# Dos agujeros que los tests de arriba NO cubren, y que se tapan mirando la fuente
# ---------------------------------------------------------------------------

def test_guardar_sin_cambiar_nada_no_deja_rastro():
    """El sello dice "quién la modificó", no "quién apretó Guardar".

    El modal manda la cabecera COMPLETA en cada PUT, así que abrir una OT y guardar
    sin tocar un campo llega al repositorio con veinte valores idénticos a los que ya
    estaban. Si eso sellara, la columna contestaría otra pregunta que la que promete
    el COMMENT de la migración — y el dato existe justamente para poder creerle.
    """
    import inspect
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    cuerpo = inspect.getsource(OrdenTrabajoRepository.update)
    assert "hubo_cambio" in cuerpo, "update volvió a sellar en todo guardado"
    assert "if estampar and hubo_cambio:" in cuerpo, (
        "el sello dejó de mirar si cambió algo"
    )


def test_la_foto_de_procesos_guarda_las_columnas_que_la_tabla_declara():
    """Red de contención del historial, que falla EN SILENCIO.

    `_guardar_version_procesos` se traga su propia excepción a propósito (que el
    historial falle no puede impedir guardar una OT), y es Postgres puro —BIGSERIAL,
    JSONB, CAST(... AS JSONB)—, así que sobre SQLite no corre. Los tests que lo
    verifican usan un espía: comprueban que se LLAMA, no que quede una foto.

    Consecuencia: si alguien le cambia un nombre de columna al INSERT, los tests
    siguen en verde, el botón de deshacer deja de guardar versiones y la única señal
    es un warning en los logs de Cloud Run — hasta que alguien necesita deshacer y no
    puede.

    Esto no reemplaza una prueba real contra Postgres, pero cubre la forma más
    probable de romperlo: que el INSERT y la tabla dejen de coincidir.
    """
    import inspect
    import re
    from pathlib import Path
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    cuerpo = inspect.getsource(OrdenTrabajoRepository._guardar_version_procesos)

    insert = re.search(
        r"INSERT INTO orden_trabajo_proceso_version\s*\(([^)]+)\)", cuerpo, re.S
    )
    assert insert, "no se encontró el INSERT del historial de procesos"
    columnas_insert = {c.strip() for c in insert.group(1).split(",")}

    sql = (Path(__file__).resolve().parent.parent / "scripts" / "migrations"
           / "2026-09-10_historial_procesos_ot.sql").read_text()
    cuerpo_tabla = re.search(
        r"CREATE TABLE IF NOT EXISTS orden_trabajo_proceso_version \((.*?)\n\);", sql, re.S
    )
    assert cuerpo_tabla, "cambió la forma del CREATE TABLE en la migración"
    columnas_tabla = set(
        re.findall(r"^\s{4}(\w+)\s+\w", cuerpo_tabla.group(1), re.M)
    )

    faltan = columnas_insert - columnas_tabla
    assert not faltan, (
        f"el INSERT escribe {sorted(faltan)} y la tabla no las tiene: "
        "el historial va a fallar en silencio y deshacer deja de funcionar"
    )
