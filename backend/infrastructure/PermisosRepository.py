"""
Lectura de los permisos de la base (RF-24). Las reglas están en core/permisos.py;
esto sólo junta los datos para una persona y se los pasa a resolver_permisos.

CUÁNTO CUESTA POR PEDIDO

Los permisos se resuelven contra la base EN CADA PEDIDO (no se le cree al token): así
un cambio de rol, un permiso que se da o que vence, o una cuenta que se desactiva
valen desde el pedido siguiente, sin volver a entrar. Para que eso no pese:

- admin (hoy, todos): UNA consulta, la fila del usuario. El admin es admin por regla y
  no se lee ninguna tabla de permisos.
- el resto: la fila del usuario y cinco consultas chicas por clave (rol_area,
  rol_seccion, usuario_area, usuario_seccion y la marca de confidencial).

LO QUE PUEDE FALTAR

`usuario.admin_permanente` es una columna nueva: se lee aparte y, si todavía no existe
(la migración no corrió), vale None — «no se sabe» — sin romper nada. Las tablas de
permisos no se toleran: si no se pueden leer para alguien que no es admin, la consulta
levanta y la dependencia contesta 503. Un permiso que no se pudo leer no abre nada.
"""
from typing import Optional

from sqlalchemy import func, select

from backend.commons.loggers.logger import logger
from backend.core.permisos import (
    ROL_ADMIN,
    DatosDePermisos,
    PermisosUsuario,
    mapa_overrides_vigentes,
    permisos_de,
)
from backend.domain.Permisos import (
    Rol,
    RolArea,
    RolSeccion,
    SeccionPermiso,
    UsuarioArea,
    UsuarioSeccion,
)
from backend.domain.Usuario import Usuario
from backend.infrastructure.auditoria_movimientos import ahora_ar


class PermisosRepository:
    def __init__(self, db):
        self.db = db

    # ─────────────────────────── la persona ───────────────────────────

    async def fila_usuario(self, id_usuario: Optional[int], username: Optional[str]):
        """(id_usuario, username, rol, activo) o None. Sólo columnas que existen seguro:
        esta consulta corre en cada pedido."""
        consulta = select(Usuario.id_usuario, Usuario.username, Usuario.rol, Usuario.activo)
        if id_usuario is not None:
            consulta = consulta.where(Usuario.id_usuario == id_usuario)
        elif username:
            consulta = consulta.where(Usuario.username == username)
        else:
            return None
        return (await self.db.execute(consulta)).first()

    async def admin_permanente(self, id_usuario: int) -> Optional[bool]:
        """True/False, o None si la columna todavía no existe en esta base.

        OJO: si falla, hace rollback de la sesión (en Postgres una consulta fallida
        deja la transacción inservible). Llamarla antes de cargar objetos del ORM que
        se vayan a usar después, o con una sesión propia."""
        try:
            valor = (await self.db.execute(
                select(Usuario.admin_permanente).where(Usuario.id_usuario == id_usuario)
            )).scalar_one_or_none()
        except Exception as e:
            await self.db.rollback()
            logger.warning(
                "Permisos: no se pudo leer usuario.admin_permanente (%s). "
                "¿Falta la migración 2026-09-22_permisos_por_rol_y_area?", e,
            )
            return None
        return None if valor is None else bool(valor)

    # ─────────────────────────── los datos para resolver ───────────────────────────

    async def datos_de_permisos(self, rol: Optional[str], id_usuario: int, activo: bool = True) -> DatosDePermisos:
        """Todo lo que resolver_permisos necesita. Al admin y al inactivo no les lee
        ninguna tabla: la regla ya los decide."""
        if not activo or rol == ROL_ADMIN:
            return DatosDePermisos(rol=rol, activo=activo)

        rol_areas = {
            f.area_codigo: f.nivel
            for f in (await self.db.execute(
                select(RolArea.area_codigo, RolArea.nivel).where(RolArea.rol_codigo == rol)
            )).all()
        }
        rol_secciones = {
            f.seccion_codigo: f.nivel
            for f in (await self.db.execute(
                select(RolSeccion.seccion_codigo, RolSeccion.nivel).where(RolSeccion.rol_codigo == rol)
            )).all()
        }
        ahora = ahora_ar()
        usuario_areas = mapa_overrides_vigentes(
            [dict(f._mapping) for f in (await self.db.execute(
                select(UsuarioArea.area_codigo, UsuarioArea.nivel, UsuarioArea.vence_en)
                .where(UsuarioArea.id_usuario == id_usuario)
            )).all()],
            ahora,
            clave="area_codigo",
        )
        usuario_secciones = mapa_overrides_vigentes(
            [dict(f._mapping) for f in (await self.db.execute(
                select(UsuarioSeccion.seccion_codigo, UsuarioSeccion.nivel, UsuarioSeccion.vence_en)
                .where(UsuarioSeccion.id_usuario == id_usuario)
            )).all()],
            ahora,
            clave="seccion_codigo",
        )
        confidenciales = {
            f.codigo: bool(f.confidencial)
            for f in (await self.db.execute(
                select(SeccionPermiso.codigo, SeccionPermiso.confidencial)
            )).all()
        }
        return DatosDePermisos(
            rol=rol,
            activo=True,
            rol_areas=rol_areas,
            rol_secciones=rol_secciones,
            usuario_areas=usuario_areas,
            usuario_secciones=usuario_secciones,
            confidenciales=confidenciales,
        )

    async def permisos_de_usuario(
        self,
        id_usuario: Optional[int] = None,
        username: Optional[str] = None,
        con_admin_permanente: bool = False,
    ) -> Optional[PermisosUsuario]:
        """Los permisos resueltos de una persona, o None si no existe o está inactiva.

        `con_admin_permanente` suma una consulta (y un posible rollback si la columna
        falta): lo piden /auth/me y el login, no la dependencia de cada pedido.
        """
        fila = await self.fila_usuario(id_usuario, username)
        if fila is None or not fila.activo:
            return None
        admin_permanente = None
        if con_admin_permanente:
            # Primero, antes de leer las tablas: si falla, el rollback no se lleva nada.
            admin_permanente = await self.admin_permanente(fila.id_usuario)
        datos = await self.datos_de_permisos(fila.rol, fila.id_usuario, activo=True)
        return permisos_de(datos, fila.id_usuario, fila.username, admin_permanente)

    # ─────────────────────────── roles y la regla del último admin ───────────────────────────

    async def roles(self) -> Optional[list[tuple[str, str]]]:
        """[(codigo, nombre)], o None si la tabla todavía no existe (hace rollback)."""
        try:
            filas = (await self.db.execute(select(Rol.codigo, Rol.nombre).order_by(Rol.codigo))).all()
        except Exception as e:
            await self.db.rollback()
            logger.warning("Permisos: no se pudo leer la tabla rol (%s).", e)
            return None
        return [(f.codigo, f.nombre) for f in filas]

    async def admins_activos(self, excepto: Optional[int] = None) -> int:
        """Cuántos admins activos hay, sin contar a `excepto`. Es la cuenta que cuida
        que el sistema nunca quede sin nadie que pueda administrarlo."""
        consulta = select(func.count()).select_from(Usuario).where(
            # `== True` como en UsuarioRepository: es lo que ya corre contra Supabase.
            Usuario.rol == ROL_ADMIN, Usuario.activo == True  # noqa: E712
        )
        if excepto is not None:
            consulta = consulta.where(Usuario.id_usuario != excepto)
        return int((await self.db.execute(consulta)).scalar() or 0)
