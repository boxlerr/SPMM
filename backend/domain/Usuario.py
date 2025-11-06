"""
Modelo de dominio ORM: Usuario
Representa un usuario del sistema SPMM usando SQLAlchemy
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class Usuario(Base):
    """Entidad Usuario del dominio (SQLAlchemy ORM)"""
    
    __tablename__ = "usuario"
    __table_args__ = {'schema': 'dbo'}
    
    # Campos
    id_usuario = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), nullable=False, unique=True, index=True)
    email = Column(String(100), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    rol = Column(String(20), nullable=False, default="admin")
    activo = Column(Boolean, nullable=False, default=True)
    reset_token = Column(String(255), nullable=True)
    reset_token_expiry = Column(DateTime, nullable=True)
    fecha_creacion = Column(DateTime, nullable=False, default=datetime.utcnow)
    fecha_actualizacion = Column(DateTime, nullable=True, onupdate=datetime.utcnow)
    ultimo_login = Column(DateTime, nullable=True)
    creado_por = Column(Integer, ForeignKey('dbo.usuario.id_usuario'), nullable=True)
    actualizado_por = Column(Integer, ForeignKey('dbo.usuario.id_usuario'), nullable=True)
    
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
            "fecha_creacion": self.fecha_creacion.isoformat() if self.fecha_creacion else None,
            "fecha_actualizacion": self.fecha_actualizacion.isoformat() if self.fecha_actualizacion else None,
            "ultimo_login": self.ultimo_login.isoformat() if self.ultimo_login else None,
            "creado_por": self.creado_por,
            "actualizado_por": self.actualizado_por
        }
    
    def __repr__(self):
        return f"<Usuario {self.username} ({self.email})>"
