"""
Repositorio de Usuario
Maneja todas las operaciones de base de datos para usuarios usando SQLAlchemy
"""
from typing import Optional, List
from datetime import datetime
from sqlalchemy import select, update
from backend.domain.Usuario import Usuario
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger

class UsuarioRepository:
    """Repositorio para gestionar usuarios en la base de datos"""
    
    def __init__(self, db):
        self.db = db
    
    async def obtener_por_id(self, id_usuario: int) -> Optional[Usuario]:
        """Obtiene un usuario por su ID"""
        try:
            result = await self.db.execute(
                select(Usuario).where(Usuario.id_usuario == id_usuario)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error al obtener usuario por ID {id_usuario}: {str(e)}")
            raise InfrastructureException("Error al obtener usuario por ID") from e
    
    async def obtener_por_username(self, username: str) -> Optional[Usuario]:
        """Obtiene un usuario por su username"""
        try:
            result = await self.db.execute(
                select(Usuario).where(Usuario.username == username)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error al obtener usuario por username {username}: {str(e)}")
            raise InfrastructureException("Error al obtener usuario por username") from e
    
    async def obtener_por_email(self, email: str) -> Optional[Usuario]:
        """Obtiene un usuario por su email"""
        try:
            result = await self.db.execute(
                select(Usuario).where(Usuario.email == email)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error al obtener usuario por email {email}: {str(e)}")
            raise InfrastructureException("Error al obtener usuario por email") from e
    
    async def obtener_todos(self) -> List[Usuario]:
        """Obtiene todos los usuarios"""
        try:
            result = await self.db.execute(
                select(Usuario).order_by(Usuario.fecha_creacion.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error al obtener todos los usuarios: {str(e)}")
            raise InfrastructureException("Error al obtener todos los usuarios") from e
    
    async def obtener_todos(self, incluir_inactivos: bool = False) -> List[Usuario]:
        """Obtiene todos los usuarios"""
        try:
            if incluir_inactivos:
                result = await self.db.execute(select(Usuario))
            else:
                result = await self.db.execute(
                    select(Usuario).where(Usuario.activo == True)
                )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error al obtener todos los usuarios: {str(e)}")
            raise InfrastructureException("Error al obtener todos los usuarios") from e
    
    async def crear(self, usuario: Usuario) -> Usuario:
        """Crea un nuevo usuario"""
        try:
            self.db.add(usuario)
            await self.db.commit()
            await self.db.refresh(usuario)
            logger.info(f"Usuario creado: {usuario.username} (ID: {usuario.id_usuario})")
            return usuario
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al crear usuario {usuario.username}: {str(e)}")
            raise InfrastructureException("Error al crear usuario") from e
    
    async def actualizar(self, usuario: Usuario) -> Usuario:
        """Actualiza un usuario existente"""
        try:
            usuario.fecha_actualizacion = datetime.utcnow()
            await self.db.commit()
            await self.db.refresh(usuario)
            logger.info(f"Usuario actualizado: {usuario.username} (ID: {usuario.id_usuario})")
            return usuario
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al actualizar usuario {usuario.id_usuario}: {str(e)}")
            raise InfrastructureException("Error al actualizar usuario") from e
    
    async def actualizar_password(self, id_usuario: int, password_hash: str, actualizado_por: Optional[int] = None) -> bool:
        """Actualiza la contraseña de un usuario"""
        try:
            await self.db.execute(
                update(Usuario)
                .where(Usuario.id_usuario == id_usuario)
                .values(
                    password_hash=password_hash,
                    reset_token=None,
                    reset_token_expiry=None,
                    fecha_actualizacion=datetime.utcnow(),
                    actualizado_por=actualizado_por
                )
            )
            await self.db.commit()
            logger.info(f"Contraseña actualizada para usuario ID: {id_usuario}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al actualizar contraseña del usuario {id_usuario}: {str(e)}")
            raise InfrastructureException("Error al actualizar contraseña") from e
    
    async def actualizar_ultimo_login(self, id_usuario: int) -> bool:
        """Actualiza la fecha de último login"""
        try:
            await self.db.execute(
                update(Usuario)
                .where(Usuario.id_usuario == id_usuario)
                .values(ultimo_login=datetime.utcnow())
            )
            await self.db.commit()
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al actualizar último login del usuario {id_usuario}: {str(e)}")
            raise InfrastructureException("Error al actualizar último login") from e
    
    async def guardar_reset_token(self, email: str, token: str, expiry: datetime) -> bool:
        """Guarda el token de recuperación de contraseña"""
        try:
            await self.db.execute(
                update(Usuario)
                .where(Usuario.email == email)
                .values(reset_token=token, reset_token_expiry=expiry)
            )
            await self.db.commit()
            logger.info(f"Token de reset guardado para email: {email}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al guardar token de reset para {email}: {str(e)}")
            raise InfrastructureException("Error al guardar token de reset") from e
    
    async def eliminar(self, id_usuario: int) -> bool:
        """Elimina un usuario (soft delete - marca como inactivo)"""
        try:
            await self.db.execute(
                update(Usuario)
                .where(Usuario.id_usuario == id_usuario)
                .values(activo=False)
            )
            await self.db.commit()
            logger.info(f"Usuario eliminado (soft delete) ID: {id_usuario}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al eliminar usuario {id_usuario}: {str(e)}")
            raise InfrastructureException("Error al eliminar usuario") from e
