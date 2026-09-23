"""
Las reglas duras sobre roles y administradores (RF-24). Las usan el ABM de usuarios
(AuthAPI) y la administración de permisos (PermisosAPI): tienen que ser LAS MISMAS por
los dos caminos, o la regla se saltea por el otro.

Todo lo que se lee acá va con una sesión PROPIA (la de los permisos) y no con la del
endpoint: `admin_permanente` y la tabla `rol` pueden no existir todavía (migración sin
correr), y en Postgres una consulta que falla deja inservible la transacción en la que
corrió. Así una lectura que falla no se lleva puesto el guardado.
"""
from fastapi import HTTPException, status

from backend.commons.exceptions.BusinessException import BusinessException
from backend.core.permisos import ROL_ADMIN
from backend.infrastructure.PermisosRepository import PermisosRepository


def conflicto(mensaje: str, campo: str = "rol") -> HTTPException:
    """409: la operación choca con una regla que no se puede saltear (no hay «igual»)."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"message": mensaje, "campo": campo},
    )


async def admin_permanente(sesiones, id_usuario: int):
    """True/False, o None si la columna todavía no existe."""
    async with sesiones() as s:
        return await PermisosRepository(s).admin_permanente(id_usuario)


async def validar_rol(sesiones, rol: str) -> None:
    """Que el rol exista en la tabla `rol`.

    `admin` vale siempre, sin mirar la tabla: es admin por regla, no por su fila, y es
    lo que manda el front de hoy en cada alta.

    Si la tabla todavía no existe (backend nuevo con la migración sin correr), se
    acepta sólo `admin`, que es lo que se aceptaba antes: asignar otro rol sin las
    tablas que lo definen dejaría a esa persona sin ningún permiso."""
    if rol == ROL_ADMIN:
        return
    async with sesiones() as s:
        roles = await PermisosRepository(s).roles()
    if roles is None:
        raise BusinessException(
            "Todavía no se pueden asignar roles distintos de admin: falta que se "
            "actualice la base (migración de permisos)."
        )
    codigos = [c for c, _ in roles]
    if rol not in codigos:
        raise BusinessException(f"El rol '{rol}' no existe. Los que hay: {', '.join(codigos)}.")


async def cuidar_administradores(
    sesiones,
    *,
    id_objetivo: int,
    id_actor: int,
    rol_actual: str,
    activo_actual: bool,
    rol_nuevo: str,
    activo_nuevo: bool,
) -> None:
    """Las reglas duras sobre los administradores. Levanta 409 si alguna se rompe.

    1. Nadie se cambia el rol ni se desactiva a sí mismo (DJ): que lo haga otro admin.
    2. Un administrador permanente no cambia de rol ni se desactiva. Se mira ante
       CUALQUIER cambio de rol, no sólo si deja de ser admin: la marca es «su rol queda
       fijo», y así vale aunque la base tuviera algo raro.
    3. El sistema nunca queda sin ningún admin activo.
    """
    cambia_rol = rol_nuevo != rol_actual
    se_desactiva = bool(activo_actual) and not activo_nuevo
    if id_objetivo == id_actor:
        if cambia_rol:
            raise conflicto("No podés cambiarte tu propio rol: pedíselo a otro administrador.")
        if se_desactiva:
            raise conflicto("No podés desactivar tu propio usuario.", campo="activo")

    if not (cambia_rol or se_desactiva):
        return
    async with sesiones() as s:
        repo = PermisosRepository(s)
        if await repo.admin_permanente(id_objetivo):
            raise conflicto(
                "Es administrador permanente: no se le puede cambiar el rol, ni "
                "desactivarlo, ni eliminarlo."
            )
        deja_de_ser_admin = rol_actual == ROL_ADMIN and bool(activo_actual) and (
            rol_nuevo != ROL_ADMIN or not activo_nuevo
        )
        if deja_de_ser_admin and await repo.admins_activos(excepto=id_objetivo) == 0:
            raise conflicto(
                "Es el único administrador activo: el sistema no puede quedar sin nadie "
                "que lo administre. Hacé admin a otra persona primero."
            )
