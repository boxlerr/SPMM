"""El aviso automático de orden retrasada (RF-04).

El SRS pide que el sistema avise SOLO cuando una orden se pasa de su fecha. La
campanita y toda su cañería ya existían; lo que faltaba era quién mira el reloj.

Lo que persigue este archivo no es que el endpoint devuelva 200, sino las tres formas
en que un aviso automático se rompe solo y nadie se entera:

  1. **Que repita.** Si cada corrida vuelve a avisar de la misma orden, a los diez días
     la campanita tiene diez renglones por orden y deja de servir. El anti-duplicado
     de producción es un índice único PARCIAL de Postgres, que en SQLite —donde corren
     estos tests— no existe: por eso la regla tiene que estar además en la consulta, y
     por eso el test que la cuida corre el detector DOS veces.
  2. **Que avise de más.** Esta base usa 1950-01-01 y 3000-01-01 como «sin fecha». Si
     no se filtran los dos, TODA orden sin fecha real entra como retrasada.
  3. **Que avise de todo junto.** Hay ~194 órdenes abiertas y el taller está
     sobrevendido: sin tope, la primera corrida contra producción deja la campanita
     inservible el día uno.
"""
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.application.AlertaRetrasoService import (
    TIPO_ALERTA,
    AlertaRetrasoService,
    armar_mensaje,
)
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.Notificacion import Notificacion
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.Prioridad import Prioridad
from backend.domain.Sector import Sector

# Un martes cualquiera, a media mañana. Fijo para que los días de atraso no dependan
# del día en que se corran los tests.
HOY = datetime(2026, 9, 22, 10, 30)

SIN_FECHA_VIEJA = datetime(1950, 1, 1)
SIN_FECHA_NUEVA = datetime(3000, 1, 1)


async def _catalogos(session):
    """Lo mínimo que una OT necesita para poder existir (las FK son obligatorias)."""
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja de acero", abreviatura="BAND"),
        Cliente(id=1, nombre="ACME SRL"),
    ])
    await session.commit()


def _ot(id_ot: int, prometida, **extra) -> OrdenTrabajo:
    datos = dict(
        id=id_ot,
        id_otvieja=7000 + id_ot,
        id_prioridad=1,
        id_sector=1,
        id_articulo=1,
        id_cliente=1,
        unidades=3,
        fecha_orden=datetime(2026, 8, 1),
        fecha_entrada=datetime(2026, 8, 1),
        fecha_prometida=prometida,
        finalizadototal=0,
    )
    datos.update(extra)
    return OrdenTrabajo(**datos)


async def _avisos(session) -> list[Notificacion]:
    return (await session.execute(
        select(Notificacion).where(Notificacion.tipo == TIPO_ALERTA)
    )).scalars().all()


async def _correr(session, **kw):
    return await AlertaRetrasoService(session).detectarYAvisarRetrasos(ahora=HOY, **kw)


# ─────────────────────────── que avise ───────────────────────────

@pytest.mark.asyncio
async def test_una_orden_vencida_y_sin_terminar_genera_un_aviso(session):
    await _catalogos(session)
    session.add(_ot(1, HOY - timedelta(days=10)))
    await session.commit()

    resultado = await _correr(session)

    assert resultado.data["creadas"] == 1
    assert resultado.data["sin_avisar"] == 0

    avisos = await _avisos(session)
    assert len(avisos) == 1
    aviso = avisos[0]
    # El aviso tiene que poder llevar a la orden: sin esto, tocarlo abre la lista de
    # notificaciones y hay que ir a buscarla a mano.
    assert aviso.id_orden_trabajo == 1
    # El taller conoce la orden por el número del sistema viejo, no por el id interno.
    assert "#7001" in aviso.mensaje
    assert "12/09/2026" in aviso.mensaje and "10 días" in aviso.mensaje
    assert not aviso.leida
    # No la generó una persona: la generó el reloj.
    assert aviso.id_usuario_creador is None
    # De qué es y de quién, que es lo que se pregunta después.
    assert "Bandeja de acero" in aviso.motivo and "ACME SRL" in aviso.motivo


@pytest.mark.asyncio
async def test_una_orden_en_curso_y_vencida_tambien_avisa(session):
    """La diferencia a propósito con el bucket «Retrasadas» del tablero.

    El tablero exige que la orden NO haya arrancado, así que una OT que se está
    fabricando y ya venció le aparece como «En Curso». Para el aviso eso no sirve: que
    el taller ya le haya puesto la mano encima no hace que llegue a tiempo, y son justo
    las órdenes de las que hay que hablar hoy. El tablero no se tocó (es el número que
    Lucas mira todos los días), así que esta diferencia es esperada, no un bug.
    """
    await _catalogos(session)
    session.add(_ot(1, HOY - timedelta(days=3), en_proceso=1))
    await session.commit()

    assert (await _correr(session)).data["creadas"] == 1


@pytest.mark.asyncio
async def test_el_dia_prometido_todavia_no_es_retraso(session):
    """Una orden prometida para HOY está a tiempo hasta que termine el día."""
    await _catalogos(session)
    session.add(_ot(1, HOY.replace(hour=0, minute=0)))
    await session.commit()

    assert (await _correr(session)).data["creadas"] == 0
    assert await _avisos(session) == []


# ─────────────────────── que no avise de más ───────────────────────

@pytest.mark.asyncio
async def test_correr_dos_veces_no_duplica_el_aviso(session):
    """El anti-duplicado va en la CONSULTA, no sólo en el índice de Postgres.

    En producción hay un índice único parcial que lo impide; acá la base es SQLite y
    ese índice no existe. Si la regla viviera sólo en el índice, este test pasaría en
    verde y producción duplicaría igual.
    """
    await _catalogos(session)
    session.add(_ot(1, HOY - timedelta(days=5)))
    await session.commit()

    primera = await _correr(session)
    segunda = await _correr(session)

    assert primera.data["creadas"] == 1
    assert segunda.data["creadas"] == 0
    assert len(await _avisos(session)) == 1


@pytest.mark.asyncio
async def test_la_orden_terminada_no_avisa(session):
    await _catalogos(session)
    session.add(_ot(1, HOY - timedelta(days=30), finalizadototal=1))
    await session.commit()

    assert (await _correr(session)).data["creadas"] == 0


@pytest.mark.asyncio
async def test_la_orden_ya_entregada_no_avisa(session):
    """Si ya salió del taller no hay nada que hacer, aunque nadie la haya tildado."""
    await _catalogos(session)
    session.add(_ot(1, HOY - timedelta(days=30), fecha_entrega=HOY - timedelta(days=2)))
    await session.commit()

    assert (await _correr(session)).data["creadas"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("sin_fecha", [SIN_FECHA_VIEJA, SIN_FECHA_NUEVA])
async def test_las_fechas_centinela_no_son_un_retraso(session, sin_fecha):
    """1950-01-01 y 3000-01-01 son los dos «sin fecha» que conviven en esta base.

    Sin filtrar los DOS, toda orden sin fecha real entraría como retrasada — y son
    muchas.
    """
    await _catalogos(session)
    session.add(_ot(1, sin_fecha))
    await session.commit()

    assert (await _correr(session)).data["creadas"] == 0


# ─────────────────────── el tope por corrida ───────────────────────

@pytest.mark.asyncio
async def test_una_corrida_no_puede_llenar_la_campanita(session):
    """La primera pasada contra producción puede encontrar decenas de vencidas.

    Sin tope, la campanita queda con cien renglones el día uno y nadie la vuelve a
    mirar: el aviso se rompe solo por exceso. Lo que queda afuera no se pierde y la
    respuesta lo dice, para poder hacer la primera pasada a mano y mirando.
    """
    await _catalogos(session)
    for i in range(1, 8):
        session.add(_ot(i, HOY - timedelta(days=i)))
    await session.commit()

    primera = await _correr(session, tope=3)
    assert primera.data["creadas"] == 3
    assert primera.data["sin_avisar"] == 4
    assert len(await _avisos(session)) == 3

    # Y lo que quedó afuera se avisa en las corridas siguientes, sin repetir nada.
    segunda = await _correr(session, tope=3)
    tercera = await _correr(session, tope=3)
    assert (segunda.data["creadas"], tercera.data["creadas"]) == (3, 1)
    assert tercera.data["sin_avisar"] == 0

    avisos = await _avisos(session)
    assert len(avisos) == 7
    assert len({a.id_orden_trabajo for a in avisos}) == 7


@pytest.mark.asyncio
async def test_se_avisa_primero_de_lo_que_se_retraso_recien(session):
    """Con tope, importa a cuáles se avisa primero: a las que recién vencieron.

    En régimen normal da igual (son una o dos por día). Para la primera pasada es lo
    que deja arriba lo que está pasando ahora, en vez de la mora vieja que ya se conoce.
    """
    await _catalogos(session)
    session.add(_ot(1, HOY - timedelta(days=200)))   # mora vieja
    session.add(_ot(2, HOY - timedelta(days=1)))     # se venció ayer
    await session.commit()

    await _correr(session, tope=1)

    avisos = await _avisos(session)
    assert [a.id_orden_trabajo for a in avisos] == [2]


# ─────────────────────────── la hora ───────────────────────────

@pytest.mark.asyncio
async def test_el_aviso_se_estampa_con_la_hora_del_taller(session):
    """El contenedor de Cloud Run no fija TZ y el modelo trae `utcnow` de default.

    Sin pasar la hora explícita, el aviso queda tres horas adelantado —«hace un rato»
    para algo que todavía no pasó— y, peor, el corte de «hoy» se calcularía en UTC:
    entre las 21:00 y las 00:00 hora del taller el sistema ya estaría en el día
    siguiente y avisaría un día antes de tiempo.
    """
    await _catalogos(session)
    session.add(_ot(1, datetime(2020, 1, 15)))
    await session.commit()

    # Sin `ahora`: el servicio tiene que resolverla él, y en hora de Argentina.
    await AlertaRetrasoService(session).detectarYAvisarRetrasos()

    aviso = (await _avisos(session))[0]
    esperada = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).replace(tzinfo=None)
    assert aviso.fecha_creacion.tzinfo is None, "con zona, asyncpg rechaza el guardado"
    assert abs((aviso.fecha_creacion - esperada).total_seconds()) < 60


def test_el_detector_no_usa_utcnow_en_ningun_lado():
    """El bug que ya arrastran los otros avisos (handlers.py) no se repite acá."""
    import re

    fuente = (Path(__file__).resolve().parents[1]
              / "application" / "AlertaRetrasoService.py").read_text(encoding="utf-8")
    sospechosas = [l.strip() for l in fuente.splitlines()
                   if re.search(r"datetime\.(utcnow|now)\(\s*\)", l)
                   and not l.strip().startswith("#")]
    assert not sospechosas, (
        "usá _ahora_ar() en vez de utcnow()/now(): " + " | ".join(sospechosas))


# ─────────────────────────── el texto ───────────────────────────

def test_la_frase_dice_numero_fecha_y_cuanto_hace():
    frase = armar_mensaje(7497, datetime(2026, 9, 12), 10)
    assert frase == ("La OT #7497 está retrasada: se prometió para el 12/09/2026 "
                     "y hace 10 días que venció.")
    # Un día se dice en singular: la campanita la lee una persona.
    assert "hace 1 día que venció" in armar_mensaje(7497, datetime(2026, 9, 21), 1)
    # Y entra en la columna, que son 500 caracteres.
    assert len(armar_mensaje(999999999, datetime(2026, 9, 12), 99999)) <= 500


# ────────────────────── la migración ──────────────────────

def test_la_columna_que_evita_el_duplicado_esta_en_la_migracion():
    sql = (Path(__file__).resolve().parents[1] / "scripts" / "migrations"
           / "2026-09-22_alerta_retraso_ot.sql").read_text(encoding="utf-8").lower()
    assert "add column if not exists id_orden_trabajo" in sql
    assert "ux_notificacion_retraso_ot" in sql
    # Parcial: una OT puede tener otros avisos (se creó, cambió de estado); lo que no
    # puede repetirse es el de retraso.
    assert "where tipo = 'ot_retrasada'" in sql


def test_la_migracion_se_aplica_sola_al_arrancar():
    """El backend se deploya a mano y nadie corre el .sql: si no está acá, en producción
    la columna no existe y el detector duplica (o se cae la lectura de notificaciones)."""
    from backend.infrastructure import migraciones

    nombres = [n for n, _ in migraciones.MIGRACIONES]
    assert "2026-09-22_alerta_retraso_ot" in nombres
    ddl = " ".join(s for n, ss in migraciones.MIGRACIONES
                   if n == "2026-09-22_alerta_retraso_ot" for s in ss).lower()
    assert "id_orden_trabajo" in ddl and "ux_notificacion_retraso_ot" in ddl


# ────────────────────── el disparador ──────────────────────

@pytest_asyncio.fixture
async def cliente_interno(session):
    """La app real, con la base en memoria pisada en la dependencia del endpoint."""
    from backend.presentation import main

    async def _db():
        yield session

    main.app.dependency_overrides[main.get_db_interno] = _db
    async with AsyncClient(transport=ASGITransport(app=main.app),
                           base_url="http://test") as c:
        yield c
    main.app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_sin_token_configurado_el_disparador_no_existe(cliente_interno, monkeypatch):
    """En un entorno mal configurado nadie tiene que poder dispararlo."""
    monkeypatch.delenv("SYNC_TOKEN", raising=False)
    r = await cliente_interno.post("/internal/alertas-retraso")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_con_el_token_equivocado_no_pasa(cliente_interno, monkeypatch):
    monkeypatch.setenv("SYNC_TOKEN", "el-de-verdad")
    r = await cliente_interno.post("/internal/alertas-retraso",
                                   headers={"x-sync-token": "otro"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_el_disparador_avisa_y_cuenta_lo_que_dejo_afuera(cliente_interno, session, monkeypatch):
    monkeypatch.setenv("SYNC_TOKEN", "el-de-verdad")
    await _catalogos(session)
    for i in range(1, 5):
        session.add(_ot(i, datetime(2026, 1, i + 1)))
    await session.commit()

    r = await cliente_interno.post("/internal/alertas-retraso?tope=2",
                                   headers={"x-sync-token": "el-de-verdad"})

    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["creadas"] == 2
    # Sin este número, una corrida topeada se ve igual que una en la que ya no queda
    # nada por avisar.
    assert cuerpo["sin_avisar"] == 2
    assert cuerpo["tope"] == 2
