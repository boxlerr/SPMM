"""Las horas extra «solo en este plan» viajan bien desde la vista previa.

Lucas, 28/10/2026: «forzame horas extras» o un eventual del grupo Z cuando una máquina no
alcanza. El backend las propone en el aviso de la máquina (acciones `sabado` y
`eventual`) y `frontend/src/lib/ajustesPlan.ts` las convierte en lo que entiende
`/planificar`. Este test compila esa lib con el tsc del repo, la corre con node y mira:

- el cuerpo: `sabados` con cada (persona, sábado) una sola vez y `eventuales` con el
  puesto VACANTE; sin horas extra el cuerpo es exactamente el de antes;
- la clave: el mismo sábado pedido dos veces es el mismo ajuste, otro sábado no;
- que no se pueden «Guardar en Recursos»;
- el texto que se lee en el botón y en la tira de ajustes;
- y que el panel de carga cuenta el sábado de horas extra (antes salía «pasado»).
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

VEGA, VACANTE_CNC = 37, 20

SABADO_VEGA = {
    "tipo": "sabado", "id": 12, "nombre": "FRESADORA CNC",
    "objetivos": [
        {"id": VEGA, "nombre": "Matias Vega", "fecha": "2026-11-07", "maquinas": [12]},
        {"id": VEGA, "nombre": "Matias Vega", "fecha": "2026-11-14", "maquinas": [12]},
    ],
}
EVENTUAL = {
    "tipo": "eventual", "id": VACANTE_CNC, "nombre": "Eventual OFICIAL CNC",
    "objetivos": [{"id": VACANTE_CNC, "nombre": "Eventual OFICIAL CNC", "fecha": "2026-11-07", "maquinas": [12]}],
}
RANGO = {"tipo": "maquinaria", "id": 3, "nombre": "PRENSA 1",
         "objetivos": [{"id": 3, "nombre": "PRENSA 1", "rangos": [1, 2], "suma": ["OFICIAL"], "suma_ids": [2]}]}

DRIVER = r"""
const A = require("./ajustesPlan.js");
const D = require("./diasHabiles.js");
const HORARIO = { dias_trabajo: "MON,TUE,WED,THU,FRI", hora_inicio: "07:00", hora_fin: "16:00", min_desayuno: 15, min_almuerzo: 30 };
const d = JSON.parse(process.argv[2]);
const aj = (accion) => ({ clave: A.claveDeAjuste(accion), titulo: "t", descripcion: "", accion });
const out = {
  solo_rango: A.payloadDeAjustes([aj(d.rango)]),
  con_sabado: A.payloadDeAjustes([aj(d.sabado), aj(d.eventual), aj(d.sabado)]),
  sin_nada: A.payloadDeAjustes([]) === undefined,
  clave_sabado: A.claveDeAjuste(d.sabado),
  clave_sabado_otro_orden: A.claveDeAjuste({ ...d.sabado, objetivos: [...d.sabado.objetivos].reverse() }),
  clave_un_sabado: A.claveDeAjuste({ ...d.sabado, objetivos: d.sabado.objetivos.slice(0, 1) }),
  objetivos_sabado: A.objetivosDeAjuste(d.sabado),
  se_guarda: [d.sabado, d.eventual, d.rango].map(A.seGuardaEnRecursos),
  texto_sabado: A.descripcionDeAccion(d.sabado),
  texto_eventual: A.descripcionDeAccion(d.eventual),
  corta_sabado: A.etiquetaCortaDeAccion(d.sabado),
  cap_sin: D.capacidadEnElPeriodo(HORARIO, "2026-10-29", "2026-10-31"),
  cap_con: D.capacidadEnElPeriodo({ ...HORARIO, sabados_extra: ["2026-10-31"] }, "2026-10-29", "2026-10-31"),
  cap_eventual: D.capacidadEnElPeriodo({ solo_sabados_extra: true, sabados_extra: ["2026-10-31"] }, "2026-10-26", "2026-10-31"),
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def front():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "ajustesPlan.ts"), str(FRONT_LIB / "diasHabiles.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, f"ajustesPlan.ts no compila:\n{compilado.stdout}\n{compilado.stderr}"
        (Path(tmp) / "driver.js").write_text(DRIVER)
        datos = {"sabado": SABADO_VEGA, "eventual": EVENTUAL, "rango": RANGO}
        salida = subprocess.run(["node", "driver.js", json.dumps(datos)],
                                cwd=tmp, capture_output=True, text=True, timeout=120, check=True)
        return json.loads(salida.stdout)


def test_sin_horas_extra_el_cuerpo_es_el_de_antes(front):
    assert front["sin_nada"] is True
    assert set(front["solo_rango"]) == {"procesos", "maquinarias", "skills_nativas"}


def test_el_cuerpo_lleva_cada_sabado_una_vez_y_el_eventual(front):
    cuerpo = front["con_sabado"]
    assert cuerpo["sabados"] == [
        {"operario_id": VACANTE_CNC, "fecha": "2026-11-07", "maquinarias": [12]},
        {"operario_id": VEGA, "fecha": "2026-11-07", "maquinarias": [12]},
        {"operario_id": VEGA, "fecha": "2026-11-14", "maquinarias": [12]},
    ]
    assert cuerpo["eventuales"] == [VACANTE_CNC]


def test_la_clave_es_por_persona_y_sabado(front):
    assert front["clave_sabado"] == front["clave_sabado_otro_orden"]
    assert front["clave_sabado"] != front["clave_un_sabado"]
    assert front["objetivos_sabado"] == ["sabado:37:2026-11-07", "sabado:37:2026-11-14"]


def test_las_horas_extra_no_se_guardan_en_recursos(front):
    assert front["se_guarda"] == [False, False, True]


def test_lo_que_dice_el_boton(front):
    assert front["texto_sabado"] == "Matias Vega hace horas extra los sábados 7/11 y 14/11 en FRESADORA CNC, de 7 a 12"
    assert front["texto_eventual"] == "Se suma un eventual OFICIAL CNC el sábado 7/11, de 7 a 12"
    assert front["corta_sabado"] == "Matias Vega: los sábados 7/11 y 14/11"


def test_el_panel_de_carga_cuenta_el_sabado_de_horas_extra(front):
    """Jueves, viernes y el sábado 31/10: 495 + 495 y, con horas extra, 300 más."""
    assert front["cap_sin"]["minutos"] == 990
    assert front["cap_con"]["minutos"] == 1290 and front["cap_con"]["dias"] == 3
    # El eventual: sólo su sábado, aunque la semana entera esté en el período.
    assert front["cap_eventual"]["minutos"] == 300 and front["cap_eventual"]["dias"] == 1
