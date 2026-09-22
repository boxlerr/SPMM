"""Las no conformidades de una orden (RF-12).

El SRS pide poder generar el reporte de no conformidades y que cada una quede asociada
a su orden. La tabla existía desde junio con otro nombre (`incidencia_proceso`) y con
una sola pregunta adentro: cuánto tiempo se perdió por no interpretar un plano.

Lo que persigue este archivo no es que los endpoints contesten 200, sino las cuatro
formas en que un registro de calidad deja de servir:

  1. **Que no se puedan listar todas.** El repositorio EXIGÍA filtrar por tipo
     (`WHERE i.tipo = :tipo`), así que «todas las no conformidades» era literalmente
     imposible de pedir. Es el agujero que hacía que el RF no estuviera cumplido.
  2. **Que el sistema invente la evaluación.** Las filas viejas no tienen gravedad
     porque el campo no existía cuando se cargaron. Completarlas con 'MEDIA' por
     default sería escribir un juicio que nadie hizo, y después nadie podría
     distinguirlo del que sí se hizo.
  3. **Que una corrección se lleve puesto otro dato.** Mandar la gravedad no puede
     vaciar la descripción, y cerrar sin fecha (o reabrir dejando la fecha) deja una
     fila que miente.
  4. **Que el registro desaparezca.** Borrar a la persona que la protagonizó borraba la
     no conformidad entera, con la orden y todo: el rastro de lo que le pasó a esa OT
     se iba con el legajo.

Y el detalle tonto que arruina un reporte en este taller: el CSV se abre en un Excel en
español de Argentina, donde la coma es el separador decimal.
"""
import csv
import io
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from backend.application.IncidenciaProcesoService import (
    GRAVEDADES,
    TIPOS,
    IncidenciaProcesoService,
)
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.dto.IncidenciaProcesoRequestDTO import (
    CerrarIncidenciaDTO,
    IncidenciaProcesoRequestDTO,
    IncidenciaProcesoUpdateDTO,
)

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

# Quien reporta, tal como llega del token.
LUCAS = {"id_usuario": 4, "username": "lucas", "nombre": "Lucas", "apellido": "Gómez"}


async def _mundo(session):
    """Dos órdenes de clientes distintos, un proceso y una persona."""
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja de acero", abreviatura="BAND"),
        Cliente(id=1, nombre="ACME SRL"),
        Cliente(id=2, nombre="Pérez Hnos"),
        Proceso(id=100, nombre="Torneado"),
        Operario(id=1, nombre="Juan", apellido="Perez", categoria="OFICIAL",
                 hora_inicio=time(7, 0), hora_fin=time(16, 0)),
    ])
    for id_ot, id_cliente in ((10, 1), (11, 2)):
        session.add(OrdenTrabajo(
            id=id_ot, id_otvieja=7000 + id_ot, id_prioridad=1, id_sector=1,
            id_articulo=1, id_cliente=id_cliente, unidades=3,
            fecha_orden=datetime(2026, 9, 1), fecha_entrada=datetime(2026, 9, 1),
            fecha_prometida=datetime(2026, 10, 1), finalizadototal=0,
        ))
    await session.commit()


def _alta(id_ot: int, **extra) -> IncidenciaProcesoRequestDTO:
    datos = dict(id_orden_trabajo=id_ot, tipo="INTERPRETACION_PLANOS")
    datos.update(extra)
    return IncidenciaProcesoRequestDTO(**datos)


async def _nc(session) -> list[IncidenciaProceso]:
    return (await session.execute(
        select(IncidenciaProceso).order_by(IncidenciaProceso.id)
    )).scalars().all()


# ─────────────────────── el alta ───────────────────────

@pytest.mark.asyncio
async def test_queda_quien_la_reporto_y_la_hora_del_taller(session):
    """Sin autor, un registro de calidad no sirve de nada. Y la hora es la de acá.

    `fecha_registro` se estampaba con `datetime.utcnow`, que en Buenos Aires adelanta
    3 horas: una no conformidad cargada 22:30 figuraba al día siguiente y el reporte
    por mes movía de mes las de fin de mes.
    """
    await _mundo(session)
    svc = IncidenciaProcesoService(session)

    await svc.registrar(_alta(10, descripcion="Vino el plano viejo"), LUCAS)

    (nc,) = await _nc(session)
    assert nc.usuario == "Lucas Gómez"
    assert nc.id_usuario == 4

    ahora_ar = datetime.now(_TZ_AR).replace(tzinfo=None)
    assert abs((nc.fecha_registro - ahora_ar).total_seconds()) < 120, (
        f"la fecha quedó en {nc.fecha_registro} y en el taller son las {ahora_ar}: "
        "se está estampando en UTC"
    )


@pytest.mark.asyncio
async def test_sin_usuario_no_se_inventa_un_autor(session):
    """Lo que entra por un script no tiene token. Queda sin autor, no con uno puesto."""
    await _mundo(session)
    await IncidenciaProcesoService(session).registrar(_alta(10), None)

    (nc,) = await _nc(session)
    assert nc.usuario is None and nc.id_usuario is None


@pytest.mark.asyncio
async def test_sin_gravedad_queda_sin_clasificar_y_abierta(session):
    """NULL, no 'MEDIA': nadie la evaluó todavía y eso hay que poder verlo."""
    await _mundo(session)
    await IncidenciaProcesoService(session).registrar(_alta(10), LUCAS)

    (nc,) = await _nc(session)
    assert nc.gravedad is None
    assert nc.piezas_afectadas is None, "0 sería «ninguna», que no es lo mismo que «no se registró»"
    assert nc.estado == "ABIERTA"
    assert nc.fecha_cierre is None


@pytest.mark.asyncio
async def test_una_gravedad_que_no_existe_se_rechaza(session):
    """Si entrara texto libre, el reporte agruparía por categorías que nadie ve."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)

    with pytest.raises(BusinessException) as e:
        await svc.registrar(_alta(10, gravedad="gravísima"), LUCAS)
    assert "GRAVE" in str(e.value), "el error tiene que decir cuáles valen"

    with pytest.raises(BusinessException):
        await svc.registrar(_alta(10, tipo="LO_QUE_SEA"), LUCAS)

    assert await _nc(session) == []


@pytest.mark.asyncio
async def test_la_gravedad_entra_aunque_venga_en_minuscula(session):
    await _mundo(session)
    await IncidenciaProcesoService(session).registrar(_alta(10, gravedad="grave"), LUCAS)

    (nc,) = await _nc(session)
    assert nc.gravedad == "GRAVE"


@pytest.mark.asyncio
async def test_no_puede_quedar_colgada_de_ninguna_orden(session):
    """La asociación con la OT es el RF entero, no un campo más."""
    await _mundo(session)
    with pytest.raises(BusinessException):
        await IncidenciaProcesoService(session).registrar(
            IncidenciaProcesoRequestDTO(id_orden_trabajo=0), LUCAS
        )


# ─────────────────────── el reporte ───────────────────────

@pytest.mark.asyncio
async def test_el_reporte_sin_filtros_las_trae_TODAS(session):
    """El agujero que hacía que el RF no estuviera cumplido.

    Hasta el 22/09 el repositorio exigía `WHERE i.tipo = :tipo`: no existía forma de
    pedir todas las no conformidades juntas, que es exactamente el reporte que pide el
    SRS. Con una sola de otro tipo, este test se pone en rojo si alguien vuelve a
    clavar el filtro.
    """
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_alta(10, tipo="INTERPRETACION_PLANOS"), LUCAS)
    await svc.registrar(_alta(10, tipo="MATERIAL_NO_CONFORME"), LUCAS)
    await svc.registrar(_alta(11, tipo="MEDIDA_FUERA_DE_TOLERANCIA"), LUCAS)

    r = await svc.reporte()
    tipos = sorted(x["tipo"] for x in r.data["no_conformidades"])
    assert tipos == ["INTERPRETACION_PLANOS", "MATERIAL_NO_CONFORME", "MEDIDA_FUERA_DE_TOLERANCIA"]
    assert r.data["resumen"]["total"] == 3

    # Y con el filtro puesto, sólo ese tipo.
    solo = await svc.reporte(tipo="MATERIAL_NO_CONFORME")
    assert [x["tipo"] for x in solo.data["no_conformidades"]] == ["MATERIAL_NO_CONFORME"]


@pytest.mark.asyncio
async def test_el_reporte_dice_de_qué_orden_es_cada_una(session):
    """Una lista de ids no es un reporte: tiene que decir OT, cliente y producto."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_alta(11, id_proceso=100, id_operario=1), LUCAS)

    (fila,) = (await svc.reporte()).data["no_conformidades"]
    assert fila["id_orden_trabajo"] == 11
    assert fila["nro_ot"] == 7011
    assert fila["cliente"] == "Pérez Hnos"
    assert fila["producto"] == "Bandeja de acero"
    assert fila["proceso"] == "Torneado"
    assert fila["operario"] == "Juan Perez"


@pytest.mark.asyncio
async def test_se_filtra_por_orden_gravedad_estado_y_fecha(session):
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_alta(10, gravedad="GRAVE"), LUCAS)
    await svc.registrar(_alta(11, gravedad="LEVE"), LUCAS)
    await svc.registrar(_alta(11), LUCAS)  # sin clasificar

    de_la_10 = await svc.reporte(id_orden=10)
    assert [x["id_orden_trabajo"] for x in de_la_10.data["no_conformidades"]] == [10]

    # En la pantalla se escribe el número que se ve de la orden (7010), no el id interno
    # (10). Si esto se rompe, el filtro contesta «no hay ninguna» en vez de fallar, que
    # es la peor forma de romperse.
    por_numero = await svc.reporte(nro_ot=7010)
    assert [x["nro_ot"] for x in por_numero.data["no_conformidades"]] == [7010]
    assert por_numero.data["resumen"]["total"] == 1

    graves = await svc.reporte(gravedad="GRAVE")
    assert len(graves.data["no_conformidades"]) == 1

    # «Sin clasificar» es una opción del filtro, no la ausencia de filtro: es como se
    # encuentra lo que quedó sin evaluar para ir a completarlo.
    sin = await svc.reporte(gravedad="SIN_CLASIFICAR")
    assert len(sin.data["no_conformidades"]) == 1
    assert sin.data["no_conformidades"][0]["gravedad"] is None

    # Todas son de hoy: un rango que termina ayer no trae ninguna, y uno que incluye
    # hoy las trae. El `hasta` es inclusivo para el que lo escribe.
    hoy = datetime.now(_TZ_AR).date()
    ayer = (hoy - timedelta(days=1)).isoformat()
    assert (await svc.reporte(hasta=ayer)).data["resumen"]["total"] == 0
    assert (await svc.reporte(desde=hoy.isoformat(), hasta=hoy.isoformat())).data["resumen"]["total"] == 3


@pytest.mark.asyncio
async def test_una_fecha_mal_escrita_lo_dice_en_castellano(session):
    await _mundo(session)
    with pytest.raises(BusinessException) as e:
        await IncidenciaProcesoService(session).reporte(desde="22/09/2026")
    assert "AAAA-MM-DD" in str(e.value)


@pytest.mark.asyncio
async def test_el_resumen_cuenta_todo_aunque_la_lista_venga_cortada(session):
    """Si el resumen se calculara sobre lo traído, el día que el filtro pase el tope el
    encabezado diría un número más chico que la realidad y nadie se enteraría."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    for _ in range(5):
        await svc.registrar(_alta(10, minutos_perdidos=10, piezas_afectadas=2), LUCAS)

    r = await svc.reporte(limite=2)
    assert len(r.data["no_conformidades"]) == 2
    assert r.data["resumen"]["total"] == 5
    assert r.data["resumen"]["minutos_perdidos"] == 50
    assert r.data["resumen"]["piezas_afectadas"] == 10
    assert r.data["hay_mas"] is True, "la pantalla tiene que poder avisar que hay más"


@pytest.mark.asyncio
async def test_las_no_conformidades_de_una_orden(session):
    """La otra punta del RF: mirado desde la OT, no desde el reporte."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_alta(10), LUCAS)
    await svc.registrar(_alta(10), LUCAS)
    await svc.registrar(_alta(11), LUCAS)

    r = await svc.listar_por_orden(10)
    assert r.data["resumen"]["total"] == 2
    assert {x["id_orden_trabajo"] for x in r.data["no_conformidades"]} == {10}
    assert r.data["resumen"]["abiertas"] == 2


# ─────────────────────── corregir y cerrar ───────────────────────

@pytest.mark.asyncio
async def test_cerrar_estampa_la_fecha_y_reabrir_la_borra(session):
    """Estado y fecha se escriben juntos: CERRADA sin fecha no dice desde cuándo, y
    ABIERTA con fecha de cierre parece resuelta."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    creada = await svc.registrar(_alta(10), LUCAS)
    id_nc = creada.data["id"]

    r = await svc.cerrar(id_nc, CerrarIncidenciaDTO(accion_correctiva="Se rehízo la pieza"), LUCAS)
    assert r.data["estado"] == "CERRADA"
    assert r.data["fecha_cierre"] is not None
    assert r.data["accion_correctiva"] == "Se rehízo la pieza"

    # Volver a abrirla limpia la fecha de cierre.
    r = await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(estado="ABIERTA"), LUCAS)
    assert r.data["estado"] == "ABIERTA"
    assert r.data["fecha_cierre"] is None


@pytest.mark.asyncio
async def test_cerrar_dos_veces_no_mueve_la_fecha(session):
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    id_nc = (await svc.registrar(_alta(10), LUCAS)).data["id"]

    primera = (await svc.cerrar(id_nc, None, LUCAS)).data["fecha_cierre"]
    segunda = (await svc.cerrar(id_nc, CerrarIncidenciaDTO(accion_correctiva="ok"), LUCAS)).data["fecha_cierre"]
    assert primera == segunda


@pytest.mark.asyncio
async def test_corregir_toca_solo_lo_que_viene(session):
    """Mandar la gravedad no puede vaciar de paso la descripción."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    id_nc = (await svc.registrar(
        _alta(10, descripcion="Medida 20.5 en vez de 20", minutos_perdidos=45), LUCAS
    )).data["id"]

    r = await svc.actualizar(id_nc, IncidenciaProcesoUpdateDTO(gravedad="GRAVE"), LUCAS)
    assert r.data["gravedad"] == "GRAVE"
    assert r.data["descripcion"] == "Medida 20.5 en vez de 20"
    assert r.data["minutos_perdidos"] == 45
    assert r.data["estado"] == "ABIERTA"


@pytest.mark.asyncio
async def test_corregir_una_que_no_existe_da_404_y_no_500(session):
    await _mundo(session)
    with pytest.raises(NotFoundException):
        await IncidenciaProcesoService(session).cerrar(999, None, LUCAS)


# ─────────────────────── el CSV ───────────────────────

@pytest.mark.asyncio
async def test_el_csv_abre_bien_en_el_excel_del_taller(session):
    """Separador `;` y BOM. Con `,` la planilla abre toda en una sola columna, porque
    el Excel en español de Argentina usa la coma como separador decimal."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(
        _alta(10, gravedad="GRAVE", piezas_afectadas=3, minutos_perdidos=45,
              descripcion="Vino el plano viejo"),
        LUCAS,
    )

    contenido = await svc.reporte_csv()
    assert contenido.startswith("﻿"), "sin BOM, Excel rompe los acentos"

    filas = list(csv.reader(io.StringIO(contenido.lstrip("﻿")), delimiter=";"))
    cabecera, fila = filas[0], filas[1]
    assert cabecera[0] == "N° OT"
    assert "Gravedad" in cabecera and "Qué se hizo" in cabecera
    assert fila[cabecera.index("N° OT")] == "7010"
    assert fila[cabecera.index("Cliente")] == "ACME SRL"
    # En el archivo va el nombre, no la constante: lo abre alguien, no un programa.
    assert fila[cabecera.index("Tipo")] == TIPOS["INTERPRETACION_PLANOS"]
    assert fila[cabecera.index("Gravedad")] == GRAVEDADES["GRAVE"]
    assert fila[cabecera.index("Estado")] == "Abierta"
    assert fila[cabecera.index("Piezas afectadas")] == "3"
    assert fila[cabecera.index("Lo reportó")] == "Lucas Gómez"
    # dd/mm/aaaa, como se escribe acá.
    assert "/" in fila[cabecera.index("Fecha")]


@pytest.mark.asyncio
async def test_el_csv_no_se_parte_si_alguien_escribio_un_punto_y_coma(session):
    """La descripción la escribe una persona y el separador está en el teclado."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_alta(10, descripcion="Faltaba la cota; se paró la máquina"), LUCAS)

    contenido = await svc.reporte_csv()
    filas = list(csv.reader(io.StringIO(contenido.lstrip("﻿")), delimiter=";"))
    assert len(filas[1]) == len(filas[0]), "la fila se partió en columnas de más"
    assert "Faltaba la cota; se paró la máquina" in filas[1]


@pytest.mark.asyncio
async def test_en_el_csv_lo_no_evaluado_dice_sin_clasificar(session):
    """Una celda vacía se lee como «no aplica»; acá la verdad es que nadie la evaluó."""
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_alta(10), LUCAS)

    filas = list(csv.reader(
        io.StringIO((await svc.reporte_csv()).lstrip("﻿")), delimiter=";"
    ))
    assert filas[1][filas[0].index("Gravedad")] == "Sin clasificar"


@pytest.mark.asyncio
async def test_el_csv_respeta_los_filtros(session):
    await _mundo(session)
    svc = IncidenciaProcesoService(session)
    await svc.registrar(_alta(10), LUCAS)
    await svc.registrar(_alta(11), LUCAS)

    filas = list(csv.reader(
        io.StringIO((await svc.reporte_csv(id_orden=11)).lstrip("﻿")), delimiter=";"
    ))
    assert len(filas) == 2, "cabecera + una sola fila"
    assert filas[1][0] == "7011"


# ─────────────────────── que no desaparezca ───────────────────────

@pytest.mark.asyncio
async def test_borrar_a_la_persona_no_borra_su_no_conformidad(session):
    """Antes, borrar el legajo borraba el registro de calidad de la orden entera.

    La no conformidad es de la ORDEN. Que quien la protagonizó ya no trabaje acá no
    puede hacer desaparecer lo que le pasó a esa OT: se le suelta la persona, igual que
    a los pasos de la OT.
    """
    from backend.application.OperarioService import OperarioService
    from backend.domain.OperarioRango import OperarioRango
    from backend.domain.Rango import Rango

    await _mundo(session)
    session.add_all([Rango(id=6, nombre="OFICIAL"), OperarioRango(id_operario=1, id_rango=6)])
    await session.commit()

    await IncidenciaProcesoService(session).registrar(
        _alta(10, id_operario=1, descripcion="Se pasó de medida"), LUCAS
    )

    await OperarioService(session).eliminarOperario(1, forzar=True)
    session.expire_all()

    (nc,) = await _nc(session)
    assert nc.id_orden_trabajo == 10
    assert nc.descripcion == "Se pasó de medida"
    assert nc.id_operario is None, "se suelta la persona, no se borra el registro"


@pytest.mark.asyncio
async def test_borrar_el_proceso_del_catalogo_tampoco_la_borra(session):
    from backend.application.ProcesoService import ProcesoService

    await _mundo(session)
    await IncidenciaProcesoService(session).registrar(_alta(10, id_proceso=100), LUCAS)

    await ProcesoService(session).eliminarProceso(100, forzar=True)
    session.expire_all()

    (nc,) = await _nc(session)
    assert nc.id_proceso is None
    assert nc.id_orden_trabajo == 10


# ─────────────────────── la convención de la casa ───────────────────────

def test_la_fecha_no_se_estampa_en_utc():
    """Hora local AR y sin zona, como todas las fechas de esta base.

    Se mira el código y no sólo el resultado porque el bug vuelve por el camino fácil:
    alguien agrega una columna de fecha nueva y escribe `datetime.utcnow` de memoria.
    """
    import re

    for archivo in ("backend/domain/IncidenciaProceso.py",
                    "backend/application/IncidenciaProcesoService.py"):
        fuente = (Path(__file__).resolve().parents[2] / archivo).read_text(encoding="utf-8")
        sospechosas = [l.strip() for l in fuente.splitlines()
                       if re.search(r"datetime\.(utcnow|now)\(\s*\)", l)
                       and not l.strip().startswith("#")]
        assert not sospechosas, (
            f"{archivo}: usá _ahora_ar() en vez de utcnow()/now(): " + " | ".join(sospechosas))
