"""RF-19: lo que la solapa «Copias de seguridad» calcula sola (frontend/src/lib/copiasDeSeguridad.ts).

La pantalla no decide qué se restaura: eso lo revisa el backend. Pero sí dice el nombre
del archivo que se guarda, la fecha de la copia y si ya se puede apretar «Restaurar». Si
eso se separa del backend, la pantalla miente: guarda la copia con otro nombre, muestra
otra hora o deja apretar un botón que el servidor va a rechazar.

Se compila y se corre de verdad, con el tsc del repo (igual que test_permisos_front.py).
"""
import json
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import pytest

from backend.infrastructure.copias_de_seguridad import NOMBRE_DE_ARCHIVO, nombre_de_copia
from backend.presentation.CopiaSeguridadAPI import CONFIRMACION, _cabeceras_de_descarga

RAIZ = Path(__file__).resolve().parents[2]
FRONT_LIB = RAIZ / "frontend" / "src" / "lib"
TSC = RAIZ / "frontend" / "node_modules" / ".bin" / "tsc"

CUANDO = datetime(2026, 9, 22, 15, 30, 12)

DRIVER = r"""
const c = require('./copiasDeSeguridad.js');
const fs = require('fs');
const e = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const [a, me, d, h, mi] = e.local;
console.log(JSON.stringify({
  CONFIRMACION: c.CONFIRMACION,
  cabeceras: e.cabeceras.map((x) => c.nombreDeLaCabecera(x)),
  porDefecto: c.nombrePorDefecto(new Date(a, me - 1, d, h, mi, 12)),
  fechas: e.fechas.map((x) => c.fechaLegible(x)),
  confirmaciones: e.confirmaciones.map((x) => c.confirmacionValida(x)),
  tamanos: e.tamanos.map((x) => c.tamanoLegible(x)),
  numeros: e.numeros.map((x) => c.numero(x)),
  motivos: e.motivos.map((x) => c.motivoParaNoRestaurar(x)),
  cambian: ['reemplaza', 'vacia', 'conserva', 'sin_copia'].map((accion) => c.cambia({ accion })),
}));
"""


@pytest.fixture(scope="module")
def front():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    entrada = {
        "local": [2026, 9, 22, 15, 30],
        "cabeceras": [
            _cabeceras_de_descarga(nombre_de_copia(CUANDO))["Content-Disposition"],
            _cabeceras_de_descarga(nombre_de_copia(CUANDO, antes_de_restaurar=True))["Content-Disposition"],
            'attachment; filename="../../etc/passwd"',
            'attachment; filename="fotos.zip"',
            None,
            "",
        ],
        "fechas": [
            CUANDO.isoformat(timespec="seconds"),
            "2026-09-22 15:30:12",
            # Con zona (no debería venir): se muestra la hora que dice, sin correrla.
            "2026-09-22T15:30:12-03:00",
            None,
            "cualquier cosa",
        ],
        "confirmaciones": [CONFIRMACION, f"  {CONFIRMACION} ", "restaurar", "RESTAURA", ""],
        "tamanos": [0, 900, 1536, 3355443, 250 * 1024 * 1024, None, -1],
        "numeros": [0, 999, 1000, 1234567, None],
        "motivos": [
            {"confirmacion": CONFIRMACION, "hayCopiaAutomatica": True, "yaDescargo": False},
            {"confirmacion": "", "hayCopiaAutomatica": True, "yaDescargo": False},
            {"confirmacion": CONFIRMACION, "hayCopiaAutomatica": False, "yaDescargo": False},
            {"confirmacion": CONFIRMACION, "hayCopiaAutomatica": False, "yaDescargo": True},
        ],
    }
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "copiasDeSeguridad.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck", "--strict"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"copiasDeSeguridad.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        (Path(tmp) / "entrada.json").write_text(json.dumps(entrada))
        corrida = subprocess.run(
            ["node", "driver.js", "entrada.json"], cwd=tmp,
            capture_output=True, text=True, timeout=60, check=True,
        )
        return json.loads(corrida.stdout)


def test_la_misma_palabra_que_exige_el_servidor(front):
    assert front["CONFIRMACION"] == CONFIRMACION
    # El servidor hace strip(): lo mismo acá. Y en mayúsculas, como allá.
    assert front["confirmaciones"] == [True, True, False, False, False]


def test_el_archivo_se_guarda_con_el_nombre_del_servidor(front):
    assert front["cabeceras"][:2] == [
        nombre_de_copia(CUANDO),
        nombre_de_copia(CUANDO, antes_de_restaurar=True),
    ]
    # Lo que no tiene la forma de una copia no se usa como nombre.
    assert front["cabeceras"][2:] == [None, None, None, None]


def test_el_nombre_de_repuesto_es_el_mismo_que_arma_el_servidor(front):
    assert front["porDefecto"] == nombre_de_copia(CUANDO) == "spmm_backup_2026-09-22_1530.zip"
    assert NOMBRE_DE_ARCHIVO.match(front["porDefecto"])


def test_las_fechas_sin_zona_no_se_corren(front):
    assert front["fechas"] == [
        "22/09/2026 15:30", "22/09/2026 15:30", "22/09/2026 15:30",
        "fecha desconocida", "fecha desconocida",
    ]


def test_tamanos_y_numeros_como_se_escriben_aca(front):
    assert front["tamanos"] == ["0 bytes", "900 bytes", "1,5 KB", "3,2 MB", "250 MB", "—", "—"]
    assert front["numeros"] == ["0", "999", "1.000", "1.234.567", "—"]


def test_el_boton_dice_por_que_no_se_puede(front):
    sin_motivo, sin_palabra, sin_copia, descargada = front["motivos"]
    assert sin_motivo is None
    assert "RESTAURAR" in sin_palabra
    # Sin copia automática, primero hay que bajarla: es lo que el servidor va a pedir.
    assert "descargá la copia" in sin_copia
    assert descargada is None


def test_que_tablas_cambian(front):
    assert front["cambian"] == [True, True, False, False]
