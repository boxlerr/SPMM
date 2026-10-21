"""
Los recursos del taller para organizar la producción con una IA (Lucas, 21/10/2026):
«recursos humanos: empleados disponibles; habilidades de cada uno; horas de trabajo por
día; días de trabajo por semana. Recursos de maquinaria: máquinas disponibles; procesos
que puede realizar cada máquina; horas y días de disponibilidad.»

Lo que se prueba es que el archivo diga lo MISMO que mira el planificador:

  · las horas de cada persona con su horario, efectivas (sin desayuno ni almuerzo), y el
    sábado sólo si lo trabaja;
  · los procesos de cada máquina: los cargados en Recursos y, si no hay, los que el
    planificador deduce del nombre y del tipo, con el cruce de rangos;
  · quién puede usar cada máquina (su rango la habilita);
  · las ausencias cargadas que siguen o vienen, y los feriados con lo que eligió el taller.
"""
from datetime import date, datetime, time

import pytest
from sqlalchemy import text

import backend.application.RecursosService as RS
from backend.domain.AusenciaOperario import AusenciaOperario
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Operario import Operario
from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
from backend.domain.OperarioRango import OperarioRango
from backend.domain.Proceso import Proceso
from backend.domain.ProcesoMaquinaria import ProcesoMaquinaria
from backend.domain.Rango import Rango
from backend.domain.RangoMaquinaria import RangoMaquinaria
from backend.domain.RangoProceso import RangoProceso

HOY = date(2026, 10, 21)  # miércoles
OFICIAL, MEDIO = 6, 7
ALEJANDRO, MARTA, VACANTE = 34, 35, 17
FRESADO, TORNEADO, SOLDADURA, ARMADO = 68, 151, 20, 10
FRESADORA, TORNO, SOLDADORA = 1, 2, 3
L_A_V = "MON,TUE,WED,THU,FRI"


@pytest.fixture(autouse=True)
def reloj(monkeypatch):
    monkeypatch.setattr(RS, "ahora_ar", lambda: datetime(2026, 10, 21, 10, 0))


async def _sembrar(s):
    # La tabla de feriados la crea una migración (no es un modelo): la de los tests.
    await s.execute(text(
        "CREATE TABLE feriado (fecha DATE PRIMARY KEY, nombre VARCHAR(200) NOT NULL, "
        "tipo VARCHAR(20) NOT NULL, se_trabaja BOOLEAN, decidido_por VARCHAR(120), "
        "decidido_en TIMESTAMP, traido_en TIMESTAMP NOT NULL)"))
    for fecha, nombre, tipo, se_trabaja in (
        ("2026-10-12", "Ya pasó", "trasladable", None),
        ("2026-11-09", "Visita del Papa", "inamovible", None),
        ("2026-11-23", "Día de la Soberanía", "trasladable", True),
        ("2026-12-07", "Puente turístico", "puente", None),
        ("2027-01-01", "Año nuevo (más de 60 días)", "inamovible", None),
    ):
        await s.execute(text(
            "INSERT INTO feriado (fecha, nombre, tipo, se_trabaja, traido_en) "
            "VALUES (:f, :n, :t, :s, :a)"),
            {"f": fecha, "n": nombre, "t": tipo, "s": se_trabaja, "a": datetime(2026, 10, 17)})

    s.add_all([
        Rango(id=OFICIAL, nombre="OFICIAL"), Rango(id=MEDIO, nombre="MEDIO OFICIAL"),
        Proceso(id=FRESADO, nombre="FRESADO CONVENCIONAL"), Proceso(id=TORNEADO, nombre="TORNEADO"),
        Proceso(id=SOLDADURA, nombre="SOLDADURA CON MIG"), Proceso(id=ARMADO, nombre="ARMADO"),
        Operario(id=ALEJANDRO, nombre="ALEJANDRO", apellido="GUTIERREZ", categoria="OFICIAL",
                 disponible=True, hora_inicio=time(7), hora_fin=time(16), dias_trabajo=L_A_V),
        # Entra a las 9 y trabaja los sábados.
        Operario(id=MARTA, nombre="MARTA", apellido="DIAZ", categoria="MEDIO OFICIAL",
                 disponible=True, hora_inicio=time(9), hora_fin=time(16),
                 dias_trabajo=L_A_V + ",SAT"),
        Operario(id=VACANTE, nombre="VACANTE OFICIAL", apellido="A CUBRIR", categoria="OFICIAL",
                 disponible=False, hora_inicio=time(7), hora_fin=time(16), dias_trabajo=L_A_V),
        Maquinaria(id=FRESADORA, nombre="FRESADORA 1", cod_maquina="F1", tipo="FRESADORA"),
        Maquinaria(id=TORNO, nombre="TORNO 1", cod_maquina="T1", tipo="TORNO"),
        Maquinaria(id=SOLDADORA, nombre="SOLDADORA MIG", cod_maquina="S1", tipo="SOLDADORA_MIG",
                   estado_operativo="en_mantenimiento"),
    ])
    await s.flush()
    s.add_all([
        OperarioRango(id_operario=ALEJANDRO, id_rango=OFICIAL),
        OperarioRango(id_operario=MARTA, id_rango=MEDIO),
        OperarioRango(id_operario=VACANTE, id_rango=OFICIAL),
        RangoProceso(id_rango=OFICIAL, id_proceso=FRESADO),
        RangoProceso(id_rango=OFICIAL, id_proceso=TORNEADO),
        RangoProceso(id_rango=MEDIO, id_proceso=TORNEADO),
        RangoProceso(id_rango=MEDIO, id_proceso=SOLDADURA),
        RangoMaquinaria(id_rango=OFICIAL, id_maquinaria=FRESADORA),
        RangoMaquinaria(id_rango=OFICIAL, id_maquinaria=TORNO),
        RangoMaquinaria(id_rango=MEDIO, id_maquinaria=TORNO),
        RangoMaquinaria(id_rango=MEDIO, id_maquinaria=SOLDADORA),
        # La soldadura está cargada en Recursos; el resto lo deduce el planificador.
        ProcesoMaquinaria(id_proceso=SOLDADURA, id_maquinaria=SOLDADORA),
        OperarioProcesoSkill(id_operario=ALEJANDRO, id_proceso=FRESADO, nivel=1, orden=0),
        OperarioProcesoSkill(id_operario=MARTA, id_proceso=TORNEADO, nivel=2, orden=0),
        # Ausencias: unas vacaciones que vienen, una que ya pasó, una muy lejos y un
        # «Ausente» apretado y deshecho el mismo día (cero días).
        AusenciaOperario(id_operario=MARTA, desde=date(2026, 10, 26), vuelve=date(2026, 10, 31),
                         motivo="VACACIONES", origen="CARGA", cargada_en=datetime(2026, 10, 20)),
        AusenciaOperario(id_operario=ALEJANDRO, desde=date(2026, 10, 1), vuelve=date(2026, 10, 3),
                         motivo="ENFERMEDAD", origen="CARGA", cargada_en=datetime(2026, 10, 1)),
        AusenciaOperario(id_operario=ALEJANDRO, desde=date(2027, 2, 1), vuelve=date(2027, 2, 15),
                         motivo="VACACIONES", origen="CARGA", cargada_en=datetime(2026, 10, 20)),
        AusenciaOperario(id_operario=ALEJANDRO, desde=date(2026, 10, 22), vuelve=date(2026, 10, 22),
                         origen="ESTADO", cargada_en=datetime(2026, 10, 20)),
    ])
    await s.commit()


@pytest.mark.asyncio
async def test_las_personas_con_sus_horas_como_las_cuenta_el_planificador(session):
    await _sembrar(session)
    r = await RS.armar_recursos(session)
    personas = {p["nombre"]: p for p in r["personas"]}
    # Los «VACANTE … A CUBRIR» son puestos, no personas.
    assert set(personas) == {"ALEJANDRO GUTIERREZ", "MARTA DIAZ"}

    ale = personas["ALEJANDRO GUTIERREZ"]
    # 07:00 a 16:00 son 9 horas de reloj; efectivas, sin desayuno ni almuerzo, 8,25.
    assert (ale["dias"], ale["dias_por_semana"], ale["horas_por_dia"], ale["horas_sabado"],
            ale["horas_por_semana"]) == (["lun", "mar", "mié", "jue", "vie"], 5, 8.25, None, 41.25)
    assert ale["horario"] == "07:00 a 16:00, lun a vie"
    assert [h["prioridad"] for h in ale["habilidades"]] == ["SKILL 1", "Sabe (sin marcar)"]
    # Las ausencias pasadas, las de más de 60 días y las de cero días no van.
    assert ale["ausencias"] == []

    marta = personas["MARTA DIAZ"]
    # Entra a las 9: pierde 07:00–09:00 (120 min) → 6,25 por día; el sábado de 09:00 a 12:00.
    assert (marta["dias_por_semana"], marta["horas_por_dia"], marta["horas_sabado"],
            marta["horas_por_semana"]) == (6, 6.25, 3.0, 6.25 * 5 + 3)
    assert marta["ausencias"] == [{"desde": "2026-10-26", "hasta": "2026-10-30", "motivo": "Vacaciones"}]

    assert r["resumen"] == {"personas": 2, "horas_por_semana": 41.25 + 34.25, "maquinas": 3,
                            "maquinas_disponibles": 2}
    assert r["jornada"]["horas_por_dia"] == 8.25 and r["jornada"]["sabado_con_gente"] is True
    assert "07:00–09:00, 09:15–12:00 y 12:30–16:00" in r["jornada"]["texto"]


@pytest.mark.asyncio
async def test_las_maquinas_con_los_procesos_que_les_da_el_planificador(session):
    await _sembrar(session)
    r = await RS.armar_recursos(session)
    maquinas = {m["nombre"]: m for m in r["maquinas"]}
    assert set(maquinas) == {"FRESADORA 1", "TORNO 1", "SOLDADORA MIG"}

    # Sin procesos cargados en Recursos: los deduce del nombre y del tipo, como el solver.
    assert maquinas["FRESADORA 1"]["procesos"] == ["FRESADO CONVENCIONAL"]
    assert maquinas["TORNO 1"]["procesos"] == ["TORNEADO"]
    # Cargado: el de Recursos. El armado va a mano: no está en ninguna máquina.
    assert maquinas["SOLDADORA MIG"]["procesos"] == ["SOLDADURA CON MIG"]

    # Quién la puede usar: las personas con un rango que la habilita (el vacante no).
    assert maquinas["FRESADORA 1"]["personas"] == ["ALEJANDRO GUTIERREZ"]
    assert maquinas["TORNO 1"]["personas"] == ["ALEJANDRO GUTIERREZ", "MARTA DIAZ"]
    assert maquinas["SOLDADORA MIG"]["personas"] == ["MARTA DIAZ"]

    # El estado es informativo (el planificador no lo mira), pero va.
    assert (maquinas["SOLDADORA MIG"]["estado"], maquinas["SOLDADORA MIG"]["disponible"]) == (
        "En mantenimiento", False)
    assert (maquinas["TORNO 1"]["estado"], maquinas["TORNO 1"]["disponible"]) == ("Operativa", True)
    assert (maquinas["TORNO 1"]["tipo"], maquinas["SOLDADORA MIG"]["tipo"]) == ("Torno", "Soldadora MIG/MAG")


@pytest.mark.asyncio
async def test_los_feriados_que_vienen_con_lo_que_eligio_el_taller(session):
    await _sembrar(session)
    r = await RS.armar_recursos(session)
    assert [(f["fecha"], f["se_trabaja"], f["texto"]) for f in r["feriados"]] == [
        ("2026-11-09", False, "No se trabaja (nadie eligió otra cosa)"),
        ("2026-11-23", True, "Se trabaja"),
        # Un día no laborable sin elegir no bloquea: el planificador lo trabaja.
        ("2026-12-07", True, "Se trabaja (día no laborable: nadie eligió otra cosa)"),
    ]
    assert r["hasta"] == "2026-12-20"


@pytest.mark.asyncio
async def test_lee_los_operarios_una_sola_vez(session, monkeypatch):
    """El equipo y el horario salen de la misma lectura de operarios."""
    await _sembrar(session)
    from backend.infrastructure.OperarioRepository import OperarioRepository
    llamadas = []
    original = OperarioRepository.find_all

    async def contar(self):
        llamadas.append(1)
        return await original(self)

    monkeypatch.setattr(OperarioRepository, "find_all", contar)
    await RS.armar_recursos(session)
    assert len(llamadas) == 1


def test_capacidad_sin_sabado_y_con_domingo_cargado():
    """El domingo no existe en la línea de tiempo del planificador: no suma."""
    cal = {"dias": {0, 1, 2, 3, 4, 6}, "desde": 0, "hasta": 495, "desde_sab": 0, "hasta_sab": 300}
    assert RS.capacidad(cal) == {"dias": ["lun", "mar", "mié", "jue", "vie"], "dias_por_semana": 5,
                                 "horas_por_dia": 8.25, "horas_sabado": None, "horas_por_semana": 41.25}
