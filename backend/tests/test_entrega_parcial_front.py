"""Las entregas parciales de la vista previa (`frontend/src/lib/entregaParcial.ts`).

Lucas (27/10/2026): «son 66 piezas total pero tengo que entregar 24 para el jueve». La
vista previa marca la entrega, la manda en `ajustes_del_plan.entregas_parciales` y saca de
las filas del plan con cuáles se calculó. Este test compila el .ts con el tsc del repo, lo
corre con node y verifica:

- que el pedido sin entregas sale EXACTAMENTE como antes (`undefined` si no hay ajustes);
- que las entregas viajan junto a los ajustes que haya, sin pisarlos;
- que con cuáles se calculó se lee de las filas, una vez por OT;
- qué cuenta como pendiente (nueva, cambiada, sacada) y qué no;
- los textos que ve el taller.

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

AJUSTES = {"procesos": {"10": [7, 9]}, "maquinarias": {}, "skills_nativas": []}

DRIVER = """
const m = require('./entregaParcial.js');
const [, , datos] = process.argv;
const { ajustes } = JSON.parse(datos);
const r = {};
const e24 = { unidades: 24, fecha: '2026-10-29' };

r.sin_nada = m.conEntregasParciales(undefined, {}) === undefined;
r.sin_entregas_mismos_ajustes = m.conEntregasParciales(ajustes, {}) === ajustes;
r.solo_entregas = m.conEntregasParciales(undefined, { 15984: { unidades: 24 } });
r.con_ajustes = m.conEntregasParciales(ajustes, { 15985: { unidades: 3 }, 15984: e24 });

r.de_las_filas = m.entregasDeLasFilas([
    { orden_id: 15984, entrega_parcial: { unidades: 24, faltan: 66, fecha: '2026-10-29' } },
    { orden_id: 15984, entrega_parcial: { unidades: 24, faltan: 66, fecha: '2026-10-29' } },
    { orden_id: 15985, entrega_parcial: null },
    { orden_id: 15892 },
]);

r.pendientes = m.entregasPendientes(
    { 15984: e24, 15985: { unidades: 3, fecha: null }, 15990: { unidades: 5 } },
    { 15984: { unidades: 24, fecha: '2026-10-29' }, 15985: { unidades: 2 }, 15991: { unidades: 1 } },
);
r.nada_pendiente = m.entregasPendientes({ 15984: { unidades: 24 } }, { 15984: { unidades: 24, fecha: null } });

r.misma_sin_fecha = m.mismaEntrega({ unidades: 24 }, { unidades: 24, fecha: null });
r.distinta_fecha = m.mismaEntrega({ unidades: 24, fecha: '2026-10-29' }, { unidades: 24, fecha: '2026-10-30' });

r.texto_con_total = m.textoDeEntrega(e24, 66);
r.texto_sin_total = m.textoDeEntrega({ unidades: 1 });
r.texto_sin_fecha = m.textoDeEntrega({ unidades: 24 }, 66);
r.dia = m.diaCorto('2026-10-29');

console.log(JSON.stringify(r));
"""


@pytest.fixture(scope="module")
def r():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "entregaParcial.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck", "--strict"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"entregaParcial.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        salida = subprocess.run(
            ["node", "driver.js", json.dumps({"ajustes": AJUSTES})],
            cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
        )
        return json.loads(salida.stdout)


def test_sin_entregas_el_pedido_es_el_de_antes(r):
    assert r["sin_nada"] is True
    assert r["sin_entregas_mismos_ajustes"] is True


def test_las_entregas_solas_llevan_ajustes_vacios(r):
    # El DTO del backend tiene los tres campos con valor por defecto, pero mandarlos
    # vacíos deja el cuerpo igual de legible que el de un pedido con ajustes.
    assert r["solo_entregas"] == {
        "procesos": {}, "maquinarias": {}, "skills_nativas": [],
        "entregas_parciales": {"15984": {"unidades": 24, "fecha": None}},
    }


def test_las_entregas_no_pisan_los_ajustes(r):
    assert r["con_ajustes"] == {
        **AJUSTES,
        "entregas_parciales": {
            "15984": {"unidades": 24, "fecha": "2026-10-29"},
            "15985": {"unidades": 3, "fecha": None},
        },
    }


def test_con_cuales_se_calculo_lo_dicen_las_filas(r):
    assert r["de_las_filas"] == {"15984": {"unidades": 24, "fecha": "2026-10-29"}}


def test_pendiente_es_nueva_cambiada_o_sacada(r):
    assert [(p["orden_id"], p.get("marcada"), p.get("calculada")) for p in r["pendientes"]] == [
        (15985, {"unidades": 3, "fecha": None}, {"unidades": 2}),   # cambiada
        (15990, {"unidades": 5}, None),                             # nueva
        (15991, None, {"unidades": 1}),                             # sacada
    ]
    assert r["nada_pendiente"] == []


def test_sin_fecha_y_fecha_vacia_son_lo_mismo(r):
    assert r["misma_sin_fecha"] is True
    assert r["distinta_fecha"] is False


def test_los_textos_del_taller(r):
    assert r["dia"] == "jue 29/10"
    assert r["texto_con_total"] == "24 de 66 piezas · para el jue 29/10"
    assert r["texto_sin_total"] == "1 pieza"
    assert r["texto_sin_fecha"] == "24 de 66 piezas"
