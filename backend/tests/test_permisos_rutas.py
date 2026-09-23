"""
RF-24: los permisos colgados en TODA la API (core/permisos_rutas.py + main.py).

Lo que se prueba:

1. Que ninguna ruta quede sin política (una pantalla nueva sin su línea en el mapa
   pone esto en rojo), y que las excepciones del mapa apunten a rutas que existen.
2. La matriz rol × router × método -> status, escrita a mano: el admin pasa todo, el
   operario sin el área recibe 403 al escribir, los catálogos se leen libres.
3. Un barrido de TODAS las rutas: el admin pasa todas; el operario no escribe en
   ninguna (salvo su campanita); una cuenta desactivada no pasa por ninguna.
4. Las pantallas: alguien con SOLO el área de una pantalla puede leer todo lo que esa
   pantalla pide (el relevamiento del 22/09, abajo).
5. Los permisos de más: vencido no abre, vigente sí.
6. El admin de producción (rol='admin', sin ninguna fila en las tablas nuevas, y aun
   sin las tablas) sigue pudiendo todo.

CÓMO, SIN TOCAR NINGUNA BASE REAL

Se arma un ESPEJO de la app: la tabla de rutas de main.app, ruta por ruta, con las
MISMAS dependencias colgadas (las del router, que son la sesión y la política, y las
del endpoint, como el require_admin de algunos borrados), pero con un cuerpo que
contesta {"ok": true} sin leer nada. Lo que pasa los permisos recibe 200; lo que no,
el 401/403 de verdad. Los permisos se leen de una SQLite en memoria.
"""
from datetime import timedelta

import pytest_asyncio
from fastapi import FastAPI
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, insert, update

from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.permisos import NIVEL_RANK
from backend.core.permisos_rutas import POLITICAS, sin_politica
from backend.core.security import get_sesiones_permisos
from backend.domain.Permisos import (
    AreaPermiso,
    Rol,
    RolArea,
    RolSeccion,
    SeccionPermiso,
    UsuarioArea,
    UsuarioSeccion,
)
from backend.domain.Usuario import Usuario
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.presentation.main import app
from backend.tests.test_permisos_api import (
    ANA,
    JULIAN,
    MATIAS,
    SOFIA,
    _base,
    _token,
)

# ─────────────────────────── el espejo ───────────────────────────


def _rutas_de_la_app() -> list[APIRoute]:
    return [r for r in app.routes if isinstance(r, APIRoute)]


def _politica_de(ruta: APIRoute) -> str | None:
    """El nombre del router en el mapa, según la dependencia colgada."""
    for d in ruta.dependant.dependencies:
        nombre = getattr(d.call, "__name__", "")
        if nombre.startswith("require_politica_"):
            return nombre[len("require_politica_"):]
    return None


def _exenta(path: str) -> bool:
    return sin_politica(path) is not None


def _espejo(Sesion) -> FastAPI:
    espejo = FastAPI()
    registrar_exception_handlers(espejo)
    for r in _rutas_de_la_app():
        async def _ok():
            return {"ok": True}
        espejo.add_api_route(r.path, _ok, methods=sorted(r.methods),
                             dependencies=list(r.dependencies), name=r.name)
    espejo.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    return espejo


@pytest_asyncio.fixture
async def espejo():
    engine, Sesion = await _base()
    async with AsyncClient(transport=ASGITransport(app=_espejo(Sesion)),
                           base_url="http://test") as c:
        c.sesiones = Sesion
        yield c
    await engine.dispose()


async def _pedir(c, metodo: str, ruta: str, quien: int, rol: str):
    return await c.request(metodo, ruta, headers=_token(quien, rol))


async def _ejecutar(c, *sentencias):
    async with c.sesiones() as s:
        for sentencia in sentencias:
            await s.execute(sentencia)
        await s.commit()


def _concreta(path: str) -> str:
    import re
    return re.sub(r"\{[^}]+\}", "1", path)


# ─────────────────────────── 1. cobertura del mapa ───────────────────────────


def test_toda_ruta_tiene_su_politica_o_un_porque():
    """Una ruta que no pasa por el mapa ni está en SIN_POLITICA con su porqué es una
    ruta que cualquiera con sesión puede usar sin que nadie lo haya decidido."""
    huerfanas = [f"{sorted(r.methods)} {r.path}" for r in _rutas_de_la_app()
                 if _politica_de(r) is None and not _exenta(r.path)]
    assert not huerfanas, f"rutas sin política en core/permisos_rutas.py: {huerfanas}"


def test_las_rutas_exentas_no_tienen_politica_y_las_otras_una_sola():
    for r in _rutas_de_la_app():
        politicas = [d for d in r.dependant.dependencies
                     if getattr(d.call, "__name__", "").startswith("require_politica_")]
        if _exenta(r.path):
            assert not politicas, r.path
        else:
            assert len(politicas) == 1, r.path


def test_cada_politica_del_mapa_la_usa_algun_router():
    usadas = {_politica_de(r) for r in _rutas_de_la_app()}
    assert set(POLITICAS) <= usadas, set(POLITICAS) - usadas


def test_las_excepciones_apuntan_a_rutas_de_su_router():
    """Si alguien renombra /planificacion/borradores, la excepción quedaría apuntando a
    la nada y los borradores volverían a leerse con el permiso del plan."""
    for nombre, politica in POLITICAS.items():
        for e in politica.excepciones:
            dueñas = [r for r in _rutas_de_la_app()
                      if r.path == e.ruta and (e.metodo == "*" or e.metodo in r.methods)]
            assert dueñas, f"{nombre}: {e.metodo} {e.ruta} no existe"
            assert all(_politica_de(r) == nombre for r in dueñas), (nombre, e.ruta)


def test_las_rutas_de_administracion_piden_lo_suyo():
    """/auth/usuarios* y /permisos/* no van por el mapa: cada endpoint pide lo suyo. Que
    ninguno quede con sólo la sesión."""
    for r in _rutas_de_la_app():
        if not (r.path.startswith("/auth/usuarios") or r.path.startswith("/permisos/")):
            continue
        if r.path == "/permisos/catalogo":
            continue  # los nombres de las pantallas: cualquiera con cuenta activa
        nombres = {getattr(d.call, "__name__", "") for d in r.dependant.dependencies}
        pide = nombres & {"require_admin", "require_gestion_de_usuarios", "_admin", "_ver_un_usuario",
                          "require_seccion_configuracion_usuarios_read"}
        assert pide, f"{sorted(r.methods)} {r.path} sólo pide sesión"


# ─────────────────────────── 2. la matriz rol × router × método ───────────────────────────
#
# Con la matriz sembrada (core/permisos.py, MATRIZ_ROL_AREA):
#                     supervisor  operario
#   dashboard         read        read
#   operaciones       write       read   (el operario, sin el planificador)
#   planos            write       read
#   recursos          read        none
#   clientes          read        none
#   no_conformidades  write       read
#   auditoria         none        none
#   configuracion     read        read

OK, NO = 200, 403

MATRIZ = [
    # método, ruta,                                        admin, supervisor, operario
    # catálogos: leer libre, escribir pide Recursos (o su solapa)
    ("GET", "/articulos", OK, OK, OK),
    ("POST", "/articulos", OK, NO, NO),
    ("DELETE", "/articulos/1", OK, NO, NO),  # además, require_admin del endpoint
    ("GET", "/procesos", OK, OK, OK),
    ("GET", "/procesos/quien-puede", OK, OK, OK),
    ("PUT", "/procesos/1", OK, NO, NO),
    ("GET", "/operarios", OK, OK, OK),
    ("POST", "/operarios", OK, NO, NO),
    ("PUT", "/operarios/1/skills-nativas/2/estado", OK, NO, NO),
    ("GET", "/maquinarias", OK, OK, OK),
    ("DELETE", "/maquinarias/1", OK, NO, NO),
    ("GET", "/rangos/cobertura", OK, OK, OK),
    ("PUT", "/rangos/1/procesos", OK, NO, NO),
    ("PUT", "/maquinarias/1/rangos", OK, NO, NO),
    ("GET", "/sectores", OK, OK, OK),
    ("POST", "/sectores", OK, NO, NO),
    ("GET", "/prioridades", OK, OK, OK),
    ("PUT", "/prioridades/1", OK, NO, NO),
    ("GET", "/clientes", OK, OK, OK),
    ("POST", "/clientes", OK, NO, NO),
    ("GET", "/piezas", OK, OK, OK),
    ("PUT", "/piezas/1/stock-minimo", OK, OK, NO),
    ("DELETE", "/piezas/1", OK, NO, NO),  # require_admin del endpoint
    ("GET", "/config/availability", OK, OK, OK),
    ("POST", "/config/availability", OK, OK, NO),
    # operaciones
    ("GET", "/ordenes", OK, OK, OK),
    ("GET", "/ordenes-resumen", OK, OK, OK),
    ("POST", "/ordenes", OK, OK, NO),
    ("PUT", "/ordenes/1/procesos/2/estado", OK, OK, NO),
    ("DELETE", "/ordenes/1", OK, OK, NO),
    ("GET", "/ordenes-trabajo-piezas", OK, OK, OK),
    ("POST", "/ordenes-trabajo-piezas", OK, OK, NO),
    ("DELETE", "/ordenes-trabajo-piezas/1", OK, NO, NO),  # require_admin del endpoint
    ("GET", "/consumos-material", OK, OK, OK),
    ("POST", "/consumos-material", OK, OK, NO),
    ("PUT", "/consumos-material/1/anular", OK, OK, NO),
    # el plan y el planificador
    ("GET", "/planificacion", OK, OK, OK),
    ("POST", "/planificar", OK, OK, NO),
    ("GET", "/planificacion/borradores", OK, OK, NO),
    ("GET", "/planificacion/borradores/1", OK, OK, NO),
    ("POST", "/planificacion/borradores", OK, OK, NO),
    ("DELETE", "/planificacion/lote/abc", OK, OK, NO),
    ("GET", "/auditoria/planificacion", OK, NO, NO),
    # planos
    ("GET", "/planos/orden/1", OK, OK, OK),
    ("GET", "/planos/biblioteca", OK, OK, OK),
    ("POST", "/planos", OK, OK, NO),
    ("DELETE", "/planos/1", OK, OK, NO),
    # no conformidades
    ("GET", "/incidencias", OK, OK, OK),
    ("GET", "/ordenes/1/incidencias", OK, OK, OK),
    ("POST", "/incidencias", OK, OK, NO),
    ("PUT", "/incidencias/1/cerrar", OK, OK, NO),
    # dashboard: cada tarjeta pide su área (RF-28); el operario no tiene Clientes
    ("GET", "/api/dashboard/estadisticas", OK, OK, OK),
    ("GET", "/api/dashboard/ordenes-por-estado/pendiente", OK, OK, OK),
    ("GET", "/api/dashboard/clientes-mayor-volumen", OK, OK, NO),
    ("GET", "/api/dashboard/tiempo-promedio", OK, OK, OK),
    ("GET", "/incidencias/metricas", OK, OK, OK),
    ("GET", "/api/dashboard/rendimiento-operarios", OK, NO, NO),
    ("GET", "/api/dashboard/rendimiento-procesos", OK, NO, NO),
    # auditoría
    ("GET", "/auditoria/movimientos", OK, NO, NO),
    ("GET", "/auditoria/movimientos/de/orden/1", OK, NO, NO),
    ("GET", "/auditoria/procesos", OK, NO, NO),
    ("GET", "/auditoria/procesos?id_orden=5", OK, OK, OK),  # el historial de UNA OT
    ("GET", "/auditoria/procesos?id_orden=", OK, NO, NO),
    # la campanita: leerla y marcarla, todos; crear, quien edita personas; borrar, el
    # admin (revisión del 23/09: el operario vaciaba la de todo el taller)
    ("GET", "/notificaciones", OK, OK, OK),
    ("GET", "/notificaciones/contador/no-leidas", OK, OK, OK),
    ("PUT", "/notificaciones/leer-todas", OK, OK, OK),
    ("PUT", "/notificaciones/1/leida", OK, OK, OK),
    ("POST", "/notificaciones", OK, NO, NO),
    ("DELETE", "/notificaciones/1", OK, NO, NO),
    ("DELETE", "/notificaciones", OK, NO, NO),
]


async def test_matriz_rol_router_metodo(espejo):
    """Un solo test que recorre la tabla entera y dice TODAS las casillas que no dan,
    no sólo la primera (y arma la base una vez: cada una cuesta cinco bcrypt)."""
    mal = []
    for metodo, ruta, admin, supervisor, operario in MATRIZ:
        for quien, rol, esperado in ((JULIAN, "admin", admin), (SOFIA, "supervisor", supervisor),
                                     (MATIAS, "operario", operario)):
            r = await _pedir(espejo, metodo, ruta, quien, rol)
            if r.status_code != esperado:
                mal.append(f"{rol}: {metodo} {ruta} -> {r.status_code} (esperaba {esperado})")
            elif esperado == NO and r.json()["errors"][0]["campo"] not in ("permiso", "global"):
                mal.append(f"{rol}: {metodo} {ruta} -> 403 sin el formato de siempre")
    assert not mal, "\n".join(mal)


def test_la_matriz_cubre_todos_los_routers_del_mapa():
    """Que la tabla de arriba no se quede atrás cuando se agregue un router."""
    cubiertos = set()
    for metodo, ruta, *_ in MATRIZ:
        camino = ruta.split("?")[0]
        for r in _rutas_de_la_app():
            if metodo in r.methods and r.path_regex.match(camino):
                cubiertos.add(_politica_de(r))
                break
    assert set(POLITICAS) <= cubiertos, set(POLITICAS) - cubiertos


async def test_el_mensaje_dice_que_falta(espejo):
    r = await _pedir(espejo, "POST", "/clientes", MATIAS, "operario")
    assert r.json()["errors"][0]["message"] == "No tenés permiso para modificar «Clientes»."
    r = await _pedir(espejo, "PUT", "/operarios/1", SOFIA, "supervisor")
    assert r.json()["errors"][0]["message"] == \
        "No tenés permiso para modificar «Recurso humano» (Recursos)."
    r = await _pedir(espejo, "GET", "/api/dashboard/rendimiento-operarios", SOFIA, "supervisor")
    assert "«Rendimiento por persona» (Dashboard)" in r.json()["errors"][0]["message"]


async def test_la_seccion_restringida_del_rol_vale_tambien_para_escribir(espejo):
    """El supervisor tiene Recursos en «ver». Si se le da «editar» en el área pero la
    solapa Rangos se le restringe a «ver», no edita rangos y sí personas."""
    await _ejecutar(
        espejo,
        update(RolArea).where(RolArea.rol_codigo == "supervisor", RolArea.area_codigo == "recursos")
        .values(nivel="write"),
        insert(RolSeccion).values(rol_codigo="supervisor", seccion_codigo="recursos_rangos", nivel="read"),
    )
    assert (await _pedir(espejo, "PUT", "/rangos/1/procesos", SOFIA, "supervisor")).status_code == NO
    assert (await _pedir(espejo, "PUT", "/operarios/1", SOFIA, "supervisor")).status_code == OK
    assert (await _pedir(espejo, "GET", "/rangos", SOFIA, "supervisor")).status_code == OK


# ─────────────────────────── 3. el barrido de todas las rutas ───────────────────────────


def _rutas_con_politica():
    for r in _rutas_de_la_app():
        nombre = _politica_de(r)
        if nombre is None:
            continue
        for metodo in sorted(r.methods):
            yield nombre, metodo, r.path


async def test_el_admin_pasa_por_todas_las_rutas(espejo):
    for _, metodo, path in _rutas_con_politica():
        r = await _pedir(espejo, metodo, _concreta(path), JULIAN, "admin")
        assert r.status_code == OK, f"{metodo} {path}: {r.status_code} {r.text}"


async def test_el_operario_no_escribe_en_ninguna_salvo_su_campanita(espejo):
    """El operario tiene «ver» (o nada) en todas las áreas: toda escritura le da 403,
    menos marcar los avisos como leídos. Crear o borrar avisos, tampoco."""
    for nombre, metodo, path in _rutas_con_politica():
        if metodo in ("GET", "HEAD", "OPTIONS"):
            continue
        r = await _pedir(espejo, metodo, _concreta(path), MATIAS, "operario")
        esperado = OK if nombre == "notificaciones" and metodo == "PUT" else NO
        assert r.status_code == esperado, f"{metodo} {path}: {r.status_code}"


async def test_los_catalogos_los_lee_cualquiera_con_cuenta_activa(espejo):
    libres = {n for n, p in POLITICAS.items() if not p.leer}
    for nombre, metodo, path in _rutas_con_politica():
        if nombre in libres and metodo == "GET":
            politica = POLITICAS[nombre]
            if politica.requisitos("GET", path):  # una excepción que pide algo
                continue
            r = await _pedir(espejo, metodo, _concreta(path), MATIAS, "operario")
            assert r.status_code == OK, f"{metodo} {path}"


async def test_una_cuenta_desactivada_no_pasa_por_ninguna(espejo):
    for _, metodo, path in _rutas_con_politica():
        r = await _pedir(espejo, metodo, _concreta(path), ANA, "operario")
        assert r.status_code == 401, f"{metodo} {path}"


async def test_sin_token_no_pasa_por_ninguna(espejo):
    for _, metodo, path in _rutas_con_politica():
        r = await espejo.request(metodo, _concreta(path))
        assert r.status_code in (401, 403), f"{metodo} {path}"


# ─────────────────────────── 4. las pantallas ───────────────────────────
#
# Lo que LEE cada pantalla, del grep de fetch/API_URL en frontend/src del 22/09 y de
# qué página monta cada componente (ver core/permisos_rutas.py). Alguien con SOLO esa
# área en «ver» tiene que poder pedir todo esto. Si una pantalla empieza a leer algo
# nuevo, va acá: si el test se pone rojo, es que esa persona iba a ver la pantalla rota.

PANTALLAS = {
    # Desde RF-28 el Dashboard no pide nada propio: cada tarjeta es de un área y la
    # pantalla sólo pide las de las áreas que la persona puede leer (TARJETAS_DASHBOARD).
    # Con SOLO el área Dashboard no se ve ninguna tarjeta, así que no se pide nada. Lo que
    # lee cada tarjeta se prueba aparte (test_cada_tarjeta_del_dashboard_pide_su_area).
    "dashboard": [],
    "operaciones": [
        # las OT, su ficha y el alta
        "/ordenes", "/ordenes/1", "/ordenes-resumen", "/ordenes/historial-procesos",
        "/ordenes/1/procesos/versiones", "/ordenes-trabajo-piezas", "/consumos-material",
        "/planos/orden/1", "/planos/articulo/1", "/planos/1", "/planos/1/archivo",
        "/ordenes/1/incidencias", "/auditoria/procesos?id_orden=1",
        # el plan, el Gantt y el planificador
        "/planificacion", "/planificacion/borradores", "/planificacion/borradores/1",
        "/config/availability", "/planos/ordenes-con-plano", "/planos/ordenes-con-plano-disponible",
        # los catálogos que eligen algo
        "/procesos", "/procesos/quien-puede", "/operarios", "/operarios/1", "/maquinarias",
        "/rangos", "/rangos/procesos", "/rangos/maquinarias", "/rangos/cobertura",
        "/articulos", "/clientes", "/sectores", "/prioridades", "/piezas",
    ],
    "planos": ["/planos/biblioteca", "/planos/1", "/planos/1/archivo", "/articulos"],
    "recursos": [
        "/operarios", "/operarios/1", "/maquinarias", "/procesos", "/rangos",
        "/rangos/1/detalle", "/rangos/procesos", "/rangos/maquinarias", "/rangos/cobertura",
        "/sectores", "/prioridades",
        "/planificacion",  # lo que tiene asignado cada persona
        # (la solapa Planos va por el área Planos, igual que la pantalla)
    ],
    "clientes": ["/clientes", "/clientes/1"],
    "no_conformidades": [
        "/incidencias", "/incidencias/tipos", "/incidencias/metricas",
        "/incidencias/reporte", "/incidencias/reporte.csv",
    ],
    "auditoria": ["/auditoria/movimientos", "/auditoria/procesos", "/auditoria/planificacion"],
    # Configuración: «Mi cuenta» y la campanita. La lista de usuarios es una sección
    # confidencial y se prueba aparte (test_permisos_admin_api).
    "configuracion": ["/notificaciones", "/notificaciones/contador/no-leidas"],
}


async def test_quien_ve_una_pantalla_puede_leer_todo_lo_que_esa_pantalla_pide(espejo):
    id_ = 100
    async with espejo.sesiones() as s:
        for area in PANTALLAS:
            s.add(Rol(codigo=f"solo_{area}"[:20], nombre=f"Sólo {area}"))
        await s.flush()
        for area in PANTALLAS:
            s.add(RolArea(rol_codigo=f"solo_{area}"[:20], area_codigo=area, nivel="read"))
            s.add(Usuario(id_usuario=id_, username=f"solo{area}", email=f"{area}@x.com",
                          password_hash="x", nombre="Sólo", apellido=area,
                          rol=f"solo_{area}"[:20], activo=True))
            id_ += 1
        await s.commit()

    rotas = []
    id_ = 100
    for area, rutas in PANTALLAS.items():
        from backend.core.security import create_access_token
        tok = create_access_token({"sub": f"solo{area}", "id_usuario": id_})
        for ruta in rutas:
            r = await espejo.get(ruta, headers={"Authorization": f"Bearer {tok}"})
            if r.status_code != OK:
                rotas.append(f"{area}: GET {ruta} -> {r.status_code}")
        id_ += 1
    assert not rotas, "pantallas que se verían rotas:\n" + "\n".join(rotas)


async def test_cada_tarjeta_del_dashboard_pide_su_area(espejo):
    """RF-28: cada tarjeta del Dashboard es de un área. Con el Dashboard y el área de la
    tarjeta se lee todo lo que la tarjeta pide (también lo que abre al tocarla); con el
    Dashboard y SIN esa área, nada de eso: la pantalla la esconde y la API no la da."""
    from backend.core.permisos_rutas import TARJETAS_DASHBOARD

    async with espejo.sesiones() as s:
        s.add(Rol(codigo="solo_tablero", nombre="Sólo el tablero"))
        await s.flush()
        s.add(RolArea(rol_codigo="solo_tablero", area_codigo="dashboard", nivel="read"))
        s.add(Usuario(id_usuario=300, username="tablero", email="tablero@x.com",
                      password_hash="x", nombre="Sólo", apellido="Tablero",
                      rol="solo_tablero", activo=True))
        await s.commit()
    from backend.core.security import create_access_token
    tok = {"Authorization": "Bearer " + create_access_token({"sub": "tablero", "id_usuario": 300})}

    mal = []
    for t in TARJETAS_DASHBOARD:
        rutas = [_concreta(r) for _, r in t.rutas]
        # Sin el área de la tarjeta: 403 en todas.
        for ruta in rutas:
            r = await espejo.get(ruta, headers=tok)
            if r.status_code != NO:
                mal.append(f"sin {t.codigo}: GET {ruta} -> {r.status_code}")
        # Con ella (por rol o por sección): 200 en todas.
        req = t.requisito
        if req.area:
            await _ejecutar(espejo, insert(RolArea).values(
                rol_codigo="solo_tablero", area_codigo=req.area, nivel="read"))
        else:
            await _ejecutar(espejo, insert(RolSeccion).values(
                rol_codigo="solo_tablero", seccion_codigo=req.seccion, nivel="read"))
        for ruta in rutas:
            r = await espejo.get(ruta, headers=tok)
            if r.status_code != OK:
                mal.append(f"con {t.codigo}: GET {ruta} -> {r.status_code}")
        await _ejecutar(
            espejo,
            delete(RolArea).where(RolArea.rol_codigo == "solo_tablero",
                                  RolArea.area_codigo != "dashboard"),
            delete(RolSeccion).where(RolSeccion.rol_codigo == "solo_tablero"),
        )
    assert not mal, "\n".join(mal)


def test_toda_ruta_del_dashboard_es_de_una_tarjeta_o_dice_por_que_no():
    """Una ruta nueva del Dashboard sin su tarjeta caería en el área Dashboard sola, y la
    vería alguien que no puede leer lo que resume."""
    from backend.core.permisos_rutas import TARJETAS_DASHBOARD

    de_tarjetas = {r for t in TARJETAS_DASHBOARD for _, r in t.rutas}
    excepciones = {e.ruta for e in POLITICAS["dashboard"].excepciones}
    for r in _rutas_de_la_app():
        if _politica_de(r) == "dashboard":
            assert r.path in excepciones, f"{r.path}: ¿de qué tarjeta es?"
    # Y toda ruta de una tarjeta existe y es del router que dice.
    for t in TARJETAS_DASHBOARD:
        for router, ruta in t.rutas:
            dueñas = [x for x in _rutas_de_la_app() if x.path == ruta and "GET" in x.methods]
            assert dueñas and all(_politica_de(x) == router for x in dueñas), (t.codigo, ruta)
    assert de_tarjetas <= excepciones | {e.ruta for e in POLITICAS["incidencias"].excepciones}


async def test_sin_ninguna_area_solo_se_leen_catalogos_y_la_campanita(espejo):
    """Un rol recién creado arranca sin nada (mínimo privilegio, como DJ): no ve OT, ni
    plan, ni planos, ni no conformidades, ni dashboard, ni la cartera de clientes."""
    await _ejecutar(espejo, insert(Rol).values(codigo="nuevo", nombre="Nuevo"),
                    update(Usuario).where(Usuario.id_usuario == MATIAS).values(rol="nuevo"))
    for ruta, esperado in (("/ordenes", NO), ("/planificacion", NO), ("/planos/1", NO),
                           ("/incidencias", NO), ("/api/dashboard/estadisticas", NO),
                           ("/clientes", NO), ("/procesos", OK), ("/maquinarias", OK),
                           ("/notificaciones", OK)):
        r = await _pedir(espejo, "GET", ruta, MATIAS, "nuevo")
        assert r.status_code == esperado, ruta


# ─────────────────────────── 5. permisos de más ───────────────────────────


async def test_un_permiso_de_mas_vencido_no_abre_y_uno_vigente_si(espejo):
    ahora = ahora_ar()
    assert (await _pedir(espejo, "POST", "/clientes", MATIAS, "operario")).status_code == NO
    await _ejecutar(espejo, insert(UsuarioArea).values(
        id_usuario=MATIAS, area_codigo="clientes", nivel="write",
        vence_en=ahora - timedelta(minutes=1), otorgado_por=JULIAN, motivo="la semana pasada",
        creado_en=ahora - timedelta(days=7)))
    assert (await _pedir(espejo, "POST", "/clientes", MATIAS, "operario")).status_code == NO
    await _ejecutar(espejo, update(UsuarioArea).values(vence_en=ahora + timedelta(hours=1)))
    assert (await _pedir(espejo, "POST", "/clientes", MATIAS, "operario")).status_code == OK
    # Suma: no le saca nada de lo que ya tenía.
    assert (await _pedir(espejo, "GET", "/ordenes", MATIAS, "operario")).status_code == OK

    # Una sección confidencial, a él solo.
    ruta = "/api/dashboard/rendimiento-operarios"
    assert (await _pedir(espejo, "GET", ruta, MATIAS, "operario")).status_code == NO
    await _ejecutar(espejo, insert(UsuarioSeccion).values(
        id_usuario=MATIAS, seccion_codigo="dashboard_rendimiento", nivel="read",
        vence_en=ahora - timedelta(seconds=1), creado_en=ahora))
    assert (await _pedir(espejo, "GET", ruta, MATIAS, "operario")).status_code == NO
    await _ejecutar(espejo, update(UsuarioSeccion).values(vence_en=None))
    assert (await _pedir(espejo, "GET", ruta, MATIAS, "operario")).status_code == OK
    assert (await _pedir(espejo, "GET", ruta, SOFIA, "supervisor")).status_code == NO


async def test_el_planificador_se_abre_al_operario_con_un_permiso_de_mas(espejo):
    """El rol le cierra el planificador; a UNA persona se le puede abrir."""
    assert (await _pedir(espejo, "POST", "/planificar", MATIAS, "operario")).status_code == NO
    await _ejecutar(espejo, insert(UsuarioSeccion).values(
        id_usuario=MATIAS, seccion_codigo="operaciones_planificador", nivel="write",
        creado_en=ahora_ar()))
    assert (await _pedir(espejo, "POST", "/planificar", MATIAS, "operario")).status_code == OK
    # Pero no el resto de Operaciones: editar una OT sigue cerrado.
    assert (await _pedir(espejo, "POST", "/ordenes", MATIAS, "operario")).status_code == NO


# ─────────────────────────── 6. el admin de producción ───────────────────────────


async def _todas_para_el_admin(Sesion):
    async with AsyncClient(transport=ASGITransport(app=_espejo(Sesion)),
                           base_url="http://test") as c:
        for _, metodo, path in _rutas_con_politica():
            r = await _pedir(c, metodo, _concreta(path), JULIAN, "admin")
            assert r.status_code == OK, f"{metodo} {path}: {r.status_code} {r.text}"


async def test_el_admin_de_hoy_sin_las_tablas_nuevas_sigue_pudiendo_todo():
    """Backend nuevo contra la base de hoy (la migración todavía no corrió)."""
    engine, Sesion = await _base(con_permisos=False, con_admin_permanente=False)
    try:
        await _todas_para_el_admin(Sesion)
    finally:
        await engine.dispose()


async def test_el_admin_de_hoy_sin_ninguna_fila_de_permisos_sigue_pudiendo_todo():
    """Las tablas están pero vacías: ni rol, ni matriz, ni catálogo. El admin es admin
    por regla, no por su fila."""
    engine, Sesion = await _base()
    try:
        async with Sesion() as s:
            for modelo in (UsuarioSeccion, UsuarioArea, RolSeccion, RolArea, Rol,
                           SeccionPermiso, AreaPermiso):
                await s.execute(delete(modelo))
            await s.commit()
        await _todas_para_el_admin(Sesion)
    finally:
        await engine.dispose()


def test_ningun_requisito_del_mapa_pide_mas_que_admin():
    """Que nadie escriba un nivel inventado en el mapa: el admin tiene «admin», el
    máximo, y con eso pasa todo por construcción."""
    for politica in POLITICAS.values():
        todos = list(politica.leer) + list(politica.escribir)
        for e in politica.excepciones:
            todos += list(e.pide)
        assert all(NIVEL_RANK[r.nivel] <= NIVEL_RANK["admin"] for r in todos)


# ─────────────────────────── 7. lo que un servicio decide por el rol ───────────────────────────


async def test_anular_el_consumo_de_otro_mira_el_rol_de_la_base_no_el_del_token():
    """ConsumoMaterialService deja anular lo de otro sólo a un admin, mirando
    usuario["rol"]. Ese dict tiene que traer el rol de la BASE: un token de 30 días que
    dice admin, de alguien que ya no lo es, no alcanza."""
    from fastapi import Depends
    from backend.core.security import get_usuario_verificado

    [anular] = [r for r in _rutas_de_la_app()
                if r.path == "/consumos-material/{id_consumo}/anular"]
    assert get_usuario_verificado in {d.call for d in anular.dependant.dependencies}

    engine, Sesion = await _base()
    j = FastAPI()
    registrar_exception_handlers(j)

    @j.get("/quien")
    async def quien(u: dict = Depends(get_usuario_verificado)):
        return u

    j.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    try:
        async with AsyncClient(transport=ASGITransport(app=j), base_url="http://test") as c:
            r = await c.get("/quien", headers=_token(MATIAS, "admin"))
            assert r.status_code == 200 and r.json()["rol"] == "operario"
            r = await c.get("/quien", headers=_token(JULIAN, "operario"))
            assert r.json()["rol"] == "admin"
            assert (await c.get("/quien", headers=_token(ANA, "admin"))).status_code == 401
    finally:
        await engine.dispose()
