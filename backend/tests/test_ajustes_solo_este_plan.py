"""Un ajuste "solo para este plan" llega al solver y NO toca la base.

Pedido de Julián (17/09/2026): poder destrabar un aviso del planificador sin que el
cambio quede escrito en Recursos. Antes la única forma de aplicar la solución que
propone el panel de trabas era guardarla como dato del taller: para que UN plan
cerrara había que cambiar la máquina, el proceso o la habilidad para siempre.

Lo que se cuida acá son las dos mitades de esa promesa, que se rompen por separado:
que el dato ajustado efectivamente cambie el cálculo (si no, el usuario aprieta el
botón y el plan sale igualito, sin que nada avise), y que ningún repositorio escriba
nada por el camino (si no, la excepción de un plan le queda al taller puesta).

Todo corre sin base: los cuatro repositorios que `planificar()` construye con `db`
adentro se pisan por monkeypatch. No es un capricho de estilo — importar el servicio
ya arma el engine apuntando a Supabase, así que un repositorio de verdad con un `db`
de verdad sale a la base del cliente.
"""
import types

import pytest

from backend.application import PlanificacionService as PS


# --- Datos de juguete -------------------------------------------------------
# Lo mínimo que `planificar()` toca de cada objeto; si mañana lee un campo más,
# el test falla con AttributeError y eso es justamente lo que queremos saber.

def _proceso(id, nombre, rangos):
    return types.SimpleNamespace(
        id=id, nombre=nombre,
        rangos=[types.SimpleNamespace(id_rango=r) for r in rangos])


def _pasada(id, proceso, orden=1, minutos=60):
    return types.SimpleNamespace(
        id=id, proceso=proceso, orden=orden, tiempo_proceso=minutos,
        cant_operarios=1, id_maquinaria=None, id_operario=None,
        no_lleva_maquina=0)


def _orden(id, pasadas):
    return types.SimpleNamespace(
        id=id, procesos=pasadas, prioridad=None,
        fecha_prometida=None, id_otvieja=9000 + id)


def _maquina(id, nombre, rangos, cod=None):
    return types.SimpleNamespace(
        id=id, nombre=nombre, cod_maquina=cod or nombre,
        rango_maquinarias=[types.SimpleNamespace(id_rango=r) for r in rangos])


# --- Repositorios falsos ----------------------------------------------------

class _RepoOrden:
    def __init__(self, ordenes): self.ordenes = ordenes
    async def find_with_procesos_by_ids(self, ids): return self.ordenes
    async def find_with_procesos(self): return self.ordenes


class _RepoOperario:
    # find_with_rangos devuelve (id_operario, id_rango), no objetos.
    async def find_with_rangos(self): return [(1, 7)]
    async def find_interpreta_planos(self): return {1: True}
    async def find_all(self): return []


class _RepoMaquinaria:
    def __init__(self, maquinas): self.maquinas = maquinas
    async def find_with_rangos(self): return self.maquinas


class _RepoSkill:
    def __init__(self, nativas_off=None, manuales=None):
        self.nativas_off = nativas_off or {}
        self.manuales = manuales or {}
    async def get_map_por_proceso(self): return {}
    async def get_nativas_deshabilitadas(self): return self.nativas_off
    async def get_manuales_por_proceso(self): return self.manuales
    async def save(self, *a, **k):
        raise AssertionError("un ajuste de este plan no puede guardar una skill")


class _RepoPlanificacionEspia:
    """Anota si alguien escribió. Con preview=True nadie tiene que llamarlo."""
    def __init__(self): self.escribio = False
    async def insertar_planificacion_lote(self, resultados, inicio_base=None):
        self.escribio = True
        return {}


async def _devolver(valor): return valor


@pytest.fixture
def sin_base(monkeypatch):
    """Los repos que `planificar()` construye con `db` adentro de la función.

    No se pueden inyectar por parámetro, así que se pisan las clases en el
    módulo: es eso o levantar una base.
    """
    monkeypatch.setattr(PS, "RangoRepository", lambda db: types.SimpleNamespace(
        find_all=lambda: _devolver([
            types.SimpleNamespace(id=7, nombre="OFICIAL"),
            types.SimpleNamespace(id=9, nombre="OFICIAL CNC"),
        ])))
    monkeypatch.setattr(PS, "ProcesoRepository", lambda db: types.SimpleNamespace(
        find_maquinarias_por_proceso=lambda: _devolver({})))
    monkeypatch.setattr(PS, "PlanoRepository", lambda db: types.SimpleNamespace(
        find_ordenes_con_plano=lambda: _devolver(set())))
    monkeypatch.setattr(PS, "DiaBloqueadoRepository", lambda db: types.SimpleNamespace(
        listar=lambda: _devolver([])))


@pytest.fixture
def solver_espia(monkeypatch):
    """Se queda con lo que le llega al solver, en vez de resolver de verdad.

    `_resolver_planificacion` se llama con TODO posicional desde un to_thread,
    y tiene que devolver la tupla (resultados, rangos_efectivos).
    """
    capturado = {}

    def _falso(procesos, operarios, maquinarias, fecha_desde, fecha_hasta,
               nativas_off, *resto):
        capturado["procesos"] = procesos
        capturado["maquinarias"] = maquinarias
        capturado["nativas_off"] = nativas_off
        return [], {}

    monkeypatch.setattr(PS, "_resolver_planificacion", _falso)
    return capturado


async def _correr(ajustes, repo_plan, repo_skill=None, proceso=None, maquina=None):
    proceso = proceso or _proceso(10, "FRESADO CNC", [7])
    maquina = maquina or _maquina(3, "FRESADORA 1", [7])
    return await PS.planificar(
        _RepoOrden([_orden(1, [_pasada(100, proceso)])]),
        _RepoOperario(), _RepoMaquinaria([maquina]), repo_plan,
        db=object(), ordenes_ids=[1], preview=True,
        repo_skill=repo_skill or _RepoSkill(),
        ajustes_del_plan=ajustes,
    )


# --- (a) el dato ajustado llega al solver -----------------------------------

@pytest.mark.asyncio
async def test_los_rangos_ajustados_llegan_al_solver(sin_base, solver_espia):
    """El caso típico: "a esta fresadora le falta OFICIAL CNC", solo por hoy."""
    repo_plan = _RepoPlanificacionEspia()
    await _correr({"procesos": {10: [7, 9]}, "maquinarias": {3: [7, 9]},
                   "skills_nativas": []}, repo_plan)

    # índice 6 de la tupla del solver = rangos del proceso.
    assert sorted(solver_espia["procesos"][0][6]) == [7, 9]
    # índice 1 de la tupla de máquina = su conjunto de rangos (es un set, no una
    # lista: el solver lo cruza con `&` y con `in`).
    assert solver_espia["maquinarias"][0][1] == {7, 9}


@pytest.mark.asyncio
async def test_encender_una_habilidad_solo_para_este_plan(sin_base, solver_espia):
    repo_skill = _RepoSkill(nativas_off={10: {1}})
    await _correr(
        {"procesos": {}, "maquinarias": {},
         "skills_nativas": [{"operario_id": 1, "proceso_id": 10,
                             "habilitado": True}]},
        _RepoPlanificacionEspia(), repo_skill)

    assert 1 not in solver_espia["nativas_off"].get(10, set())
    # Y lo que devolvió el repositorio quedó intacto: la copia es de verdad. Si se
    # mutara el set original, el ajuste de un plan se le filtraría al siguiente.
    assert repo_skill.nativas_off == {10: {1}}


@pytest.mark.asyncio
async def test_apagar_una_habilidad_solo_para_este_plan(sin_base, solver_espia):
    """El ajuste también va para el otro lado: sacar a alguien de un proceso."""
    repo_skill = _RepoSkill()
    await _correr(
        {"procesos": {}, "maquinarias": {},
         "skills_nativas": [{"operario_id": 1, "proceso_id": 10,
                             "habilitado": False}]},
        _RepoPlanificacionEspia(), repo_skill)

    assert solver_espia["nativas_off"][10] == {1}
    # `nativas_off` es un dict común, no un defaultdict: acá se ve que el alta
    # entró por setdefault y no reventó con KeyError.
    assert repo_skill.nativas_off == {}


@pytest.mark.asyncio
async def test_sin_ajustes_manda_lo_que_dice_la_base(sin_base, solver_espia):
    await _correr(None, _RepoPlanificacionEspia())
    assert sorted(solver_espia["procesos"][0][6]) == [7]
    assert solver_espia["maquinarias"][0][1] == {7}


@pytest.mark.asyncio
async def test_el_ajuste_no_pisa_los_datos_que_vinieron_del_orm(sin_base, solver_espia):
    """Los objetos del ORM se leen, no se escriben.

    Es la otra cara de "no toca la base": si el ajuste modificara el objeto que
    devolvió el repositorio, con una sesión abierta SQLAlchemy podría terminar
    persistiendo el cambio sin que nadie lo haya pedido.
    """
    proceso = _proceso(10, "FRESADO CNC", [7])
    maquina = _maquina(3, "FRESADORA 1", [7])
    await _correr({"procesos": {10: [7, 9]}, "maquinarias": {3: [7, 9]},
                   "skills_nativas": []},
                  _RepoPlanificacionEspia(), proceso=proceso, maquina=maquina)

    assert [r.id_rango for r in proceso.rangos] == [7]
    assert [r.id_rango for r in maquina.rango_maquinarias] == [7]


@pytest.mark.asyncio
async def test_un_ajuste_que_deja_el_proceso_sin_rangos_no_se_revierte_solo(
        sin_base, solver_espia):
    """Vaciar los rangos a propósito tiene que quedar vacío.

    Cuando un proceso se queda sin rangos hay un rescate que se los deduce por
    parecido de nombre con una máquina ("FRESADO CNC" contra "FRESADORA 1"). Ese
    rescate existe para los procesos que nadie cargó en Recursos; sobre un ajuste
    hecho a mano lo desharía sin decir una palabra.
    """
    await _correr({"procesos": {10: []}, "maquinarias": {}, "skills_nativas": []},
                  _RepoPlanificacionEspia(),
                  proceso=_proceso(10, "FRESADORA 1", [7]),
                  maquina=_maquina(3, "FRESADORA 1", [7]))

    assert solver_espia["procesos"][0][6] == []


# --- (b) nadie escribió nada ------------------------------------------------

@pytest.mark.asyncio
async def test_un_ajuste_no_escribe_en_ningun_lado(sin_base, solver_espia):
    """Es la mitad del pedido: destrabar sin cambiar los datos del taller.

    `_RepoSkill.save` explota si alguien la llama, y el repo de planificación
    anota. Los cuatro repos que se construyen con `db` están pisados por fixture,
    así que cualquier escritura nueva por ahí revienta con AttributeError.
    """
    repo_plan = _RepoPlanificacionEspia()
    await _correr({"procesos": {10: [7, 9]}, "maquinarias": {3: [7, 9]},
                   "skills_nativas": [{"operario_id": 1, "proceso_id": 10,
                                       "habilitado": True}]}, repo_plan)
    assert not repo_plan.escribio, "una vista previa con ajustes guardó un plan"


def test_el_dto_acepta_los_ajustes():
    """Si el campo no existe en el DTO, nunca llega al servicio."""
    from backend.dto.PlanificarRequestDTO import PlanificarRequestDTO
    dto = PlanificarRequestDTO(preview=True, ajustes_del_plan={
        "procesos": {"10": [7, 9]},
        "maquinarias": {"3": [7]},
        "skills_nativas": [{"operario_id": 1, "proceso_id": 10,
                            "habilitado": True}],
    })
    # Las claves llegan como texto en el JSON y tienen que salir como int: el
    # servicio las compara contra ids del ORM, y "10" nunca va a ser 10.
    assert dto.ajustes_del_plan.procesos == {10: [7, 9]}
    assert dto.ajustes_del_plan.skills_nativas[0].operario_id == 1
    # Y el model_dump() —que es lo que la API le pasa al servicio— mantiene los int.
    assert dto.ajustes_del_plan.model_dump()["maquinarias"] == {3: [7]}


def test_el_dto_sin_ajustes_sigue_andando():
    """Una pestaña con el bundle viejo no manda el campo y tiene que planificar."""
    from backend.dto.PlanificarRequestDTO import PlanificarRequestDTO
    assert PlanificarRequestDTO(preview=True).ajustes_del_plan is None


# --- La costura entre el endpoint y el servicio -----------------------------
#
# Es el único tramo donde el ajuste se puede perder SIN QUE NADA FALLE: pydantic
# descarta callado lo que no conoce y `planificar()` tiene el parámetro con default
# `None`, así que un nombre de campo mal escrito de cualquiera de los dos lados da
# exactamente el mismo resultado que no haber apretado el botón — plan igual, cero
# errores, cero logs. Por eso se prueba el endpoint entero y no sólo el DTO.

@pytest.mark.asyncio
async def test_el_endpoint_le_pasa_los_ajustes_al_servicio(monkeypatch):
    from backend.presentation import PlanificacionAPI as API
    from backend.dto.PlanificarRequestDTO import PlanificarRequestDTO

    visto = {}

    async def _planificar_espia(*args, **kwargs):
        visto.update(kwargs)
        return {"planificados": [], "excedentes": [], "diagnosticos": []}

    monkeypatch.setattr(API, "planificar", _planificar_espia)
    for nombre in ("OrdenTrabajoRepository", "OperarioRepository",
                   "MaquinariaRepository", "PlanificacionRepository"):
        monkeypatch.setattr(API, nombre, lambda db: object())

    # La auditoría se importa adentro de la función, así que se pisa en su módulo.
    import backend.infrastructure.AuditoriaRepository as Aud
    monkeypatch.setattr(Aud, "AuditoriaRepository", lambda db: types.SimpleNamespace(
        registrar_intento=lambda *a, **k: _devolver(None)))

    # El cuerpo tal cual lo arma el front: claves de texto, porque es JSON.
    body = PlanificarRequestDTO(ordenes_ids=[1], preview=True, ajustes_del_plan={
        "procesos": {"10": [7, 9]},
        "maquinarias": {"3": [7]},
        "skills_nativas": [{"operario_id": 1, "proceso_id": 10, "habilitado": False}],
    })
    await API.planificar_endpoint(db=object(), body=body, current_user={"id": 1})

    ajustes = visto.get("ajustes_del_plan")
    assert ajustes is not None, "el endpoint no le pasó los ajustes al servicio"
    # Dict y no el DTO: el servicio lo lee con .get() y con [], no con atributos.
    assert isinstance(ajustes, dict)
    # Y con las claves ya convertidas a int, que es como se comparan contra el ORM.
    assert ajustes["procesos"] == {10: [7, 9]}
    assert ajustes["maquinarias"] == {3: [7]}
    assert ajustes["skills_nativas"] == [
        {"operario_id": 1, "proceso_id": 10, "habilitado": False}]


@pytest.mark.asyncio
async def test_el_endpoint_sin_ajustes_no_le_inventa_ninguno(monkeypatch):
    """Un plan sin ajustes tiene que llegar al servicio igual que siempre.

    Si acá viajara `{}` en vez de `None`, el servicio escribiría en el log que este
    plan salió con ajustes. Un plan que no coincide con Recursos y un log que dice
    que sí hubo ajustes son la misma pista para el que investiga: no se puede mentir.
    """
    from backend.presentation import PlanificacionAPI as API
    from backend.dto.PlanificarRequestDTO import PlanificarRequestDTO

    visto = {}

    async def _planificar_espia(*args, **kwargs):
        visto.update(kwargs)
        return {}

    monkeypatch.setattr(API, "planificar", _planificar_espia)
    for nombre in ("OrdenTrabajoRepository", "OperarioRepository",
                   "MaquinariaRepository", "PlanificacionRepository"):
        monkeypatch.setattr(API, nombre, lambda db: object())
    import backend.infrastructure.AuditoriaRepository as Aud
    monkeypatch.setattr(Aud, "AuditoriaRepository", lambda db: types.SimpleNamespace(
        registrar_intento=lambda *a, **k: _devolver(None)))

    await API.planificar_endpoint(
        db=object(), body=PlanificarRequestDTO(ordenes_ids=[1], preview=True),
        current_user={"id": 1})
    assert visto.get("ajustes_del_plan") is None


# --- (c) el ajuste no se cuela en el botón que SÍ escribe en Recursos --------
#
# Al lado del botón nuevo quedó el de siempre, «Guardar en Recursos». Los dos salen del
# mismo aviso, y el aviso se arma con los datos YA ajustados —tiene que ser así, o la
# traba que el ajuste destrabó seguiría en el panel—. El problema es que la acción
# permanente calcula qué guardar como «lo que tiene ahora ∪ lo nuevo»: con un ajuste
# encima, ese «lo que tiene ahora» ya incluye el rango temporal, así que el primer
# «Guardar en Recursos» que se apretara sobre esa misma máquina o ese mismo proceso lo
# escribía en la base para siempre. Y el panel de confirmación lo mostraba en «hoy
# tiene», afirmando que un dato está cargado cuando no lo está.

from backend.application.DiagnosticoPlanificacion import construir_diagnosticos

OFICIAL, MEDIO, CNC = 7, 2, 9
RANGOS = {OFICIAL: "OFICIAL", MEDIO: "MEDIO OFICIAL", CNC: "OFICIAL CNC"}
QUIEN = {1: "JUAN PEREZ"}


def _tupla(proc_id, nombre, rangos, familia, dur=60):
    # (orden, proc, sec, fecha, prio, dur, rangos, nombre, usa_maquina, familia, skills)
    return (1, proc_id, 1, None, 5, dur, rangos, nombre, True, familia, {})


def _accion_de(diags, tipo_aviso, tipo_accion):
    d = next(x for x in diags if x["tipo"] == tipo_aviso)
    return next(s["accion"] for s in d["soluciones"]
                if (s.get("accion") or {}).get("tipo") == tipo_accion)


def test_guardar_en_recursos_no_arrastra_el_rango_que_se_ajusto_en_la_maquina():
    """La FRESADORA 2 tiene OFICIAL en Recursos; MEDIO OFICIAL se lo puso el ajuste.

    El aviso de cuello propone abrirle la máquina sumándole OFICIAL CNC. Guardar eso
    tiene que escribir OFICIAL + OFICIAL CNC, no los tres.
    """
    procesos = [_tupla(10, "FRESADO EN FRESADORA", [CNC], "FRESADORA", dur=1600)]
    # FRESADORA 1 es la única habilitada (tiene OFICIAL CNC); la 2 es la que el aviso
    # propone sumar, y es la que vino ajustada.
    maquinarias = [(3, {CNC}, "FRESADORA 1", "F1"), (4, {OFICIAL, MEDIO}, "FRESADORA 2", "F2")]

    accion = _accion_de(
        construir_diagnosticos(procesos, [(1, OFICIAL)], maquinarias, [], RANGOS, QUIEN,
                               maq_rangos_reales={3: {CNC}, 4: {OFICIAL}}),
        "cuello_de_maquina", "maquinaria")
    objetivo = accion["objetivos"][0]
    assert objetivo["id"] == 4
    assert objetivo["rangos"] == [OFICIAL, CNC]
    assert MEDIO not in objetivo["rangos"], "el ajuste de este plan se guardó en Recursos"
    # Y el panel de confirmación no puede afirmar que la máquina «hoy tiene» un rango
    # que nadie cargó: es el dato con el que la persona decide si aprieta o no.
    assert objetivo["tenia"] == ["OFICIAL"]
    assert objetivo["suma"] == ["OFICIAL CNC"]


def test_sin_ajustes_la_accion_de_maquina_sale_igual_que_siempre():
    """El 99% de los planes no tiene ajustes y no pasa los reales: nada cambia."""
    procesos = [_tupla(10, "FRESADO EN FRESADORA", [CNC], "FRESADORA", dur=1600)]
    maquinarias = [(3, {CNC}, "FRESADORA 1", "F1"), (4, {OFICIAL, MEDIO}, "FRESADORA 2", "F2")]

    accion = _accion_de(
        construir_diagnosticos(procesos, [(1, OFICIAL)], maquinarias, [], RANGOS, QUIEN),
        "cuello_de_maquina", "maquinaria")
    objetivo = accion["objetivos"][0]
    assert objetivo["rangos"] == [MEDIO, OFICIAL, CNC]
    assert objetivo["tenia"] == ["MEDIO OFICIAL", "OFICIAL"]


def test_guardar_en_recursos_no_arrastra_el_rango_que_se_ajusto_en_el_proceso():
    """Mismo problema por el otro lado: la acción que le carga rangos AL PROCESO.

    El proceso tiene OFICIAL en Recursos y el ajuste le sumó OFICIAL CNC. El aviso dice
    que la máquina solo acepta MEDIO OFICIAL y ofrece ponérselo al proceso; guardar eso
    tiene que dejar OFICIAL + MEDIO OFICIAL.
    """
    procesos = [_tupla(10, "FRESADO EN FRESADORA", [OFICIAL, CNC], "FRESADORA")]
    maquinarias = [(3, {MEDIO}, "FRESADORA 1", "F1")]
    # El proceso salió sin máquina: es lo que dispara este aviso.
    resultados = [{"orden_id": 1, "secuencia": 1, "usa_maquina": True, "id_maquinaria": None}]
    # Alguien con MEDIO OFICIAL, o el aviso ni ofrece esta solución (sin gente que
    # maneje la máquina, tocar el proceso no destraba nada y por eso no se propone).
    operarios = [(1, MEDIO)]

    accion = _accion_de(
        construir_diagnosticos(procesos, operarios, maquinarias, resultados, RANGOS, QUIEN,
                               rangos_reales_por_proceso={10: {OFICIAL}}),
        "maquina_incompatible", "proceso")
    assert accion["rangos"] == [MEDIO, OFICIAL]
    assert CNC not in accion["rangos"], "el ajuste de este plan se guardó en Recursos"
    assert accion["objetivos"][0]["tenia"] == ["OFICIAL"]


def test_sin_ajustes_la_accion_de_proceso_sale_igual_que_siempre():
    procesos = [_tupla(10, "FRESADO EN FRESADORA", [OFICIAL, CNC], "FRESADORA")]
    maquinarias = [(3, {MEDIO}, "FRESADORA 1", "F1")]
    resultados = [{"orden_id": 1, "secuencia": 1, "usa_maquina": True, "id_maquinaria": None}]

    accion = _accion_de(
        construir_diagnosticos(procesos, [(1, MEDIO)], maquinarias, resultados, RANGOS, QUIEN),
        "maquina_incompatible", "proceso")
    assert accion["rangos"] == [MEDIO, OFICIAL, CNC]
    assert accion["objetivos"][0]["tenia"] == ["OFICIAL", "OFICIAL CNC"]


def test_un_proceso_ajustado_no_se_confunde_con_una_preparacion():
    """El aviso de máquina incompatible detecta las preparaciones comparando los rangos
    que usó el solver contra los que entraron: si esa comparación se hiciera contra los
    de Recursos, TODO proceso ajustado se leería como preparación y el detalle le
    mentiría al taller."""
    procesos = [_tupla(10, "FRESADO EN FRESADORA", [OFICIAL, CNC], "FRESADORA")]
    resultados = [{"orden_id": 1, "secuencia": 1, "usa_maquina": True, "id_maquinaria": None}]
    diags = construir_diagnosticos(
        procesos, [(1, MEDIO)], [(3, {MEDIO}, "FRESADORA 1", "F1")], resultados, RANGOS, QUIEN,
        rangos_reales_por_proceso={10: {OFICIAL}})
    d = next(x for x in diags if x["tipo"] == "maquina_incompatible")
    assert "es una preparación" not in d["detalle"]


@pytest.mark.asyncio
async def test_planificar_le_pasa_al_diagnostico_lo_que_dice_recursos(
        sin_base, solver_espia, monkeypatch):
    """La costura: el servicio tiene que armar los dos dicts ANTES de aplicar el ajuste.

    Es el tramo que se pierde en silencio —los parámetros tienen default `None` y sin
    ellos el diagnóstico sale igual de creíble, solo que mintiendo—, así que se mira lo
    que el servicio le pasa de verdad.
    """
    import backend.application.DiagnosticoPlanificacion as Diag
    visto = {}

    def _diagnostico_espia(*args, **kwargs):
        visto.update(kwargs)
        return []

    monkeypatch.setattr(Diag, "construir_diagnosticos", _diagnostico_espia)
    await _correr({"procesos": {10: [7, 9]}, "maquinarias": {3: [7, 9]},
                   "skills_nativas": []}, _RepoPlanificacionEspia())

    # Lo que dice Recursos, sin el ajuste encima.
    assert visto["maq_rangos_reales"] == {3: {7}}
    assert visto["rangos_reales_por_proceso"] == {10: {7}}
    # Y el solver sí recibió el ajuste: la detección de trabas se hace con eso.
    assert solver_espia["maquinarias"][0][1] == {7, 9}


@pytest.mark.asyncio
async def test_un_plan_sin_ajustes_no_anota_ningun_proceso_como_ajustado(
        sin_base, solver_espia, monkeypatch):
    import backend.application.DiagnosticoPlanificacion as Diag
    visto = {}
    monkeypatch.setattr(Diag, "construir_diagnosticos",
                        lambda *a, **k: (visto.update(k), [])[1])
    await _correr(None, _RepoPlanificacionEspia())

    assert visto["rangos_reales_por_proceso"] == {}
    assert visto["maq_rangos_reales"] == {3: {7}}


# --- (d) la preparación a la que el ajuste no le cambia nada ----------------

def test_una_preparacion_sin_rango_avisa_que_el_ajuste_puede_no_servir():
    """Es el único aviso que estrena el botón nuevo con rangos propuestos.

    A una preparación el solver le pisa los rangos con los del trabajo que prepara, así
    que el ajuste puede no mover una coma y el que lo apretó se queda creyendo que
    destrabó algo. La misma advertencia que ya lleva el aviso de máquina incompatible.
    """
    diags = construir_diagnosticos(
        [_tupla(10, "PREPARACION DE FRESADORA", [], "FRESADORA")],
        [(1, OFICIAL)], [(3, {OFICIAL}, "FRESADORA 1", "F1")], [], RANGOS, QUIEN)
    d = next(x for x in diags if x["tipo"] == "proceso_sin_rango")
    assert "es una preparación" in d["detalle"]
    # Y sigue proponiendo los rangos: se avisa, no se esconde el arreglo.
    assert d["soluciones"][0]["objetivo"]["rangos"] == [OFICIAL]


def test_un_proceso_comun_sin_rango_no_lleva_esa_advertencia():
    diags = construir_diagnosticos(
        [_tupla(10, "FRESADO EN FRESADORA", [], "FRESADORA")],
        [(1, OFICIAL)], [(3, {OFICIAL}, "FRESADORA 1", "F1")], [], RANGOS, QUIEN)
    d = next(x for x in diags if x["tipo"] == "proceso_sin_rango")
    assert "preparación" not in d["detalle"]


def test_el_rango_ajustado_no_se_cuela_por_el_cruce_proceso_maquina():
    """El tercer camino por el que el ajuste se colaba en el botón que guarda.

    El aviso de rango incompatible ofrece «ponele al proceso el rango que la máquina ya
    acepta». Ese «ya acepta» salía de los rangos de la máquina CON el ajuste encima, así
    que la frase prometía un rango que en Recursos no está y el botón lo dejaba cargado
    para siempre en el proceso. El texto y lo que se guarda tienen que hablar los dos de
    lo que dice Recursos.
    """
    procesos = [_tupla(10, "FRESADO EN FRESADORA", [CNC], "FRESADORA")]
    # La máquina tiene OFICIAL guardado; MEDIO OFICIAL se lo puso un ajuste de este plan.
    maquinarias = [(3, {OFICIAL, MEDIO}, "FRESADORA 1", "F1")]
    resultados = [{"orden_id": 1, "secuencia": 1, "usa_maquina": True, "id_maquinaria": None}]
    # Alguien que pueda usar la máquina, o esta solución ni se ofrece.
    operarios = [(1, OFICIAL)]

    diags = construir_diagnosticos(
        procesos, operarios, maquinarias, resultados, RANGOS, QUIEN,
        maq_rangos_reales={3: {OFICIAL}})
    accion = _accion_de(diags, "maquina_incompatible", "proceso")

    assert accion["objetivos"][0]["rangos"] == [OFICIAL, CNC]
    assert MEDIO not in accion["objetivos"][0]["rangos"], \
        "el rango ajustado se coló por el cruce y se guardaría en el proceso"
    d = next(x for x in diags if x["tipo"] == "maquina_incompatible")
    texto = next(s["texto"] for s in d["soluciones"]
                 if (s.get("accion") or {}).get("tipo") == "proceso")
    assert "MEDIO OFICIAL" not in texto, "el texto promete un rango que Recursos no tiene"


def test_sin_ajustes_el_cruce_proceso_maquina_sale_igual_que_siempre():
    procesos = [_tupla(10, "FRESADO EN FRESADORA", [CNC], "FRESADORA")]
    maquinarias = [(3, {OFICIAL, MEDIO}, "FRESADORA 1", "F1")]
    resultados = [{"orden_id": 1, "secuencia": 1, "usa_maquina": True, "id_maquinaria": None}]

    accion = _accion_de(
        construir_diagnosticos(procesos, [(1, OFICIAL)], maquinarias, resultados,
                               RANGOS, QUIEN),
        "maquina_incompatible", "proceso")
    assert accion["objetivos"][0]["rangos"] == [MEDIO, OFICIAL, CNC]
