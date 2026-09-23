"""La asistencia de cada persona (RF-06, versión simple).

Julián: «que se vaya guardando en el perfil de cada operario. que el activo y el ausente
cuente como eso guardando fecha de ausencias». Lo que persigue este archivo son las
formas en que ese registro deja de servir:

  1. **Que el Activo / Ausente no deje rastro.** Pasar a alguien a Ausente abre una
     ausencia con fecha, quién y la hora del taller; volverlo a Activo la cierra.
  2. **Que un clic equivocado sume un día de falta.** Ausente y Activo el mismo día
     queda registrado con cero días.
  3. **Que la cuenta mienta.** Los días se cuentan una vez aunque se pisen dos
     registros; los laborables miran los días de trabajo de la persona y los feriados.
  4. **Que guardar a la persona deje de andar** si la tabla todavía no está.
  5. **Que el planificador cambie.** `disponible` sigue siendo lo único que mira: cargar
     unas vacaciones no la toca.
"""
from datetime import date, datetime, time, timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.application.AusenciaService import AusenciaService
from backend.application.OperarioService import OperarioService
from backend.application.PausaService import ahora_ar
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user
from backend.domain.AusenciaOperario import AusenciaOperario, dias_de_ausencia, dias_trabajo_de
from backend.domain.Operario import Operario
from backend.dto.OperarioRequestDTO import OperarioRequestDTO
from backend.infrastructure.db import Base
from backend.presentation import AsistenciaAPI
from backend.tests.conftest import TEST_TABLES

LUCAS = {"id_usuario": 4, "username": "lucas", "nombre": "Lucas", "apellido": "Gómez", "rol": "supervisor"}
JUAN = 1


async def _persona(session, disponible=True):
    session.add(Operario(id=JUAN, nombre="JUAN", apellido="PEREZ", categoria="OFICIAL",
                         disponible=disponible, hora_inicio=time(7), hora_fin=time(16),
                         dias_trabajo="MON,TUE,WED,THU,FRI"))
    await session.commit()


@pytest_asyncio.fixture
async def taller(session):
    await _persona(session)
    return session


async def _ausencias(session) -> list[AusenciaOperario]:
    session.expire_all()
    return (await session.execute(select(AusenciaOperario).order_by(AusenciaOperario.id))).scalars().all()


async def _marcar(session, disponible: bool, usuario=LUCAS, **extra):
    dto = OperarioRequestDTO(nombre="JUAN", apellido="PEREZ", categoria="OFICIAL",
                             disponible=disponible, **extra)
    r = await OperarioService(session).modificarOperario(JUAN, dto, usuario=usuario)
    assert r.status is True
    return r


def _hoy() -> date:
    return ahora_ar().date()


# ─────────────────────── el Activo / Ausente deja rastro ───────────────────────

async def test_pasar_a_ausente_abre_una_ausencia_con_fecha_quien_y_hora(taller):
    await _marcar(taller, False, ausencia_observacion="  avisó que está con fiebre ")

    (a,) = await _ausencias(taller)
    assert a.origen == "ESTADO" and a.desde == _hoy() and a.vuelve is None
    assert a.usuario_carga == "Lucas Gómez" and a.id_usuario_carga == 4
    assert a.observacion == "avisó que está con fiebre"
    assert a.cargada_en.tzinfo is None
    assert abs((a.cargada_en - ahora_ar()).total_seconds()) < 120, "se estampó en UTC"
    # Y la persona quedó Ausente, como siempre: es lo que mira el planificador.
    op = (await taller.execute(select(Operario).where(Operario.id == JUAN))).scalar_one()
    assert op.disponible is False


async def test_volver_a_activo_otro_dia_cierra_con_los_dias_que_falto(taller):
    taller.add(AusenciaOperario(id_operario=JUAN, desde=_hoy() - timedelta(days=3), origen="ESTADO",
                                cargada_en=ahora_ar() - timedelta(days=3)))
    op = (await taller.execute(select(Operario).where(Operario.id == JUAN))).scalar_one()
    op.disponible = False
    await taller.commit()

    await _marcar(taller, True)

    (a,) = await _ausencias(taller)
    assert a.vuelve == _hoy(), "faltó hasta ayer: vuelve hoy"
    assert a.hasta_inclusivo == _hoy() - timedelta(days=1)
    assert a.usuario_cierre == "Lucas Gómez" and a.cerrada_en is not None
    r = await AusenciaService(taller).historial(JUAN, _hoy() - timedelta(days=10), _hoy())
    (fila,) = r.data["ausencias"]
    assert fila["dias"] == 3 and fila["abierta"] is False


async def test_ausente_y_activo_el_mismo_dia_queda_registrado_con_cero_dias(taller):
    """Llegó tarde, o fue un clic equivocado: el cambio queda, la falta no suma."""
    await _marcar(taller, False)
    await _marcar(taller, True)

    (a,) = await _ausencias(taller)
    assert a.desde == a.vuelve == _hoy()
    assert a.hasta_inclusivo is None
    r = await AusenciaService(taller).historial(JUAN)
    assert r.data["resumen"]["dias"] == 0
    (fila,) = r.data["ausencias"]
    assert fila["mismo_dia"] is True and fila["dias"] == 0


async def test_guardar_la_ficha_sin_cambiar_el_estado_no_anota_nada(taller):
    await _marcar(taller, True)
    dto = OperarioRequestDTO(nombre="JUAN", apellido="PEREZ", categoria="OFICIAL", celular="1155")
    await OperarioService(taller).modificarOperario(JUAN, dto, usuario=LUCAS)
    assert await _ausencias(taller) == []


async def test_dos_veces_ausente_abre_una_sola(taller):
    await _marcar(taller, False)
    await _marcar(taller, False)
    assert len(await _ausencias(taller)) == 1


async def test_la_base_no_deja_dos_abiertas_de_la_misma_persona(taller):
    """Dos personas apretando «Ausente» a la vez: el índice único parcial frena la segunda."""
    from sqlalchemy.exc import IntegrityError
    for _ in range(2):
        taller.add(AusenciaOperario(id_operario=JUAN, desde=_hoy(), origen="ESTADO", cargada_en=ahora_ar()))
    with pytest.raises(IntegrityError):
        await taller.commit()
    await taller.rollback()


async def test_sin_token_no_se_inventa_un_autor(taller):
    await _marcar(taller, False, usuario=None)
    (a,) = await _ausencias(taller)
    assert a.usuario_carga is None and a.id_usuario_carga is None


async def test_ausente_de_antes_no_inventa_un_desde(session):
    """Estaba Ausente antes de que esto existiera: no hay nada abierto que cerrar, y el
    historial lo dice en vez de inventar una fecha."""
    await _persona(session, disponible=False)
    r = await AusenciaService(session).historial(JUAN)
    assert r.data["ausente_sin_fecha"] is True and r.data["abierta"] is None

    await _marcar(session, True)
    assert await _ausencias(session) == []


# ─────────────────────── sin la tabla, guardar la persona sigue andando ───────────────────────

@pytest_asyncio.fixture
async def taller_sin_tabla_de_ausencias():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})

    @event.listens_for(engine.sync_engine, "connect")
    def _fks(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    tablas = [t for t in TEST_TABLES if t.name != "operario_ausencia"]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tablas))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        await _persona(s)
        yield s
    await engine.dispose()


async def test_sin_la_tabla_pasar_a_ausente_se_guarda_igual(taller_sin_tabla_de_ausencias):
    s = taller_sin_tabla_de_ausencias
    await _marcar(s, False)
    s.expire_all()
    op = (await s.execute(select(Operario).where(Operario.id == JUAN))).scalar_one()
    assert op.disponible is False
    await _marcar(s, True)
    s.expire_all()
    assert (await s.execute(select(Operario).where(Operario.id == JUAN))).scalar_one().disponible is True


async def test_sin_la_tabla_borrar_la_persona_avisa_como_antes(taller_sin_tabla_de_ausencias):
    r = await OperarioService(taller_sin_tabla_de_ausencias).eliminarOperario(JUAN)
    assert r.status is True


# ─────────────────────── cargar a mano ───────────────────────

async def test_cargar_un_dia(taller):
    r = await AusenciaService(taller).cargar(JUAN, "2026-09-15", motivo="enfermedad",
                                             observacion="certificado", usuario=LUCAS)
    (a,) = await _ausencias(taller)
    assert (a.desde, a.vuelve, a.motivo, a.origen) == (date(2026, 9, 15), date(2026, 9, 16), "ENFERMEDAD", "CARGA")
    assert a.usuario_carga == "Lucas Gómez"
    assert r.data["hasta"] == "2026-09-15" and r.data["dias"] == 1
    assert r.data["motivo_texto"] == "Enfermedad" and r.data["persona"] == "JUAN PEREZ"


async def test_cargar_un_periodo_sin_motivo(taller):
    r = await AusenciaService(taller).cargar(JUAN, "2026-10-01", "2026-10-15", usuario=LUCAS)
    assert r.data["dias"] == 15 and r.data["motivo"] is None
    assert r.data["programada"] is (date(2026, 10, 1) > _hoy())


@pytest.mark.parametrize("desde,hasta,motivo", [
    ("2026-09-15", "2026-09-14", None),      # termina antes de empezar
    ("15/09/2026", None, None),              # formato
    ("2026-09-15", None, "VACAS"),           # motivo inventado
    ("2026-01-01", "2062-01-01", None),      # un año mal tipeado
    ("", None, None),                        # sin desde
])
async def test_cargar_mal_se_explica(taller, desde, hasta, motivo):
    with pytest.raises(BusinessException):
        await AusenciaService(taller).cargar(JUAN, desde, hasta, motivo, usuario=LUCAS)
    assert await _ausencias(taller) == []


async def test_dos_cargas_que_se_pisan_no(taller):
    s = AusenciaService(taller)
    await s.cargar(JUAN, "2026-10-01", "2026-10-15", "VACACIONES", usuario=LUCAS)
    with pytest.raises(HTTPException) as e:
        await s.cargar(JUAN, "2026-10-10", "2026-10-20", usuario=LUCAS)
    assert e.value.status_code == 409
    assert "del 01/10/2026 al 15/10/2026 (vacaciones)" in e.value.detail["message"]
    # Pegada (vuelve el 16, empieza el 16) sí.
    await s.cargar(JUAN, "2026-10-16", usuario=LUCAS)


async def test_una_carga_encima_de_un_ausente_se_puede_y_cada_dia_cuenta_una_vez(taller):
    """Lo pusieron Ausente hace 4 días y después cargaron «Enfermedad» para esos días."""
    hoy = _hoy()
    taller.add(AusenciaOperario(id_operario=JUAN, desde=hoy - timedelta(days=4), origen="ESTADO",
                                cargada_en=ahora_ar()))
    await taller.commit()
    await AusenciaService(taller).cargar(JUAN, (hoy - timedelta(days=4)).isoformat(),
                                         (hoy - timedelta(days=1)).isoformat(), "ENFERMEDAD", usuario=LUCAS)
    r = await AusenciaService(taller).historial(JUAN, (hoy - timedelta(days=30)).isoformat(), hoy.isoformat())
    # La abierta cuenta hasta hoy: 5 días, no 9.
    assert r.data["resumen"]["dias"] == 5
    # Y por motivo manda la que dice por qué.
    por_motivo = {m["motivo"]: m["dias"] for m in r.data["resumen"]["por_motivo"]}
    assert por_motivo == {"ENFERMEDAD": 4, "SIN_MOTIVO": 1}


async def test_cargar_no_toca_el_estado_de_la_persona(taller):
    """El plan no cambia: sólo `disponible` saca a alguien del plan."""
    hoy = _hoy()
    await AusenciaService(taller).cargar(JUAN, hoy.isoformat(), (hoy + timedelta(days=5)).isoformat(),
                                         "VACACIONES", usuario=LUCAS)
    taller.expire_all()
    assert (await taller.execute(select(Operario).where(Operario.id == JUAN))).scalar_one().disponible is True


# ─────────────────────── el historial y la cuenta ───────────────────────

async def test_el_total_del_periodo_en_corridos_y_laborables(taller):
    """Del lunes 14 al domingo 20 de septiembre: 7 corridos, 5 laborables; con el
    miércoles 16 feriado, 4."""
    await AusenciaService(taller).cargar(JUAN, "2026-09-14", "2026-09-20", "VACACIONES", usuario=LUCAS)
    r = await AusenciaService(taller).historial(JUAN, "2026-09-01", "2026-09-30")
    assert r.data["resumen"]["dias"] == 7 and r.data["resumen"]["dias_laborables"] == 5

    await taller.execute(text("CREATE TABLE dia_bloqueado (fecha DATE PRIMARY KEY, creado_en TIMESTAMP)"))
    await taller.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES ('2026-09-16')"))
    await taller.commit()
    r = await AusenciaService(taller).historial(JUAN, "2026-09-01", "2026-09-30")
    assert r.data["resumen"]["dias_laborables"] == 4


async def test_el_periodo_recorta_lo_que_cae_afuera(taller):
    await AusenciaService(taller).cargar(JUAN, "2026-08-28", "2026-09-03", usuario=LUCAS)
    r = await AusenciaService(taller).historial(JUAN, "2026-09-01", "2026-09-30")
    assert r.data["resumen"]["dias"] == 3
    # La ausencia sale entera en la lista, con sus 7 días.
    (fila,) = r.data["ausencias"]
    assert fila["dias"] == 7
    # Y lo que no toca el período no sale.
    r = await AusenciaService(taller).historial(JUAN, "2026-10-01", "2026-10-31")
    assert r.data["ausencias"] == [] and r.data["resumen"]["dias"] == 0


async def test_sin_periodo_es_el_anio_en_curso(taller):
    r = await AusenciaService(taller).historial(JUAN)
    assert r.data["periodo"] == {"desde": f"{_hoy().year}-01-01", "hasta": f"{_hoy().year}-12-31"}
    assert [m["codigo"] for m in r.data["motivos"]] == ["VACACIONES", "ENFERMEDAD", "LICENCIA", "PERSONAL", "OTRO"]


def test_la_cuenta_de_dias_pura():
    hoy = date(2026, 9, 23)  # miércoles
    lv = dias_trabajo_de("MON,TUE,WED,THU,FRI")
    # Medio abierta: [14, 21) son 7 días.
    assert dias_de_ausencia([(date(2026, 9, 14), date(2026, 9, 21))],
                            date(2026, 9, 1), date(2026, 9, 30), hoy, lv) == (7, 5)
    # Volvió el mismo día: cero.
    assert dias_de_ausencia([(hoy, hoy)], date(2026, 9, 1), date(2026, 9, 30), hoy, lv) == (0, 0)
    # Abierta: hasta hoy inclusive, nada del futuro.
    assert dias_de_ausencia([(date(2026, 9, 21), None)], date(2026, 9, 1), date(2026, 12, 31), hoy, lv) == (3, 3)
    # Pisadas: cada día una vez.
    assert dias_de_ausencia([(date(2026, 9, 21), None), (date(2026, 9, 21), date(2026, 9, 23))],
                            date(2026, 9, 1), date(2026, 9, 30), hoy, lv) == (3, 3)
    # Alguien que trabaja los sábados: el sábado es laborable para él.
    con_sabado = dias_trabajo_de("MON,TUE,WED,THU,FRI,SAT")
    assert dias_de_ausencia([(date(2026, 9, 14), date(2026, 9, 21))],
                            date(2026, 9, 1), date(2026, 9, 30), hoy, con_sabado) == (7, 6)
    # Un período al revés no cuenta nada.
    assert dias_de_ausencia([(date(2026, 9, 14), None)], date(2026, 9, 30), date(2026, 9, 1), hoy, lv) == (0, 0)
    # Sin días cargados, L a V.
    assert dias_trabajo_de(None) == {0, 1, 2, 3, 4}


# ─────────────────────── corregir y borrar ───────────────────────

async def test_ponerle_motivo_a_la_abierta(taller):
    await _marcar(taller, False)
    (a,) = await _ausencias(taller)
    r = await AusenciaService(taller).corregir(JUAN, a.id, {"motivo": "ENFERMEDAD", "observacion": "gripe"},
                                               usuario=LUCAS)
    assert r.data["motivo"] == "ENFERMEDAD" and r.data["abierta"] is True
    # Y sacárselo.
    r = await AusenciaService(taller).corregir(JUAN, a.id, {"motivo": None}, usuario=LUCAS)
    assert r.data["motivo"] is None and r.data["observacion"] == "gripe"


async def test_la_abierta_se_cierra_con_activo_no_con_una_fecha(taller):
    await _marcar(taller, False)
    (a,) = await _ausencias(taller)
    with pytest.raises(HTTPException) as e:
        await AusenciaService(taller).corregir(JUAN, a.id, {"hasta": _hoy().isoformat()}, usuario=LUCAS)
    assert e.value.status_code == 409 and "Activo" in e.value.detail["message"]
    # Pero se le puede correr el arranque para atrás (la marcaron tarde).
    ayer = (_hoy() - timedelta(days=1)).isoformat()
    r = await AusenciaService(taller).corregir(JUAN, a.id, {"desde": ayer}, usuario=LUCAS)
    assert r.data["desde"] == ayer and r.data["abierta"] is True
    # No para adelante.
    with pytest.raises(BusinessException):
        await AusenciaService(taller).corregir(
            JUAN, a.id, {"desde": (_hoy() + timedelta(days=2)).isoformat()}, usuario=LUCAS)


async def test_corregir_las_fechas_de_una_carga(taller):
    s = AusenciaService(taller)
    r = await s.cargar(JUAN, "2026-10-01", "2026-10-15", "VACACIONES", usuario=LUCAS)
    r = await s.corregir(JUAN, r.data["id"], {"hasta": "2026-10-10"}, usuario=LUCAS)
    assert (r.data["desde"], r.data["hasta"], r.data["dias"]) == ("2026-10-01", "2026-10-10", 10)
    # Contra sí misma no se pisa.
    r = await s.corregir(JUAN, r.data["id"], {"desde": "2026-09-30"}, usuario=LUCAS)
    assert r.data["dias"] == 11


async def test_borrar_una_carga_y_no_la_abierta(taller):
    s = AusenciaService(taller)
    r = await s.cargar(JUAN, "2026-09-10", usuario=LUCAS)
    await s.borrar(JUAN, r.data["id"], usuario=LUCAS)
    assert await _ausencias(taller) == []

    await _marcar(taller, False)
    (a,) = await _ausencias(taller)
    with pytest.raises(HTTPException) as e:
        await s.borrar(JUAN, a.id, usuario=LUCAS)
    assert e.value.status_code == 409


async def test_una_ausencia_de_otra_persona_no_se_toca(taller):
    taller.add(Operario(id=2, nombre="ANA", apellido="GIL", categoria="OFICIAL", disponible=True,
                        hora_inicio=time(7), hora_fin=time(16)))
    await taller.commit()
    r = await AusenciaService(taller).cargar(2, "2026-09-10", usuario=LUCAS)
    from backend.commons.exceptions.NotFoundException import NotFoundException
    with pytest.raises(NotFoundException):
        await AusenciaService(taller).borrar(JUAN, r.data["id"], usuario=LUCAS)


# ─────────────────────── borrar a la persona ───────────────────────

async def test_borrar_la_persona_avisa_que_se_lleva_sus_ausencias_y_se_las_lleva(taller):
    await AusenciaService(taller).cargar(JUAN, "2026-09-10", usuario=LUCAS)
    with pytest.raises(ConfirmacionRequeridaException) as e:
        await OperarioService(taller).eliminarOperario(JUAN)
    assert "1 ausencia registrada" in str(e.value)

    r = await OperarioService(taller).eliminarOperario(JUAN, forzar=True)
    assert r.status is True
    assert await _ausencias(taller) == []


# ─────────────────────── la API ───────────────────────

def _cliente(session, usuario=LUCAS, espia: dict | None = None) -> AsyncClient:
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(AsistenciaAPI.router)

    if espia is not None:
        @app.middleware("http")
        async def _espiar(request, call_next):
            respuesta = await call_next(request)
            espia["frase"] = (getattr(request.state, "auditoria", None) or {}).get("frase")
            return respuesta

    async def _db():
        yield session

    app.dependency_overrides[AsistenciaAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: usuario
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_la_api_carga_lista_corrige_y_borra(taller):
    visto = {}
    async with _cliente(taller, espia=visto) as c:
        r = await c.post(f"/operarios/{JUAN}/ausencias",
                         json={"desde": "2026-09-14", "hasta": "2026-09-18", "motivo": "VACACIONES"})
        assert r.status_code == 200, r.text
        id_a = r.json()["data"]["id"]
        assert visto["frase"] == "cargó una ausencia de JUAN PEREZ del 14/09/2026 al 18/09/2026 (vacaciones)"

        r = await c.get(f"/operarios/{JUAN}/ausencias?desde=2026-09-01&hasta=2026-09-30")
        datos = r.json()["data"]
        assert datos["resumen"]["dias"] == 5 and datos["resumen"]["dias_laborables"] == 5
        (fila,) = datos["ausencias"]
        assert fila["usuario_carga"] == "Lucas Gómez"
        # Sin zona: el front la lee como hora local, que es la del taller.
        assert "Z" not in fila["cargada_en"] and "+" not in fila["cargada_en"]

        r = await c.put(f"/operarios/{JUAN}/ausencias/{id_a}", json={"motivo": "LICENCIA"})
        assert r.status_code == 200 and r.json()["data"]["motivo_texto"] == "Licencia"

        r = await c.delete(f"/operarios/{JUAN}/ausencias/{id_a}")
        assert r.status_code == 200
        assert visto["frase"] == "borró la ausencia de JUAN PEREZ del 14/09/2026 al 18/09/2026 (licencia)"
        assert (await c.get(f"/operarios/{JUAN}/ausencias")).json()["data"]["ausencias"] == []


async def test_la_api_contesta_en_castellano(taller):
    async with _cliente(taller) as c:
        r = await c.post(f"/operarios/{JUAN}/ausencias", json={"desde": "2026-09-14", "motivo": "NADA"})
        assert r.status_code == 422
        r = await c.post(f"/operarios/{JUAN}/ausencias", json={"desde": "2026-09-14"})
        r = await c.post(f"/operarios/{JUAN}/ausencias", json={"desde": "2026-09-14"})
        assert r.status_code == 409
        assert r.json()["errors"][0]["message"].startswith("Ya tiene cargada una ausencia el 14/09/2026")
        r = await c.get("/operarios/999/ausencias")
        assert r.status_code == 404
