"""
Administración de permisos (RF-24): lo que va a usar la pantalla «Usuarios y permisos»
de Configuración. Es la de Don Joaquín (usuarios/actions.ts) portada a endpoints, menos
el bloqueo por horario.

    GET    /permisos/catalogo                           áreas, secciones y niveles
    GET    /permisos/matriz                             roles × áreas y roles × secciones
    POST   /permisos/roles                              crear un rol (arranca sin nada)
    PUT    /permisos/roles/{rol}                        renombrarlo
    DELETE /permisos/roles/{rol}                        borrarlo (sólo si nadie lo tiene)
    PUT    /permisos/roles/{rol}/areas/{area}           nivel de un rol en un área
    PUT    /permisos/roles/{rol}/secciones/{seccion}    restringir (o abrir, si es
                                                        confidencial) una sección a un rol
    PUT    /permisos/secciones/{seccion}/confidencial   marcar / desmarcar confidencial
    GET    /permisos/overrides                          los permisos de más de todos
    GET    /permisos/usuarios/{id}                      los de una persona + lo que puede
    PUT    /permisos/usuarios/{id}/areas/{area}         darle un área de más (con vencimiento)
    DELETE /permisos/usuarios/{id}/areas/{area}         sacárselo
    PUT    /permisos/usuarios/{id}/secciones/{seccion}  darle una sección de más
    DELETE /permisos/usuarios/{id}/secciones/{seccion}  sacársela
    PUT    /permisos/usuarios/{id}/rol                  cambiarle el rol
    PUT    /permisos/usuarios/{id}/pantalla-inicio      RF-28: la pantalla a la que entra
    PUT    /permisos/roles/{rol}/pantalla-inicio        RF-28: la de todos los de un rol

QUIÉN PUEDE

- El catálogo: cualquiera con sesión (son los nombres de las pantallas; sin datos).
- Leer la matriz y los permisos de la gente: la sección «Usuarios y permisos», que es
  confidencial (el admin la tiene siempre; a otro hay que dársela a propósito).
- CAMBIAR cualquier cosa: sólo el rol admin, mirado en la base en cada pedido. Es el
  «admin del área de sistema»: nivel admin en Configuración, que esta misma API no deja
  dar a ningún otro rol ni persona —quien puede tocar permisos se hace admin solo—. Por
  la misma razón nadie se da permisos a sí mismo ni se cambia el rol.

LAS REGLAS (las de DJ, más las de SPMM)

- El rol admin es admin en todo por regla: su fila no se edita, no se renombra y no se
  borra (409).
- Los roles (el ABM de DJ): uno nuevo arranca sin ningún permiso; el código sale del
  nombre y no cambia al renombrar; no puede haber dos con el mismo nombre; un rol que
  tiene gente —aunque sea sin acceso— no se borra (409, que dice cuántos).
- En una sección NO confidencial, lo del rol sólo puede RESTRINGIR lo que da el área;
  igualarlo es «hereda» (409 si se intenta igualar o superar, como DJ).
- Un permiso de más SUMA, tiene que dar algo (no «none») y su vencimiento no puede
  estar ya pasado. Se da sólo a quien no es admin (el admin ya tiene todo).
- Cambiar el rol: el rol tiene que existir, nadie se lo cambia a sí mismo, a un
  administrador permanente no se le cambia (ni por acá ni por /auth/usuarios: es la
  misma función, application/reglas_de_roles.py) y el sistema nunca queda sin admin.
- Sacarle la marca de confidencial a una sección que alguien pasaría a ver avisa
  primero quiénes (409) y se hace igual con ?forzar=true.
- La pantalla de inicio (RF-28) es una del menú o ninguna. Fijarla NO da permiso para
  verla: si no la puede abrir, entra al Dashboard (o a la primera que pueda ver). No se
  rechaza —no se pierde nada—: la respuesta dice `puede_abrirla` y la pantalla avisa. Se
  le puede fijar también a un admin y a uno mismo: no da ningún permiso.

AUDITORÍA

Todo pasa por el middleware de main.py, que registra quién, cuándo y con qué datos,
incluidos los intentos rechazados (un 403 de alguien queriendo darse permisos queda).
Además cada endpoint deja en `request.state.auditoria` la frase de lo que pasó y cómo
estaba antes, que el pedido solo no dice: «le dio a Matías «Clientes» para editar hasta
el 30/09 — cubre a Sofía».
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update

from backend.application.reglas_de_roles import cuidar_administradores, de_a_uno, validar_rol
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.loggers.logger import logger
from backend.core.permisos import (
    AREA_POR_CODIGO,
    AREAS,
    NIVELES,
    PANTALLA_DE_INICIO_POR_RUTA,
    ROL_ADMIN,
    ROLES,
    SECCION_POR_CODIGO,
    DatosDePermisos,
    codigo_para_rol,
    nivel_valido,
    pantalla_de_inicio,
    permisos_de,
    puede_abrir_pantalla,
    rango,
    resolver_permisos,
    secciones_de_area,
)
from backend.core.security import (
    UsuarioActual,
    get_sesiones_permisos,
    get_usuario_actual,
    require_admin,
    require_seccion,
)
from backend.domain.Permisos import UsuarioArea, UsuarioSeccion
from backend.domain.Usuario import Usuario
from backend.dto.PermisosRequestDTO import (
    CambiarRolDTO,
    ConfidencialDTO,
    NombreDeRolDTO,
    NivelDeRolEnAreaDTO,
    NivelDeRolEnSeccionDTO,
    PantallaInicioDTO,
    PermisoDePersonaDTO,
)
from backend.infrastructure.PermisosRepository import PermisosRepository
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.infrastructure.db import SessionLocal

router = APIRouter(prefix="/permisos")


async def get_db():
    async with SessionLocal() as session:
        yield session


# Leer la matriz y los permisos de la gente.
_ver = require_seccion("configuracion_usuarios")


async def _admin(
    actor: UsuarioActual = Depends(get_usuario_actual),
    _u: dict = Depends(require_admin),
) -> UsuarioActual:
    """Quien cambia algo: admin, según la base. Devuelve su fila (el id es el de la
    base, no el del token)."""
    return actor


# El nivel dicho como lo diría una persona, para la frase de la auditoría.
_DICHO = {"none": "sin acceso", "read": "ver", "write": "editar", "admin": "administrar"}

# Lo que ningún rol ni persona que no sea admin puede tener (ver «QUIÉN PUEDE»).
_TOPE_AREA = {"configuracion": "write"}
_TOPE_SECCION = {"configuracion_usuarios": "read"}
_SOLO_ADMIN = (
    "Administrar usuarios y permisos es sólo del rol Administrador: quien puede tocar "
    "permisos se da admin solo. Para cualquier otro rol o persona, Configuración llega "
    "hasta «editar» y «Usuarios y permisos» hasta «ver»."
)


# ─────────────────────────── ayudas ───────────────────────────


def _error(codigo_http: int, mensaje: str, campo: str = "global") -> HTTPException:
    return HTTPException(status_code=codigo_http, detail={"message": mensaje, "campo": campo})


def _area_o_404(codigo: str):
    if codigo not in AREA_POR_CODIGO:
        raise _error(404, f"No existe el área «{codigo}».", "area")
    return AREA_POR_CODIGO[codigo]


def _seccion_o_404(codigo: str):
    if codigo not in SECCION_POR_CODIGO:
        raise _error(404, f"No existe la sección «{codigo}».", "seccion")
    return SECCION_POR_CODIGO[codigo]


def _nombre_seccion(s) -> str:
    return f"«{s.nombre}» ({AREA_POR_CODIGO[s.area].nombre})"


async def _rol_o_404(repo: PermisosRepository, codigo: str):
    try:
        fila = await repo.rol(codigo)
    except Exception as e:
        await repo.db.rollback()
        logger.error(f"Permisos: no se pudo leer la tabla rol: {e}")
        raise _sin_tablas()
    if fila is None:
        raise _error(404, f"No existe el rol «{codigo}».", "rol")
    return fila


def _sin_tablas() -> HTTPException:
    return _error(
        503,
        "No se pudieron leer los permisos. Si recién se actualizó el servidor, falta "
        "que corra la migración de permisos.",
    )


async def _persona_o_404(db, id_usuario: int):
    fila = (await db.execute(
        select(Usuario.id_usuario, Usuario.username, Usuario.nombre, Usuario.apellido,
               Usuario.rol, Usuario.activo)
        .where(Usuario.id_usuario == id_usuario)
    )).first()
    if fila is None:
        raise _error(404, f"No existe el usuario #{id_usuario}.", "id_usuario")
    return fila


def _nombre_persona(p) -> str:
    return " ".join(x for x in (p.nombre, p.apellido) if x).strip() or p.username


async def _guardar(db, que: str) -> None:
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"Permisos: no se pudo guardar {que}: {e}")
        raise _error(500, f"No se pudo guardar {que}. Probá de nuevo.")


def _dejar_dicho(request: Request, frase: str, antes=None, despues=None) -> None:
    """Lo que el middleware de auditoría no puede saber solo (ver main.py)."""
    request.state.auditoria = {"frase": frase, "antes": antes, "despues": despues}


def _catalogo(confidenciales: dict) -> list[dict]:
    return [
        {
            "codigo": a.codigo,
            "nombre": a.nombre,
            "orden": a.orden,
            "secciones": [
                {
                    "codigo": s.codigo,
                    "nombre": s.nombre,
                    "orden": s.orden,
                    "confidencial": bool(confidenciales.get(s.codigo, s.confidencial)),
                    "confidencial_por_defecto": s.confidencial,
                }
                for s in secciones_de_area(a.codigo)
            ],
        }
        for a in sorted(AREAS, key=lambda a: a.orden)
    ]


def _orden_de_rol(codigo: str):
    """admin primero, después los del SRS en su orden, después los que se creen."""
    sembrados = [c for c, _ in ROLES]
    return (0 if codigo == ROL_ADMIN else 1,
            sembrados.index(codigo) if codigo in sembrados else len(sembrados), codigo)


def _efectivas_de_rol(rol: str, areas: dict, secciones: dict, confidenciales: dict) -> dict:
    """Lo que termina viendo el rol en cada sección, con las reglas de siempre."""
    return resolver_permisos(DatosDePermisos(
        rol=rol, rol_areas=areas, rol_secciones=secciones, confidenciales=confidenciales,
    ))["secciones"]


# ─────────────────────────── catálogo y matriz ───────────────────────────


@router.get("/catalogo", response_model=ResponseDTO)
async def catalogo(
    _u: UsuarioActual = Depends(get_usuario_actual),
    db=Depends(get_db),
):
    """Áreas (una por ítem del menú), sus secciones con la marca de confidencial y los
    niveles. Cualquiera con sesión: son nombres de pantallas, sin datos de nadie.

    Si la tabla `seccion` no se puede leer (migración sin correr), la marca es la del
    catálogo de código: la pantalla igual se arma."""
    try:
        confidenciales = await PermisosRepository(db).confidenciales()
    except Exception as e:
        await db.rollback()
        logger.warning(f"Permisos: catálogo sin la tabla seccion ({e}); va el de código.")
        confidenciales = {}
    return ResponseDTO(
        status=True,
        message="Catálogo de permisos",
        data={"niveles": list(NIVELES), "areas": _catalogo(confidenciales)},
    )


@router.get("/matriz", response_model=ResponseDTO, dependencies=[Depends(_ver)])
async def matriz(db=Depends(get_db)):
    """Cada rol con su nivel en cada área, sus overrides por sección (`secciones`, sólo
    las que tiene: la que falta hereda) y lo que termina viendo en cada sección
    (`secciones_efectivas`). El admin sale con admin en todo: lo es por regla."""
    repo = PermisosRepository(db)
    try:
        confidenciales = await repo.confidenciales()
        rol_areas, rol_secciones = await repo.niveles_de_roles()
        activos = await repo.usuarios_activos_por_rol()
        todos = await repo.usuarios_por_rol()
    except Exception as e:
        await db.rollback()
        logger.error(f"Permisos: no se pudo leer la matriz: {e}")
        raise _sin_tablas()
    roles = await repo.roles()
    if roles is None:
        raise _sin_tablas()
    # RF-28. Lo último: si la columna todavía no existe, el rollback no se lleva nada y la
    # matriz sale igual, sin la pantalla de inicio (`pantalla_inicio_disponible: false`).
    pantallas = await repo.pantallas_inicio_de_roles()

    salida = []
    for codigo, nombre in sorted(roles, key=lambda r: _orden_de_rol(r[0])):
        es_admin = codigo == ROL_ADMIN
        if es_admin:
            areas = {a.codigo: "admin" for a in AREAS}
            secciones: dict = {}
            efectivas = {s: "admin" for s in SECCION_POR_CODIGO}
        else:
            areas = {a.codigo: nivel_valido(rol_areas.get(codigo, {}).get(a.codigo)) for a in AREAS}
            secciones = {s: nivel_valido(n) for s, n in rol_secciones.get(codigo, {}).items()}
            efectivas = _efectivas_de_rol(codigo, areas, secciones, confidenciales)
        fila = {
            "codigo": codigo,
            "nombre": nombre,
            "es_admin": es_admin,
            "usuarios_activos": activos.get(codigo, 0),
            # Con los que no tienen acceso: es lo que frena borrar el rol.
            "usuarios": todos.get(codigo, 0),
            "areas": areas,
            "secciones": secciones,
            "secciones_efectivas": efectivas,
        }
        if pantallas is not None:
            # Una que quedó vieja en la base (ya no es del menú) sale como ninguna.
            fila["pantalla_inicio"] = pantalla_de_inicio(None, pantallas.get(codigo))
        salida.append(fila)
    return ResponseDTO(
        status=True,
        message=f"{len(salida)} rol(es)",
        data={"niveles": list(NIVELES), "areas": _catalogo(confidenciales), "roles": salida,
              "pantalla_inicio_disponible": pantallas is not None,
              # Este servidor sabe crear, renombrar y borrar roles (la pantalla lo ofrece
              # sólo si lo dice).
              "abm_de_roles": True},
    )


# ─────────────────────────── los roles: crear, renombrar, borrar ───────────────────────────
#
# El ABM de roles de Don Joaquín (crearRolAction, renombrarRolAction, eliminarRolAction).
# Hasta el 23/09 SPMM tenía fijos los tres sembrados, aunque la ayuda hablaba de «los que
# se creen».


def _nombre_repetido(nombres: dict, nombre: str, salvo: Optional[str] = None) -> Optional[str]:
    codigo = nombres.get(nombre.strip().lower())
    return codigo if codigo is not None and codigo != salvo else None


@router.post("/roles", response_model=ResponseDTO)
async def crear_rol(
    cuerpo: NombreDeRolDTO,
    request: Request,
    db=Depends(get_db),
    actor: UsuarioActual = Depends(_admin),
):
    """Un rol nuevo, SIN NINGÚN PERMISO (todo en «sin acceso»): se le da lo que haga falta
    en la matriz, una vez creado. El código sale del nombre («Pañol» -> panol), único, y
    no cambia si después se lo renombra."""
    repo = PermisosRepository(db)
    try:
        usados = await repo.codigos_de_rol_usados()
        nombres = await repo.nombres_de_roles()
    except Exception as e:
        await db.rollback()
        logger.error(f"Permisos: no se pudo leer la tabla rol: {e}")
        raise _sin_tablas()
    if _nombre_repetido(nombres, cuerpo.nombre):
        raise _error(409, f"Ya hay un rol que se llama «{cuerpo.nombre}».", "nombre")
    codigo = codigo_para_rol(cuerpo.nombre, usados)
    await repo.crear_rol(codigo, cuerpo.nombre)
    await _guardar(db, "el rol")
    frase = f"creó el rol «{cuerpo.nombre}» ({codigo}), sin ningún permiso"
    _dejar_dicho(request, frase, antes=None, despues={"codigo": codigo, "nombre": cuerpo.nombre})
    return ResponseDTO(
        status=True,
        message=frase[0].upper() + frase[1:],
        data={"codigo": codigo, "nombre": cuerpo.nombre, "es_admin": False,
              "usuarios_activos": 0, "usuarios": 0},
    )


@router.put("/roles/{rol}", response_model=ResponseDTO)
async def renombrar_rol(
    rol: str,
    cuerpo: NombreDeRolDTO,
    request: Request,
    db=Depends(get_db),
    actor: UsuarioActual = Depends(_admin),
):
    """Cambiarle el nombre a un rol. El código queda: es lo que tiene guardado cada
    persona y cada permiso. El Administrador no se renombra."""
    repo = PermisosRepository(db)
    fila = await _rol_o_404(repo, rol)
    if rol == ROL_ADMIN:
        raise _error(409, "El rol Administrador no se renombra.", "rol")
    if fila.nombre == cuerpo.nombre:
        return ResponseDTO(status=True, message="Sin cambios",
                           data={"codigo": rol, "nombre": cuerpo.nombre})
    if _nombre_repetido(await repo.nombres_de_roles(), cuerpo.nombre, salvo=rol):
        raise _error(409, f"Ya hay un rol que se llama «{cuerpo.nombre}».", "nombre")
    await repo.renombrar_rol(rol, cuerpo.nombre)
    await _guardar(db, "el nombre del rol")
    frase = f"renombró el rol «{fila.nombre}» a «{cuerpo.nombre}»"
    _dejar_dicho(request, frase, antes={"nombre": fila.nombre}, despues={"nombre": cuerpo.nombre})
    return ResponseDTO(status=True, message=frase[0].upper() + frase[1:],
                       data={"codigo": rol, "nombre": cuerpo.nombre})


@router.delete("/roles/{rol}", response_model=ResponseDTO)
async def borrar_rol(
    rol: str,
    request: Request,
    db=Depends(get_db),
    actor: UsuarioActual = Depends(_admin),
):
    """Borrar un rol que nadie tiene. Con gente —aunque sea sin acceso: si se le devuelve
    el acceso, tiene que tener un rol que exista— es 409 y dice cuántos: primero se los
    pasa a otro rol. El Administrador no se borra.

    Va de a uno con los cambios de rol (reglas_de_roles.de_a_uno): si no, alguien podría
    quedar con un rol recién borrado, que no abre nada."""
    async with de_a_uno(db):
        repo = PermisosRepository(db)
        fila = await _rol_o_404(repo, rol)
        if rol == ROL_ADMIN:
            raise _error(409, "El rol Administrador no se puede borrar.", "rol")
        activos, sin_acceso = await repo.usuarios_del_rol(rol)
        if activos + sin_acceso:
            total = activos + sin_acceso
            detalle = f" ({sin_acceso} sin acceso)" if sin_acceso else ""
            raise _error(
                409,
                f"No se puede borrar «{fila.nombre}»: lo tiene{'n' if total > 1 else ''} "
                f"{total} persona{'s' if total > 1 else ''}{detalle}. Pasalas a otro rol primero.",
                "rol",
            )
        await repo.borrar_rol(rol)
        await _guardar(db, "el borrado del rol")
    frase = f"borró el rol «{fila.nombre}» ({rol})"
    _dejar_dicho(request, frase, antes={"codigo": rol, "nombre": fila.nombre}, despues=None)
    return ResponseDTO(status=True, message=frase[0].upper() + frase[1:], data={"codigo": rol})


@router.put("/roles/{rol}/areas/{area}", response_model=ResponseDTO)
async def poner_nivel_de_rol_en_area(
    rol: str,
    area: str,
    cuerpo: NivelDeRolEnAreaDTO,
    request: Request,
    db=Depends(get_db),
    actor: UsuarioActual = Depends(_admin),
):
    """El nivel de un rol en un área. Vale desde el pedido siguiente de cada persona
    con ese rol (los permisos se leen de la base en cada pedido)."""
    info = _area_o_404(area)
    repo = PermisosRepository(db)
    fila_rol = await _rol_o_404(repo, rol)
    if rol == ROL_ADMIN:
        raise _error(409, "El rol Administrador es admin en todo por regla: no se configura por área.", "rol")
    nuevo = cuerpo.nivel
    if area in _TOPE_AREA and rango(nuevo) > rango(_TOPE_AREA[area]):
        raise _error(409, _SOLO_ADMIN, "nivel")
    antes = nivel_valido(await repo.nivel_rol_area(rol, area))
    if antes != nuevo:
        await repo.poner_rol_area(rol, area, nuevo)
        await _guardar(db, "el permiso del rol")
    _dejar_dicho(
        request,
        f"cambió el permiso del rol «{fila_rol.nombre}» en «{info.nombre}»: "
        f"{_DICHO[antes]} → {_DICHO[nuevo]}" if antes != nuevo else
        f"dejó el permiso del rol «{fila_rol.nombre}» en «{info.nombre}» como estaba ({_DICHO[nuevo]})",
        antes={"rol": rol, "area": area, "nivel": antes},
        despues={"rol": rol, "area": area, "nivel": nuevo},
    )
    return ResponseDTO(
        status=True,
        message=f"«{fila_rol.nombre}» en «{info.nombre}»: {_DICHO[nuevo]}",
        data={"rol": rol, "area": area, "nivel": nuevo, "antes": antes},
    )


@router.put("/roles/{rol}/secciones/{seccion}", response_model=ResponseDTO)
async def poner_nivel_de_rol_en_seccion(
    rol: str,
    seccion: str,
    cuerpo: NivelDeRolEnSeccionDTO,
    request: Request,
    db=Depends(get_db),
    actor: UsuarioActual = Depends(_admin),
):
    """Override de un rol en una sección. «hereda» lo saca.

    En una sección que NO es confidencial sólo puede RESTRINGIR: un nivel igual o mayor
    al del área no significa nada (409, igual que DJ: para igualarlo está «hereda»). En
    una confidencial es lo que la abre para ese rol."""
    info = _seccion_o_404(seccion)
    repo = PermisosRepository(db)
    fila_rol = await _rol_o_404(repo, rol)
    if rol == ROL_ADMIN:
        raise _error(409, "El rol Administrador ve todo: no se configura por sección.", "rol")
    nuevo: Optional[str] = None if cuerpo.nivel == "hereda" else cuerpo.nivel
    confidencial = (await repo.confidenciales()).get(seccion, info.confidencial)
    if nuevo is not None:
        if seccion in _TOPE_SECCION and rango(nuevo) > rango(_TOPE_SECCION[seccion]):
            raise _error(409, _SOLO_ADMIN, "nivel")
        if not confidencial:
            nivel_area = nivel_valido(await repo.nivel_rol_area(rol, info.area))
            if rango(nuevo) >= rango(nivel_area):
                raise _error(
                    409,
                    f"En «{info.nombre}» el rol sólo puede tener MENOS que lo que le da el "
                    f"área («{AREA_POR_CODIGO[info.area].nombre}»: {_DICHO[nivel_area]}). "
                    "Para que tenga lo mismo, usá «Hereda del área».",
                    "nivel",
                )
    antes = await repo.nivel_rol_seccion(rol, seccion)
    if antes != nuevo:
        await repo.poner_rol_seccion(rol, seccion, nuevo)
        await _guardar(db, "el permiso del rol en la sección")
    if nuevo is None:
        frase = (f"volvió a cerrar {_nombre_seccion(info)} para el rol «{fila_rol.nombre}»"
                 if confidencial else
                 f"hizo que el rol «{fila_rol.nombre}» herede del área en {_nombre_seccion(info)}")
    else:
        frase = f"puso al rol «{fila_rol.nombre}» en {_nombre_seccion(info)}: {_DICHO[nuevo]}"
    _dejar_dicho(
        request, frase,
        antes={"rol": rol, "seccion": seccion, "nivel": antes or "hereda"},
        despues={"rol": rol, "seccion": seccion, "nivel": nuevo or "hereda"},
    )
    return ResponseDTO(
        status=True,
        message=frase[0].upper() + frase[1:],
        data={"rol": rol, "seccion": seccion, "nivel": nuevo or "hereda", "antes": antes or "hereda"},
    )


@router.put("/secciones/{seccion}/confidencial", response_model=ResponseDTO)
async def marcar_confidencial(
    seccion: str,
    cuerpo: ConfidencialDTO,
    request: Request,
    forzar: bool = False,
    db=Depends(get_db),
    actor: UsuarioActual = Depends(_admin),
):
    """Marca o desmarca una sección como confidencial (cerrada para todo el que no sea
    admin salvo que se le otorgue).

    Desmarcarla la abre a todo rol que tenga el área: si eso le da acceso a alguien,
    primero avisa quiénes (409) y se hace igual con ?forzar=true."""
    info = _seccion_o_404(seccion)
    repo = PermisosRepository(db)
    try:
        confidenciales = await repo.confidenciales()
    except Exception as e:
        await db.rollback()
        logger.error(f"Permisos: no se pudo leer la tabla seccion: {e}")
        raise _sin_tablas()
    antes = bool(confidenciales.get(seccion, info.confidencial))
    nuevo = cuerpo.confidencial

    if antes and not nuevo and not forzar:
        rol_areas, rol_secciones = await repo.niveles_de_roles()
        activos = await repo.usuarios_activos_por_rol()
        todos = await repo.usuarios_por_rol()
        ganan = []
        for codigo, nombre in sorted(await repo.roles() or [], key=lambda r: _orden_de_rol(r[0])):
            if codigo == ROL_ADMIN:
                continue
            areas = rol_areas.get(codigo, {})
            secs = rol_secciones.get(codigo, {})
            hoy = _efectivas_de_rol(codigo, areas, secs, {**confidenciales, seccion: True})[seccion]
            despues = _efectivas_de_rol(codigo, areas, secs, {**confidenciales, seccion: False})[seccion]
            if rango(despues) > rango(hoy):
                n = activos.get(codigo, 0)
                ganan.append(f"{nombre} ({n} persona{'s' if n != 1 else ''})")
        if ganan:
            raise _error(
                409,
                f"Si {_nombre_seccion(info)} deja de ser confidencial, la van a poder ver: "
                f"{', '.join(ganan)}. ¿Sacarle la marca igual?",
                "confidencial",
            )

    if antes != nuevo:
        await repo.poner_confidencial(info, nuevo)
        await _guardar(db, "la marca de confidencial")
    frase = (f"marcó {_nombre_seccion(info)} como confidencial" if nuevo
             else f"le sacó la marca de confidencial a {_nombre_seccion(info)}")
    _dejar_dicho(request, frase, antes={"seccion": seccion, "confidencial": antes},
                 despues={"seccion": seccion, "confidencial": nuevo})
    return ResponseDTO(
        status=True,
        message=frase[0].upper() + frase[1:],
        data={"seccion": seccion, "confidencial": nuevo, "antes": antes},
    )


# ─────────────────────────── permisos de una persona ───────────────────────────


@router.get("/overrides", response_model=ResponseDTO, dependencies=[Depends(_ver)])
async def overrides_de_todos(db=Depends(get_db)):
    """Los permisos de más de todos, vencidos incluidos (con `vigente`)."""
    try:
        datos = await PermisosRepository(db).overrides()
    except Exception as e:
        await db.rollback()
        logger.error(f"Permisos: no se pudieron leer los permisos de más: {e}")
        raise _sin_tablas()
    return ResponseDTO(status=True, message="Permisos de más", data=datos)


@router.get("/usuarios/{id_usuario}", response_model=ResponseDTO, dependencies=[Depends(_ver)])
async def permisos_de_una_persona(id_usuario: int, db=Depends(get_db)):
    """Su rol, sus permisos de más (vencidos incluidos) y lo que termina pudiendo por
    área y por sección (`efectivos`; None si la cuenta está inactiva)."""
    persona = await _persona_o_404(db, id_usuario)
    repo = PermisosRepository(db)
    # Primero: si la columna falta, el rollback no se lleva nada.
    admin_permanente = await repo.admin_permanente(id_usuario)
    try:
        datos = await repo.overrides(id_usuario)
        efectivos = await repo.permisos_de_usuario(id_usuario=id_usuario)
    except Exception as e:
        await db.rollback()
        logger.error(f"Permisos: no se pudieron leer los de #{id_usuario}: {e}")
        raise _sin_tablas()
    return ResponseDTO(
        status=True,
        message=f"Permisos de {_nombre_persona(persona)}",
        data={
            "usuario": {
                "id_usuario": persona.id_usuario,
                "username": persona.username,
                "nombre": persona.nombre,
                "apellido": persona.apellido,
                "rol": persona.rol,
                "activo": persona.activo,
                "admin_permanente": admin_permanente,
            },
            "areas": datos["areas"],
            "secciones": datos["secciones"],
            "efectivos": efectivos.como_dict() if efectivos else None,
        },
    )


async def _dar(modelo, *, id_usuario: int, codigo: str, nombre: str, cuerpo: PermisoDePersonaDTO,
               actor: UsuarioActual, request: Request, db) -> ResponseDTO:
    if id_usuario == actor.id_usuario:
        raise _error(409, "No podés darte permisos a vos mismo: pedíselo a otro administrador.",
                     "id_usuario")
    persona = await _persona_o_404(db, id_usuario)
    if persona.rol == ROL_ADMIN:
        raise _error(
            409,
            f"{_nombre_persona(persona)} es administrador: ya puede todo y un permiso de más "
            "no le cambia nada. Si le vas a cambiar el rol, cambiáselo primero.",
            "id_usuario",
        )
    tope = (_TOPE_AREA if modelo is UsuarioArea else _TOPE_SECCION).get(codigo)
    if tope and rango(cuerpo.nivel) > rango(tope):
        raise _error(409, _SOLO_ADMIN, "nivel")
    if cuerpo.vence_en is not None and cuerpo.vence_en <= ahora_ar():
        raise _error(400, "Esa fecha de vencimiento ya pasó: el permiso no contaría nunca.",
                     "vence_en")

    repo = PermisosRepository(db)
    try:
        previa = await repo.override(modelo, id_usuario, codigo)
    except Exception as e:
        await db.rollback()
        logger.error(f"Permisos: no se pudo leer el permiso de más: {e}")
        raise _sin_tablas()
    antes = None if previa is None else {
        "nivel": previa.nivel,
        "vence_en": previa.vence_en.isoformat() if previa.vence_en else None,
        "motivo": previa.motivo,
        "otorgado_por": previa.otorgado_por,
    }
    await repo.poner_override(modelo, id_usuario=id_usuario, codigo=codigo, nivel=cuerpo.nivel,
                              vence_en=cuerpo.vence_en, motivo=cuerpo.motivo,
                              otorgado_por=actor.id_usuario)
    await _guardar(db, "el permiso")
    despues = {
        "nivel": cuerpo.nivel,
        "vence_en": cuerpo.vence_en.isoformat() if cuerpo.vence_en else None,
        "motivo": cuerpo.motivo,
        "otorgado_por": actor.id_usuario,
    }
    hasta = (f"hasta el {cuerpo.vence_en:%d/%m/%Y %H:%M}" if cuerpo.vence_en else "sin vencimiento")
    frase = f"le dio a {_nombre_persona(persona)} {nombre} para {_DICHO[cuerpo.nivel]}, {hasta}"
    if cuerpo.motivo:
        frase += f" — {cuerpo.motivo}"
    _dejar_dicho(request, frase, antes=antes, despues=despues)
    efectivos = await repo.permisos_de_usuario(id_usuario=id_usuario)
    return ResponseDTO(
        status=True,
        message=frase[0].upper() + frase[1:],
        data={"codigo": codigo, **despues, "antes": antes,
              "efectivos": efectivos.como_dict() if efectivos else None},
    )


async def _sacar(modelo, *, id_usuario: int, codigo: str, nombre: str, actor: UsuarioActual,
                 request: Request, db) -> ResponseDTO:
    """Sacar un permiso de más. Sacarse uno a uno mismo sí se puede (sólo resta). Si no
    había nada, contesta bien igual: la pantalla que revierte no tiene que fallar."""
    persona = await _persona_o_404(db, id_usuario)
    repo = PermisosRepository(db)
    try:
        previa = await repo.override(modelo, id_usuario, codigo)
    except Exception as e:
        await db.rollback()
        logger.error(f"Permisos: no se pudo leer el permiso de más: {e}")
        raise _sin_tablas()
    antes = None
    if previa is not None:
        antes = {
            "nivel": previa.nivel,
            "vence_en": previa.vence_en.isoformat() if previa.vence_en else None,
            "motivo": previa.motivo,
            "otorgado_por": previa.otorgado_por,
        }
        await db.delete(previa)
        await _guardar(db, "el permiso")
        frase = f"le sacó a {_nombre_persona(persona)} {nombre} (tenía {_DICHO.get(antes['nivel'], antes['nivel'])})"
    else:
        frase = f"quiso sacarle a {_nombre_persona(persona)} {nombre}, pero no lo tenía"
    _dejar_dicho(request, frase, antes=antes, despues=None)
    efectivos = await repo.permisos_de_usuario(id_usuario=id_usuario)
    return ResponseDTO(
        status=True,
        message=frase[0].upper() + frase[1:],
        data={"codigo": codigo, "antes": antes, "efectivos": efectivos.como_dict() if efectivos else None},
    )


@router.put("/usuarios/{id_usuario}/areas/{area}", response_model=ResponseDTO)
async def dar_area(id_usuario: int, area: str, cuerpo: PermisoDePersonaDTO, request: Request,
                   db=Depends(get_db), actor: UsuarioActual = Depends(_admin)):
    """Un área de más para una persona: sólo suma sobre lo de su rol."""
    info = _area_o_404(area)
    return await _dar(UsuarioArea, id_usuario=id_usuario, codigo=area, nombre=f"«{info.nombre}»",
                      cuerpo=cuerpo, actor=actor, request=request, db=db)


@router.delete("/usuarios/{id_usuario}/areas/{area}", response_model=ResponseDTO)
async def sacar_area(id_usuario: int, area: str, request: Request,
                     db=Depends(get_db), actor: UsuarioActual = Depends(_admin)):
    info = _area_o_404(area)
    return await _sacar(UsuarioArea, id_usuario=id_usuario, codigo=area, nombre=f"«{info.nombre}»",
                        actor=actor, request=request, db=db)


@router.put("/usuarios/{id_usuario}/secciones/{seccion}", response_model=ResponseDTO)
async def dar_seccion(id_usuario: int, seccion: str, cuerpo: PermisoDePersonaDTO, request: Request,
                      db=Depends(get_db), actor: UsuarioActual = Depends(_admin)):
    """Una sección de más para una persona —incluida una confidencial— sin abrírsela a
    todo su rol."""
    info = _seccion_o_404(seccion)
    return await _dar(UsuarioSeccion, id_usuario=id_usuario, codigo=seccion,
                      nombre=_nombre_seccion(info), cuerpo=cuerpo, actor=actor,
                      request=request, db=db)


@router.delete("/usuarios/{id_usuario}/secciones/{seccion}", response_model=ResponseDTO)
async def sacar_seccion(id_usuario: int, seccion: str, request: Request,
                        db=Depends(get_db), actor: UsuarioActual = Depends(_admin)):
    info = _seccion_o_404(seccion)
    return await _sacar(UsuarioSeccion, id_usuario=id_usuario, codigo=seccion,
                        nombre=_nombre_seccion(info), actor=actor, request=request, db=db)


@router.put("/usuarios/{id_usuario}/rol", response_model=ResponseDTO)
async def cambiar_rol(
    id_usuario: int,
    cuerpo: CambiarRolDTO,
    request: Request,
    db=Depends(get_db),
    sesiones=Depends(get_sesiones_permisos),
    actor: UsuarioActual = Depends(_admin),
):
    """Cambiarle el rol a alguien. Mismas reglas que PUT /auth/usuarios/{id}
    (application/reglas_de_roles.py): el rol tiene que existir, nadie se lo cambia a sí
    mismo, a un administrador permanente no se le cambia y el sistema nunca queda sin
    un admin activo. Vale desde su pedido siguiente, sin volver a entrar."""
    nuevo = cuerpo.rol
    # De a uno desde que se lee a la persona hasta que se guarda (reglas_de_roles.de_a_uno):
    # si no, dos admins que se bajan uno al otro a la vez dejan el sistema sin ninguno.
    async with de_a_uno(db):
        persona = await _persona_o_404(db, id_usuario)
        cambia = nuevo != persona.rol
        if cambia:
            try:
                await validar_rol(sesiones, nuevo)
            except BusinessException as e:
                raise _error(400, e.message, "rol")
            await cuidar_administradores(
                sesiones,
                id_objetivo=id_usuario,
                id_actor=actor.id_usuario,
                rol_actual=persona.rol,
                activo_actual=persona.activo,
                rol_nuevo=nuevo,
                activo_nuevo=persona.activo,
            )
            await db.execute(
                update(Usuario).where(Usuario.id_usuario == id_usuario)
                .values(rol=nuevo, actualizado_por=actor.id_usuario, fecha_actualizacion=ahora_ar())
            )
            await _guardar(db, "el rol")
        else:
            await db.rollback()  # nada que guardar: que el candado no espere al final del pedido
    if cambia:
        frase = f"le cambió el rol a {_nombre_persona(persona)}: {persona.rol} → {nuevo}"
    else:
        frase = f"dejó a {_nombre_persona(persona)} con el rol que tenía ({nuevo})"
    _dejar_dicho(request, frase, antes={"rol": persona.rol}, despues={"rol": nuevo})
    efectivos = await PermisosRepository(db).permisos_de_usuario(id_usuario=id_usuario)
    return ResponseDTO(
        status=True,
        message=frase[0].upper() + frase[1:],
        data={"id_usuario": id_usuario, "rol": nuevo, "antes": persona.rol,
              "efectivos": efectivos.como_dict() if efectivos else None},
    )


# ─────────────────────────── la pantalla de inicio (RF-28) ───────────────────────────


def _sin_pantalla_de_inicio() -> HTTPException:
    return _error(
        503,
        "Todavía no se puede fijar la pantalla de inicio: si recién se actualizó el "
        "servidor, falta que corra la migración de la pantalla de inicio.",
        "pantalla_inicio",
    )


def _nombre_de_pantalla(ruta) -> str:
    p = PANTALLA_DE_INICIO_POR_RUTA.get(ruta or "")
    return f"«{p.nombre}»" if p else "ninguna"


@router.put("/usuarios/{id_usuario}/pantalla-inicio", response_model=ResponseDTO)
async def poner_pantalla_de_inicio_de_persona(
    id_usuario: int,
    cuerpo: PantallaInicioDTO,
    request: Request,
    db=Depends(get_db),
    actor: UsuarioActual = Depends(_admin),
):
    """La pantalla a la que entra esta persona después del login. Pisa la de su rol; null
    = «como su rol». Vale desde su próximo ingreso (o la próxima vez que abra la app).

    No da permiso para verla: `puede_abrirla` dice si la puede abrir HOY (con su rol y sus
    permisos de más). Si no, entra al Dashboard o a la primera que pueda ver."""
    persona = await _persona_o_404(db, id_usuario)
    repo = PermisosRepository(db)
    leidas = await repo.pantalla_inicio(id_usuario)
    if leidas is None:
        raise _sin_pantalla_de_inicio()
    antes, del_rol = leidas
    nuevo = cuerpo.pantalla_inicio
    if antes != nuevo:
        await repo.poner_pantalla_inicio_de_usuario(id_usuario, nuevo)
        await _guardar(db, "la pantalla de inicio")
    efectiva = pantalla_de_inicio(nuevo, del_rol)
    try:
        permisos = await repo.permisos_de_usuario(id_usuario=id_usuario)
    except Exception as e:
        # Ya se guardó: no saber si la puede abrir no tiene que decir que falló.
        await db.rollback()
        logger.warning(f"Permisos: no se pudieron leer los de #{id_usuario} para avisar: {e}")
        permisos = None
    puede = puede_abrir_pantalla(permisos, efectiva) if (efectiva and permisos) else None

    quien = _nombre_persona(persona)
    la_del_rol = pantalla_de_inicio(None, del_rol)
    if antes == nuevo:
        frase = (f"dejó la pantalla de inicio de {quien} como estaba "
                 f"({_nombre_de_pantalla(nuevo) if nuevo else 'la de su rol'})")
    elif nuevo is None:
        frase = (f"hizo que {quien} entre por la pantalla de inicio de su rol "
                 f"({_nombre_de_pantalla(la_del_rol) if la_del_rol else 'la de siempre'})")
    else:
        frase = f"le fijó a {quien} la pantalla de inicio {_nombre_de_pantalla(nuevo)}"
    _dejar_dicho(request, frase, antes={"pantalla_inicio": antes}, despues={"pantalla_inicio": nuevo})
    return ResponseDTO(
        status=True,
        message=frase[0].upper() + frase[1:],
        data={"id_usuario": id_usuario, "pantalla_inicio": nuevo, "antes": antes,
              "pantalla_del_rol": la_del_rol, "efectiva": efectiva,
              "puede_abrirla": puede},
    )


@router.put("/roles/{rol}/pantalla-inicio", response_model=ResponseDTO)
async def poner_pantalla_de_inicio_de_rol(
    rol: str,
    cuerpo: PantallaInicioDTO,
    request: Request,
    db=Depends(get_db),
    actor: UsuarioActual = Depends(_admin),
):
    """La pantalla a la que entran los de este rol que no tienen una propia; null = la de
    siempre. Vale también para el Administrador (no es un permiso: es por dónde entra).

    `puede_abrirla` dice si el ROL la puede abrir (sin mirar los permisos de más de cada
    persona, que sólo suman)."""
    repo = PermisosRepository(db)
    fila_rol = await _rol_o_404(repo, rol)
    pantallas = await repo.pantallas_inicio_de_roles()
    if pantallas is None:
        raise _sin_pantalla_de_inicio()
    antes = pantallas.get(rol)
    nuevo = cuerpo.pantalla_inicio
    if antes != nuevo:
        await repo.poner_pantalla_inicio_de_rol(rol, nuevo)
        await _guardar(db, "la pantalla de inicio del rol")

    puede = None
    if nuevo is not None:
        if rol == ROL_ADMIN:
            puede = True
        else:
            try:
                rol_areas, rol_secciones = await repo.niveles_de_roles()
                confidenciales = await repo.confidenciales()
                permisos = permisos_de(DatosDePermisos(
                    rol=rol, rol_areas=rol_areas.get(rol, {}),
                    rol_secciones=rol_secciones.get(rol, {}), confidenciales=confidenciales,
                ))
                puede = puede_abrir_pantalla(permisos, nuevo)
            except Exception as e:
                await db.rollback()
                logger.warning(f"Permisos: no se pudo ver si el rol {rol} abre {nuevo}: {e}")

    if antes == nuevo:
        frase = (f"dejó la pantalla de inicio del rol «{fila_rol.nombre}» como estaba "
                 f"({_nombre_de_pantalla(nuevo) if nuevo else 'la de siempre'})")
    elif nuevo is None:
        frase = f"volvió a dejar al rol «{fila_rol.nombre}» con la pantalla de inicio de siempre"
    else:
        frase = f"le fijó al rol «{fila_rol.nombre}» la pantalla de inicio {_nombre_de_pantalla(nuevo)}"
    _dejar_dicho(request, frase, antes={"rol": rol, "pantalla_inicio": antes},
                 despues={"rol": rol, "pantalla_inicio": nuevo})
    return ResponseDTO(
        status=True,
        message=frase[0].upper() + frase[1:],
        data={"rol": rol, "pantalla_inicio": nuevo, "antes": antes, "puede_abrirla": puede},
    )
