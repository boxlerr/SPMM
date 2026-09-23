"""RF-24: la pantalla «Usuarios y permisos» (frontend/src/lib/permisosAdmin.ts y
frontend/src/components/usuarios/area-meta.ts), contra el backend.

La pantalla pinta cada cambio ANTES de que conteste el servidor (y lo revierte si
falla), y no ofrece lo que el servidor va a rechazar. Para eso tiene su propia copia de
unas pocas reglas de PermisosAPI y de core/permisos.py. Si esa copia se separa del
backend, la pantalla miente: muestra que un rol ve algo que no ve, u ofrece un nivel que
vuelve con un 409.

Se compila de verdad (con el tsc del repo) y se corre en node, como
test_permisos_front.py. Lo que se exige:

1. area-meta: todas las áreas, ni una más, y cada solapa nombrada en las pantallas de su
   área (la ayuda y la matriz dicen «qué controla cada área» con esto).
2. Lo que termina viendo un rol en cada sección: igual a la regla del backend en TODAS
   las combinaciones, y la matriz real del backend leída y cambiada en la pantalla da lo
   mismo que el backend después de los mismos cambios.
3. Lo que se ofrece: cada nivel ofrecido lo acepta el backend, con sus mismos topes.
4. Vencimientos sin zona, errores y «falta actualizar el servidor».
5. RF-28: por dónde entra cada rol y cada persona. Los permisos de una persona armados en
   la pantalla (rol + permisos de más) son los del backend, y lo que la lista dice que
   pasa al entrar es lo que pasa de verdad con lo que mandan el login y /auth/me.
"""
import json
import shutil
import subprocess
import tempfile
from datetime import datetime
from itertools import product
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from backend.core.permisos import (
    AREAS,
    MATRIZ_ROL_AREA,
    MATRIZ_ROL_SECCION,
    NIVELES,
    SECCIONES,
    DatosDePermisos,
    _nivel_de_seccion,
    rango,
    resolver_permisos,
)
from backend.core.security import get_sesiones_permisos
from backend.dto.PermisosRequestDTO import PermisoDePersonaDTO
from backend.presentation import AuthAPI, PermisosAPI
from backend.presentation.main import app
from backend.tests.test_permisos_api import ANA, JULIAN, LUCAS, MATIAS, SOFIA, _base, _token

RAIZ = Path(__file__).resolve().parents[2]
SRC = RAIZ / "frontend" / "src"
TSC = RAIZ / "frontend" / "node_modules" / ".bin" / "tsc"
ARCHIVOS = [
    SRC / "lib" / "permisos.ts",
    SRC / "lib" / "permisosAdmin.ts",
    SRC / "components" / "usuarios" / "area-meta.ts",
]

# Llama funciones de los módulos compilados. Cada llamada: {m, fn, args} o {m, valor}.
# Una fecha viaja como {"__fecha__": "YYYY-MM-DDTHH:MM:SS"} y se arma en hora local.
DRIVER = r"""
const fs = require('fs');
const mods = {
  permisos: require('./lib/permisos.js'),
  admin: require('./lib/permisosAdmin.js'),
  meta: require('./components/usuarios/area-meta.js'),
};
function arg(x) {
  if (x && typeof x === 'object' && !Array.isArray(x) && typeof x.__fecha__ === 'string') {
    const [d, t] = x.__fecha__.split('T');
    const [a, m, dd] = d.split('-').map(Number);
    const [h, mi, s] = t.split(':').map(Number);
    return new Date(a, m - 1, dd, h, mi, s || 0);
  }
  return x;
}
function llamar(ll) {
  const mod = mods[ll.m];
  if (ll.valor) return mod[ll.valor];
  if (ll.cadena) {
    // Encadena: el resultado de cada paso es el primer argumento del siguiente.
    let v = mod[ll.cadena[0].fn](...ll.cadena[0].args.map(arg));
    for (const paso of ll.cadena.slice(1)) v = mod[paso.fn](v, ...paso.args.map(arg));
    return v;
  }
  const r = mod[ll.fn](...(ll.args || []).map(arg));
  return r === undefined ? null : r;
}
const entrada = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify(entrada.map(llamar)));
"""


def _hay_node() -> bool:
    return bool(shutil.which("node")) and TSC.exists()


@pytest.fixture(scope="module")
def correr():
    """Devuelve correr([llamadas]) -> [resultados], contra los .ts compilados."""
    if not _hay_node():
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    tmp = tempfile.TemporaryDirectory()
    compilado = subprocess.run(
        [str(TSC), *map(str, ARCHIVOS),
         "--outDir", tmp.name, "--rootDir", str(SRC),
         "--target", "es2020", "--module", "commonjs",
         "--moduleResolution", "node", "--skipLibCheck", "--strict"],
        capture_output=True, text=True, timeout=180,
    )
    assert compilado.returncode == 0, (
        "permisosAdmin.ts / area-meta.ts no compilan solos (no pueden importar `@/`):\n"
        f"{compilado.stdout}\n{compilado.stderr}")
    (Path(tmp.name) / "driver.js").write_text(DRIVER)

    def _correr(llamadas: list) -> list:
        entrada = Path(tmp.name) / "entrada.json"
        entrada.write_text(json.dumps(llamadas))
        salida = subprocess.run(
            ["node", "driver.js", str(entrada)],
            cwd=tmp.name, capture_output=True, text=True, timeout=120,
        )
        assert salida.returncode == 0, salida.stderr
        return json.loads(salida.stdout)

    yield _correr
    tmp.cleanup()


def _uno(correr, m, fn, *args):
    return correr([{"m": m, "fn": fn, "args": list(args)}])[0]


def _valor(correr, m, nombre):
    return correr([{"m": m, "valor": nombre}])[0]


# ═════════════════════ 1. area-meta ═════════════════════


def test_area_meta_tiene_todas_las_areas_y_ninguna_de_mas(correr):
    meta = _valor(correr, "meta", "AREA_META")
    assert list(meta) == [a.codigo for a in AREAS]
    for a in AREAS:
        assert meta[a.codigo]["titulo"] == a.nombre, a.codigo
        assert meta[a.codigo]["pantallas"], f"{a.codigo} no dice qué controla"


def test_cada_solapa_aparece_en_las_pantallas_de_su_area(correr):
    """La matriz y la ayuda dicen «qué controla cada área» con AREA_META. Una solapa que
    no aparece ahí es algo que se da o se quita sin que nadie sepa que viene incluido."""
    meta = _valor(correr, "meta", "AREA_META")
    for s in SECCIONES:
        texto = " | ".join(meta[s.area]["pantallas"])
        assert s.nombre in texto, (s.area, s.nombre)
        if s.confidencial:
            assert "confidencial" in texto.lower(), s.codigo


def test_los_niveles_tienen_nombre_y_explicacion(correr):
    info = _valor(correr, "meta", "NIVEL_INFO")
    assert list(info) == list(NIVELES)
    assert all(v["label"] and v["desc"] for v in info.values())


# ═════════════════════ 2. lo que termina viendo un rol ═════════════════════

RAROS = [None, "raro"]


def test_la_regla_de_una_seccion_es_la_del_backend_en_todas_las_combinaciones(correr):
    combos = list(product([*NIVELES, *RAROS], [*NIVELES, *RAROS], [False, True]))
    llamadas = [{"m": "admin", "fn": "efectivaDeRolEnSeccion", "args": [area, ov, conf]}
                for area, ov, conf in combos]
    for (area, ov, conf), front in zip(combos, correr(llamadas)):
        back = _nivel_de_seccion(es_admin=False, es_confidencial=conf, override_rol=ov,
                                 nivel_area=area, extra_seccion=None)
        assert front == back, (area, ov, conf)


def _casos_de_rol():
    """Los roles sembrados y unos cuantos armados a mano, con y sin confidenciales."""
    casos = [(MATRIZ_ROL_AREA[r], MATRIZ_ROL_SECCION.get(r, {})) for r in ("supervisor", "operario")]
    casos += [
        ({}, {}),
        ({a.codigo: "write" for a in AREAS}, {"operaciones_planificador": "read",
                                               "recursos_rangos": "none",
                                               "dashboard_rendimiento": "read"}),
        ({"operaciones": "read"}, {"operaciones_ordenes": "write",  # no restringe: no cuenta
                                   "configuracion_usuarios": "read"}),
    ]
    confidenciales = [{}, {"dashboard_rendimiento": False}, {"operaciones_planificador": True}]
    return [(a, s, c) for (a, s) in casos for c in confidenciales]


def test_lo_que_ve_cada_rol_es_lo_del_backend(correr):
    casos = _casos_de_rol()
    llamadas = [{"m": "admin", "fn": "efectivasDeRol", "args": [a, s, c]} for a, s, c in casos]
    for (areas, secciones, conf), front in zip(casos, correr(llamadas)):
        back = resolver_permisos(DatosDePermisos(
            rol="x", rol_areas=areas, rol_secciones=secciones, confidenciales=conf))
        assert front == back["secciones"], (areas, secciones, conf)


@pytest_asyncio.fixture
async def cliente():
    engine, Sesion = await _base()

    async def _db():
        async with Sesion() as s:
            yield s

    app.dependency_overrides[AuthAPI.get_db] = _db
    app.dependency_overrides[PermisosAPI.get_db] = _db
    app.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


def _roles(matriz: dict) -> dict:
    return {r["codigo"]: {k: r[k] for k in ("areas", "secciones", "secciones_efectivas",
                                            "usuarios_activos", "es_admin")}
            for r in matriz["roles"]}


async def test_la_matriz_del_backend_se_lee_tal_cual(cliente, correr):
    r = await cliente.get("/permisos/matriz", headers=_token(JULIAN))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    leida = _uno(correr, "admin", "leerMatriz", data)
    assert _roles(leida) == _roles(data)
    assert [r["nombre"] for r in leida["roles"]] == [r["nombre"] for r in data["roles"]]
    conf_back = {s["codigo"]: s["confidencial"] for a in data["areas"] for s in a["secciones"]}
    assert _uno(correr, "admin", "confidencialesDe", leida) == conf_back


async def test_lo_que_pinta_la_pantalla_es_lo_que_contesta_el_backend_despues(cliente, correr):
    """El parche optimista: la pantalla aplica los cambios sobre la matriz que tenía y
    el backend los guarda. Después de los mismos cambios, los dos tienen que decir lo
    mismo de cada rol en cada área y sección."""
    admin = _token(JULIAN)
    antes = (await cliente.get("/permisos/matriz", headers=admin)).json()["data"]
    cambios = [
        ("conNivelDeArea", ["operario", "operaciones", "write"],
         ("PUT", "/permisos/roles/operario/areas/operaciones", {"nivel": "write"})),
        ("conNivelDeSeccion", ["operario", "operaciones_ordenes", "read"],
         ("PUT", "/permisos/roles/operario/secciones/operaciones_ordenes", {"nivel": "read"})),
        ("conNivelDeSeccion", ["operario", "operaciones_planificador", "hereda"],
         ("PUT", "/permisos/roles/operario/secciones/operaciones_planificador", {"nivel": "hereda"})),
        ("conNivelDeSeccion", ["supervisor", "dashboard_rendimiento", "read"],
         ("PUT", "/permisos/roles/supervisor/secciones/dashboard_rendimiento", {"nivel": "read"})),
        ("conConfidencial", ["recursos_rangos", True],
         ("PUT", "/permisos/secciones/recursos_rangos/confidencial", {"confidencial": True})),
        ("conNivelDeArea", ["supervisor", "operaciones", "read"],
         ("PUT", "/permisos/roles/supervisor/areas/operaciones", {"nivel": "read"})),
        ("conConfidencial", ["dashboard_rendimiento", False],
         ("PUT", "/permisos/secciones/dashboard_rendimiento/confidencial?forzar=true",
          {"confidencial": False})),
    ]
    for _, _, (metodo, ruta, cuerpo) in cambios:
        r = await cliente.request(metodo, ruta, headers=admin, json=cuerpo)
        assert r.status_code == 200, (ruta, r.text)
    despues = (await cliente.get("/permisos/matriz", headers=admin)).json()["data"]

    cadena = [{"fn": "leerMatriz", "args": [antes]}]
    cadena += [{"fn": fn, "args": args} for fn, args, _ in cambios]
    pintada = correr([{"m": "admin", "cadena": cadena}])[0]
    for rol in ("admin", "supervisor", "operario"):
        p = _roles(pintada)[rol]
        b = _roles(despues)[rol]
        assert p["areas"] == b["areas"], rol
        assert p["secciones"] == b["secciones"], rol
        assert p["secciones_efectivas"] == b["secciones_efectivas"], rol
    assert (_uno(correr, "admin", "confidencialesDe", pintada)
            == {s["codigo"]: s["confidencial"] for a in despues["areas"] for s in a["secciones"]})


async def test_crear_renombrar_y_borrar_un_rol_pintan_lo_que_guarda_el_backend(cliente, correr):
    """El ABM de roles (revisión del 23/09): la pantalla agrega, renombra y saca el rol
    sin volver a pedir la matriz. Lo que pinta tiene que ser lo que el backend contesta
    después: un rol nuevo sin ningún permiso, en todas las áreas y secciones."""
    admin = _token(JULIAN)
    antes = (await cliente.get("/permisos/matriz", headers=admin)).json()["data"]
    r = await cliente.post("/permisos/roles", headers=admin, json={"nombre": "Pañol"})
    assert r.status_code == 200, r.text
    codigo = r.json()["data"]["codigo"]
    r = await cliente.put(f"/permisos/roles/{codigo}", headers=admin, json={"nombre": "Pañol y depósito"})
    assert r.status_code == 200, r.text
    despues = (await cliente.get("/permisos/matriz", headers=admin)).json()["data"]

    cadena = [{"fn": "leerMatriz", "args": [antes]},
              {"fn": "conRolNuevo", "args": [codigo, "Pañol"]},
              {"fn": "conRolRenombrado", "args": [codigo, "Pañol y depósito"]}]
    pintada = correr([{"m": "admin", "cadena": cadena}])[0]
    assert pintada["abmDeRoles"] is True
    assert _roles(pintada) == _roles(despues)
    assert [(x["codigo"], x["nombre"]) for x in pintada["roles"]] == \
        [(x["codigo"], x["nombre"]) for x in despues["roles"]]
    nuevo = next(x for x in pintada["roles"] if x["codigo"] == codigo)
    assert nuevo["pantalla_inicio"] is None  # «la de siempre», como lo deja el backend

    r = await cliente.delete(f"/permisos/roles/{codigo}", headers=admin)
    assert r.status_code == 200, r.text
    sin = (await cliente.get("/permisos/matriz", headers=admin)).json()["data"]
    pintada = correr([{"m": "admin", "cadena": cadena + [{"fn": "sinRol", "args": [codigo]}]}])[0]
    assert _roles(pintada) == _roles(sin)


@pytest.mark.parametrize("crudo", [None, [], {}, {"roles": "x"}, "texto", {"roles": [{"nombre": "sin código"}]}])
def test_una_matriz_que_no_se_entiende(correr, crudo):
    r = _uno(correr, "admin", "leerMatriz", crudo)
    assert r is None or r["roles"] == []


# ═════════════════════ 3. lo que se ofrece lo acepta el backend ═════════════════════


def test_los_topes_son_los_del_backend(correr):
    assert _valor(correr, "admin", "TOPE_AREA") == PermisosAPI._TOPE_AREA
    assert _valor(correr, "admin", "TOPE_SECCION") == PermisosAPI._TOPE_SECCION


def _acepta_rol_en_area(area: str, nivel: str) -> bool:
    tope = PermisosAPI._TOPE_AREA.get(area)
    return not (tope and rango(nivel) > rango(tope))


def _acepta_rol_en_seccion(seccion: str, nivel: str, nivel_area: str, confidencial: bool) -> bool:
    """La regla de PUT /permisos/roles/{rol}/secciones/{seccion}, tal cual."""
    tope = PermisosAPI._TOPE_SECCION.get(seccion)
    if tope and rango(nivel) > rango(tope):
        return False
    if not confidencial and rango(nivel) >= rango(nivel_area):
        return False
    return True


def test_los_niveles_de_un_rol_en_un_area(correr):
    llamadas = [{"m": "admin", "fn": "nivelesDeRolEnArea", "args": [a.codigo]} for a in AREAS]
    for a, ofrecidos in zip(AREAS, correr(llamadas)):
        assert ofrecidos[0] == "none"
        assert "admin" not in ofrecidos  # ninguna pantalla lo pide salvo Configuración
        assert ofrecidos == [n for n in ("none", "read", "write") if _acepta_rol_en_area(a.codigo, n)]


def test_lo_que_se_ofrece_para_un_rol_en_una_seccion_lo_acepta_el_backend(correr):
    combos = list(product([s.codigo for s in SECCIONES], NIVELES, [False, True]))
    llamadas = [{"m": "admin", "fn": "opcionesDeRolEnSeccion", "args": list(c)} for c in combos]
    for (seccion, nivel_area, conf), ofrecidos in zip(combos, correr(llamadas)):
        assert ofrecidos[0] == "hereda", (seccion, nivel_area, conf)
        niveles = ofrecidos[1:]
        aceptados = [n for n in ("none", "read", "write")
                     if _acepta_rol_en_seccion(seccion, n, nivel_area, conf)]
        if conf:
            # «hereda» ya es «cerrada»: «none» sería lo mismo con otro nombre.
            assert niveles == [n for n in aceptados if n != "none"], (seccion, nivel_area)
        else:
            assert niveles == aceptados, (seccion, nivel_area)


def test_lo_que_se_ofrece_para_una_persona_lo_acepta_el_backend(correr):
    codigos = [a.codigo for a in AREAS] + [s.codigo for s in SECCIONES]
    llamadas = [{"m": "admin", "fn": "nivelesDePersona", "args": [c]} for c in codigos]
    for codigo, ofrecidos in zip(codigos, correr(llamadas)):
        assert ofrecidos, codigo  # siempre se puede dar algo, aunque sea «ver»
        tope = PermisosAPI._TOPE_AREA.get(codigo) or PermisosAPI._TOPE_SECCION.get(codigo)
        for n in ofrecidos:
            assert n in ("read", "write")
            assert not (tope and rango(n) > rango(tope)), (codigo, n)
            PermisoDePersonaDTO(nivel=n)  # el DTO no lo rechaza


def test_se_puede_dar_cada_area_y_cada_seccion(correr):
    """Espejo del test del árbol: todo lo que existe se puede dar a una persona."""
    opciones = _uno(correr, "admin", "opcionesDePermisoDeMas")
    assert {o["codigo"] for o in opciones if o["tipo"] == "area"} == {a.codigo for a in AREAS}
    assert {o["codigo"] for o in opciones if o["tipo"] == "seccion"} == {s.codigo for s in SECCIONES}


async def test_cada_opcion_ofrecida_la_acepta_el_backend_de_verdad(cliente, correr):
    """No sólo la regla copiada: cada nivel que la pantalla ofrece para el operario en
    cada sección, pedido al backend real, contesta 200."""
    admin = _token(JULIAN)
    matriz = (await cliente.get("/permisos/matriz", headers=admin)).json()["data"]
    operario = next(r for r in matriz["roles"] if r["codigo"] == "operario")
    conf = {s["codigo"]: s["confidencial"] for a in matriz["areas"] for s in a["secciones"]}
    llamadas = [{"m": "admin", "fn": "opcionesDeRolEnSeccion",
                 "args": [s.codigo, operario["areas"][s.area], conf[s.codigo]]} for s in SECCIONES]
    for s, ofrecidos in zip(SECCIONES, correr(llamadas)):
        for n in ofrecidos:
            r = await cliente.put(f"/permisos/roles/operario/secciones/{s.codigo}",
                                  headers=admin, json={"nivel": n})
            assert r.status_code == 200, (s.codigo, n, r.text)
        # Y se deja como estaba.
        previo = MATRIZ_ROL_SECCION.get("operario", {}).get(s.codigo, "hereda")
        await cliente.put(f"/permisos/roles/operario/secciones/{s.codigo}",
                          headers=admin, json={"nivel": previo})


async def test_lo_que_manda_la_pantalla_al_dar_un_permiso_lo_acepta_el_backend(cliente, correr):
    """El vencimiento sale del <input datetime-local>, sin zona; vuelve igual y se lee
    igual. Y lo de /permisos/overrides se lee con su nombre de quien lo dio."""
    ahora = {"__fecha__": "2026-09-22T10:00:00"}
    leido = _uno(correr, "admin", "leerVencimiento", "2099-09-30T18:00", ahora)
    assert leido == {"ok": True, "valor": "2099-09-30T18:00:00"}
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=_token(JULIAN),
                          json={"nivel": "read", "vence_en": leido["valor"], "motivo": "cubre a Sofía"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["vence_en"] == "2099-09-30T18:00:00"
    await cliente.put(f"/permisos/usuarios/{SOFIA}/secciones/dashboard_rendimiento",
                      headers=_token(JULIAN), json={"nivel": "read"})
    data = (await cliente.get("/permisos/overrides", headers=_token(JULIAN))).json()["data"]
    filas = _uno(correr, "admin", "leerPermisosDeMas", data)
    por_codigo = {f["codigo"]: f for f in filas}
    assert por_codigo["clientes"]["tipo"] == "area"
    assert por_codigo["clientes"]["vence_en"] == "2099-09-30T18:00:00"
    assert por_codigo["clientes"]["vigente"] is True
    assert por_codigo["clientes"]["motivo"] == "cubre a Sofía"
    assert por_codigo["clientes"]["otorgado_por_nombre"] == "Julian Prueba"
    assert por_codigo["dashboard_rendimiento"]["tipo"] == "seccion"
    assert por_codigo["dashboard_rendimiento"]["vence_en"] is None
    assert _uno(correr, "admin", "textoDeVencimiento", "2099-09-30T18:00:00") == "hasta el 30/09/2099 18:00"


# ═════════════════════ 4. vencimientos, errores y servidor viejo ═════════════════════


def test_los_vencimientos_viajan_sin_zona(correr):
    ahora = {"__fecha__": "2026-09-22T10:00:00"}
    res = correr([
        {"m": "admin", "fn": "leerVencimiento", "args": ["", ahora]},
        {"m": "admin", "fn": "leerVencimiento", "args": ["   ", ahora]},
        {"m": "admin", "fn": "leerVencimiento", "args": ["2026-09-22T18:30", ahora]},
        {"m": "admin", "fn": "leerVencimiento", "args": ["2026-09-22T09:59", ahora]},
        {"m": "admin", "fn": "leerVencimiento", "args": ["2026-09-22T10:00", ahora]},
        {"m": "admin", "fn": "leerVencimiento", "args": ["mañana", ahora]},
        {"m": "admin", "fn": "finDeHoy", "args": [ahora]},
        {"m": "admin", "fn": "textoDeVencimiento", "args": [None]},
        {"m": "admin", "fn": "textoDeVencimiento", "args": ["2026-10-01T07:05:00"]},
    ])
    assert res[0] == {"ok": True, "valor": None}  # vacío = permanente
    assert res[1] == {"ok": True, "valor": None}
    assert res[2] == {"ok": True, "valor": "2026-09-22T18:30:00"}
    assert res[3]["ok"] is False and "ya pasó" in res[3]["error"]
    assert res[4]["ok"] is False  # justo ahora ya venció (el backend: <= ahora)
    assert res[5]["ok"] is False
    assert res[6] == "2026-09-22T23:59"
    assert res[7] == "Permanente"
    assert res[8] == "hasta el 01/10/2026 07:05"
    # Lo que se manda, el DTO lo guarda tal cual: sin zona y sin correrlo.
    dto = PermisoDePersonaDTO(nivel="read", vence_en=res[2]["valor"])
    assert dto.vence_en == datetime(2026, 9, 22, 18, 30) and dto.vence_en.tzinfo is None


@pytest.mark.parametrize("status,cuerpo,falta", [
    (404, {"detail": "Not Found"}, True),       # la ruta no existe: backend viejo
    (404, None, True),
    (404, {"status": False, "errors": [{"message": "No existe el usuario #9.", "campo": "id_usuario"}]}, False),
    (503, {"status": False, "errors": [{"message": "No se pudieron leer los permisos.", "campo": "global"}]}, False),
    (500, {"detail": "Not Found"}, False),
    (200, {"status": True}, False),
])
def test_falta_actualizar_el_servidor(correr, status, cuerpo, falta):
    assert _uno(correr, "admin", "faltaServidor", status, cuerpo) is falta


def test_los_mensajes_de_error_salen_de_donde_vengan(correr):
    res = correr([
        {"m": "admin", "fn": "mensajeDeError", "args": [
            {"status": False, "errors": [{"message": "Es el único administrador activo.", "campo": "rol"}]}, "x"]},
        {"m": "admin", "fn": "mensajeDeError", "args": [{"detail": {"message": "Otro", "campo": "g"}}, "x"]},
        {"m": "admin", "fn": "mensajeDeError", "args": [{"detail": "Texto"}, "x"]},
        {"m": "admin", "fn": "mensajeDeError", "args": [None, "Por defecto"]},
        {"m": "admin", "fn": "erroresPorCampo", "args": [
            {"status": False, "errors": [{"message": "El email no es válido", "campo": "email"},
                                         {"message": "Falta", "campo": ""}]}]},
    ])
    assert res[:4] == ["Es el único administrador activo.", "Otro", "Texto", "Por defecto"]
    assert res[4] == {"email": "El email no es válido", "global": "Falta"}


def test_el_resumen_de_un_rol(correr):
    res = correr([
        {"m": "admin", "fn": "resumenDeRol", "args": [{"codigo": "admin", "es_admin": True, "areas": {}}]},
        {"m": "admin", "fn": "resumenDeRol", "args": [
            {"codigo": "operario", "es_admin": False, "areas": MATRIZ_ROL_AREA["operario"]}]},
        {"m": "admin", "fn": "resumenDeRol", "args": [{"codigo": "x", "es_admin": False, "areas": {}}]},
    ])
    assert "Puede todo" in res[0]
    assert res[1] == "Ve: Dashboard, Operaciones, Planos, No conformidades, Configuración"
    assert "ninguna pantalla" in res[2]


# ═════════════════════ 5. la pantalla de inicio (RF-28) ═════════════════════


def _rol_de_la_matriz(codigo, areas, secciones, efectivas=None):
    return {"codigo": codigo, "nombre": codigo, "es_admin": codigo == "admin", "usuarios_activos": 0,
            "areas": areas, "secciones": secciones, "secciones_efectivas": efectivas or {}}


def test_los_permisos_de_una_persona_son_los_del_backend(correr):
    """La lista dice si cada uno puede ver la pantalla que se le fija: para eso arma sus
    permisos con la regla del backend (resolver_permisos). Rol × permisos de más
    (vigentes y vencidos) × confidenciales: tienen que dar lo mismo, área por área y
    sección por sección."""
    extras_posibles = [
        [],
        [{"tipo": "area", "codigo": "clientes", "nivel": "read", "vigente": True}],
        [{"tipo": "area", "codigo": "operaciones", "nivel": "write", "vigente": True},
         {"tipo": "seccion", "codigo": "dashboard_rendimiento", "nivel": "read", "vigente": True}],
        # Vencidos: no cuentan.
        [{"tipo": "area", "codigo": "recursos", "nivel": "write", "vigente": False},
         {"tipo": "seccion", "codigo": "auditoria_procesos", "nivel": "read", "vigente": False}],
        # Una sección sin el área (confidencial o no): la da igual.
        [{"tipo": "seccion", "codigo": "recursos_rangos", "nivel": "read", "vigente": True},
         {"tipo": "seccion", "codigo": "configuracion_usuarios", "nivel": "read", "vigente": True}],
        # Un nivel raro vale «none».
        [{"tipo": "area", "codigo": "planos", "nivel": "raro", "vigente": True}],
    ]
    casos = []
    for (areas, secciones, conf) in _casos_de_rol():
        for extras in extras_posibles:
            casos.append(("x", areas, secciones, conf, extras))
    casos.append(("admin", {}, {}, {}, []))
    llamadas = [{"m": "admin", "fn": "permisosDePersona",
                 "args": [_rol_de_la_matriz(rol, a, s), ex, c]} for rol, a, s, c, ex in casos]
    for (rol, areas, secciones, conf, extras), front in zip(casos, correr(llamadas)):
        vigentes = [e for e in extras if e["vigente"]]
        back = resolver_permisos(DatosDePermisos(
            rol=rol, rol_areas=areas, rol_secciones=secciones, confidenciales=conf,
            usuario_areas={e["codigo"]: e["nivel"] for e in vigentes if e["tipo"] == "area"},
            usuario_secciones={e["codigo"]: e["nivel"] for e in vigentes if e["tipo"] == "seccion"},
        ))
        assert front["areas"] == back["areas"], (areas, secciones, conf, extras)
        assert front["secciones"] == back["secciones"], (areas, secciones, conf, extras)
        assert front["es_admin"] is (rol == "admin")


async def _data(cliente, ruta, headers):
    r = await cliente.get(ruta, headers=headers)
    assert r.status_code == 200, (ruta, r.text)
    return r.json()["data"]


async def test_lo_que_dice_la_lista_es_por_donde_entra_de_verdad(cliente, correr):
    """El admin fija pantallas (por rol y por persona) y da un permiso de más. Lo que la
    pantalla «Usuarios y permisos» calcula para cada persona (inicioDePersona, con la
    matriz, la lista y los permisos de más que manda el servidor) tiene que ser adonde
    la manda el login de verdad: rutaInicio con los permisos y la pantalla de /auth/me."""
    admin = _token(JULIAN)
    pedidos = [
        ("/permisos/roles/operario/pantalla-inicio", {"pantalla_inicio": "/clientes"}),   # no la ve
        ("/permisos/roles/supervisor/pantalla-inicio", {"pantalla_inicio": "/recursos"}),  # la ve
        ("/permisos/roles/admin/pantalla-inicio", {"pantalla_inicio": "/planos"}),
        (f"/permisos/usuarios/{SOFIA}/pantalla-inicio", {"pantalla_inicio": "/auditoria"}),  # no la ve
        (f"/permisos/usuarios/{LUCAS}/pantalla-inicio", {"pantalla_inicio": "/novedades"}),
    ]
    puede_por_rol = {}
    for ruta, cuerpo in pedidos:
        r = await cliente.put(ruta, headers=admin, json=cuerpo)
        assert r.status_code == 200, (ruta, r.text)
        if "/roles/" in ruta:
            puede_por_rol[ruta.split("/")[3]] = r.json()["data"]["puede_abrirla"]
    # A Matías (operario) le dan Clientes: su rol entra por Clientes y ahora la ve.
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=admin, json={"nivel": "read"})
    assert r.status_code == 200, r.text

    matriz_cruda = await _data(cliente, "/permisos/matriz", admin)
    usuarios = await _data(cliente, "/auth/usuarios", admin)
    overrides = await _data(cliente, "/permisos/overrides", admin)
    matriz, extras = correr([
        {"m": "admin", "fn": "leerMatriz", "args": [matriz_cruda]},
        {"m": "admin", "fn": "leerPermisosDeMas", "args": [overrides]},
    ])
    assert matriz["inicioDisponible"] is True

    # Por rol: lo que avisa la matriz es lo que contestó el servidor al fijarla.
    por_rol = correr([{"m": "admin", "fn": "inicioDeRol", "args": [r]} for r in matriz["roles"]])
    for rol, inicio in zip(matriz["roles"], por_rol):
        assert inicio["fijadaSinAcceso"] is (puede_por_rol[rol["codigo"]] is False), rol["codigo"]
    assert {r["codigo"]: i["ruta"] for r, i in zip(matriz["roles"], por_rol)} == {
        "admin": "/planos", "supervisor": "/recursos", "operario": "/dashboard"}

    # Por persona: lo que predice la lista == adonde entra de verdad.
    tokens = {JULIAN: _token(JULIAN), LUCAS: _token(LUCAS), SOFIA: _token(SOFIA, "supervisor"),
              MATIAS: _token(MATIAS, "operario")}
    activos = [u for u in usuarios if u["activo"]]
    assert {u["id_usuario"] for u in activos} == set(tokens) and ANA not in tokens
    predichas = correr([{"m": "admin", "fn": "inicioDePersona", "args": [u, matriz, extras]} for u in activos])
    # Lo que hace el login: rutaInicio con los permisos y la pantalla que manda el servidor.
    reales = []
    for u in activos:
        me = await _data(cliente, "/auth/me", tokens[u["id_usuario"]])
        reales.append((me["permisos"], me["pantalla_inicio"]))
    rutas_reales = correr([
        {"m": "permisos", "cadena": [{"fn": "leerPermisos", "args": [perm]},
                                     {"fn": "rutaInicio", "args": [pant]}]}
        for perm, pant in reales
    ])
    por_persona = {u["id_usuario"]: (p["ruta"], p["fijadaSinAcceso"]) for u, p in zip(activos, predichas)}
    assert {u["id_usuario"]: r for u, r in zip(activos, rutas_reales)} == {
        i: ruta for i, (ruta, _) in por_persona.items()}
    assert por_persona == {
        JULIAN: ("/planos", False),     # la de su rol
        LUCAS: ("/novedades", False),   # la suya pisa la del rol
        SOFIA: ("/dashboard", True),    # la suya (Auditoría) no la ve: cae al Dashboard
        MATIAS: ("/clientes", False),   # la del rol, que ve gracias al permiso de más
    }


def test_la_matriz_con_y_sin_pantalla_de_inicio(correr):
    """Con la migración: cada rol trae la suya (una vieja que ya no es del menú se lee
    como ninguna) y se ofrece cambiarla. Sin la clave (backend o base viejos): no se sabe
    y no se ofrece."""
    def rol(codigo, **extra):
        return {"codigo": codigo, "nombre": codigo, "es_admin": codigo == "admin",
                "usuarios_activos": 1, "areas": {}, "secciones": {}, **extra}
    con = {"pantalla_inicio_disponible": True, "roles": [
        rol("admin", pantalla_inicio=None), rol("operario", pantalla_inicio="/operaciones"),
        rol("supervisor", pantalla_inicio="/ya-no-existe")]}
    sin = {"roles": [rol("admin"), rol("operario")]}
    a_medias = {"pantalla_inicio_disponible": True, "roles": [rol("admin"), rol("operario", pantalla_inicio=None)]}
    leida_con, leida_sin, leida_a_medias, cambiada = correr([
        {"m": "admin", "fn": "leerMatriz", "args": [con]},
        {"m": "admin", "fn": "leerMatriz", "args": [sin]},
        {"m": "admin", "fn": "leerMatriz", "args": [a_medias]},
        {"m": "admin", "cadena": [{"fn": "leerMatriz", "args": [con]},
                                  {"fn": "conPantallaDeRol", "args": ["admin", "/auditoria"]}]},
    ])
    assert leida_con["inicioDisponible"] is True
    assert [r["pantalla_inicio"] for r in leida_con["roles"]] == [None, "/operaciones", None]
    assert leida_sin["inicioDisponible"] is False
    assert all("pantalla_inicio" not in r for r in leida_sin["roles"])
    # Que lo diga el servidor no alcanza si a un rol le falta: no se ofrece a medias.
    assert leida_a_medias["inicioDisponible"] is False
    assert [r["pantalla_inicio"] for r in cambiada["roles"]] == ["/auditoria", "/operaciones", None]


def test_inicio_segun_los_permisos(correr):
    """Sin nada fijado, el Dashboard (o la primera que vea); con una que ve, ésa; con una
    que no ve, avisa y dice adónde entra en su lugar."""
    operario = {"rol": "operario", "es_admin": False, "admin_permanente": None,
                "areas": {"operaciones": "read", "dashboard": "read"},
                "secciones": {"operaciones_ordenes": "read"}}
    sin_dashboard = {**operario, "areas": {"operaciones": "read"}}
    res = correr([
        {"m": "admin", "fn": "inicioSegun", "args": [operario, None]},
        {"m": "admin", "fn": "inicioSegun", "args": [operario, "/operaciones"]},
        {"m": "admin", "fn": "inicioSegun", "args": [operario, "/clientes"]},
        {"m": "admin", "fn": "inicioSegun", "args": [sin_dashboard, "/clientes"]},
        {"m": "admin", "fn": "inicioSegun", "args": [operario, "/ordenes"]},
    ])
    assert res[0] == {"fijada": None, "ruta": "/dashboard", "fijadaSinAcceso": False}
    assert res[1] == {"fijada": "/operaciones", "ruta": "/operaciones", "fijadaSinAcceso": False}
    assert res[2] == {"fijada": "/clientes", "ruta": "/dashboard", "fijadaSinAcceso": True}
    assert res[3] == {"fijada": "/clientes", "ruta": "/operaciones", "fijadaSinAcceso": True}
    # Una que no es del menú no cuenta como fijada.
    assert res[4] == {"fijada": None, "ruta": "/dashboard", "fijadaSinAcceso": False}
