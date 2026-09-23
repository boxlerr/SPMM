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
    vigente,
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

    # ─────────────────────────── administración (PermisosAPI) ───────────────────────────
    #
    # Lo que lee y escribe la pantalla de permisos. Nada de esto hace commit: lo hace el
    # endpoint, una vez, después de mirar todas las reglas.

    async def confidenciales(self) -> dict[str, bool]:
        """{seccion: confidencial} como está en la base. La que no tiene fila vale lo que
        dice el catálogo de código."""
        return {
            f.codigo: bool(f.confidencial)
            for f in (await self.db.execute(
                select(SeccionPermiso.codigo, SeccionPermiso.confidencial)
            )).all()
        }

    async def rol(self, codigo: str):
        return (await self.db.execute(
            select(Rol.codigo, Rol.nombre).where(Rol.codigo == codigo)
        )).first()

    async def niveles_de_roles(self) -> tuple[dict, dict]:
        """({rol: {area: nivel}}, {rol: {seccion: nivel}}) de toda la matriz."""
        areas: dict = {}
        for f in (await self.db.execute(select(RolArea.rol_codigo, RolArea.area_codigo, RolArea.nivel))).all():
            areas.setdefault(f.rol_codigo, {})[f.area_codigo] = f.nivel
        secciones: dict = {}
        for f in (await self.db.execute(
            select(RolSeccion.rol_codigo, RolSeccion.seccion_codigo, RolSeccion.nivel)
        )).all():
            secciones.setdefault(f.rol_codigo, {})[f.seccion_codigo] = f.nivel
        return areas, secciones

    async def usuarios_activos_por_rol(self) -> dict[str, int]:
        filas = (await self.db.execute(
            select(Usuario.rol, func.count()).where(Usuario.activo == True)  # noqa: E712
            .group_by(Usuario.rol)
        )).all()
        return {rol: int(n) for rol, n in filas}

    async def nivel_rol_area(self, rol: str, area: str) -> Optional[str]:
        return (await self.db.execute(
            select(RolArea.nivel).where(RolArea.rol_codigo == rol, RolArea.area_codigo == area)
        )).scalar_one_or_none()

    async def poner_rol_area(self, rol: str, area: str, nivel: str) -> None:
        fila = await self.db.get(RolArea, (rol, area))
        if fila is None:
            self.db.add(RolArea(rol_codigo=rol, area_codigo=area, nivel=nivel))
        else:
            fila.nivel = nivel

    async def nivel_rol_seccion(self, rol: str, seccion: str) -> Optional[str]:
        return (await self.db.execute(
            select(RolSeccion.nivel).where(RolSeccion.rol_codigo == rol,
                                           RolSeccion.seccion_codigo == seccion)
        )).scalar_one_or_none()

    async def poner_rol_seccion(self, rol: str, seccion: str, nivel: Optional[str]) -> None:
        """`nivel=None` saca el override (la sección vuelve a heredar)."""
        fila = await self.db.get(RolSeccion, (rol, seccion))
        if nivel is None:
            if fila is not None:
                await self.db.delete(fila)
        elif fila is None:
            self.db.add(RolSeccion(rol_codigo=rol, seccion_codigo=seccion, nivel=nivel))
        else:
            fila.nivel = nivel

    async def poner_confidencial(self, seccion, confidencial: bool) -> None:
        """Marca o desmarca una sección. `seccion` es la del catálogo de código: si en la
        base todavía no tiene fila, se crea con sus datos (como DJ)."""
        fila = await self.db.get(SeccionPermiso, seccion.codigo)
        if fila is None:
            self.db.add(SeccionPermiso(codigo=seccion.codigo, area_codigo=seccion.area,
                                       nombre=seccion.nombre, orden=seccion.orden,
                                       confidencial=confidencial))
        else:
            fila.confidencial = confidencial

    # ── permisos de más de una persona ──

    async def override(self, modelo, id_usuario: int, codigo: str):
        """La fila de usuario_area / usuario_seccion de esa persona en ese código, o None."""
        columna = modelo.area_codigo if modelo is UsuarioArea else modelo.seccion_codigo
        return (await self.db.execute(
            select(modelo).where(modelo.id_usuario == id_usuario, columna == codigo)
        )).scalar_one_or_none()

    async def poner_override(self, modelo, *, id_usuario: int, codigo: str, nivel: str,
                             vence_en, motivo: Optional[str], otorgado_por: int):
        """Crea o reemplaza el permiso de más. `creado_en` pasa a ser AHORA también al
        reemplazar: la fila es el otorgamiento vigente, y quién, cuándo y por qué tienen
        que ser los de este (el anterior queda en la auditoría)."""
        fila = await self.override(modelo, id_usuario, codigo)
        if fila is None:
            campo = "area_codigo" if modelo is UsuarioArea else "seccion_codigo"
            fila = modelo(id_usuario=id_usuario, **{campo: codigo})
            self.db.add(fila)
        fila.nivel = nivel
        fila.vence_en = vence_en
        fila.motivo = motivo
        fila.otorgado_por = otorgado_por
        fila.creado_en = ahora_ar()
        return fila

    async def overrides(self, id_usuario: Optional[int] = None) -> dict[str, list[dict]]:
        """Los permisos de más, de una persona o de todas, VENCIDOS INCLUIDOS (con
        `vigente` para que la pantalla los muestre tachados: saber que alguien tuvo algo
        hasta ayer también sirve). Con el nombre de quien lo dio."""
        from sqlalchemy.orm import aliased

        ahora = ahora_ar()
        salida: dict[str, list[dict]] = {"areas": [], "secciones": []}
        Quien = aliased(Usuario)
        Otorgo = aliased(Usuario)
        for clave, modelo, columna in (
            ("areas", UsuarioArea, UsuarioArea.area_codigo),
            ("secciones", UsuarioSeccion, UsuarioSeccion.seccion_codigo),
        ):
            consulta = (
                select(modelo.id_usuario, columna.label("codigo"), modelo.nivel, modelo.vence_en,
                       modelo.motivo, modelo.otorgado_por, modelo.creado_en,
                       Quien.username, Quien.nombre, Quien.apellido,
                       Otorgo.nombre.label("otorgo_nombre"), Otorgo.apellido.label("otorgo_apellido"))
                .join(Quien, Quien.id_usuario == modelo.id_usuario)
                .outerjoin(Otorgo, Otorgo.id_usuario == modelo.otorgado_por)
                .order_by(modelo.id_usuario, columna)
            )
            if id_usuario is not None:
                consulta = consulta.where(modelo.id_usuario == id_usuario)
            for f in (await self.db.execute(consulta)).all():
                otorgo = " ".join(p for p in (f.otorgo_nombre, f.otorgo_apellido) if p) or None
                salida[clave].append({
                    "id_usuario": f.id_usuario,
                    "username": f.username,
                    "nombre": f.nombre,
                    "apellido": f.apellido,
                    "codigo": f.codigo,
                    "nivel": f.nivel,
                    "vence_en": f.vence_en.isoformat() if f.vence_en else None,
                    "vigente": vigente(f.vence_en, ahora),
                    "motivo": f.motivo,
                    "otorgado_por": f.otorgado_por,
                    "otorgado_por_nombre": otorgo,
                    "creado_en": f.creado_en.isoformat() if f.creado_en else None,
                })
        return salida
