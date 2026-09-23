"""
Modelo de dominio ORM: Usuario
Representa un usuario del sistema SPMM usando SQLAlchemy
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, false
from sqlalchemy.orm import deferred, relationship
from backend.infrastructure.db import Base

class Usuario(Base):
    """Entidad Usuario del dominio (SQLAlchemy ORM)"""
    
    __tablename__ = "usuario"
    # Que un INSERT no pida de vuelta las columnas con default de la base: ver
    # `admin_permanente`, que puede no existir todavía cuando se da de alta a alguien.
    __mapper_args__ = {"eager_defaults": False}
    # Sin schema explícito: 'dbo' es el default en SQL Server (igual que el resto de
    # los modelos) y en Postgres/Supabase el schema es 'public'. Hardcodear 'dbo'
    # rompía la creación del esquema en Postgres.

    # Campos
    id_usuario = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), nullable=False, unique=True, index=True)
    email = Column(String(100), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    rol = Column(String(20), nullable=False, default="admin")
    activo = Column(Boolean, nullable=False, default=True)
    # Lo obliga a poner una contraseña suya la primera vez que entra. Se prende al dar
    # de alta a alguien (la contraseña inicial se la pasa otra persona, así que hasta
    # que la cambie está escrita en un chat) y se apaga sola en cuanto la cambia.
    debe_cambiar_password = Column(Boolean, nullable=False, default=False)
    # RF-26: bloqueo tras 5 contraseñas incorrectas SEGUIDAS. `intentos_fallidos` lleva
    # la cuenta (vuelve a 0 con un ingreso bueno o con el desbloqueo del admin) y
    # `bloqueado_hasta` dice hasta cuándo no entra, ni con la clave correcta. NULL o ya
    # pasado = no está bloqueado. Hora local del taller, sin zona. La regla completa
    # está en AuthService.login; la migración, en 2026-09-22_bloqueo_por_intentos_fallidos.
    intentos_fallidos = Column(Integer, nullable=False, default=0, server_default="0")
    bloqueado_hasta = Column(DateTime, nullable=True)
    # RF-24: administrador permanente (los dueños). Su rol queda fijo en admin: no se
    # le puede cambiar, ni desactivar, ni eliminar desde la API. NO lo prende ninguna
    # migración —no se conocen los ids de producción—: se marca a mano en la base.
    #
    # Está armada para que el login y el alta de usuarios NO dependan de que la migración
    # de permisos haya corrido (probado contra un Postgres sin la columna):
    #   · `deferred`: no entra en el SELECT de siempre (el del login). Se lee sólo con
    #     una consulta aparte (PermisosRepository), que tolera que la columna falte.
    #   · `server_default` y SIN default de Python: el INSERT no la nombra; la base
    #     pone el FALSE.
    #   · `eager_defaults: False` (arriba): sin eso, SQLAlchemy la pide de vuelta en el
    #     RETURNING del INSERT, y con la columna ausente el alta revienta.
    # Migración: 2026-09-22_permisos_por_rol_y_area.
    admin_permanente = deferred(Column(Boolean, nullable=False, server_default=false()))
    reset_token = Column(String(255), nullable=True)
    reset_token_expiry = Column(DateTime, nullable=True)
    fecha_creacion = Column(DateTime, nullable=False, default=datetime.utcnow)
    fecha_actualizacion = Column(DateTime, nullable=True, onupdate=datetime.utcnow)
    ultimo_login = Column(DateTime, nullable=True)
    creado_por = Column(Integer, ForeignKey('usuario.id_usuario'), nullable=True)
    actualizado_por = Column(Integer, ForeignKey('usuario.id_usuario'), nullable=True)
    
    def to_dict(self) -> dict:
        """Convierte el usuario a diccionario (sin password_hash)"""
        return {
            "id_usuario": self.id_usuario,
            "username": self.username,
            "email": self.email,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "rol": self.rol,
            "activo": self.activo,
            "debe_cambiar_password": bool(self.debe_cambiar_password),
            "fecha_creacion": self.fecha_creacion.isoformat() if self.fecha_creacion else None,
            "fecha_actualizacion": self.fecha_actualizacion.isoformat() if self.fecha_actualizacion else None,
            "ultimo_login": self.ultimo_login.isoformat() if self.ultimo_login else None,
            "creado_por": self.creado_por,
            "actualizado_por": self.actualizado_por
        }
    
    def __repr__(self):
        return f"<Usuario {self.username} ({self.email})>"
