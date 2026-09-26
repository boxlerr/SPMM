"""La jornada del taller es UNA. El front y el back no se pueden separar.

Julián, 16/09/2026: «recién hice una planificación miércoles 11am y me pone procesos
para el día de hoy pero a las 9am, no tiene sentido».

El backend nunca dijo eso. El backend arranca el plan el jueves a las 07:00 —planificar
un miércoles a las 11 es para el día siguiente, porque la jornada ya empezó— y manda la
fecha de cada proceso hecha. Lo que pasaba es que el frontend la tiraba y la calculaba
de nuevo con OTRA jornada: 09:00 a 18:00 de corrido, 540 minutos, y de base el día en
que se apretó «Planificar» puesto a las 09:00.

Tres horas de esa pantalla delataban que no podían venir del backend. De lunes a
viernes la conversión real sólo puede devolver 07:00–09:00, 09:16–12:00 y 12:31–15:59:

  - «Mié 16/09 09:06» cae en el desayuno (09:00–09:15).
  - «Vie 18/09 12:30» cae en el almuerzo (12:00–12:30).
  - «Jue 17/09 16:20» es después de que el taller cierra (16:00).

Ninguna de las tres sale del backend con NINGUNA base, ni con feriados de por medio.

Ahora la traducción vive en un solo lugar de cada lado —`_convertir_minutos_a_fecha` acá
y `frontend/src/lib/plan-fechas.ts` allá— y este test las corre a las dos y las compara
minuto a minuto. Si alguien toca una jornada y se olvida de la otra, esto se pone rojo
antes de que la pantalla empiece a mentir.

Se compila de verdad y se ejecuta de verdad —con el tsc del propio repo— en vez de leer
el archivo y buscar números con una expresión regular: lo que importa no es que el 495
esté escrito, es que las dos cuentas den lo mismo.
"""
import inspect
import json
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import pytest

from backend.application import PlanificacionService as PS
from backend.application.PlanificacionService import (
    HORA_APERTURA,
    MIN_LABORAL_DIA,
    MIN_LABORAL_SABADO,
    _convertir_minutos_a_fecha,
    construir_ventanas_semanales,
    inicio_del_plan,
)

RAIZ = Path(__file__).resolve().parents[2]
FRONT_LIB = RAIZ / "frontend" / "src" / "lib"
TSC = RAIZ / "frontend" / "node_modules" / ".bin" / "tsc"

# Minutos elegidos para que caigan en todos los bordes: el arranque, adentro del primer
# tramo, el borde exacto del desayuno, el del almuerzo, el cierre, el salto de día, el
# sábado (que trabaja 300) y el salto de fin de semana.
MINUTOS = [
    0, 1, 6, 80, 119, 120, 121, 165, 284, 285, 286, 400, 494, 495, 496,
    600, 980, 989, 990, 991, 1200, 1289, 1290, 1291, 1500, 2000, 2475, 5000,
]

# Un miércoles, un viernes (para cruzar el fin de semana) y un lunes.
BASES = ["2026-09-17T07:00:00", "2026-09-18T07:00:00", "2026-09-21T07:00:00"]

# Feriados / días de mantenimiento. Van A PROPÓSITO en el medio del horizonte: el bug
# que este caso ataja es que la IDA (la fecha que arma el backend) los salteaba y la
# VUELTA (el minuto que guarda la pantalla al corregir un horario a mano) no, así que
# cada día bloqueado corría el proceso una jornada entera sin que nadie lo moviera.
FERIADOS = ["2026-09-21", "2026-09-24"]

DRIVER = """
const m = require('./plan-fechas.js');
const [, , bases, minutos, feriados] = process.argv;
const dias = JSON.parse(feriados);
const salida = {};
for (const iso of JSON.parse(bases)) {
    const base = new Date(iso);
    salida[iso] = JSON.parse(minutos).map((min) => {
        const fecha = m.fechaDesdeMinutos(base, min, dias);
        return {
            min,
            // Sin zona y sin segundos, igual que lo que devuelve el backend.
            fecha: m.paraInputDatetimeLocal(fecha),
            vuelta: m.minutosDesdeFecha(base, fecha, dias),
            // La variante de FIN: en el borde exacto de la jornada se queda en el
            // cierre del día en vez de saltar a la apertura del siguiente.
            fin: m.paraInputDatetimeLocal(m.fechaDesdeMinutos(base, min, dias, true)),
        };
    });
}
console.log(JSON.stringify(salida));
"""


def _hay_node() -> bool:
    return bool(shutil.which("node")) and TSC.exists()


def _correr_el_front(tmp: str, feriados: list[str], minutos=None, bases=None) -> dict:
    return json.loads(subprocess.run(
        ["node", "driver.js", json.dumps(bases or BASES), json.dumps(minutos or MINUTOS),
         json.dumps(feriados)],
        cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
    ).stdout)


# Los minutos donde arranca y cierra cada tramo que arma el SOLVER, con y sin sábados
# trabajados. Es el caso que se escapaba: los minutos de arriba son números sueltos, y el
# bug del domingo (sumaba 300 minutos que la vuelta a fecha no cuenta) sólo aparecía con
# los minutos que de verdad elige el solver. Ver construir_ventanas_semanales.
SABADOS = {"sin_sabado": False, "con_sabado": True}


def _minutos_de_las_ventanas(base_iso: str, sabado: bool) -> list[int]:
    base = datetime.fromisoformat(base_iso).date()
    ventanas = construir_ventanas_semanales(3, base, [], incluir_sabado=sabado)
    return sorted({v.ini for v in ventanas} | {v.fin for v in ventanas})


@pytest.fixture(scope="module")
def jornada_del_front():
    """Compila `plan-fechas.ts` y la corre, con y sin feriados.

    Devuelve {"sin": {base: [...]}, "con": {base: [...]}}, donde cada fila trae el
    minuto, la fecha de inicio, la de fin y la vuelta a minutos.
    """
    if not _hay_node():
        pytest.skip("hace falta node y el tsc del frontend (npm install)")

    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "plan-fechas.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"plan-fechas.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")

        (Path(tmp) / "driver.js").write_text(DRIVER)
        salida = {"sin": _correr_el_front(tmp, []),
                  "con": _correr_el_front(tmp, FERIADOS)}
        for clave, sabado in SABADOS.items():
            salida[clave] = {}
            for iso in BASES:
                salida[clave].update(_correr_el_front(
                    tmp, [], _minutos_de_las_ventanas(iso, sabado), [iso]))
        return salida


def test_las_dos_jornadas_dan_la_misma_fecha(jornada_del_front):
    """El corazón del asunto: mismos minutos, misma base, misma fecha."""
    for iso, filas in jornada_del_front["sin"].items():
        base = datetime.fromisoformat(iso)
        for fila in filas:
            esperado = _convertir_minutos_a_fecha(fila["min"], base)[:16]
            assert fila["fecha"] == esperado, (
                f"minuto {fila['min']} desde {iso}: "
                f"el front dice {fila['fecha']} y el backend {esperado}"
            )


def test_la_vuelta_es_la_inversa_exacta(jornada_del_front):
    """De fecha a minutos y de vuelta: tiene que cerrar.

    Importa porque es lo que se guarda cuando alguien arrastra un proceso en el Gantt o
    le escribe otro horario a mano. Si la ida y la vuelta no son la misma cuenta, correr
    un proceso diez minutos lo manda a otro día.
    """
    for iso, filas in jornada_del_front["sin"].items():
        for fila in filas:
            assert fila["vuelta"] == fila["min"], (
                f"desde {iso}, el minuto {fila['min']} volvió como {fila['vuelta']}"
            )


def test_las_constantes_de_la_jornada_coinciden(jornada_del_front):
    """La jornada escrita: 07:00, 495 de lunes a viernes, 300 el sábado."""
    texto = (FRONT_LIB / "plan-fechas.ts").read_text()
    assert f"export const HORA_APERTURA = {HORA_APERTURA.hour};" in texto
    assert f"[285, {MIN_LABORAL_DIA}]" in texto, "cambió la jornada de lunes a viernes"
    assert f"[[0, {MIN_LABORAL_SABADO}]]" in texto, "cambió la jornada del sábado"


def test_las_horas_de_las_pausas_no_existen(jornada_del_front):
    """Ninguna hora del plan cae en una pausa ni fuera de la jornada.

    Es la huella que delató el bug. De lunes a viernes esta cuenta sólo puede devolver
    07:00–09:00, 09:16–12:00 y 12:31–15:59: los renglones «09:06», «12:30» y «16:20» de
    la pantalla eran tres horas que el backend no puede emitir con NINGUNA base. Si
    vuelven a aparecer, alguien se inventó una jornada otra vez.

    El sábado va aparte: se trabaja de 07:00 a 12:00 de corrido, sin pausas, así que ahí
    las 09:06 sí existen. Meter al sábado en la misma bolsa sería inventar otra jornada
    distinta, que es justo lo que este test persigue.
    """
    for iso, filas in jornada_del_front["sin"].items():
        for fila in filas:
            cuando = datetime.fromisoformat(fila["fecha"])
            hhmm = cuando.hour * 60 + cuando.minute
            if cuando.weekday() == 5:  # sábado: 07:00 a 12:00 de corrido
                assert 7 * 60 <= hhmm <= 12 * 60, f"{fila['fecha']} está fuera del sábado"
                continue
            assert cuando.weekday() < 5, f"{fila['fecha']} cae un domingo"
            assert not (9 * 60 < hhmm <= 9 * 60 + 15), f"{fila['fecha']} cae en el desayuno"
            assert not (12 * 60 < hhmm <= 12 * 60 + 30), f"{fila['fecha']} cae en el almuerzo"
            assert 7 * 60 <= hhmm < 16 * 60, f"{fila['fecha']} está fuera de la jornada"


def test_el_plan_nunca_arranca_antes_de_planificarlo():
    """El caso que reportó Julián, tal cual: miércoles 11:00 -> jueves 07:00."""
    arranque = inicio_del_plan(datetime(2026, 9, 16, 11, 0))
    assert arranque == datetime(2026, 9, 17, 7, 0)
    # Y el primer proceso del plan arranca ahí, no nueve horas antes.
    assert _convertir_minutos_a_fecha(0, arranque) == "2026-09-17T07:00:00"


def test_el_front_no_tiene_una_segunda_jornada_escondida():
    """Nadie vuelve a armar la fecha desde `creado_en` puesto a las nueve.

    Era la cuenta que estaba copiada en seis lugares: la lista de Planificación, el
    Gantt, los filtros de Semanal y Diaria, la vista previa y el arrastre de un proceso.
    Cada copia era una oportunidad de que una pantalla dijera una cosa y la otra dijera
    otra — y durante meses todas dijeron lo mismo, que era lo equivocado.
    """
    front = RAIZ / "frontend" / "src"
    culpables = []
    for archivo in sorted(front.rglob("*.ts")) + sorted(front.rglob("*.tsx")):
        texto = archivo.read_text()
        for n, linea in enumerate(texto.split("\n"), 1):
            if "setHours(9, 0, 0, 0)" in linea:
                culpables.append(f"{archivo.relative_to(RAIZ)}:{n}")
        for muerta in ("addWorkMinutes", "calculateWorkingMinutes"):
            if muerta in texto and "plan-fechas" not in archivo.name:
                # El comentario que cuenta por qué se fueron sí puede nombrarlas.
                usos = [n for n, l in enumerate(texto.split("\n"), 1)
                        if muerta in l and not l.strip().startswith(("*", "//", "/*"))]
                culpables += [f"{archivo.relative_to(RAIZ)}:{n} ({muerta})" for n in usos]

    assert not culpables, (
        "volvió una jornada paralela al frontend, en:\n  " + "\n  ".join(culpables)
        + "\nLa traducción entre minutos y fechas va en frontend/src/lib/plan-fechas.ts."
    )


def test_los_feriados_cuentan_igual_de_los_dos_lados(jornada_del_front):
    """Con días bloqueados en el medio, la ida y la vuelta siguen cerrando.

    Es el caso que faltaba y que dejó pasar un bug de verdad: la fecha que se muestra la
    calcula el backend CON los feriados, y la vuelta —el minuto que se guarda cuando
    alguien corrige un horario a mano o arrastra un proceso— los contaba como días
    trabajados. Resultado: cada feriado entre el arranque del plan y la fecha editada
    corría el proceso un día hábil, y componía a cada guardado. Basta un click perdido
    en la celda para disparar el guardado, así que no hacía falta ni querer editar.
    """
    for iso, filas in jornada_del_front["con"].items():
        base = datetime.fromisoformat(iso)
        for fila in filas:
            esperado = _convertir_minutos_a_fecha(fila["min"], base, FERIADOS)[:16]
            assert fila["fecha"] == esperado, (
                f"minuto {fila['min']} desde {iso} con feriados {FERIADOS}: "
                f"el front dice {fila['fecha']} y el backend {esperado}")
            assert fila["vuelta"] == fila["min"], (
                f"con feriados, el minuto {fila['min']} volvió como {fila['vuelta']}")
            # Y ninguna fecha puede caer en un día bloqueado.
            assert fila["fecha"][:10] not in FERIADOS, (
                f"{fila['fecha']} cae en un día que el taller no trabaja")


def test_el_fin_de_un_proceso_que_cierra_la_jornada(jornada_del_front):
    """El minuto 495 es el CIERRE del primer día y la APERTURA del segundo.

    Para un inicio corresponde la apertura del día siguiente; para un fin, el cierre.
    Sin la distinción, un proceso que terminaba justo a las 16:00 figuraba terminando al
    otro día a las 07:00 y se colaba un día de más en la vista Diaria.
    """
    for clave, feriados in (("sin", []), ("con", FERIADOS)):
        for iso, filas in jornada_del_front[clave].items():
            base = datetime.fromisoformat(iso)
            for fila in filas:
                esperado = _convertir_minutos_a_fecha(
                    fila["min"], base, feriados, es_fin=True)[:16]
                assert fila["fin"] == esperado, (
                    f"fin del minuto {fila['min']} desde {iso}: "
                    f"el front dice {fila['fin']} y el backend {esperado}")

    # Y el caso concreto: un día entero de trabajo termina a las 16:00 de ESE día.
    base = datetime(2026, 9, 17, 7, 0)
    assert _convertir_minutos_a_fecha(MIN_LABORAL_DIA, base, es_fin=True) == "2026-09-17T16:00:00"
    assert _convertir_minutos_a_fecha(MIN_LABORAL_DIA, base) == "2026-09-18T07:00:00"


def test_una_fecha_pedida_a_futuro_manda_en_los_dos_lados():
    """`inicio_del_plan` tiene una primera rama que el espejo del front no tenía.

    Si alguien pide planificar desde una fecha futura, el plan arranca a la apertura de
    ESE día. El espejo sólo implementaba «si la jornada ya arrancó, mañana», así que un
    plan pedido con rango a futuro se leía como si arrancara mañana: semanas antes de lo
    que decía el plan.
    """
    regla = inspect.getsource(PS.inicio_del_plan)
    assert "fecha_desde" in regla
    espejo = (FRONT_LIB / "plan-fechas.ts").read_text()
    assert "fechaDesde" in espejo, "el espejo perdió la rama de la fecha pedida a futuro"
    assert "fechaLocalDesdeIso" in espejo, (
        "la fecha pedida se tiene que leer como día LOCAL: new Date('2026-10-05') es UTC "
        "y en Argentina daría el 4")


@pytest.mark.parametrize("clave", list(SABADOS))
def test_los_tramos_del_solver_caen_en_su_dia_de_los_dos_lados(jornada_del_front, clave):
    """Cada tramo que arma el solver se muestra en SU día, en el front y en el back.

    Con y sin sábados trabajados. Hasta el 25/09/2026 el calendario del solver le sumaba
    300 minutos a cada DOMINGO y la vuelta a fecha no: con un sábado trabajado, todo lo
    que venía después del primer fin de semana se mostraba corrido (lo del lunes 07:00,
    el lunes a las 12:15). Sin gente los sábados se tapaba solo, y por eso no se veía.
    """
    sabado = SABADOS[clave]
    for iso, filas in jornada_del_front[clave].items():
        base = datetime.fromisoformat(iso)
        ventanas = construir_ventanas_semanales(3, base.date(), [], incluir_sabado=sabado)
        dia_de_inicio = {}
        dia_de_cierre = {}
        for v in ventanas:
            dia_de_inicio.setdefault(v.ini, v.fecha)
            dia_de_cierre[v.fin] = v.fecha
        for fila in filas:
            back = _convertir_minutos_a_fecha(fila["min"], base)[:16]
            back_fin = _convertir_minutos_a_fecha(fila["min"], base, es_fin=True)[:16]
            assert fila["fecha"] == back, (
                f"{clave}, minuto {fila['min']} desde {iso}: front {fila['fecha']} / back {back}")
            assert fila["fin"] == back_fin
            assert fila["vuelta"] == fila["min"]
            if fila["min"] in dia_de_inicio:
                assert fila["fecha"][:10] == dia_de_inicio[fila["min"]].isoformat(), (
                    f"{clave}: el tramo del {dia_de_inicio[fila['min']]} se muestra el {fila['fecha']}")
            if fila["min"] in dia_de_cierre:
                assert fila["fin"][:10] == dia_de_cierre[fila["min"]].isoformat(), (
                    f"{clave}: el cierre del {dia_de_cierre[fila['min']]} se muestra el {fila['fin']}")
