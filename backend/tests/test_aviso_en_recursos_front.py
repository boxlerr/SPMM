"""«Ir a arreglarlo»: el link del aviso del plan y cómo lo lee Recursos.

Revisión del 23/09/2026 sobre el commit que llevó el link a la fila exacta. Tres
cosas que el link hacía mal y que se prueban acá, sin navegador:

- Viajaba el conjunto FINAL de rangos (lo que la máquina tenía al calcular más lo
  nuevo). Desde un borrador viejo, Recursos tildaba «propuesto por el aviso» un rango
  que alguien le había sacado a la máquina a propósito después. Ahora viaja lo que
  el aviso SUMA, y por fila cuando no a todas les suma lo mismo.
- Con varias máquinas en el aviso, guardar una fuera de orden (la tercera primero)
  no abría ninguna más y se perdían los rangos propuestos para las otras.
- El cartel de arriba decía lo mismo para cualquier solución de la solapa: «Editar
  rangos» a quien venía a volver a encenderle una habilidad a alguien, y «solapa de
  solo lectura» a quien podía editar máquinas pero no rangos. Y la solución llegaba
  con el «O » de alternativa adelante, sola, alternativa a nada.

Todo vive en `frontend/src/lib/avisoEnRecursos.ts`: este test lo compila con el tsc
del repo, lo corre con node y mira lo que sale.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

RAIZ = Path(__file__).resolve().parents[2]
FRONT_LIB = RAIZ / "frontend" / "src" / "lib"
TSC = RAIZ / "frontend" / "node_modules" / ".bin" / "tsc"

OFICIAL, MEDIO, CNC = 7, 2, 9

DRIVER = r"""
const m = require('./avisoEnRecursos.js');
const nombres = { 7: 'OFICIAL', 2: 'MEDIO OFICIAL', 9: 'OFICIAL CNC' };
const nombreDeRango = (id) => nombres[id] || '';
const MAQ = 'Recursos › Recurso maquinaria';
const HUM = 'Recursos › Recurso humano';
const PRO = 'Recursos › Procesos';

const maquinas = (objetivos) => ({
    texto: 'Agregale **OFICIAL CNC** a las máquinas', donde: MAQ,
    accion: { tipo: 'maquinaria', id: objetivos[0].id, nombre: 'F', rangos: objetivos[0].rangos, objetivos },
});

const links = {
    // Las dos suman lo mismo: una sola lista para todas.
    iguales: m.enlaceARecursos(maquinas([
        { id: 3, nombre: 'FRESADORA 1', rangos: [7, 9], suma_ids: [9] },
        { id: 4, nombre: 'FRESADORA 2', rangos: [2, 9], suma_ids: [9] },
    ]), 'Fresado: cuello'),
    // A la 3 le suma OFICIAL y OFICIAL CNC, a la 4 solo OFICIAL CNC.
    distintas: m.enlaceARecursos(maquinas([
        { id: 3, nombre: 'FRESADORA 1', rangos: [7, 9], suma_ids: [7, 9] },
        { id: 4, nombre: 'FRESADORA 2', rangos: [7, 9], suma_ids: [9] },
    ]), 'Fresado: cuello'),
    // Aviso de antes del 23/09: trae `suma` en nombres, no `suma_ids`.
    con_nombres: m.enlaceARecursos(maquinas([
        { id: 4, nombre: 'FRESADORA 2', rangos: [2, 7, 9], suma: ['OFICIAL CNC'], tenia: ['MEDIO OFICIAL', 'OFICIAL'] },
    ]), 'Fresado', nombreDeRango),
    // Aviso viejísimo: solo el conjunto final.
    solo_final: m.enlaceARecursos(maquinas([{ id: 4, nombre: 'FRESADORA 2', rangos: [2, 9] }]), 'Fresado'),
    // Nada para sumar: no viaja `rangos`.
    nada: m.enlaceARecursos(maquinas([{ id: 4, nombre: 'FRESADORA 2', rangos: [9], suma_ids: [] }]), 'x'),
    skill: m.enlaceARecursos({
        texto: 'Volvé a encenderle **CONTROL** a **JUAN P.**: ya tiene el rango.', donde: HUM,
        accion: { tipo: 'skill_nativa', id: 30, nombre: 'CONTROL', habilitado: true,
                  objetivos: [{ id: 45, nombre: 'JUAN' }, { id: 46, nombre: 'ANA' }] },
    }, 'Control: nadie'),
    dale_rango: m.enlaceARecursos({ texto: 'O dale **OFICIAL** a alguien más: con cualquiera alcanza.', donde: HUM }, 'T'),
    habilidad: m.enlaceARecursos({ texto: 'O cargale la habilidad a mano en la ficha de quien lo vaya a hacer.', donde: HUM }, 'T'),
    disponible: m.enlaceARecursos({
        texto: 'Marcalos como no disponibles y salen del plan.', donde: HUM,
        objetivo: { tipo: 'operario', id: 88, nombre: 'VACANTE' },
    }, 'Vacantes'),
    en_que_maquinas: m.enlaceARecursos({
        texto: 'Decile en qué máquinas se hace: se cargan desplegando el proceso.', donde: PRO,
        objetivo: { tipo: 'proceso', id: 500, nombre: 'Preparación de pintura' },
    }, 'Preparación de pintura'),
    sin_rango: m.enlaceARecursos({
        texto: 'Cargale OFICIAL: son los que ya aceptan las máquinas.', donde: PRO,
        objetivo: { tipo: 'proceso', id: 501, nombre: 'P', rangos: [7] },
    }, 'P'),
    sumale: m.enlaceARecursos({ texto: 'Sumale OFICIAL al proceso: lo tienen 3 personas.', donde: PRO }, 'P'),
    fuera: m.enlaceARecursos({ texto: 'O planificá menos OTs juntas.', donde: 'Al elegir las OTs' }, 'P'),
};

const leer = (url) => {
    const p = new URLSearchParams(url.split('?')[1]);
    const foco = m.leerFocoDelLink(p);
    return { foco, rangos: m.leerRangosDelLink(p, foco), cambio: m.leerCambioDelLink(p) };
};

const pend = (s) => (id) => s.includes(id);
const todos = { personas: true, maquinas: true, procesos: true, rangos: true };
const sin = (k) => Object.assign({}, todos, { [k]: false });

console.log(JSON.stringify({
    links,
    leido: {
        distintas: leer(links.distintas),
        iguales: leer(links.iguales),
        // Un link de antes del cambio: `rangos` sin id vale para todas las del foco.
        viejo: leer('/recursos?tab=maquinas&foco=3,4&rangos=7,9'),
        basura: leer('/recursos?tab=maquinas&foco=3,x,-1,3&rangos=abc&cambio=cualquiera'),
    },
    siguiente: {
        la_tercera_primero: m.siguientePendiente([3, 4, 5], 5, pend([3, 4])),
        saltea_la_que_ya_tiene: m.siguientePendiente([3, 4, 5], 3, pend([5])),
        ninguna: m.siguientePendiente([3, 4, 5], 4, pend([])),
        al_llegar: m.siguientePendiente([3, 4, 5], null, pend([4, 5])),
        no_repite_la_guardada: m.siguientePendiente([3], 3, pend([3])),
    },
    como: {
        humano_skill: m.comoSeHace('operarios', 'skill_nativa', todos),
        humano_habilidad: m.comoSeHace('operarios', 'habilidad', todos),
        humano_disponible: m.comoSeHace('operarios', 'disponibilidad', todos),
        humano_rangos: m.comoSeHace('operarios', 'rangos', todos),
        humano_sin_permiso: m.comoSeHace('operarios', 'skill_nativa', sin('personas')),
        maquina_sin_rangos: m.comoSeHace('maquinas', 'rangos', sin('rangos')),
        maquina_ok: m.comoSeHace('maquinas', 'rangos', todos),
        proceso_rangos_sin_rangos: m.comoSeHace('procesos', 'rangos', sin('rangos')),
        proceso_maquinas_sin_rangos: m.comoSeHace('procesos', 'maquinas', sin('rangos')),
        proceso_maquinas_sin_procesos: m.comoSeHace('procesos', 'maquinas', sin('procesos')),
        proceso_general_sin_rangos: m.comoSeHace('procesos', null, sin('rangos')),
        proceso_nada: m.comoSeHace('procesos', null, { personas: true, maquinas: true, procesos: false, rangos: false }),
    },
    sin_o: [m.sinAlternativa('O dale **OFICIAL** a alguien'), m.sinAlternativa('Ojo con esto'), m.sinAlternativa('**Volvé** a encenderle')],
    params: ['tab', 'rangos', 'rangos.12', 'cambio', 'hacer', 'orden'].map(m.esParamDelAviso),
}));
"""


def _q(url):
    assert url and url.startswith("/recursos?"), url
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


@pytest.fixture(scope="module")
def front():
    if not (shutil.which("node") and TSC.exists()):
        pytest.skip("hace falta node y el tsc del frontend (npm install)")
    with tempfile.TemporaryDirectory() as tmp:
        compilado = subprocess.run(
            [str(TSC), str(FRONT_LIB / "avisoEnRecursos.ts"),
             "--outDir", tmp, "--rootDir", str(FRONT_LIB),
             "--target", "es2020", "--module", "commonjs",
             "--moduleResolution", "node", "--skipLibCheck", "--strict"],
            capture_output=True, text=True, timeout=180,
        )
        assert compilado.returncode == 0, (
            f"avisoEnRecursos.ts no compila:\n{compilado.stdout}\n{compilado.stderr}")
        (Path(tmp) / "driver.js").write_text(DRIVER)
        salida = subprocess.run(
            ["node", "driver.js"], cwd=tmp, capture_output=True, text=True, timeout=120, check=True,
        )
        return json.loads(salida.stdout)


# --- Lo que viaja en `rangos` -------------------------------------------------

def test_viaja_lo_que_el_aviso_suma_y_no_el_conjunto_final(front):
    q = _q(front["links"]["iguales"])
    assert q["tab"] == "maquinas"
    assert q["foco"] == "3,4"
    # El final de la FRESADORA 1 era OFICIAL + OFICIAL CNC; el aviso solo suma CNC.
    assert q["rangos"] == str(CNC)


def test_si_a_cada_maquina_le_suma_otra_cosa_va_uno_por_fila(front):
    q = _q(front["links"]["distintas"])
    assert "rangos" not in q, "una lista común le propondría a una lo que le falta a la otra"
    assert q["rangos.3"] == f"{OFICIAL},{CNC}"
    assert q["rangos.4"] == str(CNC)
    # Y Recursos lo lee igual que como salió.
    assert front["leido"]["distintas"]["rangos"] == {"3": [OFICIAL, CNC], "4": [CNC]}


def test_un_aviso_de_antes_con_nombres_propone_solo_lo_que_suma(front):
    """Sin `suma_ids` (backend sin deployar, borrador viejo) se usa `suma`, en nombres:
    el MEDIO OFICIAL y el OFICIAL que la máquina tenía al calcular no se proponen."""
    assert _q(front["links"]["con_nombres"])["rangos"] == str(CNC)


def test_un_aviso_sin_nada_manda_el_final_y_recursos_le_saca_lo_que_ya_tiene(front):
    assert _q(front["links"]["solo_final"])["rangos"] == f"{MEDIO},{CNC}"


def test_si_no_suma_nada_no_viaja_rangos(front):
    q = _q(front["links"]["nada"])
    assert q["foco"] == "4"
    assert not any(k.startswith("rangos") for k in q)


def test_un_link_viejo_con_una_sola_lista_vale_para_todas(front):
    leido = front["leido"]["viejo"]
    assert leido["foco"] == [3, 4]
    assert leido["rangos"] == {"3": [OFICIAL, CNC], "4": [OFICIAL, CNC]}


def test_lo_que_no_se_entiende_del_link_se_ignora(front):
    leido = front["leido"]["basura"]
    assert leido["foco"] == [3]
    assert leido["rangos"] is None
    assert leido["cambio"] is None


# --- Varias filas: la que falta, sin importar el orden --------------------------

def test_guardar_la_tercera_primero_abre_la_primera(front):
    assert front["siguiente"]["la_tercera_primero"] == 3


def test_se_saltea_la_que_ya_tiene_todo(front):
    assert front["siguiente"]["saltea_la_que_ya_tiene"] == 5


def test_sin_pendientes_no_abre_ninguna(front):
    assert front["siguiente"]["ninguna"] is None
    assert front["siguiente"]["no_repite_la_guardada"] is None


def test_al_llegar_abre_la_primera_que_falta(front):
    assert front["siguiente"]["al_llegar"] == 4


# --- Qué clase de cambio es y qué dice el cartel --------------------------------

@pytest.mark.parametrize("link,cambio,tab", [
    ("skill", "skill_nativa", "operarios"),
    ("dale_rango", "rangos", "operarios"),
    ("habilidad", "habilidad", "operarios"),
    ("disponible", "disponibilidad", "operarios"),
    ("en_que_maquinas", "maquinas", "procesos"),
    ("sin_rango", "rangos", "procesos"),
    ("sumale", "rangos", "procesos"),
    ("iguales", "rangos", "maquinas"),
])
def test_el_link_dice_que_clase_de_cambio_es(front, link, cambio, tab):
    q = _q(front["links"][link])
    assert q["tab"] == tab
    assert q["cambio"] == cambio


def test_la_skill_nativa_no_lleva_rangos_y_apunta_a_las_personas(front):
    q = _q(front["links"]["skill"])
    assert q["foco"] == "45,46"
    assert not any(k.startswith("rangos") for k in q)


def test_la_solucion_llega_sin_el_o_de_alternativa(front):
    q = _q(front["links"]["dale_rango"])
    assert q["hacer"] == "Dale OFICIAL a alguien más: con cualquiera alcanza."
    assert _q(front["links"]["habilidad"])["hacer"].startswith("Cargale la habilidad")
    assert front["sin_o"] == ["Dale OFICIAL a alguien", "Ojo con esto", "Volvé a encenderle"]


def test_lo_que_no_se_hace_en_recursos_no_tiene_link(front):
    assert front["links"]["fuera"] is None


def test_el_objetivo_sin_boton_cae_en_su_fila(front):
    q = _q(front["links"]["en_que_maquinas"])
    assert q["foco"] == "500"
    assert _q(front["links"]["sin_rango"])["rangos"] == str(OFICIAL)
    assert _q(front["links"]["disponible"])["foco"] == "88"


def test_el_cartel_explica_el_cambio_que_se_vino_a_hacer(front):
    como = front["como"]
    # Volver a encender una habilidad no se hace en «Editar»: es el interruptor.
    assert "Habilidades" in como["humano_skill"] and "interruptor" in como["humano_skill"]
    assert "Editar" in como["humano_habilidad"]
    assert "Ausente" in como["humano_disponible"]
    assert "Editar" in como["humano_rangos"]
    assert "no podés" in como["humano_sin_permiso"]


def test_el_cartel_mira_el_permiso_que_pide_ese_cambio(front):
    como = front["como"]
    # Puede editar máquinas, no rangos: no es «solo lectura», es «no sus rangos».
    assert "solo lectura" not in como["maquina_sin_rangos"]
    assert "no sus rangos" in como["maquina_sin_rangos"]
    assert "Rangos" in como["maquina_ok"]
    # Procesos sin Rangos: lo dice, en vez de mandarlo a un editor que no le aparece.
    assert "no sus rangos" in como["proceso_rangos_sin_rangos"]
    # Pero cargar en qué máquina se hace sí puede.
    assert "no podés" not in como["proceso_maquinas_sin_rangos"]
    assert "no podés" in como["proceso_maquinas_sin_procesos"]
    assert "no los podés cambiar" in como["proceso_general_sin_rangos"]
    assert "solo lectura" in como["proceso_nada"]


def test_la_url_se_limpia_de_todo_lo_del_aviso(front):
    assert front["params"] == [True, True, True, True, True, False]
