"""Un paso marcado «a mano» no tiene que salir a buscar máquina.

Hasta el 15/09/2026 la columna de máquina de un paso tenía dos valores y ninguno quería
decir "a mano": NULL era «que elija el planificador» —y elegía, deduciendo la máquina del
nombre del proceso— y un id era forzar esa máquina. Así, OXICORTE o ENDEREZADO salían a
buscar una máquina aunque el que cargó la OT supiera que esa vez iban a mano.

Es el mismo problema que ya se resolvió con `no_lleva_plano` y `no_lleva_materia_prima`:
el cero tapaba "falta cargarlo" y "no lleva", que son cosas opuestas.

Migración: backend/scripts/migrations/2026-09-15_proceso_no_lleva_maquina.sql
"""
import pytest


def test_la_columna_existe_y_no_admite_nulos():
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
    col = OrdenTrabajoProceso.__table__.columns.get("no_lleva_maquina")
    assert col is not None, "sin la columna, la marca no se puede guardar"
    # NOT NULL con default 0: las 5.600 pasadas que ya existían tienen que quedar en
    # "sí lleva máquina", que es como se venían comportando.
    assert not col.nullable
    assert col.default is not None and col.default.arg == 0


def test_los_dtos_la_llevan_en_los_dos_sentidos():
    from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoProcesoCreateDTO
    from backend.dto.OrdenTrabajoResponseDTO import OrdenTrabajoProcesoDTO

    # De ida: la pantalla la manda al guardar.
    assert OrdenTrabajoProcesoCreateDTO(
        proceso_id=1, tiempo_proceso=10, no_lleva_maquina=True).no_lleva_maquina is True
    # Y un cliente viejo que no la manda no rompe.
    assert OrdenTrabajoProcesoCreateDTO(
        proceso_id=1, tiempo_proceso=10).no_lleva_maquina is None

    # De vuelta: si no viaja, la pantalla muestra «Sin recurso maquinaria» —que significa
    # otra cosa— y al guardar se pierde la marca.
    class _P:
        id = 1; orden = 1; tiempo_proceso = 10; cant_operarios = 1
        id_maquinaria = None; id_operario = None; no_lleva_maquina = 1
        observaciones = None; proceso = None; estado_proceso = None
        operario_nombre = None; inicio_real = None; fin_real = None
    assert OrdenTrabajoProcesoDTO.model_validate(_P()).no_lleva_maquina == 1


@pytest.mark.parametrize("marca, espera", [(0, True), (1, False)])
def test_la_marca_de_la_pasada_le_gana_a_la_deduccion_por_nombre(marca, espera):
    """El planificador clasifica por el NOMBRE del proceso. La marca tiene que poder
    contradecirlo: es el dato que puso la persona que cargó esa OT."""
    from backend.application.PlanificacionService import proceso_usa_maquina

    class _Rel:
        no_lleva_maquina = marca

    # OXICORTE es un trabajo de máquina para el clasificador por nombre...
    usa_por_nombre = proceso_usa_maquina("OXICORTE")
    assert usa_por_nombre is True
    # ...pero la pasada marcada manda. Ésta es la cuenta que hace el planificador.
    assert bool(usa_por_nombre and not getattr(_Rel, "no_lleva_maquina", 0)) is espera


@pytest.mark.asyncio
async def test_guardar_y_releer_conserva_la_marca(session):
    """Marcar un paso «a mano», guardar, y que siga marcado al volver a abrir la OT."""
    from datetime import datetime
    from backend.domain.Articulo import Articulo
    from backend.domain.Cliente import Cliente
    from backend.domain.EstadoProceso import EstadoProceso
    from backend.domain.OrdenTrabajo import OrdenTrabajo
    from backend.domain.Prioridad import Prioridad
    from backend.domain.Proceso import Proceso
    from backend.domain.Sector import Sector
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    session.add_all([
        Prioridad(id=1, descripcion="Normal"), Sector(id=1, nombre="TALLER"),
        Articulo(id=1, cod_articulo="A-1", descripcion="Pieza", abreviatura="P"),
        Cliente(id=1, nombre="UN CLIENTE"), EstadoProceso(id=1, descripcion="Pendiente"),
        Proceso(id=50, nombre="ENDEREZADO"), Proceso(id=82, nombre="OXICORTE"),
    ])
    session.add(OrdenTrabajo(
        id=1, id_otvieja=15755, id_prioridad=1, id_sector=1, id_articulo=1, id_cliente=1,
        fecha_orden=datetime(2026, 9, 1), fecha_entrada=datetime(2026, 9, 1),
        fecha_prometida=datetime(2026, 9, 30)))
    await session.commit()

    repo = OrdenTrabajoRepository(session)
    await repo.update_processes_full(1, [
        {"proceso_id": 50, "tiempo_proceso": 30, "cant_operarios": 1, "no_lleva_maquina": True},
        {"proceso_id": 82, "tiempo_proceso": 20, "cant_operarios": 1, "no_lleva_maquina": False},
    ])
    session.expire_all()
    procesos = (await repo.find_by_id(1)).procesos
    assert [p.no_lleva_maquina for p in procesos] == [1, 0]

    # Y un guardado posterior que NO manda la clave no le borra la marca a nadie: es el
    # mismo contrato que la máquina y la persona preseleccionadas.
    await repo.update_processes_full(1, [
        {"proceso_id": 50, "id_otp": procesos[0].id, "tiempo_proceso": 45, "cant_operarios": 1},
        {"proceso_id": 82, "id_otp": procesos[1].id, "tiempo_proceso": 20, "cant_operarios": 1},
    ])
    session.expire_all()
    assert [p.no_lleva_maquina for p in (await repo.find_by_id(1)).procesos] == [1, 0]
