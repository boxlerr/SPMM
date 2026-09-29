"""
Lo que pidió Lucas en la reunión del 29/9/2026 sobre el planificador, con el plan de las
48 OT del piloto en pantalla:

  7. «¿por qué pone a Matías a soldar si el soldador es Nahuel?» — la preparación de la
     soldadora heredaba el RANGO de la soldadura pero no la habilidad cargada a mano, y
     preparación y soldadura van con la misma persona;
  8. «preparación de torno va con torno seguido» — preparaba a las 07:20 y torneaba a las
     14:45, o al otro día;
  9. «esta orden hay que empezarla y terminarla» — el plan arrancaba todas las OT a la
     vez y las dejaba esperando: sólo 2 de 48 iban de corrido;
 10-12. «este roscado no se hace en el torno» — «No necesita» elegido a mano, guardado en
     el paso y recordado para el producto.
"""
from datetime import datetime

import pytest
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as PS
from backend.application.PlanificacionService import (
    _crear_variables_y_dominios,
    _partir_y_heredar,
    _preparaciones_pegadas,
    _setup_hereda_de,
    familia_requerida_from_proceso,
)
from backend.scripts.importar_ot_legacy import filas_a_insertar

LUNES = datetime(2026, 9, 28, 7, 0)
VENCIDA = datetime(2026, 9, 1)
OFICIAL, MEDIO_OFICIAL = 6, 4


def _cal(*ops):
    return {o: {"dias": {0, 1, 2, 3, 4}, "desde": 0, "hasta": PS.MIN_LABORAL_DIA,
                "desde_sab": 0, "hasta_sab": PS.MIN_LABORAL_SABADO} for o in ops}


def _paso(ot, sec, minutos, nombre, rangos, proc=100, usa_maquina=None):
    usa = PS.proceso_usa_maquina(nombre) if usa_maquina is None else usa_maquina
    fam = familia_requerida_from_proceso(nombre) if usa else ""
    return (ot, proc, sec, VENCIDA, "normal", minutos, list(rangos), nombre, usa, fam, {})


def _resolver(procesos, operarios, maquinas=(), manuales=None):
    ops = sorted({o for o, _r in operarios})
    resultados, _ = PS._resolver_planificacion(
        procesos, list(operarios), list(maquinas), None, None, {}, {}, {}, {}, set(),
        manuales or {}, _cal(*ops), [], {}, {}, None, LUNES)
    return {(r["orden_id"], r["secuencia"]): r for r in resultados if not r.get("slot_extra")}


@pytest.fixture
def solver_rapido(monkeypatch):
    monkeypatch.setenv("SOLVER_TECHO_SEG", "20")
    monkeypatch.setenv("SOLVER_CORTE_SIN_MEJORA_SEG", "3")
    monkeypatch.setenv("SOLVER_WORKERS", "4")


# ── 8. preparación y trabajo, seguidos ──────────────────────────────────────
def _pn(pasos):
    return [(1, 600 + s, s, None, 5, 30, [OFICIAL], n, True, familia_requerida_from_proceso(n), {})
            for s, n in pasos]


def test_solo_se_pegan_la_preparacion_y_el_trabajo_que_van_uno_detras_del_otro():
    assert _preparaciones_pegadas(_pn([(1, "PREPARACION DE TORNO"), (2, "TORNEADO")])) == [((1, 1), (1, 2))]
    # Con un paso en el medio, «seguido» es imposible: ese paso va entre los dos.
    assert _preparaciones_pegadas(_pn([(1, "PREPARACION DE TORNO"), (2, "CONTROL DE MEDIDAS"), (3, "TORNEADO")])) == []


def test_el_trabajo_arranca_cuando_termina_de_prepararse_la_maquina(solver_rapido):
    """Una persona, un torno. La OT 2 (un control de 90 min) podría meterse entre la
    preparación y el torneado de la OT 1: no puede."""
    torno = [(1, {OFICIAL}, "TORNO 1", "TORY-1")]
    procesos = [
        _paso(1, 1, 40, "PREPARACION DE TORNO", [OFICIAL], proc=105),
        _paso(1, 2, 120, "TORNEADO", [OFICIAL], proc=151),
        _paso(2, 1, 90, "CONTROL DE MEDIDAS", [OFICIAL], proc=30),
    ]
    res = _resolver(procesos, [(10, OFICIAL)], torno)
    prep, torneado = res[(1, 1)], res[(1, 2)]
    assert torneado["inicio_min"] == prep["fin_min"], (prep, torneado)
    assert prep["id_maquinaria"] == torneado["id_maquinaria"] == 1


# ── 7. el que hace el trabajo a mano también lo prepara ─────────────────────
def test_quien_suelda_por_habilidad_cargada_a_mano_tambien_prepara_la_soldadora():
    """Nahuel (MEDIO OFICIAL) suelda con MIG porque se lo cargaron a mano. La preparación
    hereda el rango OFICIAL de la soldadura: sin heredar también su habilidad manual, no
    podía prepararla y el par entero se iba a un oficial."""
    NAHUEL, MATIAS = 49, 37
    pn = [
        (1, 103, 1, None, 5, 40, [MEDIO_OFICIAL], "PREPARACION DE SOLDADORA MIG", True, "SOLDADORA_MIG", {}),
        (1, 138, 2, None, 5, 60, [OFICIAL], "SOLDADURA CON MIG", True, "SOLDADORA_MIG", {}),
    ]
    procesos, _c, _pm, _po, partes = _partir_y_heredar(pn)
    setup_de = _setup_hereda_de(procesos, partes)
    assert list(setup_de.values()) == [138]
    maquinas = [(23, {OFICIAL, MEDIO_OFICIAL}, "SOLDADORA MIG/MAG 450 1", "SM450-1")]
    operarios = [(NAHUEL, MEDIO_OFICIAL), (MATIAS, OFICIAL)]
    PS.H = 100_000

    def dominio(con_herencia):
        salida = _crear_variables_y_dominios(
            cp_model.CpModel(), procesos, operarios, maquinas, set(), set(),
            skills_manuales={138: {NAHUEL}}, setup_de=setup_de if con_herencia else None)
        op_dom = salida[13]
        clave_prep = next(k for k in op_dom if k[1] // 1000 == 1)
        return set(op_dom[clave_prep]) - {999999}

    assert NAHUEL not in dominio(False), "así era: la preparación sólo para oficiales"
    assert dominio(True) == {NAHUEL, MATIAS}


def test_nahuel_prepara_y_suelda(solver_rapido):
    NAHUEL, MATIAS = 49, 37
    maquinas = [(23, {OFICIAL, MEDIO_OFICIAL}, "SOLDADORA MIG/MAG 450 1", "SM450-1")]
    procesos = [
        (1, 103, 1, VENCIDA, "normal", 40, [MEDIO_OFICIAL], "PREPARACION DE SOLDADORA MIG", True, "SOLDADORA_MIG",
         {NAHUEL: (1, 0)}),
        (1, 138, 2, VENCIDA, "normal", 60, [OFICIAL], "SOLDADURA CON MIG", True, "SOLDADORA_MIG",
         {NAHUEL: (1, 0), MATIAS: (2, 0)}),
    ]
    res = _resolver(procesos, [(NAHUEL, MEDIO_OFICIAL), (MATIAS, OFICIAL)], maquinas,
                    manuales={138: {NAHUEL}})
    assert res[(1, 1)]["id_operario"] == res[(1, 2)]["id_operario"] == NAHUEL


# ── 9. cada OT de corrido ────────────────────────────────────────────────────
def _ot_que_espera():
    """Dos personas: A (OFICIAL) y B (MEDIO OFICIAL). La OT 1 tiene un paso de A y uno de
    B; la OT 2, un paso largo de B. Todo vencido."""
    return [
        _paso(1, 1, 60, "ARMADO", [OFICIAL], proc=201, usa_maquina=False),
        _paso(1, 2, 60, "ENSAMBLAJE", [MEDIO_OFICIAL], proc=202, usa_maquina=False),
        _paso(2, 1, 120, "ENSAMBLAJE", [MEDIO_OFICIAL], proc=202, usa_maquina=False),
    ]


def test_la_ot_no_queda_esperando(solver_rapido):
    """Cobrando el atraso paso por paso, A hacía su paso a primera hora y la OT 1 esperaba
    a que B terminara la OT 2. De corrido, el paso de A se corre para que el de B lo siga."""
    res = _resolver(_ot_que_espera(), [(10, OFICIAL), (11, MEDIO_OFICIAL)])
    assert res[(1, 2)]["inicio_min"] == res[(1, 1)]["fin_min"], res
    assert not any(r["excedente"] or r["sin_asignar"] for r in res.values())


def test_sin_ot_de_corrido_vuelve_lo_de_antes(solver_rapido, monkeypatch):
    """La llave para la opción flexible que va a venir después."""
    monkeypatch.setattr(PS, "OT_DE_CORRIDO", False)
    res = _resolver(_ot_que_espera(), [(10, OFICIAL), (11, MEDIO_OFICIAL)])
    assert res[(1, 2)]["inicio_min"] > res[(1, 1)]["fin_min"], res


# ── 11. la memoria por artículo en el importador ────────────────────────────
def test_el_importador_copia_lo_que_se_decidio_para_el_producto():
    lista = [(1, "TORNEADO", 120), (2, "ROSCADO", 30)]
    ids = {"TORNEADO": 151, "ROSCADO": 131}
    assert [f[4] for f in filas_a_insertar(9, lista, ids, set(), {131: 1})] == [0, 1]
    assert [f[4] for f in filas_a_insertar(9, lista, ids, set(), {131: 0})] == [0, 0]
    # Lo que va a mano siempre, va a mano aunque el producto diga otra cosa.
    assert [f[4] for f in filas_a_insertar(9, lista, ids, {"TORNEADO"}, {151: 0})] == [1, 0]
    assert [f[4] for f in filas_a_insertar(9, lista, ids, set())] == [0, 0]


# ── 10-12. «No necesita» desde el plan, para el paso y para el producto ─────
async def _seed_dos_ot_del_mismo_producto(session):
    from backend.domain.Articulo import Articulo
    from backend.domain.Cliente import Cliente
    from backend.domain.EstadoProceso import EstadoProceso
    from backend.domain.Maquinaria import Maquinaria
    from backend.domain.OrdenTrabajo import OrdenTrabajo
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
    from backend.domain.Prioridad import Prioridad
    from backend.domain.Proceso import Proceso
    from backend.domain.Sector import Sector

    session.add_all([
        Cliente(id=1, nombre="LOURDES"), Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="CLLCE040", descripcion="Eje de mando", abreviatura="EJE"),
        Articulo(id=2, cod_articulo="OTRO", descripcion="Otro", abreviatura="OT"),
        Proceso(id=131, nombre="ROSCADO"), Proceso(id=151, nombre="TORNEADO"),
        Maquinaria(id=1, nombre="TORNO 1"),
        EstadoProceso(id=1, descripcion="Pendiente"), EstadoProceso(id=3, descripcion="Finalizado"),
    ])
    await session.commit()
    for ot, numero, articulo, cerrada in ((1, 15668, 1, 0), (2, 15700, 1, 0), (3, 15000, 1, 1), (4, 15701, 2, 0)):
        session.add(OrdenTrabajo(id=ot, id_otvieja=numero, id_prioridad=1, id_sector=1, id_articulo=articulo,
                                 id_cliente=1, unidades=1, fecha_orden=datetime(2026, 9, ot),
                                 fecha_entrada=datetime(2026, 9, ot), fecha_prometida=datetime(2026, 10, 2),
                                 finalizadototal=cerrada))
    await session.commit()
    for i, (ot, proc, estado) in enumerate(((1, 131, 1), (1, 151, 1), (2, 131, 1), (3, 131, 1), (4, 131, 1)), start=1):
        session.add(OrdenTrabajoProceso(id=i, id_orden_trabajo=ot, id_proceso=proc, orden=i, id_estado=estado,
                                        tiempo_proceso=30, cant_operarios=1, id_maquinaria=1))
    await session.commit()


async def _va_a_mano(session):
    from sqlalchemy import select
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
    session.expire_all()
    filas = (await session.execute(select(OrdenTrabajoProceso))).scalars().all()
    return {f.id: (f.no_lleva_maquina, f.id_maquinaria) for f in filas}


@pytest.mark.asyncio
async def test_no_necesita_se_guarda_en_el_paso_y_en_el_producto(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed_dos_ot_del_mismo_producto(session)
    resp = await OrdenTrabajoService(session).editarProceso(
        1, 1, {"no_lleva_maquina": True, "para_el_articulo": True})
    assert resp.data["otras_del_articulo"] == 1
    estado = await _va_a_mano(session)
    assert estado[1] == (1, None), "el paso: va a mano y sin máquina"
    assert estado[3] == (1, None), "el mismo proceso en la otra OT ABIERTA del producto"
    assert estado[2] == (0, 1), "otro proceso de la misma OT no se toca"
    assert estado[4] == (0, 1), "la OT cerrada no se toca: es historia"
    assert estado[5] == (0, 1), "otro producto no se toca"


@pytest.mark.asyncio
async def test_volver_a_llevar_maquina_tambien_se_recuerda(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed_dos_ot_del_mismo_producto(session)
    servicio = OrdenTrabajoService(session)
    await servicio.editarProceso(1, 1, {"no_lleva_maquina": True, "para_el_articulo": True})
    await servicio.editarProceso(1, 1, {"no_lleva_maquina": False, "para_el_articulo": True})
    estado = await _va_a_mano(session)
    assert estado[1][0] == 0 and estado[3][0] == 0


@pytest.mark.asyncio
async def test_sin_para_el_articulo_solo_cambia_el_paso(session):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    await _seed_dos_ot_del_mismo_producto(session)
    resp = await OrdenTrabajoService(session).editarProceso(1, 1, {"no_lleva_maquina": True})
    assert resp.data["otras_del_articulo"] == 0
    estado = await _va_a_mano(session)
    assert estado[1][0] == 1 and estado[3][0] == 0
