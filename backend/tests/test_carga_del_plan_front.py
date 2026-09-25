"""La carga de cada persona en la vista previa se reparte por día y cuadra con el total.

Julián, 25/09/2026 (queja 6): la tarjeta decía «Guillermo Celiz · 63% · 109,8h / 173,3h»
y no se entendía de dónde salía el 173,3 (21 días × 8,25 h), ni por qué se comparaba
contra todo el plan (28/9 → 26/10) y no contra la semana del piloto.

El panel nuevo mira una semana por vez y escribe la cuenta. Para eso
`frontend/src/lib/cargaDelPlan.ts` reparte lo que el plan le da a cada uno en los días.
Este test la compila con el tsc del repo, la corre con node y verifica que:

- la capacidad de «Todo el plan» es EXACTAMENTE la de antes (21 × 495 = 173,25 h);
- la de la semana del piloto son 41,25 h;
- repartir no pierde ni inventa minutos (por persona, por semana y en el desglose);
- un plan sin cambios a mano no muestra días pasados que no existen, y uno con un
  cambio a mano que encima trabajo sí se ve pasado.

Es solo un test: no toca el backend ni se deploya.
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

HORARIO = {
    "dias_trabajo": "MON,TUE,WED,THU,FRI",
    "hora_inicio": "07:00",
    "hora_fin": "16:00",
    "min_desayuno": 15,
    "min_almuerzo": 30,
}

GUILLERMO, ANA, VACANTE, PRUEBAS, PABLO, LUIS = 1, 2, 3, 4, 5, 6

OPERARIOS = [
    {"id": GUILLERMO, "nombre": "GUILLERMO", "apellido": "CELIZ", "sector": "PLEGADO", **HORARIO},
    {"id": ANA, "nombre": "ANA", "apellido": "GOMEZ", "sector": "TORNERIA", **HORARIO},
    {"id": VACANTE, "nombre": "VACANTE TORNERO", "apellido": "A CUBRIR", **HORARIO},
    {"id": PRUEBAS, "nombre": "TEST", "apellido": "UNO", "sector": "PRUEBAS", **HORARIO},
    {"id": PABLO, "nombre": "PABLO", "apellido": "RIOS", "sector": "TORNERIA", **HORARIO},
    {"id": LUIS, "nombre": "LUIS", "apellido": "PAZ", "disponible": False, **HORARIO},
]


def fila(orden, proceso, dur, ini, fin, operario=None, **extra):
    return {
        "orden_id": orden, "id_otvieja": 15000 + orden, "nombre_proceso": proceso,
        "duracion_min": dur, "fecha_inicio_estimada": ini, "fecha_fin_estimada": fin,
        "id_operario": operario, **extra,
    }


FILAS = [
    # Un proceso de un día.
    fila(1, "PLEGADO", 165, "2026-09-28T07:00:00", "2026-09-28T10:00:00", GUILLERMO),
    # El viernes a la tarde, antes del proceso partido.
    fila(2, "PLEGADO", 150, "2026-10-02T12:30:00", "2026-10-02T15:00:00", GUILLERMO),
    # Partido en varios días: vie 15:00 → mar 10:00 (60 + 495 + 165 de ventana).
    fila(3, "PLEGADO", 600, "2026-10-02T15:00:00", "2026-10-06T10:00:00", GUILLERMO),
    # El lunes a primera hora ya tiene otra cosa: el partido tiene que respetarla.
    fila(4, "CORTE", 120, "2026-10-05T07:00:00", "2026-10-05T09:00:00", GUILLERMO),
    # El miércoles entero.
    fila(5, "PLEGADO", 495, "2026-09-30T07:00:00", "2026-09-30T16:00:00", GUILLERMO),
    # Movido a mano al miércoles 14:00, encima de lo anterior: se tiene que ver pasado.
    fila(6, "SOLDADO", 300, "2026-09-30T14:00:00", "2026-10-01T10:00:00", GUILLERMO, fechaEditada=True),
    # Sin fecha: cuenta en «todo el plan».
    fila(7, "PINTURA", 90, None, None, GUILLERMO),
    # Ayudante.
    fila(8, "PLEGADO", 120, "2026-10-01T07:00:00", "2026-10-01T09:00:00", ANA, slot_extra=True),
    # Sin nadie.
    fila(9, "TORNO", 200, "2026-10-01T07:00:00", "2026-10-01T10:35:00", None,
         rangos_permitidos_proceso=[5, 6]),
    # De terceros: nunca es «sin nadie».
    fila(10, "GALVANIZADO", 240, "2026-10-07T07:00:00", "2026-10-07T11:15:00", None, tercerizado=True),
    # Un puesto vacante.
    fila(11, "TORNO", 360, "2026-10-08T07:00:00", "2026-10-08T13:45:00", VACANTE),
    # Alguien de PRUEBAS: no tiene tarjeta, pero las horas las hace alguien.
    fila(12, "PRUEBA", 60, "2026-10-09T07:00:00", "2026-10-09T08:00:00", PRUEBAS),
    # Dos partidas que se pisan la ventana: la de ventana corta tiene que entrar igual.
    # Si se reparte «la que arranca antes primero», la larga se come el lunes y la
    # corta queda como día pasado sin que nadie haya tocado nada.
    fila(14, "TORNO", 1155, "2026-10-12T07:00:00", "2026-10-14T16:00:00", ANA, cantidad_tramos=3),
    fila(15, "FRESADO", 330, "2026-10-12T12:00:00", "2026-10-13T09:00:00", ANA, cantidad_tramos=2),
    # El backend pasa minutos a fechas con 300 minutos cada sábado aunque nadie los
    # trabaje: un tramo puede caer un sábado. Se ve ahí, no inflando el viernes.
    fila(16, "PLEGADO", 180, "2026-10-09T15:00:00", "2026-10-10T09:00:00", GUILLERMO, cantidad_tramos=2),
    # Lo último del plan: estira el período hasta el lun 26/10.
    fila(13, "TORNO", 165, "2026-10-26T07:00:00", "2026-10-26T10:00:00", ANA),
]

EXCEDENTES_MIN = 3300
SPAN = {"desde": "2026-09-28T07:00:00", "hasta": "2026-10-26T10:00:00", "habiles": 21}

DRIVER = """
const m = require('./cargaDelPlan.js');
const [, , datos] = process.argv;
const { filas, operarios, span, excedentes, guillermo } = JSON.parse(datos);
const carga = m.armarCargaDelPlan({
    filas, operarios, cargaPrevia: {}, feriados: [], span,
    diasDelTaller: new Set([1, 2, 3, 4, 5]), excedentesMin: excedentes,
});
const todo = m.resumenDelPeriodo(carga, 'todo');
const semanas = carga.semanas.map(s => {
    const r = m.resumenDelPeriodo(carga, s.clave);
    const g = r.personas.find(p => p.op.id === guillermo);
    return {
        clave: s.clave, dias: s.dias.length, etiqueta: s.etiqueta,
        g_carga: g.cargaMin, g_cap: g.cap.minutos, g_formula: g.formula,
        g_celdas: g.celdas, desglose: r.desglose,
    };
});
const personaTodo = id => todo.personas.find(p => p.op.id === id);
const g = personaTodo(guillermo);
const persona = carga.personas.find(p => p.op.id === guillermo);
const sumaDias = p => Object.values(p.porDia).reduce((a, b) => a + b, 0);
const conCapDia = carga.personas.flatMap(p => Object.entries(p.porDia).map(([dia, min]) => ({
    id: p.op.id, dia, min, cap: carga.capDia(p.op, dia),
    editada: p.tramos.some(t => t.dia === dia && t.fila.fechaEditada),
})));
console.log(JSON.stringify({
    semanas,
    dias_del_plan: carga.diasDelPlan.length,
    g_todo: { carga: g.cargaMin, cap: g.cap, formula: g.formula, estado: g.estado, sin_fecha: persona.sinFechaMin },
    g_suma_dias: sumaDias(persona),
    g_por_dia: persona.porDia,
    dias: conCapDia,
    personas: carga.personas.map(p => p.op.id).sort(),
    ocultas: carga.ocultas.map(p => p.op.id),
    vacantes: carga.vacantes.map(p => p.op.id),
    sin_nadie: carga.sinNadie.reduce((a, t) => a + t.min, 0),
    terceros: carga.terceros.reduce((a, t) => a + t.min, 0),
    desglose_todo: todo.desglose,
    sin_trabajo: todo.sinTrabajo.map(r => r.op.id),
    no_disponibles: todo.noDisponibles.map(r => r.op.id),
    ultimo: carga.ultimo && carga.ultimo.orden_id,
    horas: m.horasYMinutos(34889),
    vacante: [m.esVacante('VACANTE TORNERO A CUBRIR'), m.esVacante('vacante x'), m.esVacante('Juan')],
    dia_corto: m.diaCorto('2026-09-28'),
}));
"""


@pytest.fixture(scope="module")
def front():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "cargaDelPlan.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"cargaDelPlan.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        datos = {
            "filas": FILAS, "operarios": OPERARIOS, "span": SPAN,
            "excedentes": EXCEDENTES_MIN, "guillermo": GUILLERMO,
        }
        salida = subprocess.run(
            ["node", "driver.js", json.dumps(datos)],
            cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
        )
        return json.loads(salida.stdout)


def minutos_de(operario):
    return sum(f["duracion_min"] for f in FILAS if f["id_operario"] == operario)


def test_las_semanas_del_plan_son_5_5_5_5_1(front):
    """28/9 → 26/10: 21 días hábiles, igual que la cifra del encabezado."""
    assert [s["dias"] for s in front["semanas"]] == [5, 5, 5, 5, 1]
    assert front["dias_del_plan"] == 21
    assert [s["etiqueta"] for s in front["semanas"]] == [
        "28/9 – 2/10", "5/10 – 9/10", "12/10 – 16/10", "19/10 – 23/10", "26/10"]


def test_en_todo_el_plan_guillermo_puede_173_25_horas_como_antes(front):
    cap = front["g_todo"]["cap"]
    assert cap["dias"] == 21
    assert cap["jornada"] == 495
    assert cap["minutos"] == 21 * 495  # 173,25 h
    assert front["g_todo"]["formula"] == "= 21 días × 8,25 h de jornada"


def test_en_la_semana_del_piloto_puede_41_25_horas(front):
    s = front["semanas"][0]
    assert s["g_cap"] == 5 * 495  # 41,25 h
    assert s["g_formula"] == "= 5 días × 8,25 h de jornada"
    # La última semana tiene un solo día.
    assert front["semanas"][-1]["g_cap"] == 495


def test_repartir_no_pierde_ni_inventa_minutos(front):
    total = minutos_de(GUILLERMO)
    assert front["g_suma_dias"] + front["g_todo"]["sin_fecha"] == total
    assert front["g_todo"]["carga"] == total
    # Las semanas suman lo mismo que «todo», salvo lo que no tiene fecha.
    assert sum(s["g_carga"] for s in front["semanas"]) + front["g_todo"]["sin_fecha"] == total


def test_el_proceso_partido_respeta_lo_que_ya_tenia_ese_dia(front):
    por_dia = front["g_por_dia"]
    # Viernes: 150 del exacto + 60 del partido (su ventana arranca a las 15:00).
    assert por_dia["2026-10-02"] == 210
    # Lunes: 120 que ya tenía + 375 del partido. Justo la jornada, no más.
    assert por_dia["2026-10-05"] == 495
    # Martes: lo que queda, dentro de su ventana hasta las 10:00.
    assert por_dia["2026-10-06"] == 165


def test_sin_cambios_a_mano_ningun_dia_pasa_de_la_jornada(front):
    for d in front["dias"]:
        if not d["editada"] and d["cap"] > 0:
            assert d["min"] <= d["cap"], f"{d['dia']} de {d['id']}: {d['min']} > {d['cap']}"


def test_la_ventana_corta_entra_aunque_la_larga_arranque_antes(front):
    ana = {d["dia"]: d["min"] for d in front["dias"] if d["id"] == ANA}
    assert ana["2026-10-12"] == 495
    assert ana["2026-10-13"] == 495
    assert ana["2026-10-14"] == 495


def test_lo_que_el_backend_puso_un_sabado_se_ve_el_sabado(front):
    """Vie 9/10 15:00 → sáb 10/10 09:00: 60 el viernes y 120 el sábado, que Guillermo
    no trabaja. La tira de esa semana muestra el sábado con su carga."""
    assert front["g_por_dia"]["2026-10-09"] == 60
    assert front["g_por_dia"]["2026-10-10"] == 120
    semana = front["semanas"][1]
    sabado = next(c for c in semana["g_celdas"] if c["dia"] == "2026-10-10")
    assert sabado["cap"] == 0 and sabado["min"] == 120


def test_lo_movido_a_mano_encima_de_otra_cosa_se_ve_pasado(front):
    miercoles = next(d for d in front["dias"] if d["id"] == GUILLERMO and d["dia"] == "2026-09-30")
    # 495 del día entero + 120 del movido (de 14:00 a 16:00). El resto va al jueves.
    assert miercoles["min"] == 615
    assert miercoles["min"] > miercoles["cap"]
    assert front["g_por_dia"]["2026-10-01"] == 180


def test_el_desglose_suma_la_carga_total_con_lo_que_no_entro(front):
    d = front["desglose_todo"]
    total_filas = sum(f["duracion_min"] for f in FILAS)
    assert d["totalMin"] == total_filas + EXCEDENTES_MIN
    assert d["excedentesMin"] == EXCEDENTES_MIN
    assert d["vacantesMin"] == 360
    assert d["sinNadieMin"] == 200
    assert d["tercerosMin"] == 240
    # Las de PRUEBAS y el ayudante cuentan como «las hace alguien».
    assert d["conAlguienMin"] == minutos_de(GUILLERMO) + minutos_de(ANA) + minutos_de(PRUEBAS)
    # En una semana no entran los excedentes, y cada semana cuadra con sus días.
    for s in front["semanas"]:
        assert s["desglose"]["excedentesMin"] == 0
    assert sum(s["desglose"]["totalMin"] for s in front["semanas"]) + 90 == total_filas


def test_vacantes_pruebas_y_terceros_van_a_su_lugar(front):
    assert front["vacantes"] == [VACANTE]
    assert front["ocultas"] == [PRUEBAS]
    assert VACANTE not in front["personas"] and PRUEBAS not in front["personas"]
    assert front["terceros"] == 240
    assert front["sin_nadie"] == 200
    assert front["sin_trabajo"] == [PABLO]
    assert front["no_disponibles"] == [LUIS]
    assert front["ultimo"] == 13


def test_formatos(front):
    assert front["horas"] == "581h 29m"
    assert front["vacante"] == [True, True, False]
    assert front["dia_corto"] == "lun 28/9"
