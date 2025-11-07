"""
API de Autenticación
Endpoints para login, logout, recuperación de contraseña
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer
from backend.infrastructure.db import SessionLocal
from backend.infrastructure.UsuarioRepository import UsuarioRepository
from backend.application.AuthService import AuthService
from backend.dto.UsuarioRequestDTO import (
    LoginRequestDTO, 
    ForgotPasswordDTO, 
    ResetPasswordDTO,
    UsuarioChangePasswordDTO
)
from backend.core.security import get_current_user
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger

router = APIRouter(prefix="/auth", tags=["Autenticación"])
security = HTTPBearer()

# Dependencia para sesión asincrónica
async def get_db():
    async with SessionLocal() as session:
        yield session

@router.post("/login", response_model=ResponseDTO)
async def login(
    credentials: LoginRequestDTO,
    db=Depends(get_db)
):
    """
    Endpoint de login
    
    - **username**: Username o email del usuario
    - **password**: Contraseña
    
    Retorna un JWT token y datos del usuario
    """
    try:
        usuario_repository = UsuarioRepository(db)
        auth_service = AuthService(usuario_repository)
        
        result = await auth_service.login(
            credentials.username,
            credentials.password
        )
        
        return ResponseDTO(
            status=True,
            message="Login exitoso",
            data=result
        )
        
    except BusinessException as e:
        logger.error(f"Error de negocio en login: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"}
        )
    except Exception as e:
        logger.error(f"Error inesperado en login: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al procesar el login"
        )


@router.post("/forgot-password", response_model=ResponseDTO)
async def forgot_password(
    request: ForgotPasswordDTO,
    db=Depends(get_db)
):
    """
    Solicita recuperación de contraseña
    
    - **email**: Email del usuario
    
    Envía un email con el link de recuperación
    """
    try:
        usuario_repository = UsuarioRepository(db)
        auth_service = AuthService(usuario_repository)
        
        await auth_service.solicitar_recuperacion_password(request.email)
        
        # Por seguridad, siempre retornamos el mismo mensaje
        return ResponseDTO(
            status=True,
            message="Si el email existe, recibirás instrucciones para recuperar tu contraseña",
            data=None
        )
        
    except Exception as e:
        # No revelamos si el email existe o no
        logger.error(f"Error en forgot-password: {str(e)}")
        return ResponseDTO(
            status=True,
            message="Si el email existe, recibirás instrucciones para recuperar tu contraseña",
            data=None
        )


@router.post("/reset-password", response_model=ResponseDTO)
async def reset_password(
    request: ResetPasswordDTO,
    db=Depends(get_db)
):
    """
    Resetea la contraseña con un token
    
    - **token**: Token de recuperación
    - **new_password**: Nueva contraseña
    - **confirm_password**: Confirmación de contraseña
    """
    try:
        usuario_repository = UsuarioRepository(db)
        auth_service = AuthService(usuario_repository)
        
        await auth_service.resetear_password(
            request.token,
            request.new_password
        )
        
        return ResponseDTO(
            status=True,
            message="Contraseña actualizada exitosamente",
            data=None
        )
        
    except BusinessException as e:
        logger.error(f"Error de negocio en reset-password: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error inesperado en reset-password: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al resetear la contraseña"
        )


@router.post("/change-password", response_model=ResponseDTO)
async def change_password(
    request: UsuarioChangePasswordDTO,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db)
):
    """
    Cambia la contraseña del usuario autenticado
    
    - **current_password**: Contraseña actual
    - **new_password**: Nueva contraseña
    - **confirm_password**: Confirmación de contraseña
    
    Requiere autenticación (Bearer Token)
    """
    try:
        usuario_repository = UsuarioRepository(db)
        auth_service = AuthService(usuario_repository)
        
        await auth_service.cambiar_password(
            current_user["id_usuario"],
            request.current_password,
            request.new_password
        )
        
        return ResponseDTO(
            status=True,
            message="Contraseña cambiada exitosamente",
            data=None
        )
        
    except BusinessException as e:
        logger.error(f"Error de negocio en change-password: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error inesperado en change-password: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al cambiar la contraseña"
        )


@router.get("/me", response_model=ResponseDTO)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user)
):
    """
    Obtiene información del usuario autenticado
    
    Requiere autenticación (Bearer Token)
    """
    return ResponseDTO(
        status=True,
        message="Usuario autenticado",
        data=current_user
    )


@router.post("/logout", response_model=ResponseDTO)
async def logout(current_user: dict = Depends(get_current_user)):
    """
    Logout (invalida el token en el cliente)
    
    Nota: Con JWT, el logout se maneja en el cliente eliminando el token.
    Este endpoint es principalmente para logging y auditoría.
    """
    logger.info(f"Logout de usuario: {current_user['username']}")
    
    return ResponseDTO(
        status=True,
        message="Logout exitoso",
        data=None
    )


# ==================== ENDPOINTS CRUD DE USUARIOS ====================

@router.get("/usuarios", response_model=ResponseDTO)
async def listar_usuarios(
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista todos los usuarios del sistema
    
    Requiere autenticación (Bearer Token)
    Solo accesible por administradores
    """
    try:
        usuario_repository = UsuarioRepository(db)
        
        # Obtener todos los usuarios
        usuarios = await usuario_repository.obtener_todos()
        
        # Convertir a diccionarios
        usuarios_data = [
            {
                "id_usuario": u.id_usuario,
                "username": u.username,
                "email": u.email,
                "nombre": u.nombre,
                "apellido": u.apellido,
                "rol": u.rol,
                "activo": u.activo,
                "fecha_creacion": u.fecha_creacion.isoformat() if u.fecha_creacion else None,
                "ultimo_login": u.ultimo_login.isoformat() if u.ultimo_login else None
            }
            for u in usuarios
        ]
        
        return ResponseDTO(
            status=True,
            message=f"{len(usuarios_data)} usuario(s) encontrado(s)",
            data=usuarios_data
        )
        
    except Exception as e:
        logger.error(f"Error al listar usuarios: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/usuarios/{id_usuario}", response_model=ResponseDTO)
async def obtener_usuario(
    id_usuario: int,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Obtiene un usuario por ID
    
    Requiere autenticación (Bearer Token)
    """
    try:
        usuario_repository = UsuarioRepository(db)
        usuario = await usuario_repository.obtener_por_id(id_usuario)
        
        if not usuario:
            raise NotFoundException(f"Usuario con ID {id_usuario} no encontrado")
        
        usuario_data = {
            "id_usuario": usuario.id_usuario,
            "username": usuario.username,
            "email": usuario.email,
            "nombre": usuario.nombre,
            "apellido": usuario.apellido,
            "rol": usuario.rol,
            "activo": usuario.activo,
            "fecha_creacion": usuario.fecha_creacion.isoformat() if usuario.fecha_creacion else None,
            "fecha_actualizacion": usuario.fecha_actualizacion.isoformat() if usuario.fecha_actualizacion else None,
            "ultimo_login": usuario.ultimo_login.isoformat() if usuario.ultimo_login else None
        }
        
        return ResponseDTO(
            status=True,
            message="Usuario encontrado",
            data=usuario_data
        )
        
    except NotFoundException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error al obtener usuario: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


from backend.dto.UsuarioRequestDTO import UsuarioCreateDTO, UsuarioUpdateDTO

@router.post("/usuarios", response_model=ResponseDTO)
async def crear_usuario(
    usuario_dto: UsuarioCreateDTO,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Crea un nuevo usuario
    
    Requiere autenticación (Bearer Token)
    Solo accesible por administradores
    """
    try:
        usuario_repository = UsuarioRepository(db)
        auth_service = AuthService(usuario_repository)
        
        # Verificar si ya existe el username
        usuario_existente = await usuario_repository.obtener_por_username(usuario_dto.username)
        if usuario_existente:
            raise BusinessException(f"El username '{usuario_dto.username}' ya está en uso")
        
        # Verificar si ya existe el email
        usuario_existente_email = await usuario_repository.obtener_por_email(usuario_dto.email)
        if usuario_existente_email:
            raise BusinessException(f"El email '{usuario_dto.email}' ya está en uso")
        
        # Crear hash de contraseña
        from backend.core.security import get_password_hash
        password_hash = get_password_hash(usuario_dto.password)
        
        # Crear usuario
        from backend.domain.Usuario import Usuario
        nuevo_usuario = Usuario(
            username=usuario_dto.username,
            email=usuario_dto.email,
            password_hash=password_hash,
            nombre=usuario_dto.nombre,
            apellido=usuario_dto.apellido,
            rol=usuario_dto.rol,
            activo=usuario_dto.activo,
            creado_por=current_user['id_usuario']
        )
        
        usuario_creado = await usuario_repository.crear(nuevo_usuario)
        
        # Crear notificación
        try:
            from backend.application.NotificacionService import NotificacionService
            from backend.dto.NotificacionRequestDTO import NotificacionCreateDTO
            notificacion_service = NotificacionService(db)
            await notificacion_service.crearNotificacion(
                NotificacionCreateDTO(
                    mensaje=f"Usuario '{usuario_creado.username}' ({usuario_creado.nombre} {usuario_creado.apellido}) fue creado exitosamente",
                    tipo="usuario_created",
                    id_usuario_creador=current_user['id_usuario']
                )
            )
        except Exception as e:
            logger.warning(f"No se pudo crear notificación para usuario creado: {str(e)}")
        
        usuario_data = {
            "id_usuario": usuario_creado.id_usuario,
            "username": usuario_creado.username,
            "email": usuario_creado.email,
            "nombre": usuario_creado.nombre,
            "apellido": usuario_creado.apellido,
            "rol": usuario_creado.rol,
            "activo": usuario_creado.activo
        }
        
        return ResponseDTO(
            status=True,
            message=f"Usuario '{usuario_creado.username}' creado exitosamente",
            data=usuario_data
        )
        
    except BusinessException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error al crear usuario: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.put("/usuarios/{id_usuario}", response_model=ResponseDTO)
async def actualizar_usuario(
    id_usuario: int,
    usuario_dto: UsuarioUpdateDTO,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Actualiza un usuario existente
    
    Requiere autenticación (Bearer Token)
    Solo accesible por administradores
    """
    try:
        usuario_repository = UsuarioRepository(db)
        
        # Verificar que existe
        usuario = await usuario_repository.obtener_por_id(id_usuario)
        if not usuario:
            raise NotFoundException(f"Usuario con ID {id_usuario} no encontrado")
        
        # Si se actualiza el username, verificar que no esté en uso
        if usuario_dto.username and usuario_dto.username != usuario.username:
            usuario_existente = await usuario_repository.obtener_por_username(usuario_dto.username)
            if usuario_existente and usuario_existente.id_usuario != id_usuario:
                raise BusinessException(f"El username '{usuario_dto.username}' ya está en uso")
        
        # Si se actualiza el email, verificar que no esté en uso
        if usuario_dto.email and usuario_dto.email != usuario.email:
            usuario_existente_email = await usuario_repository.obtener_por_email(usuario_dto.email)
            if usuario_existente_email and usuario_existente_email.id_usuario != id_usuario:
                raise BusinessException(f"El email '{usuario_dto.email}' ya está en uso")
        
        # Actualizar campos
        if usuario_dto.username:
            usuario.username = usuario_dto.username
        if usuario_dto.email:
            usuario.email = usuario_dto.email
        if usuario_dto.nombre:
            usuario.nombre = usuario_dto.nombre
        if usuario_dto.apellido:
            usuario.apellido = usuario_dto.apellido
        if usuario_dto.rol:
            usuario.rol = usuario_dto.rol
        if usuario_dto.activo is not None:
            usuario.activo = usuario_dto.activo
        
        usuario.actualizado_por = current_user['id_usuario']
        
        usuario_actualizado = await usuario_repository.actualizar(usuario)
        
        # Crear notificación
        try:
            from backend.application.NotificacionService import NotificacionService
            from backend.dto.NotificacionRequestDTO import NotificacionCreateDTO
            notificacion_service = NotificacionService(db)
            await notificacion_service.crearNotificacion(
                NotificacionCreateDTO(
                    mensaje=f"Usuario '{usuario_actualizado.username}' ({usuario_actualizado.nombre} {usuario_actualizado.apellido}) fue modificado",
                    tipo="usuario_updated",
                    id_usuario_creador=current_user['id_usuario']
                )
            )
        except Exception as e:
            logger.warning(f"No se pudo crear notificación para usuario actualizado: {str(e)}")
        
        usuario_data = {
            "id_usuario": usuario_actualizado.id_usuario,
            "username": usuario_actualizado.username,
            "email": usuario_actualizado.email,
            "nombre": usuario_actualizado.nombre,
            "apellido": usuario_actualizado.apellido,
            "rol": usuario_actualizado.rol,
            "activo": usuario_actualizado.activo
        }
        
        return ResponseDTO(
            status=True,
            message=f"Usuario '{usuario_actualizado.username}' actualizado exitosamente",
            data=usuario_data
        )
        
    except NotFoundException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except BusinessException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error al actualizar usuario: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.delete("/usuarios/{id_usuario}", response_model=ResponseDTO)
async def eliminar_usuario(
    id_usuario: int,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Elimina un usuario
    
    Requiere autenticación (Bearer Token)
    Solo accesible por administradores
    No se puede eliminar a sí mismo
    """
    try:
        # Validar que no se elimine a sí mismo
        if id_usuario == current_user['id_usuario']:
            raise BusinessException("No puedes eliminarte a ti mismo")
        
        usuario_repository = UsuarioRepository(db)
        
        # Verificar que existe
        usuario = await usuario_repository.obtener_por_id(id_usuario)
        if not usuario:
            raise NotFoundException(f"Usuario con ID {id_usuario} no encontrado")
        
        # Guardar información antes de eliminar para la notificación
        username_eliminado = usuario.username
        nombre_eliminado = f"{usuario.nombre} {usuario.apellido}"
        
        # Eliminar
        await usuario_repository.eliminar(id_usuario)
        
        # Crear notificación
        try:
            from backend.application.NotificacionService import NotificacionService
            from backend.dto.NotificacionRequestDTO import NotificacionCreateDTO
            notificacion_service = NotificacionService(db)
            await notificacion_service.crearNotificacion(
                NotificacionCreateDTO(
                    mensaje=f"Usuario '{username_eliminado}' ({nombre_eliminado}) fue eliminado",
                    tipo="usuario_deleted",
                    id_usuario_creador=current_user['id_usuario']
                )
            )
        except Exception as e:
            logger.warning(f"No se pudo crear notificación para usuario eliminado: {str(e)}")
        
        return ResponseDTO(
            status=True,
            message=f"Usuario '{username_eliminado}' eliminado exitosamente",
            data={"id_usuario": id_usuario}
        )
        
    except NotFoundException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except BusinessException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error al eliminar usuario: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
