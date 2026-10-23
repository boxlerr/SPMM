"""Cuánto tarda el planificador: el corte por mejoras de verdad y el tiempo que dice la pantalla.

Julián, 23/10/2026, después de que Lucas esperara 305 s por un plan de 54 OT: «hay que
optimizar eso que tarda tanto, no es factible. Además poner un tiempo estimado en la
pantalla de carga».

1. El vigía del solver sólo cuenta como mejora la que baja el objetivo al menos
   MEJORA_RELEVANTE: las mejoras mínimas que el solver encuentra cada pocos segundos ya
   no estiran la espera hasta el tope.
2. La pantalla calcula el tiempo estimado con las MISMAS constantes del presupuesto del
   solver (frontend/src/lib/tiempoDelCalculo.ts). Si cambian acá, tienen que cambiar allá.
"""
import re
from pathlib import Path

from backend.application import PlanificacionService as PS

RAIZ = Path(__file__).resolve().parents[2]
FRONT = RAIZ / "frontend" / "src" / "lib" / "tiempoDelCalculo.ts"


def _constante_del_front(nombre: str) -> float:
    texto = FRONT.read_text(encoding="utf-8")
    m = re.search(rf"export const {nombre} = ([0-9.]+);", texto)
    assert m, f"no está {nombre} en {FRONT.name}"
    return float(m.group(1))


def test_las_constantes_del_front_son_las_del_solver():
    for nombre in ("SOLVER_PISO_SEG", "SOLVER_SEG_POR_PROCESO", "SOLVER_MINIMO_SEG",
                   "SOLVER_TECHO_SEG_DEFAULT", "SEGUNDA_PASADA_SEG_MAX"):
        assert _constante_del_front(nombre) == float(getattr(PS, nombre)), nombre


def test_el_lote_de_lucas_ya_no_espera_cuatro_minutos(monkeypatch):
    monkeypatch.delenv("SOLVER_TECHO_SEG", raising=False)
    monkeypatch.delenv("SOLVER_MAX_SEG", raising=False)
    monkeypatch.delenv("SOLVER_CORTE_SIN_MEJORA_SEG", raising=False)
    seg, corte = PS.presupuesto_solver(360)   # las 54 OT del 23/10
    assert seg == 90 and corte == 15
    # Las tandas chicas no pierden nada: el piso sigue en 60 s.
    assert PS.presupuesto_solver(27) == (60, 10)
    assert PS.SEGUNDA_PASADA_SEG_MAX == 30


class _VigiaDePrueba(PS._VigiaDeMejoras):
    """El vigía con el objetivo que se le dicte (fuera de un Solve no hay solución)."""

    def __init__(self, ultima):
        super().__init__(ultima)
        self.valor = None

    def ObjectiveValue(self):  # noqa: N802 (el nombre es el de OR-Tools)
        return self.valor


def test_solo_las_mejoras_de_verdad_estiran_la_espera(monkeypatch):
    reloj = {"t": 0.0}
    import time as _time
    monkeypatch.setattr(_time, "monotonic", lambda: reloj["t"])
    ultima = {"t": None}
    v = _VigiaDePrueba(ultima)

    def llega(t, valor):
        reloj["t"] = t
        v.valor = valor
        v.on_solution_callback()

    llega(1, 1_000_000)            # la primera solución siempre cuenta
    assert ultima["t"] == 1
    llega(5, 999_800)              # 0,02%: se acepta el plan, pero no es «mejora»
    llega(9, 999_600)              # 0,04% acumulado desde la última que contó: tampoco
    assert ultima["t"] == 1
    llega(12, 999_400)             # 0,06% desde la de t=1: cuenta
    assert ultima["t"] == 12
    llega(20, 900_000)             # una mejora grande cuenta
    assert ultima["t"] == 20
