"""
Permisos por rol, área y sección (RF-24). La parte PURA: vocabulario, catálogo y reglas.

DE DÓNDE SALE

Es el modelo de usuarios y permisos de Don Joaquín, portado. Allá es Next.js +
Supabase y los permisos los resuelve Postgres con RLS; acá es FastAPI + SQLAlchemy +
JWT y no hay RLS, así que se porta el MODELO y las REGLAS —no el código— y la
verificación va en la API, como dependencias de FastAPI (core/security.py).

    DJ src/lib/permisos-nivel.ts          -> NIVELES, NIVEL_RANK
    DJ src/lib/permisos-usuarios-core.ts  -> resolver_nivel_seccion,
                                             resolver_usuarios_con_seccion,
                                             mapa_overrides_vigentes (mismas reglas,
                                             mismos casos de test)
    DJ src/lib/auth.ts (getCurrentUser)   -> resolver_permisos
    DJ src/lib/secciones.ts               -> AREAS, SECCIONES
    DJ usuarios.pantalla_inicio (RF-28)   -> PANTALLAS_DE_INICIO, pantalla_de_inicio
                                             (acá también una por rol)

Lo que NO se copió, a propósito: el bloqueo por horario (acceso_horario). Julián lo
descartó.

Este archivo no toca la base ni FastAPI: se puede importar desde cualquier lado y se
testea solo (tests/test_permisos_core.py). La lectura de la base está en
infrastructure/PermisosRepository.py y las dependencias, en core/security.py.

EL MODELO EN CINCO LÍNEAS

- Niveles: none < read < write < admin.
- Cada ROL tiene un nivel por ÁREA (rol_area). Un área = un ítem del menú.
- Una SECCIÓN (una solapa, o una parte sensible de una pantalla) hereda el nivel de
  su área; el rol la puede RESTRINGIR (rol_seccion), nunca subirla por encima del área.
- Una sección CONFIDENCIAL no hereda: está cerrada salvo que se otorgue a propósito
  (por rol o por persona), aunque se tenga el área.
- A una PERSONA se le pueden dar permisos de más (usuario_area, usuario_seccion), con
  vencimiento opcional. SOLO SUMAN, nunca restan, y los vencidos no cuentan.

Y el rol `admin` tiene nivel admin en todo, sin mirar ninguna tabla. Es lo que hace
que la migración no le cambie nada a nadie: hoy todos los usuarios son admin.

LAS REGLAS DE resolver_permisos, UNA POR UNA (idénticas a las de DJ)

1. admin -> "admin" en todas las áreas y secciones. Corta ahí.
2. Área = el máximo entre lo que da el rol y lo que se le dio a la persona.
3. Sección confidencial = lo que le dé el rol a esa sección (o nada), y encima lo que
   se le haya dado a la persona. El área no cuenta.
4. Sección no confidencial = el nivel del área (ya con lo de la persona); si el rol la
   restringe a algo MENOR, eso. Encima, lo que se le haya dado a la persona.
5. Un permiso de persona con vence_en ya pasado (<= ahora) no existe.

LO QUE NO TIENE ÁREA

Novedades, Mi cuenta (cambiar la contraseña), Notificaciones: son de todo el que
entra y no se cuelgan de ningún permiso. Esconderle a alguien «cambiar mi contraseña»
sería peor que cualquier cosa que el permiso quiera cuidar.

CÓMO SE CUELGA EN LOS ROUTERS

Una dependencia por router en main.py (require_politica), no endpoint por endpoint. QUÉ
pide cada router está en UN solo lugar: core/permisos_rutas.py (POLITICAS), con el
relevamiento de qué pantalla lee qué y el porqué de cada línea. La regla de fondo: quien
puede abrir una pantalla tiene que poder leer todo lo que esa pantalla pide, y leer un
catálogo lo puede cualquiera con sesión; escribir pide el área (o la solapa).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Mapping, Optional

# ─────────────────────────── vocabulario ───────────────────────────

NIVELES: tuple[str, ...] = ("none", "read", "write", "admin")
NIVEL_RANK: dict[str, int] = {"none": 0, "read": 1, "write": 2, "admin": 3}

# El único rol con nombre propio en el código. Todos los demás son filas de la tabla
# `rol` y se tratan igual.
ROL_ADMIN = "admin"


def rango(nivel: Optional[str]) -> int:
    """El rango de un nivel. Lo desconocido (un typo en la base, NULL) vale «none»:
    un permiso que no se entiende no abre nada."""
    return NIVEL_RANK.get(nivel or "none", 0)


def nivel_valido(nivel: Optional[str]) -> str:
    return nivel if nivel in NIVEL_RANK else "none"


def mayor(a: Optional[str], b: Optional[str]) -> str:
    """El más alto de dos niveles (el que gana cuando un permiso SUMA)."""
    a, b = nivel_valido(a), nivel_valido(b)
    return a if rango(a) >= rango(b) else b


def alcanza(tiene: Optional[str], pide: str) -> bool:
    return rango(tiene) >= rango(pide)


# ─────────────────────────── catálogo ───────────────────────────
#
# Las áreas salen de los ítems del menú (frontend/src/components/Sidebar.tsx) y las
# secciones, de las solapas de cada pantalla y de lo sensible que hay adentro. Es la
# ÚNICA fuente del catálogo del lado del servidor: la migración lo siembra igual (un
# test compara las dos cosas) y las dependencias validan contra esto, así que un
# require_area("operacion") con un typo revienta al importar y no en producción.
#
# La tabla `seccion` de la base puede cambiar la marca de confidencial (lo hará la
# pantalla de permisos); si una sección no tiene fila, vale lo que dice acá.


@dataclass(frozen=True)
class Area:
    codigo: str
    nombre: str
    orden: int


@dataclass(frozen=True)
class Seccion:
    codigo: str
    area: str
    nombre: str
    orden: int
    confidencial: bool = False


AREAS: tuple[Area, ...] = (
    Area("dashboard", "Dashboard", 10),
    # Operaciones: órdenes de trabajo, el planificador, la carga de la gente y la
    # materia prima. Es la pantalla de todos los días.
    Area("operaciones", "Operaciones", 20),
    # Planos: la biblioteca. La misma grilla aparece como solapa en Recursos; el
    # permiso va por el área Planos en los dos lugares, no por dónde esté colgada.
    Area("planos", "Planos", 30),
    # Recursos: los catálogos que el planificador usa para decidir (personas, máquinas,
    # procesos, rangos, sectores).
    Area("recursos", "Recursos", 40),
    Area("clientes", "Clientes", 50),
    Area("no_conformidades", "No conformidades", 60),
    # Auditoría: quién hizo qué. Es una herramienta de control, no de trabajo.
    Area("auditoria", "Auditoría", 70),
    # Configuración: la gestión de usuarios y la info del sistema. «Mi cuenta» y
    # «Notificaciones» viven en esta pantalla pero son de todos (ver arriba).
    Area("configuracion", "Configuración", 80),
)

SECCIONES: tuple[Seccion, ...] = (
    # --- Dashboard -----------------------------------------------------------
    # El rendimiento estimado vs. real POR PERSONA: compara a la gente con nombre y
    # apellido. Confidencial por lo que muestra: arranca cerrado para todo el que no
    # sea admin, aunque vea el dashboard, hasta que Lucas decida a quién abrírselo.
    Seccion("dashboard_rendimiento", "dashboard", "Rendimiento por persona", 10, True),
    # --- Operaciones (las solapas y el botón Planificar) ---------------------
    Seccion("operaciones_ordenes", "operaciones", "Órdenes de trabajo", 10),
    # Planificar, los borradores, confirmar el plan, quitar órdenes y la
    # disponibilidad (feriados): todo lo que mueve el plan.
    Seccion("operaciones_planificador", "operaciones", "Planificador", 11),
    Seccion("operaciones_recurso_humano", "operaciones", "Recurso humano", 12),
    Seccion("operaciones_materia_prima", "operaciones", "Materia prima", 13),
    # --- Recursos (las solapas; la de Planos es el área Planos) ---------------
    Seccion("recursos_humano", "recursos", "Recurso humano", 10),
    Seccion("recursos_maquinaria", "recursos", "Recurso maquinaria", 11),
    Seccion("recursos_procesos", "recursos", "Procesos", 12),
    Seccion("recursos_rangos", "recursos", "Rangos", 13),
    Seccion("recursos_sectores", "recursos", "Sectores", 14),
    # --- Auditoría (las solapas) ----------------------------------------------
    Seccion("auditoria_movimientos", "auditoria", "Todo lo que se hizo", 10),
    Seccion("auditoria_procesos", "auditoria", "Pasos de las OT", 11),
    Seccion("auditoria_planificacion", "auditoria", "Planificaciones", 12),
    # Ingresos (quién entró y salió, los intentos fallidos contra cada cuenta, con IP y
    # navegador) y Actividad por persona (RF-25). Confidencial: no se abre por tener
    # Auditoría, como «Rendimiento por persona» no se abre por tener el Dashboard.
    # Revisión del 23/09: iba colgada de «Todo lo que se hizo», que NO es confidencial, y
    # abrirle Auditoría a un supervisor para que vea «Pasos de las OT» le abría también
    # las IP y los intentos contra cada cuenta sin que nadie lo decidiera. Se agregó
    # cerrada para no cambiarle nada a lo que ya existía: si Auditoría entera tiene que
    # ser confidencial, se marca desde la pantalla de permisos (lo decide Lucas).
    Seccion("auditoria_ingresos", "auditoria", "Ingresos y actividad por persona", 13, True),
    # --- Configuración --------------------------------------------------------
    # Ver la lista de usuarios. Confidencial: cerrada para todo el que no sea admin
    # aunque tenga el área. Y aun abierta, CAMBIAR usuarios o permisos sigue siendo
    # sólo de admin (require_admin): quien pudiera tocar permisos se daría admin solo.
    Seccion("configuracion_usuarios", "configuracion", "Usuarios y permisos", 10, True),
)

AREA_POR_CODIGO: dict[str, Area] = {a.codigo: a for a in AREAS}
SECCION_POR_CODIGO: dict[str, Seccion] = {s.codigo: s for s in SECCIONES}


def secciones_de_area(area: str) -> list[Seccion]:
    return sorted((s for s in SECCIONES if s.area == area), key=lambda s: s.orden)


# ─────────────────────────── pantalla de inicio (RF-28) ───────────────────────────
#
# El SRS pide «personalizar el dashboard inicial por tipo de usuario». Es la
# `usuarios.pantalla_inicio` de Don Joaquín (migración 20260826f: «Anabela, que usa
# compliance, que la lleve a compliance de una»), con una más: allá se fija sólo por
# persona; acá además hay una por ROL (rol.pantalla_inicio), que es el «tipo de usuario»
# del SRS. La de la persona pisa la del rol; sin ninguna, el inicio de siempre.
#
# Se puede elegir cualquier pantalla del menú, y sólo ésas (DJ ruta-inicio.ts: `puedeAbrir`
# mira que la ruta esté en el menú). Es ESPEJO de MENU en frontend/src/lib/permisos.ts, con
# los mismos requisitos para abrirse: un test compara las dos listas.
#
# Fijarle una pantalla a alguien NO le da permiso para verla. Si no la puede abrir, entra
# al Dashboard, y si tampoco, a la primera del menú que sí pueda ver (lo decide la pantalla,
# rutaInicio, que nunca devuelve una ruta que rebote). `puede_abrir_pantalla` es la misma
# pregunta del lado del servidor: la API la contesta al fijarla, para avisar.


@dataclass(frozen=True)
class PantallaDeInicio:
    ruta: str
    nombre: str
    # Lo que pide para abrirse (igual que su ítem del menú): el área, y si tiene solapas,
    # alcanza con poder leer UNA. Sin nada = la ve todo el que entra.
    area: Optional[str] = None
    solapas: tuple[str, ...] = ()


PANTALLAS_DE_INICIO: tuple[PantallaDeInicio, ...] = (
    PantallaDeInicio("/dashboard", "Dashboard", "dashboard"),
    PantallaDeInicio("/operaciones", "Operaciones", "operaciones", (
        "operaciones_ordenes", "operaciones_planificador", "operaciones_recurso_humano",
    )),
    # Era una solapa de Operaciones; desde el 24/09 es su propia pantalla con la MISMA
    # sección (ver MENU en frontend/src/lib/permisos.ts).
    PantallaDeInicio("/materia-prima", "Materia prima", "operaciones", ("operaciones_materia_prima",)),
    PantallaDeInicio("/planos", "Planos", "planos"),
    PantallaDeInicio("/recursos", "Recursos", "recursos", (
        "recursos_humano", "recursos_maquinaria", "recursos_procesos",
        "recursos_rangos", "recursos_sectores",
    )),
    PantallaDeInicio("/clientes", "Clientes", "clientes"),
    PantallaDeInicio("/configuracion", "Configuración"),
    PantallaDeInicio("/no-conformidades", "No conformidades", "no_conformidades"),
    PantallaDeInicio("/auditoria", "Auditoría", "auditoria", (
        "auditoria_movimientos", "auditoria_procesos", "auditoria_planificacion",
        "auditoria_ingresos",
    )),
    PantallaDeInicio("/novedades", "Novedades"),
)

PANTALLA_DE_INICIO_POR_RUTA: dict[str, PantallaDeInicio] = {p.ruta: p for p in PANTALLAS_DE_INICIO}

# El largo de la columna (usuario.pantalla_inicio y rol.pantalla_inicio, VARCHAR(80)).
LARGO_PANTALLA_DE_INICIO = 80


def validar_pantalla_de_inicio(ruta: Optional[str]) -> Optional[str]:
    """La ruta limpia, o None (= «la de siempre» / «la de su rol»). Una que no es una
    pantalla del menú es ValueError: guardarla mandaría a alguien a un 404 cada mañana."""
    ruta = (ruta or "").strip()
    if not ruta:
        return None
    if ruta not in PANTALLA_DE_INICIO_POR_RUTA:
        raise ValueError(
            f"«{ruta}» no es una pantalla del menú. Las que se pueden elegir: "
            + ", ".join(p.ruta for p in PANTALLAS_DE_INICIO)
        )
    return ruta


def pantalla_de_inicio(de_la_persona: Optional[str], del_rol: Optional[str]) -> Optional[str]:
    """La pantalla fijada para alguien: la suya pisa la de su rol. Una que ya no está en
    el menú (quedó vieja en la base) no cuenta y deja pasar a la siguiente: mejor la de su
    rol que ninguna. None = el inicio de siempre."""
    for ruta in (de_la_persona, del_rol):
        ruta = (ruta or "").strip()
        if ruta in PANTALLA_DE_INICIO_POR_RUTA:
            return ruta
    return None


# ─────────────────────────── roles sembrados y matriz inicial ───────────────────────────
#
# Los tres del SRS (RF-24): Administrador, Supervisor, Operario. La matriz arranca
# CONSERVADORA —ante la duda, menos— porque Lucas la puede abrir desde la pantalla de
# permisos con un click, y un permiso de más que nadie nota es peor que uno de menos
# que alguien pide. PENDIENTE DE VALIDAR CON LUCAS, casilla por casilla.
#
#                     admin   supervisor  operario
#   dashboard         admin   read        read
#   operaciones       admin   write       read     (el operario no ve el planificador)
#   planos            admin   write       read
#   recursos          admin   read        none
#   clientes          admin   read        none
#   no_conformidades  admin   write       read
#   auditoria         admin   none        none
#   configuracion     admin   read        read     (la lista de usuarios es confidencial)
#
# Nadie que no sea admin arranca con una sección confidencial abierta.
#
# Las filas del admin son decorativas: el admin es admin en todo por regla (ver
# resolver_permisos), no por lo que diga su fila. Se siembran para que la matriz se
# lea completa.

ROLES: tuple[tuple[str, str], ...] = (
    ("admin", "Administrador"),
    ("supervisor", "Supervisor"),
    ("operario", "Operario"),
)

# ─────────────────────────── roles nuevos ───────────────────────────
#
# Los tres de arriba son los sembrados; desde la pantalla se crean, se renombran y se
# borran otros (el ABM de roles de DJ: crearRolAction, renombrarRolAction,
# eliminarRolAction). El código sale del nombre y NO cambia al renombrar: es lo que queda
# guardado en usuario.rol y en las filas de permisos.

LARGO_CODIGO_DE_ROL = 20  # usuario.rol y rol.codigo son VARCHAR(20)
LARGO_NOMBRE_DE_ROL = 80  # rol.nombre


def codigo_para_rol(nombre: str, usados: Iterable[str]) -> str:
    """El código de un rol nuevo, sacado de su nombre (slugRol de DJ): «Pañol» -> «panol»,
    «Jefe de planta» -> «jefe_de_planta». Sin tildes, en minúsculas y con _; empieza con
    letra y tiene de 2 a 20 caracteres (la forma que acepta el alta de usuarios). Nunca
    «admin» (sería admin por regla). Único: si ya está, «panol_2», «panol_3»...

    `usados` son los códigos que no se pueden repetir: los de la tabla rol y también los
    que tenga algún usuario aunque no estén en la tabla (un rol viejo que se borró a
    mano): si no, crear un rol con ese nombre le daría sus permisos a esa persona sin que
    nadie lo decida."""
    import re
    import unicodedata

    base = unicodedata.normalize("NFD", nombre or "").encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]+", "_", base).strip("_")
    if len(base) < 2 or not base[0].isalpha():
        base = f"rol_{base}".strip("_")
    base = base[:LARGO_CODIGO_DE_ROL].rstrip("_")
    if base == ROL_ADMIN:
        base = "rol_admin"
    usados = set(usados) | {ROL_ADMIN}
    codigo, n = base, 2
    while codigo in usados:
        sufijo = f"_{n}"
        codigo = base[:LARGO_CODIGO_DE_ROL - len(sufijo)].rstrip("_") + sufijo
        n += 1
    return codigo

MATRIZ_ROL_AREA: dict[str, dict[str, str]] = {
    "admin": {a.codigo: "admin" for a in AREAS},
    "supervisor": {
        "dashboard": "read",
        "operaciones": "write",
        "planos": "write",
        "recursos": "read",
        "clientes": "read",
        "no_conformidades": "write",
        "auditoria": "none",
        "configuracion": "read",
    },
    "operario": {
        "dashboard": "read",
        "operaciones": "read",
        "planos": "read",
        "recursos": "none",
        "clientes": "none",
        "no_conformidades": "read",
        "auditoria": "none",
        "configuracion": "read",
    },
}

# Overrides de sección por rol. Sólo restringen (en una no confidencial) o abren (en
# una confidencial). El operario ve Operaciones pero no la herramienta de planificar:
# le sirve el plan, no los borradores.
MATRIZ_ROL_SECCION: dict[str, dict[str, str]] = {
    "operario": {"operaciones_planificador": "none"},
}


# ─────────────────────────── método HTTP -> nivel ───────────────────────────

_METODOS_DE_LECTURA = frozenset({"GET", "HEAD", "OPTIONS"})


def nivel_para_metodo(metodo: str) -> str:
    """GET/HEAD/OPTIONS leen; todo lo demás escribe. Un método raro cuenta como
    escritura: ante la duda, se pide más."""
    return "read" if (metodo or "").upper() in _METODOS_DE_LECTURA else "write"


# ─────────────────────────── overrides vigentes ───────────────────────────


def vigente(vence_en: Optional[datetime], ahora: datetime) -> bool:
    """NULL = permanente. Si ya llegó (<= ahora), venció. Hora local sin zona."""
    return vence_en is None or vence_en > ahora


def mapa_overrides_vigentes(filas: Iterable[Mapping], ahora: datetime, clave: str = "id_usuario") -> dict:
    """Descarta los overrides vencidos y arma el mapa {clave: nivel}.

    Espejo de mapaOverridesVigentes (DJ). `clave` es la columna que indexa: el usuario
    cuando se mira UNA sección para muchos, o el área/sección cuando se mira UN
    usuario para todas."""
    mapa: dict = {}
    for f in filas:
        if not vigente(f.get("vence_en"), ahora):
            continue
        mapa[f[clave]] = f["nivel"]
    return mapa


# ─────────────────────────── la regla de una sección ───────────────────────────


def _nivel_de_seccion(
    es_admin: bool,
    es_confidencial: bool,
    override_rol: Optional[str],
    nivel_area: Optional[str],
    extra_seccion: Optional[str],
) -> str:
    """La regla, sola. `nivel_area` ya viene con lo que se le dio a la persona en el
    área. La usan las dos entradas (por usuario y por sección) para que no puedan
    decir cosas distintas."""
    if es_admin:
        return "admin"
    ov = nivel_valido(override_rol) if override_rol is not None else None
    if es_confidencial:
        # Cerrada salvo que se otorgue explícitamente (puede darse sin el área).
        nivel = ov or "none"
    else:
        # Hereda el área; el override de rol solo puede restringir, nunca superarla.
        area = nivel_valido(nivel_area)
        nivel = ov if (ov is not None and rango(ov) < rango(area)) else area
    # Lo que se le dio a la persona solo suma.
    if extra_seccion is not None and rango(extra_seccion) > rango(nivel):
        nivel = nivel_valido(extra_seccion)
    return nivel


# ─────────────────────────── entrada por SECCIÓN (espejo de DJ) ───────────────────────────


@dataclass
class EntradaSeccion:
    """Todo lo que hace falta para resolver UNA sección para varios usuarios.

    Espejo de ResolverInput (DJ). La única diferencia es que acá `usuario.rol` YA es el
    código del rol (en DJ es un id y hacía falta el mapa rol_id -> código).
    """

    usuarios: list[tuple[object, Optional[str]]]  # (id_usuario, rol)
    es_confidencial: bool
    nivel_por_rol_seccion: dict[str, str] = field(default_factory=dict)  # rol -> nivel
    nivel_por_rol_area: dict[str, str] = field(default_factory=dict)  # rol -> nivel del área madre
    extra_area: dict = field(default_factory=dict)  # id_usuario -> nivel (vigente)
    extra_seccion: dict = field(default_factory=dict)  # id_usuario -> nivel (vigente)


def resolver_nivel_seccion(entrada: EntradaSeccion, id_usuario) -> str:
    """Nivel efectivo de la sección para un usuario. Espejo de resolverNivelSeccion."""
    roles = [r for (i, r) in entrada.usuarios if i == id_usuario]
    if not roles:
        return "none"  # no está en la lista
    rol = roles[0]
    if rol == ROL_ADMIN:
        return "admin"
    nivel_area = entrada.nivel_por_rol_area.get(rol, "none") if rol else "none"
    extra = entrada.extra_area.get(id_usuario)
    if extra is not None and rango(extra) > rango(nivel_area):
        nivel_area = extra
    return _nivel_de_seccion(
        es_admin=False,
        es_confidencial=entrada.es_confidencial,
        override_rol=entrada.nivel_por_rol_seccion.get(rol) if rol else None,
        nivel_area=nivel_area,
        extra_seccion=entrada.extra_seccion.get(id_usuario),
    )


def resolver_usuarios_con_seccion(entrada: EntradaSeccion, min_nivel: str) -> set:
    """Los usuarios que llegan a `min_nivel` en la sección. Espejo de
    resolverUsuariosConSeccion: sirve para decidir a quién se le puede mostrar o
    mandar algo de una sección confidencial."""
    return {
        i for (i, _) in entrada.usuarios
        if alcanza(resolver_nivel_seccion(entrada, i), min_nivel)
    }


# ─────────────────────────── entrada por USUARIO (lo que usa la API) ───────────────────────────


@dataclass
class DatosDePermisos:
    """Lo que se leyó de la base para UN usuario. Los overrides ya vienen vigentes
    (mapa_overrides_vigentes)."""

    rol: Optional[str]
    activo: bool = True
    rol_areas: Mapping[str, str] = field(default_factory=dict)  # area -> nivel del rol
    rol_secciones: Mapping[str, str] = field(default_factory=dict)  # seccion -> override del rol
    usuario_areas: Mapping[str, str] = field(default_factory=dict)  # area -> nivel de la persona
    usuario_secciones: Mapping[str, str] = field(default_factory=dict)  # seccion -> nivel de la persona
    # seccion -> confidencial, como está en la base. La que no está, la dice el catálogo.
    confidenciales: Mapping[str, bool] = field(default_factory=dict)


def resolver_permisos(
    datos: DatosDePermisos,
    areas: Iterable[Area] = AREAS,
    secciones: Iterable[Seccion] = SECCIONES,
) -> dict[str, dict[str, str]]:
    """{"areas": {codigo: nivel}, "secciones": {codigo: nivel}} para un usuario.

    Espejo de getCurrentUser (DJ auth.ts). Un usuario inactivo no tiene nada: la
    dependencia ya lo corta antes con un 401, esto es por si alguien lo llama suelto.
    """
    areas = list(areas)
    secciones = list(secciones)
    if not datos.activo:
        return {
            "areas": {a.codigo: "none" for a in areas},
            "secciones": {s.codigo: "none" for s in secciones},
        }
    if datos.rol == ROL_ADMIN:
        return {
            "areas": {a.codigo: "admin" for a in areas},
            "secciones": {s.codigo: "admin" for s in secciones},
        }

    por_area: dict[str, str] = {}
    for a in areas:
        por_area[a.codigo] = mayor(datos.rol_areas.get(a.codigo, "none"),
                                   datos.usuario_areas.get(a.codigo, "none"))

    por_seccion: dict[str, str] = {}
    for s in secciones:
        es_conf = datos.confidenciales.get(s.codigo)
        if es_conf is None:
            es_conf = s.confidencial
        por_seccion[s.codigo] = _nivel_de_seccion(
            es_admin=False,
            es_confidencial=bool(es_conf),
            override_rol=datos.rol_secciones.get(s.codigo),
            nivel_area=por_area.get(s.area, "none"),
            extra_seccion=datos.usuario_secciones.get(s.codigo),
        )
    return {"areas": por_area, "secciones": por_seccion}


@dataclass(frozen=True)
class PermisosUsuario:
    """Los permisos ya resueltos de quien hace el pedido. Es lo que devuelven las
    dependencias y lo que viaja en /auth/me y en la respuesta del login."""

    id_usuario: Optional[int]
    username: Optional[str]
    rol: Optional[str]
    areas: Mapping[str, str]
    secciones: Mapping[str, str]
    # None = no se pudo leer (la columna todavía no existe en esa base).
    admin_permanente: Optional[bool] = None

    @property
    def es_admin(self) -> bool:
        return self.rol == ROL_ADMIN

    def nivel_area(self, area: str) -> str:
        return "admin" if self.es_admin else nivel_valido(self.areas.get(area))

    def nivel_seccion(self, seccion: str) -> str:
        return "admin" if self.es_admin else nivel_valido(self.secciones.get(seccion))

    def tiene_area(self, area: str, nivel: str = "read") -> bool:
        return alcanza(self.nivel_area(area), nivel)

    def tiene_seccion(self, seccion: str, nivel: str = "read") -> bool:
        return alcanza(self.nivel_seccion(seccion), nivel)

    def como_dict(self) -> dict:
        return {
            "rol": self.rol,
            "es_admin": self.es_admin,
            "admin_permanente": self.admin_permanente,
            "areas": dict(self.areas),
            "secciones": dict(self.secciones),
        }


def permisos_de(
    datos: DatosDePermisos,
    id_usuario: Optional[int] = None,
    username: Optional[str] = None,
    admin_permanente: Optional[bool] = None,
) -> PermisosUsuario:
    resueltos = resolver_permisos(datos)
    return PermisosUsuario(
        id_usuario=id_usuario,
        username=username,
        rol=datos.rol,
        areas=resueltos["areas"],
        secciones=resueltos["secciones"],
        admin_permanente=admin_permanente,
    )


def puede_abrir_pantalla(permisos: Optional[PermisosUsuario], ruta: Optional[str]) -> bool:
    """¿Puede abrir esa pantalla del menú? Espejo de `cumple` (frontend/src/lib/permisos.ts):
    con solapas alcanza con leer una; si no, el área; sin requisito, sí. Una ruta que no
    es del menú, no (rutaInicio no la usaría). Sin permisos (cuenta inactiva), no."""
    pantalla = PANTALLA_DE_INICIO_POR_RUTA.get((ruta or "").strip())
    if pantalla is None or permisos is None:
        return False
    if pantalla.solapas:
        return any(permisos.tiene_seccion(s) for s in pantalla.solapas)
    if pantalla.area:
        return permisos.tiene_area(pantalla.area)
    return True


# ─────────────────────────── validaciones de código ───────────────────────────


def validar_area(area: str) -> Area:
    if area not in AREA_POR_CODIGO:
        raise ValueError(
            f"Área desconocida: {area!r}. Las que hay: {', '.join(AREA_POR_CODIGO)}"
        )
    return AREA_POR_CODIGO[area]


def validar_seccion(seccion: str) -> Seccion:
    if seccion not in SECCION_POR_CODIGO:
        raise ValueError(
            f"Sección desconocida: {seccion!r}. Las que hay: {', '.join(SECCION_POR_CODIGO)}"
        )
    return SECCION_POR_CODIGO[seccion]


def validar_nivel(nivel: str) -> str:
    if nivel not in NIVEL_RANK:
        raise ValueError(f"Nivel desconocido: {nivel!r}. Los que hay: {', '.join(NIVELES)}")
    return nivel
