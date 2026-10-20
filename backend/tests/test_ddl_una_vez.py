"""El DDL «por las dudas» de los repositorios corre UNA vez por base, no en cada lectura.

20/10/2026: GET /planificacion/borradores, /config/availability, /config/feriados y
/auditoria/planificacion corrían CREATE TABLE IF NOT EXISTS (+ CREATE INDEX, y el de los
intentos un ALTER TABLE que pide lock exclusivo) y un COMMIT en cada pedido. Ver
backend/infrastructure/ddl_una_vez.py.

Con una sesión de mentira: el DDL de esos repositorios es de Postgres y SQLite no lo
entiende (falla siempre, que es justo el caso de «se vuelve a intentar»).
"""
from backend.infrastructure.AuditoriaRepository import AuditoriaRepository
from backend.infrastructure.DiaBloqueadoRepository import DiaBloqueadoRepository
from backend.infrastructure.PlanificacionBorradorRepository import PlanificacionBorradorRepository
from backend.infrastructure.ddl_una_vez import marcar_hecho, ya_hecho


class Motor:
    """Lo que devuelve get_bind(): sólo importa que sea un objeto distinto por base."""


class Sesion:
    def __init__(self, motor, falla=False):
        self.motor, self.falla, self.sentencias, self.commits = motor, falla, [], 0

    def get_bind(self):
        return self.motor

    async def execute(self, sentencia, *a, **k):
        texto = " ".join(str(sentencia).split())
        self.sentencias.append(texto)
        if self.falla:
            raise RuntimeError("la base no contesta")

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass


def test_se_recuerda_por_base():
    a, b = Motor(), Motor()
    sa, sb = Sesion(a), Sesion(b)
    assert not ya_hecho(sa, "x")
    marcar_hecho(sa, "x")
    assert ya_hecho(sa, "x") and ya_hecho(Sesion(a), "x")
    assert not ya_hecho(sb, "x")      # otra base: hay que hacerlo de nuevo
    assert not ya_hecho(sa, "otra")   # otra tabla: también


async def test_cada_repositorio_corre_su_ddl_una_sola_vez():
    for Repo, tabla in ((DiaBloqueadoRepository, "dia_bloqueado"),
                        (PlanificacionBorradorRepository, "planificacion_borrador"),
                        (AuditoriaRepository, "planificacion_intento")):
        motor = Motor()
        sesiones = [Sesion(motor) for _ in range(3)]
        for s in sesiones:
            await Repo(s)._ensure_tabla()
        ddl = [x for s in sesiones for x in s.sentencias if tabla in x]
        assert ddl and all(tabla in x for x in sesiones[0].sentencias), Repo.__name__
        assert sesiones[1].sentencias == [] and sesiones[2].sentencias == [], Repo.__name__


async def test_si_el_ddl_falla_se_vuelve_a_intentar():
    motor = Motor()
    for _ in range(2):
        s = Sesion(motor, falla=True)
        await DiaBloqueadoRepository(s)._ensure_tabla()
        assert any("CREATE TABLE IF NOT EXISTS dia_bloqueado" in x for x in s.sentencias)
    # y cuando por fin sale, ya no se repite
    s = Sesion(motor)
    await DiaBloqueadoRepository(s)._ensure_tabla()
    s2 = Sesion(motor)
    await DiaBloqueadoRepository(s2)._ensure_tabla()
    assert s.sentencias and s2.sentencias == []
