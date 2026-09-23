"""Los días hábiles de la vista previa son los que trabaja la gente, no los del almanaque.

Julián, 23/09/2026: «se quedaba trabada en 4,9 cuando en realidad son más, arreglalo
que diga los días reales».

El plan de Lucas del 23/9 iba del jueves 24/9 a las 07:00 al martes 6/10 a las 10:00 y
la vista previa decía «11 días hábiles». Son 9: la cuenta sólo sacaba los domingos y
dejaba los sábados «porque pueden trabajarse», pero todos los operarios tienen cargado
de lunes a viernes. Y el panel de carga comparaba lo que el plan le da a cada uno contra
44 h fijas de una semana: Guillermo salía con 72,5 h / 44 h en un plan de dos semanas,
cuando en esos 9 días él trabaja 9 × 8,25 = 74,25 h.

La cuenta vive en `frontend/src/lib/diasHabiles.ts`. Este test la compila con el tsc del
repo, la corre y la compara contra lo que usa el backend para lo mismo
(`dias_trabajo_de`): si una lee los días de trabajo distinto que la otra, la pantalla
vuelve a contar sábados que nadie trabaja.
"""
import json
import shutil
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path

import pytest

from backend.domain.AusenciaOperario import dias_trabajo_de

RAIZ = Path(__file__).resolve().parents[2]
FRONT_LIB = RAIZ / "frontend" / "src" / "lib"
TSC = RAIZ / "frontend" / "node_modules" / ".bin" / "tsc"

# Lo que tiene cargado cada operario del taller hoy, más los casos raros que admite la
# columna: con sábado, salteados, en minúscula, con basura y vacío.
CSVS = [
    "MON,TUE,WED,THU,FRI",
    "MON,TUE,WED,THU,FRI,SAT",
    "MON,WED,FRI",
    "mon, tue ,wed",
    "SAT",
    "XXX,MON",
    "",
]

GUILLERMO = {
    "dias_trabajo": "MON,TUE,WED,THU,FRI",
    "hora_inicio": "07:00",
    "hora_fin": "16:00",
    "min_desayuno": 15,
    "min_almuerzo": 30,
}

DRIVER = """
const m = require('./diasHabiles.js');
const [, , csvs, guillermo] = process.argv;
const op = JSON.parse(guillermo);
const lv = m.LUNES_A_VIERNES;
const desde = '2026-09-24T07:00:00';
const hasta = '2026-10-06T10:00:00';
console.log(JSON.stringify({
    dias: JSON.parse(csvs).map(c => [...m.diasDeTrabajo(c)].sort()),
    lucas: m.contarDiasHabiles(desde, hasta, [], lv),
    lucas_taller: m.contarDiasHabiles(desde, hasta, [], m.diasQueTrabajaElTaller([op, op])),
    con_feriado: m.contarDiasHabiles(desde, hasta, ['2026-10-05'], lv),
    capacidad: m.capacidadEnElPeriodo(op, desde, hasta, []),
    capacidad_sabado: m.capacidadEnElPeriodo(
        Object.assign({}, op, { dias_trabajo: 'MON,TUE,WED,THU,FRI,SAT' }), desde, hasta, []),
    sin_horario: m.capacidadEnElPeriodo({}, desde, hasta, []),
    al_reves: m.contarDiasHabiles(hasta, desde, [], lv),
}));
"""


@pytest.fixture(scope="module")
def front():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "diasHabiles.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"diasHabiles.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        salida = subprocess.run(
            ["node", "driver.js", json.dumps(CSVS), json.dumps(GUILLERMO)],
            cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
        )
        return json.loads(salida.stdout)


def test_el_plan_de_lucas_son_9_dias_habiles(front):
    """Jue 24/9 → mar 6/10: 24, 25, 28, 29, 30, 1, 2, 5 y 6. No 11."""
    assert front["lucas"] == 9
    # Con los días que tiene cargados la gente (todos de lunes a viernes), lo mismo.
    assert front["lucas_taller"] == 9
    # Y la cuenta del backend para esos días de trabajo da igual.
    dias = dias_trabajo_de(GUILLERMO["dias_trabajo"])
    d, habiles = date(2026, 9, 24), 0
    while d <= date(2026, 10, 6):
        habiles += d.weekday() in dias
        d += timedelta(days=1)
    assert habiles == 9


def test_un_feriado_en_el_medio_no_es_dia_habil(front):
    assert front["con_feriado"] == 8


def test_los_dias_de_trabajo_se_leen_igual_que_en_el_backend(front):
    """`Date.getDay()` cuenta Dom = 0 y Python Lun = 0: se traduce antes de comparar."""
    for csv, del_front in zip(CSVS, front["dias"]):
        traducidos = {(d + 6) % 7 for d in del_front}
        assert traducidos == dias_trabajo_de(csv), f"«{csv}» se lee distinto en el front"


def test_la_capacidad_de_guillermo_en_el_plan_son_74_horas(front):
    """El panel compara sus 72,5 h contra esto, no contra 44 h."""
    cap = front["capacidad"]
    assert cap["dias"] == 9
    assert cap["jornada"] == 495
    assert cap["minutos"] == 9 * 495  # 74,25 h


def test_el_sabado_cuenta_solo_para_quien_lo_trabaja_y_de_07_a_12(front):
    cap = front["capacidad_sabado"]
    assert cap["dias"] == 11  # los dos sábados del medio
    assert cap["minutos"] == 9 * 495 + 2 * 300


def test_sin_horario_cargado_va_la_jornada_del_taller(front):
    assert front["sin_horario"]["jornada"] == 495
    assert front["sin_horario"]["dias"] == 9


def test_fechas_al_reves_no_cuelgan_ni_inventan(front):
    assert front["al_reves"] == 0
