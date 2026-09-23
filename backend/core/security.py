"""
Utilidades de seguridad para autenticación y autorización
Maneja JWT tokens, hashing de contraseñas, etc.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.core.config import settings
from backend.core.permisos import (
    AREA_POR_CODIGO,
    ROL_ADMIN,
    DatosDePermisos,
    PermisosUsuario,
    permisos_de,
    validar_area,
    validar_nivel,
    validar_seccion,
)
from backend.core.permisos_rutas import (
    LIBRE,
    Politica,
    area as req_area,
    permite,
    rechazo,
)
from backend.commons.loggers.logger import logger
from backend.infrastructure.db import SessionLocal

# Configuración de seguridad Bearer Token
security = HTTPBearer()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifica si una contraseña coincide con su hash
    
    Args:
        plain_password: Contraseña en texto plano
        hashed_password: Hash de la contraseña
        
    Returns:
        bool: True si coincide, False si no
    """
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    """
    Genera un hash bcrypt de una contraseña
    
    Args:
        password: Contraseña en texto plano
        
    Returns:
        str: Hash de la contraseña
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Crea un token JWT
    
    Args:
        data: Datos a incluir en el token (normalmente {"sub": username})
        expires_delta: Tiempo de expiración del token
        
    Returns:
        str: Token JWT codificado
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    
    return encoded_jwt


def decode_access_token(token: str) -> dict:
    """
    Decodifica y valida un token JWT
    
    Args:
        token: Token JWT a decodificar
        
    Returns:
        dict: Payload del token decodificado
        
    Raises:
        HTTPException: Si el token es inválido o ha expirado
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    Obtiene el usuario actual desde el token JWT
    Dependency para rutas protegidas
    
    Args:
        credentials: Credenciales del header Authorization
        
    Returns:
        dict: Datos del usuario extraídos del token
        
    Raises:
        HTTPException: Si el token es inválido
    """
    token = credentials.credentials
    payload = decode_access_token(token)
    
    username: str = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No se pudo validar las credenciales",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return {
        "username": username,
        "id_usuario": payload.get("id_usuario"),
        "rol": payload.get("rol"),
        "nombre": payload.get("nombre"),
        "apellido": payload.get("apellido")
    }


# ─────────────────────────── permisos (RF-24) ───────────────────────────
#
# Se resuelven contra la base EN CADA PEDIDO. El token dice quién sos; lo que podés
# hacer lo dice la base en ese momento. Así un cambio de rol, un permiso que se da o
# que vence y una cuenta que se desactiva valen desde el pedido siguiente, sin volver a
# entrar (el token dura 30 días: creerle al `rol` que trae era dejar a alguien con un
# permiso que ya no tiene durante un mes).
#
# El modelo y las reglas: core/permisos.py. La lectura: infrastructure/PermisosRepository.

# La fábrica de sesiones con la que se leen los permisos. Es una variable del módulo a
# propósito: los tests la pisan (conftest) para que ningún test llegue a Supabase por
# acá, aunque se arme su propia app y no pise ninguna dependencia.
SESIONES_PERMISOS = SessionLocal


def get_sesiones_permisos():
    """Dependencia: la fábrica de sesiones para leer permisos.

    Devuelve la FÁBRICA y no una sesión abierta: la lectura abre una sesión corta y la
    cierra antes de que corra el endpoint. Con una dependencia `yield` cada pedido
    tendría dos conexiones tomadas hasta el final (la de los permisos y la del
    endpoint), y el pooler de Supabase admite 15 clientes para todo el proyecto.
    """
    return SESIONES_PERMISOS


def _no_se_pudo_verificar() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "message": "No se pudieron verificar tus permisos. Probá de nuevo en unos segundos.",
            "campo": "permiso",
        },
    )


@dataclass(frozen=True)
class UsuarioActual:
    """Quién hace el pedido según la BASE, en este momento (no según el token)."""
    id_usuario: int
    username: Optional[str]
    rol: Optional[str]

    @property
    def es_admin(self) -> bool:
        return self.rol == ROL_ADMIN


async def get_usuario_actual(
    current_user: dict = Depends(get_current_user),
    sesiones=Depends(get_sesiones_permisos),
) -> UsuarioActual:
    """Dependencia: la fila del usuario del token, leída de la base. UNA consulta.

    - 401 si ya no existe o está inactivo (el token sigue vivo, la cuenta no).
    - 503 si la base no contesta.

    Es todo lo que necesitan require_admin y, para un admin, los permisos.
    """
    from backend.infrastructure.PermisosRepository import PermisosRepository

    try:
        async with sesiones() as s:
            fila = await PermisosRepository(s).fila_usuario(
                current_user.get("id_usuario"), current_user.get("username")
            )
    except Exception as e:
        logger.error(f"Permisos: no se pudo leer el usuario {current_user.get('username')!r}: {e}")
        raise _no_se_pudo_verificar()
    if fila is None or not fila.activo:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tu usuario está inactivo o ya no existe. Pedile a un administrador que lo revise.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return UsuarioActual(id_usuario=fila.id_usuario, username=fila.username, rol=fila.rol)


async def get_usuario_verificado(
    current_user: dict = Depends(get_current_user),
    usuario: UsuarioActual = Depends(get_usuario_actual),
) -> dict:
    """Dependencia: el dict de siempre (el del token), con el id y el ROL DE LA BASE.

    Para los servicios que deciden algo mirando `usuario["rol"]` (anular el consumo de
    otro, por ejemplo): el `rol` del token es el del día que entró y dura 30 días, y a un
    admin al que le sacaron el rol no le puede alcanzar con eso. No cuesta una consulta
    más: get_usuario_actual ya corrió para la política del router y FastAPI la reusa.
    """
    return {**current_user, "id_usuario": usuario.id_usuario, "rol": usuario.rol}


async def resolver_permisos_actuales(usuario: UsuarioActual, sesiones) -> PermisosUsuario:
    """Los permisos de `usuario`. Al admin no le lee ninguna tabla de permisos (es
    admin en todo por regla). Al resto, las lee con una sesión propia y corta; si no se
    pueden leer, 503: un permiso que no se pudo leer no abre nada."""
    from backend.infrastructure.PermisosRepository import PermisosRepository

    if usuario.es_admin:
        datos = DatosDePermisos(rol=usuario.rol)
    else:
        try:
            async with sesiones() as s:
                datos = await PermisosRepository(s).datos_de_permisos(usuario.rol, usuario.id_usuario)
        except Exception as e:
            logger.error(f"Permisos: no se pudieron leer los de {usuario.username!r}: {e}")
            raise _no_se_pudo_verificar()
    return permisos_de(datos, usuario.id_usuario, usuario.username)


async def get_permisos_actuales(
    usuario: UsuarioActual = Depends(get_usuario_actual),
    sesiones=Depends(get_sesiones_permisos),
) -> PermisosUsuario:
    """Dependencia: los permisos de quien hace el pedido, resueltos contra la base.

    FastAPI cachea las dependencias por pedido: varias dependencias de permisos en el
    mismo pedido leen la base una sola vez.
    """
    return await resolver_permisos_actuales(usuario, sesiones)


def _prohibido(que: str, nivel: str) -> HTTPException:
    verbo = "ver" if nivel == "read" else ("administrar" if nivel == "admin" else "modificar")
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"message": f"No tenés permiso para {verbo} {que}.", "campo": "permiso"},
    )


async def require_admin(
    current_user: dict = Depends(get_current_user),
    usuario: UsuarioActual = Depends(get_usuario_actual),
) -> dict:
    """
    Verifica que el usuario actual sea administrador. CONTRA LA BASE, no contra el
    token: a alguien a quien le sacaron el rol admin no le alcanza con el token viejo.

    Es lo que piden el ABM de usuarios y la administración de permisos: el «admin del
    área de sistema». Nivel admin en Configuración lo tiene sólo el rol admin (la API de
    permisos no deja dárselo a otro rol ni a una persona), así que mirar el rol es mirar
    eso, sin depender de que las tablas de permisos existan.

    Devuelve el mismo dict de siempre (el del token) con el `rol` de la base.
    """
    if not usuario.es_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para realizar esta acción"
        )
    return {**current_user, "rol": usuario.rol}


def require_area(area: str, nivel: str = "read"):
    """Fábrica de dependencias: pide `nivel` (none < read < write < admin) en `area`.

        @router.get("/x", dependencies=[Depends(require_area("operaciones"))])

    Un área que no existe revienta AL IMPORTAR (ValueError), no en producción.
    Devuelve los PermisosUsuario, por si el endpoint los quiere mirar.
    """
    info = validar_area(area)
    validar_nivel(nivel)

    async def _dependencia(permisos: PermisosUsuario = Depends(get_permisos_actuales)) -> PermisosUsuario:
        if not permisos.tiene_area(area, nivel):
            raise _prohibido(f"«{info.nombre}»", nivel)
        return permisos

    _dependencia.__name__ = f"require_area_{area}_{nivel}"
    return _dependencia


def require_seccion(seccion: str, nivel: str = "read"):
    """Fábrica de dependencias: pide `nivel` en una sección (una solapa o una parte
    sensible). La sección se resuelve con sus reglas: hereda el área salvo que sea
    confidencial, y entonces está cerrada salvo que se haya otorgado."""
    info = validar_seccion(seccion)
    validar_nivel(nivel)

    async def _dependencia(permisos: PermisosUsuario = Depends(get_permisos_actuales)) -> PermisosUsuario:
        if not permisos.tiene_seccion(seccion, nivel):
            raise _prohibido(f"«{info.nombre}» ({AREA_POR_CODIGO[info.area].nombre})", nivel)
        return permisos

    _dependencia.__name__ = f"require_seccion_{seccion}_{nivel}"
    return _dependencia


def require_politica(politica: Politica, nombre: str = "router"):
    """Fábrica para colgar en `include_router`: aplica la política de un router del mapa
    (core/permisos_rutas.py).

        app.include_router(r, dependencies=[Depends(get_current_user),
                                            Depends(require_politica(POLITICAS["clientes"]))])

    Lo que pide cada pedido sale de la política: la excepción de esa ruta si la hay, y
    si no, `leer` para GET/HEAD/OPTIONS y `escribir` para el resto. Con uno de los
    requisitos alcanza.

    La ruta se mira por su PLANTILLA (`/ordenes/{id}`), la que FastAPI dejó en el scope
    al elegir el endpoint, no por la dirección pedida: así una excepción no se saltea
    con un /ordenes/1/ de más ni con mayúsculas.

    Lo LIBRE sólo mira que la cuenta exista y esté activa (una consulta, la que ya hacía
    get_usuario_actual): no lee las tablas de permisos. El admin tampoco las lee: es
    admin por regla. Si la base no contesta, 503 (get_usuario_actual): no se abre nada
    sin verificar.

    Devuelve los PermisosUsuario (o None si no hizo falta resolverlos).
    """

    async def _dependencia(
        request: Request,
        usuario: UsuarioActual = Depends(get_usuario_actual),
        sesiones=Depends(get_sesiones_permisos),
    ) -> Optional[PermisosUsuario]:
        ruta = getattr(request.scope.get("route"), "path", None) or request.url.path
        requisitos = politica.requisitos(request.method, ruta)
        if not requisitos:
            return None
        permisos = await resolver_permisos_actuales(usuario, sesiones)
        if not permite(requisitos, permisos, request.query_params):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"message": rechazo(requisitos), "campo": "permiso"},
            )
        return permisos

    _dependencia.__name__ = f"require_politica_{nombre}"
    return _dependencia


def require_area_segun_metodo(area: str, *, lectura_libre: bool = False):
    """Atajo de require_politica para un router de UN área: GET/HEAD/OPTIONS piden
    `read`; POST/PUT/PATCH/DELETE (y cualquier otro) piden `write`.

    `lectura_libre=True` es la regla pragmática para los CATÁLOGOS que usan varias
    pantallas (procesos, operarios, máquinas, rangos...): LEER lo puede cualquiera con
    sesión y cuenta activa; ESCRIBIR pide el área. Leer igual pasa por la base: una
    cuenta desactivada no lee nada.

    Los routers de la app no usan esto sino el mapa (core/permisos_rutas.py), que dice
    además qué otras pantallas leen cada cosa y qué rutas piden otra cosa.
    """
    validar_area(area)
    politica = Politica(
        leer=LIBRE if lectura_libre else (req_area(area),),
        escribir=(req_area(area, "write"),),
    )
    return require_politica(politica, nombre=f"area_segun_metodo_{area}")
