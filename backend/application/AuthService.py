"""
Servicio de Autenticación
Maneja login, logout, recuperación de contraseña
"""
from datetime import datetime, timedelta
import time
from typing import Optional
import secrets
from starlette.concurrency import run_in_threadpool
from backend.infrastructure.UsuarioRepository import SinColumnasDeBloqueo, UsuarioRepository
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
#   · Una ráfaga (muchos pedidos juntos) no compra comparaciones de más: el intento se
#     cuenta ANTES de mirar la contraseña, y con 5 contados sin un ingreso bueno en el
#     medio no se mira ninguna otra (ver _reservar_intento). Arreglado el 23/09: hasta
#     ahí, 11 claves malas y una buena mandadas juntas entraban.
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

    # ─────────────── RF-26, paso a paso (lo llama login) ───────────────
    #
    # El orden importa y es el arreglo del 23/09: el intento se RESERVA (se cuenta)
    # antes de comparar la contraseña. Antes se leía la fila, se comparaba la clave y
    # recién después se contaba el error; una ráfaga de pedidos juntos leía «sin
    # bloqueo» en todos, comparaba todas sus claves y una buena al final entraba aunque
    # el bloqueo ya estuviera grabado. Ahora, lleguen como lleguen, entre un ingreso
    # bueno y el siguiente se comparan como mucho MAX_INTENTOS_FALLIDOS contraseñas.

    def _cuenta_bloqueada(self, hasta: datetime, ahora: datetime) -> LoginRechazadoException:
        """La cuenta está bloqueada y la contraseña NO se miró."""
        return LoginRechazadoException(
            f"La cuenta está bloqueada hasta {_cuando(hasta, ahora)} por "
            f"{MAX_INTENTOS_FALLIDOS} intentos fallidos seguidos. Probá de nuevo a esa "
            f"hora o pedile a un administrador que la desbloquee.",
            estado_http=423,
            bloqueado_hasta=hasta.isoformat(),
            intentos_restantes=0,
            maximo_intentos=MAX_INTENTOS_FALLIDOS,
            minutos_bloqueo=MINUTOS_DE_BLOQUEO,
        )

    async def _bloquear(self, id_usuario: int, quien: str, nombre: str, ahora: datetime):
        """Pone el bloqueo si corresponde y devuelve hasta cuándo quedó bloqueada (el
        plazo nuevo, o el que ya tenía), o None si no quedó bloqueada (un ingreso bueno
        la volvió a cero en el medio).

        La fila de auditoría la escribe sólo el pedido que PUSO el bloqueo: si llegan
        varios juntos, los demás encuentran el bloqueo puesto y no la repiten."""
        repo = self.usuario_repository
        hasta_nuevo = _al_minuto_siguiente(ahora + timedelta(minutes=MINUTOS_DE_BLOQUEO))
        if not await repo.bloquear(id_usuario, MAX_INTENTOS_FALLIDOS, hasta_nuevo, ahora):
            _, hasta = await repo.estado_de_bloqueo(id_usuario)
            return hasta if hasta is not None and hasta > ahora else None

        logger.warning(f"LOGIN: Usuario '{quien}' bloqueado hasta {hasta_nuevo} "
                       f"({MAX_INTENTOS_FALLIDOS} intentos).")
        await auditoria.registrar_evento(
            repo.db,
            accion="bloqueó",
            entidad="usuario",
            id_entidad=str(id_usuario),
            descripcion=(
                f"Se bloqueó el usuario {quien}"
                + (f" ({nombre})" if nombre else "")
                + f" hasta {_cuando(hasta_nuevo, ahora)} por {MAX_INTENTOS_FALLIDOS} "
                f"intentos fallidos seguidos"
            ),
            metodo="POST",
            ruta="/auth/login",
            detalle={
                "username": quien,
                "intentos_fallidos": MAX_INTENTOS_FALLIDOS,
                "bloqueado_hasta": hasta_nuevo.isoformat(),
                "minutos_bloqueo": MINUTOS_DE_BLOQUEO,
            },
        )
        return hasta_nuevo

    async def _reservar_intento(self, id_usuario: int, quien: str, nombre: str,
                                ahora: datetime) -> Optional[int]:
        """Antes de mirar la contraseña. Devuelve el número de intento reservado (1 a 5),
        o None si la base todavía no tiene las columnas de RF-26 (la migración no corrió):
        entonces el login sigue como antes de RF-26, en vez de no dejar entrar a nadie.

        Levanta 423 (sin mirar la contraseña) si la cuenta está bloqueada, o si ya hay 5
        intentos contados sin un ingreso bueno en el medio."""
        repo = self.usuario_repository
        try:
            _, hasta = await repo.estado_de_bloqueo(id_usuario)
        except SinColumnasDeBloqueo:
            logger.warning(f"LOGIN: '{quien}' entra sin el control de intentos (RF-26): "
                           "falta la migración 2026-09-22_bloqueo_por_intentos_fallidos.")
            return None

        if hasta is not None and hasta > ahora:
            logger.error(f"LOGIN FAILED: Usuario '{quien}' bloqueado hasta {hasta}.")
            raise self._cuenta_bloqueada(hasta, ahora)
        if hasta is not None:
            # Venció: la cuenta arranca de cero (5 intentos nuevos, no 1).
            await repo.limpiar_bloqueo_vencido(id_usuario, ahora)

        numero = await repo.reservar_intento(id_usuario, MAX_INTENTOS_FALLIDOS, ahora)
        if numero is not None:
            return numero

        # Sin lugar: o se bloqueó recién, o ya hay 5 intentos contados que nadie cerró
        # (los de una ráfaga que todavía están comparando su clave, o uno que se cortó a
        # mitad de camino). En los dos casos la cuenta queda bloqueada: así una ráfaga no
        # suma intentos de más, y una cuenta con 5 intentos colgados no queda trabada
        # para siempre sin que la lista de usuarios la muestre bloqueada.
        hasta = await self._bloquear(id_usuario, quien, nombre, ahora)
        if hasta is None:
            # Un ingreso bueno la volvió a cero justo en el medio: que pruebe de nuevo.
            raise LoginRechazadoException(
                "No se pudo verificar el ingreso: probá de nuevo.",
                estado_http=409,
                maximo_intentos=MAX_INTENTOS_FALLIDOS,
                minutos_bloqueo=MINUTOS_DE_BLOQUEO,
            )
        logger.error(f"LOGIN FAILED: Usuario '{quien}' sin intentos libres; bloqueado hasta {hasta}.")
        raise self._cuenta_bloqueada(hasta, ahora)

    async def _intento_fallido(self, numero: int, id_usuario: int, quien: str, nombre: str,
                               ahora: datetime):
        """La contraseña era mala: el intento ya quedó contado al reservarlo. Si era el
        5º, bloquea. Nunca vuelve: siempre levanta."""
        if numero < MAX_INTENTOS_FALLIDOS:
            restantes = MAX_INTENTOS_FALLIDOS - numero
            raise LoginRechazadoException(
                f"Usuario o contraseña incorrectos. {_te_quedan(restantes)}",
                estado_http=401,
                intentos_restantes=restantes,
                maximo_intentos=MAX_INTENTOS_FALLIDOS,
                minutos_bloqueo=MINUTOS_DE_BLOQUEO,
            )

        hasta = await self._bloquear(id_usuario, quien, nombre, ahora)
        if hasta is None:
            # Un ingreso bueno de la misma ráfaga volvió la cuenta a cero en el medio:
            # este error ya no cierra una racha de 5.
            intentos, _ = await self.usuario_repository.estado_de_bloqueo(id_usuario)
            restantes = max(1, MAX_INTENTOS_FALLIDOS - intentos)
            raise LoginRechazadoException(
                f"Usuario o contraseña incorrectos. {_te_quedan(restantes)}",
                estado_http=401,
                intentos_restantes=restantes,
                maximo_intentos=MAX_INTENTOS_FALLIDOS,
                minutos_bloqueo=MINUTOS_DE_BLOQUEO,
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

        Levanta SinColumnasDeBloqueo si la migración de RF-26 no corrió (no hay nada
        que desbloquear: sin las columnas no se bloquea a nadie).
        """
        usuario = await self.usuario_repository.obtener_por_id(id_usuario)
        if not usuario:
            raise NotFoundException(f"Usuario con ID {id_usuario} no encontrado")
        username = usuario.username
        ahora = ahora_ar()
        _, hasta = await self.usuario_repository.estado_de_bloqueo(id_usuario)
        estaba_bloqueado = hasta is not None and hasta > ahora
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
            repo = PermisosRepository(db)
            permisos = await repo.permisos_de_usuario(
                id_usuario=id_usuario, con_admin_permanente=True
            )
            if permisos is None:
                return None
            salida = permisos.como_dict()
            # Si maneja usuarios y permisos (reglas_de_roles.gestiona): admin y, si hay
            # administradores permanentes, uno de ellos. Lo mismo que dice /auth/me.
            permanentes = await repo.admins_permanentes()
            salida["gestiona_usuarios"] = bool(permisos.es_admin) and (
                not permanentes or id_usuario in permanentes
            )
            return salida
        except Exception as e:
            logger.warning(f"LOGIN: no se pudieron resolver los permisos de #{id_usuario}: {e}")
            try:
                await db.rollback()
            except Exception:
                pass
            return None

    async def _pantalla_inicio_para_el_login(self, id_usuario: int) -> Optional[str]:
        """RF-28: la pantalla fijada (la suya pisa la de su rol), o None si no tiene o no
        se pudo leer (migración sin correr). Nunca tumba el login: el repositorio hace
        rollback si la columna falta, y esto es de lo último que se hace."""
        from backend.core.permisos import pantalla_de_inicio
        from backend.infrastructure.PermisosRepository import PermisosRepository

        try:
            leidas = await PermisosRepository(self.usuario_repository.db).pantalla_inicio(id_usuario)
        except Exception as e:
            logger.warning(f"LOGIN: no se pudo leer la pantalla de inicio de #{id_usuario}: {e}")
            return None
        return None if leidas is None else pantalla_de_inicio(*leidas)

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

            # Todo lo que hace falta del usuario, leído AHORA: si la base no tiene las
            # columnas de RF-26, su lectura hace rollback, que expira el objeto del ORM, y
            # releerlo en async revienta.
            id_usuario = usuario.id_usuario
            quien = usuario.username
            nombre = " ".join(p for p in (usuario.nombre, usuario.apellido) if p).strip()
            password_hash = usuario.password_hash
            usuario_data = usuario.to_dict()
            datos_del_token = {
                "sub": usuario.username,
                "id_usuario": usuario.id_usuario,
                "rol": usuario.rol,
                "nombre": usuario.nombre,
                "apellido": usuario.apellido,
            }

            # RF-26. El intento se cuenta ANTES de mirar la contraseña (ver
            # _reservar_intento): con la cuenta bloqueada no se mira —ni la correcta
            # entra— y un bloqueo vencido arranca de cero. None = la base todavía no
            # tiene las columnas: se entra como antes de RF-26.
            ahora = ahora_ar()
            numero = await self._reservar_intento(id_usuario, quien, nombre, ahora)

            # bcrypt tarda ~170 ms a propósito. En un hilo aparte: corrido acá adentro
            # frenaba el servidor entero (todos los pedidos de todos) mientras comparaba.
            start_hash = time.time()
            is_valid_password = await run_in_threadpool(verify_password, password, password_hash)
            hash_time = time.time() - start_hash
            logger.info(f"Login Time - Password Hash Verify for '{username}': {hash_time:.4f}s")

            if not is_valid_password:
                logger.error(f"LOGIN FAILED: Password incorrecto para usuario '{username}'.")
                if numero is None:
                    raise BusinessException("Usuario o contraseña incorrectos")
                await self._intento_fallido(numero, id_usuario, quien, nombre, ahora)

            # Entró: la cuenta de errores vuelve a cero, salvo que otros intentos de la
            # misma ráfaga la hayan bloqueado mientras se comparaba esta clave. Entonces
            # no entra: el bloqueo vale también para la contraseña correcta.
            if numero is not None and not await self.usuario_repository.confirmar_ingreso(id_usuario, ahora):
                _, hasta = await self.usuario_repository.estado_de_bloqueo(id_usuario)
                logger.error(f"LOGIN FAILED: Usuario '{quien}' se bloqueó mientras entraba.")
                raise self._cuenta_bloqueada(hasta or ahora, ahora)

            # Actualizar último login
            await self.usuario_repository.actualizar_ultimo_login(id_usuario)

            # Crear token JWT
            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            access_token = create_access_token(
                data=datos_del_token,
                expires_delta=access_token_expires
            )

            logger.info(f"Login exitoso: {quien}")

            # Devolver token y datos del usuario
            usuario_data['access_token'] = access_token
            usuario_data['token_type'] = 'bearer'
            usuario_data['expires_in'] = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60  # En segundos

            # RF-24: los permisos ya resueltos, para que la pantalla sepa qué mostrar sin
            # otra vuelta. Va AL FINAL y a prueba de fallas: el login ya salió bien y no
            # se cae por esto. Si no se pueden leer, la clave no viene, y el front hace lo
            # de siempre (todo a la vista) mientras la API sigue cuidando cada pedido.
            # El id es el que se leyó al principio y no el del objeto: si leer los permisos
            # hizo rollback (una columna que falta), el objeto del ORM quedó expirado y
            # releerlo en async revienta.
            permisos = await self._permisos_para_el_login(id_usuario)
            if permisos is not None:
                usuario_data['permisos'] = permisos

            # RF-28: a qué pantalla entra (la suya o la de su rol). La pantalla la usa sólo
            # si la puede abrir; si no, al Dashboard o a la primera que pueda ver. None =
            # el inicio de siempre, que es también lo que hace un front que no la conoce.
            usuario_data['pantalla_inicio'] = await self._pantalla_inicio_para_el_login(id_usuario)

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
            
            # Verificar contraseña actual (bcrypt en un hilo aparte: ver login)
            if not await run_in_threadpool(verify_password, current_password, usuario.password_hash):
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
