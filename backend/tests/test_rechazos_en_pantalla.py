"""RF-12 en la pantalla: los rechazos se cargan y se ven donde se los busca.

Lo que pidió Lucas el 23/09 («si algo se rechazó, que quede el registro … ¿quién la
hizo? Tal empleado») tiene tres lugares en la app, y este archivo fija que los tres
estén enchufados y pidan lo mismo que el servidor:

  1. La ficha de la OT monta el «Control de calidad» (cargar un rechazo, sus no
     conformidades, cerrarlas), y deja el enganche para la casilla «Controlado» de RF-11.
  2. La ficha de la persona muestra sus rechazos al lado del reporte de RF-07, con la
     misma sección confidencial.
  3. No conformidades carga, filtra por persona y agrupa por persona (con la sección).

Y lib/calidad.ts corrido con node: con un servidor de antes del 23/09 no se ofrece
cargar (guardar un tipo nuevo fallaría y lo nuevo se perdería sin aviso).
"""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from backend.application.IncidenciaProcesoService import IncidenciaProcesoService
from backend.core.permisos_rutas import POLITICAS

RAIZ = Path(__file__).resolve().parents[2]
FRONT = RAIZ / "frontend" / "src"
NODE_MODULES = RAIZ / "frontend" / "node_modules"

pytestmark = pytest.mark.skipif(not FRONT.exists(), reason="sin el frontend en el repo")


def _leer(relativo: str) -> str:
    return (FRONT / relativo).read_text(encoding="utf-8")


# ─────────────────────── 1, 2 y 3. enchufado donde va ───────────────────────

def test_la_ficha_de_la_ot_tiene_control_de_calidad():
    ficha = _leer("components/CreateWorkOrderModal.tsx")
    assert "<ControlDeCalidadOT" in ficha, "la ficha de la OT no muestra el control de calidad"
    # Fuera del <form> de la OT, como las pausas: sus botones no guardan la OT.
    assert ficha.index("<ControlDeCalidadOT") < ficha.index("<form onSubmit={handleSubmit}")


def test_la_ficha_de_la_persona_muestra_sus_rechazos_en_la_solapa_de_rendimiento():
    ficha = _leer("app/recursos/_components/DetalleOperario.tsx")
    solapa = ficha[ficha.index('<TabsContent value="rendimiento"'):]
    solapa = solapa[:solapa.index("</TabsContent>")]
    assert "<RechazosDeLaPersona" in solapa, "los rechazos van con el reporte de RF-07, con su período"
    assert "periodo={periodoRendimiento}" in solapa


def test_el_front_llama_a_las_rutas_de_los_rechazos():
    todo = (_leer("lib/calidad.ts") + _leer("app/no-conformidades/page.tsx")
            + _leer("app/recursos/_components/RechazosDeLaPersona.tsx")
            + _leer("components/calidad/ControlDeCalidadOT.tsx"))
    for ruta in ("${API_URL}/incidencias`", "${API_URL}/incidencias/tipos",
                 "${API_URL}/incidencias/para-registrar", "${API_URL}/incidencias/por-persona",
                 "${API_URL}/operarios/${idOperario}/rechazos", "${API_URL}/ordenes/${idOrden}/incidencias"):
        assert ruta in todo, f"nadie en el front llama a {ruta}"


def test_quien_la_registro_y_cuando_no_los_manda_el_front():
    """Salen del token y del reloj del taller, en el servidor."""
    lib = _leer("lib/calidad.ts")
    cuerpo = lib[lib.index("export interface CuerpoRechazo"):]
    cuerpo = cuerpo[:cuerpo.index("}")]
    for campo in ("usuario", "id_usuario", "fecha_registro"):
        assert campo not in cuerpo, f"el formulario no puede mandar «{campo}»"


# ─────────────────────── los permisos: lo mismo que el servidor ───────────────────────

def _requisito(ruta: str):
    (r,) = POLITICAS["incidencias"].requisitos("GET", ruta)
    return r


def test_cargar_y_cerrar_piden_lo_mismo_que_el_backend():
    (escribe,) = POLITICAS["incidencias"].escribir
    assert (escribe.area, escribe.nivel) == ("no_conformidades", "write")
    permiso = f'puede("{escribe.area}", "{escribe.nivel}")'
    assert permiso in _leer("components/calidad/ControlDeCalidadOT.tsx")
    pagina = _leer("app/no-conformidades/page.tsx")
    assert permiso in pagina
    assert "{puedeEditar && sabeCargar && catalogos && (" in pagina, "el botón de cargar sin permiso"


def test_lo_agrupado_por_persona_pide_la_seccion_confidencial_igual_que_el_backend():
    for ruta in ("/incidencias/por-persona", "/operarios/{id_operario}/rechazos"):
        assert _requisito(ruta).seccion == "dashboard_rendimiento", ruta
    pagina = _leer("app/no-conformidades/page.tsx")
    assert 'puedeSeccion("dashboard_rendimiento", "read")' in pagina
    assert "veRendimiento && sabeCargar" in pagina, "la vista «Por persona» sin la sección"
    # La ficha: la solapa Rendimiento ya sólo aparece con la sección (veRendimiento), y
    # el componente no dibuja nada con un 403.
    assert 'puedeSeccion("dashboard_rendimiento", "read")' in _leer("app/recursos/_components/DetalleOperario.tsx")
    assert "[401, 403, 404, 405]" in _leer("app/recursos/_components/RechazosDeLaPersona.tsx")


def test_el_enganche_de_rf11_esta_y_lo_escucha_la_ficha():
    lib = _leer("lib/calidad.ts")
    assert "export function ofrecerRegistrarRechazos(idOrden: number)" in lib
    assert "EVENTO_OT_CONTROLADA" in _leer("components/calidad/ControlDeCalidadOT.tsx")


# ─────────────────────── lib/calidad.ts, corrido con node ───────────────────────

TRANSPILAR = r"""
const ts = require('typescript');
const fs = require('fs');
const [, , origen, destino] = process.argv;
const salida = ts.transpileModule(fs.readFileSync(origen, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
fs.writeFileSync(destino, salida.outputText);
"""

DRIVER = r"""
const eventos = [];
globalThis.window = { location: { hostname: 'localhost', origin: 'http://localhost' },
                      dispatchEvent: (e) => eventos.push({ tipo: e.type, detalle: e.detail }) };
globalThis.localStorage = { getItem: () => 'token' };
const [nuevo, viejo] = JSON.parse(process.argv[2]);
(async () => {
  const salida = {};
  // Un servidor sin la ruta de las listas: nada que cargar.
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  let c = require('./calidad.js');
  salida.sin_ruta = await c.pedirCatalogos();
  // El de 3422285: tiene las listas pero no las disposiciones.
  delete require.cache[require.resolve('./calidad.js')];
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: true, data: viejo }) });
  c = require('./calidad.js');
  salida.viejo = c.sabeCargarRechazos(await c.pedirCatalogos());
  delete require.cache[require.resolve('./calidad.js')];
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: true, data: nuevo }) });
  c = require('./calidad.js');
  salida.nuevo = c.sabeCargarRechazos(await c.pedirCatalogos());
  // Un «no» del servidor se lee con su porqué.
  globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => ({ errors: [{ message: 'No existe la persona 999 en Recursos.' }] }) });
  try { await c.registrarRechazo({}); salida.error = null; } catch (e) { salida.error = e.message; }
  salida.piezas = [c.piezasTexto(10, 50), c.piezasTexto(3), c.piezasTexto(null, 50), c.piezasTexto(0, null)];
  salida.porcentaje = [c.porcentajeTexto(14.3), c.porcentajeTexto(null)];
  salida.paso = [c.pasoTexto({ paso: 2, proceso: 'TORNO CNC' }), c.pasoTexto({ paso: null, proceso: 'CORTE' }), c.pasoTexto({ paso: null, proceso: null })];
  salida.mes = [c.mesEnCurso(new Date(2026, 1, 10)), c.mesEnCurso(new Date(2028, 1, 10)), c.mesEnCurso(new Date(2026, 11, 31))];
  salida.nombre = c.nombreVisible('JUAN PEREZ');
  c.ofrecerRegistrarRechazos(10);
  salida.eventos = eventos;
  console.log(JSON.stringify(salida));
})();
"""


def _hay_node() -> bool:
    return bool(shutil.which("node")) and (NODE_MODULES / "typescript").exists()


@pytest.fixture(scope="module")
def calidad():
    if not _hay_node():
        pytest.skip("hace falta node y el typescript del frontend (npm install)")
    nuevo = IncidenciaProcesoService(None).catalogos().data
    viejo = {k: nuevo[k] for k in ("tipos", "gravedades", "estados")}
    env = {"NODE_PATH": str(NODE_MODULES), "PATH": os.environ.get("PATH", "")}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "transpilar.js").write_text(TRANSPILAR)
        (tmp / "node_modules" / "@").mkdir(parents=True)

        def _transpilar(origen: Path, destino: Path):
            subprocess.run(["node", "transpilar.js", str(origen), str(destino)], cwd=tmp,
                           check=True, capture_output=True, text=True, timeout=60, env=env)

        _transpilar(FRONT / "config.ts", tmp / "node_modules" / "@" / "config.js")
        _transpilar(FRONT / "lib" / "calidad.ts", tmp / "calidad.js")
        (tmp / "driver.js").write_text(DRIVER)
        r = subprocess.run(["node", "driver.js", json.dumps([nuevo, viejo])], cwd=tmp,
                           capture_output=True, text=True, timeout=60, env=env)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout.strip().splitlines()[-1])


def test_con_un_servidor_de_antes_no_se_ofrece_cargar(calidad):
    assert calidad["sin_ruta"] is None
    assert calidad["viejo"] is False, "sin disposiciones, guardar un tipo nuevo fallaría"
    assert calidad["nuevo"] is True


def test_un_no_del_servidor_se_lee_con_su_porque(calidad):
    assert calidad["error"] == "No existe la persona 999 en Recursos."


def test_los_textos(calidad):
    assert calidad["piezas"] == ["10 de 50", "3", "—", "0"]
    assert calidad["porcentaje"] == ["14,3 %", "—"]
    assert calidad["paso"] == ["Paso 2 · TORNO CNC", "CORTE", "Toda la orden"]
    assert calidad["mes"] == [
        {"desde": "2026-02-01", "hasta": "2026-02-28"},
        {"desde": "2028-02-01", "hasta": "2028-02-29"},
        {"desde": "2026-12-01", "hasta": "2026-12-31"},
    ]
    assert calidad["nombre"] == "Juan Perez"


def test_el_aviso_de_ot_controlada_lleva_la_orden(calidad):
    assert calidad["eventos"] == [{"tipo": "spmm:ot-controlada", "detalle": {"idOrden": 10}}]
