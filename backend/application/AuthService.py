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
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.LoginRechazadoException import LoginRechazadoException
from backend.commons.loggers.logger import logger
from backend.infrastructure import auditoria_movimientos as auditoria
from backend.infrastructure.auditoria_movimientos import ahora_ar

# ───────────── RF-26: bloqueo tras intentos fallidos ─────────────
#
# El SRS pide «bloquear el acceso tras 5 intentos fallidos consecutivos». Lo que no
# dice es por cuánto tiempo, y eso se decidió acá con la opción conservadora, PENDIENTE
# DE CONFIRMAR con el taller:
#
#   · TEMPORAL, 15 minutos, y se levanta solo. Un bloqueo permanente que sólo saque un
#     administrador es más estricto, pero puede dejar a Lucas afuera en el taller justo
#     cuando no hay nadie para destrabarlo — y si el bloqueado es el único admin, no lo
#     destraba nadie sin tocar la base.
#   · Un administrador lo puede levantar antes: «Desbloquear» en Configuración ›
#     Usuarios (POST /auth/usuarios/{id}/desbloquear).
#   · «Consecutivos» = sin un ingreso bueno en el medio. Entrar bien vuelve la cuenta a
#     cero; el tiempo solo, no (tres errores hoy y dos mañana son cinco).
#   · Mientras está bloqueada no se mira la contraseña —ni la correcta entra— y los
#     intentos no suman ni estiran el plazo.
#   · Cuando el plazo vence, la cuenta arranca de cero: 5 intentos nuevos, no 1.
#
# Un usuario que NO existe recibe el mismo «Usuario o contraseña incorrectos» de
# siempre, sin cuenta de intentos: no se lleva registro de nombres que no existen.
#
# OJO, también PENDIENTE: a un usuario que SÍ existe se le dice cuántos intentos le
# quedan, así que por contraste el mensaje deja saber si un nombre existe. Se hizo así
# porque se pidió mostrar los intentos. Si se quiere cerrar eso, lo simple es no decir
# la cuenta (sólo avisar que al 5º error se bloquea) y dejar el mensaje del bloqueo.
MAX_INTENTOS_FALLIDOS = 5
MINUTOS_DE_BLOQUEO = 15


def _al_minuto_siguiente(momento: datetime) -> datetime:
    """Redondea para arriba al minuto entero.

    El mensaje dice «hasta las 21:02». Si el bloqueo terminara en 21:02:49, quien
    vuelve a probar a las 21:02 —que es lo que le dijimos— lo encuentra bloqueado y
    con el mismo cartel. Redondeado, dura entre 15 y 16 minutos y la hora que se lee
    es exacta.
    """
    entero = momento.replace(second=0, microsecond=0)
    return entero if entero == momento else entero + timedelta(minutes=1)


def _cuando(hasta: datetime, ahora: datetime) -> str:
    """«las 14:35», o «el 23/09 a las 00:05» si el bloqueo cruza la medianoche."""
    if hasta.date() == ahora.date():
        return f"las {hasta:%H:%M}"
    return f"el {hasta:%d/%m} a las {hasta:%H:%M}"


def _te_quedan(restantes: int) -> str:
    if restantes == 1:
        return (f"Te queda 1 intento: si volvés a equivocarte, la cuenta se bloquea "
                f"{MINUTOS_DE_BLOQUEO} minutos.")
    return (f"Te quedan {restantes} intentos antes de que la cuenta se bloquee "
            f"{MINUTOS_DE_BLOQUEO} minutos.")


class AuthService:
    """Servicio de autenticación"""

    def __init__(self, usuario_repository: UsuarioRepository):
        self.usuario_repository = usuario_repository

    async def _contar_intento_fallido(self, usuario, ahora: datetime):
        """Suma la contraseña mala y rechaza el login. Nunca vuelve: siempre levanta.

        Si con ésta llega a MAX_INTENTOS_FALLIDOS, la cuenta queda bloqueada y se anota
        en la auditoría. La anota sólo el intento que cruzó la raya (el 5º): si llegan
        dos juntos, el otro ve 6 y no repite la fila.
        """
        # Todo lo que hace falta del usuario se lee ANTES de escribir: si la fila de
        # auditoría falla, el rollback expira el objeto y releerlo en async revienta.
        id_usuario = usuario.id_usuario
        quien = usuario.username
        nombre = " ".join(p for p in (usuario.nombre, usuario.apellido) if p).strip()

        hasta_si_bloquea = _al_minuto_siguiente(ahora + timedelta(minutes=MINUTOS_DE_BLOQUEO))
        intentos, hasta = await self.usuario_repository.registrar_intento_fallido(
            id_usuario, MAX_INTENTOS_FALLIDOS, hasta_si_bloquea, ahora
        )

        if intentos < MAX_INTENTOS_FALLIDOS:
            restantes = MAX_INTENTOS_FALLIDOS - intentos
            raise LoginRechazadoException(
                f"Usuario o contraseña incorrectos. {_te_quedan(restantes)}",
                estado_http=401,
                intentos_restantes=restantes,
                maximo_intentos=MAX_INTENTOS_FALLIDOS,
                minutos_bloqueo=MINUTOS_DE_BLOQUEO,
            )

        hasta = hasta or hasta_si_bloquea
        logger.warning(f"LOGIN: Usuario '{quien}' bloqueado hasta {hasta} ({intentos} intentos).")
        if intentos == MAX_INTENTOS_FALLIDOS:
            await auditoria.registrar_evento(
                self.usuario_repository.db,
                accion="bloqueó",
                entidad="usuario",
                id_entidad=str(id_usuario),
                descripcion=(
                    f"Se bloqueó el usuario {quien}"
                    + (f" ({nombre})" if nombre else "")
                    + f" hasta {_cuando(hasta, ahora)} por {MAX_INTENTOS_FALLIDOS} "
                    f"intentos fallidos seguidos"
                ),
                metodo="POST",
                ruta="/auth/login",
                detalle={
                    "username": quien,
                    "intentos_fallidos": intentos,
                    "bloqueado_hasta": hasta.isoformat(),
                    "minutos_bloqueo": MINUTOS_DE_BLOQUEO,
                },
            )
        raise LoginRechazadoException(
            f"Usuario o contraseña incorrectos. Por {MAX_INTENTOS_FALLIDOS} intentos "
            f"fallidos seguidos, la cuenta quedó bloqueada hasta {_cuando(hasta, ahora)}. "
            f"Si no podés esperar, pedile a un administrador que la desbloquee.",
            estado_http=423,
            bloqueado_hasta=hasta.isoformat(),
            intentos_restantes=0,
            maximo_intentos=MAX_INTENTOS_FALLIDOS,
            minutos_bloqueo=MINUTOS_DE_BLOQUEO,
        )

    async def desbloquear(self, id_usuario: int) -> dict:
        """El «Desbloquear» del admin (RF-26): cuenta en cero y sin bloqueo.

        Se puede llamar sobre una cuenta que no está bloqueada —no hace nada malo y
        deja la cuenta en cero—: el botón puede haber quedado viejo en una pantalla
        abierta hace rato. Quién lo hizo lo anota el middleware de auditoría
        («desbloqueó usuario #3»), como cualquier otra escritura.
        """
        usuario = await self.usuario_repository.obtener_por_id(id_usuario)
        if not usuario:
            raise NotFoundException(f"Usuario con ID {id_usuario} no encontrado")
        ahora = ahora_ar()
        estaba_bloqueado = usuario.bloqueado_hasta is not None and usuario.bloqueado_hasta > ahora
        username = usuario.username
        await self.usuario_repository.limpiar_intentos(id_usuario)
        return {
            "id_usuario": id_usuario,
            "username": username,
            "estaba_bloqueado": estaba_bloqueado,
            "bloqueado": False,
            "bloqueado_hasta": None,
            "intentos_fallidos": 0,
        }

    async def _permisos_para_el_login(self, id_usuario: int) -> Optional[dict]:
        """Los permisos resueltos para la respuesta del login, o None si no se pudieron
        leer (se loguea y el login sigue). Hace rollback si algo falla: en Postgres una
        consulta fallida deja la transacción inservible, y esto es lo último del login."""
        from backend.infrastructure.PermisosRepository import PermisosRepository

        db = self.usuario_repository.db
        try:
            permisos = await PermisosRepository(db).permisos_de_usuario(
                id_usuario=id_usuario, con_admin_permanente=True
            )
            return permisos.como_dict() if permisos is not None else None
        except Exception as e:
            logger.warning(f"LOGIN: no se pudieron resolver los permisos de #{id_usuario}: {e}")
            try:
                await db.rollback()
            except Exception:
                pass
            return None

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

            # RF-26. Mientras la cuenta esté bloqueada no se mira la contraseña: ni la
            # correcta entra. Un bloqueo que ya venció no cuenta, y la cuenta arranca
            # de cero (5 intentos nuevos, no 1).
            ahora = ahora_ar()
            intentos_previos = usuario.intentos_fallidos or 0
            bloqueado_hasta = usuario.bloqueado_hasta
            if bloqueado_hasta is not None and bloqueado_hasta > ahora:
                logger.error(f"LOGIN FAILED: Usuario '{username}' bloqueado hasta {bloqueado_hasta}.")
                raise LoginRechazadoException(
                    f"La cuenta está bloqueada hasta {_cuando(bloqueado_hasta, ahora)} por "
                    f"{MAX_INTENTOS_FALLIDOS} intentos fallidos seguidos. Probá de nuevo a esa "
                    f"hora o pedile a un administrador que la desbloquee.",
                    estado_http=423,
                    bloqueado_hasta=bloqueado_hasta.isoformat(),
                    intentos_restantes=0,
                    maximo_intentos=MAX_INTENTOS_FALLIDOS,
                    minutos_bloqueo=MINUTOS_DE_BLOQUEO,
                )
            if bloqueado_hasta is not None:
                await self.usuario_repository.limpiar_intentos(usuario.id_usuario)
                intentos_previos = 0

            start_hash = time.time()
            is_valid_password = verify_password(password, usuario.password_hash)
            hash_time = time.time() - start_hash
            logger.info(f"Login Time - Password Hash Verify for '{username}': {hash_time:.4f}s")

            if not is_valid_password:
                logger.error(f"LOGIN FAILED: Password incorrecto para usuario '{username}'.")
                await self._contar_intento_fallido(usuario, ahora)

            # Entró: la cuenta de errores vuelve a cero. Sólo se escribe si había algo
            # que limpiar, para no sumarle un UPDATE a cada ingreso normal.
            if intentos_previos:
                await self.usuario_repository.limpiar_intentos(usuario.id_usuario)

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

            # RF-24: los permisos ya resueltos, para que la pantalla sepa qué mostrar sin
            # otra vuelta. Va AL FINAL y a prueba de fallas: el login ya salió bien y no
            # se cae por esto. Si no se pueden leer, la clave no viene, y el front hace lo
            # de siempre (todo a la vista) mientras la API sigue cuidando cada pedido.
            permisos = await self._permisos_para_el_login(usuario.id_usuario)
            if permisos is not None:
                usuario_data['permisos'] = permisos

            return usuario_data

        except (BusinessException, InfrastructureException):
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
