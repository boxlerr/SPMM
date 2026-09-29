"""
Recursos › Procesos: en qué máquina se hace cada proceso, a la vista.

Pedido de Julián el 29/9/2026, en plena reunión con Lucas: la fila de «FRESADORA F6»
decía quién puede hacerla y no en qué máquina. No estaba escondida por un descuido de la
pantalla: el dato casi no existe (8 de 415 procesos tienen la máquina cargada), y el
planificador resuelve los otros deduciendo del nombre.

Lo que se prueba acá:
  1. Que la resolución dé lo que el taller espera leer en cada caso (cargada, por el
     nombre, a mano, ninguna) con el taller REAL —los nombres y rangos de las 27 máquinas
     salen de Supabase, porque los nombres reales son los que rompen las suposiciones:
     ninguna fresadora se llama F6, y a la CNC le falta el código—.
  2. Que NO se separe del planificador. Es la prueba que importa: si mañana se toca la
     rama de máquinas del solver y esto no se entera, la pantalla vuelve a decir algo
     distinto de lo que hace el plan, que es peor que no decir nada. Por eso se arma el
     dominio de máquinas con `_crear_variables_y_dominios` de verdad y se compara.
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.MaquinasDelProceso import (
    MOTIVO_RANGO,
    MOTIVO_SIN_FAMILIA,
    MOTIVO_SIN_MAQUINA,
    ORIGEN_A_MANO,
    ORIGEN_CARGADA,
    ORIGEN_NINGUNA,
    ORIGEN_NOMBRE,
    con_maquinas_de_cada_proceso,
    maquinas_del_proceso,
)
from backend.application.PlanificacionService import (
    _crear_variables_y_dominios,
    familia_requerida_from_proceso,
    proceso_usa_maquina,
)

# ── El taller, tal cual está en producción (29/9/2026) ─────────────────────────
RANGO = {n: i for i, n in enumerate([
    "OFICIAL", "OFICIAL CNC", "OFICIAL ESPECIALIZADO", "TÉCNICO", "MEDIO OFICIAL",
    "OPERARIO CALIFICADO", "OFICIAL PLEGADOR", "RECTIFICADOR", "TERCERIZADO", "AYUDANTE",
], start=1)}


def _rangos(*nombres):
    return [{"id": RANGO[n], "nombre": n} for n in nombres]


_MIG = ("MEDIO OFICIAL", "OFICIAL", "OPERARIO CALIFICADO")
_CNC = ("OFICIAL", "OFICIAL ESPECIALIZADO", "TÉCNICO")
# (id, nombre, cod_maquina, rangos). Ojo a lo que tienen de feo, que es lo real: la
# FRESADORA CNC no tiene código, y «VAN NORMAN » viene con un espacio de más.
_TALLER = [
    (8, "AGUJEREADORA DE BANCO", "AGUBP-1", ("OFICIAL",)),
    (16, "AGUJEREADORA DE BANCO BURANI", "ABBP-2", ("OFICIAL",)),
    (20, "CONFORMADORA", "CONF-1", ("OPERARIO CALIFICADO",)),
    (9, "FRESADORA 1", "FREY-1", ("OFICIAL",)),
    (10, "FRESADORA 2", "FREY-2", ("OFICIAL",)),
    (12, "FRESADORA CNC", None, ("OFICIAL CNC",)),
    (11, "FRESADORA VAN NORMAN ", "FVNP-1", ("OFICIAL",)),
    (14, "GUILLOTINA", "GUI-1", ("OFICIAL",)),
    (13, "LIMADORA", "LIMY-1", ("MEDIO OFICIAL", "OFICIAL", "OPERARIO CALIFICADO")),
    (15, "PLEGADORA", "PLE-1", ("OFICIAL", "OFICIAL PLEGADOR")),
    (21, "PRENSA 1", "PRE-1", ("OPERARIO CALIFICADO",)),
    (22, "PRENSA 2", "PRE-2", ("OPERARIO CALIFICADO",)),
    (27, "RECTIFICADORA TANGENCIAL", "RECT-1", ("OFICIAL", "RECTIFICADOR")),
    (17, "SIERRA CIRCULAR", "SIE-1", ("MEDIO OFICIAL", "OPERARIO CALIFICADO")),
    (23, "SOLDADORA MIG/MAG 450 1", "SM450-1", _MIG),
    (24, "SOLDADORA MIG/MAG 450 2", "SM450-2", _MIG),
    (25, "SOLDADORA PORTATIL MIG/ELEC", "SOLDPORT-3", _MIG),
    (26, "SOLDADORA TIG", "STIG-1", _MIG),
    (1, "TORNO 1", "TORY-1", ("OFICIAL",)),
    (2, "TORNO 2", "TORY-2", ("OFICIAL",)),
    (3, "TORNO 3", "TORY-3", ("OFICIAL",)),
    (4, "TORNO 4", "TORP-4", ("OFICIAL",)),
    (18, "TORNO 5", "TORP-5", ("MEDIO OFICIAL", "OFICIAL")),
    (19, "TORNO 6 CINDELMET", "TCINDELP-6", ("MEDIO OFICIAL", "OFICIAL")),
    (5, "TORNO CNC 1", "TCNCY-1", _CNC),
    (6, "TORNO CNC 2", "TCNCY-2", _CNC),
    (7, "TORNO CNC 3", "TCY3", _CNC),
]
TALLER = [
    {"id": i, "nombre": n, "cod_maquina": c, "rangos": _rangos(*rs)}
    for (i, n, c, rs) in _TALLER
]
ID = {m["nombre"].strip(): m["id"] for m in TALLER}
TORNOS_CONVENCIONALES = ["TORNO 1", "TORNO 2", "TORNO 3", "TORNO 4", "TORNO 5", "TORNO 6 CINDELMET"]


def _ids(refs):
    return sorted(r["id"] for r in refs)


def _ids_de(*nombres):
    return sorted(ID[n] for n in nombres)


def _resolver(nombre, rangos=("OFICIAL",), cargadas=()):
    return maquinas_del_proceso(
        nombre, _rangos(*rangos),
        [{"id": ID[n], "nombre": n} for n in cargadas],
        TALLER,
    )


# ── 1. Lo que el taller espera leer ───────────────────────────────────────────

def test_fresadora_f6_se_deduce_de_las_fresadoras_que_aceptan_su_rango():
    """El caso de la reunión. Ninguna máquina se llama F6: el planificador reserva una
    de las tres fresadoras OFICIAL. La CNC no entra porque pide OFICIAL CNC."""
    r = _resolver("FRESADORA F6")
    assert r["origen"] == ORIGEN_NOMBRE
    assert _ids(r["efectivas"]) == _ids_de("FRESADORA 1", "FRESADORA 2", "FRESADORA VAN NORMAN")
    assert r["motivo"] is None


def test_f6_f7_f8_y_f9_resuelven_a_lo_mismo():
    """Es justo lo que hace confuso el catálogo: cuatro nombres, las mismas tres máquinas."""
    tercias = {tuple(_ids(_resolver(n)["efectivas"])) for n in
               ("FRESADORA F6", "FRESADORA F7", "FRESADORA F8", "FRESADORA F9")}
    assert len(tercias) == 1


def test_el_nombre_de_la_maquina_sin_espacios_de_mas():
    r = _resolver("FRESADORA F6")
    assert "FRESADORA VAN NORMAN" in [m["nombre"] for m in r["efectivas"]]


def test_la_cnc_es_solo_la_cnc():
    r = _resolver("FRESADORA CNC", rangos=("OFICIAL CNC",))
    assert _ids(r["efectivas"]) == _ids_de("FRESADORA CNC")


def test_lo_cargado_le_gana_al_nombre():
    """REPARACION DE ROSCA no dice torno en ningún lado: sin el dato no sabría dónde ir."""
    sin_dato = _resolver("REPARACION DE ROSCA")
    assert sin_dato["origen"] == ORIGEN_NINGUNA and sin_dato["motivo"] == MOTIVO_SIN_FAMILIA

    con_dato = _resolver("REPARACION DE ROSCA", cargadas=TORNOS_CONVENCIONALES)
    assert con_dato["origen"] == ORIGEN_CARGADA
    assert _ids(con_dato["efectivas"]) == _ids_de(*TORNOS_CONVENCIONALES)
    assert con_dato["sin_rango"] == []


def test_una_cargada_que_el_rango_del_proceso_no_acepta_se_marca():
    """ENDERESAR DE BASES: Lucas dijo «prensa o plegadora» y se cargaron las tres. El
    solver descarta la plegadora sin avisar porque OFICIAL/OFICIAL PLEGADOR no cruza con
    MEDIO OFICIAL ni OPERARIO CALIFICADO. Que la pantalla lo diga es el punto."""
    r = _resolver("ENDERESAR DE BASES", rangos=("MEDIO OFICIAL", "OPERARIO CALIFICADO"),
                  cargadas=("PLEGADORA", "PRENSA 1", "PRENSA 2"))
    assert r["origen"] == ORIGEN_CARGADA
    assert _ids(r["efectivas"]) == _ids_de("PRENSA 1", "PRENSA 2")
    assert _ids(r["sin_rango"]) == _ids_de("PLEGADORA")


def test_si_ninguna_de_las_cargadas_acepta_el_rango_no_queda_ninguna_efectiva():
    r = _resolver("RECTIFICADORA", rangos=("AYUDANTE",), cargadas=("RECTIFICADORA TANGENCIAL",))
    assert r["origen"] == ORIGEN_CARGADA
    assert r["efectivas"] == []
    assert _ids(r["sin_rango"]) == _ids_de("RECTIFICADORA TANGENCIAL")


def test_los_procesos_a_mano_no_tienen_maquina():
    for nombre in ("PULIDO", "ENGOMADO", "DECAPADO", "PEGADO DE GOMA", "EMBALADO"):
        r = _resolver(nombre)
        assert r["origen"] == ORIGEN_A_MANO and r["efectivas"] == [], nombre


def test_lo_tercerizado_no_usa_maquina_aunque_el_nombre_diga_torno():
    """El rango TERCERIZADO lo marca el taller en Recursos: cilindrado de chapa y repujado
    en torno se mandan afuera y el nombre no lo dice."""
    r = _resolver("CILINDRADO DE CHAPA", rangos=("TERCERIZADO",))
    assert r["origen"] == ORIGEN_A_MANO


def test_una_maquina_dada_de_baja_no_cuenta_como_cargada():
    """Si la única máquina cargada ya no existe, vale la deducción por nombre."""
    r = maquinas_del_proceso("TORNO T1", _rangos("OFICIAL"),
                             [{"id": 999999, "nombre": "TORNO FANTASMA"}], TALLER)
    assert r["origen"] == ORIGEN_NOMBRE
    # Los seis tornos convencionales. Los CNC también aceptan OFICIAL, pero desde el
    # 29/9/2026 son otra familia: sin «CNC» en el nombre, el trabajo es convencional.
    assert _ids(r["efectivas"]) == _ids_de(*TORNOS_CONVENCIONALES)


def test_una_familia_que_el_taller_no_tiene_dice_que_no_hay_maquina():
    """OXICORTE existe como familia del planificador y ninguna de las 27 máquinas lo es."""
    r = _resolver("OXICORTE", rangos=("OFICIAL",))
    assert r["origen"] == ORIGEN_NINGUNA and r["motivo"] == MOTIVO_SIN_MAQUINA


def test_hay_maquinas_de_la_familia_pero_ninguna_acepta_el_rango():
    """Es el «la máquina no acepta al que lo hace» de las trabas: distinto de no tener
    máquina, y con otro arreglo (cambiar un rango, no cargar una máquina)."""
    r = _resolver("SOLDADURA CON MIG", rangos=("AYUDANTE",))
    assert r["origen"] == ORIGEN_NINGUNA and r["motivo"] == MOTIVO_RANGO


def test_una_preparacion_va_a_las_maquinas_de_su_familia():
    r = _resolver("PREPARACION DE FRESADORA")
    assert r["origen"] == ORIGEN_NOMBRE
    assert _ids(r["efectivas"]) == _ids_de("FRESADORA 1", "FRESADORA 2", "FRESADORA VAN NORMAN")


def test_una_preparacion_sin_familia_busca_la_maquina_por_parecido_de_nombre():
    """«Preparación de soldadora tig» no necesita familia: el solver busca la máquina
    cuyo nombre contiene lo que queda después de sacar «preparación de»."""
    taller = TALLER + [{"id": 900, "nombre": "MAQUINA RARA", "cod_maquina": None,
                        "rangos": _rangos("OFICIAL")}]
    r = maquinas_del_proceso("PREPARACION DE MAQUINA RARA", _rangos("OFICIAL"), [], taller)
    assert r["origen"] == ORIGEN_NOMBRE and _ids(r["efectivas"]) == [900]


def test_sin_rangos_se_listan_todas_las_de_la_familia():
    """Un proceso sin rango no filtra: puede ir a cualquiera de su familia (la CNC no: es
    otra familia desde el 29/9/2026). El solver, en cambio, le presta rangos por parecido
    de nombre; ver el módulo."""
    r = _resolver("FRESADORA", rangos=())
    assert _ids(r["efectivas"]) == _ids_de("FRESADORA 1", "FRESADORA 2", "FRESADORA VAN NORMAN")


# ── La cobertura entera ───────────────────────────────────────────────────────

def _cobertura():
    return {
        "maquinas": TALLER,
        "rangos": [],
        "procesos": [
            {"id": 68, "nombre": "FRESADORA F6", "rangos": _rangos("OFICIAL"), "maquinas": [],
             "habilitados": 6, "por_habilidad_manual": 0, "lineas_abiertas": 3},
            {"id": 128, "nombre": "REPARACION DE ROSCA", "rangos": _rangos("OFICIAL"),
             "maquinas": [{"id": ID["TORNO 1"], "nombre": "TORNO 1"}],
             "habilitados": 6, "por_habilidad_manual": 0, "lineas_abiertas": 0},
        ],
    }


def test_la_cobertura_suma_los_campos_y_deja_intacto_lo_cargado():
    data = con_maquinas_de_cada_proceso(_cobertura())
    f6, rosca = data["procesos"]

    assert f6["maquinas_origen"] == ORIGEN_NOMBRE
    assert _ids(f6["maquinas_efectivas"]) == _ids_de("FRESADORA 1", "FRESADORA 2", "FRESADORA VAN NORMAN")
    assert f6["maquinas"] == [], "`maquinas` sigue siendo sólo lo cargado: es lo que edita el editor"

    assert rosca["maquinas_origen"] == ORIGEN_CARGADA
    assert rosca["maquinas"] == [{"id": ID["TORNO 1"], "nombre": "TORNO 1"}]
    assert _ids(rosca["maquinas_efectivas"]) == _ids_de("TORNO 1")


def test_un_proceso_que_falla_no_tumba_la_cobertura(monkeypatch):
    """La misma pantalla avisa qué rango no tiene gente: no se pierde por un adorno."""
    import backend.application.MaquinasDelProceso as mdp

    real = mdp.maquinas_del_proceso

    def _falla_en_el_68(nombre, *a, **k):
        if nombre == "FRESADORA F6":
            raise ValueError("dato raro")
        return real(nombre, *a, **k)

    monkeypatch.setattr(mdp, "maquinas_del_proceso", _falla_en_el_68)
    f6, rosca = con_maquinas_de_cada_proceso(_cobertura())["procesos"]

    assert "maquinas_origen" not in f6, "el que falló queda como estaba: la pantalla lo muestra como antes"
    assert rosca["maquinas_origen"] == ORIGEN_CARGADA, "los demás se resuelven igual"


async def test_el_endpoint_de_cobertura_trae_las_maquinas_de_cada_proceso(session):
    """De punta a punta por el servicio, contra SQLite: lo que sale de `/rangos/cobertura`."""
    from backend.application.RangoService import RangoService
    from backend.domain.Maquinaria import Maquinaria
    from backend.domain.Proceso import Proceso
    from backend.domain.ProcesoMaquinaria import ProcesoMaquinaria
    from backend.domain.Rango import Rango
    from backend.domain.RangoMaquinaria import RangoMaquinaria
    from backend.domain.RangoProceso import RangoProceso

    session.add_all([
        Rango(id=1, nombre="OFICIAL"),
        Maquinaria(id=9, nombre="FRESADORA 1", cod_maquina="FREY-1"),
        Maquinaria(id=10, nombre="FRESADORA 2", cod_maquina="FREY-2"),
        Maquinaria(id=1, nombre="TORNO 1", cod_maquina="TORY-1"),
        Proceso(id=68, nombre="FRESADORA F6"),
        Proceso(id=128, nombre="REPARACION DE ROSCA"),
        Proceso(id=300, nombre="PULIDO"),
    ])
    await session.flush()
    session.add_all([
        RangoMaquinaria(id_rango=1, id_maquinaria=9),
        RangoMaquinaria(id_rango=1, id_maquinaria=10),
        RangoMaquinaria(id_rango=1, id_maquinaria=1),
        RangoProceso(id_rango=1, id_proceso=68),
        RangoProceso(id_rango=1, id_proceso=128),
        ProcesoMaquinaria(id_proceso=128, id_maquinaria=1),
    ])
    await session.commit()

    resp = await RangoService(session).obtenerCobertura()
    por_id = {p["id"]: p for p in resp.data["procesos"]}

    assert por_id[68]["maquinas_origen"] == ORIGEN_NOMBRE
    assert [m["nombre"] for m in por_id[68]["maquinas_efectivas"]] == ["FRESADORA 1", "FRESADORA 2"]
    assert por_id[128]["maquinas_origen"] == ORIGEN_CARGADA
    assert [m["nombre"] for m in por_id[128]["maquinas_efectivas"]] == ["TORNO 1"]
    assert por_id[300]["maquinas_origen"] == ORIGEN_A_MANO


# ── 2. Que no se separe del planificador ──────────────────────────────────────

MAQ_DOMAIN_IDX = 14   # maq_domain_vals, en lo que devuelve _crear_variables_y_dominios
DUMMY_MAQ_ID = 999998

# (nombre, rangos, cargadas). Los nombres y rangos son de producción; las cargadas son las
# 8 que hay y las que hicieron falta para cubrir cada rama.
CATALOGO = [
    ("FRESADORA F6", ("OFICIAL",), ()),
    ("FRESADORA F7", ("OFICIAL",), ()),
    ("FRESADORA CNC", ("OFICIAL CNC",), ()),
    ("TALLADO EN FRESADORA", ("OFICIAL",), ()),
    ("TALLADO EN FRESADORA CNC", ("OFICIAL",), ()),
    ("AGUJEREADO EN FRESADORA", ("OFICIAL",), ()),
    ("AGUJEREADORA DE BANCO", ("OFICIAL",), ()),
    ("TORNO T1", ("OFICIAL",), ()),
    ("TORNO CNC", ("OFICIAL ESPECIALIZADO", "TÉCNICO"), ()),
    ("TORNEADO", (), ()),                                  # sin rangos
    ("FRESADORA", (), ()),                                 # sin rangos y con familia
    ("REPARACION DE ROSCA", ("OFICIAL",), ()),             # sin familia
    ("REPARACION DE ROSCA", ("OFICIAL",), TORNOS_CONVENCIONALES),
    ("ENDERESAR DE BASES", ("MEDIO OFICIAL", "OPERARIO CALIFICADO"), ("PLEGADORA", "PRENSA 1", "PRENSA 2")),
    ("ENDERESAR DE BASES", ("MEDIO OFICIAL", "OPERARIO CALIFICADO"), ()),
    ("RECTIFICADORA", ("OFICIAL",), ("RECTIFICADORA TANGENCIAL",)),
    ("RECTIFICADORA", ("AYUDANTE",), ("RECTIFICADORA TANGENCIAL",)),   # la cargada no cruza
    ("SOLDADURA CON MIG", ("OFICIAL",), ()),
    ("SOLDADURA CON MIG", ("AYUDANTE",), ()),              # familia con máquinas, ningún rango
    ("SOLDADURA CON TIG", ("OFICIAL",), ()),
    ("SOLDADURA APORTE DURO", ("OFICIAL",), ("SOLDADORA MIG/MAG 450 1", "SOLDADORA MIG/MAG 450 2")),
    ("SOLDADURA", ("OFICIAL",), ()),                       # no dice cuál: sin familia
    ("GUILLOTINA", ("OFICIAL",), ()),
    ("PLEGADO", ("OFICIAL",), ()),
    ("PLEGADO", ("OFICIAL PLEGADOR",), ()),
    ("PLEGADO", ("AYUDANTE",), ()),
    ("PRENSADO", ("OPERARIO CALIFICADO",), ()),
    ("CORTE CON SIERRA", ("MEDIO OFICIAL",), ()),
    ("OXICORTE", ("OFICIAL",), ()),                        # familia sin máquinas
    ("PULIDO", ("OFICIAL",), ()),                          # a mano
    ("ENGOMADO", ("AYUDANTE",), ()),
    ("EMBALADO", ("AYUDANTE",), ()),
    ("CILINDRADO DE CHAPA", ("TERCERIZADO",), ()),         # tercerizado por rango
    ("TORNO TERCERIZADO", ("OFICIAL",), ()),               # tercerizado por nombre
    ("PREPARACION DE FRESADORA", ("OFICIAL",), ()),        # SETUP con familia
    ("PREPARACION DE FRESADORA CNC", ("OFICIAL",), ()),
    ("PREPARACION DE SOLDADORA TIG", ("OFICIAL",), ()),
    ("PROGRAMACION FRESADORA CNC", ("OFICIAL",), ()),
    ("PREPARACION DE FRESADORA", ("AYUDANTE",), ()),       # SETUP: nada cruza y cae al nombre
    ("PREPARACION DE MAQUINA QUE NO EXISTE", ("OFICIAL",), ()),
]


def _dominio_del_solver(nombre, rangos, cargadas):
    """El dominio de máquinas del proceso, armado por el solver de verdad."""
    ps.H = 100000
    proc_id = 500
    ids_rango = [RANGO[n] for n in rangos]
    tercerizado = RANGO["TERCERIZADO"] in ids_rango
    # Así los calcula el planificador antes de armar el modelo (PlanificacionService,
    # «Clasificar si usa máquina»): la familia sólo cuenta si el proceso usa máquina.
    usa_maquina = proceso_usa_maquina(nombre, es_tercerizado=tercerizado)
    familia = familia_requerida_from_proceso(nombre) if usa_maquina else ""
    procesos_norm = [(1, proc_id, 1, None, 5, 60, ids_rango, nombre, usa_maquina, familia, {})]
    # Con el tipo quinto, como lo cargan los loaders del planificador.
    maquinarias = [(m["id"], {r["id"] for r in m["rangos"]}, m["nombre"], m["cod_maquina"], m.get("tipo"))
                   for m in TALLER]
    salida = _crear_variables_y_dominios(
        cp_model.CpModel(), procesos_norm, [(10, 1)], maquinarias, set(), set(),
        maquinas_por_proceso={proc_id: [ID[n] for n in cargadas]} if cargadas else None,
    )
    return set(salida[MAQ_DOMAIN_IDX][(1, 1)]) - {DUMMY_MAQ_ID}


def test_la_pantalla_dice_lo_mismo_que_el_solver_en_todo_el_catalogo():
    """Lo único que le importa a quien mira la fila es que lo que ve sea lo que hace el plan."""
    for nombre, rangos, cargadas in CATALOGO:
        r = _resolver(nombre, rangos=rangos, cargadas=cargadas)
        de_pantalla = {m["id"] for m in r["efectivas"]}
        del_solver = _dominio_del_solver(nombre, rangos, cargadas)

        es_preparacion_con_dato = cargadas and nombre.startswith(("PREPARACION", "PROGRAMACION"))
        if es_preparacion_con_dato:
            continue   # diferencia conocida y documentada: ver el módulo

        assert de_pantalla == del_solver, (
            f"{nombre} {rangos} cargadas={cargadas}: la pantalla dice {sorted(de_pantalla)} "
            f"y el solver arma {sorted(del_solver)} ({r['origen']})"
        )


def test_el_catalogo_de_prueba_cubre_todos_los_origenes_y_motivos():
    """Si nadie ejercita un origen, la comparación de arriba no prueba esa rama."""
    vistos = {(_resolver(n, rangos=rs, cargadas=cs)["origen"],
               _resolver(n, rangos=rs, cargadas=cs)["motivo"]) for n, rs, cs in CATALOGO}
    assert {o for o, _ in vistos} == {ORIGEN_CARGADA, ORIGEN_NOMBRE, ORIGEN_A_MANO, ORIGEN_NINGUNA}
    assert {m for _, m in vistos if m} == {MOTIVO_SIN_FAMILIA, MOTIVO_SIN_MAQUINA, MOTIVO_RANGO}
