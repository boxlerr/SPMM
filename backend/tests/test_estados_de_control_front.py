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
  · quién la controló sólo sale si sigue controlada;
  · el PDF de las listas lleva UNA columna «Estado y control» y el Excel / CSV las siete
    separadas: con las siete en el PDF se partían el N° de OT y los clientes (24/09).
"""
import base64
import json
import re
import shutil
import subprocess
import tempfile
import zlib
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

// Excel y CSV: las siete columnas, una por dato. El PDF va aparte (ver abajo).
const cols = m.columnasEstadoYControl().filter(c => !c.formatos || c.formatos.includes('xlsx'));
const exporta = {};
for (const k of Object.keys(filas)) exporta[k] = Object.fromEntries(cols.map(c => [c.titulo, c.valor(filas[k], 0)]));
const todas = m.columnasEstadoYControl();
const formatos = Object.fromEntries(['pdf', 'xlsx', 'csv'].map(f =>
    [f, todas.filter(c => !c.formatos || c.formatos.includes(f)).map(c => c.titulo)]));
const celdaPdf = Object.fromEntries(Object.keys(filas).map(k => [k, m.estadoYControlEnUnaCelda(filas[k])]));

console.log(JSON.stringify({
    orden: m.CASILLAS_DE_ESTADO.map(c => c.clave),
    rotulos: m.CASILLAS_DE_ESTADO.map(c => c.rotulo),
    nuevas: m.CASILLAS_NUEVAS,
    conoce: Object.fromEntries(Object.keys(filas).map(k => [k, m.conoceEstadosDeControl(filas[k])])),
    filtros,
    chips: Object.fromEntries(Object.keys(filas).map(k => [k, m.etapasDe(filas[k]).map(e => e.corto)])),
    exporta,
    formatos,
    celdaPdf,
    celdaVacia: m.estadoYControlEnUnaCelda({ controlado: 0, finalizado_para_pintar: 0,
        finalizado_tercerizacion_final: 0, finalizado_tercerizacion_intermedia: 0 }),
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


def test_el_pdf_lleva_una_sola_columna_y_la_planilla_las_siete(front):
    siete = ["Fin. parcial (cant.)", "Controlado", "Controlado por", "Controlado el",
             "Fin. para pintar", "Fin. terc. final", "Fin. terc. intermedia"]
    assert front["formatos"]["xlsx"] == siete
    assert front["formatos"]["csv"] == siete
    assert front["formatos"]["pdf"] == ["Estado y control"]


def test_la_celda_del_pdf_dice_todo_junto(front):
    assert front["celdaPdf"] == {
        # Mismas palabras que los chips de la pantalla, y quién/cuándo en otro renglón.
        "controlada": "Parcial: 3 · Controlada · Terc. final\npor Lucas Longchamps, 23/09/2026 14:05",
        # Sin controlar: el «quién» que quedó de antes no sale.
        "sinControlar": "Para pintar · Terc. intermedia",
        # Backend viejo: vacío, no se sabe.
        "delBackendViejo": "",
    }
    assert front["celdaVacia"] == ""


# ---------------------------------------------------------------------------------
# El PDF de verdad de una lista de 40 OT, con y sin las columnas de control
# ---------------------------------------------------------------------------------

JITI = RAIZ / "frontend" / "node_modules" / "jiti" / "lib" / "jiti.mjs"
SRC = RAIZ / "frontend" / "src"

DRIVER_PDF = r"""
import { createJiti } from "%(jiti)s";
const SRC = "%(src)s";
const jiti = createJiti(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const { construirPdf } = await jiti.import(SRC + "/lib/exportarPdf.ts");
const { construirCsv, reporteParaFormato } = await jiti.import(SRC + "/lib/exportar.ts");
const { columnasOrdenes } = await jiti.import(SRC + "/lib/exportes/ordenes.ts");

const filas = Array.from({ length: 40 }, (_, i) => ({
    id: 1000 + i, id_otvieja: 15000 + i, fecha_entrada: "2026-08-06T00:00:00",
    fecha_prometida: "2026-09-05T00:00:00", unidades: 70 + i, cantidad_entregada: i %% 3,
    cliente: { nombre: `CLIENTE ${i %% 40} S.A.` }, articulo: { cod_articulo: `A00${i %% 40}`,
    descripcion: `EJE O'HIGGINS ${i}` }, sector: { nombre: "MECANIZADO" },
    prioridad: { descripcion: "Urgente" }, estado_material: "sin_datos", procesos: [],
    aprobado_por: "", requerido_por: "",
    controlado: i %% 2, controlado_por: "Lucas Longchamps", controlado_en: "2026-09-23T14:05:00",
    finalizado_para_pintar: 1, finalizado_tercerizacion_final: i %% 3 === 0 ? 1 : 0,
    finalizado_tercerizacion_intermedia: 0, finalizadoparcial: 1, cantidad_finalizada_parcial: 3,
}));
const reporte = (conControl) => ({ titulo: "No planificadas", archivo: "x", filtros: [],
    secciones: [{ titulo: "Órdenes", filas, columnas: columnasOrdenes({ conControl, plano: () => "sin_plano" }) }] });
const pdf = async (r) => Buffer.from(await (await construirPdf(r)).arrayBuffer()).toString("base64");
const columnas = (r, f) => reporteParaFormato(r, f).secciones[0].columnas.map(c => c.titulo);
console.log(JSON.stringify({
    pdfBase64: { sin: await pdf(reporte(false)), con: await pdf(reporte(true)) },
    pdf: { sin: columnas(reporte(false), "pdf"), con: columnas(reporte(true), "pdf") },
    xlsx: { sin: columnas(reporte(false), "xlsx"), con: columnas(reporte(true), "xlsx") },
    csvTitulos: construirCsv(reporte(true)).replace(/^\uFEFF/, "").split("\r\n")[0],
}));
"""


@pytest.fixture(scope="module")
def lista():
    if not (shutil.which("node") and JITI.exists()):
        pytest.skip("hace falta node y las dependencias del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "driver.mjs").write_text(DRIVER_PDF % {"jiti": JITI, "src": SRC})
        salida = subprocess.run(["node", "driver.mjs"], cwd=tmp, capture_output=True,
                                text=True, timeout=180)
        assert salida.returncode == 0, salida.stderr
        return json.loads(salida.stdout.strip().splitlines()[-1])


def _renglones_del_pdf(b64: str) -> list[str]:
    """Cada texto que jsPDF escribió en la página («(15012) Tj»), en orden. Una celda
    que no entra en su columna sale partida en dos textos: «1501» y «2»."""
    crudo = base64.b64decode(b64)
    contenido = b""
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", crudo, re.S):
        try:
            contenido += zlib.decompress(m.group(1))
        except zlib.error:
            contenido += m.group(1)
    return re.findall(r"\((.*?)\) Tj", contenido.decode("latin-1"))


def _palabra_entera(palabra: str, textos: list[str]) -> bool:
    """Que la palabra esté entera en algún texto del PDF. Partir en el espacio («F.» /
    «Prometida») es lo normal de una columna angosta; partir una palabra no."""
    return any(re.search(rf"(^|\s){re.escape(palabra)}(\s|$)", t) for t in textos)


def test_el_pdf_de_la_lista_se_lee_entero_con_el_control(lista):
    # Con las siete columnas en el PDF, el N° de OT salía «1519 / 8», los clientes
    # «CLIENT / E 12 S.A.» y los títulos «Códig / o» (verificación del 24/09). Acá cada
    # una de las 40 OT tiene algo marcado: el peor caso para el ancho de la columna.
    textos = _renglones_del_pdf(lista["pdfBase64"]["con"])
    partidas = [p for titulo in lista["pdf"]["con"] for p in titulo.split() if not _palabra_entera(p, textos)]
    for i in range(40):
        partidas += [p for p in (str(15000 + i), "CLIENTE", f"A00{i}") if not _palabra_entera(p, textos)]
    assert partidas == []
    assert _palabra_entera("Controlada", textos)
    assert lista["pdf"]["con"] == lista["pdf"]["sin"] + ["Estado y control"]


def test_la_planilla_de_la_lista_trae_las_siete(lista):
    assert len(lista["xlsx"]["con"]) == len(lista["xlsx"]["sin"]) + 7
    assert "Estado y control" not in lista["xlsx"]["con"]
    titulos = lista["csvTitulos"].split(",")
    assert "Controlado por" in titulos and "Estado y control" not in titulos
