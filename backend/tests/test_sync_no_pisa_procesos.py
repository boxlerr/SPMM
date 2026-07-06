"""
Tests del corte del sync (reunión Metlo 2-jul-2026):
`sync_db.run_sync()` NO debe volver a ejecutar la "ruta de procesos"
(QUERY_SYNC_OT_PROCESOS) que pisaba lo editado en SPMM, pero SÍ debe seguir
sincronizando el resto (cabecera de OT, catálogo de procesos, materia prima).

No toca ninguna base real: mockea la sesión y captura el SQL ejecutado.
"""


class _FakeResult:
    rowcount = 0


class _FakeSession:
    """Sesión falsa que sólo registra el SQL de cada execute()."""
    def __init__(self, sink):
        self._sink = sink

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, clause, params=None):
        self._sink.append(str(clause))
        return _FakeResult()

    async def commit(self):
        pass

    async def rollback(self):
        pass


async def _correr_sync_capturando():
    import backend.scripts.sync_db as sync_db
    executed = []
    original = sync_db.SessionLocal
    sync_db.SessionLocal = lambda: _FakeSession(executed)
    try:
        await sync_db.run_sync()
    finally:
        sync_db.SessionLocal = original
    return "\n".join(executed)


async def test_run_sync_no_ejecuta_la_ruta_de_procesos():
    sql = await _correr_sync_capturando()
    # La query que pisaba los procesos por OT NO debe ejecutarse.
    assert "MERGE dbo.orden_trabajo_proceso" not in sql


async def test_run_sync_sigue_sincronizando_el_resto():
    sql = await _correr_sync_capturando()
    # Cabecera de OT, catálogo de procesos y materia prima SIGUEN sincronizando.
    assert "MERGE dbo.orden_trabajo AS tgt" in sql            # cabecera de OT
    assert "INSERT INTO dbo.proceso" in sql                    # catálogo de procesos (paso 5)
    assert "MERGE dbo.orden_trabajo_pieza" in sql              # materia prima
