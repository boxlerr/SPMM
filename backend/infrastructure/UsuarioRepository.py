"""
Repositorio de Usuario
Maneja todas las operaciones de base de datos para usuarios usando SQLAlchemy
"""
from typing import Optional, List
from datetime import datetime
from sqlalchemy import select, update, delete, func, or_
from backend.domain.Usuario import Usuario
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class SinColumnasDeBloqueo(Exception):
    """La base todavía no tiene usuario.intentos_fallidos / bloqueado_hasta (RF-26):
    la migración 2026-09-22_bloqueo_por_intentos_fallidos no corrió."""


def falta_columna(e: Exception) -> bool:
    """¿El error es «esa columna no existe»? Postgres lo dice con el código 42703
    (undefined_column; asyncpg lo deja en `sqlstate`); SQLite, con «no such column».

    Se mira el código y no el texto en Postgres: el mensaje sale en el idioma del
    servidor («no existe la columna» en una base en castellano)."""
    orig = getattr(e, "orig", None)
    for candidato in (orig, getattr(orig, "__cause__", None), e):
        if candidato is not None and getattr(candidato, "sqlstate", None) == "42703":
            return True
    return "no such column" in str(orig if orig is not None else e).lower()

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
                    # Eligió una suya: ya no hay nada que forzar.
                    debe_cambiar_password=False,
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
    
    # ───────────── RF-26: bloqueo por intentos fallidos ─────────────
    #
    # Todo va por UPDATE directo y no tocando el objeto del ORM: la cuenta tiene que ser
    # atómica. Y cada paso es UNA sentencia condicionada que se confirma al toque, porque
    # entre un paso y el siguiente puede haber otros intentos de la misma cuenta a mitad
    # de camino (dos pestañas, un script que manda veinte juntos).
    #
    # EL INTENTO SE RESERVA ANTES DE MIRAR LA CONTRASEÑA (AuthService.login). Hasta el
    # 23/09 se leía la fila, se comparaba la clave y recién después se sumaba el error: N
    # pedidos que llegaban juntos leían todos «sin bloqueo», comparaban todos su clave y
    # una buena al final de la ráfaga entraba aunque el bloqueo ya estuviera grabado. Con
    # la reserva, como mucho `maximo` contraseñas se comparan entre un ingreso bueno y el
    # siguiente, lleguen como lleguen.
    #
    # `synchronize_session=False` porque el que llama usa lo que devuelve el RETURNING,
    # no el objeto que tiene en la sesión. Las dos columnas están `deferred` en el modelo
    # (domain/Usuario.py): si la migración no corrió, la primera lectura levanta
    # SinColumnasDeBloqueo y el login sigue sin RF-26 en vez de no dejar entrar a nadie.

    @staticmethod
    def _sin_bloqueo_vigente(ahora: datetime):
        return or_(Usuario.bloqueado_hasta.is_(None), Usuario.bloqueado_hasta <= ahora)

    async def _escribir(self, sentencia, que: str, id_usuario: int):
        """Corre `sentencia`, confirma y devuelve la primera fila del RETURNING (o None)."""
        try:
            fila = (await self.db.execute(sentencia)).first()
            await self.db.commit()
            return fila
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al {que} del usuario {id_usuario}: {str(e)}")
            raise InfrastructureException(f"Error al {que}") from e

    async def estado_de_bloqueo(self, id_usuario: int) -> tuple[int, Optional[datetime]]:
        """(intentos_fallidos, bloqueado_hasta) como están AHORA en la base (no lo que
        tenga el objeto de la sesión, que se leyó antes). Una persona que no existe da
        (0, None).

        Levanta SinColumnasDeBloqueo si las columnas todavía no existen (con rollback: en
        Postgres una consulta fallida deja la transacción inservible)."""
        try:
            fila = (await self.db.execute(
                select(Usuario.intentos_fallidos, Usuario.bloqueado_hasta)
                .where(Usuario.id_usuario == id_usuario)
            )).first()
        except Exception as e:
            await self.db.rollback()
            if falta_columna(e):
                logger.warning(
                    "RF-26: la base no tiene usuario.intentos_fallidos/bloqueado_hasta (%s). "
                    "¿Falta la migración 2026-09-22_bloqueo_por_intentos_fallidos?", e,
                )
                raise SinColumnasDeBloqueo() from e
            logger.error(f"Error al leer el bloqueo del usuario {id_usuario}: {str(e)}")
            raise InfrastructureException("Error al leer el estado de la cuenta") from e
        if fila is None:
            return 0, None
        return int(fila[0] or 0), fila[1]

    async def bloqueos_de_usuarios(self, id_usuario: Optional[int] = None) -> dict[int, tuple[int, Optional[datetime]]]:
        """{id_usuario: (intentos_fallidos, bloqueado_hasta)} de todos (o de uno). Lo lee
        la lista de usuarios. Mismo cuidado que estado_de_bloqueo: levanta
        SinColumnasDeBloqueo si la migración no corrió."""
        consulta = select(Usuario.id_usuario, Usuario.intentos_fallidos, Usuario.bloqueado_hasta)
        if id_usuario is not None:
            consulta = consulta.where(Usuario.id_usuario == id_usuario)
        try:
            filas = (await self.db.execute(consulta)).all()
        except Exception as e:
            await self.db.rollback()
            if falta_columna(e):
                raise SinColumnasDeBloqueo() from e
            raise InfrastructureException("Error al leer el estado de las cuentas") from e
        return {int(f[0]): (int(f[1] or 0), f[2]) for f in filas}

    async def limpiar_bloqueo_vencido(self, id_usuario: int, ahora: datetime) -> None:
        """Un bloqueo que ya venció: la cuenta arranca de cero (5 intentos nuevos, no 1).

        Sólo toca un bloqueo VENCIDO: si otro pedido acaba de bloquear la cuenta de nuevo
        (plazo en el futuro), no lo borra. Y si otro ya lo limpió, no hace nada."""
        await self._escribir(
            update(Usuario)
            .where(Usuario.id_usuario == id_usuario,
                   Usuario.bloqueado_hasta.is_not(None),
                   Usuario.bloqueado_hasta <= ahora)
            .values(intentos_fallidos=0, bloqueado_hasta=None)
            .returning(Usuario.id_usuario)
            .execution_options(synchronize_session=False),
            "limpiar el bloqueo vencido", id_usuario,
        )

    async def reservar_intento(self, id_usuario: int, maximo: int, ahora: datetime) -> Optional[int]:
        """Anota un intento ANTES de comparar la contraseña y devuelve su número (1 a
        `maximo`). None = no hay lugar: la cuenta está bloqueada, o ya hay `maximo`
        intentos contados sin un ingreso bueno en el medio (en una ráfaga, los que están
        todavía comparando su clave). Con None la contraseña NO se mira.

        Si la clave resulta buena, confirmar_ingreso vuelve la cuenta a cero; si es mala,
        el intento ya quedó contado."""
        fila = await self._escribir(
            update(Usuario)
            .where(Usuario.id_usuario == id_usuario,
                   self._sin_bloqueo_vigente(ahora),
                   func.coalesce(Usuario.intentos_fallidos, 0) < maximo)
            .values(intentos_fallidos=func.coalesce(Usuario.intentos_fallidos, 0) + 1)
            .returning(Usuario.intentos_fallidos)
            .execution_options(synchronize_session=False),
            "registrar el intento de ingreso", id_usuario,
        )
        return None if fila is None else int(fila[0])

    async def bloquear(self, id_usuario: int, maximo: int, hasta: datetime, ahora: datetime) -> bool:
        """Bloquea hasta `hasta` si la cuenta llegó a `maximo` intentos y no tiene ya un
        bloqueo vigente. True = lo puso ESTE pedido (y es el que lo anota en la
        auditoría); False = no correspondía (un ingreso bueno la volvió a cero en el
        medio) o ya estaba bloqueada: dos pedidos que llegan juntos no pueden correr el
        plazo que ya se le dijo al primero."""
        fila = await self._escribir(
            update(Usuario)
            .where(Usuario.id_usuario == id_usuario,
                   self._sin_bloqueo_vigente(ahora),
                   func.coalesce(Usuario.intentos_fallidos, 0) >= maximo)
            .values(bloqueado_hasta=hasta)
            .returning(Usuario.id_usuario)
            .execution_options(synchronize_session=False),
            "bloquear la cuenta", id_usuario,
        )
        return fila is not None

    async def confirmar_ingreso(self, id_usuario: int, ahora: datetime) -> bool:
        """Contraseña buena: la cuenta vuelve a cero, SIEMPRE QUE no se haya bloqueado
        mientras se comparaba. False = se bloqueó en el medio (otros intentos de la
        misma ráfaga llegaron a 5): no entra, aunque su clave sea la correcta."""
        fila = await self._escribir(
            update(Usuario)
            .where(Usuario.id_usuario == id_usuario, self._sin_bloqueo_vigente(ahora))
            .values(intentos_fallidos=0, bloqueado_hasta=None)
            .returning(Usuario.id_usuario)
            .execution_options(synchronize_session=False),
            "confirmar el ingreso", id_usuario,
        )
        return fila is not None

    async def limpiar_intentos(self, id_usuario: int) -> bool:
        """Cuenta en cero y sin bloqueo. La usan el ingreso bueno, el bloqueo que ya
        venció (arranca de cero) y el «Desbloquear» del admin."""
        try:
            await self.db.execute(
                update(Usuario)
                .where(Usuario.id_usuario == id_usuario)
                .values(intentos_fallidos=0, bloqueado_hasta=None)
                .execution_options(synchronize_session=False)
            )
            await self.db.commit()
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al limpiar los intentos del usuario {id_usuario}: {str(e)}")
            raise InfrastructureException("Error al desbloquear el usuario") from e

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
    
    async def eliminar(self, id_usuario: int, eliminado_por: Optional[int] = None) -> bool:
        """Desactiva un usuario (soft delete) en lugar de eliminarlo permanentemente"""
        try:
            await self.db.execute(
                update(Usuario)
                .where(Usuario.id_usuario == id_usuario)
                .values(
                    activo=False,
                    fecha_actualizacion=datetime.utcnow(),
                    actualizado_por=eliminado_por
                )
            )
            await self.db.commit()
            logger.info(f"Usuario desactivado (soft delete) ID: {id_usuario}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error al desactivar usuario {id_usuario}: {str(e)}")
            raise InfrastructureException("Error al desactivar usuario") from e
