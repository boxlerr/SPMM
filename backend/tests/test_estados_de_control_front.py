"""RF-11 en el front: lo que decide qué se ve, qué se filtra y qué se exporta.

La lógica vive en `frontend/src/lib/estadoControlOT.ts` (el recuadro de la ficha, los
chips de las listas, el filtro «Control» y las columnas del Exportar). Este test la
transpila con el TypeScript del repo, la corre con node y fija:

  · las ocho casillas van en el orden de la ficha vieja, y las cuatro «nuevas» del front
    son las mismas que agregó el backend (si se separan, una casilla se guarda y no se ve,
    o se ve y no se guarda);
  · con el backend de producción de hoy (3422285, sin los campos) ningún filtro deja
    pasar una OT salvo «Todas», y el Exportar deja vacío en vez de decir «No»: no se sabe,
    no es «no»;
  · quién la controló sólo sale si sigue controlada.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from backend.domain.OrdenTrabajo import CASILLAS_DE_CONTROL

RAIZ = Path(__file__).resolve().parents[2]
FUENTE = RAIZ / "frontend" / "src" / "lib" / "estadoControlOT.ts"
TYPESCRIPT = RAIZ / "frontend" / "node_modules" / "typescript"

DRIVER = r"""
const fs = require('fs');
const ts = require(process.argv[2]);
const js = ts.transpileModule(fs.readFileSync(process.argv[3], 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const m = {}; new Function('exports', 'require', js)(m, require);

const controlada = { controlado: 1, controlado_por: 'Lucas Longchamps', controlado_en: '2026-09-23T14:05:00',
    finalizado_para_pintar: 0, finalizado_tercerizacion_final: 1, finalizado_tercerizacion_intermedia: 0,
    finalizadoparcial: 1, cantidad_finalizada_parcial: 3 };
const sinControlar = { controlado: 0, controlado_por: 'Quedó de antes', controlado_en: '2026-09-01T10:00:00',
    finalizado_para_pintar: 1, finalizado_tercerizacion_final: 0, finalizado_tercerizacion_intermedia: 1,
    finalizadoparcial: 0, cantidad_finalizada_parcial: 5 };
const delBackendViejo = { finalizadoparcial: 1 };
const filas = { controlada, sinControlar, delBackendViejo };

const filtros = {};
for (const f of m.OPCIONES_FILTRO_CONTROL)
    filtros[f] = Object.keys(filas).filter(k => m.cumpleFiltroControl(filas[k], f));

const cols = m.columnasEstadoYControl();
const exporta = {};
for (const k of Object.keys(filas)) exporta[k] = Object.fromEntries(cols.map(c => [c.titulo, c.valor(filas[k], 0)]));

console.log(JSON.stringify({
    orden: m.CASILLAS_DE_ESTADO.map(c => c.clave),
    rotulos: m.CASILLAS_DE_ESTADO.map(c => c.rotulo),
    nuevas: m.CASILLAS_NUEVAS,
    conoce: Object.fromEntries(Object.keys(filas).map(k => [k, m.conoceEstadosDeControl(filas[k])])),
    filtros,
    chips: Object.fromEntries(Object.keys(filas).map(k => [k, m.etapasDe(filas[k]).map(e => e.corto)])),
    exporta,
    tipos: Object.fromEntries(cols.map(c => [c.titulo, c.tipo || 'texto'])),
    resumen: m.resumenEstadoYControl({ programada: true, finalizadoparcial: true, controlado: true,
        finalizado_tercerizacion_final: true, cantidad_finalizada_parcial: '3' }),
    resumen_sin_cant: m.resumenEstadoYControl({ finalizadoparcial: true, cantidad_finalizada_parcial: '' }),
    cuando: [m.cuandoLegible('2026-09-23T14:05:00'), m.cuandoLegible('2026-09-23'), m.cuandoLegible(null)],
    marcada: [1, true, '1', 0, null, undefined, false, 2].map(m.marcada),
}));
"""


@pytest.fixture(scope="module")
def front():
    if not (shutil.which("node") and TYPESCRIPT.exists()):
        pytest.skip("hace falta node y el typescript del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "driver.js").write_text(DRIVER)
        salida = subprocess.run(
            ["node", "driver.js", str(TYPESCRIPT), str(FUENTE)],
            cwd=tmp, capture_output=True, text=True, timeout=120,
        )
        assert salida.returncode == 0, salida.stderr
        return json.loads(salida.stdout)


def test_las_ocho_casillas_en_el_orden_de_la_ficha_vieja(front):
    assert front["orden"] == [
        "programada", "en_proceso", "finalizadototal", "finalizadoparcial", "controlado",
        "finalizado_para_pintar", "finalizado_tercerizacion_final",
        "finalizado_tercerizacion_intermedia",
    ]
    assert front["rotulos"][4:] == ["Controlado", "Finalizado para pintar",
                                    "Finalizado tercerización final",
                                    "Finalizado tercerización intermedia"]


def test_las_nuevas_del_front_son_las_del_backend(front):
    assert set(front["nuevas"]) == set(CASILLAS_DE_CONTROL)


def test_con_el_backend_de_hoy_ningun_filtro_miente(front):
    assert front["conoce"] == {"controlada": True, "sinControlar": True, "delBackendViejo": False}
    assert front["filtros"] == {
        "ALL": ["controlada", "sinControlar", "delBackendViejo"],
        "controlada": ["controlada"],
        # La del backend viejo NO es «sin controlar»: no se sabe.
        "sin_controlar": ["sinControlar"],
        "para_pintar": ["sinControlar"],
        "terc_intermedia": ["sinControlar"],
        "terc_final": ["controlada"],
    }
    assert front["chips"] == {"controlada": ["Controlada", "Terc. final"],
                              "sinControlar": ["Para pintar", "Terc. intermedia"],
                              "delBackendViejo": []}


def test_el_exportar_dice_si_no_o_nada(front):
    ex = front["exporta"]
    assert ex["controlada"] == {
        "Fin. parcial (cant.)": 3, "Controlado": True, "Controlado por": "Lucas Longchamps",
        "Controlado el": "2026-09-23T14:05:00", "Fin. para pintar": False,
        "Fin. terc. final": True, "Fin. terc. intermedia": False,
    }
    # Quién la controló sólo si sigue controlada; la cantidad, sólo con el parcial marcado.
    assert ex["sinControlar"]["Controlado por"] == "" and ex["sinControlar"]["Controlado el"] is None
    assert ex["sinControlar"]["Fin. parcial (cant.)"] is None
    # Backend viejo: vacío (null), no «No».
    viejo = ex["delBackendViejo"]
    assert [viejo[c] for c in ("Controlado", "Fin. para pintar", "Fin. terc. final",
                               "Fin. terc. intermedia")] == [None] * 4
    assert front["tipos"]["Controlado"] == "booleano" and front["tipos"]["Controlado el"] == "fechaHora"


def test_la_ficha_exportada_y_las_fechas(front):
    assert front["resumen"] == ("Programada, Finalizado parcial (3), Controlado, "
                                "Finalizado tercerización final")
    assert front["resumen_sin_cant"] == "Finalizado parcial"
    # Sin zona: se lee tal cual, sin correrla tres horas.
    assert front["cuando"] == ["23/09/2026 14:05", "23/09/2026", ""]
    assert front["marcada"] == [True, True, True, False, False, False, False, False]
