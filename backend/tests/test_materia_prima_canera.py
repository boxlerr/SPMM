"""La cañera (spec §2.3): asignar, mover y liberar casilleros.

Lo que persigue este archivo:

  1. **Que un casillero quede con dos OT vigentes**, o que pisar uno ocupado pase sin
     avisar quién estaba. Es 409 («E4 tiene la OT N° …»), y con ?forzar=true se libera el
     anterior y se ubica el nuevo (en ese orden: el índice único parcial no deja ni un
     instante con dos).
  2. **Que un número que no es OT de SPMM se ate a cualquier cosa.** Es 409, y con forzar
     se anota tal cual (`ot_texto`).
  3. **Que liberar borre el historial.** Liberar pone `hasta`; mover cierra la ocupación
     vieja y abre otra. Las filas quedan.
"""

import pytest
from sqlalchemy import func, select

from backend.application.MateriaPrimaPendientesService import MateriaPrimaPendientesService
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.domain.CaneraOcupacion import CaneraOcupacion
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.tests.test_materia_prima_ot import MAXI, OT_A, OT_B, OT_C, cliente, fila, mensaje, mundo


def vigentes(canera: dict) -> dict[str, str]:
    """{celda: número de OT o texto} de lo que devuelve la API."""
    return {o["celda"]: str(o["numero_ot"] or o["ot_texto"]) for o in canera["ocupaciones"]}


async def filas_de(session, columna, fila_):
    return (await session.execute(
        select(CaneraOcupacion)
        .where(CaneraOcupacion.columna == columna, CaneraOcupacion.fila == fila_)
        .order_by(CaneraOcupacion.id)
        .execution_options(populate_existing=True)
    )).scalars().all()


@pytest.mark.asyncio
async def test_asignar_y_pisar_un_casillero_ocupado(session):
    await mundo(session)
    async with cliente(session) as c:
        r = await c.post("/materia-prima/canera", json={"celda": "e4", "numero_ot": 15010})
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert vigentes(d) == {"E4": "15010"}
        o = d["ocupaciones"][0]
        assert (o["id_orden_trabajo"], o["asignado_por"], o["estado_material"], o["finalizada"]) == \
            (OT_A, "Maxi Pérez", "sin_datos", False)

        # La misma OT en el mismo casillero: no cambia nada (ni abre otra fila).
        await c.post("/materia-prima/canera", json={"celda": "E4", "numero_ot": "15010"})
        assert len(await filas_de(session, "E", 4)) == 1

        # Otra OT: 409 que dice quién está, y nada cambia.
        r = await c.post("/materia-prima/canera", json={"celda": "E4", "numero_ot": 15011})
        assert r.status_code == 409
        assert mensaje(r) == "E4 tiene la OT N° 15010: si seguís, se libera. ¿Hacerlo igual?"
        assert len(await filas_de(session, "E", 4)) == 1
        # Con forzar: la anterior se cierra (queda como historial) y entra la nueva.
        r = await c.post("/materia-prima/canera", params={"forzar": "true"},
                         json={"celda": "E4", "numero_ot": 15011})
        assert r.status_code == 200 and vigentes(r.json()["data"]) == {"E4": "15011"}
        vieja, nueva = await filas_de(session, "E", 4)
        assert vieja.id_orden_trabajo == OT_A and vieja.hasta is not None
        assert vieja.liberado_por == "Maxi Pérez"
        assert nueva.id_orden_trabajo == OT_B and nueva.hasta is None

        # Una OT puede ocupar varios casilleros.
        r = await c.post("/materia-prima/canera", json={"celda": "M1", "numero_ot": 15011})
        assert vigentes(r.json()["data"]) == {"E4": "15011", "M1": "15011"}

        for mala in ("P1", "A0", "E10", "", "44"):
            r = await c.post("/materia-prima/canera", json={"celda": mala, "numero_ot": 15010})
            assert r.status_code == 422, mala
        r = await c.post("/materia-prima/canera", json={"celda": "A1", "numero_ot": " "})
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_un_numero_que_no_es_ot_de_spmm_se_anota_con_forzar(session):
    await mundo(session)
    async with cliente(session) as c:
        r = await c.post("/materia-prima/canera", json={"celda": "C7", "numero_ot": 158010})
        assert r.status_code == 409
        assert mensaje(r) == ("No existe la OT 158010 en SPMM: si seguís, se anota el número tal "
                              "cual. ¿Hacerlo igual?")
        r = await c.post("/materia-prima/canera", params={"forzar": "true"},
                         json={"celda": "C7", "numero_ot": 158010})
        o = r.json()["data"]["ocupaciones"][0]
        assert (o["id_orden_trabajo"], o["numero_ot"], o["ot_texto"], o["estado_material"]) == \
            (None, None, "158010", None)

        # Los dos avisos juntos, en un solo 409.
        r = await c.post("/materia-prima/canera", json={"celda": "C7", "numero_ot": "14972"})
        assert r.status_code == 409
        assert mensaje(r) == ("C7 tiene la OT 158010: si seguís, se libera. No existe la OT 14972 "
                              "en SPMM: si seguís, se anota el número tal cual. ¿Hacerlo igual?")


@pytest.mark.asyncio
async def test_mover_y_liberar(session):
    await mundo(session)
    service = MateriaPrimaPendientesService(session)
    await service.asignar("A1", 15010, MAXI)
    await service.asignar("B2", 15011, MAXI)
    id_a1 = (await filas_de(session, "A", 1))[0].id
    id_b2 = (await filas_de(session, "B", 2))[0].id

    async with cliente(session) as c:
        # Mover: se cierra la ocupación vieja y se abre una nueva en el destino.
        r = await c.put(f"/materia-prima/canera/{id_a1}/mover", json={"celda": "D5"})
        assert r.status_code == 200, r.text
        assert vigentes(r.json()["data"]) == {"B2": "15011", "D5": "15010"}
        assert (await fila(session, CaneraOcupacion, id_a1)).hasta is not None
        # Ya liberada, no se mueve.
        r = await c.put(f"/materia-prima/canera/{id_a1}/mover", json={"celda": "D6"})
        assert r.status_code == 422 and "ya se liberó" in mensaje(r)

        # Al destino ocupado: 409; con forzar, se libera el destino.
        id_d5 = (await filas_de(session, "D", 5))[-1].id
        r = await c.put(f"/materia-prima/canera/{id_d5}/mover", json={"celda": "B2"})
        assert r.status_code == 409 and mensaje(r).startswith("B2 tiene la OT N° 15011")
        r = await c.put(f"/materia-prima/canera/{id_d5}/mover", params={"forzar": "true"},
                        json={"celda": "B2"})
        assert vigentes(r.json()["data"]) == {"B2": "15010"}
        assert (await fila(session, CaneraOcupacion, id_b2)).hasta is not None
        assert (await c.put("/materia-prima/canera/999/mover", json={"celda": "A1"})).status_code == 404

        # Liberar: queda la fila con hasta y quién. Liberar de nuevo no hace nada.
        id_b2_nueva = (await filas_de(session, "B", 2))[-1].id
        r = await c.delete(f"/materia-prima/canera/{id_b2_nueva}")
        assert r.status_code == 200 and vigentes(r.json()["data"]) == {}
        liberada = await fila(session, CaneraOcupacion, id_b2_nueva)
        assert liberada.hasta is not None and liberada.liberado_por == "Maxi Pérez"
        assert (await c.delete(f"/materia-prima/canera/{id_b2_nueva}")).status_code == 200
        assert (await c.delete("/materia-prima/canera/999")).status_code == 404
    # Nada se borró: las cuatro ocupaciones (A1, B2, D5 y la nueva B2) siguen, cerradas.
    total, abiertas = (await session.execute(
        select(func.count(CaneraOcupacion.id),
               func.count(CaneraOcupacion.id).filter(CaneraOcupacion.hasta.is_(None))))).one()
    assert (total, abiertas) == (4, 0)


@pytest.mark.asyncio
async def test_liberar_las_terminadas(session):
    await mundo(session)
    service = MateriaPrimaPendientesService(session)
    for celda, numero in (("A1", 15010), ("A2", 15011), ("A3", 15011), ("A4", 15012)):
        await service.asignar(celda, numero, MAXI)
    await service.asignar("A5", "VIEJA-1", MAXI, forzar=True)
    for id_ot in (OT_B, OT_C):
        (await session.get(OrdenTrabajo, id_ot)).finalizadototal = 1
    await session.commit()

    async with cliente(session) as c:
        d = (await c.get("/materia-prima/canera")).json()["data"]
        assert {o["celda"]: o["finalizada"] for o in d["ocupaciones"]} == \
            {"A1": False, "A2": True, "A3": True, "A4": True, "A5": False}
        r = await c.post("/materia-prima/canera/liberar-terminadas")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["liberadas"] == 3
        assert vigentes(r.json()["data"]["canera"]) == {"A1": "15010", "A5": "VIEJA-1"}
        r = await c.post("/materia-prima/canera/liberar-terminadas")
        assert r.json()["data"]["liberadas"] == 0


@pytest.mark.asyncio
async def test_el_servicio_cuida_la_regla_aunque_no_haya_indice(session):
    """En Postgres un índice único parcial no deja dos vigentes en un casillero; el
    servicio no depende de eso: pregunta antes y contesta 409 con quién está."""
    await mundo(session)
    service = MateriaPrimaPendientesService(session)
    await service.asignar("K7", 15010, MAXI)
    with pytest.raises(ConfirmacionRequeridaException):
        await service.asignar("K7", 15012, MAXI)
    with pytest.raises(BusinessException):
        await service.asignar("Z9", 15012, MAXI)
    assert len(await filas_de(session, "K", 7)) == 1


@pytest.mark.asyncio
async def test_otro_rechazo_de_la_base_no_se_disfraza_de_casillero_ocupado(session):
    """El 409 «se acaba de ocupar» es sólo para el índice único del casillero. Si la base
    rechaza por otra cosa (acá, el CHECK hasta >= desde de una ocupación con `desde` en
    el futuro), es un error de verdad: no se ofrece «Reemplazarla igual»."""
    from datetime import datetime

    from backend.commons.exceptions.InfrastructureException import InfrastructureException

    await mundo(session)
    session.add(CaneraOcupacion(columna="H", fila=2, id_orden_trabajo=OT_A, desde=datetime(2099, 1, 1)))
    await session.commit()
    id_h2 = (await filas_de(session, "H", 2))[0].id
    with pytest.raises(InfrastructureException):
        await MateriaPrimaPendientesService(session).liberar(id_h2, MAXI)
    assert (await fila(session, CaneraOcupacion, id_h2)).hasta is None   # no quedó nada a medias
