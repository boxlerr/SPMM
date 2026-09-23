"""
API de Autenticación
Endpoints para login, logout, recuperación de contraseña
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
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
from backend.core.security import (
    UsuarioActual,
    get_current_user,
    get_sesiones_permisos,
    get_usuario_actual,
    require_admin,
    require_seccion,
    resolver_permisos_actuales,
)
from backend.application.reglas_de_roles import (
    admin_permanente,
    admins_permanentes,
    conflicto,
    cuidar_administradores,
    validar_rol,
)
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.LoginRechazadoException import LoginRechazadoException
from backend.commons.loggers.logger import logger
from backend.dto.ErrorItemDTO import ErrorItemDTO
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.core.permisos import pantalla_de_inicio
from backend.infrastructure.PermisosRepository import PermisosRepository

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
        
    except InfrastructureException as e:
        # Falla de infraestructura (ej: BD caída). No exponemos el detalle real
        # al usuario final: respondemos 503 con un mensaje genérico.
        logger.error(f"Error de infraestructura en login: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Servicio no disponible. Intenta nuevamente en unos segundos."
        )
    except LoginRechazadoException as e:
        # RF-26: contraseña mala con la cuenta de intentos, o cuenta bloqueada (423).
        # Misma forma que cualquier error —status false y el mensaje en errors[0]—, así
        # un front que no sabe nada del bloqueo muestra el mensaje y alcanza. Lo único
        # que suma es `data`, para que la pantalla de login pinte el bloqueo distinto.
        logger.error(f"Login rechazado ({e.estado_http}): {e.message}")
        return JSONResponse(
            status_code=e.estado_http,
            content=ResponseDTO(
                status=False,
                data=e.datos(),
                errors=[ErrorItemDTO(message=e.message, campo="global")],
            ).model_dump(),
            headers={"WWW-Authenticate": "Bearer"},
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
    current_user: dict = Depends(get_current_user),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    sesiones=Depends(get_sesiones_permisos),
):
    """
    Obtiene información del usuario autenticado, con sus permisos YA RESUELTOS.

    RF-24. Todo sale de la base en este momento, no del token: el `rol` es el de hoy y
    `permisos` trae el nivel efectivo por área y por sección (none/read/write/admin),
    con las reglas de core/permisos.py. Es lo que la pantalla vuelve a pedir para que
    un cambio de permisos se vea sin volver a entrar.

    - 401 si la cuenta ya no existe o está inactiva.
    - 503 si los permisos no se pudieron leer (la pantalla se queda con los que tenía).

    Requiere autenticación (Bearer Token)
    """
    permisos = await resolver_permisos_actuales(usuario, sesiones)
    admin_permanente = await _admin_permanente(sesiones, usuario.id_usuario)
    return ResponseDTO(
        status=True,
        message="Usuario autenticado",
        data={
            **current_user,
            "rol": usuario.rol,
            "permisos": {**permisos.como_dict(), "admin_permanente": admin_permanente},
            # RF-28: la pantalla fijada (la suya pisa la de su rol), o None. La pantalla la
            # usa sólo si la puede abrir (lib/permisos.ts, rutaInicio).
            "pantalla_inicio": await _pantalla_de_inicio(sesiones, usuario.id_usuario),
        },
    )


# ==================== PANTALLA DE INICIO (RF-28) ====================
#
# usuario.pantalla_inicio y rol.pantalla_inicio pueden no existir todavía (migración sin
# correr). Se leen con una sesión PROPIA, antes que nada, y si no se pueden leer valen
# None —el inicio de siempre—: nunca tumban /auth/me ni la lista de usuarios.


async def _pantalla_de_inicio(sesiones, id_usuario: int):
    """La fijada para esa persona (la suya o la de su rol), o None."""
    try:
        async with sesiones() as s:
            leidas = await PermisosRepository(s).pantalla_inicio(id_usuario)
    except Exception as e:
        logger.warning(f"No se pudo leer la pantalla de inicio de #{id_usuario}: {e}")
        return None
    return None if leidas is None else pantalla_de_inicio(*leidas)


async def _pantallas_de_inicio_de_usuarios(sesiones):
    """{id_usuario: la suya}, o None si no se sabe (la columna todavía no existe)."""
    try:
        async with sesiones() as s:
            return await PermisosRepository(s).pantallas_inicio_de_usuarios()
    except Exception as e:
        logger.warning(f"No se pudieron leer las pantallas de inicio: {e}")
        return None


# ==================== REGLAS DE ROLES (RF-24) ====================
#
# Viven en application/reglas_de_roles.py porque la administración de permisos
# (PermisosAPI, que también cambia roles) tiene que aplicar LAS MISMAS: una regla que
# vale por un camino y no por el otro no es una regla. Los nombres de siempre quedan
# acá como alias.
_conflicto = conflicto
_admin_permanente = admin_permanente
_validar_rol = validar_rol
_cuidar_administradores = cuidar_administradores


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

def _estado_de_bloqueo(u, ahora=None) -> dict:
    """RF-26: lo que la tabla de usuarios necesita para mostrar el bloqueo.

    `bloqueado` lo decide el servidor, con SU reloj: si lo calculara el navegador
    comparando `bloqueado_hasta` con su hora, una PC con la hora corrida mostraría
    bloqueado a alguien que ya puede entrar (o al revés). Un bloqueo vencido se
    informa como no bloqueado aunque la fila todavía no se haya limpiado: se limpia
    sola en el próximo intento de entrar.
    """
    ahora = ahora or ahora_ar()
    hasta = u.bloqueado_hasta
    bloqueado = hasta is not None and hasta > ahora
    # Un bloqueo que ya venció arranca de cero en el próximo intento (AuthService).
    vencido = hasta is not None and not bloqueado
    return {
        "bloqueado": bloqueado,
        "bloqueado_hasta": hasta.isoformat() if bloqueado else None,
        "intentos_fallidos": 0 if vencido else (u.intentos_fallidos or 0),
    }


# RF-24. VER usuarios es la sección «Usuarios y permisos» de Configuración, que es
# CONFIDENCIAL: cerrada para todo el que no sea admin salvo que se le otorgue a
# propósito. CAMBIARLOS (alta, edición, baja, desbloqueo) es sólo del admin: es el
# «admin del área de sistema» —nivel admin en Configuración, que la API de permisos no
# le deja dar a nadie más que al rol Administrador—, porque quien puede tocar usuarios
# se hace admin solo. Por eso esos endpoints siguen con require_admin (que mira la
# base, no el token).
_ver_usuarios = require_seccion("configuracion_usuarios")


async def _ver_un_usuario(
    id_usuario: int,
    usuario: UsuarioActual = Depends(get_usuario_actual),
    sesiones=Depends(get_sesiones_permisos),
):
    """Los datos de UNA persona: los ve quien ve la lista, y cada uno los suyos (los
    mismos que ya le da /auth/me)."""
    if usuario.id_usuario == id_usuario:
        return
    permisos = await resolver_permisos_actuales(usuario, sesiones)
    if not permisos.tiene_seccion("configuracion_usuarios"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"message": "No tenés permiso para ver «Usuarios y permisos» (Configuración).",
                    "campo": "permiso"},
        )


@router.get("/usuarios", response_model=ResponseDTO, dependencies=[Depends(_ver_usuarios)])
async def listar_usuarios(
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user),
    sesiones=Depends(get_sesiones_permisos),
):
    """
    Lista todos los usuarios del sistema
    
    Requiere autenticación (Bearer Token)
    RF-24: pide ver la sección «Usuarios y permisos» (el admin la tiene siempre).

    `admin_permanente` va para que la pantalla ponga el candado en el selector de rol
    (DJ admins-permanentes.ts): True/False, o None si la columna todavía no existe en
    esa base (migración sin correr). Se lee ANTES y con su propia sesión: si la columna
    falta, esa consulta no se lleva puesta la de la lista.

    `pantalla_inicio` (RF-28), igual: la de cada persona, leída antes y aparte; si la
    columna falta, la clave no viene.
    """
    try:
        permanentes = await admins_permanentes(sesiones)
        pantallas = await _pantallas_de_inicio_de_usuarios(sesiones)
        usuario_repository = UsuarioRepository(db)
        
        # Obtener todos los usuarios
        usuarios = await usuario_repository.obtener_todos()
        
        # Convertir a diccionarios
        ahora = ahora_ar()
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
                "ultimo_login": u.ultimo_login.isoformat() if u.ultimo_login else None,
                **_estado_de_bloqueo(u, ahora),
                "admin_permanente": None if permanentes is None else u.id_usuario in permanentes,
                # RF-28: la suya (None = como su rol). La clave NO viene si no se pudo
                # leer (migración sin correr): así la pantalla sabe que no la puede
                # ofrecer, en vez de confundirlo con «no tiene».
                **({} if pantallas is None else {
                    "pantalla_inicio": pantalla_de_inicio(pantallas.get(u.id_usuario), None)
                }),
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


@router.get("/usuarios/{id_usuario}", response_model=ResponseDTO,
            dependencies=[Depends(_ver_un_usuario)])
async def obtener_usuario(
    id_usuario: int,
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Obtiene un usuario por ID
    
    Requiere autenticación (Bearer Token)
    RF-24: el propio, o cualquiera si se ve la sección «Usuarios y permisos». Hasta el
    22/09 lo podía pedir cualquiera con sesión, de cualquiera.
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
            "ultimo_login": usuario.ultimo_login.isoformat() if usuario.ultimo_login else None,
            **_estado_de_bloqueo(usuario),
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
    current_user: dict = Depends(require_admin),
    sesiones=Depends(get_sesiones_permisos),
):
    """
    Crea un nuevo usuario
    
    Requiere autenticación (Bearer Token)
    Solo accesible por administradores

    RF-24: el rol tiene que existir en la tabla `rol` (admin, supervisor, operario...).
    """
    try:
        # Antes de tocar la sesión del endpoint (ver _validar_rol).
        await _validar_rol(sesiones, usuario_dto.rol)

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
            # La contraseña inicial la elige quien da de alta y se la pasa por chat, así
            # que hasta que el dueño de la cuenta ponga una suya está escrita en algún
            # lado. La primera vez que entre, el sistema no lo deja seguir sin cambiarla.
            debe_cambiar_password=True,
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
        
    except HTTPException:
        raise
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
    current_user: dict = Depends(require_admin),
    sesiones=Depends(get_sesiones_permisos),
):
    """
    Actualiza un usuario existente
    
    Requiere autenticación (Bearer Token)
    Solo accesible por administradores

    RF-24, además: el rol tiene que existir; nadie se cambia el rol ni se desactiva a sí
    mismo; un administrador permanente sigue siendo admin y activo; y el sistema nunca
    queda sin ningún admin activo (409 si alguna se rompe).
    """
    try:
        usuario_repository = UsuarioRepository(db)
        
        # Verificar que existe
        usuario = await usuario_repository.obtener_por_id(id_usuario)
        if not usuario:
            raise NotFoundException(f"Usuario con ID {id_usuario} no encontrado")

        # RF-24. Se mira ANTES de tocar nada del objeto. Las lecturas van con su propia
        # sesión, así que no pueden dejar inservible la de este guardado.
        rol_nuevo = usuario_dto.rol or usuario.rol
        activo_nuevo = usuario.activo if usuario_dto.activo is None else usuario_dto.activo
        if rol_nuevo != usuario.rol:
            await _validar_rol(sesiones, rol_nuevo)
        await _cuidar_administradores(
            sesiones,
            id_objetivo=id_usuario,
            id_actor=current_user['id_usuario'],
            rol_actual=usuario.rol,
            activo_actual=usuario.activo,
            rol_nuevo=rol_nuevo,
            activo_nuevo=activo_nuevo,
        )
        
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
        
    except HTTPException:
        raise
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
    current_user: dict = Depends(require_admin),
    sesiones=Depends(get_sesiones_permisos),
):
    """
    Elimina un usuario
    
    Requiere autenticación (Bearer Token)
    Solo accesible por administradores
    No se puede eliminar a sí mismo

    RF-24, además: un administrador permanente no se elimina, y el sistema nunca queda
    sin ningún admin activo (409).
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

        # RF-24. Eliminar es desactivar (soft delete): mismas reglas que desactivarlo.
        await _cuidar_administradores(
            sesiones,
            id_objetivo=id_usuario,
            id_actor=current_user['id_usuario'],
            rol_actual=usuario.rol,
            activo_actual=usuario.activo,
            rol_nuevo=usuario.rol,
            activo_nuevo=False,
        )
        
        # Guardar información antes de eliminar para la notificación
        username_eliminado = usuario.username
        nombre_eliminado = f"{usuario.nombre} {usuario.apellido}"
        
        # Eliminar (soft delete)
        await usuario_repository.eliminar(id_usuario, eliminado_por=current_user['id_usuario'])
        
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
        
    except HTTPException:
        raise
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


@router.post("/usuarios/{id_usuario}/desbloquear", response_model=ResponseDTO)
async def desbloquear_usuario(
    id_usuario: int,
    db=Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    """
    Levanta el bloqueo por intentos fallidos (RF-26) y deja la cuenta en cero.

    El bloqueo es de 15 minutos y se levanta solo; esto es para no tener a alguien
    esperando en el taller. Solo administradores. Quién lo hizo queda en la auditoría
    (lo anota el middleware: «desbloqueó usuario #3»).
    """
    try:
        resultado = await AuthService(UsuarioRepository(db)).desbloquear(id_usuario)
        logger.info(
            f"Usuario {resultado['username']} desbloqueado por {current_user.get('username')}"
        )
        return ResponseDTO(
            status=True,
            message=(
                f"Usuario '{resultado['username']}' desbloqueado: ya puede entrar."
                if resultado["estaba_bloqueado"]
                else f"Usuario '{resultado['username']}' no estaba bloqueado; su cuenta de intentos quedó en cero."
            ),
            data=resultado,
        )
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Error al desbloquear usuario {id_usuario}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo desbloquear el usuario"
        )
