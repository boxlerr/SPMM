"""Recursos › Procesos, la columna «Recurso maquinaria»: lo que la pantalla y el Excel dicen.

La resolución en sí (qué máquinas usa el planificador para cada proceso) se prueba en
`test_maquinas_del_proceso.py`, contra el solver. Acá se prueba la otra mitad: cómo
`frontend/src/lib/maquinasDelProceso.ts` traduce lo que manda el backend a lo que se
dibuja y se exporta, incluido un backend viejo que todavía no manda los campos nuevos
(el deploy del backend es a mano y va detrás del de la pantalla).

Se compila con el tsc del repo y se corre con node, como `test_aviso_en_recursos_front`.
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

DRIVER = r"""
const m = require('./maquinasDelProceso.js');
const r = (id, nombre) => ({ id, nombre });
const F1 = r(9, 'FRESADORA 1'), F2 = r(10, 'FRESADORA 2'), VN = r(11, 'FRESADORA VAN NORMAN');
const PLE = r(15, 'PLEGADORA'), P1 = r(21, 'PRENSA 1'), P2 = r(22, 'PRENSA 2');

const casos = {
    // «FRESADORA F6»: nadie cargó nada y el backend manda lo que deduce del nombre.
    nombre: { maquinas: [], maquinas_origen: 'nombre', maquinas_efectivas: [F1, F2, VN], maquinas_sin_rango: [], maquinas_motivo: null },
    // «ENDERESAR DE BASES»: tres cargadas y el rango del proceso no acepta la plegadora.
    cargada: { maquinas: [PLE, P1, P2], maquinas_origen: 'cargada', maquinas_efectivas: [P1, P2], maquinas_sin_rango: [PLE], maquinas_motivo: null },
    aMano: { maquinas: [], maquinas_origen: 'a_mano', maquinas_efectivas: [], maquinas_sin_rango: [], maquinas_motivo: null },
    aManoConCargadas: { maquinas: [P1], maquinas_origen: 'a_mano', maquinas_efectivas: [], maquinas_sin_rango: [], maquinas_motivo: null },
    sinFamilia: { maquinas: [], maquinas_origen: 'ninguna', maquinas_efectivas: [], maquinas_sin_rango: [], maquinas_motivo: 'sin_familia' },
    sinMaquina: { maquinas: [], maquinas_origen: 'ninguna', maquinas_efectivas: [], maquinas_sin_rango: [], maquinas_motivo: 'sin_maquina' },
    porRango: { maquinas: [], maquinas_origen: 'ninguna', maquinas_efectivas: [], maquinas_sin_rango: [], maquinas_motivo: 'rango' },
    // Backend sin desplegar: sólo `maquinas`, a veces ni eso.
    viejoConCargadas: { maquinas: [P1, P2] },
    viejoSinNada: { maquinas: [] },
    viejoSinCampo: {},
};

const salida = {};
for (const [k, cob] of Object.entries(casos)) {
    const res = m.resumenDeMaquinas(cob);
    salida[k] = {
        origen: res.origen,
        maquinas: res.maquinas.map((x) => x.nombre),
        sinRango: res.sinRango.map((x) => x.nombre),
        cargadasSinUso: res.cargadasSinUso.map((x) => x.nombre),
        motivo: res.motivo,
        origenEnPalabras: m.origenEnPalabras(res),
        maquinasEnPalabras: m.maquinasEnPalabras(res),
    };
}
console.log(JSON.stringify(salida));
"""


@pytest.fixture(scope="module")
def front():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "maquinasDelProceso.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck", "--strict"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"maquinasDelProceso.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        salida = subprocess.run(
            ["node", "driver.js"], cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
        )
        return json.loads(salida.stdout)


def test_fresadora_f6_muestra_las_que_deduce_del_nombre(front):
    c = front["nombre"]
    assert c["origen"] == "nombre"
    assert c["maquinas"] == ["FRESADORA 1", "FRESADORA 2", "FRESADORA VAN NORMAN"]
    assert c["origenEnPalabras"] == "Deducida del nombre del proceso"
    assert c["maquinasEnPalabras"] == "FRESADORA 1, FRESADORA 2, FRESADORA VAN NORMAN"


def test_las_cargadas_se_muestran_todas_y_la_que_el_rango_no_acepta_va_avisada(front):
    """Se dibujan las TRES cargadas —es lo que el taller respondió—, y la plegadora sale
    marcada porque el planificador la descarta."""
    c = front["cargada"]
    assert c["origen"] == "cargada"
    assert c["maquinas"] == ["PLEGADORA", "PRENSA 1", "PRENSA 2"]
    assert c["sinRango"] == ["PLEGADORA"]
    assert c["origenEnPalabras"] == "Cargada en Recursos"
    assert c["maquinasEnPalabras"] == "PLEGADORA (su rango no la acepta), PRENSA 1, PRENSA 2"


def test_lo_que_va_a_mano_no_usa_maquina_y_avisa_si_tenia_cargadas(front):
    assert front["aMano"]["origen"] == "a_mano"
    assert front["aMano"]["origenEnPalabras"] == "No usa máquina"
    assert front["aMano"]["maquinasEnPalabras"] == ""
    assert front["aManoConCargadas"]["cargadasSinUso"] == ["PRENSA 1"], (
        "si alguien cargó una máquina en un proceso a mano, la fila tiene que decir que no se usa")


def test_cada_motivo_de_sin_maquina_se_dice_distinto(front):
    """Tienen arreglos distintos: cargar una máquina, o cambiar un rango."""
    assert front["sinFamilia"]["origenEnPalabras"] == "Sin máquina: el nombre no dice en cuál se hace"
    assert front["sinMaquina"]["origenEnPalabras"] == "Sin máquina: el taller no tiene una de ese tipo"
    assert front["porRango"]["origenEnPalabras"] == "Sin máquina: ninguna acepta el rango del proceso"
    assert front["sinFamilia"]["motivo"] == "sin_familia" and front["porRango"]["motivo"] == "rango"


def test_con_un_backend_sin_desplegar_la_fila_se_ve_como_antes(front):
    """Front nuevo y backend viejo (el deploy del backend es a mano): sin los campos
    nuevos se muestran las cargadas y, si no hay, ninguna resolución — nada inventado."""
    assert front["viejoConCargadas"]["origen"] == "cargada"
    assert front["viejoConCargadas"]["maquinas"] == ["PRENSA 1", "PRENSA 2"]
    for k in ("viejoSinNada", "viejoSinCampo"):
        assert front[k]["origen"] == "sin_dato", k
        assert front[k]["maquinas"] == [] and front[k]["origenEnPalabras"] == "", k
