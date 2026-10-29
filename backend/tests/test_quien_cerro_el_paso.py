"""Cada paso arrancado o cerrado dice quién lo marcó y cuándo.

Lucas, 28/10/2026, en Planificadas: la 15869 tenía el paso 1 (preparación de fresadora)
«finalizado sin motivo y sin quién lo hace». No venía del sistema viejo: lo había
marcado un usuario de SPMM el 23/9, en curso a las 9:44 y completado a las 15:13. El
dato estaba en `auditoria_proceso_ot` y ninguna pantalla de Operaciones lo mostraba.

/ordenes ahora lo manda en `estado_marcado` ({por, en}) para los pasos En curso o
Completado: el último cambio que tocó el estado, venga del camino que venga.
"""
from backend.application.OrdenTrabajoService import OrdenTrabajoService
from backend.infrastructure import auditoria_procesos as auditoria_proc
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.tests.test_fin_real_no_se_pisa import reloj, semana  # noqa: F401 (fixtures)
from backend.tests.test_rendimiento_operario import dia

AGUSTIN = {"id_usuario": 5, "username": "bonna", "nombre": "agustin blAs", "apellido": "bonnaluc"}


async def _marcar(session, reloj, cuando, id_otp, estado, usuario=AGUSTIN):
    reloj.cuando = cuando
    token = auditoria_proc.poner_contexto(usuario=usuario, metodo="PUT",
                                          ruta="/ordenes/10/procesos/0/estado")
    try:
        await OrdenTrabajoRepository(session).update_proceso_status(10, 160, estado, id_otp=id_otp)
    finally:
        auditoria_proc.limpiar_contexto(token)


async def _pasos(session) -> dict:
    r = await OrdenTrabajoService(session).listarOrdenes()
    ot = next(o for o in r.data if o["id"] == 10)
    return {p["id"]: p for p in ot["procesos"]}


async def test_el_paso_cerrado_dice_quien_lo_cerro_y_cuando(semana, reloj):
    await _marcar(semana, reloj, dia(23, 9, 44), 102, 2)
    await _marcar(semana, reloj, dia(23, 15, 13), 102, 3)

    p = (await _pasos(semana))[102]
    assert p["estado_proceso"]["id"] == 3
    # El ÚLTIMO cambio de estado, no el primero: lo cerró a las 15:13.
    assert p["estado_marcado"] == {"por": "agustin blAs bonnaluc", "en": "2026-09-23T15:13:00"}


async def test_reabierto_ya_no_dice_quien_lo_cerro(semana, reloj):
    """Lo que hizo Lucas el 28/10: lo volvió a Pendiente. Un pendiente no explica nada."""
    await _marcar(semana, reloj, dia(23, 9, 44), 102, 2)
    await _marcar(semana, reloj, dia(23, 15, 13), 102, 3)
    await _marcar(semana, reloj, dia(28, 17, 12), 102, 1,
                  usuario={"id_usuario": 7, "nombre": "Lucas", "apellido": "Santa Cruz"})

    assert (await _pasos(semana))[102]["estado_marcado"] is None


async def test_sin_registro_no_se_inventa_autor(semana):
    """Los pasos que ya venían terminados (de la carga inicial, del sistema viejo) no
    tienen renglón en el historial: no se les pone nadie."""
    pasos = await _pasos(semana)
    assert all(p["estado_marcado"] is None for p in pasos.values())


async def test_otro_cambio_del_paso_no_cuenta_como_cambio_de_estado(semana, reloj):
    """Cambiar las observaciones de un paso cerrado no lo «cierra» otra vez."""
    await _marcar(semana, reloj, dia(23, 9, 44), 102, 2)
    await _marcar(semana, reloj, dia(23, 15, 13), 102, 3)
    reloj.cuando = dia(24, 8)
    token = auditoria_proc.poner_contexto(usuario={"nombre": "Otro"}, metodo="PUT",
                                          ruta="/ordenes/10/procesos/0/observaciones")
    try:
        await OrdenTrabajoRepository(semana).update_proceso_observaciones(10, 160, "ojo", id_otp=102)
    finally:
        auditoria_proc.limpiar_contexto(token)

    assert (await _pasos(semana))[102]["estado_marcado"]["por"] == "agustin blAs bonnaluc"
