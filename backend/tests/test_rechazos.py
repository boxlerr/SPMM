"""Los rechazos: cargar una no conformidad de cualquier tipo desde donde pasa (RF-12).

Reunión con Lucas, 23/09: «si algo se rechazó, que quede el registro de que tuviste 10
piezas que se rechazaron. Entonces, ¿quién la hizo? Tal empleado. Le tengo que llamar
la atención … Y no conformidad es lo mismo». La tabla `incidencia_proceso` ya era el
registro de no conformidades (test_no_conformidades.py); lo que faltaba era poder
CARGAR cualquier tipo, desde la OT, diciendo en qué paso, cuántas de cuántas, quién
hizo las piezas y qué se hace con lo rechazado; y después verlo en la OT, en la ficha
de la persona y agrupado por persona.

Lo que persigue este archivo son las formas en que ese registro deja de servir:

  1. **Que no se pueda cargar lo que pasó.** Todos los tipos de la lista se guardan, y
     los que ya estaban guardados siguen existiendo (hay filas con esas claves).
  2. **Que las piezas mientan.** Un «-10» es un 10 mal tipeado: guardarlo como 0 dice
     «ninguna». Y 12 rechazadas de 10 controladas no es un dato, es un error.
  3. **Que «quién la hizo» apunte a nadie** (una persona que no existe) o que el paso
     sea de otra orden.
  4. **Que no aparezca donde se la busca**: en su OT, en la ficha de la persona y en el
     agrupado por persona, con los mismos números.
  5. **Que la sugerencia de quién hizo el paso invente**: sale de la misma regla que
     los tiempos de RF-06 (elegida a mano en la OT, o el ÚLTIMO plan), y quien carga la
     puede cambiar.
"""
import csv
import io
from datetime import datetime, time, timedelta

import pytest
from sqlalchemy import select

from backend.application.IncidenciaProcesoService import (
    DISPOSICIONES,
    TIPO_DEL_FORMULARIO,
    TIPOS,
    IncidenciaProcesoService,
)
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Planificacion import Planificacion
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.dto.IncidenciaProcesoRequestDTO import (
    CerrarIncidenciaDTO,
    IncidenciaProcesoRequestDTO,
    IncidenciaProcesoUpdateDTO,
)

LUCAS = {"id_usuario": 4, "username": "lucas", "nombre": "Lucas", "apellido": "Gómez"}

JUAN, ANA, PEDRO = 1, 2, 3


async def _taller(session):
    """Dos OT (7010 y 7011), tres personas y los pasos de la 7010:

      paso 1  CORTE   (id_otp 101)  Ana elegida a mano en la OT
      paso 2  TORNO   (id_otp 102)  sin elegir; el plan viejo decía Pedro, el último Juan
      paso 3  TORNO   (id_otp 103)  sin elegir y sin plan (el mismo proceso, otra pasada)
    """
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja de acero", abreviatura="BAND"),
        Cliente(id=1, nombre="ACME SRL"),
        Proceso(id=10, nombre="CORTE"),
        Proceso(id=20, nombre="TORNO CNC"),
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=2, descripcion="En proceso"),
        EstadoProceso(id=3, descripcion="Terminado"),
    ])
    for id_, nombre, apellido in ((JUAN, "Juan", "Perez"), (ANA, "Ana", "Díaz"), (PEDRO, "Pedro", "Sosa")):
        session.add(Operario(id=id_, nombre=nombre, apellido=apellido, categoria="OFICIAL",
                             hora_inicio=time(7, 0), hora_fin=time(16, 0)))
    for id_ot in (10, 11):
        session.add(OrdenTrabajo(
            id=id_ot, id_otvieja=7000 + id_ot, id_prioridad=1, id_sector=1, id_articulo=1,
            id_cliente=1, unidades=50, fecha_orden=datetime(2026, 9, 1),
            fecha_entrada=datetime(2026, 9, 1), fecha_prometida=datetime(2026, 10, 1),
            finalizadototal=0,
        ))
    await session.flush()
    session.add_all([
        OrdenTrabajoProceso(id=101, id_orden_trabajo=10, id_proceso=10, orden=1, id_operario=ANA),
        OrdenTrabajoProceso(id=102, id_orden_trabajo=10, id_proceso=20, orden=2),
        OrdenTrabajoProceso(id=103, id_orden_trabajo=10, id_proceso=20, orden=3),
        OrdenTrabajoProceso(id=201, id_orden_trabajo=11, id_proceso=20, orden=1),
    ])
    # Dos planes para el paso 2: el viejo (Pedro) y el último (Juan). Manda el último.
    viejo, nuevo = "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"
    for id_, persona, lote, cuando in ((1, PEDRO, viejo, datetime(2026, 9, 10)),
                                       (2, JUAN, nuevo, datetime(2026, 9, 20))):
        session.add(Planificacion(
            id=id_, orden_id=10, proceso_id=20, id_orden_trabajo_proceso=102,
            id_operario=persona, inicio_min=0, fin_min=60, duracion_min=60, prioridad_peso=1,
            id_planificacion_lote=lote, creado_en=cuando,
        ))
    await session.commit()


def _rechazo(**extra) -> IncidenciaProcesoRequestDTO:
    datos = dict(id_orden_trabajo=10, tipo="RECHAZO_CONTROL")
    datos.update(extra)
    return IncidenciaProcesoRequestDTO(**datos)


async def _filas(session) -> list[IncidenciaProceso]:
    return (await session.execute(select(IncidenciaProceso).order_by(IncidenciaProceso.id))).scalars().all()


# ─────────────────────── 1. de cualquier tipo ───────────────────────

@pytest.mark.parametrize("tipo", list(TIPOS))
async def test_se_carga_de_cualquier_tipo(session, tipo):
    await _taller(session)
    r = await IncidenciaProcesoService(session).registrar(
        _rechazo(tipo=tipo, piezas_afectadas=1), LUCAS)
    assert r.data["tipo"] == tipo


def test_estan_los_de_un_taller_metalurgico_y_no_se_borro_ninguno():
    """Los que pidió Julián, y los de antes: hay filas guardadas con esas claves y un
    tipo que desaparece de la lista deja esas filas sin nombre en pantalla."""
    for nuevo in ("RECHAZO_CONTROL", "SOLDADURA", "MECANIZADO", "CORTE_PLEGADO"):
        assert nuevo in TIPOS, nuevo
    for viejo in ("INTERPRETACION_PLANOS", "MEDIDA_FUERA_DE_TOLERANCIA", "MATERIAL_NO_CONFORME",
                  "TERMINACION", "DOCUMENTACION", "OTRO"):
        assert viejo in TIPOS, viejo
    assert TIPOS["RECHAZO_CONTROL"] == "Pieza rechazada en control"
    assert list(TIPOS)[-1] == "OTRO", "«Otro» va al final de la lista"
    assert TIPO_DEL_FORMULARIO in TIPOS
    # Las claves entran en la columna (VARCHAR(50)).
    assert all(len(k) <= 50 for k in TIPOS)
    assert all(len(k) <= 30 for k in DISPOSICIONES)


async def test_el_rechazo_completo_queda_como_se_cargo(session):
    """El caso de Lucas: 10 piezas rechazadas de 50, en el torno, las hizo Juan, se
    retrabajan. Quién la registró y cuándo salen solos."""
    await _taller(session)
    r = await IncidenciaProcesoService(session).registrar(_rechazo(
        id_otp=102, piezas_afectadas=10, piezas_controladas=50, id_operario=JUAN,
        gravedad="MEDIA", disposicion="retrabajo", descripcion="Diámetro pasado 0,2 mm",
    ), LUCAS)

    (nc,) = await _filas(session)
    assert (nc.piezas_afectadas, nc.piezas_controladas) == (10, 50)
    assert nc.id_otp == 102
    assert nc.id_proceso == 20, "el proceso sale del paso"
    assert nc.id_operario == JUAN
    assert nc.disposicion == "RETRABAJO"
    assert nc.usuario == "Lucas Gómez" and nc.id_usuario == 4
    assert nc.estado == "ABIERTA"

    # La respuesta viene como una fila del reporte: la pantalla la pone en la lista al
    # toque, sin volver a pedir todo.
    assert r.data["nro_ot"] == 7010
    assert r.data["paso"] == 2
    assert r.data["proceso"] == "TORNO CNC"
    assert r.data["operario"] == "Juan Perez"


async def test_quien_la_registro_no_se_puede_mandar_en_el_cuerpo(session):
    """Sale del token. Un cuerpo que diga otro nombre no cambia nada."""
    await _taller(session)
    dto = IncidenciaProcesoRequestDTO(**{"id_orden_trabajo": 10, "tipo": "SOLDADURA",
                                         "usuario": "Otro", "id_usuario": 99,
                                         "fecha_registro": "2020-01-01T00:00:00"})
    await IncidenciaProcesoService(session).registrar(dto, LUCAS)
    (nc,) = await _filas(session)
    assert nc.usuario == "Lucas Gómez" and nc.id_usuario == 4
    assert nc.fecha_registro.year == datetime.now().year


# ─────────────────────── 2. las piezas ───────────────────────

@pytest.mark.parametrize("piezas", [
    dict(piezas_afectadas=-10),
    dict(piezas_controladas=-1),
    dict(piezas_afectadas=12, piezas_controladas=10),
])
async def test_piezas_negativas_o_mas_rechazadas_que_controladas_no_entran(session, piezas):
    await _taller(session)
    with pytest.raises(BusinessException):
        await IncidenciaProcesoService(session).registrar(_rechazo(**piezas), LUCAS)
    assert await _filas(session) == [], "no se guardó nada"


async def test_cero_piezas_y_sin_decir_cuantas_son_cosas_distintas(session):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_rechazo(piezas_afectadas=0, piezas_controladas=20), LUCAS)
    await svc.registrar(_rechazo(), LUCAS)
    cero, sin = await _filas(session)
    assert (cero.piezas_afectadas, cero.piezas_controladas) == (0, 20)
    assert (sin.piezas_afectadas, sin.piezas_controladas) == (None, None)


async def test_corregir_las_piezas_tambien_se_valida(session):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    id_nc = (await svc.registrar(_rechazo(piezas_afectadas=5, piezas_controladas=50), LUCAS)).data["id"]

    with pytest.raises(BusinessException):
        await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(piezas_afectadas=-5), LUCAS)
    # Bajar las controladas por debajo de las rechazadas que ya estaban, tampoco.
    with pytest.raises(BusinessException):
        await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(piezas_controladas=3), LUCAS)
    session.expire_all()
    (nc,) = await _filas(session)
    assert (nc.piezas_afectadas, nc.piezas_controladas) == (5, 50)

    r = await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(piezas_afectadas=8), LUCAS)
    assert (r.data["piezas_afectadas"], r.data["piezas_controladas"]) == (8, 50)


# ─────────────────────── 3. persona, paso y orden que existen ───────────────────────

async def test_quien_hizo_las_piezas_tiene_que_existir(session):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    with pytest.raises(BusinessException) as e:
        await svc.registrar(_rechazo(id_operario=999), LUCAS)
    assert "999" in str(e.value)
    assert await _filas(session) == []

    id_nc = (await svc.registrar(_rechazo(id_operario=ANA), LUCAS)).data["id"]
    with pytest.raises(BusinessException):
        await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(id_operario=999), LUCAS)
    # «No se sabe» sí vale: no se reemplaza por nadie.
    r = await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(id_operario=None), LUCAS)
    assert r.data["id_operario"] is None


async def test_el_paso_tiene_que_ser_de_esa_orden(session):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    with pytest.raises(BusinessException):
        await svc.registrar(_rechazo(id_otp=201), LUCAS)  # es de la OT 11
    with pytest.raises(BusinessException):
        await svc.registrar(_rechazo(id_otp=99999), LUCAS)
    assert await _filas(session) == []


async def test_la_orden_tiene_que_existir(session):
    await _taller(session)
    with pytest.raises(BusinessException) as e:
        await IncidenciaProcesoService(session).registrar(_rechazo(id_orden_trabajo=555), LUCAS)
    assert "555" in str(e.value)


async def test_que_se_hace_con_lo_rechazado_es_de_la_lista(session):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    with pytest.raises(BusinessException):
        await svc.registrar(_rechazo(disposicion="tirarlo"), LUCAS)
    id_nc = (await svc.registrar(_rechazo(disposicion="DESCARTE"), LUCAS)).data["id"]
    r = await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(disposicion="CONCESION"), LUCAS)
    assert r.data["disposicion"] == "CONCESION"
    # Cambiar el paso cambia el proceso.
    r = await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(id_otp=101), LUCAS)
    assert (r.data["paso"], r.data["proceso"]) == (1, "CORTE")


# ─────────────────────── 4. aparece en la OT, en la persona y por persona ───────────────────────

async def test_aparece_en_su_orden_con_las_piezas(session):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_rechazo(id_otp=102, id_operario=JUAN, piezas_afectadas=10, piezas_controladas=50), LUCAS)
    await svc.registrar(_rechazo(id_otp=101, id_operario=ANA, piezas_afectadas=2), LUCAS)
    await svc.registrar(_rechazo(id_orden_trabajo=11, piezas_afectadas=7), LUCAS)

    r = await svc.listar_por_orden(10)
    assert [(x["paso"], x["operario"]) for x in r.data["no_conformidades"]] == [
        (1, "Ana Díaz"), (2, "Juan Perez")]
    resumen = r.data["resumen"]
    assert resumen["total"] == 2 and resumen["abiertas"] == 2
    assert resumen["piezas_afectadas"] == 12
    # El porcentaje sólo de las que dijeron de cuántas: 10 de 50, no 12 de 50.
    assert resumen["porcentaje_rechazo"] == 20.0

    # Cerrar con la acción correctiva, desde la OT.
    id_nc = r.data["no_conformidades"][0]["id"]
    cerrada = await svc.cerrar(id_nc, CerrarIncidenciaDTO(accion_correctiva="Se afiló la sierra"), LUCAS)
    assert cerrada.data["estado"] == "CERRADA"
    assert cerrada.data["paso"] == 1, "la respuesta sigue siendo una fila completa"
    assert (await svc.listar_por_orden(10)).data["resumen"]["abiertas"] == 1


async def test_aparece_en_la_ficha_de_quien_hizo_las_piezas(session):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_rechazo(id_otp=102, id_operario=JUAN, piezas_afectadas=10, piezas_controladas=50), LUCAS)
    await svc.registrar(_rechazo(id_orden_trabajo=11, id_otp=201, id_operario=JUAN, piezas_afectadas=3), LUCAS)
    await svc.registrar(_rechazo(id_operario=ANA, piezas_afectadas=99), LUCAS)

    r = await svc.rechazos_de_persona(JUAN)
    assert r.data["persona"]["nombre"] == "Juan Perez"
    assert sorted(x["nro_ot"] for x in r.data["no_conformidades"]) == [7010, 7011]
    assert r.data["resumen"]["piezas_afectadas"] == 13
    assert r.data["resumen"]["ordenes"] == 2
    assert all(x["id_operario"] == JUAN for x in r.data["no_conformidades"]), "lo de Ana no"

    # Con período: todas son de hoy.
    hoy = datetime.now().date()
    ayer = (hoy - timedelta(days=1)).isoformat()
    assert (await svc.rechazos_de_persona(JUAN, hasta=ayer)).data["resumen"]["total"] == 0
    assert (await svc.rechazos_de_persona(JUAN, desde=hoy.isoformat(), hasta=hoy.isoformat())).data["resumen"]["total"] == 2
    with pytest.raises(BusinessException):
        await svc.rechazos_de_persona(JUAN, desde=hoy.isoformat(), hasta=ayer)
    with pytest.raises(NotFoundException):
        await svc.rechazos_de_persona(999)

    # Y la lista de siempre se puede filtrar por la persona (por HTTP pide la sección
    # «Rendimiento por persona»: test_filtrar_el_reporte_por_persona_pide_la_seccion...).
    solo_juan = await svc.reporte(id_operario=JUAN)
    assert solo_juan.data["resumen"]["total"] == 2


async def test_piezas_rechazadas_por_persona(session):
    """«Piezas rechazadas por persona este mes»: quien más tuvo, primero; lo que no dice
    quién va aparte, al final, y no se reparte entre nadie."""
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_rechazo(id_operario=JUAN, piezas_afectadas=10, piezas_controladas=50), LUCAS)
    await svc.registrar(_rechazo(id_orden_trabajo=11, id_operario=JUAN, piezas_afectadas=5), LUCAS)
    await svc.registrar(_rechazo(id_operario=ANA, piezas_afectadas=20, piezas_controladas=20), LUCAS)
    await svc.registrar(_rechazo(piezas_afectadas=100), LUCAS)  # sin persona

    hoy = datetime.now().date()
    r = await svc.por_persona(desde=hoy.replace(day=1).isoformat(), hasta=hoy.isoformat())
    personas = r.data["personas"]
    assert [p["operario"] for p in personas] == ["Ana Díaz", "Juan Perez", None]
    ana, juan, nadie = personas
    assert (ana["piezas_rechazadas"], ana["porcentaje_rechazo"]) == (20, 100.0)
    assert (juan["piezas_rechazadas"], juan["no_conformidades"], juan["ordenes"]) == (15, 2, 2)
    # 10 de 50: la de 5 piezas no dijo de cuántas y no entra en el porcentaje.
    assert juan["porcentaje_rechazo"] == 20.0
    assert nadie["id_operario"] is None and nadie["piezas_rechazadas"] == 100
    # Los totales cierran con el listado.
    assert r.data["resumen"]["piezas_afectadas"] == 135 == sum(p["piezas_rechazadas"] for p in personas)

    # Con un filtro, sólo eso.
    solo_7011 = await svc.por_persona(nro_ot=7011)
    assert [p["operario"] for p in solo_7011.data["personas"]] == ["Juan Perez"]


async def test_el_csv_trae_lo_nuevo_al_final(session):
    """Las dieciséis columnas de antes en el mismo lugar; lo nuevo, después."""
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_rechazo(id_otp=102, piezas_afectadas=10, piezas_controladas=50,
                                 disposicion="DEVOLUCION_PROVEEDOR"), LUCAS)
    filas = list(csv.reader(io.StringIO((await svc.reporte_csv()).lstrip("﻿")), delimiter=";"))
    cabecera, fila = filas
    assert cabecera[:2] == ["N° OT", "Cliente"] and cabecera[15] == "Fecha de cierre"
    assert cabecera[16:] == ["Paso", "Piezas controladas", "Qué se hace con lo rechazado"]
    assert fila[16:] == ["2", "50", "Se devuelve al proveedor"]
    assert fila[cabecera.index("Tipo")] == "Pieza rechazada en control"


# ─────────────────────── 5. quién hizo cada paso: la sugerencia ───────────────────────

async def test_los_pasos_de_la_orden_con_quien_hizo_cada_uno(session):
    await _taller(session)
    r = await IncidenciaProcesoService(session).para_registrar(id_orden=10)
    assert r.data["orden"]["nro_ot"] == 7010
    assert r.data["orden"]["cliente"] == "ACME SRL"
    pasos = r.data["pasos"]
    assert [(p["paso"], p["proceso"]) for p in pasos] == [(1, "CORTE"), (2, "TORNO CNC"), (3, "TORNO CNC")]

    sugeridos = {p["paso"]: [(s["nombre"], s["origen"]) for s in p["sugeridos"]] for p in pasos}
    # Elegida a mano en la OT: manda eso.
    assert sugeridos[1] == [("Ana Díaz", "ot")]
    # Sin elegir: el ÚLTIMO plan (Juan), no el viejo (Pedro).
    assert sugeridos[2] == [("Juan Perez", "plan")]
    # La otra pasada del mismo proceso no hereda nada: no se adivina.
    assert sugeridos[3] == []


async def test_los_pasos_se_buscan_por_el_numero_que_se_ve(session):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    r = await svc.para_registrar(nro_ot=7011)
    assert r.data["orden"]["id"] == 11
    # Una OT que no existe no es un error: el formulario lo dice mientras se escribe.
    nada = await svc.para_registrar(nro_ot=1234)
    assert nada.data == {"orden": None, "pasos": []}
    with pytest.raises(BusinessException):
        await svc.para_registrar()


async def test_si_quien_planifico_ya_no_esta_no_se_sugiere(session):
    """Una persona que el plan nombró y después se borró de Recursos no es una
    sugerencia: no se podría guardar (tiene que existir)."""
    from sqlalchemy import delete
    await _taller(session)
    await session.execute(delete(Planificacion).where(Planificacion.id_operario == JUAN))
    await session.execute(delete(Operario).where(Operario.id == PEDRO))
    await session.commit()
    r = await IncidenciaProcesoService(session).para_registrar(id_orden=10)
    paso2 = next(p for p in r.data["pasos"] if p["paso"] == 2)
    assert paso2["sugeridos"] == []


def test_los_catalogos_dicen_que_este_servidor_sabe_cargar_rechazos():
    """El front muestra el botón «Registrar rechazo» sólo si el servidor manda las
    disposiciones: con uno de antes, guardar un tipo nuevo daría error."""
    data = IncidenciaProcesoService(None).catalogos().data
    assert data["disposiciones"] == DISPOSICIONES
    assert data["tipo_del_formulario"] == "RECHAZO_CONTROL"


# ─────────────────────── 6. el filtro por persona pide la sección ───────────────────────
#
# Revisión del 23/09: /operarios/{id}/rechazos y /incidencias/por-persona piden la sección
# confidencial «Rendimiento por persona», pero el reporte de siempre con ?id_operario=
# devolvía lo mismo (sus filas, sus piezas y su porcentaje de rechazo) con sólo el área.
# El supervisor, sin la sección, veía «23 piezas rechazadas, 22,5 % de las controladas»
# de Juan eligiéndolo en el filtro.

def _permisos_nc(*, rendimiento: bool):
    from backend.core.permisos import DatosDePermisos, permisos_de
    return permisos_de(DatosDePermisos(
        rol="supervisor", rol_areas={"no_conformidades": "write", "operaciones": "write"},
        usuario_secciones={"dashboard_rendimiento": "read"} if rendimiento else {},
    ), 4, "lucas")


@pytest.fixture
def api_nc(session):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from backend.commons.handlers.exception_handlers import registrar_exception_handlers
    from backend.core.security import get_current_user, get_permisos_actuales
    from backend.presentation import IncidenciaProcesoAPI

    async def _db():
        yield session

    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(IncidenciaProcesoAPI.router)
    app.dependency_overrides[IncidenciaProcesoAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: LUCAS
    estado = {"permisos": _permisos_nc(rendimiento=False)}
    app.dependency_overrides[get_permisos_actuales] = lambda: estado["permisos"]
    cliente = AsyncClient(transport=ASGITransport(app=app), base_url="http://t")
    cliente.estado = estado
    return cliente


async def test_filtrar_el_reporte_por_persona_pide_la_seccion_confidencial(session, api_nc):
    await _taller(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_rechazo(id_otp=102, id_operario=JUAN, piezas_afectadas=10, piezas_controladas=50), LUCAS)
    await svc.registrar(_rechazo(id_operario=ANA, piezas_afectadas=4), LUCAS)

    async with api_nc as c:
        # Sin la sección: filtrar por persona, no (ni la lista ni el archivo)...
        for ruta in ("/incidencias/reporte", "/incidencias/reporte.csv"):
            r = await c.get(ruta, params={"id_operario": JUAN})
            assert r.status_code == 403, (ruta, r.text)
            assert r.json()["errors"][0]["campo"] == "permiso"
            assert "Rendimiento por persona" in r.json()["errors"][0]["message"]
        # ...pero la lista de siempre y los demás filtros siguen andando.
        r = await c.get("/incidencias/reporte")
        assert r.status_code == 200 and r.json()["data"]["resumen"]["total"] == 2
        assert (await c.get("/incidencias/reporte", params={"nro_ot": 7010})).status_code == 200
        assert (await c.get("/incidencias/reporte.csv")).status_code == 200

        # Con la sección, sí: lo mismo que la ficha de la persona.
        c.estado["permisos"] = _permisos_nc(rendimiento=True)
        r = await c.get("/incidencias/reporte", params={"id_operario": JUAN})
        assert r.status_code == 200
        assert r.json()["data"]["resumen"]["total"] == 1
        assert r.json()["data"]["resumen"]["piezas_afectadas"] == 10
        assert (await c.get("/incidencias/reporte.csv", params={"id_operario": JUAN})).status_code == 200

        # Y el admin, como siempre.
        from backend.core.permisos import DatosDePermisos, permisos_de
        c.estado["permisos"] = permisos_de(DatosDePermisos(rol="admin"), 1, "julian")
        assert (await c.get("/incidencias/reporte", params={"id_operario": ANA})).status_code == 200
