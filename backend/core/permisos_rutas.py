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
  Dashboard          /api/dashboard/*, /incidencias/metricas: desde RF-28 cada tarjeta
                     pide el área de la que muestra datos (TARJETAS_DASHBOARD)
  Operaciones        /ordenes*, /ordenes-resumen, /ordenes-pausadas, /planificacion*, /planificar,
                     /config/availability, /ordenes-trabajo-piezas, /consumos-material,
                     /planos/orden/*, /planos/{id}/archivo, /ordenes/{id}/incidencias,
                     /auditoria/procesos?id_orden= (historial de UNA OT) y los catálogos
  Planos             /planos/*, /articulos
  Recursos           los catálogos y /planificacion (el plan de cada persona). La solapa
                     Planos de Recursos va por el área Planos, igual que la pantalla.
  Recursos y         la ficha de la persona: /operarios/{id}/ausencias y
  Operaciones        /operarios/{id}/tiempos (RF-06). La ficha se monta en las dos.
                     Su solapa Rendimiento (/operarios/{id}/rendimiento, RF-07) pide
                     además la sección confidencial «Rendimiento por persona».
  Clientes           /clientes
  No conformidades   /incidencias/*
  Auditoría          /auditoria/movimientos (también la vista Ingresos, ?tipo=ingresos,
                     y /auditoria/actividad, Actividad por persona, RF-25: esas dos con
                     la sección confidencial «Ingresos y actividad por persona»),
                     /auditoria/historial/* (Historial de una OT y de una persona, RF-17),
                     /auditoria/procesos, /auditoria/planificacion
  Configuración      /auth/usuarios (sección confidencial), /auth/change-password,
                     /backups/* (la solapa Copias de seguridad: sólo admin, RF-19)
  todas              /notificaciones (leer y marcar leída; crear, lo de Recursos; borrar,
                     el admin), /auth/me

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


# ─────────────────────────── las tarjetas del dashboard (RF-28) ───────────────────────────
#
# El SRS pide (RF-28) «personalizar el dashboard inicial por tipo de usuario». El Dashboard
# es un resumen de las otras pantallas, y cada tarjeta muestra datos de UNA de ellas: el
# estado de las OT es de Operaciones, el ranking de clientes es de Clientes, las
# incidencias de planos son de No conformidades. Cada uno ve sólo las tarjetas de las
# áreas que puede leer: el Operario (sin Clientes) no ve el ranking de clientes.
#
# La pantalla (frontend/src/lib/permisos.ts, TARJETAS_DASHBOARD, espejo de esto: un test
# compara las dos) esconde la tarjeta y NO la pide. Acá se exige lo mismo, para que
# esconderla no sea sólo comodidad: cada ruta de una tarjeta pide el requisito de la
# tarjeta (las excepciones se arman solas con esta lista, más abajo).
#
# Pide SÓLO eso y no además el área Dashboard: el mapa dice «alcanza con uno», no «esto y
# aquello», y la pantalla ya pide el Dashboard para abrirse. Del lado de la API eso deja
# que alguien con el área de la tarjeta y sin el Dashboard lea el resumen de su área
# llamando a la dirección a mano: el Operario que lee todas las OT puede leer cuántas hay
# por estado. Lo único que un resumen suma a su área es el ranking de clientes (cuántas OT
# tiene cada uno de los 5 primeros), y se aceptó así.

@dataclass(frozen=True)
class TarjetaDashboard:
    codigo: str
    nombre: str
    requisito: Requisito
    # (router del mapa, plantilla de la ruta) de todo lo que la tarjeta lee, incluido lo
    # que abre al tocarla (la lista de OT de un estado, de una prioridad, de un día).
    rutas: tuple[tuple[str, str], ...]
    porque: str


TARJETAS_DASHBOARD: tuple[TarjetaDashboard, ...] = (
    TarjetaDashboard(
        "estado_ordenes", "Estado de las órdenes", area("operaciones"),
        (("dashboard", "/api/dashboard/estadisticas"),
         ("dashboard", "/api/dashboard/ordenes-por-estado/{estado}")),
        "cuántas OT hay en cada estado y cuáles son: datos de las OT.",
    ),
    TarjetaDashboard(
        "ordenes_criticas", "Órdenes críticas", area("operaciones"),
        (("dashboard", "/api/dashboard/ordenes-criticas"),),
        "las OT atrasadas o por vencer: datos de las OT.",
    ),
    TarjetaDashboard(
        "incidencias_planos", "Interpretación de planos", area("no_conformidades"),
        (("incidencias", "/incidencias/metricas"),),
        "las incidencias y el tiempo perdido: es lo de No conformidades.",
    ),
    TarjetaDashboard(
        "rendimiento", "Rendimiento estimado vs. real", seccion("dashboard_rendimiento"),
        (("dashboard", "/api/dashboard/rendimiento-operarios"),
         ("dashboard", "/api/dashboard/rendimiento-procesos")),
        "compara a la gente con nombre y apellido: sección confidencial (por proceso es "
        "el mismo cuadro).",
    ),
    TarjetaDashboard(
        "timeline_entregas", "Próximas entregas", area("operaciones"),
        (("dashboard", "/api/dashboard/timeline-entregas"),
         ("dashboard", "/api/dashboard/ordenes-por-fecha/{fecha}")),
        "las entregas de las OT por día.",
    ),
    TarjetaDashboard(
        "top_articulos", "Artículos más producidos", area("operaciones"),
        (("dashboard", "/api/dashboard/top-articulos"),),
        "unidades terminadas por artículo: sale de las OT.",
    ),
    TarjetaDashboard(
        "top_clientes", "Clientes con más órdenes", area("clientes"),
        (("dashboard", "/api/dashboard/clientes-mayor-volumen"),),
        "la cartera de clientes no es de todos (ver «clientes» en el mapa).",
    ),
    TarjetaDashboard(
        "distribucion_prioridades", "Órdenes por prioridad", area("operaciones"),
        (("dashboard", "/api/dashboard/distribucion-prioridades"),
         ("dashboard", "/api/dashboard/ordenes-por-prioridad/{prioridad}")),
        "cuántas OT hay de cada prioridad y cuáles son: datos de las OT.",
    ),
)


def _excepciones_de_tarjetas(router: str) -> tuple[Excepcion, ...]:
    return tuple(
        Excepcion("GET", ruta, (t.requisito,), f"Tarjeta «{t.nombre}» del Dashboard: {t.porque}")
        for t in TARJETAS_DASHBOARD
        for (de, ruta) in t.rutas
        if de == router
    )


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
    # el estado a un paso—, así que pide la solapa Órdenes. Las pausas vigentes
    # (/ordenes-pausadas) las leen las listas de Operaciones (el cartel de «Pausada») y
    # la vista previa del planificador; el historial de una OT (/ordenes/{id}/pausas), su
    # ficha. El planificador del backend las lee por su cuenta, sin pasar por la ruta.
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
    # Su reporte de rendimiento (RF-07): tareas completadas, tiempo promedio y
    # EFICIENCIA, exportable. Sólo se lee. Pide la sección confidencial «Rendimiento por
    # persona», la misma del cuadro estimado vs. real del Dashboard y por lo mismo: pone
    # un número de eficiencia al lado de un nombre, y eso lo abre Lucas a quien decida
    # (hoy, sólo el admin). Abrírsela a alguien le abre las dos cosas juntas. No alcanza
    # con Recursos u Operaciones como los tiempos de RF-06: esos son el dato de cada paso;
    # esto es la evaluación de la persona. La ficha, sin la sección, no muestra la
    # solapa (y no pide nada: un 403 al abrir cada ficha sería un aviso de más).
    "rendimiento_operario": Politica(
        leer=(seccion("dashboard_rendimiento"),),
        escribir=(seccion("dashboard_rendimiento", "write"),),
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
    # Las lee su pantalla y la ficha de la OT (las de esa orden). Registrar una, cerrarla
    # o editarla pide el área. Las métricas son la tarjeta «Interpretación de planos» del
    # Dashboard y piden lo de la tarjeta (RF-28, TARJETAS_DASHBOARD): No conformidades.
    # Hasta el 22/09 el área Dashboard leía TODO este router por esas métricas.
    "incidencias": Politica(
        leer=(area("no_conformidades"), area("operaciones")),
        escribir=(area("no_conformidades", "write"),),
        excepciones=_excepciones_de_tarjetas("incidencias"),
    ),

    # ── Dashboard: sólo lectura ──
    # Cada ruta es de una tarjeta y pide el área de esa tarjeta (RF-28, ver
    # TARJETAS_DASHBOARD arriba). El área Dashboard queda para lo que no sea de ninguna.
    "dashboard": Politica(
        leer=(area("dashboard"),),
        escribir=(area("dashboard", "write"),),
        excepciones=_excepciones_de_tarjetas("dashboard") + (
            Excepcion("GET", "/api/dashboard/tiempo-promedio", (area("operaciones"),),
                      "Hoy no la muestra ninguna tarjeta; son tiempos de las OT "
                      "terminadas, como las tarjetas de Operaciones."),
        ),
    ),

    # ── Auditoría: sólo lectura, una sección por solapa ──
    # «Todo lo que se hizo» (auditoria_movimientos) NO es confidencial: hereda el nivel
    # del área, así que quien tiene Auditoría la ve. Si Auditoría entera tiene que ser
    # sólo del admin salvo que se abra a propósito, se marca confidencial desde la
    # pantalla de permisos (lo decide Lucas; hoy nadie que no sea admin tiene el área).
    #
    # Ingresos y Actividad por persona (RF-25) SÍ son confidenciales, con su propia
    # sección «Ingresos y actividad por persona» (auditoria_ingresos). Revisión del 23/09:
    # iban con «Todo lo que se hizo», y abrirle Auditoría a un rol para que vea los pasos
    # le abría también las IP, los navegadores y los intentos fallidos contra cada cuenta.
    # Como leen la misma tabla, /auditoria/movimientos acepta cualquiera de las dos y el
    # endpoint separa (AuditoriaAPI.movimientos): ?tipo=ingresos pide la confidencial; sin
    # tipo pide «Todo lo que se hizo», y a quien no tiene la confidencial no le manda las
    # filas de entrar, salir y claves (ni en la lista, ni en /movimientos/de/...).
    # La lista de cuentas (usuario, si tiene acceso, último login) es de «Usuarios y
    # permisos», confidencial y del admin: sin esa sección no se manda en ningún lado de
    # Auditoría, sólo el nombre con que cada uno firmó en el registro.
    #
    # El historial de una OT y de una persona (RF-17, /auditoria/historial/*) va con
    # «Todo lo que se hizo»: es el mismo registro buscado por entidad y número. Lo que ahí
    # tiene sección o política propia —los pasos («Pasos de las OT»), el plan
    # («Planificaciones»), lo estimado contra lo que llevó cada paso («Rendimiento por
    # persona», confidencial) y las AUSENCIAS (política 'asistencia': Recursos u
    # Operaciones)— lo mira el endpoint con los permisos de quien pide, y sin eso no lo lee
    # ni lo manda (AuditoriaAPI._secciones). Julián lo pidió acá y no en la ficha de la OT
    # ni en la de la persona: no se abre por Operaciones ni por Recursos.
    "auditoria": Politica(
        leer=(seccion("auditoria_movimientos"),),
        escribir=(area("auditoria", "write"),),
        excepciones=(
            Excepcion("GET", "/auditoria/movimientos",
                      (seccion("auditoria_movimientos"), seccion("auditoria_ingresos")),
                      "Es la lista de «Todo lo que se hizo» y la de Ingresos (?tipo=ingresos): "
                      "alcanza con una de las dos y el endpoint manda sólo lo de la que se tiene."),
            Excepcion("GET", "/auditoria/actividad", (seccion("auditoria_ingresos"),),
                      "Actividad por persona: cuántas veces entró cada cuenta y sus intentos "
                      "fallidos. Sección confidencial (revisión del 23/09)."),
            Excepcion("GET", "/auditoria/procesos",
                      (seccion("auditoria_procesos"), area("operaciones", con_parametro="id_orden")),
                      "La ficha de la OT muestra el historial de SUS pasos "
                      "(?id_orden=): para eso alcanza con ver Operaciones. Sin id_orden "
                      "es lo de todo el taller y pide la solapa de Auditoría."),
        ),
    ),

    # ── La campanita ──
    # Es UNA para todo el taller: no hay avisos «de» alguien, y leída es leída para
    # todos. Leerla y marcarla como leída, cualquiera con cuenta activa. Lo demás no
    # (revisión del 23/09: hasta ahí un operario sin ningún permiso vaciaba la campanita
    # de todos y firmaba avisos a nombre de un admin).
    # Además NotificacionAPI esconde los avisos de «Usuarios y permisos» a quien no ve
    # esa sección (es confidencial), y la firma de un aviso sale de la sesión.
    "notificaciones": Politica(
        leer=LIBRE,
        escribir=LIBRE,
        excepciones=(
            Excepcion("POST", "/notificaciones", (seccion("recursos_humano", "write"),),
                      "Los únicos avisos que arma la pantalla son los de Recursos › Recurso "
                      "humano (alta, cambio y baja de una persona), después de guardarla: "
                      "pide lo mismo que guardarla. El resto los escribe el sistema."),
            Excepcion("DELETE", "/notificaciones", (area("configuracion", "admin"),),
                      "Vacía la campanita de TODO el taller, no la de quien lo pide: "
                      "sólo el admin."),
            Excepcion("DELETE", "/notificaciones/{id}", (area("configuracion", "admin"),),
                      "Un aviso borrado desaparece para todos: sólo el admin."),
        ),
    ),

    # ── Copias de seguridad (RF-19): sólo el admin del área de sistema ──
    # Bajar una copia es llevarse TODOS los datos (clientes, usuarios con sus hashes) y
    # restaurar es pisarlos: las dos cosas, y también mirar la solapa, piden nivel admin
    # en Configuración, que es sólo del rol admin (ver «EL ÁREA DE SISTEMA» arriba).
    "backups": Politica(
        leer=(area("configuracion", "admin"),),
        escribir=(area("configuracion", "admin"),),
    ),
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
