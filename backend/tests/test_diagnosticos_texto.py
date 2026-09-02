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


def _por_tipo(diags, tipo):
    """Buscar por `tipo` y no por el título.

    Los títulos se reescribieron el 21/08 para que todos arranquen por el sujeto, y
    media docena de tests se cayeron por eso sin que hubiera nada roto. El `tipo` es
    el contrato real; el título es texto para el taller y va a seguir cambiando."""
    return next(d for d in diags if d["tipo"] == tipo)


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
    d = _por_tipo(diags, "proceso_sin_operarios")
    assert "ningún operario disponible lo tiene" not in d["detalle"]
    assert "apagado en su ficha" in d["detalle"]
    assert "Pasante 1" in d["detalle"] and "Pasante 2" in d["detalle"]
    # Y el primer arreglo es el que sirve: encenderla de nuevo.
    assert d["soluciones"][0]["texto"].startswith("Volvé a encenderle")


def test_rango_realmente_faltante_sigue_diciendolo():
    diags = _diagnosticar([_proc(1, 99, "TEMPLADO", [OFICIAL + 90])])
    d = _por_tipo(diags, "proceso_sin_operarios")
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
    d = _por_tipo(diags, "proceso_sin_operarios")
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
    repetidos = [d for d in diags if d["tipo"] == "proceso_sin_rango"]
    assert len(repetidos) == 2, "son procesos distintos: no se fusionan"
    for d in repetidos:
        assert "2 procesos distintos con este mismo nombre" in d["detalle"]


def test_nombre_unico_no_lleva_la_aclaracion():
    diags = _diagnosticar([_proc(12767, 179, "AFILADO", [])])
    d = _por_tipo(diags, "proceso_sin_rango")
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
    d = _por_tipo(diags, "maquina_incompatible")
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
    d = _por_tipo(diags, "maquina_incompatible")
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
    d = _por_tipo(diags, "maquina_incompatible")
    accion_maq = next(s["accion"] for s in d["soluciones"]
                      if s["accion"] and s["accion"]["tipo"] == "maquinaria")
    assert len(accion_maq["objetivos"]) == 2
    assert {o["id"] for o in accion_maq["objetivos"]} == {8, 16}


def test_encender_la_skill_apagada_tiene_boton():
    diags = _diagnosticar(
        [_proc(12676, 30, "CONTROL DE MEDIDAS", [AYUDANTE, INGRESANTE])],
        nativas_off={30: {45, 46}},
    )
    d = _por_tipo(diags, "proceso_sin_operarios")
    accion = d["soluciones"][0]["accion"]
    assert accion["tipo"] == "skill_nativa"
    assert accion["id"] == 30 and accion["habilitado"] is True
    assert {o["id"] for o in accion["objetivos"]} == {45, 46}


# --------------------------------------------------------------------------
# La taxonomía cerrada (Lucas, 28/08/2026)
#
# «Tenés recurso máquina, problema de recurso máquina, o problema de recurso
# humano» — y del humano, «uno: skills, ningún operario tiene ese proceso». Lo que
# se testea acá no es el texto (ese cambia) sino que TODO aviso entre en una de
# las cuatro combinaciones: sin eso la pantalla vuelve a tener seis rótulos
# inventados y la pregunta «¿cuál es la traba acá?» no se puede contestar.
# --------------------------------------------------------------------------

RECURSOS = {"maquina", "humano"}
SUBTIPOS = {"rango", "capacidad", "skill"}


def test_todo_aviso_dice_de_que_recurso_habla_y_por_que():
    diags = _diagnosticar(
        [
            _proc(12676, 30, "CONTROL DE MEDIDAS", [AYUDANTE, INGRESANTE]),
            _proc(1, 99, "TEMPLADO", [OFICIAL + 90]),
            _proc(2, 77, "PULIDO", []),
        ],
        nativas_off={30: {45, 46}},
    )
    assert diags, "el caso tiene que generar avisos, si no el test no prueba nada"
    for d in diags:
        assert d["recurso"] in RECURSOS, (d["tipo"], d.get("recurso"))
        assert d["subtipo"] in SUBTIPOS, (d["tipo"], d.get("subtipo"))
        # Recurso humano no tiene "capacidad" y máquina no tiene "skill": son
        # cuatro combinaciones, no seis.
        if d["recurso"] == "humano":
            assert d["subtipo"] != "capacidad", d["tipo"]
        else:
            assert d["subtipo"] != "skill", d["tipo"]


def test_habilidad_apagada_es_recurso_humano_skill():
    # El rango lo tienen: lo que falta es la habilidad. Va a Recursos › ficha de la
    # persona, no a cargar rangos.
    diags = _diagnosticar(
        [_proc(12676, 30, "CONTROL DE MEDIDAS", [AYUDANTE, INGRESANTE])],
        nativas_off={30: {45, 46}},
    )
    d = _por_tipo(diags, "proceso_sin_operarios")
    assert (d["recurso"], d["subtipo"]) == ("humano", "skill")


def test_rango_que_no_tiene_nadie_es_recurso_humano_rango():
    diags = _diagnosticar([_proc(1, 99, "TEMPLADO", [OFICIAL + 90])])
    d = _por_tipo(diags, "proceso_sin_operarios")
    assert (d["recurso"], d["subtipo"]) == ("humano", "rango")
    # "¿Cuál es el rango que tiene? Medio oficial. Debería decir qué tiene la
    # máquina" — el aviso separa lo que hay de lo que se pide.
    assert d["pide"]


def test_los_avisos_media_llevan_a_la_fila_que_hay_que_tocar():
    # Los Media no traen botón que aplique nada —qué rangos van lo sabe el taller—,
    # así que el link es su única salida y tiene que caer en el proceso, no en la
    # lista de 414.
    diags = _diagnosticar([_proc(2, 77, "PULIDO", [])])
    d = _por_tipo(diags, "proceso_sin_rango")
    assert d["severidad"] == "advertencia"
    objetivo = d["soluciones"][0]["objetivo"]
    assert objetivo["tipo"] == "proceso" and objetivo["id"] == 77


# --------------------------------------------------------------------------
# «Se las abrís a 9 personas» no es «se reparte entre las 9»
# --------------------------------------------------------------------------

def _solucion_de_maquina(d):
    """La solución que le agrega el rango A LA MÁQUINA — la del "se las abrís a N".

    Se busca por la acción y no por el texto: la otra solución del mismo aviso dice
    "no se la abrís a nadie nuevo" y un contains ingenuo la agarra a ella.
    """
    return next(s["texto"] for s in d["soluciones"]
                if s.get("accion") and s["accion"]["tipo"] == "maquinaria")


def test_habilitar_a_varios_aclara_que_no_se_reparte():
    """Lucas leyó "se las abrís a 9 personas" como que el sistema iba a repartir el
    trabajo parejo entre las nueve, y le pareció mal (28/08). El motor ya prefiere la
    habilidad principal —PENAL_SKILL1=0 contra PENAL_SKILL2=2000—; el que estaba mal
    escrito era el aviso. Ahora el aviso nombra a quien lo va a tomar."""
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    nombre_operario = {**NOMBRE_OPERARIO, 32: "LEONARDO CONDORI"}
    # GUILLERMO y LEONARDO tienen OFICIAL: agregarle OFICIAL a la máquina abre a los dos.
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR), (32, OFICIAL)]
    proc = (15279, 87, 2, None, 5, 240, [OFICIAL], "PLEGADO", True, "PLEGADORA", {})
    maqs = [_maquina(15, [OFICIAL_PLEGADOR], "PLEGADORA")]
    res = [{"orden_id": 15279, "secuencia": 2, "usa_maquina": True,
            "id_maquinaria": None, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos(
        [proc], operarios, maqs, res, nombre_rango, nombre_operario,
        # LEONARDO lo tiene como principal (nivel 1); GUILLERMO como secundaria.
        prioridad_skills={87: {32: (1, 0), 31: (2, 0)}},
    )
    d = _por_tipo(diags, "maquina_incompatible")
    abrir = _solucion_de_maquina(d)
    assert "**2** personas" in abrir
    assert "el trabajo no se reparte" in abrir
    assert "LEONARDO" in abrir


def test_sin_habilidad_principal_cargada_no_inventa_nombre():
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    nombre_operario = {**NOMBRE_OPERARIO, 32: "LEONARDO CONDORI"}
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR), (32, OFICIAL)]
    proc = (15279, 87, 2, None, 5, 240, [OFICIAL], "PLEGADO", True, "PLEGADORA", {})
    maqs = [_maquina(15, [OFICIAL_PLEGADOR], "PLEGADORA")]
    res = [{"orden_id": 15279, "secuencia": 2, "usa_maquina": True,
            "id_maquinaria": None, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos([proc], operarios, maqs, res, nombre_rango, nombre_operario)
    abrir = _solucion_de_maquina(_por_tipo(diags, "maquina_incompatible"))
    assert "el trabajo no se reparte" in abrir
    assert "habilidad principal" not in abrir


def test_una_sola_persona_no_lleva_la_aclaracion():
    """Con uno solo la aclaración sobra: no hay entre quiénes repartir."""
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR)]
    proc = (15279, 87, 2, None, 5, 240, [OFICIAL], "PLEGADO", True, "PLEGADORA", {})
    maqs = [_maquina(15, [OFICIAL_PLEGADOR], "PLEGADORA")]
    res = [{"orden_id": 15279, "secuencia": 2, "usa_maquina": True,
            "id_maquinaria": None, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos([proc], operarios, maqs, res, nombre_rango, NOMBRE_OPERARIO)
    abrir = _solucion_de_maquina(_por_tipo(diags, "maquina_incompatible"))
    assert "el trabajo no se reparte" not in abrir


def test_con_dos_principales_los_nombra_a_los_dos_y_no_promete_uno():
    """El mapa trae un `orden` para desempatar entre dos de nivel 1, pero ese desempate
    está topeado a 1500 y vale menos que un minuto de atraso (200 por minuto): si el
    primero está cargado, el trabajo se va igual al otro. Nombrar a uno solo sería
    prometer algo que el motor no sostiene."""
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    nombre_operario = {**NOMBRE_OPERARIO, 32: "LEONARDO CONDORI", 33: "MATIAS VERA"}
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR), (32, OFICIAL), (33, OFICIAL)]
    proc = (15279, 87, 2, None, 5, 240, [OFICIAL], "PLEGADO", True, "PLEGADORA", {})
    maqs = [_maquina(15, [OFICIAL_PLEGADOR], "PLEGADORA")]
    res = [{"orden_id": 15279, "secuencia": 2, "usa_maquina": True,
            "id_maquinaria": None, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos(
        [proc], operarios, maqs, res, nombre_rango, nombre_operario,
        prioridad_skills={87: {32: (1, 0), 33: (1, 3), 31: (2, 0)}},
    )
    abrir = _solucion_de_maquina(_por_tipo(diags, "maquina_incompatible"))
    assert "LEONARDO" in abrir and "MATIAS" in abrir
    assert "que lo tienen cargado como habilidad principal" in abrir, "sujeto plural, verbo plural"
    # Y GUILLERMO, que lo tiene como secundaria, no entra en la frase.
    assert "GUILLERMO" not in abrir


def test_no_nombra_a_quien_el_solver_excluyo_por_el_plano():
    """La OT tiene plano y LEONARDO no sabe leerlo: el solver ni lo considera.
    El aviso se contradecía solo — el detalle decía «lo tiene 1 persona» y la solución
    nombraba a otro que no estaba en el dominio."""
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    nombre_operario = {**NOMBRE_OPERARIO, 32: "LEONARDO CONDORI"}
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR), (31, OFICIAL), (32, OFICIAL)]
    proc = (15279, 87, 2, None, 5, 240, [OFICIAL], "PLEGADO", True, "PLEGADORA", {})
    maqs = [_maquina(15, [OFICIAL_PLEGADOR], "PLEGADORA")]
    res = [{"orden_id": 15279, "secuencia": 2, "usa_maquina": True,
            "id_maquinaria": None, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos(
        [proc], operarios, maqs, res, nombre_rango, nombre_operario,
        prioridad_skills={87: {32: (1, 0), 31: (2, 0)}},
        ots_con_plano={15279},
        op_planos={31: True, 32: False},
    )
    abrir = _solucion_de_maquina(_por_tipo(diags, "maquina_incompatible"))
    assert "LEONARDO" not in abrir, "no sabe leer planos: el solver no lo tiene en cuenta"


def test_un_proceso_con_rango_tercerizado_no_se_reporta_como_que_nadie_lo_puede_hacer():
    """Marcar un trabajo como «se manda afuera» no puede empeorar el aviso.

    Cilindrado de chapa se cargó con rango TERCERIZADO el 2/9, según lo que contestó
    Lucas. Como ese rango no lo tiene ninguna persona real, el diagnóstico lo pasó a
    contar como «hoy no lo puede hacer nadie»: el sistema decía que faltaba gente para
    un trabajo que justamente no se hace en el taller."""
    TERCERIZADO = 13
    nombre_rango = {**NOMBRE_RANGO, TERCERIZADO: "TERCERIZADO"}
    diags = construir_diagnosticos(
        [_proc(15100, 22, "CILINDRADO DE CHAPA", [TERCERIZADO])],
        OPERARIOS, [], [], nombre_rango, NOMBRE_OPERARIO,
    )
    tipos = {d["tipo"] for d in diags}
    assert "proceso_sin_operarios" not in tipos, "no falta gente: sale del taller"
    d = _por_tipo(diags, "trabajo_tercerizado")
    assert "CILINDRADO DE CHAPA".lower() in d["titulo"].lower()
