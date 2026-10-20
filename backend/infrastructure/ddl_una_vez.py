"""El DDL «por las dudas» de algunos repositorios, una vez por base y por proceso.

Varios repositorios se arreglan solos: antes de leer corren un `CREATE TABLE IF NOT
EXISTS` (y algún `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`) más un COMMIT, por si la tabla todavía no está. Viene de cuando el backend se
desplegaba sin migraciones. El problema es que lo hacían en CADA lectura: GET
/planificacion/borradores, /config/availability, /config/feriados o
/auditoria/planificacion pagaban 3 a 5 idas y vueltas a la base de más, y el ALTER pide
un lock EXCLUSIVO de la tabla aunque la columna ya exista, así que una lectura podía
quedar esperando detrás de otra (medido el 20/10/2026).

Con esto lo hacen una sola vez por proceso y por base: la primera lectura lo corre como
siempre y, si salió bien, las siguientes ya no. Si sale mal se vuelve a intentar en la
próxima, igual que antes. Se recuerda POR MOTOR y no con un flag suelto a propósito: los
tests arman una base nueva en cada uno, y ahí la tabla sí hay que crearla de nuevo.
"""
import weakref

_HECHO: dict[str, "weakref.WeakSet"] = {}


def _motor(db):
    try:
        return db.get_bind()
    except Exception:
        return None


def ya_hecho(db, clave: str) -> bool:
    motor = _motor(db)
    if motor is None:
        return False
    try:
        return motor in _HECHO.get(clave, ())
    except TypeError:
        return False


def marcar_hecho(db, clave: str) -> None:
    motor = _motor(db)
    if motor is None:
        return
    try:
        _HECHO.setdefault(clave, weakref.WeakSet()).add(motor)
    except TypeError:
        pass  # sin weakref no se recuerda: se sigue haciendo cada vez, como antes
