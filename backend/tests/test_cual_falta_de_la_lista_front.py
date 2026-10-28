"""Al pegar una lista de OT en el buscador, la pantalla dice cuáles no están.

Reunión con Lucas del 28/10/2026: pegó en el Paso 1 las 29 OT que le pasó Claude, se
tildaron 28 y no había cómo saber cuál faltaba (era la 15769, terminada en el Integral).
`numerosQueNoEstan` (frontend/src/lib/busqueda.ts) compara el número EXACTO: buscar
«1598» encuentra la 15981 en la tabla, pero esa no es la que se pidió.

Compila el .ts con el tsc del repo y lo corre con node. No toca el backend.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
FRONT_LIB = RAIZ / "frontend" / "src" / "lib"
TSC = RAIZ / "frontend" / "node_modules" / ".bin" / "tsc"

OTS = [{"id": 13025, "id_otvieja": 15981}, {"id": 13026, "id_otvieja": 15982}, {"id": 500}]

DRIVER = """
const { numerosQueNoEstan } = require('./busqueda.js');
const ots = JSON.parse(process.argv[2]);
console.log(JSON.stringify({
  lista: numerosQueNoEstan('15981 15982 15769', ots),
  de_claude: numerosQueNoEstan('**OT:** 15981, 15769 y 15769', ots),
  parcial: numerosQueNoEstan('1598', ots),
  interno: numerosQueNoEstan('500 13025', ots),
  texto: numerosQueNoEstan('ceramica', ots),
  vacio: numerosQueNoEstan('', ots),
}));
"""


@pytest.fixture(scope="module")
def r():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "busqueda.ts"), "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs", "--skipLibCheck", "--strict"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, compilado.stdout + compilado.stderr
        (Path(tmp) / "driver.js").write_text(DRIVER)
        salida = subprocess.run(["node", "driver.js", json.dumps(OTS)], cwd=tmp,
                                capture_output=True, text=True, timeout=60, check=True)
        return json.loads(salida.stdout)


def test_dice_cual_falta(r):
    assert r["lista"] == {"pedidos": 3, "faltan": [15769]}


def test_el_renglon_de_claude_y_repetidos(r):
    assert r["de_claude"] == {"pedidos": 2, "faltan": [15769]}


def test_un_numero_parcial_no_cuenta_como_encontrado(r):
    assert r["parcial"] == {"pedidos": 1, "faltan": [1598]}


def test_el_numero_interno_tambien_vale(r):
    assert r["interno"] == {"pedidos": 2, "faltan": []}


def test_un_texto_no_es_una_lista(r):
    assert r["texto"] is None and r["vacio"] is None
