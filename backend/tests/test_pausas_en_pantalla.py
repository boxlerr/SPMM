"""RF-03 en la pantalla: se puede pausar y reanudar desde la app, no sólo por la API.

La verificación del 23/09 encontró que RF-03 no tenía pantalla: ni botón «Pausar» ni
«Reanudar», ni cartel de «Pausada», y nadie en el frontend llamaba a las rutas de pausas.
Mientras tanto el aviso del planificador mandaba a «Operaciones › la OT › Reanudar», un
botón que no existía, y una OT pausada por API quedaba afuera de todos los planes hasta
que alguien llamara a /reanudar a mano.

Lo que se fija acá:
  1. El frontend llama a las cuatro rutas (pausar, reanudar, lo pausado, el historial).
  2. La ficha de la OT monta el panel de pausas y las tres listas de Operaciones el
     cartel; y el aviso del planificador manda a un botón que está.
  3. Los botones de escritura piden lo mismo que el backend (la solapa Órdenes).
  4. Los motivos de la pantalla son los del backend.
  5. El store de «lo pausado ahora» (lib/pausas.ts), corrido de verdad con node: un
     backend de antes lo deja en «no», agrupa sólo lo abierto, pausar y reanudar
     cambian el cartel al toque, y un 409 se lee con el porqué del backend.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import pytest

from backend.application.DiagnosticoPlanificacion import diagnosticos_de_pausas
from backend.core.permisos_rutas import POLITICAS
from backend.domain.PausaOrden import MOTIVO_TEXTO, MOTIVOS, PausaOrden

RAIZ = Path(__file__).resolve().parents[2]
FRONT = RAIZ / "frontend" / "src"
NODE_MODULES = RAIZ / "frontend" / "node_modules"


def _leer(relativo: str) -> str:
    return (FRONT / relativo).read_text(encoding="utf-8")


pytestmark = pytest.mark.skipif(not FRONT.exists(), reason="sin el frontend en el repo")


# ─────────────────────── 1 y 2. la pantalla existe ───────────────────────

def test_el_frontend_llama_a_las_rutas_de_pausas():
    lib = _leer("lib/pausas.ts") + _leer("components/pausas/PausasDeLaOT.tsx")
    for ruta in ("/ordenes/${idOrden}/pausar", "/ordenes/${idOrden}/reanudar",
                 "/ordenes-pausadas", "/ordenes/${idOrden}/pausas"):
        assert f"${{API_URL}}{ruta}" in lib, f"nadie en el front llama a {ruta}"


def test_la_ficha_de_la_ot_y_las_listas_muestran_las_pausas():
    assert "<PausasDeLaOT" in _leer("components/CreateWorkOrderModal.tsx"), \
        "la ficha de la OT no tiene Pausar / Reanudar"
    for lista in ("components/UnplannedWorkOrdersList.tsx",
                  "components/planning/PlanningListTable.tsx",
                  "app/operaciones/_components/TodasLasOrdenes.tsx"):
        assert "<MarcaPausada" in _leer(lista), f"{lista} no muestra el cartel de «Pausada»"
    assert "<AvisoPausadasEnElPlan" in _leer("components/planning/PlanningPreviewScreen.tsx")


def test_el_aviso_del_planificador_manda_a_un_boton_que_esta():
    pausa = PausaOrden(id=1, id_orden_trabajo=10, motivo="FALTA_MATERIAL",
                       desde=datetime(2026, 9, 22, 10, 30))
    (aviso,) = diagnosticos_de_pausas([{"orden_id": 10, "numero": 15279, "pausa": pausa,
                                        "alcance": "ot", "procesos": 1, "minutos": 60}])
    donde = aviso["soluciones"][0]["donde"]
    assert "Reanudar" in donde and "la OT" in donde
    panel = _leer("components/pausas/PausasDeLaOT.tsx")
    assert re.search(r"<Play[^>]*/>\s*Reanudar\s*</Button>", panel), \
        "el aviso manda a «Reanudar» y el panel no tiene ese botón"


# ─────────────────────── 3. permisos ───────────────────────

def test_los_botones_piden_lo_mismo_que_el_backend():
    politica = POLITICAS["pausas"]
    (requisito,) = politica.escribir
    assert (requisito.seccion, requisito.nivel) == ("operaciones_ordenes", "write")
    panel = _leer("components/pausas/PausasDeLaOT.tsx")
    assert 'puedeSeccion("operaciones_ordenes", "write")' in panel
    # Y sin ese permiso no hay ni «Pausar…» ni «Reanudar».
    assert "puedeEscribir && sePuedePausar" in panel
    assert "puedeReanudar={puedeEscribir" in panel


# ─────────────────────── 4 y 5. el store, corrido con node ───────────────────────

DRIVER = r"""
const p = require('./pausas.js');
const respuestas = [];
global.fetch = async (url, init) => {
  const r = respuestas.shift();
  return {
    ok: r.status < 300, status: r.status,
    json: async () => r.body, text: async () => JSON.stringify(r.body),
  };
};
(async () => {
  const salida = { motivos: p.MOTIVOS_PAUSA };

  // Backend de antes: 404.
  respuestas.push({ status: 404, body: {} });
  await p.refrescarPausas();
  salida.viejo = p.__foto();

  // Backend nuevo: una abierta de la OT 10, una de un paso de la 11 y una cerrada.
  respuestas.push({ status: 200, body: { status: true, data: [
    { id: 1, id_orden_trabajo: 10, alcance: 'ot', abierta: true },
    { id: 2, id_orden_trabajo: 11, alcance: 'paso', id_otp: 202, abierta: true },
    { id: 3, id_orden_trabajo: 12, alcance: 'ot', abierta: false },
  ] } });
  await p.refrescarPausas();
  const f = p.__foto();
  salida.nuevo = { estado: f.estado, ots: [...f.porOt.keys()].sort() };

  // Pausar la 12 y reanudar la 10: cambia al toque.
  p.aplicarPausa({ id: 4, id_orden_trabajo: 12, alcance: 'ot', abierta: true });
  p.aplicarPausa({ id: 1, id_orden_trabajo: 10, alcance: 'ot', abierta: false });
  salida.despues = [...p.__foto().porOt.keys()].sort();

  // Un 409 se lee con el porqué del backend.
  respuestas.push({ status: 409, body: { errors: [{ message: 'La OT 15279 ya está pausada.' }] } });
  try { await p.pausar(10, { motivo: 'OTRO', observacion: 'x', id_otp: null }); salida.error = null; }
  catch (e) { salida.error = e.message; }

  console.log(JSON.stringify(salida));
})();
"""


def _hay_node() -> bool:
    return bool(shutil.which("node")) and (NODE_MODULES / "typescript").exists()


TRANSPILAR = r"""
const ts = require('typescript');
const fs = require('fs');
const [, , origen, destino] = process.argv;
const salida = ts.transpileModule(fs.readFileSync(origen, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
});
fs.writeFileSync(destino, salida.outputText);
"""


@pytest.fixture(scope="module")
def store():
    if not _hay_node():
        pytest.skip("hace falta node y el typescript del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "transpilar.js").write_text(TRANSPILAR)
        (tmp / "node_modules" / "@" / "lib").mkdir(parents=True)

        def _transpilar(origen: Path, destino: Path):
            subprocess.run(["node", "transpilar.js", str(origen), str(destino)], cwd=tmp,
                           check=True, capture_output=True, text=True, timeout=60,
                           env={"NODE_PATH": str(NODE_MODULES), "PATH": _path()})

        _transpilar(FRONT / "config.ts", tmp / "node_modules" / "@" / "config.js")
        _transpilar(FRONT / "lib" / "utils.ts", tmp / "node_modules" / "@" / "lib" / "utils.js")
        _transpilar(FRONT / "lib" / "pausas.ts", tmp / "pausas.js")
        # La foto del store, sólo para esta prueba: se lee con la misma función que
        # le pasa al hook de React (useSyncExternalStore).
        js = (tmp / "pausas.js").read_text()
        js += "\nexports.__foto = () => foto;\n"
        (tmp / "pausas.js").write_text(js)
        (tmp / "driver.js").write_text(DRIVER)
        r = subprocess.run(["node", "driver.js"], cwd=tmp, capture_output=True, text=True,
                           timeout=60, env={"NODE_PATH": str(NODE_MODULES), "PATH": _path()})
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout.strip().splitlines()[-1])


def _path() -> str:
    return os.environ.get("PATH", "")


def test_los_motivos_de_la_pantalla_son_los_del_backend(store):
    assert [m["codigo"] for m in store["motivos"]] == list(MOTIVOS)
    assert {m["codigo"]: m["texto"] for m in store["motivos"]} == MOTIVO_TEXTO


def test_con_un_backend_de_antes_las_pausas_se_ocultan(store):
    assert store["viejo"]["estado"] == "no"


def test_lo_pausado_agrupa_solo_lo_abierto(store):
    assert store["nuevo"] == {"estado": "si", "ots": [10, 11]}


def test_pausar_y_reanudar_cambian_el_cartel_al_toque(store):
    assert store["despues"] == [11, 12]


def test_un_409_se_lee_con_el_porque_del_backend(store):
    assert store["error"] == "La OT 15279 ya está pausada."
