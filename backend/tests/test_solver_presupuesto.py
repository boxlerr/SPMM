"""
Tests del presupuesto de tiempo del solver (presupuesto_solver).

Por qué existen: el presupuesto dejó de ser un número fijo y pasó a salir de una
cuenta con el tamaño del lote. Esa cuenta se calibró contra las corridas reales
guardadas en planificacion_intento, y si alguien la mueve sin querer el síntoma no
se ve en ningún test funcional: el plan sale igual, sólo que peor (tandas grandes
cortadas antes de tiempo) o más lento (tandas chicas de un minuto pasadas a
cuatro). Acá se fija el contrato de la cuenta, sin correr el solver.

La equivalencia OT -> procesos que se usa abajo es la medida sobre las tandas
reales de planificación: 7,27 procesos por OT (33 OT -> 204 procesos, 34 -> 210,
11 -> 62). No es el promedio de la base entera (4,42): al planificador se le mandan
las OT grandes.
"""
import pytest

from backend.application.PlanificacionService import (
    SOLVER_CORTE_MIN_SEG,
    SOLVER_PISO_SEG,
    SOLVER_SEG_POR_PROCESO,
    SOLVER_TECHO_SEG_DEFAULT,
    presupuesto_solver,
    SOLVER_MINIMO_SEG,
)

PROCESOS_POR_OT = 7.27


def _procesos_de(ordenes: int) -> int:
    return round(ordenes * PROCESOS_POR_OT)


@pytest.fixture(autouse=True)
def _sin_env(monkeypatch):
    # Hoy Cloud Run NO tiene ninguna de las dos seteadas, y todo el punto del cambio
    # es que funcione así. Si el entorno del que corre los tests las tiene puestas,
    # el test mediría otra cosa.
    monkeypatch.delenv("SOLVER_MAX_SEG", raising=False)
    monkeypatch.delenv("SOLVER_CORTE_SIN_MEJORA_SEG", raising=False)


# ---------------------------------------------------------------------------
# La cuenta, por tamaño de lote
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "ordenes, min_seg, max_seg_esperado",
    [
        # 6 OT: en los logs son entre 30 y 73 procesos y hoy la grande se come los
        # 60 s enteros. Tiene que quedar cerca de ese minuto, no irse a cuatro.
        (6, 60, 100),
        # 20 OT: ni tanda chica ni tanda grande, en el medio de la recta.
        (20, 100, 160),
        # 60 OT: las que necesitan ~244 s. Acá ya tiene que estar el techo entero.
        (60, SOLVER_TECHO_SEG_DEFAULT, SOLVER_TECHO_SEG_DEFAULT),
        # 200 OT: sigue en el techo, no se dispara.
        (200, SOLVER_TECHO_SEG_DEFAULT, SOLVER_TECHO_SEG_DEFAULT),
    ],
)
def test_presupuesto_por_tamano_de_lote(ordenes, min_seg, max_seg_esperado):
    seg, _corte = presupuesto_solver(_procesos_de(ordenes))
    assert min_seg <= seg <= max_seg_esperado, f"{ordenes} OT -> {seg}s"


def test_la_tanda_de_6_ot_que_se_comia_el_minuto():
    # El caso citado en el código: 6 OT, 73 procesos, corridas de 30 a 61 s bajo un
    # tope de 60. Es una de las dos anclas de la recta, y da 80 s.
    seg, _corte = presupuesto_solver(73)
    assert seg == 80


def test_el_techo_se_alcanza_cerca_de_las_50_ot():
    # La otra ancla: 364 procesos (~50 OT) es donde la recta toca los 240 s. Justo
    # abajo todavía no llega; de ahí para arriba, techo y nada más.
    assert presupuesto_solver(362)[0] < SOLVER_TECHO_SEG_DEFAULT
    assert presupuesto_solver(364)[0] == SOLVER_TECHO_SEG_DEFAULT


def test_no_hay_default_de_env_que_haga_falta_tocar():
    # Sin variables de entorno el techo tiene que ser el del código: el backend se
    # deploya a mano y esto tiene que salir con el deploy, sin tocar Cloud Run.
    assert presupuesto_solver(10_000)[0] == SOLVER_TECHO_SEG_DEFAULT == 240


def test_es_monotono_y_nunca_pasa_el_techo():
    anterior = 0
    for n in range(0, 1200, 7):
        seg, _ = presupuesto_solver(n)
        assert seg >= anterior, f"bajó el presupuesto en {n} procesos"
        assert seg <= SOLVER_TECHO_SEG_DEFAULT
        anterior = seg


def test_lote_vacio_o_absurdo_no_rompe():
    # Un lote sin procesos no debería llegar nunca al solver, pero si llega tiene
    # que devolver un presupuesto usable y no un 0 que da UNKNOWN.
    for n in (0, None, -5):
        seg, corte = presupuesto_solver(n)
        assert seg == SOLVER_MINIMO_SEG
        assert corte >= SOLVER_CORTE_MIN_SEG


def test_nadie_recibe_menos_que_los_60_segundos_de_antes():
    """El piso duro: ninguna tanda sale peor parada que con el tope plano de 60 s.

    Es la garantía que hace que este cambio sea seguro de subir. La recta calibrada
    pasa por debajo de los 60 s en todo lote de 35 procesos o menos —el caso más
    frecuente del taller—, así que sin este piso la corrida de todos los días perdía
    presupuesto para que ganara la de 60 OT.
    """
    for n in (0, 1, 5, 20, 27, 35, 36, 73, 300, 1000):
        assert presupuesto_solver(n)[0] >= 60, f"{n} procesos quedaron por debajo de los 60 s de antes"


def test_la_recta_pasa_por_las_dos_anclas_medidas():
    # Los dos puntos que se midieron contra los logs de producción, y que son los
    # que hay que recalcular si alguien toca piso o pendiente:
    #   73 procesos (la tanda de 6 OT que hoy se come el minuto) -> 80 s
    #   364 procesos (~50 OT, camino a las 60) -> el techo
    assert presupuesto_solver(73)[0] == 80
    assert presupuesto_solver(364)[0] == SOLVER_TECHO_SEG_DEFAULT


def test_el_techo_se_puede_bajar_a_mano_por_debajo_del_minimo():
    # La válvula de escape: si alguien fija el techo en 30 s es porque quiere 30 s,
    # y el piso de 60 no se lo puede pisar.
    assert presupuesto_solver(1, techo_seg=30)[0] == 30
    assert presupuesto_solver(1000, techo_seg=30)[0] == 30


# ---------------------------------------------------------------------------
# El corte por estancamiento
# ---------------------------------------------------------------------------

def test_corte_escala_con_el_presupuesto():
    # 1/6 del presupuesto, que es la proporción que regía con el tope plano
    # (10 s sobre 60). Una tanda chica corta como siempre; una grande espera más
    # porque entre mejora y mejora el solver tarda más.
    chico = presupuesto_solver(_procesos_de(6))
    grande = presupuesto_solver(_procesos_de(60))
    # 6 OT: 11 s, prácticamente el corte de siempre. 60 OT: 40 s, cuatro veces más.
    assert chico[1] <= SOLVER_CORTE_MIN_SEG + 2
    assert grande[1] == 40


def test_corte_nunca_baja_de_los_diez_segundos_de_siempre():
    for n in (0, 1, 20, 73):
        assert presupuesto_solver(n)[1] >= SOLVER_CORTE_MIN_SEG


# ---------------------------------------------------------------------------
# Las válvulas por entorno (que nadie necesita tocar, pero siguen andando)
# ---------------------------------------------------------------------------

def test_env_baja_el_techo(monkeypatch):
    monkeypatch.setenv("SOLVER_MAX_SEG", "90")
    seg, corte = presupuesto_solver(_procesos_de(60))
    assert seg == 90
    assert corte == 15


def test_env_fija_el_corte(monkeypatch):
    monkeypatch.setenv("SOLVER_CORTE_SIN_MEJORA_SEG", "5")
    assert presupuesto_solver(_procesos_de(60))[1] == 5


def test_techo_explicito_gana_sobre_el_env(monkeypatch):
    monkeypatch.setenv("SOLVER_MAX_SEG", "90")
    assert presupuesto_solver(_procesos_de(60), techo_seg=120)[0] == 120


# ---------------------------------------------------------------------------
# Que el solver lo USE de verdad
# ---------------------------------------------------------------------------

def test_el_solver_usa_el_presupuesto_calculado():
    """Red de contención: que nadie vuelva al tope plano sin que se note.

    Los tests de arriba verifican la CUENTA. Ninguno verificaba que el solver la
    use: si alguien borra la llamada y escribe `max_time_in_seconds = 60`, la
    cuenta sigue siendo correcta, los tests siguen en verde, y las tandas grandes
    vuelven a salir con un plan peor sin una sola señal.

    Se mira el código fuente y no el comportamiento porque probarlo de verdad pide
    armar un modelo CP-SAT entero: caro, lento y frágil para lo que se quiere
    cuidar, que es una sola línea. Mismo criterio que el test de fuente que cuida
    las fechas sin zona en OrdenTrabajoRepository.
    """
    import inspect
    from backend.application import PlanificacionService

    cuerpo = inspect.getsource(PlanificacionService._resolver_planificacion)

    assert "presupuesto_solver(" in cuerpo, (
        "_resolver_planificacion dejó de calcular el presupuesto con presupuesto_solver"
    )
    assert "max_time_in_seconds = max_seg" in cuerpo, (
        "el presupuesto se calcula pero ya no se le pasa al solver"
    )
    assert "stop_search" in inspect.getsource(PlanificacionService), (
        "desapareció el corte por estancamiento"
    )
