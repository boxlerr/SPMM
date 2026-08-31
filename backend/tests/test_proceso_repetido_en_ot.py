"""
Tests de "el mismo proceso, varias veces en una OT" (pedido del 28-ago-2026).

El legacy carga UNA FILA POR PASADA: la OT 7497 tiene TORNO CNC en 13 pasadas
intercaladas con los demás procesos. Hasta ahora eso no entraba en SPMM porque la PK
de `orden_trabajo_proceso` era (id_orden_trabajo, id_proceso), así que la segunda
pasada se perdía al migrar o se sumaba dentro de la primera.

Lo que se fija acá:
  - la fila tiene id propio y (OT, proceso) ya NO es único;
  - el planificador numera las pasadas por POSICIÓN, no por `orden` —que se repite en
    531 filas de producción y hacía que dos procesos del mismo paso se pisaran en los
    diccionarios del modelo, o sea que uno desaparecía del plan sin avisar;
  - el resultado del plan sabe a qué pasada corresponde.

Imports adentro de cada test para que una dependencia pesada no rompa la colección.
Migración: backend/scripts/migrations/2026-08-28_proceso_repetido_en_ot.sql
"""


def test_modelo_tiene_id_propio_y_pk_simple():
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
    tbl = OrdenTrabajoProceso.__table__

    assert "id" in tbl.columns.keys()
    # La PK es SOLO el id: si volviera a incluir id_proceso, la segunda pasada del
    # mismo proceso no entraría.
    assert [c.name for c in tbl.primary_key.columns] == ["id"]

    # Y (id_orden_trabajo, id_proceso) no puede seguir siendo único por ningún lado.
    for con in tbl.constraints:
        cols = sorted(c.name for c in getattr(con, "columns", []))
        assert cols != ["id_orden_trabajo", "id_proceso"], (
            f"{con} vuelve a hacer único (OT, proceso) y rompe las pasadas repetidas"
        )


def test_response_dto_expone_el_id_de_la_pasada():
    from backend.dto.OrdenTrabajoResponseDTO import OrdenTrabajoProcesoDTO

    class _FakeProc:
        id = 987
        orden = 3
        tiempo_proceso = 45
        cant_operarios = 1
        id_maquinaria = None
        observaciones = None
        proceso = None
        estado_proceso = None
        operario_nombre = None
        inicio_real = None
        fin_real = None

    # Sin esto el frontend no puede decir de QUÉ pasada habla al cambiar un estado.
    assert OrdenTrabajoProcesoDTO.model_validate(_FakeProc()).id == 987


def test_create_dto_acepta_id_otp():
    from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoProcesoCreateDTO
    assert OrdenTrabajoProcesoCreateDTO(proceso_id=1, tiempo_proceso=30, id_otp=55).id_otp == 55
    # Línea nueva: viene vacío.
    assert OrdenTrabajoProcesoCreateDTO(proceso_id=1, tiempo_proceso=30).id_otp is None


def test_endpoints_aceptan_la_pasada():
    from backend.presentation.OrdenTrabajoAPI import EstadoUpdate, ObservacionesUpdate, ProcessReorderItem
    assert EstadoUpdate(id_estado=2, id_otp=7).id_otp == 7
    assert EstadoUpdate(id_estado=2).id_otp is None          # cliente viejo
    assert ObservacionesUpdate(observaciones="x", id_otp=7).id_otp == 7
    assert ProcessReorderItem(id_proceso=1, orden=2, id_otp=7).id_otp == 7


def test_planificar_request_acepta_lineas_por_orden():
    from backend.dto.PlanificarRequestDTO import PlanificarRequestDTO
    dto = PlanificarRequestDTO(lineas_por_orden={10: [101, 102]})
    assert dto.lineas_por_orden == {10: [101, 102]}
    assert PlanificarRequestDTO().lineas_por_orden is None


# ---------------------------------------------------------------------------
# Numeración de pasadas para el solver
# ---------------------------------------------------------------------------

class _Rel:
    def __init__(self, id, id_proceso, orden):
        self.id = id
        self.id_proceso = id_proceso
        self.orden = orden

    def __repr__(self):
        return f"<Rel id={self.id} proc={self.id_proceso} paso={self.orden}>"


def test_lineas_ordenadas_da_posiciones_unicas_con_pasos_repetidos():
    from backend.application.PlanificacionService import _lineas_ordenadas

    # Caso real: tres procesos distintos cargados todos en el paso 1 (pasa en 531
    # filas de producción). Con `rel.orden` como clave, dos se pisaban.
    rels = [_Rel(30, 7, 1), _Rel(10, 5, 1), _Rel(20, 6, 1)]
    pares = _lineas_ordenadas(rels)

    assert [p for p, _ in pares] == [1, 2, 3]
    # Empate de paso resuelto por id, que es estable entre corridas.
    assert [r.id for _, r in pares] == [10, 20, 30]


def test_lineas_ordenadas_numera_cada_pasada_del_mismo_proceso():
    from backend.application.PlanificacionService import _lineas_ordenadas

    # TORNO CNC (proceso 150) tres veces, intercalado con otro.
    rels = [_Rel(1, 150, 2), _Rel(2, 111, 3), _Rel(3, 150, 6), _Rel(4, 150, 9)]
    pares = _lineas_ordenadas(rels)

    assert [p for p, _ in pares] == [1, 2, 3, 4]
    # Respeta el orden de trabajo del taller.
    assert [r.orden for _, r in pares] == [2, 3, 6, 9]
    # Y las tres pasadas del 150 siguen siendo tres.
    assert sum(1 for _, r in pares if r.id_proceso == 150) == 3


def test_filtrar_lineas_por_orden_elige_la_pasada_no_el_proceso():
    from backend.application.PlanificacionService import _filtrar_lineas_por_orden

    rels = [_Rel(1, 150, 2), _Rel(2, 150, 6), _Rel(3, 111, 3)]

    # Se pide SOLO la segunda pasada del torno.
    elegidas = _filtrar_lineas_por_orden(rels, 10, {10: [2]})
    assert [r.id for r in elegidas] == [2]

    # OT sin restricción -> None, para que el llamador caiga al filtro viejo.
    assert _filtrar_lineas_por_orden(rels, 99, {10: [2]}) is None
    assert _filtrar_lineas_por_orden(rels, 10, None) is None


def test_marcar_lineas_pega_la_pasada_en_cada_resultado():
    from backend.application.PlanificacionService import _marcar_lineas

    mapa = {(10, 1): 501, (10, 2): 502}
    resultados = [
        {"orden_id": 10, "secuencia": 1},
        {"orden_id": 10, "secuencia": 2},
        {"orden_id": 10, "secuencia": 9},  # no existe: queda sin pasada, no rompe
    ]
    _marcar_lineas(resultados, mapa)

    assert [r["id_orden_trabajo_proceso"] for r in resultados] == [501, 502, None]


async def test_dos_pasadas_del_mismo_proceso_entran_en_la_misma_ot():
    """Lo que antes reventaba contra la PK. SQLite en memoria, sin ORM graph."""
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy import insert, select
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso

    tbl = OrdenTrabajoProceso.__table__
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: tbl.create(c))
            # Mismo proceso (150), misma OT, dos pasos distintos.
            await conn.execute(insert(tbl).values(
                id_orden_trabajo=1, id_proceso=150, orden=2, id_estado=1,
                tiempo_proceso=350, cant_operarios=1))
            await conn.execute(insert(tbl).values(
                id_orden_trabajo=1, id_proceso=150, orden=6, id_estado=1,
                tiempo_proceso=180, cant_operarios=1))

            filas = (await conn.execute(
                select(tbl.c.id, tbl.c.orden, tbl.c.tiempo_proceso)
                .where(tbl.c.id_orden_trabajo == 1)
                .order_by(tbl.c.orden)
            )).all()

        assert len(filas) == 2
        assert [f.orden for f in filas] == [2, 6]
        assert [f.tiempo_proceso for f in filas] == [350, 180]
        # Cada pasada tiene identidad propia.
        assert filas[0].id != filas[1].id
    finally:
        await engine.dispose()
