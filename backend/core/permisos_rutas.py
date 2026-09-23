"""
Qué permiso pide cada router de la API (RF-24). ES EL MAPA: el único lugar del código
donde se decide quién puede leer y quién puede escribir cada cosa.

main.py lo cuelga router por router (una dependencia por router, no endpoint por
endpoint: son ~150). Fuera de acá sólo quedan tres cosas, y a propósito:
  · el ABM de usuarios y la administración de permisos (AuthAPI, PermisosAPI), que es
    sólo del rol admin —ver «EL ÁREA DE SISTEMA» más abajo—;
  · los borrados que ya pedían admin antes de esto (artículos, materia prima y la
    materia prima de la OT), que siguen con su `require_admin` encima de lo de acá;
  · /internal/*, que tiene su propio token para el cron y no pasa por ninguna sesión.

El modelo y las reglas (niveles, áreas, secciones, overrides) están en core/permisos.py;
la dependencia que aplica esto en cada pedido, en core/security.py (require_politica).

CÓMO SE LEE UNA POLÍTICA

  leer         lo que pide un GET/HEAD/OPTIONS. Alcanza con CUALQUIERA de los requisitos
               (cualquiera de las pantallas que lo muestran). LIBRE = cualquiera con
               sesión y cuenta activa.
  escribir     lo que pide un POST/PUT/PATCH/DELETE. También alcanza con uno.
  excepciones  rutas puntuales del router que piden otra cosa. La ruta es la plantilla
               de FastAPI tal cual, con sus {llaves}; un test exige que exista, así un
               renombre no deja una excepción apuntando a la nada.

Una sección no confidencial hereda el nivel de su área, así que pedir la sección en vez
del área sólo cambia algo cuando el rol la RESTRINGE: por eso las escrituras piden la
sección de la solapa donde se edita (el operario ve Operaciones pero el planificador lo
tiene en «none», y eso tiene que valer también para la API, no sólo para el menú).

LAS DOS REGLAS DE FONDO

1. Quien puede ver una pantalla tiene que poder LEER todo lo que esa pantalla pide.
   Las pantallas comparten datos: el planificador lee personas, procesos, máquinas y
   rangos; el alta de OT lee clientes, artículos, sectores y prioridades; la ficha de la
   OT muestra sus planos, sus no conformidades y el historial de sus pasos. Si la lectura
   de cada cosa pidiera sólo su área, alguien con Operaciones vería la pantalla rota.

2. Leer un CATÁLOGO lo puede cualquiera con sesión; escribirlo pide el área (regla
   pragmática, pedida así). Catálogo = las listas que usan varias pantallas para elegir
   algo: procesos, personas, máquinas, rangos, sectores, prioridades, artículos,
   materia prima y el calendario del taller. Nada de eso es sensible, y
   cerrarlo obligaría a darle Recursos a todo el que planifica sólo para que cargue el
   desplegable de máquinas. Lo que NO es catálogo —las OT, el plan, los planos, las no
   conformidades, los clientes (tienen datos de contacto), el dashboard, la auditoría—
   se lee con el área de alguna de las pantallas que lo muestran.

RELEVAMIENTO (22/09/2026)

Salió de un grep de fetch/API_URL en frontend/src y de seguir qué página monta cada
componente (la ficha de la OT, el planificador y el Gantt se montan en Operaciones; el
detalle de la persona, en Recursos y en Operaciones; la biblioteca de planos, en Planos
y como solapa de Recursos):

  pantalla (área)    lee
  Dashboard          /api/dashboard/*, /incidencias/metricas
  Operaciones        /ordenes*, /ordenes-resumen, /ordenes-pausadas, /planificacion*, /planificar,
                     /config/availability, /ordenes-trabajo-piezas, /consumos-material,
                     /planos/orden/*, /planos/{id}/archivo, /ordenes/{id}/incidencias,
                     /auditoria/procesos?id_orden= (historial de UNA OT) y los catálogos
  Planos             /planos/*, /articulos
  Recursos           los catálogos y /planificacion (el plan de cada persona). La solapa
                     Planos de Recursos va por el área Planos, igual que la pantalla.
  Recursos y         la ficha de la persona: /operarios/{id}/ausencias y
  Operaciones        /operarios/{id}/tiempos (RF-06). La ficha se monta en las dos.
  Clientes           /clientes
  No conformidades   /incidencias/*
  Auditoría          /auditoria/movimientos, /auditoria/procesos, /auditoria/planificacion
  Configuración      /auth/usuarios (sección confidencial), /auth/change-password
  todas              /notificaciones, /auth/me

tests/test_permisos_rutas.py tiene esa tabla por pantalla y exige que alguien con SOLO
esa área pueda leer cada cosa, además de la matriz rol × router × método.

EL ÁREA DE SISTEMA (Configuración)

Administrar usuarios y permisos pide nivel admin en Configuración, y ese nivel es sólo
del rol Administrador: la API de permisos no deja dárselo a otro rol ni a una persona.
No es un capricho: quien puede tocar usuarios o permisos se hace admin solo (se da de
alta una cuenta admin, o se sube el nivel), así que abrirlo a medias no existe.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional

from backend.core.permisos import (
    AREA_POR_CODIGO,
    SECCION_POR_CODIGO,
    PermisosUsuario,
    nivel_para_metodo,
    validar_area,
    validar_nivel,
    validar_seccion,
)

# ─────────────────────────── piezas ───────────────────────────


@dataclass(frozen=True)
class Requisito:
    """Un nivel en un área o en una sección.

    `con_parametro`: el requisito sólo cuenta si el pedido trae ese parámetro de query
    con algún valor. Es para «el historial de UNA OT»: con `?id_orden=` alcanza con ver
    Operaciones; sin él es la auditoría entera y pide Auditoría.
    """

    area: Optional[str] = None
    seccion: Optional[str] = None
    nivel: str = "read"
    con_parametro: Optional[str] = None

    def __post_init__(self):
        if (self.area is None) == (self.seccion is None):
            raise ValueError("Un requisito es de un área O de una sección, uno de los dos.")
        # Un typo revienta al importar, no en producción.
        if self.area is not None:
            validar_area(self.area)
        else:
            validar_seccion(self.seccion)
        validar_nivel(self.nivel)

    def se_cumple(self, permisos: PermisosUsuario, parametros: Mapping[str, str]) -> bool:
        if self.con_parametro is not None and not (parametros.get(self.con_parametro) or "").strip():
            return False
        if self.area is not None:
            return permisos.tiene_area(self.area, self.nivel)
        return permisos.tiene_seccion(self.seccion, self.nivel)

    def que(self) -> str:
        """Cómo se nombra en el mensaje de «no tenés permiso para ...»."""
        if self.area is not None:
            return f"«{AREA_POR_CODIGO[self.area].nombre}»"
        s = SECCION_POR_CODIGO[self.seccion]
        return f"«{s.nombre}» ({AREA_POR_CODIGO[s.area].nombre})"


def area(codigo: str, nivel: str = "read", con_parametro: Optional[str] = None) -> Requisito:
    return Requisito(area=codigo, nivel=nivel, con_parametro=con_parametro)


def seccion(codigo: str, nivel: str = "read", con_parametro: Optional[str] = None) -> Requisito:
    return Requisito(seccion=codigo, nivel=nivel, con_parametro=con_parametro)


# Sin requisito: cualquiera con sesión y cuenta activa (la dependencia igual mira que
# la cuenta exista y esté activa: un token vivo de una cuenta desactivada no lee nada).
LIBRE: tuple[Requisito, ...] = ()


@dataclass(frozen=True)
class Excepcion:
    metodo: str  # "GET", "POST"... o "*" para todos
    ruta: str  # la plantilla de FastAPI, tal cual: "/api/dashboard/rendimiento-operarios"
    pide: tuple[Requisito, ...]
    porque: str


@dataclass(frozen=True)
class Politica:
    leer: tuple[Requisito, ...]
    escribir: tuple[Requisito, ...]
    excepciones: tuple[Excepcion, ...] = ()

    def requisitos(self, metodo: str, ruta: str) -> tuple[Requisito, ...]:
        """Lo que pide `metodo ruta` (la ruta es la plantilla de FastAPI)."""
        metodo = (metodo or "").upper()
        for e in self.excepciones:
            if e.ruta == ruta and e.metodo in ("*", metodo):
                return e.pide
        return self.leer if nivel_para_metodo(metodo) == "read" else self.escribir


def permite(requisitos: tuple[Requisito, ...], permisos: PermisosUsuario,
            parametros: Mapping[str, str]) -> bool:
    """Alcanza con uno. Sin requisitos (LIBRE), pasa."""
    if not requisitos:
        return True
    return any(r.se_cumple(permisos, parametros) for r in requisitos)


def rechazo(requisitos: tuple[Requisito, ...]) -> str:
    """El mensaje del 403. Nombra el PRIMER requisito: es la pantalla dueña de la cosa
    (los demás son las otras pantallas que también la muestran)."""
    primero = requisitos[0]
    verbo = {"read": "ver", "admin": "administrar"}.get(primero.nivel, "modificar")
    return f"No tenés permiso para {verbo} {primero.que()}."


# ─────────────────────────── EL MAPA ───────────────────────────
#
# La clave es el nombre con el que main.py pide la política de cada router.

_OPERACIONES_ESCRIBE = (seccion("operaciones_ordenes", "write"),)
_PLANIFICADOR_ESCRIBE = (seccion("operaciones_planificador", "write"),)

POLITICAS: dict[str, Politica] = {
    # ── Catálogos: leer libre, escribir pide la solapa de Recursos donde se editan ──
    "procesos": Politica(leer=LIBRE, escribir=(seccion("recursos_procesos", "write"),)),
    "operarios": Politica(leer=LIBRE, escribir=(seccion("recursos_humano", "write"),)),
    "maquinarias": Politica(leer=LIBRE, escribir=(seccion("recursos_maquinaria", "write"),)),
    # Incluye PUT /maquinarias/{id}/rangos y PUT /procesos/{id}/rangos: son cambiarle
    # las categorías a una máquina o a un proceso, que se edita en la solapa Rangos (y
    # el botón «arreglar» de los diagnósticos del plan hace lo mismo: pide lo mismo).
    "rangos": Politica(leer=LIBRE, escribir=(seccion("recursos_rangos", "write"),)),
    "sectores": Politica(leer=LIBRE, escribir=(seccion("recursos_sectores", "write"),)),
    # Sin solapa propia: van por el área.
    "prioridades": Politica(leer=LIBRE, escribir=(area("recursos", "write"),)),
    # Los artículos vienen del sistema viejo y no tienen pantalla que los edite; si
    # alguna vez la tienen, es un catálogo de Recursos. Borrarlos pide admin (ArticuloAPI).
    "articulos": Politica(leer=LIBRE, escribir=(area("recursos", "write"),)),
    # Clientes NO va libre aunque lo lea el alta de OT: la cartera tiene datos de
    # contacto y no es un desplegable cualquiera. La leen su pantalla y Operaciones (el
    # alta y la ficha de la OT), que es donde se elige el cliente.
    "clientes": Politica(leer=(area("clientes"), area("operaciones")),
                         escribir=(area("clientes", "write"),)),
    # Materia prima: el catálogo lo lee la ficha de la OT; cambiarle el stock mínimo es
    # de la solapa Materia prima de Operaciones. Borrar pide admin (PiezaAPI).
    "piezas": Politica(leer=LIBRE, escribir=(seccion("operaciones_materia_prima", "write"),)),
    # El calendario del taller (feriados): lo lee el planificador y lo edita él.
    "config": Politica(leer=LIBRE, escribir=_PLANIFICADOR_ESCRIBE),

    # ── Operaciones ──
    # Las OT y todo lo que cuelga de ellas. Editar una OT —sus pasos, su estado, su
    # entrega— es de la solapa Órdenes, se haga desde la ficha, desde el Gantt o desde
    # el detalle de la persona (que también está en Recursos: cambiar el estado de un
    # paso sigue siendo tocar una OT, y pide Operaciones).
    "ordenes": Politica(leer=(area("operaciones"),), escribir=_OPERACIONES_ESCRIBE),
    # La materia prima de cada OT y lo que se consumió (RF-15): se cargan en la ficha.
    "ordenes_trabajo_piezas": Politica(leer=(area("operaciones"),), escribir=_OPERACIONES_ESCRIBE),
    "consumos_material": Politica(leer=(area("operaciones"),), escribir=_OPERACIONES_ESCRIBE),
    # Pausar y reanudar una OT o un paso (RF-03). Es tocar la OT —lo mismo que cambiarle
    # el estado a un paso—, así que pide la solapa Órdenes. Las pausas vigentes las leen
    # las listas de Operaciones (el cartel de «Pausada»), la ficha y el planificador.
    "pausas": Politica(leer=(area("operaciones"),), escribir=_OPERACIONES_ESCRIBE),

    # ── La ficha de la persona ──
    # Su asistencia y el tiempo efectivo de sus pasos (RF-06). La ficha se abre desde
    # Recursos y desde Operaciones, así que la leen las dos (regla 1). No va libre como
    # el catálogo de personas: dice por qué faltó alguien —una enfermedad— y cuánto
    # tardó en cada trabajo. Cargar, corregir o borrar una ausencia es tocar a la
    # persona: pide la solapa Recurso humano, lo mismo que su Activo / Ausente.
    "asistencia": Politica(
        leer=(area("recursos"), area("operaciones")),
        escribir=(seccion("recursos_humano", "write"),),
    ),
    # El plan. Lo leen Operaciones (el Gantt) y Recursos (lo que tiene asignado cada
    # persona). Moverlo —planificar, borradores, confirmar, quitar órdenes, correr una
    # fecha— es del planificador.
    "planificacion": Politica(
        leer=(area("operaciones"), area("recursos")),
        escribir=_PLANIFICADOR_ESCRIBE,
        excepciones=(
            Excepcion("GET", "/planificacion/borradores", (seccion("operaciones_planificador"),),
                      "Los borradores son del planificador, no del plan: el operario "
                      "ve el plan pero no la herramienta de planificar."),
            Excepcion("GET", "/planificacion/borradores/{borrador_id}",
                      (seccion("operaciones_planificador"),), "Ídem."),
            Excepcion("GET", "/auditoria/planificacion", (seccion("auditoria_planificacion"),),
                      "Vive en este router porque lo escribe el propio planificar, pero "
                      "es la solapa Planificaciones de Auditoría."),
        ),
    ),

    # ── Planos: la biblioteca y los de cada OT ──
    # Los lee la pantalla Planos y la ficha de la OT (Operaciones). La solapa Planos de
    # Recursos es la misma biblioteca y va por el área Planos.
    "planos": Politica(
        leer=(area("planos"), area("operaciones")),
        escribir=(area("planos", "write"),),
        excepciones=(
            Excepcion("GET", "/planos/biblioteca", (area("planos"),),
                      "La biblioteca entera es la pantalla Planos (y su solapa en "
                      "Recursos); la OT sólo muestra los suyos."),
        ),
    ),

    # ── No conformidades ──
    # Las lee su pantalla, la ficha de la OT (las de esa orden) y el dashboard (las
    # métricas). Registrar una, cerrarla o editarla pide el área.
    "incidencias": Politica(
        leer=(area("no_conformidades"), area("operaciones"), area("dashboard")),
        escribir=(area("no_conformidades", "write"),),
    ),

    # ── Dashboard: sólo lectura ──
    "dashboard": Politica(
        leer=(area("dashboard"),),
        escribir=(area("dashboard", "write"),),
        excepciones=(
            Excepcion("GET", "/api/dashboard/rendimiento-operarios",
                      (seccion("dashboard_rendimiento"),),
                      "Compara a la gente con nombre y apellido: sección confidencial."),
            Excepcion("GET", "/api/dashboard/rendimiento-procesos",
                      (seccion("dashboard_rendimiento"),),
                      "Es el mismo cuadro (estimado vs. real), por proceso."),
        ),
    ),

    # ── Auditoría: sólo lectura, una sección por solapa ──
    "auditoria": Politica(
        leer=(seccion("auditoria_movimientos"),),
        escribir=(area("auditoria", "write"),),
        excepciones=(
            Excepcion("GET", "/auditoria/procesos",
                      (seccion("auditoria_procesos"), area("operaciones", con_parametro="id_orden")),
                      "La ficha de la OT muestra el historial de SUS pasos "
                      "(?id_orden=): para eso alcanza con ver Operaciones. Sin id_orden "
                      "es lo de todo el taller y pide la solapa de Auditoría."),
        ),
    ),

    # ── De todos ──
    # La campanita: cada uno la suya. Con cuenta activa alcanza para todo.
    "notificaciones": Politica(leer=LIBRE, escribir=LIBRE),
}


# Rutas que NO pasan por este mapa, y por qué. El test de cobertura exige que toda ruta
# de la app tenga su política o esté acá. Lo que termina en «/» es un prefijo (salvo
# la raíz, que es sólo la raíz).
SIN_POLITICA: dict[str, str] = {
    "/": "saludo del servidor, sin datos",
    "/health": "lo mira Cloud Run, sin sesión",
    "/internal/": "lo llama el cron con su propio token (SYNC_TOKEN)",
    "/auth/": "login y recuperación son públicos; el resto pide sesión y el ABM, admin (AuthAPI)",
    "/permisos/": "la administración de permisos: cada endpoint pide lo suyo (PermisosAPI)",
    "/docs": "documentación de FastAPI",
    "/redoc": "documentación de FastAPI",
    "/openapi.json": "documentación de FastAPI",
}


def sin_politica(path: str) -> Optional[str]:
    """Por qué `path` (plantilla de FastAPI) no pasa por el mapa, o None si tiene que
    pasar."""
    for prefijo, porque in SIN_POLITICA.items():
        if path == prefijo or (prefijo != "/" and prefijo.endswith("/") and path.startswith(prefijo)):
            return porque
    return None
