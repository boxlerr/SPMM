"""El paso que se le puso a cada proceso tiene que seguir ahí cuando se vuelve a abrir la OT.

EL CASO REAL

Camilo, 14/09/2026: «había agarrado 15 OT de las más antiguas y les puse los procesos y
el orden correspondiente. Se me dio por revisar recién y la OT tiene los procesos y los
minutos que puse, pero me desordenó todo el orden». Y Lucas, esa misma tarde: «Julián hoy
perdió toda la mañana de procesos por eso. Hasta que no ande bien no vamos a usar más el
nuevo».

El orden NO se perdía al guardar: se perdía al LEER. `update_processes_full` escribía bien
`orden = posición`, y la columna en la base estaba impecable — la OT 14571 tenía guardado
[1,7,6,2,3,4,5,8] exactamente como Camilo lo había dejado. Lo que fallaba es que la
relación `OrdenTrabajo.procesos` no declaraba `order_by`, así que Postgres devolvía las
filas en orden FÍSICO (≈ el de inserción) y la pantalla, que numera por posición, las
mostraba renumeradas 1..8 en el orden equivocado. Medido contra producción: 791 de 1080
OT con procesos volvían así.

Y no era sólo visual. Como la pantalla manda la lista en el orden en que la muestra y el
backend guarda `orden = posición`, el desorden con el que se abría se PERSISTÍA en el
próximo guardado, aunque nadie tocara un solo proceso.

El segundo test cubre el otro bug de la misma pantalla: cambiar el proceso elegido en una
fila que ya existía se descartaba en silencio y quedaba el proceso viejo con los minutos
nuevos.
"""
from datetime import datetime

import pytest

from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository


async def _ot_con_procesos(session, pasos):
    """Una OT con sus procesos, insertados A PROPÓSITO en un orden distinto del paso.

    `pasos` es [(id_proceso, orden)] en el orden en que se INSERTAN. Así se reproduce lo
    que hay en producción: filas viejas con paso alto y filas nuevas con paso bajo,
    porque los procesos se cargaron en varias tandas.
    """
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="TALLER"),
        Articulo(id=1, cod_articulo="A-1", descripcion="Pieza", abreviatura="P"),
        Cliente(id=1, nombre="UN CLIENTE"),
        EstadoProceso(id=1, descripcion="Pendiente"),
    ])
    session.add_all([Proceso(id=p, nombre=f"PROCESO {p}") for p, _ in pasos])
    session.add(OrdenTrabajo(
        id=1, id_otvieja=14571, id_prioridad=1, id_sector=1, id_articulo=1, id_cliente=1,
        fecha_orden=datetime(2026, 9, 1), fecha_entrada=datetime(2026, 9, 1),
        fecha_prometida=datetime(2026, 9, 30),
    ))
    await session.commit()

    for id_proceso, orden in pasos:
        session.add(OrdenTrabajoProceso(
            id_orden_trabajo=1, id_proceso=id_proceso, orden=orden,
            tiempo_proceso=10, id_estado=1))
        await session.commit()      # de a uno, para que el id siga el orden de inserción


@pytest.mark.asyncio
async def test_los_procesos_vuelven_en_el_orden_del_paso_y_no_en_el_de_inserccion(session):
    # Los 8 pasos de la OT 14571 tal como quedaron en producción: los tres primeros son
    # filas viejas (ids bajos) con pasos 1, 7 y 6; los otros cinco los agregó Camilo
    # después con pasos 2..5 y 8.
    await _ot_con_procesos(session, [
        (10, 1),   # PREPARACION DE TORNO
        (11, 7),   # PULIDO
        (12, 6),   # SOLDADURA CON TIG
        (13, 2),   # TORNO T1
        (14, 3),   # PROGRAMACION FRESADORA CNC
        (15, 4),   # FRESADORA CNC
        (16, 5),   # PREPARACION DE SOLDADORA TIG
        (17, 8),   # EMBALADO
    ])

    orden = await OrdenTrabajoRepository(session).find_by_id(1)

    # Lo que tiene que ver Camilo al abrir la OT: 1,2,3,4,5,6,7,8.
    assert [p.orden for p in orden.procesos] == [1, 2, 3, 4, 5, 6, 7, 8]
    # Y que no sea casualidad de los números: los procesos, en la secuencia de trabajo.
    assert [p.id_proceso for p in orden.procesos] == [10, 13, 14, 15, 16, 12, 11, 17]


@pytest.mark.asyncio
async def test_dos_procesos_en_el_mismo_paso_no_bailan_entre_aperturas(session):
    # En producción hay 531 filas que comparten paso con otra de la misma OT: es dato
    # del cliente y no se renumera. Sin desempate por id, esas OT cambian de orden cada
    # vez que se abren, que es la misma sensación de "se desordenó solo".
    await _ot_con_procesos(session, [(10, 1), (11, 2), (12, 2), (13, 3)])

    repo = OrdenTrabajoRepository(session)
    primera = [p.id for p in (await repo.find_by_id(1)).procesos]
    session.expire_all()
    segunda = [p.id for p in (await repo.find_by_id(1)).procesos]

    assert primera == segunda
    assert primera == sorted(primera), "con el paso empatado manda el id, que es estable"


@pytest.mark.asyncio
async def test_cambiar_el_proceso_de_una_fila_no_se_descarta_en_silencio(session):
    """Elegir otro proceso en una fila que ya existía tiene que quedar guardado.

    Antes la fila se buscaba por `id_otp` y la rama de UPDATE nunca asignaba
    `id_proceso`: quedaba el proceso VIEJO con los minutos NUEVOS. Para el que carga es
    indistinguible de que el sistema le haya cambiado los datos solo.
    """
    await _ot_con_procesos(session, [(10, 1), (11, 2)])
    repo = OrdenTrabajoRepository(session)
    fila = (await repo.find_by_id(1)).procesos[0]
    id_otp, id_viejo = fila.id, fila.id_proceso

    session.add(Proceso(id=99, nombre="PROCESO 99"))
    await session.commit()

    # La pantalla manda la misma fila (mismo id_otp) pero con otro proceso elegido.
    await repo.update_processes_full(1, [
        {"proceso_id": 99, "id_otp": id_otp, "tiempo_proceso": 45, "cant_operarios": 1},
        {"proceso_id": 11, "tiempo_proceso": 10, "cant_operarios": 1},
    ])

    session.expire_all()
    procesos = (await repo.find_by_id(1)).procesos
    assert [p.id_proceso for p in procesos] == [99, 11], "el proceso elegido tiene que quedar"
    assert procesos[0].tiempo_proceso == 45
    # La pasada vieja no sobrevive escondida: sería un proceso duplicado en la OT.
    assert id_viejo not in [p.id_proceso for p in procesos]
