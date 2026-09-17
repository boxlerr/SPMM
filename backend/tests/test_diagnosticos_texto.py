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


# --------------------------------------------------------------------------
# El resumen de una frase (Lucas 10/09: "cortita y al pie")
# --------------------------------------------------------------------------
from backend.application.DiagnosticoPlanificacion import _resumen_corto  # noqa: E402


def test_resumen_maquina_rango_nombra_los_dos_lados():
    """El malentendido de la reunión del 10/09.

    El título decía «sus 3 máquinas no aceptan el rango que pide» y Lucas lo leía
    como que el problema era el proceso: «entonces el problema es el proceso, no es
    la máquina». El resumen tiene que dejar claro cuál es cuál sin que haga falta
    abrir nada.
    """
    resumen = _resumen_corto({
        "titulo": "Prensa: sus 3 máquinas no aceptan el rango que pide",
        "recurso": "maquina", "subtipo": "rango",
        "tiene": "OPERARIO CALIFICADO", "pide": "AYUDANTE o INGRESANTE",
    })
    assert resumen == ("La máquina la usa un operario calificado. "
                       "El trabajo lo hace un ayudante (y 1 más).")
    # Una frase para leer, no un formulario: sin negritas ni la palabra "rango".
    assert "**" not in resumen and "rango" not in resumen.lower()
    # Julián, 15/09: «que le complica leer tanto texto». El nombre del proceso ya está
    # en el título justo arriba; repetirlo acá era la mitad del renglón.
    assert "Prensa" not in resumen and "«" not in resumen
    assert len(resumen) <= 90, f"{len(resumen)} caracteres es un párrafo, no una frase"


def test_resumen_humano_rango_dice_quien_no_llega():
    resumen = _resumen_corto({
        "titulo": "Soldadura con MIG: los que lo hacen no pueden tomar la máquina",
        "recurso": "humano", "subtipo": "rango",
        "tiene": "OFICIAL", "pide": "MEDIO OFICIAL",
    })
    # NO se nombran las dos listas: con datos reales se pisan y el aviso se lee como
    # que no hay ningún problema («el trabajo lo hace un oficial especializado… la
    # máquina la usa un oficial especializado»). El que no llega es una PERSONA, y su
    # nombre está en el detalle.
    assert resumen == "La gente que hace este trabajo no puede usar esa máquina."


def test_resumen_no_se_va_de_largo_con_listas_de_categorias_reales():
    """El tope de 90 se rompía con datos de producción, no con los del test.

    El aviso «Preparación de torno» del plan del 15/09 salía de 117 caracteres porque
    las dos listas traían tres categorías cada una. Se nombra la primera y se cuentan
    las demás; el listado completo sigue en el chip «qué tiene → qué pide» de al lado.
    """
    resumen = _resumen_corto({
        "titulo": "Torno: sus máquinas no aceptan el rango que pide",
        "recurso": "maquina", "subtipo": "rango",
        "tiene": "OFICIAL, OFICIAL ESPECIALIZADO o TÉCNICO", "pide": "MEDIO OFICIAL",
    })
    assert resumen == "La máquina la usa un oficial (y 2 más). El trabajo lo hace un medio oficial."
    assert len(resumen) <= 90


def test_resumen_sin_dos_lados_cae_al_problema_del_titulo():
    """Hay avisos donde no hay dos cosas que comparar. Ahí el resumen es el problema
    del título, que ya viene corto — no una frase inventada."""
    assert _resumen_corto({
        "titulo": "Control de medidas: hoy no lo puede hacer nadie",
        "recurso": "humano", "subtipo": "skill",
    }) == "Nadie sabe hacer este trabajo."
    assert _resumen_corto({
        "titulo": "Embalado: se lo puede llevar cualquiera, sepa o no",
    }) == "Se lo puede llevar cualquiera, sepa o no"


def test_todos_los_diagnosticos_traen_resumen_y_es_corto():
    """Cerrado se ve UNA frase. Si alguna se va de largo, vuelve el párrafo cortado
    a la mitad que era el problema."""
    diags = _diagnosticar([
        _proc(15279, 30, "CONTROL DE MEDIDAS", {AYUDANTE, INGRESANTE}),
        _proc(15279, 46, "EMBALADO", set()),
    ], nativas_off={30: {45, 46}})
    assert diags
    for d in diags:
        assert d["resumen"], f"{d['tipo']} salió sin resumen"
        # El tope es el pedido del 15/09 hecho test: si un aviso se va de largo, vuelve
        # el párrafo que nadie lee.
        assert len(d["resumen"]) <= 90, f"{d['tipo']}: «{d['resumen']}» ({len(d['resumen'])})"
        assert len(d["resumen"]) <= 160, f"{d['tipo']}: {len(d['resumen'])} caracteres"


# --------------------------------------------------------------------------
# El resumen elige la frase por FAMILIA de aviso, no solo por (recurso, subtipo)
#
# Los cuatro tests de arriba le pasan un dict armado a mano, y por ahí se coló el
# problema: el par (recurso, subtipo) alcanza para clasificar pero no para
# escribir. CUATRO familias distintas caen en humano/rango, y tres de ellas
# mostraban —con el aviso cerrado, que es lo único que se ve— «La gente que hace
# este trabajo no puede usar esa máquina». Templado es un trabajo manual y no
# tiene ninguna máquina de la que hablar, un puesto vacante tampoco, y un proceso
# sin rango no tiene nada trabado. Del otro lado, el tercerizado decía «no
# alcanzan las máquinas» mientras su propio detalle dice que no hay nada que
# corregir.
#
# Vivió meses con la suite en verde porque del resumen solo se miraba el LARGO
# (`test_todos_los_diagnosticos_traen_resumen_y_es_corto`). Estos miran lo que
# dice, y lo miran sobre el diagnóstico armado de verdad.
# --------------------------------------------------------------------------

TERCERIZADO = 13


def test_cada_familia_de_aviso_dice_lo_suyo_y_no_inventa_maquinas():
    nombre_rango = {**NOMBRE_RANGO, TERCERIZADO: "TERCERIZADO"}
    diags = construir_diagnosticos(
        [
            _proc(1, 30, "CONTROL DE MEDIDAS", [AYUDANTE, INGRESANTE]),  # habilidad apagada
            _proc(2, 99, "TEMPLADO", [OFICIAL + 90]),                    # rango que no tiene nadie
            _proc(3, 77, "PULIDO", []),                                  # sin ningún rango
            _proc(4, 22, "CILINDRADO DE CHAPA", [TERCERIZADO]),          # sale del taller
        ],
        OPERARIOS, [], [], nombre_rango, NOMBRE_OPERARIO,
        nativas_off={30: {45, 46}},
    )
    dicho = {d["tipo"]: d["resumen"] for d in diags}
    assert dicho["proceso_sin_operarios"] == "Nadie de los disponibles puede hacerlo."
    assert dicho["proceso_sin_rango"] == "Nadie controla quién lo agarra."
    assert dicho["trabajo_tercerizado"] == "Lo hace alguien de afuera. No hay nada que corregir."
    # Ninguno de los cuatro procesos usa máquina: si alguno nombra una, volvió el bug.
    for tipo, frase in dicho.items():
        assert "máquina" not in frase.lower(), f"{tipo}: «{frase}»"


def test_el_puesto_vacante_dice_que_esta_vacio_y_no_habla_de_maquinas():
    nombre_operario = {**NOMBRE_OPERARIO, 18: "VACANTE MEDIO OFICIAL"}
    res = [{"orden_id": 1, "secuencia": 1, "id_operario": 18, "duracion_min": 200,
            "excedente": False, "usa_maquina": False, "id_maquinaria": None,
            "slot_extra": False}]
    diags = construir_diagnosticos([], OPERARIOS, [], res, NOMBRE_RANGO, nombre_operario)
    d = _por_tipo(diags, "puestos_vacantes")
    assert d["resumen"] == "Se lo cargó a un puesto que está vacío."


def test_el_cuello_que_entra_no_dice_que_no_alcanzan_las_maquinas():
    """El cuello Media es el que ENTRA: su detalle dice «No hay nada roto — es la
    capacidad real del taller», y cerrado mostraba «No alcanzan las máquinas para
    todo este trabajo», que es lo contrario."""
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR)]
    proc = (15279, 87, 2, None, 5, 2000, [OFICIAL_PLEGADOR], "PLEGADO", True, "PLEGADORA", {})
    maqs = [_maquina(15, [OFICIAL_PLEGADOR], "PLEGADORA")]
    res = [{"orden_id": 15279, "secuencia": 2, "usa_maquina": True,
            "id_maquinaria": 15, "excedente": False, "slot_extra": False}]

    diags = construir_diagnosticos([proc], operarios, maqs, res, nombre_rango, NOMBRE_OPERARIO)
    d = _por_tipo(diags, "cuello_de_maquina")
    assert d["severidad"] == "advertencia"
    assert d["resumen"] == "Entra todo, pero por turnos: hay 1 máquina para todo esto."


def test_el_cuello_que_muerde_si_dice_que_no_alcanzan():
    """La contracara del anterior: cuando el trabajo NO entra, la frase vieja es la
    correcta y tiene que seguir saliendo."""
    nombre_rango = {**NOMBRE_RANGO, OFICIAL_PLEGADOR: "OFICIAL PLEGADOR"}
    operarios = OPERARIOS + [(31, OFICIAL_PLEGADOR)]
    proc = (15279, 87, 2, None, 5, 2000, [OFICIAL_PLEGADOR], "PLEGADO", True, "PLEGADORA", {})
    maqs = [_maquina(15, [OFICIAL_PLEGADOR], "PLEGADORA")]
    res = [{"orden_id": 15279, "secuencia": 2, "usa_maquina": True,
            "id_maquinaria": None, "excedente": True, "slot_extra": False}]

    diags = construir_diagnosticos([proc], operarios, maqs, res, nombre_rango, NOMBRE_OPERARIO)
    d = _por_tipo(diags, "cuello_de_maquina")
    assert d["severidad"] == "bloqueante"
    assert d["resumen"] == "No alcanzan las máquinas para todo este trabajo."


def test_las_dos_causas_de_quedarse_sin_maquina_no_se_cuentan_igual():
    """«No hay ninguna máquina cargada» y «no se sabe cuál usa» son el mismo tipo de
    aviso y hasta el mismo (recurso, subtipo); lo que las distingue es la causa, y
    por eso viaja en el aviso en vez de deducirse del texto de `tiene`."""
    engomado = (7, 55, 1, None, 5, 120, [OFICIAL], "ENGOMADO", True, "", {})
    preparacion = (8, 56, 1, None, 5, 120, [OFICIAL], "PREPARACION DE SOLDADORA TIG", True, "", {})
    res = [{"orden_id": o, "secuencia": 1, "usa_maquina": True, "id_maquinaria": None,
            "excedente": False, "slot_extra": False} for o in (7, 8)]

    diags = construir_diagnosticos([engomado, preparacion], OPERARIOS, [], res,
                                   NOMBRE_RANGO, NOMBRE_OPERARIO)
    dicho = {d["causa"]: d["resumen"] for d in diags if d["tipo"] == "maquina_incompatible"}
    assert dicho["sin_familia"] == "No se sabe qué máquina usa."
    assert dicho["sin_maquina"] == "No hay ninguna máquina cargada para esto."


# --------------------------------------------------------------------------
# El chip del impacto
# --------------------------------------------------------------------------

def test_el_impacto_no_se_abrevia_y_concuerda_en_singular():
    """Decía «1 proc · 1 OT · 20 min». «proc» no está escrita en ninguna otra
    pantalla y encima no concordaba. «OT» se queda: esa sí se dice en el taller."""
    uno = _diagnosticar([_proc(2, 77, "PULIDO", [])])
    assert _por_tipo(uno, "proceso_sin_rango")["impacto"]["resumen"] == "1 proceso · 1 OT · 20 min"
    dos = _diagnosticar([_proc(2, 77, "PULIDO", []), _proc(3, 77, "PULIDO", [])])
    assert _por_tipo(dos, "proceso_sin_rango")["impacto"]["resumen"] == "2 procesos · 2 OT · 40 min"
