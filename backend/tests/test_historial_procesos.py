"""
Tests de "Traer historial" (reunión Metlo 2-jul-2026): el service serializa los
procesos que trae el repo (última OT del mismo producto) al shape que consume el
frontend. Usa un repo falso (sin DB).
"""


class _FakeProceso:
    def __init__(self, nombre):
        self.nombre = nombre


class _FakeOTP:
    def __init__(self, id_proceso, tiempo, cant, maq, orden, nombre):
        self.id_proceso = id_proceso
        self.tiempo_proceso = tiempo
        self.cant_operarios = cant
        self.id_maquinaria = maq
        self.orden = orden
        self.proceso = _FakeProceso(nombre)


class _FakeRepo:
    def __init__(self, procs):
        self._procs = procs
        self.calls = []

    async def obtener_historial_procesos(self, id_articulo, excluir_orden_id=None):
        self.calls.append((id_articulo, excluir_orden_id))
        return self._procs


def _make_service(repo):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService
    svc = OrdenTrabajoService.__new__(OrdenTrabajoService)  # sin __init__ (no DB)
    svc.repository = repo
    return svc


async def test_historial_serializa_y_pasa_parametros():
    repo = _FakeRepo([
        _FakeOTP(2, 45, 1, 10, 1, "CORTE LASER"),
        _FakeOTP(3, 90, 2, None, 2, "SOLDADURA MIG"),
    ])
    svc = _make_service(repo)

    resp = await svc.obtenerHistorialProcesos(5, excluir_orden_id=99)

    assert resp.status is True
    # el service reenvía id_articulo y excluir_orden_id al repo
    assert repo.calls == [(5, 99)]
    assert len(resp.data) == 2
    assert resp.data[0] == {
        "id_proceso": 2, "nombre_proceso": "CORTE LASER", "tiempo_proceso": 45,
        "cant_operarios": 1, "id_maquinaria": 10, "orden": 1,
    }
    # sin máquina preseleccionada -> None
    assert resp.data[1]["id_maquinaria"] is None


async def test_historial_vacio_devuelve_lista_vacia():
    svc = _make_service(_FakeRepo([]))
    resp = await svc.obtenerHistorialProcesos(5)
    assert resp.status is True
    assert resp.data == []
