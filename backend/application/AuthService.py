"""
Servicio de Autenticación
Maneja login, logout, recuperación de contraseña
"""
from datetime import datetime, timedelta
import time
from typing import Optional
import secrets
from backend.infrastructure.UsuarioRepository import UsuarioRepository
from backend.core.security import verify_password, get_password_hash, create_access_token
from backend.core.config import settings
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger

class AuthService:
    """Servicio de autenticación"""
    
    def __init__(self, usuario_repository: UsuarioRepository):
        self.usuario_repository = usuario_repository
    
    async def login(self, username: str, password: str) -> dict:
        """
        Autentica un usuario y genera un token JWT
        
        Args:
            username: Username o email del usuario
            password: Contraseña en texto plano
            
        Returns:
            dict: Token de acceso y datos del usuario
            
        Raises:
            BusinessException: Si las credenciales son inválidas
        """
        try:
            # Validar credenciales
            start_db = time.time()
            # Buscar usuario por username o email
            usuario = await self.usuario_repository.obtener_por_username(username)
            
            if not usuario:
                # Intentar buscar por email
                usuario = await self.usuario_repository.obtener_por_email(username)
            
            db_time = time.time() - start_db
            logger.info(f"Login Time - DB Lookup for '{username}': {db_time:.4f}s")

            if not usuario:
                logger.error(f"LOGIN FAILED: Usuario '{username}' no encontrado en BD.")
                raise BusinessException("Usuario o contraseña incorrectos")
            
            if not usuario.activo:
                logger.error(f"LOGIN FAILED: Usuario '{username}' inactivo.")
                raise BusinessException("Usuario inactivo. Contacta al administrador")
            
            start_hash = time.time()
            is_valid_password = verify_password(password, usuario.password_hash)
            hash_time = time.time() - start_hash
            logger.info(f"Login Time - Password Hash Verify for '{username}': {hash_time:.4f}s")

            if not is_valid_password:
                logger.error(f"LOGIN FAILED: Password incorrecto para usuario '{username}'.")
                raise BusinessException("Usuario o contraseña incorrectos")
            
            # Actualizar último login
            await self.usuario_repository.actualizar_ultimo_login(usuario.id_usuario)
            
            # Crear token JWT
            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            access_token = create_access_token(
                data={
                    "sub": usuario.username,
                    "id_usuario": usuario.id_usuario,
                    "rol": usuario.rol,
                    "nombre": usuario.nombre,
                    "apellido": usuario.apellido
                },
                expires_delta=access_token_expires
            )
            
            logger.info(f"Login exitoso: {usuario.username}")
            
            # Devolver token y datos del usuario
            usuario_data = usuario.to_dict()
            usuario_data['access_token'] = access_token
            usuario_data['token_type'] = 'bearer'
            usuario_data['expires_in'] = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60  # En segundos
            
            return usuario_data
            
        except BusinessException:
            raise
        except Exception as e:
            logger.error(f"Error en login: {str(e)}")
            raise BusinessException("Error al procesar el login")
    
    async def solicitar_recuperacion_password(self, email: str) -> bool:
        """
        Genera un token de recuperación y lo envía por email
        
        Args:
            email: Email del usuario
            
        Returns:
            bool: True si se envió el email
            
        Raises:
            NotFoundException: Si el usuario no existe
        """
        try:
            usuario = await self.usuario_repository.obtener_por_email(email)
            
            if not usuario:
                # Por seguridad, no revelamos si el email existe o no
                logger.error(f"Solicitud de recuperación para email no existente: {email}")
                raise NotFoundException("Si el email existe, recibirás instrucciones para recuperar tu contraseña")
            
            if not usuario.activo:
                raise BusinessException("Usuario inactivo. Contacta al administrador")
            
            # Generar token único
            reset_token = secrets.token_urlsafe(32)
            expiry = datetime.now() + timedelta(minutes=30)  # 30 minutos
            
            # Guardar token en BD
            await self.usuario_repository.guardar_reset_token(email, reset_token, expiry)
            
            # TODO: Enviar email con Resend
            # Por ahora solo logeamos el token (en producción esto debe enviarse por email)
            logger.info(f"Token de recuperación generado para {email}")
            logger.info(f"URL de recuperación: {settings.FRONTEND_URL}/reset-password?token={reset_token}")
            
            # Aquí iría la integración con Resend
            # await self._enviar_email_recuperacion(usuario, reset_token)
            
            return True
            
        except (BusinessException, NotFoundException):
            raise
        except Exception as e:
            logger.error(f"Error al solicitar recuperación de contraseña: {str(e)}")
            raise BusinessException("Error al procesar la solicitud")
    
    async def resetear_password(self, token: str, new_password: str) -> bool:
        """
        Resetea la contraseña usando un token de recuperación
        
        Args:
            token: Token de recuperación
            new_password: Nueva contraseña
            
        Returns:
            bool: True si se actualizó la contraseña
            
        Raises:
            BusinessException: Si el token es inválido o expiró
        """
        try:
            # Buscar usuario por token
            usuarios = await self.usuario_repository.obtener_todos(incluir_inactivos=True)
            usuario = None
            
            for u in usuarios:
                if u.reset_token == token:
                    usuario = u
                    break
            
            if not usuario:
                raise BusinessException("Token de recuperación inválido")
            
            # Verificar expiración
            if usuario.reset_token_expiry and usuario.reset_token_expiry < datetime.now():
                raise BusinessException("El token de recuperación ha expirado")
            
            # Hashear nueva contraseña
            password_hash = get_password_hash(new_password)
            
            # Actualizar contraseña (esto también limpia el token)
            await self.usuario_repository.actualizar_password(
                usuario.id_usuario, 
                password_hash
            )
            
            logger.info(f"Contraseña reseteada exitosamente para usuario ID: {usuario.id_usuario}")
            return True
            
        except BusinessException:
            raise
        except Exception as e:
            logger.error(f"Error al resetear contraseña: {str(e)}")
            raise BusinessException("Error al resetear la contraseña")
    
    async def cambiar_password(
        self, 
        id_usuario: int, 
        current_password: str, 
        new_password: str
    ) -> bool:
        """
        Cambia la contraseña de un usuario autenticado
        
        Args:
            id_usuario: ID del usuario
            current_password: Contraseña actual
            new_password: Nueva contraseña
            
        Returns:
            bool: True si se cambió la contraseña
            
        Raises:
            BusinessException: Si la contraseña actual es incorrecta
        """
        try:
            usuario = await self.usuario_repository.obtener_por_id(id_usuario)
            
            if not usuario:
                raise NotFoundException("Usuario no encontrado")
            
            # Verificar contraseña actual
            if not verify_password(current_password, usuario.password_hash):
                raise BusinessException("La contraseña actual es incorrecta")
            
            # Hashear nueva contraseña
            password_hash = get_password_hash(new_password)
            
            # Actualizar
            await self.usuario_repository.actualizar_password(
                id_usuario, 
                password_hash, 
                actualizado_por=id_usuario
            )
            
            logger.info(f"Contraseña cambiada exitosamente para usuario ID: {id_usuario}")
            return True
            
        except (BusinessException, NotFoundException):
            raise
        except Exception as e:
            logger.error(f"Error al cambiar contraseña: {str(e)}")
            raise BusinessException("Error al cambiar la contraseña")
