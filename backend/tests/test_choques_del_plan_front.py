"""La pantalla avisa cuando una persona o una máquina quedan en dos pasos a la vez.

Reunión con Lucas del 28/10/2026. Corrigiendo a mano el plan de las 29 OT, Alejandro
quedó guardado a las 07:00 del 2/11 en la Fresadora 2 (OT 15981) y en la Van Norman
(OT 15982), y con un torneado de la 15895 metido adentro de su fresado de 300 minutos.
El planificador no encima a nadie; el retoque a mano deja el horario donde estaba y no
miraba lo demás.

`frontend/src/lib/choquesDelPlan.ts` dice qué filas se pisan. Este test lo compila con
el tsc del repo, lo corre con node y verifica, con las filas reales de ese plan:

- que marca a Alejandro en los pasos que se pisan, y a nadie más de esas OT;
- que un paso en partes (el planificador lo corta en tramos y mete otras cosas en el
  medio) NO es choque mientras lo de adentro entre en sus huecos: el FRESADO CNC de la
  13028, 3300 minutos en 4022, con otras OT en la misma máquina;
- que ir seguido (uno termina 07:20 y el otro arranca 07:20) no es choque;
- que dos planes distintos no se comparan;
- que la lista de personas dice quién está ocupado a esa hora antes de elegir.

Es sólo un test: no toca el backend ni se deploya.
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

ALEJANDRO, GUSTAVO, MATIAS = 34, 37, 40
FRESADORA_1, FRESADORA_2, VAN_NORMAN, TORNO_2, FRESADORA_CNC = 9, 10, 11, 2, 12


def fila(clave, ot, proceso, op, maq, desde, hasta, duracion=None, plan="p"):
    return {
        "clave": clave, "ot": ot, "proceso": proceso, "id_operario": op, "id_maquinaria": maq,
        "desde": desde, "hasta": hasta, "duracion": hasta - desde if duracion is None else duracion,
        "plan": plan, "inicio": None, "fin": None,
    }


# El plan guardado el 28/10 a las 17:07, en minutos del plan (las filas de Alejandro y
# lo que las rodea).
GUARDADO = [
    fila("a1", 15981, "PREPARACION DE FRESADORA", ALEJANDRO, FRESADORA_2, 0, 20),
    fila("a2", 15982, "PREPARACION DE FRESADORA", ALEJANDRO, VAN_NORMAN, 0, 20),
    fila("a3", 15982, "FRESADO CONVENCIONAL", ALEJANDRO, VAN_NORMAN, 20, 470, 300),
    fila("a4", 15981, "FRESADO CONVENCIONAL", ALEJANDRO, FRESADORA_2, 20, 80),
    fila("a5", 15895, "PREPARACION DE TORNO", ALEJANDRO, TORNO_2, 80, 100),
    fila("a6", 15895, "TORNEADO", ALEJANDRO, TORNO_2, 100, 220),
    fila("a7", 15981, "EMBALADO", 46, None, 6125, 6135),
    # Gustavo sigue con lo suyo, seguido y sin pisarse.
    fila("g1", 15816, "PREPARACION DE TORNO", GUSTAVO, 4, 155, 175),
    fila("g2", 15816, "TORNEADO", GUSTAVO, 4, 175, 295),
]

# Lo que calculó el planificador para la FRESADORA CNC: pasos en partes con otros adentro.
EN_PARTES = [
    fila("c1", 15243, "FRESADO CNC", MATIAS, FRESADORA_CNC, 1390, 1814, 420),
    fila("c2", 15243, "FRESADO CNC", MATIAS, FRESADORA_CNC, 1814, 6466, 420),
    fila("c3", 15985, "PROGRAMACION FRESADORA CNC", MATIAS, FRESADORA_CNC, 2024, 2054),
    fila("c4", 15985, "FRESADO CNC", MATIAS, FRESADORA_CNC, 2054, 2084),
    fila("c5", 15984, "PROGRAMACION FRESADORA CNC", MATIAS, FRESADORA_CNC, 2084, 2114),
    fila("c6", 15984, "FRESADO CNC", MATIAS, FRESADORA_CNC, 2114, 6136, 3300),
    fila("c7", 14306, "FRESADO CNC", MATIAS, FRESADORA_CNC, 1708, 1709),
]

DRIVER = """
const m = require('./choquesDelPlan.js');
const { guardado, enPartes, ids } = JSON.parse(process.argv[2]);
const resumen = mapa => Object.fromEntries([...mapa].map(([k, cs]) =>
    [k, cs.map(c => c.recurso + ':' + c.con.clave)]));
const r = {};
r.guardado = resumen(m.choquesDelPlan(guardado));
r.en_partes = resumen(m.choquesDelPlan(enPartes));
// El mismo choque de a1/a2, pero en dos planes distintos.
r.otro_plan = resumen(m.choquesDelPlan([guardado[0], { ...guardado[1], plan: 'otro' }]));
// Antes de elegir: Gustavo para la preparación de la 15981, y Alejandro.
const sinA1 = guardado.filter(f => f.clave !== 'a1');
r.ocupado_gustavo = m.ocupadoEn(sinA1, 'persona', ids.GUSTAVO, guardado[0]).map(t => t.clave);
r.ocupado_alejandro = m.ocupadoEn(sinA1, 'persona', ids.ALEJANDRO, guardado[0]).map(t => t.clave);
r.libres_a3 = m.libres(guardado[2]);
r.en_partes_a3 = m.enPartes(guardado[2]);
console.log(JSON.stringify(r));
"""


@pytest.fixture(scope="module")
def r():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "choquesDelPlan.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck", "--strict"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"choquesDelPlan.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        datos = {"guardado": GUARDADO, "enPartes": EN_PARTES,
                 "ids": {"GUSTAVO": GUSTAVO, "ALEJANDRO": ALEJANDRO}}
        salida = subprocess.run(
            ["node", "driver.js", json.dumps(datos)],
            cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
        )
        return json.loads(salida.stdout)


def test_alejandro_en_dos_maquinas_a_la_misma_hora(r):
    g = r["guardado"]
    assert g["a1"] == ["persona:a2"]
    assert g["a2"] == ["persona:a1"]


def test_lo_metido_adentro_del_fresado_de_300(r):
    # 450 minutos de punta a punta para 300 de trabajo: 150 libres, y adentro hay 200
    # (el fresado de 60 de la 15981, la preparación y el torneado de la 15895).
    assert r["libres_a3"] == 150 and r["en_partes_a3"] is True
    g = r["guardado"]
    assert sorted(g["a3"]) == ["persona:a4", "persona:a5", "persona:a6"]
    for clave in ("a4", "a5", "a6"):
        assert g[clave] == ["persona:a3"]


def test_ir_seguido_no_es_choque(r):
    g = r["guardado"]
    assert "g1" not in g and "g2" not in g and "a7" not in g


def test_un_paso_en_partes_con_lugar_no_es_choque(r):
    assert r["en_partes"] == {}


def test_dos_planes_no_se_comparan(r):
    assert r["otro_plan"] == {}


def test_la_lista_dice_quien_esta_ocupado(r):
    assert r["ocupado_gustavo"] == []
    assert r["ocupado_alejandro"] == ["a2"]
