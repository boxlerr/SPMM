"""
Los diagnósticos tienen que decir la causa REAL y mandar al arreglo que sirve.
Casos sacados del plan de 34 OTs del 19/08/2026.
"""
from backend.application.DiagnosticoPlanificacion import (
    _como_alternativa,
    _listar,
    _listar_rangos,
    construir_diagnosticos,
)

AYUDANTE, INGRESANTE, OFICIAL = 5, 6, 1
NOMBRE_RANGO = {AYUDANTE: "AYUDANTE", INGRESANTE: "INGRESANTE", OFICIAL: "OFICIAL"}
NOMBRE_OPERARIO = {45: "Pasante 1", 46: "Pasante 2", 31: "GUILLERMO CELIZ"}
# Los dos pasantes tienen los dos rangos que pide CONTROL DE MEDIDAS.
OPERARIOS = [(45, AYUDANTE), (45, INGRESANTE), (46, AYUDANTE), (46, INGRESANTE), (31, OFICIAL)]


def _proc(orden_id, proc_id, nombre, rangos, dur=20):
    # (orden, proc, sec, fecha, prio, dur, rangos, nombre, usa_maquina, familia, skills)
    return (orden_id, proc_id, 1, None, 5, dur, rangos, nombre, False, "", {})


def _diagnosticar(procesos, nativas_off=None, maquinarias=()):
    return construir_diagnosticos(
        procesos, OPERARIOS, list(maquinarias), [], NOMBRE_RANGO, NOMBRE_OPERARIO,
        nativas_off=nativas_off or {},
    )


def _uno(diags, empieza):
    return next(d for d in diags if d["titulo"].startswith(empieza))


# --------------------------------------------------------------------------
# «Nadie puede hacer X» cuando la habilidad está apagada, no cuando falta el rango
# --------------------------------------------------------------------------

def test_skill_apagada_no_se_reporta_como_rango_faltante():
    # Los dos pasantes TIENEN AYUDANTE e INGRESANTE; lo que está apagado es el
    # proceso en su ficha. El aviso decía "ningún operario disponible lo tiene",
    # que es falso, y mandaba a cargar un rango que ya estaba.
    diags = _diagnosticar(
        [_proc(12676, 30, "CONTROL DE MEDIDAS", [AYUDANTE, INGRESANTE])],
        nativas_off={30: {45, 46}},
    )
    d = _uno(diags, "Nadie puede hacer")
    assert "ningún operario disponible lo tiene" not in d["detalle"]
    assert "apagado en su ficha" in d["detalle"]
    assert "Pasante 1" in d["detalle"] and "Pasante 2" in d["detalle"]
    # Y el primer arreglo es el que sirve: encenderla de nuevo.
    assert d["soluciones"][0]["texto"].startswith("Volvé a encenderle")


def test_rango_realmente_faltante_sigue_diciendolo():
    diags = _diagnosticar([_proc(1, 99, "TEMPLADO", [OFICIAL + 90])])
    d = _uno(diags, "Nadie puede hacer")
    assert "ningún operario disponible lo tiene" in d["detalle"]


# --------------------------------------------------------------------------
# El «O» de las alternativas
# --------------------------------------------------------------------------

def test_ninguna_primera_solucion_empieza_con_O():
    # En todo proceso manual la primera opción no se generaba (depende de que el
    # proceso tenga familia de máquina) y las dos alternativas quedaban huérfanas:
    # el arreglo arrancaba con «O dale…» sin un «dale…» antes.
    diags = _diagnosticar(
        [_proc(12676, 30, "CONTROL DE MEDIDAS", [AYUDANTE, INGRESANTE])],
        nativas_off={30: {45, 46}},
    )
    for d in diags:
        if d["soluciones"]:
            assert not d["soluciones"][0]["texto"].startswith("O "), d["titulo"]


def test_las_alternativas_si_llevan_O():
    diags = _diagnosticar(
        [_proc(12676, 30, "CONTROL DE MEDIDAS", [AYUDANTE, INGRESANTE])],
        nativas_off={30: {45, 46}},
    )
    d = _uno(diags, "Nadie puede hacer")
    assert len(d["soluciones"]) > 1
    assert all(s["texto"].startswith("O ") for s in d["soluciones"][1:])


def test_como_alternativa_no_duplica_el_prefijo():
    sols = [{"texto": "Ponele OFICIAL."}, {"texto": "O al revés: agregale OFICIAL."}]
    _como_alternativa(sols)
    assert sols[1]["texto"] == "O al revés: agregale OFICIAL."


# --------------------------------------------------------------------------
# Nombres repetidos en el catálogo
# --------------------------------------------------------------------------

def test_dos_procesos_con_el_mismo_nombre_se_explican():
    # #256 tiene un espacio de más; en pantalla los dos se leen igual.
    diags = _diagnosticar([
        _proc(7153, 256, "ENSAMBLAJE, PUNTEADO  Y ESCUADRADO", [], dur=180),
        _proc(12767, 6224, "ENSAMBLAJE, PUNTEADO Y ESCUADRADO", [], dur=240),
    ])
    repetidos = [d for d in diags if d["titulo"].endswith("no tiene rango")]
    assert len(repetidos) == 2, "son procesos distintos: no se fusionan"
    for d in repetidos:
        assert "2 procesos distintos con este mismo nombre" in d["detalle"]


def test_nombre_unico_no_lleva_la_aclaracion():
    diags = _diagnosticar([_proc(12767, 179, "AFILADO", [])])
    d = _uno(diags, "«AFILADO»")
    assert "mismo nombre" not in d["detalle"]


# --------------------------------------------------------------------------
# Listas
# --------------------------------------------------------------------------

def test_los_rangos_se_listan_con_o_porque_alcanza_uno():
    assert _listar_rangos(["MEDIO OFICIAL", "OPERARIO CALIFICADO"]) == (
        "MEDIO OFICIAL o OPERARIO CALIFICADO"
    )


def test_no_hay_mas_y_1_mas():
    # Cortar en 2 obligaba a adivinar a quién le falta el rango.
    assert _listar(["A", "B", "C", "D"]) == "A, B, C y D"


def test_el_orden_es_estable_entre_recalculos():
    procesos = [
        _proc(7153, 256, "ENSAMBLAJE, PUNTEADO  Y ESCUADRADO", [], dur=180),
        _proc(12767, 179, "AFILADO", [], dur=180),
        _proc(1, 99, "TEMPLADO", [OFICIAL + 90], dur=180),
    ]
    ids = [[d["id"] for d in _diagnosticar(procesos)] for _ in range(5)]
    assert all(x == ids[0] for x in ids)


# --------------------------------------------------------------------------
# Nombres y puntuación
# --------------------------------------------------------------------------

def test_un_legajo_numerado_no_se_abrevia():
    from backend.application.DiagnosticoPlanificacion import _primer_nombre
    assert _primer_nombre("Pasante 1") == "Pasante 1"   # antes: "Pasante 1."
    assert _primer_nombre("IVAN BALMACEDA") == "IVAN B."
    assert _primer_nombre("Madonna") == "Madonna"
    assert _primer_nombre("") == ""


def test_no_queda_punto_doble_despues_de_un_apellido_abreviado():
    from backend.application.DiagnosticoPlanificacion import _cerrar
    assert _cerrar("Agregale OFICIAL a **Leonel s.**") == "Agregale OFICIAL a **Leonel s.**"
    assert _cerrar("Agregale OFICIAL a quien lo haga") == "Agregale OFICIAL a quien lo haga."
