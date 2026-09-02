"""
Tests del campo "máquina preseleccionada" por proceso de OT
(reunión Metlo 2-jul-2026): columna nueva `orden_trabajo_proceso.id_maquinaria`,
su exposición en el DTO de respuesta y su aceptación en los DTOs de entrada.

Imports adentro de cada test para que una dependencia pesada no rompa la colección.
"""
from backend.application.PlanificacionService import proceso_usa_maquina


def test_modelo_tiene_columna_id_maquinaria():
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
    cols = OrdenTrabajoProceso.__table__.columns
    assert "id_maquinaria" in cols.keys()
    col = cols["id_maquinaria"]
    # Nullable (NULL = sin preselección) y FK a maquinaria.
    assert col.nullable is True
    fk_tables = {fk.column.table.name for fk in col.foreign_keys}
    assert "maquinaria" in fk_tables


def test_response_dto_expone_id_maquinaria():
    from backend.dto.OrdenTrabajoResponseDTO import OrdenTrabajoProcesoDTO

    class _FakeProc:
        orden = 1
        tiempo_proceso = 45
        cant_operarios = 2
        id_maquinaria = 10
        observaciones = None
        proceso = None
        estado_proceso = None
        operario_nombre = None
        inicio_real = None
        fin_real = None

    dto = OrdenTrabajoProcesoDTO.model_validate(_FakeProc())
    assert dto.id_maquinaria == 10

    # Sin preselección (NULL) también es válido.
    _FakeProc.id_maquinaria = None
    assert OrdenTrabajoProcesoDTO.model_validate(_FakeProc()).id_maquinaria is None


def test_create_dto_acepta_maquinaria_id():
    from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoProcesoCreateDTO
    dto = OrdenTrabajoProcesoCreateDTO(proceso_id=1, tiempo_proceso=30, maquinaria_id="10")
    assert dto.maquinaria_id == "10"
    # Opcional: sin máquina.
    dto2 = OrdenTrabajoProcesoCreateDTO(proceso_id=1, tiempo_proceso=30)
    assert dto2.maquinaria_id is None


def test_agregar_proceso_request_tiene_id_maquinaria():
    from backend.presentation.OrdenTrabajoAPI import AgregarProcesoRequest
    body = AgregarProcesoRequest(id_proceso=1, tiempo_estimado=30, id_maquinaria=10)
    assert body.id_maquinaria == 10
    # Opcional: default None.
    body2 = AgregarProcesoRequest(id_proceso=1, tiempo_estimado=30)
    assert body2.id_maquinaria is None


async def test_id_maquinaria_persiste_round_trip():
    """Inserta y lee id_maquinaria a nivel SQL (SQLite en memoria, sin ORM graph)."""
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy import insert, select
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso

    tbl = OrdenTrabajoProceso.__table__
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: tbl.create(c))
            await conn.execute(
                insert(tbl).values(
                    id_orden_trabajo=1, id_proceso=2, orden=1,
                    cant_operarios=1, id_maquinaria=10,
                )
            )
            res = await conn.execute(
                select(tbl.c.id_maquinaria).where(tbl.c.id_orden_trabajo == 1)
            )
            assert res.scalar_one() == 10
    finally:
        await engine.dispose()


# --------------------------------------------------------------------------
# Lo que contestó Lucas en la planilla de trabas (2/9/2026)
# --------------------------------------------------------------------------

def test_los_procesos_a_mano_no_buscan_maquina():
    """Pulido, engomado, decapado y pegado de goma se hacen a mano.

    El sistema los tenía como procesos de máquina, así que salían a buscar una para
    reservar y no la encontraban nunca. Cerraba el pendiente al revés: no había que
    cargarles una máquina, el dato era que no usan."""
    for nombre in ("PULIDO", "PULIDO DE EJE", "ENGOMADO", "DECAPADO", "PEGADO DE GOMA"):
        assert proceso_usa_maquina(nombre) is False, nombre


def test_enderezar_bases_usa_maquina_se_escriba_como_se_escriba():
    """Va en prensa o plegadora. La palabra clave vieja solo agarraba la grafía con Z,
    así que el mismo trabajo daba una respuesta u otra según cómo lo tipearon."""
    for nombre in ("ENDERESAR DE BASES", "ENDEREZADO EN PRENSA", "ENDEREZADO PRENSA"):
        assert proceso_usa_maquina(nombre) is True, nombre
