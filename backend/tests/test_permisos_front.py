"""RF-24: los permisos del lado de la pantalla (frontend/src/lib/permisos.ts).

La pantalla no resuelve permisos: los recibe resueltos del backend (login y /auth/me) y
sólo decide qué mostrar. Pero tiene su propia copia del catálogo (áreas y secciones), su
menú, qué pide cada ruta y la regla de «sin permisos = acceso total» para un backend de
antes de RF-24. Si cualquiera de esas cosas se separa del backend, la pantalla miente:
esconde lo que se puede o muestra lo que va a volver 403.

Se compila de verdad y se corre de verdad —con el tsc del propio repo, igual que
test_jornada_front_y_back_no_se_separan.py— en vez de leer el .ts con expresiones
regulares: lo que importa es lo que el código contesta.

Tres partes:

1. El port del test de sidebar-tree.ts de Don Joaquín: el árbol de la pantalla de
   permisos no puede dejar secciones afuera, ni repetirlas, ni inventarlas.
2. El catálogo, el menú y las rutas: el mismo catálogo que el backend, el mismo menú que
   el Sidebar, y toda página con su requisito (o libre a propósito).
3. Las preguntas (`puede`, `puedeSeccion`, el menú visible, la ruta de inicio) con los
   permisos que RESUELVE EL BACKEND para cada rol sembrado: front y back tienen que
   decir lo mismo para cada área, sección y nivel.
"""
import json
import re
import shutil
import subprocess
import tempfile
from itertools import product
from pathlib import Path

import pytest

from backend.core.permisos import (
    AREAS,
    MATRIZ_ROL_AREA,
    MATRIZ_ROL_SECCION,
    NIVELES,
    SECCIONES,
    DatosDePermisos,
    permisos_de,
)

RAIZ = Path(__file__).resolve().parents[2]
FRONT = RAIZ / "frontend" / "src"
FRONT_LIB = FRONT / "lib"
TSC = RAIZ / "frontend" / "node_modules" / ".bin" / "tsc"

# Las rutas que se prueban: las del menú, las sueltas, las libres, una con query y
# prefijo, y una que no existe.
RUTAS = [
    "/", "/login", "/dashboard", "/operaciones", "/operaciones?tab=materia_prima",
    "/planos", "/recursos", "/recursos/x", "/clientes", "/configuracion",
    "/no-conformidades", "/auditoria", "/novedades", "/ordenes", "/planificacion",
    "/operarios", "/procesos", "/sectores", "/prioridades", "/articulos", "/no-existe",
]

DRIVER = r"""
const p = require('./permisos.js');
const fs = require('fs');
const entrada = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function responder(crudo) {
  const leido = p.leerPermisos(crudo);
  const areas = {};
  for (const a of p.AREAS) {
    areas[a.codigo] = {};
    for (const n of p.NIVELES) areas[a.codigo][n] = p.puede(leido, a.codigo, n);
  }
  const secciones = {};
  for (const s of p.SECCIONES) {
    secciones[s.codigo] = {};
    for (const n of p.NIVELES) secciones[s.codigo][n] = p.puedeSeccion(leido, s.codigo, n);
  }
  const rutas = {};
  for (const r of entrada.rutas) rutas[r] = p.puedeAbrirRuta(leido, r);
  const fijadas = {};
  for (const f of entrada.fijadas) fijadas[f] = p.rutaInicio(leido, f);
  return {
    leido,
    areas,
    secciones,
    menu: p.menuVisible(leido).map((i) => i.href),
    inicio: p.rutaInicio(leido),
    rutas,
    fijadas,
  };
}

const casos = {};
for (const [nombre, crudo] of Object.entries(entrada.casos)) casos[nombre] = responder(crudo);
// `undefined` no viaja en JSON: el caso «no vino nada» va aparte.
casos['__undefined__'] = responder(undefined);

const requisitos = {};
for (const r of entrada.rutas) requisitos[r] = p.requisitoDeRuta(r);

console.log(JSON.stringify({
  AREAS: p.AREAS,
  SECCIONES: p.SECCIONES,
  NIVELES: p.NIVELES,
  NIVEL_RANK: p.NIVEL_RANK,
  MENU: p.MENU,
  ARBOL: p.ARBOL,
  seccionesDelArbol: p.seccionesDelArbol(),
  RUTAS_SUELTAS: p.RUTAS_SUELTAS,
  RUTAS_LIBRES: p.RUTAS_LIBRES,
  RUTA_ANCLA: p.RUTA_ANCLA,
  requisitos,
  casos,
}));
"""


def _permisos_del_backend(rol: str, **extra) -> dict:
    """Lo que el backend manda en `permisos` para alguien de `rol`, resuelto con SUS
    reglas y la matriz sembrada (sin overrides salvo que se pasen)."""
    datos = DatosDePermisos(
        rol=rol,
        rol_areas=MATRIZ_ROL_AREA.get(rol, {}),
        rol_secciones=MATRIZ_ROL_SECCION.get(rol, {}),
        **extra,
    )
    return {**permisos_de(datos).como_dict(), "admin_permanente": None}


# Lo que se le pregunta a la pantalla. Cada caso es lo que podría venir en `permisos`.
CASOS = {
    # Backend de antes de RF-24: no viene nada, o viene algo que no se entiende.
    "null": None,
    "vacio": {},
    "sin_areas": {"rol": "operario", "secciones": {}},
    "areas_lista": {"rol": "operario", "areas": []},
    # Los tres roles sembrados, resueltos por el backend.
    "admin": _permisos_del_backend("admin"),
    "supervisor": _permisos_del_backend("supervisor"),
    "operario": _permisos_del_backend("operario"),
    # Un operario al que le dieron Recursos en lectura y el rendimiento (confidencial).
    "operario_con_extras": _permisos_del_backend(
        "operario",
        usuario_areas={"recursos": "read"},
        usuario_secciones={"dashboard_rendimiento": "read"},
    ),
    # Un rol sin nada (todavía no se le cargó la matriz).
    "rol_vacio": _permisos_del_backend("sin_matriz"),
    # Un backend más viejo que la pantalla: manda las áreas pero no las secciones.
    "solo_areas": {"rol": "x", "es_admin": False, "areas": {"operaciones": "write", "configuracion": "read"}},
    # Un nivel que no se entiende vale «none», como en el backend.
    "nivel_raro": {"rol": "x", "es_admin": False, "areas": {"dashboard": "superadmin", "planos": "read"}},
}

FIJADAS = ["/planos", "/clientes", "/auditoria", "   ", "no-empieza-con-barra", "/novedades"]


def _hay_node() -> bool:
    return bool(shutil.which("node")) and TSC.exists()


@pytest.fixture(scope="module")
def front():
    if not _hay_node():
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "permisos.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck", "--strict"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"permisos.ts no compila solo (no puede importar nada):\n"
            f"{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        (Path(tmp) / "entrada.json").write_text(json.dumps(
            {"casos": CASOS, "rutas": RUTAS, "fijadas": FIJADAS}))
        salida = subprocess.run(
            ["node", "driver.js", "entrada.json"],
            cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
        )
        return json.loads(salida.stdout)


# ═════════════════════ 1. el árbol (port de sidebar-tree.test.ts) ═════════════════════


def test_toda_seccion_del_catalogo_se_puede_otorgar_desde_la_pantalla(front):
    """DJ, 25/08/2026: se agregó una sección al catálogo y no al árbol; quedó publicada,
    confidencial, invisible para todos y sin forma de dársela a nadie. Una sección que no
    está en el árbol es una parte del sistema muerta."""
    en_el_arbol = set(front["seccionesDelArbol"])
    faltan = [s["codigo"] for s in front["SECCIONES"] if s["codigo"] not in en_el_arbol]
    assert faltan == []


def test_no_hay_secciones_repetidas_en_el_arbol(front):
    """Repetida = dos interruptores para el mismo permiso, y uno miente."""
    todas = front["seccionesDelArbol"]
    assert len(todas) == len(set(todas))


def test_cada_hoja_del_arbol_existe_en_el_catalogo(front):
    codigos = {s["codigo"] for s in front["SECCIONES"]}
    inventadas = [c for c in front["seccionesDelArbol"] if c not in codigos]
    assert inventadas == []


def test_cada_hoja_cuelga_de_su_area_y_se_llama_igual(front):
    """El árbol agrupa por página: una sección bajo el área equivocada se otorgaría
    pensando en otra pantalla."""
    por_codigo = {s["codigo"]: s for s in front["SECCIONES"]}
    for pagina in front["ARBOL"]:
        for hoja in pagina["secciones"]:
            s = por_codigo[hoja["seccion"]]
            assert s["area"] == pagina["area"], hoja
            assert s["nombre"] == hoja["nombre"], hoja


def test_el_arbol_tiene_todas_las_areas_en_el_orden_del_catalogo(front):
    assert [p["area"] for p in front["ARBOL"]] == [a["codigo"] for a in front["AREAS"]]


# ═════════════════════ 2. catálogo, menú y rutas ═════════════════════


def test_el_catalogo_de_la_pantalla_es_el_del_backend(front):
    """Mismo código, nombre, orden, área y marca de confidencial, en el mismo orden."""
    assert front["AREAS"] == [
        {"codigo": a.codigo, "nombre": a.nombre, "orden": a.orden} for a in AREAS
    ]
    assert front["SECCIONES"] == [
        {"codigo": s.codigo, "area": s.area, "nombre": s.nombre, "orden": s.orden,
         "confidencial": s.confidencial}
        for s in SECCIONES
    ]


def test_los_niveles_son_los_del_backend(front):
    assert front["NIVELES"] == list(NIVELES)
    assert [front["NIVEL_RANK"][n] for n in NIVELES] == [0, 1, 2, 3]


def test_el_menu_es_el_del_sidebar():
    """Sidebar.tsx pone los íconos y MENU decide qué se ve: si un ítem está en uno y no
    en el otro, o se muestra sin mirar permisos o no se muestra nunca."""
    sidebar = (FRONT / "components" / "Sidebar.tsx").read_text()
    lista = sidebar.split("const sidebarItems", 1)[1].split("];", 1)[0]
    hrefs_sidebar = re.findall(r'href:\s*"([^"]+)"', lista)
    permisos_ts = (FRONT_LIB / "permisos.ts").read_text()
    menu = permisos_ts.split("export const MENU", 1)[1].split("];", 1)[0]
    hrefs_menu = re.findall(r'href:\s*"([^"]+)"', menu)
    assert hrefs_sidebar == hrefs_menu


def test_los_requisitos_del_menu_existen(front):
    areas = {a["codigo"] for a in front["AREAS"]}
    secciones = {s["codigo"]: s["area"] for s in front["SECCIONES"]}
    for item in front["MENU"]:
        if item.get("area"):
            assert item["area"] in areas, item
        for s in item.get("solapas") or []:
            # Las solapas de un ítem son secciones de SU área.
            assert secciones.get(s) == item.get("area"), (item["href"], s)


def _rutas_de_paginas() -> list[str]:
    app = FRONT / "app"
    rutas = []
    for pagina in app.rglob("page.tsx"):
        partes = [p for p in pagina.parent.relative_to(app).parts
                  if not (p.startswith("(") and p.endswith(")"))]
        rutas.append("/" + "/".join(partes) if partes else "/")
    return sorted(rutas)


def test_toda_pagina_tiene_su_requisito_o_es_libre_a_proposito(front):
    """Una página nueva que nadie agregó al mapa se abriría para cualquiera escribiendo
    la dirección: el menú la esconde pero la guardia no sabe qué pedir. Tiene que estar
    en el menú, en las sueltas o en las libres (con su porqué en permisos.ts)."""
    conocidas = (
        {i["href"] for i in front["MENU"]}
        | set(front["RUTAS_SUELTAS"])
        | set(front["RUTAS_LIBRES"])
    )
    sin_mapa = [r for r in _rutas_de_paginas() if r not in conocidas]
    assert sin_mapa == [], f"páginas sin requisito en lib/permisos.ts: {sin_mapa}"


def test_los_requisitos_de_cada_ruta(front):
    req = front["requisitos"]
    assert req["/"] is None and req["/login"] is None
    assert req["/configuracion"] is None and req["/novedades"] is None
    assert req["/no-existe"] is None
    assert req["/dashboard"] == {"area": "dashboard"}
    # Query y subrutas piden lo de la pantalla.
    assert req["/operaciones?tab=materia_prima"] == req["/operaciones"]
    assert req["/recursos/x"] == req["/recursos"]
    assert req["/planificacion"] == {"seccion": "operaciones_planificador"}
    assert req["/ordenes"] == {"seccion": "operaciones_ordenes"}


# ═════════════════════ 3. las preguntas ═════════════════════


@pytest.mark.parametrize("caso", ["null", "vacio", "sin_areas", "areas_lista", "__undefined__"])
def test_sin_permisos_es_acceso_total(front, caso):
    """Backend de antes de RF-24 (lo que corre en producción hasta el deploy a mano):
    no manda permisos, o manda algo que no se entiende. La pantalla se comporta como
    siempre: todo visible, todo editable, al Dashboard. Nunca se cierra todo por un
    campo que falta."""
    r = front["casos"][caso]
    assert r["leido"] is None
    assert all(all(n.values()) for n in r["areas"].values())
    assert all(all(n.values()) for n in r["secciones"].values())
    assert r["menu"] == [i["href"] for i in front["MENU"]]
    assert r["inicio"] == "/dashboard"
    assert all(r["rutas"].values())


def test_el_admin_puede_todo(front):
    r = front["casos"]["admin"]
    assert r["leido"]["es_admin"] is True
    assert all(all(n.values()) for n in r["areas"].values())
    assert all(all(n.values()) for n in r["secciones"].values())
    assert r["menu"] == [i["href"] for i in front["MENU"]]
    assert r["inicio"] == "/dashboard"


@pytest.mark.parametrize("caso,rol,extra", [
    ("admin", "admin", {}),
    ("supervisor", "supervisor", {}),
    ("operario", "operario", {}),
    ("operario_con_extras", "operario", {
        "usuario_areas": {"recursos": "read"},
        "usuario_secciones": {"dashboard_rendimiento": "read"},
    }),
    ("rol_vacio", "sin_matriz", {}),
])
def test_la_pantalla_dice_lo_mismo_que_el_backend(front, caso, rol, extra):
    """Para cada área, cada sección y cada nivel: lo que la pantalla contesta con los
    permisos que mandó el backend es exactamente lo que el backend exige al pedir."""
    datos = DatosDePermisos(
        rol=rol,
        rol_areas=MATRIZ_ROL_AREA.get(rol, {}),
        rol_secciones=MATRIZ_ROL_SECCION.get(rol, {}),
        **extra,
    )
    back = permisos_de(datos)
    r = front["casos"][caso]
    for a, n in product(AREAS, NIVELES):
        assert r["areas"][a.codigo][n] == back.tiene_area(a.codigo, n), (caso, a.codigo, n)
    for s, n in product(SECCIONES, NIVELES):
        assert r["secciones"][s.codigo][n] == back.tiene_seccion(s.codigo, n), (caso, s.codigo, n)


def test_el_menu_del_operario(front):
    """Con la matriz sembrada: el operario ve el dashboard, Operaciones (sin el
    planificador), Planos y No conformidades, y lo que es de todos. No ve Recursos,
    Clientes ni Auditoría."""
    r = front["casos"]["operario"]
    assert r["menu"] == [
        "/dashboard", "/operaciones", "/planos", "/configuracion", "/no-conformidades", "/novedades",
    ]
    assert r["inicio"] == "/dashboard"
    assert r["rutas"]["/recursos"] is False
    assert r["rutas"]["/clientes"] is False
    assert r["rutas"]["/auditoria"] is False
    # La página suelta del planificador pide la solapa, que el rol le cierra.
    assert r["rutas"]["/planificacion"] is False
    assert r["rutas"]["/operaciones"] is True
    # Lee Operaciones pero no escribe; no ve el planificador ni el rendimiento.
    assert r["secciones"]["operaciones_ordenes"]["read"] is True
    assert r["secciones"]["operaciones_ordenes"]["write"] is False
    assert r["secciones"]["operaciones_planificador"]["read"] is False
    assert r["secciones"]["dashboard_rendimiento"]["read"] is False
    assert r["secciones"]["configuracion_usuarios"]["read"] is False


def test_el_menu_del_supervisor(front):
    r = front["casos"]["supervisor"]
    assert r["menu"] == [
        "/dashboard", "/operaciones", "/planos", "/recursos", "/clientes",
        "/configuracion", "/no-conformidades", "/novedades",
    ]
    assert r["secciones"]["operaciones_planificador"]["write"] is True
    assert r["secciones"]["recursos_procesos"]["write"] is False
    assert r["areas"]["clientes"]["write"] is False
    assert r["rutas"]["/auditoria"] is False


def test_un_permiso_de_mas_abre_lo_suyo(front):
    """A un operario le dieron Recursos en lectura y el rendimiento del dashboard: ve
    Recursos en el menú y la sección confidencial, pero no puede escribir en nada de eso."""
    r = front["casos"]["operario_con_extras"]
    assert "/recursos" in r["menu"]
    assert r["secciones"]["recursos_procesos"]["read"] is True
    assert r["secciones"]["recursos_procesos"]["write"] is False
    assert r["secciones"]["dashboard_rendimiento"]["read"] is True


def test_sin_nada_cae_en_lo_que_es_de_todos(front):
    """Un rol sin matriz no ve ninguna pantalla de trabajo: entra a Configuración (su
    cuenta) y ve las Novedades. No rebota en un cartel de «no tenés acceso»."""
    r = front["casos"]["rol_vacio"]
    assert r["menu"] == ["/configuracion", "/novedades"]
    assert r["inicio"] == "/configuracion"
    assert r["rutas"][r["inicio"]] is True


def test_una_seccion_que_el_backend_no_mando_sigue_la_regla(front):
    """Backend más viejo que la pantalla: manda las áreas y no las secciones. Una común
    hereda el área; una confidencial queda cerrada. Es lo que el backend diría."""
    r = front["casos"]["solo_areas"]
    assert r["secciones"]["operaciones_ordenes"]["write"] is True
    assert r["secciones"]["operaciones_planificador"]["write"] is True
    assert r["secciones"]["configuracion_usuarios"]["read"] is False
    assert r["secciones"]["recursos_procesos"]["read"] is False
    assert r["menu"] == ["/operaciones", "/configuracion", "/novedades"]
    assert r["inicio"] == "/operaciones"


def test_un_nivel_que_no_se_entiende_no_abre_nada(front):
    r = front["casos"]["nivel_raro"]
    assert r["areas"]["dashboard"]["read"] is False
    assert r["areas"]["planos"]["read"] is True
    assert r["leido"]["areas"]["dashboard"] == "none"


def test_la_pantalla_fijada_solo_si_se_puede_abrir(front):
    """rutaInicio (DJ ruta-inicio.ts): la que se le fijó, si todavía la puede abrir; si
    no, la primera del menú. Nunca devuelve una ruta que rebote."""
    op = front["casos"]["operario"]["fijadas"]
    assert op["/planos"] == "/planos"
    assert op["/novedades"] == "/novedades"
    assert op["/clientes"] == "/dashboard"  # le sacaron Clientes: no rebota
    assert op["/auditoria"] == "/dashboard"
    assert op["   "] == "/dashboard"
    assert op["no-empieza-con-barra"] == "/dashboard"
    for caso in front["casos"].values():
        for destino in caso["fijadas"].values():
            assert caso["rutas"].get(destino, True) is not False
