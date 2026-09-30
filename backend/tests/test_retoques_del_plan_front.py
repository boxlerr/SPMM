"""Un retoque a mano de la vista previa guarda sólo lo que la persona cambió.

Hasta el 30/09/2026 un retoque era la fila ENTERA del plan y la pantalla la ponía en
lugar de la del plan. Un recálculo conserva los retoques, así que cada fila retocada
volvía con la persona, la máquina, los minutos y las fechas del plan viejo, encimada con
el nuevo. En el borrador 19 (29/09/2026) había un retoque idéntico a su fila —Celiz en la
FRESADORA CNC para el fresado de la OT 15644, lo que Lucas pidió corregir— que habría
vuelto a imponerse en cualquier recálculo.

`frontend/src/lib/retoquesPlan.ts` guarda el retoque como diferencia y lo funde sobre la
fila del plan que esté en pantalla. Este test lo compila con el tsc del repo, lo corre con
node y verifica:

- que el retoque guarda sólo el campo cambiado, y que volver a lo del plan lo borra;
- que después de un recálculo la persona elegida se mantiene y todo lo demás es del plan
  nuevo;
- que el horario escrito a mano vale mientras el plan deje la fila donde estaba, y se
  descarta si el recálculo la mueve;
- qué horario escrito se guarda al confirmar, pasado a minutos, y cuál no (en blanco,
  igual al del plan);
- que un borrador viejo (retoques de fila entera) se convierte a lo que la persona había
  cambiado: el idéntico no deja nada y el hecho sobre un plan anterior no trae de vuelta
  la persona de ese plan.

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

CELIZ, GUSTAVO, NAHUEL = 3, 7, 9
FRESADORA_CNC, FRESADORA_2 = 21, 22

# Con el mismo texto que les pone el plan (`${nombre} ${apellido}` y el nombre de la máquina).
NOMBRES_OPERARIOS = {CELIZ: "GUILLERMO CELIZ", GUSTAVO: "GUSTAVO RODRIGUEZ", NAHUEL: "NAHUEL PEREZ"}
NOMBRES_MAQUINAS = {FRESADORA_CNC: "FRESADORA CNC", FRESADORA_2: "FRESADORA 2"}

# El fresado de la OT 15644 en el plan que se miró primero: Celiz en la FRESADORA CNC.
FRESADO_P1 = {
    "orden_id": 12720, "proceso_id": 68, "secuencia": 7, "id_otvieja": 15644,
    "nombre_proceso": "FRESADO CNC", "duracion_min": 120,
    "inicio_min": 480, "fin_min": 600,
    "fecha_inicio_estimada": "2026-10-01T07:00:00", "fecha_fin_estimada": "2026-10-01T09:15:00",
    "id_operario": CELIZ, "operario_nombre": "GUILLERMO CELIZ",
    "id_maquinaria": FRESADORA_CNC, "maquinaria_nombre": "FRESADORA CNC",
    "usa_maquina": True, "va_a_mano": False, "sin_maquinaria": False, "sin_asignar": False,
}

# El mismo paso después de recalcular: Celiz ya no fresa, lo hace Gustavo y un día después.
FRESADO_P2 = {
    **FRESADO_P1,
    "inicio_min": 975, "fin_min": 1095,
    "fecha_inicio_estimada": "2026-10-02T07:00:00", "fecha_fin_estimada": "2026-10-02T09:15:00",
    "id_operario": GUSTAVO, "operario_nombre": "GUSTAVO RODRIGUEZ",
}

DRIVER = """
const m = require('./retoquesPlan.js');
const [, , datos] = process.argv;
const { p1, p2, ops, maqs, ids } = JSON.parse(datos);
const nombres = { operario: id => ops[id], maquina: id => maqs[id] };
const { CELIZ, GUSTAVO, NAHUEL, FRESADORA_CNC, FRESADORA_2 } = ids;
const r = {};

// Cambiar la persona, volver a la del plan, recalcular.
r.persona = m.cambiarRetoque(p1, undefined, { id_operario: NAHUEL });
r.persona_aplicada = m.aplicarRetoque(p1, r.persona, nombres);
r.persona_de_vuelta = m.cambiarRetoque(p1, r.persona, { id_operario: CELIZ });
r.persona_tras_recalculo = m.aplicarRetoque(p2, r.persona, nombres);

// El horario escrito a mano.
r.horario = m.cambiarRetoque(p1, undefined, { fecha_inicio_estimada: '2026-10-01T14:00' });
r.horario_mismo_plan = m.aplicarRetoque(p1, r.horario, nombres);
r.horario_fila_movida = m.aplicarRetoque(p2, r.horario, nombres);
r.ambos = m.cambiarRetoque(p1, r.persona, { fecha_inicio_estimada: '2026-10-01T14:00' });
r.ambos_tras_recalculo = m.retoquesAlDia({ k: r.ambos }, () => p2, nombres);
r.solo_horario_tras_recalculo = m.retoquesAlDia({ k: r.horario }, () => p2, nombres);
r.no_van = m.horariosQueNoVan({ a: r.ambos, b: r.persona, c: r.horario }, () => p2);
r.no_van_mismo_plan = m.horariosQueNoVan({ a: r.ambos, c: r.horario }, () => p1);
r.mismo_minuto = m.cambiarRetoque(p1, undefined, { fecha_inicio_estimada: '2026-10-01T07:00' });
r.en_blanco = m.cambiarRetoque(p1, undefined, { fecha_inicio_estimada: '' });
r.en_blanco_aplicado = m.aplicarRetoque(p1, r.en_blanco, nombres).fecha_inicio_estimada;
// Con un horario que ya no va, cambiar la persona también lo limpia.
r.limpia_al_cambiar = m.cambiarRetoque(p2, r.horario, { id_operario: NAHUEL });

// La marca roja: sólo si la fila queda distinta de la del plan.
r.marca = {
    cambiada: m.hayCambios(p1, r.persona),
    coincide_con_el_plan: m.hayCambios({ ...p2, id_operario: NAHUEL }, r.persona),
    sin_retoque: m.hayCambios(p1, undefined),
    horario_que_ya_no_va: m.hayCambios(p2, r.horario),
    horario_que_va: m.hayCambios(p1, r.horario),
};

// «No necesita» y deshacerlo.
r.va_a_mano = m.cambiarRetoque(p1, undefined,
    { id_maquinaria: null, usa_maquina: false, va_a_mano: true, sin_maquinaria: false });
r.va_a_mano_aplicado = m.aplicarRetoque(p1, r.va_a_mano, nombres);
r.va_a_mano_deshecho = m.cambiarRetoque(p1, r.va_a_mano,
    { id_maquinaria: FRESADORA_CNC, usa_maquina: true, va_a_mano: false, sin_maquinaria: false });

// Un paso que quedó afuera (sin horario), completado a mano.
const afuera = { ...p1, fecha_inicio_estimada: null, fecha_fin_estimada: null,
    id_operario: null, operario_nombre: null, id_maquinaria: null, maquinaria_nombre: null };
let completo = m.cambiarRetoque(afuera, undefined, { id_operario: NAHUEL });
completo = m.cambiarRetoque(afuera, completo, { id_maquinaria: FRESADORA_2 });
completo = m.cambiarRetoque(afuera, completo, { fecha_inicio_estimada: '2026-10-03T08:00' });
r.afuera = completo;
r.afuera_aplicado = m.aplicarRetoque(afuera, completo, nombres);
const sigueAfuera = { k: completo };
r.afuera_sigue_igual = m.retoquesAlDia(sigueAfuera, () => afuera, nombres) === sigueAfuera;
r.afuera_entra_al_plan = m.retoquesAlDia({ k: completo }, () => p2, nombres);

// El horario que se guarda al confirmar (se pasa a minutos): el que vale, completo y
// distinto del del plan.
const escritoEn = (fila, fecha_inicio_estimada) =>
    m.horarioEscrito(fila, { fecha_inicio_estimada, inicio_del_plan: fila.fecha_inicio_estimada });
r.escrito = {
    vigente: m.horarioEscrito(p1, r.horario),
    fila_movida: m.horarioEscrito(p2, r.horario),
    en_blanco: m.horarioEscrito(p1, r.en_blanco),
    sin_retoque: m.horarioEscrito(p1, undefined),
    solo_persona: m.horarioEscrito(p1, r.persona),
    persona_y_horario: m.horarioEscrito(p1, r.ambos),
    con_segundos: escritoEn(p1, '2026-10-01T14:00:00'),
    igual_al_plan: escritoEn(p1, '2026-10-01T07:00'),
    sin_hora: escritoEn(p1, '2026-10-01'),
    afuera: m.horarioEscrito(afuera, completo),
};

// Borradores viejos: la fila entera.
r.vieja_identica = m.retoquesAlDia({ '12720-68-7': { ...p1 } }, () => p1, nombres);
r.vieja_persona = m.retoquesAlDia({ k: { ...p1, id_operario: NAHUEL } }, () => p1, nombres);
r.vieja_plan_anterior = m.retoquesAlDia({ k: { ...p1, id_maquinaria: FRESADORA_2 } }, () => p2, nombres);
r.vieja_persona_plan_anterior = m.retoquesAlDia({ k: { ...p1, id_operario: NAHUEL } }, () => p2, nombres);
r.vieja_horario = m.retoquesAlDia({ k: { ...p1, fecha_inicio_estimada: '2026-10-01T14:00' } }, () => p1, nombres);
r.vieja_horario_plan_anterior = m.retoquesAlDia(
    { k: { ...p1, fecha_inicio_estimada: '2026-10-01T14:00' } }, () => p2, nombres);
r.vieja_va_a_mano = m.retoquesAlDia({ k: { ...p1, id_maquinaria: null, usa_maquina: false, va_a_mano: true } },
    () => p1, nombres);
r.vieja_persona_desconocida = m.retoquesAlDia({ k: { ...p1, id_operario: 999 } }, () => p2, nombres);
r.vieja_sin_asignar = m.retoquesAlDia({ k: { ...p1, id_operario: null } }, () => p1, nombres);
r.huerfanas = m.retoquesAlDia({ vieja: { ...p1, id_operario: NAHUEL }, nueva: { id_operario: NAHUEL } },
    () => undefined, nombres);

const alDia = { k: { id_operario: NAHUEL } };
r.nada_que_cambiar_mismo_objeto = m.retoquesAlDia(alDia, () => p2, nombres) === alDia;
r.sin_ediciones = m.retoquesAlDia(undefined, () => p1, nombres);

console.log(JSON.stringify(r));
"""


@pytest.fixture(scope="module")
def r():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "retoquesPlan.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck", "--strict"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"retoquesPlan.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        datos = {
            "p1": FRESADO_P1, "p2": FRESADO_P2,
            "ops": NOMBRES_OPERARIOS, "maqs": NOMBRES_MAQUINAS,
            "ids": {"CELIZ": CELIZ, "GUSTAVO": GUSTAVO, "NAHUEL": NAHUEL,
                    "FRESADORA_CNC": FRESADORA_CNC, "FRESADORA_2": FRESADORA_2},
        }
        salida = subprocess.run(
            ["node", "driver.js", json.dumps(datos)],
            cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
        )
        return json.loads(salida.stdout)


def test_el_retoque_guarda_solo_el_campo_cambiado(r):
    assert r["persona"] == {"id_operario": NAHUEL}
    aplicada = r["persona_aplicada"]
    assert aplicada["id_operario"] == NAHUEL
    # El nombre acompaña: la hoja del pañol imprimía el de la persona del plan.
    assert aplicada["operario_nombre"] == "NAHUEL PEREZ"
    assert {k: v for k, v in aplicada.items() if k not in ("id_operario", "operario_nombre")} == {
        k: v for k, v in FRESADO_P1.items() if k not in ("id_operario", "operario_nombre")}


def test_volver_a_lo_del_plan_no_es_un_retoque(r):
    assert r["persona_de_vuelta"] is None
    assert r["mismo_minuto"] is None, "«…T07:00» y «…T07:00:00» son el mismo horario"


def test_despues_de_recalcular_queda_la_persona_y_lo_demas_es_del_plan_nuevo(r):
    fila = r["persona_tras_recalculo"]
    assert fila["id_operario"] == NAHUEL
    assert fila["operario_nombre"] == "NAHUEL PEREZ"
    for campo in ("inicio_min", "fin_min", "fecha_inicio_estimada", "fecha_fin_estimada",
                  "id_maquinaria", "maquinaria_nombre"):
        assert fila[campo] == FRESADO_P2[campo], campo


def test_el_horario_escrito_vale_mientras_la_fila_no_se_mueva(r):
    assert r["horario"] == {
        "fecha_inicio_estimada": "2026-10-01T14:00",
        "inicio_del_plan": "2026-10-01T07:00:00",
    }
    assert r["horario_mismo_plan"]["fecha_inicio_estimada"] == "2026-10-01T14:00"
    # El recálculo la movió: el horario del plan viejo no se encima con el nuevo.
    assert r["horario_fila_movida"]["fecha_inicio_estimada"] == FRESADO_P2["fecha_inicio_estimada"]


def test_al_recalcular_se_descarta_el_horario_y_se_conserva_la_persona(r):
    assert r["ambos"]["id_operario"] == NAHUEL
    assert r["ambos_tras_recalculo"] == {"k": {"id_operario": NAHUEL}}
    # Si el retoque era sólo el horario, no queda nada.
    assert r["solo_horario_tras_recalculo"] == {}
    # Y se puede contar para avisarlo: dos horarios que dejan de valer, ninguno en el mismo plan.
    assert r["no_van"] == 2
    assert r["no_van_mismo_plan"] == 0
    assert r["limpia_al_cambiar"] == {"id_operario": NAHUEL}


def test_el_horario_en_blanco_se_respeta_mientras_se_corrige(r):
    assert r["en_blanco"] == {"fecha_inicio_estimada": "", "inicio_del_plan": "2026-10-01T07:00:00"}
    assert r["en_blanco_aplicado"] == ""


def test_al_confirmar_se_guarda_el_horario_escrito_que_vale(r):
    """El plan guarda minutos, no fechas: el horario escrito se convierte al confirmar.

    Hasta el 30/09/2026 la fila planificada se mandaba con los minutos del plan: se
    escribió 11:00 en un paso que el plan tenía a las 07:20 y quedó guardado a las 07:20.
    `horarioEscrito` dice cuál hay que convertir; lo que no (en blanco, el de una fila que
    el recálculo movió, uno igual al del plan) se guarda con los minutos del plan.
    """
    assert r["escrito"] == {
        "vigente": "2026-10-01T14:00",
        "fila_movida": None,
        "en_blanco": None,
        "sin_retoque": None,
        "solo_persona": None,
        "persona_y_horario": "2026-10-01T14:00",
        "con_segundos": "2026-10-01T14:00",
        "igual_al_plan": None,
        "sin_hora": None,
        "afuera": "2026-10-03T08:00",
    }


def test_la_marca_de_cambiada_es_solo_si_la_fila_difiere_del_plan(r):
    assert r["marca"] == {
        "cambiada": True,
        "coincide_con_el_plan": False,
        "sin_retoque": False,
        "horario_que_ya_no_va": False,
        "horario_que_va": True,
    }


def test_no_necesita_y_deshacerlo(r):
    assert r["va_a_mano"] == {"id_maquinaria": None, "usa_maquina": False, "va_a_mano": True}
    aplicado = r["va_a_mano_aplicado"]
    assert aplicado["maquinaria_nombre"] is None
    assert aplicado["id_maquinaria"] is None and aplicado["va_a_mano"] is True
    assert r["va_a_mano_deshecho"] is None


def test_el_paso_que_quedo_afuera_se_completa_a_mano(r):
    assert r["afuera"] == {
        "id_operario": NAHUEL, "id_maquinaria": FRESADORA_2,
        "fecha_inicio_estimada": "2026-10-03T08:00", "inicio_del_plan": None,
    }
    aplicado = r["afuera_aplicado"]
    assert (aplicado["operario_nombre"], aplicado["maquinaria_nombre"]) == ("NAHUEL PEREZ", "FRESADORA 2")
    assert aplicado["fecha_inicio_estimada"] == "2026-10-03T08:00"
    assert r["afuera_sigue_igual"] is True
    # Si un recálculo le encuentra lugar, queda lo elegido y el horario lo pone el plan.
    assert r["afuera_entra_al_plan"] == {"k": {"id_operario": NAHUEL, "id_maquinaria": FRESADORA_2}}


def test_borrador_viejo_el_retoque_identico_a_su_fila_no_deja_nada(r):
    """El caso del borrador 19: Celiz en la FRESADORA CNC, igual que el plan."""
    assert r["vieja_identica"] == {}


def test_borrador_viejo_sobre_el_mismo_plan_queda_lo_que_se_cambio(r):
    assert r["vieja_persona"] == {"k": {"id_operario": NAHUEL}}
    assert r["vieja_horario"] == {"k": {
        "fecha_inicio_estimada": "2026-10-01T14:00", "inicio_del_plan": "2026-10-01T07:00:00"}}
    assert r["vieja_va_a_mano"] == {"k": {"id_maquinaria": None, "usa_maquina": False, "va_a_mano": True}}
    assert r["vieja_sin_asignar"] == {"k": {"id_operario": None}}


def test_borrador_viejo_sobre_un_plan_anterior_no_trae_la_persona_de_aquel_plan(r):
    """Se eligió la FRESADORA 2 sobre el plan viejo y después se recalculó.

    La fila vieja trae a Celiz porque era lo del plan viejo, no porque alguien lo
    eligiera: no se impone sobre Gustavo. La máquina sí la eligió la persona. Y el
    horario es el del plan viejo: se descarta.
    """
    assert r["vieja_plan_anterior"] == {"k": {"id_maquinaria": FRESADORA_2}}
    # A Nahuel sí lo eligió alguien (el nombre de la fila vieja es el de Celiz).
    assert r["vieja_persona_plan_anterior"] == {"k": {"id_operario": NAHUEL}}
    assert r["vieja_horario_plan_anterior"] == {}
    # Una persona que no se encuentra no se puede descartar: se conserva.
    assert r["vieja_persona_desconocida"] == {"k": {"id_operario": 999}}


def test_sin_su_fila_la_vieja_se_va_y_la_nueva_se_queda(r):
    assert r["huerfanas"] == {"nueva": {"id_operario": NAHUEL}}


def test_si_no_hay_nada_que_cambiar_devuelve_lo_mismo(r):
    assert r["nada_que_cambiar_mismo_objeto"] is True
    assert r["sin_ediciones"] == {}
