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


# --------------------------------------------------------------------------
# Consejos que no sirven / botones
# --------------------------------------------------------------------------

MEDIO_OFICIAL, OFICIAL_PLEGADOR = 4, 2


def _maquina(id_, rangos, nombre, cod="X-1"):
    return (id_, set(rangos), nombre, cod)


def test_no_ofrece_el_arreglo_que_no_cambia_nada():
    """Para tomar una máquina hacen falta DOS cruces: el rango del OPERARIO tiene
    que estar en la máquina, y el del PROCESO también. Poner el rango de la máquina
    en el proceso arregla el segundo. Si ese rango no lo tiene ninguna persona real
    —las SOLDADORAS MIG piden MEDIO OFICIAL y solo lo tiene un puesto VACANTE—, el
    primero sigue fallando y el consejo deja todo igual."""
    nombre_rango = {**NOMBRE_RANGO, MEDIO_OFICIAL: "MEDIO OFICIAL"}
    nombre_operario = {**NOMBRE_OPERARIO, 18: "VACANTE MEDIO OFICIAL"}
    operarios = OPERARIOS + [(18, MEDIO_OFICIAL)]
    proc = (15130, 138, 3, None, 5, 180, [OFICIAL], "SOLDADURA CON MIG", True, "SOLDADORA_MIG", {})
    maqs = [_maquina(23, [MEDIO_OFICIAL], "SOLDADORA MIG/MAG 450 1")]
    res = [{"orden_id": 15130, "secuencia": 3, "usa_maquina": True,
            "id_maquinaria": None, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos(
        [proc], operarios, maqs, res, nombre_rango, nombre_operario,
    )
    d = _uno(diags, "«SOLDADURA CON MIG»")
    textos = " ".join(s["texto"] for s in d["soluciones"])
    assert "al proceso" not in textos, "no puede ofrecer tocar el proceso: no alcanza"
    assert "no lo tiene ninguna persona" in d["detalle"]


def test_el_arreglo_sirve_cuando_alguien_tiene_el_rango():
    # GUILLERMO tiene OFICIAL PLEGADOR, así que acá sí sirve tocar el proceso.
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR)]
    proc = (15279, 87, 2, None, 5, 240, [OFICIAL], "PLEGADO", True, "PLEGADORA", {})
    maqs = [_maquina(15, [OFICIAL_PLEGADOR], "PLEGADORA")]
    res = [{"orden_id": 15279, "secuencia": 2, "usa_maquina": True,
            "id_maquinaria": None, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos([proc], operarios, maqs, res, nombre_rango, NOMBRE_OPERARIO)
    d = _uno(diags, "«PLEGADO»")
    assert d["soluciones"][0]["texto"].startswith("Ponele")
    assert d["soluciones"][0]["accion"] is not None


def test_varias_maquinas_ahora_llevan_boton():
    # Antes no se ofrecía botón con más de una máquina, y la mitad de los avisos
    # había que resolverlos a mano haciendo exactamente lo mismo, uno por uno.
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR)]
    proc = (1, 11, 1, None, 5, 60, [OFICIAL], "AVELLANADO", True, "AGUJEREADORA", {})
    maqs = [_maquina(8, [OFICIAL_PLEGADOR], "AGUJEREADORA DE BANCO"),
            _maquina(16, [OFICIAL_PLEGADOR], "AGUJEREADORA BURANI")]
    res = [{"orden_id": 1, "secuencia": 1, "usa_maquina": True,
            "id_maquinaria": None, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos([proc], operarios, maqs, res, nombre_rango, NOMBRE_OPERARIO)
    d = _uno(diags, "«AVELLANADO»")
    accion_maq = next(s["accion"] for s in d["soluciones"]
                      if s["accion"] and s["accion"]["tipo"] == "maquinaria")
    assert len(accion_maq["objetivos"]) == 2
    assert {o["id"] for o in accion_maq["objetivos"]} == {8, 16}


def test_encender_la_skill_apagada_tiene_boton():
    diags = _diagnosticar(
        [_proc(12676, 30, "CONTROL DE MEDIDAS", [AYUDANTE, INGRESANTE])],
        nativas_off={30: {45, 46}},
    )
    d = _uno(diags, "Nadie puede hacer")
    accion = d["soluciones"][0]["accion"]
    assert accion["tipo"] == "skill_nativa"
    assert accion["id"] == 30 and accion["habilitado"] is True
    assert {o["id"] for o in accion["objetivos"]} == {45, 46}
