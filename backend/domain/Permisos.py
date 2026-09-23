"""
Modelos ORM de los permisos por rol, área y sección (RF-24).

Las reglas NO están acá: están en core/permisos.py, puras y testeadas. Esto es sólo
la forma de las tablas, para leerlas (infrastructure/PermisosRepository.py) y para
que los tests las creen en SQLite.

Migración: backend/scripts/migrations/2026-09-22_permisos_por_rol_y_area.sql

Detalles que valen para todas:

- El nivel es VARCHAR + CHECK y no un ENUM de Postgres: los tests corren en SQLite y
  un ENUM no se agrega ni se cambia sin reescribir el tipo.
- Los roles se apuntan por CÓDIGO (el mismo string que `usuario.rol`), no por un id:
  así la tabla `usuario` no se reescribe y un token viejo sigue diciendo algo que se
  entiende.
- `usuario.rol` NO lleva FK a `rol` a propósito: agregarla valida todas las filas de
  `usuario` al migrar, y una sola con un rol raro frenaría la migración entera (y con
  ella el arranque de los permisos). Un rol que no está en la tabla resuelve a «sin
  permisos» (salvo `admin`, que es admin por regla).
- Las fechas (vence_en, creado_en) son hora local del taller y sin zona, como todas
  las de esta base. Ninguna lleva DEFAULT now() en la base: el servidor de Supabase
  está en UTC y la guardaría corrida tres horas.
"""
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
)
from sqlalchemy.orm import deferred

from backend.infrastructure.db import Base
from backend.infrastructure.auditoria_movimientos import ahora_ar

_NIVEL_CHECK = "nivel IN ('none', 'read', 'write', 'admin')"


class AreaPermiso(Base):
    """Un área del sistema = un ítem del menú. El catálogo vive en core/permisos.py
    (AREAS); esto lo espeja para que la matriz tenga contra qué apuntar."""

    __tablename__ = "area"

    codigo = Column(String(40), primary_key=True)
    nombre = Column(String(80), nullable=False)
    orden = Column(Integer, nullable=False, default=0, server_default="0")


class SeccionPermiso(Base):
    """Una sección: una solapa o una parte sensible de una pantalla. Hereda el nivel
    de su área salvo que sea confidencial."""

    __tablename__ = "seccion"

    codigo = Column(String(40), primary_key=True)
    area_codigo = Column(String(40), ForeignKey("area.codigo", ondelete="CASCADE"), nullable=False)
    nombre = Column(String(80), nullable=False)
    orden = Column(Integer, nullable=False, default=0, server_default="0")
    # Confidencial = cerrada para todo el que no sea admin aunque tenga el área, salvo
    # que se le otorgue a propósito (por rol o por persona). Editable: si una sección
    # no tiene fila, vale lo que dice el catálogo de código.
    confidencial = Column(Boolean, nullable=False, default=False, server_default=false())


class Rol(Base):
    __tablename__ = "rol"
    # Que un INSERT no pida de vuelta `pantalla_inicio` (ver abajo): puede no existir.
    __mapper_args__ = {"eager_defaults": False}

    # El mismo código que se guarda en usuario.rol (String(20)).
    codigo = Column(String(20), primary_key=True)
    nombre = Column(String(80), nullable=False)
    # RF-28: la pantalla de inicio de los de este rol que no tienen una propia. NULL = el
    # inicio de siempre. `deferred`, leída aparte (PermisosRepository) y con default NULL de
    # la base para que un INSERT no la nombre, igual que usuario.pantalla_inicio (ver el
    # porqué en domain/Usuario.py): la agrega una migración posterior
    # (2026-09-22_pantalla_de_inicio) y nada de lo que lee o crea roles puede depender de ella.
    pantalla_inicio = deferred(Column(String(80), nullable=True, server_default=text("NULL")))


class RolArea(Base):
    """El nivel de un rol en un área. Sin fila = none."""

    __tablename__ = "rol_area"
    __table_args__ = (CheckConstraint(_NIVEL_CHECK, name="ck_rol_area_nivel"),)

    rol_codigo = Column(String(20), ForeignKey("rol.codigo", ondelete="CASCADE"), primary_key=True)
    area_codigo = Column(String(40), ForeignKey("area.codigo", ondelete="CASCADE"), primary_key=True)
    nivel = Column(String(10), nullable=False)


class RolSeccion(Base):
    """Override de un rol en una sección. En una no confidencial sólo RESTRINGE (nunca
    sube por encima del área); en una confidencial es lo que la abre."""

    __tablename__ = "rol_seccion"
    __table_args__ = (CheckConstraint(_NIVEL_CHECK, name="ck_rol_seccion_nivel"),)

    rol_codigo = Column(String(20), ForeignKey("rol.codigo", ondelete="CASCADE"), primary_key=True)
    seccion_codigo = Column(String(40), ForeignKey("seccion.codigo", ondelete="CASCADE"), primary_key=True)
    nivel = Column(String(10), nullable=False)


class UsuarioArea(Base):
    """Permiso de más para UNA persona en un área, con vencimiento opcional. Sólo suma
    sobre lo que le da el rol; si vence_en ya pasó, no cuenta."""

    __tablename__ = "usuario_area"
    __table_args__ = (
        UniqueConstraint("id_usuario", "area_codigo", name="ux_usuario_area"),
        CheckConstraint(_NIVEL_CHECK, name="ck_usuario_area_nivel"),
    )

    # BIGSERIAL en Postgres; en SQLite (tests) INTEGER, el único que numera solo.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_usuario = Column(Integer, ForeignKey("usuario.id_usuario", ondelete="CASCADE"), nullable=False)
    area_codigo = Column(String(40), ForeignKey("area.codigo", ondelete="CASCADE"), nullable=False)
    nivel = Column(String(10), nullable=False)
    vence_en = Column(DateTime, nullable=True)
    otorgado_por = Column(Integer, ForeignKey("usuario.id_usuario", ondelete="SET NULL"), nullable=True)
    motivo = Column(Text, nullable=True)
    creado_en = Column(DateTime, nullable=False, default=ahora_ar)


class UsuarioSeccion(Base):
    """Permiso de más para UNA persona en una sección (abre una confidencial sin
    abrírsela a todo el rol). Sólo suma y respeta vence_en."""

    __tablename__ = "usuario_seccion"
    __table_args__ = (
        UniqueConstraint("id_usuario", "seccion_codigo", name="ux_usuario_seccion"),
        CheckConstraint(_NIVEL_CHECK, name="ck_usuario_seccion_nivel"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_usuario = Column(Integer, ForeignKey("usuario.id_usuario", ondelete="CASCADE"), nullable=False)
    seccion_codigo = Column(String(40), ForeignKey("seccion.codigo", ondelete="CASCADE"), nullable=False)
    nivel = Column(String(10), nullable=False)
    vence_en = Column(DateTime, nullable=True)
    otorgado_por = Column(Integer, ForeignKey("usuario.id_usuario", ondelete="SET NULL"), nullable=True)
    motivo = Column(Text, nullable=True)
    creado_en = Column(DateTime, nullable=False, default=ahora_ar)


TABLAS_DE_PERMISOS = [
    AreaPermiso.__table__,
    SeccionPermiso.__table__,
    Rol.__table__,
    RolArea.__table__,
    RolSeccion.__table__,
    UsuarioArea.__table__,
    UsuarioSeccion.__table__,
]
