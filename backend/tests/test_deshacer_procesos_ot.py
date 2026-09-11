"""Deshacer un cambio de procesos tiene que devolver TODO, incluido el avance.

Julián (10/09), después de que el taller frenara la planificación creyendo que el
sistema le había roto los datos: "hacé lo de deshacer cambios de procesos de una OT".

El caso que importa no es el fácil —volver a poner las filas— sino el que se escapa:
una fila que se borró por error y vuelve en Pendiente, con el avance del taller
perdido. Eso no sería deshacer.
"""
import json

import pytest

from backend.application.OrdenTrabajoService import OrdenTrabajoService


FOTO = [
    {"id": 10, "id_proceso": 100, "orden": 1, "tiempo_proceso": 40, "cant_operarios": 1,
     "id_maquinaria": 3, "id_operario": 5, "id_estado": 3, "observaciones": "terminado el martes"},
    {"id": 11, "id_proceso": 200, "orden": 2, "tiempo_proceso": 60, "cant_operarios": 2,
     "id_maquinaria": None, "id_operario": None, "id_estado": 2, "observaciones": None},
]


class _Repo:
    """Repositorio de mentira: guarda con qué lo llamaron."""
    def __init__(self, version):
        self.version = version
        self.recibido = None
        self.motivo = None
        self.usuario = None

    async def obtener_version_procesos(self, id_version):
        return self.version

    async def update_processes_full(self, id_orden, payload, motivo=None, usuario=None):
        self.recibido, self.motivo, self.usuario = payload, motivo, usuario
        return True


def _servicio(version):
    svc = OrdenTrabajoService.__new__(OrdenTrabajoService)
    svc.repository = _Repo(version)
    svc.event_bus = None
    return svc


@pytest.mark.asyncio
async def test_deshacer_devuelve_el_avance_y_las_observaciones():
    svc = _servicio({"id": 1, "id_orden_trabajo": 77, "creado_en": "2026-09-10T21:00:00",
                     "usuario": "Alguien", "motivo": "planificacion", "procesos": FOTO})

    r = await svc.restaurarProcesos(77, 1, usuario={"nombre": "Quien", "apellido": "Deshace"})

    assert r.data["restaurados"] == 2
    enviado = {p["id_otp"]: p for p in svc.repository.recibido}

    # Lo que siempre estuvo: proceso, minutos, cantidad de gente, máquina y persona.
    assert enviado[10]["proceso_id"] == 100
    assert enviado[10]["tiempo_proceso"] == 40
    assert enviado[10]["maquinaria_id"] == 3
    assert enviado[11]["cant_operarios"] == 2

    # Lo que faltaba y es el punto del test: el avance del taller vuelve como estaba.
    assert enviado[10]["id_estado"] == 3, "una fila terminada no puede volver en Pendiente"
    assert enviado[10]["observaciones"] == "terminado el martes"
    assert enviado[11]["id_estado"] == 2

    # La restauración queda registrada como tal, así que deshacer se puede deshacer.
    assert svc.repository.motivo == "restaurar"
    assert svc.repository.usuario == {"nombre": "Quien", "apellido": "Deshace"}


@pytest.mark.asyncio
async def test_deshacer_respeta_el_orden_de_los_pasos():
    """La foto puede venir desordenada; el paso lo define la posición al restaurar."""
    desordenada = list(reversed(FOTO))
    svc = _servicio({"id": 1, "id_orden_trabajo": 77, "creado_en": "x", "usuario": None,
                     "motivo": "edicion", "procesos": desordenada})
    await svc.restaurarProcesos(77, 1)
    assert [p["id_otp"] for p in svc.repository.recibido] == [10, 11]


@pytest.mark.asyncio
async def test_no_se_puede_restaurar_una_version_de_otra_ot():
    """Sin este control, un id de versión equivocado le escribe los procesos de una
    orden ajena encima a esta. Es el peor error posible en esta pantalla."""
    svc = _servicio({"id": 1, "id_orden_trabajo": 99, "creado_en": "x", "usuario": None,
                     "motivo": "edicion", "procesos": FOTO})
    with pytest.raises(Exception, match="otra orden"):
        await svc.restaurarProcesos(77, 1)
    assert svc.repository.recibido is None, "no tiene que haber escrito nada"


@pytest.mark.asyncio
async def test_la_foto_puede_venir_como_texto():
    """Según el driver, JSONB vuelve como dict o como string. Las dos tienen que andar."""
    svc = _servicio({"id": 1, "id_orden_trabajo": 77, "creado_en": "x", "usuario": None,
                     "motivo": "edicion", "procesos": json.dumps(FOTO)})
    r = await svc.restaurarProcesos(77, 1)
    assert r.data["restaurados"] == 2
