"""
El catálogo del armador de reportes personalizados (RF-23). ES CERRADO: lo único que se
puede pedir es lo que está escrito acá.

QUÉ ES

El SRS pide (RF-23) «reportes personalizados por el usuario, según filtros y criterios
configurables». Julián lo pidió en el Dashboard: un botón para armar un reporte a medida
—elegir de qué, qué columnas, qué filtros, cómo agruparlo— y bajarlo en PDF, Excel o CSV.

La persona arma el reporte con piezas de este catálogo y nada más:

  · una FUENTE (órdenes, pasos de las OT, personas, máquinas, consumos, materia prima, no
    conformidades, pausas, ausencias, auditoría), cada una con su permiso;
  · COLUMNAS de esa fuente, cada una con su tipo, si se puede filtrar, agrupar y sumar, y
    —algunas— un permiso propio además del de la fuente;
  · el PERÍODO, sobre una de las fechas que la fuente dice.

Del lado del navegador viaja sólo un JSON con CÓDIGOS (`"fuente": "ordenes"`,
`"columnas": ["cliente", "estado"]`). El servidor busca cada código acá y arma la consulta
con las expresiones de SQLAlchemy que están escritas en este archivo. Ningún nombre de
tabla ni de columna, ni una coma de SQL, sale de lo que manda la persona: un código que
no está en el catálogo es un error (422), no una columna nueva. Los valores de los filtros
viajan siempre como parámetros (SQLAlchemy los liga, nunca se pegan al texto).

LOS PERMISOS, POR FUENTE

Cada fuente pide LO MISMO que la pantalla que muestra esos datos: se toma la política del
router (core/permisos_rutas.py, POLITICAS) y no una copia, para que no se puedan separar.
Las órdenes y sus pasos, lo que pide leer las OT; las ausencias, la política «asistencia»
(Recursos u Operaciones); la auditoría, la solapa «Todo lo que se hizo»; etc. La
EFICIENCIA de cada persona es de la sección confidencial «Rendimiento por persona», igual
que el cuadro del Dashboard y el reporte de la ficha (RF-07): va como permiso de COLUMNA.

Quien no puede leer una fuente (o una columna) no la ve en el catálogo y el servidor la
rechaza si igual la pide —también cuando viene en un reporte que compartió un admin—.

AGREGAR UNA FUENTE O UNA COLUMNA

Se agrega acá y nada más: la pantalla dibuja lo que el catálogo dice. Las horas de uso de
cada máquina (RF-10) van como columnas nuevas de la fuente «maquinas» cuando exista de
dónde leerlas (ver la nota en esa fuente).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    Integer,
    String,
    and_,
    bindparam,
    case,
    func,
    literal,
    or_,
    select,
    text,
    type_coerce,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.sql.functions import FunctionElement

from backend.application.IncidenciaProcesoService import (
    DISPOSICIONES,
    ESTADOS as ESTADOS_NC,
    GRAVEDADES,
    TIPOS as TIPOS_NC,
)
from backend.application.MaquinariaService import ESTADOS_OPERATIVOS
from backend.core.permisos import PermisosUsuario
from backend.core.permisos_rutas import POLITICAS, Requisito, permite
from backend.domain.Articulo import Articulo
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.AusenciaOperario import AusenciaOperario, MOTIVO_TEXTO as MOTIVOS_AUSENCIA
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import CIERRE_TEXTO, MOTIVO_TEXTO as MOTIVOS_PAUSA, PausaOrden
from backend.domain.Pieza import Pieza
from backend.domain.Planificacion import Planificacion
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.domain.UsoMaquina import NO_SUMA_FUERA_DE_SERVICIO, NO_SUMA_VUELTA_A_PENDIENTE, UsoMaquina
from backend.infrastructure.estado_ordenes import ESTADO_SQL, SIN_FECHA_NUEVA, SIN_FECHA_VIEJA

# La sección confidencial «Rendimiento por persona» (dashboard_rendimiento): la eficiencia,
# las horas de cada persona y cualquier suma de horas agrupada por persona.
REQUISITOS_RENDIMIENTO: tuple[Requisito, ...] = POLITICAS["rendimiento_operario"].leer

# ─────────────────────────── vocabulario ───────────────────────────

# Cómo se lee cada valor. Es el mismo vocabulario de lib/exportar.ts (TipoColumna), más
# «mes» (AAAA-MM, para agrupar por mes) que el navegador escribe como 09/2026.
TIPOS = ("texto", "entero", "numero", "id", "porcentaje", "fecha", "fechaHora", "booleano", "mes")
NUMERICOS = ("entero", "numero", "id", "porcentaje")
FECHAS = ("fecha", "fechaHora")

# Qué filtro ofrece cada columna.
#   opciones  se eligen valores de una lista (clientes, estados...): op «en».
#   texto     «contiene»: op «contiene».
#   numero    un rango: op «entre».
#   fecha     un rango de días: op «entre».
#   booleano  sí / no: op «es».
FILTRO_DE_TIPO = {
    "texto": "texto",
    "entero": "numero",
    "numero": "numero",
    "id": "numero",
    "porcentaje": "numero",
    "fecha": "fecha",
    "fechaHora": "fecha",
    "booleano": "booleano",
    "mes": None,
}
OPERACION_DE_FILTRO = {
    "opciones": "en",
    "texto": "contiene",
    "numero": "entre",
    "fecha": "entre",
    "booleano": "es",
}

# Las cuentas de una agrupación. «conteo» no lleva columna.
FUNCIONES = ("conteo", "suma", "promedio", "minimo", "maximo")
NOMBRE_FUNCION = {
    "conteo": "Cantidad",
    "suma": "Suma",
    "promedio": "Promedio",
    "minimo": "Mínimo",
    "maximo": "Máximo",
}

# Los atajos del período. Se resuelven EN EL SERVIDOR con el día del taller: un reporte
# guardado como «este mes» es este mes el día que se abre, no el mes en que se guardó.
ATAJOS = {
    "este_mes": "Este mes",
    "mes_pasado": "El mes pasado",
    "ultimos_30": "Últimos 30 días",
    "ultimos_90": "Últimos 90 días",
    "este_anio": "Este año",
}


def rango_del_atajo(atajo: str, hoy: date) -> tuple[date, date]:
    """(desde, hasta) de un atajo, los dos días INCLUIDOS. Espejo de rangoDelAtajo en
    frontend/src/lib/reportesPeriodo.ts (test_los_atajos_del_periodo_dan_lo_mismo_en_la_
    pantalla_y_en_el_servidor lo compila y compara las dos)."""
    if atajo == "este_mes":
        desde = hoy.replace(day=1)
        return desde, _ultimo_dia_del_mes(desde)
    if atajo == "mes_pasado":
        fin = hoy.replace(day=1) - timedelta(days=1)
        return fin.replace(day=1), fin
    if atajo == "ultimos_30":
        return hoy - timedelta(days=29), hoy
    if atajo == "ultimos_90":
        return hoy - timedelta(days=89), hoy
    if atajo == "este_anio":
        return date(hoy.year, 1, 1), date(hoy.year, 12, 31)
    raise ValueError(f"atajo desconocido: {atajo}")


def _ultimo_dia_del_mes(d: date) -> date:
    siguiente = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return siguiente - timedelta(days=1)


# ─────────────────────────── el contexto de una consulta ───────────────────────────


@dataclass
class Contexto:
    """Lo que las expresiones necesitan saber del pedido: el reloj del taller y el
    período (las fuentes que lo aplican ADENTRO de sus cuentas, como «personas»).

    `memo` guarda las expresiones que se usan más de una vez en la misma consulta (el
    estado de la OT va en la columna Y en el filtro): así es el MISMO objeto, con los
    mismos parámetros, y no dos copias."""

    ahora: datetime
    desde: Optional[date] = None
    hasta: Optional[date] = None
    _memo: dict = field(default_factory=dict)

    @property
    def hoy(self) -> datetime:
        return self.ahora.replace(hour=0, minute=0, second=0, microsecond=0)

    def memo(self, clave: str, fabrica: Callable[[], Any]):
        if clave not in self._memo:
            self._memo[clave] = fabrica()
        return self._memo[clave]


# ─────────────────────────── piezas de SQL que dependen de la base ───────────────────────────
#
# Producción es Postgres y los tests corren también sobre SQLite: las pocas cuentas que
# cada una escribe distinto van acá, compiladas para cada dialecto. Reciben expresiones
# (columnas del catálogo o parámetros), nunca texto de afuera.


class horas_entre(FunctionElement):
    """Horas, con decimales, de `a` a `b` (dos fecha y hora)."""

    type = Float()
    name = "horas_entre"
    inherit_cache = True


@compiles(horas_entre)
def _horas_entre_pg(elemento, compilador, **kw):
    a, b = list(elemento.clauses)
    return (f"(EXTRACT(EPOCH FROM ({compilador.process(b, **kw)} - "
            f"{compilador.process(a, **kw)})) / 3600.0)")


@compiles(horas_entre, "sqlite")
def _horas_entre_sqlite(elemento, compilador, **kw):
    a, b = list(elemento.clauses)
    return (f"((julianday({compilador.process(b, **kw)}) - "
            f"julianday({compilador.process(a, **kw)})) * 24.0)")


class dias_entre(FunctionElement):
    """Días enteros de `a` a `b` (dos fechas sin hora)."""

    type = Integer()
    name = "dias_entre"
    inherit_cache = True


@compiles(dias_entre)
def _dias_entre_pg(elemento, compilador, **kw):
    a, b = list(elemento.clauses)
    return f"({compilador.process(b, **kw)} - {compilador.process(a, **kw)})"


@compiles(dias_entre, "sqlite")
def _dias_entre_sqlite(elemento, compilador, **kw):
    a, b = list(elemento.clauses)
    return (f"CAST(julianday({compilador.process(b, **kw)}) - "
            f"julianday({compilador.process(a, **kw)}) AS INTEGER)")


class mayor_de(FunctionElement):
    """El mayor de dos valores (GREATEST de Postgres; en SQLite, max con dos argumentos)."""

    name = "mayor_de"
    inherit_cache = True


@compiles(mayor_de)
def _mayor_pg(elemento, compilador, **kw):
    return f"GREATEST({compilador.process(elemento.clauses, **kw)})"


@compiles(mayor_de, "sqlite")
def _mayor_sqlite(elemento, compilador, **kw):
    return f"max({compilador.process(elemento.clauses, **kw)})"


class menor_de(FunctionElement):
    name = "menor_de"
    inherit_cache = True


@compiles(menor_de)
def _menor_pg(elemento, compilador, **kw):
    return f"LEAST({compilador.process(elemento.clauses, **kw)})"


@compiles(menor_de, "sqlite")
def _menor_sqlite(elemento, compilador, **kw):
    return f"min({compilador.process(elemento.clauses, **kw)})"


class mes_de(FunctionElement):
    """«2026-09» de una fecha: para agrupar por mes."""

    type = String()
    name = "mes_de"
    inherit_cache = True


@compiles(mes_de)
def _mes_pg(elemento, compilador, **kw):
    return f"to_char({compilador.process(elemento.clauses, **kw)}, 'YYYY-MM')"


@compiles(mes_de, "sqlite")
def _mes_sqlite(elemento, compilador, **kw):
    return f"strftime('%Y-%m', {compilador.process(elemento.clauses, **kw)})"


class dia_de(FunctionElement):
    """El día (sin hora) de una fecha y hora: para agrupar por día."""

    type = Date()
    name = "dia_de"
    inherit_cache = True


@compiles(dia_de)
def _dia_pg(elemento, compilador, **kw):
    return f"CAST({compilador.process(elemento.clauses, **kw)} AS DATE)"


@compiles(dia_de, "sqlite")
def _dia_sqlite(elemento, compilador, **kw):
    return f"date({compilador.process(elemento.clauses, **kw)})"


def _fecha(valor: datetime) -> ColumnElement:
    """Un parámetro de fecha y hora con TIPO: así SQLite compara como Postgres (ver
    infrastructure/estado_ordenes.py, «LAS FECHAS»)."""
    return literal(valor, DateTime())


def fecha_limpia(columna) -> ColumnElement:
    """La fecha, o NULL si es un centinela del sistema viejo (1950-01-01 o 3000-01-01):
    «sin fecha» sale vacío, nunca como 01/01/1950, y no cuenta en un mínimo o un máximo."""
    return case(
        (and_(columna > _fecha(SIN_FECHA_VIEJA), columna < _fecha(SIN_FECHA_NUEVA)), columna),
        else_=None,
    )


def fecha_real(columna) -> ColumnElement:
    """SQL: la columna tiene una fecha de verdad (ni vacía ni un centinela)."""
    return and_(columna.isnot(None), columna > _fecha(SIN_FECHA_VIEJA),
                columna < _fecha(SIN_FECHA_NUEVA))


def horas_reales(inicio, fin) -> ColumnElement:
    """Horas de arranque a fin, CORRIDAS (como el cuadro «estimado vs. real» del
    Dashboard). NULL si falta alguna de las dos, si alguna es un centinela o si el fin es
    anterior al arranque: un dato así no se puede medir y no suma cero."""
    return case(
        (and_(fecha_real(inicio), fecha_real(fin), fin >= inicio), horas_entre(inicio, fin)),
        else_=None,
    )


def si_no(condicion) -> ColumnElement:
    """Un sí/no que nunca es NULL."""
    return type_coerce(case((condicion, True), else_=False), Boolean())


# ─────────────────────────── columnas y fuentes ───────────────────────────


def _como_funcion(expr) -> Callable[[Contexto], ColumnElement]:
    if callable(expr) and not isinstance(expr, ColumnElement):
        return expr
    return lambda ctx, _e=expr: _e


@dataclass(frozen=True)
class Columna:
    codigo: str
    nombre: str
    tipo: str
    expr: Callable[[Contexto], ColumnElement]
    ayuda: str = ""
    # Contra qué se compara un filtro, si no es lo que se muestra: el cliente se muestra
    # por su nombre y se filtra por su id (dos clientes pueden llamarse igual).
    filtro_expr: Optional[Callable[[Contexto], ColumnElement]] = None
    # De dónde salen los valores para elegir (ver OPCIONES).
    opciones: Optional[str] = None
    filtrable: bool = True
    agrupable: bool = False
    # Se le puede pedir suma / promedio / mínimo / máximo (a una fecha, sólo mín. y máx.).
    medible: bool = False
    # Su suma dice algo (unidades, horas, cantidad): va en la fila de totales.
    totaliza: bool = False
    decimales: Optional[int] = None
    # Código guardado -> cómo se lee («en_curso» -> «En curso»).
    etiquetas: Optional[dict] = None
    por_defecto: bool = False
    # Un permiso ADEMÁS del de la fuente (alcanza con uno de la lista).
    requisitos: tuple[Requisito, ...] = ()
    # El tipo SQL de la columna cuando es fecha: una DATE se compara con días, no con horas.
    sql_fecha: str = "datetime"
    # Sumada o promediada POR PERSONA es el rendimiento de cada una (las horas estimadas
    # y reales de sus pasos): ver `Fuente.por_persona` y REQUISITOS_RENDIMIENTO.
    rendimiento: bool = False

    def __post_init__(self):
        assert self.tipo in TIPOS, (self.codigo, self.tipo)
        assert re.fullmatch(r"[a-z][a-z0-9_]{0,39}", self.codigo), self.codigo

    @property
    def filtro(self) -> Optional[str]:
        """El tipo de filtro que ofrece (ver FILTRO_DE_TIPO), o None si no se filtra."""
        if not self.filtrable:
            return None
        if self.opciones:
            return "opciones"
        return FILTRO_DE_TIPO.get(self.tipo)

    def funciones(self) -> tuple[str, ...]:
        """Las cuentas que se le pueden pedir en una agrupación (además del conteo)."""
        if not self.medible:
            return ()
        if self.tipo in FECHAS:
            return ("minimo", "maximo")
        if self.tipo in NUMERICOS:
            return ("suma", "promedio", "minimo", "maximo")
        return ()


def C(codigo: str, nombre: str, tipo: str, expr, *, filtro_expr=None, agrupable=None,
      medible=None, **kw) -> Columna:
    """Atajo para escribir el catálogo. Por defecto se agrupa por texto, sí/no, fecha y
    mes, y se miden los números y las fechas."""
    if agrupable is None:
        agrupable = tipo in ("texto", "booleano", "fecha", "mes")
    if medible is None:
        medible = tipo in ("entero", "numero", "porcentaje") or tipo in FECHAS
    return Columna(
        codigo=codigo, nombre=nombre, tipo=tipo, expr=_como_funcion(expr),
        filtro_expr=_como_funcion(filtro_expr) if filtro_expr is not None else None,
        agrupable=agrupable, medible=medible, **kw,
    )


@dataclass(frozen=True)
class Fuente:
    codigo: str
    nombre: str
    descripcion: str
    icono: str  # un nombre de lucide-react; la pantalla lo traduce
    # Alcanza con uno. Vacío = cualquiera que pueda abrir el armador (un catálogo libre).
    requisitos: tuple[Requisito, ...]
    # Por qué pide eso: sale en el mensaje del 403 y en los comentarios.
    permiso: str
    origen: Callable[[Contexto], Any]  # el FROM, con sus JOIN
    columnas: tuple[Columna, ...]
    # La clave de cada fila: desempata el orden para que dos corridas den lo mismo.
    clave: Callable[[Contexto], ColumnElement]
    # Las fechas por las que se puede acotar el período (códigos de columnas). La primera
    # es la de siempre. Vacío = la fuente no tiene período.
    periodo: tuple[str, ...] = ()
    # El período no filtra filas: se usa ADENTRO de las cuentas (las horas de cada
    # persona en el período). Se ofrece igual, con este texto.
    periodo_interno: Optional[str] = None
    # Condiciones que la fuente pone siempre, según quién pide (la auditoría esconde los
    # ingresos a quien no tiene su sección). Devuelve una lista de condiciones.
    condiciones: Optional[Callable[[Contexto, PermisosUsuario], list]] = None
    # Lo que arranca puesto al elegir la fuente (el navegador lo copia).
    filtros_iniciales: tuple[dict, ...] = ()
    orden_inicial: Optional[tuple[str, str]] = None
    nota: str = ""
    # Las columnas que nombran a UNA persona. Agrupar por una de ellas y medir una columna
    # con `rendimiento` arma el ranking de la sección confidencial «Rendimiento por
    # persona»: sin la sección, el armador lo rechaza (ver ReportesService.validar).
    por_persona: tuple[str, ...] = ()
    # Agrupar por una columna de `por_persona` (con CUALQUIER cuenta, también la cantidad)
    # o filtrar por ella pide la sección: es lo que hace RF-12 con las no conformidades
    # por persona. Sin esto, sólo lo pide medir una columna con `rendimiento`.
    persona_confidencial: bool = False

    def __post_init__(self):
        codigos = [c.codigo for c in self.columnas]
        assert len(codigos) == len(set(codigos)), f"{self.codigo}: columna repetida"
        for p in self.por_persona:
            assert p in codigos, (self.codigo, p)
        for p in self.periodo:
            assert p in codigos and self.columna(p).tipo in FECHAS, (self.codigo, p)
        assert not (self.periodo and self.periodo_interno), self.codigo

    def columna(self, codigo: str) -> Optional[Columna]:
        return next((c for c in self.columnas if c.codigo == codigo), None)


# ─────────────────────────── las tablas, con su alias ───────────────────────────
#
# Un alias por uso. `ot` se llama así a propósito: ESTADO_SQL (estado_ordenes.py), que
# es la regla del estado de la OT en todo el Dashboard, lo nombra así.

ot = OrdenTrabajo.__table__.alias("ot")
cl = Cliente.__table__.alias("cl")
pr = Prioridad.__table__.alias("pr")
se = Sector.__table__.alias("se")
ar = Articulo.__table__.alias("ar")
otp = OrdenTrabajoProceso.__table__.alias("otp")
pc = Proceso.__table__.alias("pc")
op = Operario.__table__.alias("op")
mq = Maquinaria.__table__.alias("mq")
cm = ConsumoMaterial.__table__.alias("cm")
pz = Pieza.__table__.alias("pz")
ic = IncidenciaProceso.__table__.alias("ic")
pa = PausaOrden.__table__.alias("pa")
au = AusenciaOperario.__table__.alias("au")
um = UsoMaquina.__table__.alias("um")
otp_ic = OrdenTrabajoProceso.__table__.alias("otp_ic")
# La auditoría va SIN alias: las condiciones de lo que cada uno puede ver son las de la
# pantalla de Auditoría (AuditoriaAPI) y nombran la tabla.
am = AuditoriaMovimiento.__table__


def _ultimo_plan():
    """Por cada paso de OT, la persona y la máquina que le dio el ÚLTIMO plan que lo
    incluyó (el plan se acumula por lotes: si se replanificó, manda el más nuevo).

    Las filas de plan viejas no dicen de qué paso son (id_orden_trabajo_proceso NULL): se
    ubican por OT y proceso, como hace la ficha de la persona (TiemposOperarioService)."""
    pl = Planificacion.__table__.alias("pl_u")
    x = OrdenTrabajoProceso.__table__.alias("otp_u")
    id_paso = func.coalesce(pl.c.id_orden_trabajo_proceso, x.c.id)
    numero = func.row_number().over(partition_by=id_paso,
                                    order_by=(pl.c.creado_en.desc(), pl.c.id.desc()))
    por_paso = (
        select(id_paso.label("id_otp"), pl.c.id_operario, pl.c.id_maquinaria, numero.label("n"))
        .select_from(pl.outerjoin(x, and_(pl.c.id_orden_trabajo_proceso.is_(None),
                                          x.c.id_orden_trabajo == pl.c.orden_id,
                                          x.c.id_proceso == pl.c.proceso_id)))
        .where(or_(pl.c.id_operario.isnot(None), pl.c.id_maquinaria.isnot(None)))
        .subquery("pl_n")
    )
    return (select(por_paso.c.id_otp, por_paso.c.id_operario, por_paso.c.id_maquinaria)
            .where(por_paso.c.n == 1).subquery("ultimo_plan"))


UP = _ultimo_plan()
# Quién hizo el paso: la persona ELEGIDA A MANO en la OT, y si no hay, la del último plan
# (la misma atribución que la ficha de la persona, RF-06, sin el caso de los equipos de
# varias personas: acá cuenta una).
PERSONA_DEL_PASO = func.coalesce(otp.c.id_operario, UP.c.id_operario)
MAQUINA_DEL_PASO = func.coalesce(otp.c.id_maquinaria, UP.c.id_maquinaria)


def _estado_ot(ctx: Contexto) -> ColumnElement:
    """El estado de la OT con LA regla del Dashboard (ESTADO_SQL), no una copia: si
    cambia allá, cambia acá. Un solo objeto por consulta (ver Contexto.memo)."""
    def armar():
        presentes = [n for n in ("hoy", "sin_fecha_vieja", "sin_fecha_nueva")
                     if re.search(rf":{n}\b", ESTADO_SQL)]
        valores = {"hoy": ctx.hoy, "sin_fecha_vieja": SIN_FECHA_VIEJA,
                   "sin_fecha_nueva": SIN_FECHA_NUEVA}
        return type_coerce(
            text(f"({ESTADO_SQL})").bindparams(
                *(bindparam(n, valores[n], type_=DateTime()) for n in presentes)),
            String(),
        )
    return ctx.memo("estado_ot", armar)


def _nombre_persona(tabla) -> ColumnElement:
    return func.trim(tabla.c.nombre + " " + tabla.c.apellido)


def _numero_ot(tabla) -> Columna:
    return C("numero", "N° de OT", "id", tabla.c.id_otvieja, agrupable=True, por_defecto=True,
             ayuda="El número con que el taller conoce la orden.")


def _cliente(por_defecto: bool = False) -> Columna:
    return C("cliente", "Cliente", "texto", cl.c.nombre, filtro_expr=ot.c.id_cliente,
             opciones="clientes", por_defecto=por_defecto)


def _articulo() -> Columna:
    return C("articulo", "Artículo", "texto", ar.c.descripcion)


ESTADOS_OT = {
    "pendientes": "Pendiente",
    "en_curso": "En curso",
    "retrasadas": "Retrasada",
    "completadas": "Completada",
}
ESTADOS_PASO = {1: "Pendiente", 2: "En proceso", 3: "Terminado"}


# ── 1. Órdenes de trabajo ──

def _pasos_de_la_ot(solo_terminados: bool):
    x = OrdenTrabajoProceso.__table__.alias("otp_c")
    q = select(func.count()).select_from(x).where(x.c.id_orden_trabajo == ot.c.id)
    if solo_terminados:
        q = q.where(x.c.id_estado == 3)
    return q.scalar_subquery()


ORDENES = Fuente(
    codigo="ordenes",
    nombre="Órdenes de trabajo",
    descripcion="Cada OT con su cliente, artículo, prioridad, estado, unidades y fechas.",
    icono="clipboard-list",
    requisitos=POLITICAS["ordenes"].leer,
    permiso="Pide poder ver las órdenes de trabajo (Operaciones).",
    origen=lambda ctx: (
        ot.outerjoin(cl, cl.c.id == ot.c.id_cliente)
        .outerjoin(pr, pr.c.id == ot.c.id_prioridad)
        .outerjoin(se, se.c.id == ot.c.id_sector)
        .outerjoin(ar, ar.c.id == ot.c.id_articulo)
    ),
    clave=lambda ctx: ot.c.id,
    columnas=(
        _numero_ot(ot),
        _cliente(por_defecto=True),
        C("articulo", "Artículo", "texto", ar.c.descripcion, por_defecto=True),
        C("cod_articulo", "Código de artículo", "texto", ar.c.cod_articulo),
        C("prioridad", "Prioridad", "texto", pr.c.descripcion, filtro_expr=ot.c.id_prioridad,
          opciones="prioridades", por_defecto=True),
        C("sector", "Sector", "texto", se.c.nombre, filtro_expr=ot.c.id_sector, opciones="sectores"),
        C("estado", "Estado", "texto", _estado_ot, opciones="estados_ot", etiquetas=ESTADOS_OT,
          por_defecto=True,
          ayuda="El mismo estado de las tarjetas del Dashboard: completada, en curso (algún "
                "paso arrancado), retrasada (vencida sin arrancar) o pendiente."),
        C("unidades", "Unidades", "entero", ot.c.unidades, totaliza=True, por_defecto=True),
        C("entregadas", "Unidades entregadas", "entero", ot.c.cantidad_entregada, totaliza=True),
        C("pasos", "Pasos", "entero", _pasos_de_la_ot(False), totaliza=True),
        C("pasos_terminados", "Pasos terminados", "entero", _pasos_de_la_ot(True), totaliza=True),
        C("fecha_entrada", "Fecha de entrada", "fecha", fecha_limpia(ot.c.fecha_entrada),
          filtro_expr=ot.c.fecha_entrada),
        C("fecha_prometida", "Fecha prometida", "fecha", fecha_limpia(ot.c.fecha_prometida),
          filtro_expr=ot.c.fecha_prometida, por_defecto=True),
        C("fecha_entrega", "Fecha de entrega", "fecha", fecha_limpia(ot.c.fecha_entrega),
          filtro_expr=ot.c.fecha_entrega, por_defecto=True),
        C("mes_entrada", "Mes de entrada", "mes", mes_de(fecha_limpia(ot.c.fecha_entrada))),
        C("mes_prometida", "Mes prometido", "mes", mes_de(fecha_limpia(ot.c.fecha_prometida))),
        C("mes_entrega", "Mes de entrega", "mes", mes_de(fecha_limpia(ot.c.fecha_entrega))),
        C("reclamo", "Con reclamo", "booleano", si_no(func.coalesce(ot.c.reclamo, 0) == 1)),
        # RF-11: las ocho casillas de «Estado y control» de la ficha, en su orden, como
        # sí/no (se filtran y se agrupan). Las leen los mismos que leen la OT: son parte
        # de su ficha, sin permiso aparte (como en la pantalla).
        *(C(codigo, nombre, "booleano", si_no(func.coalesce(columna, 0) == 1),
            ayuda="La casilla de «Estado y control» de la ficha de la OT.")
          for codigo, nombre, columna in (
              ("programada", "Programada", ot.c.programada),
              ("en_proceso", "En proceso (casilla)", ot.c.en_proceso),
              ("finalizado_total", "Finalizado total", ot.c.finalizadototal),
              ("finalizado_parcial", "Finalizado parcial", ot.c.finalizadoparcial),
              ("controlado", "Controlado", ot.c.controlado),
              ("finalizado_para_pintar", "Finalizado para pintar", ot.c.finalizado_para_pintar),
              ("terc_final", "Finalizado tercerización final", ot.c.finalizado_tercerizacion_final),
              ("terc_intermedia", "Finalizado tercerización intermedia",
               ot.c.finalizado_tercerizacion_intermedia),
          )),
        C("cantidad_parcial", "Cant. finalizada parcial", "entero", ot.c.cantidad_finalizada_parcial,
          totaliza=True, ayuda="El «Cant.» al lado de Finalizado parcial: unidades terminadas. "
                               "No es lo entregado. Vacío: no se cargó."),
        C("controlado_por", "Controlada por", "texto", ot.c.controlado_por,
          ayuda="Quién marcó Controlado desde SPMM. Vacío: no se registró."),
        C("controlado_en", "Controlada el", "fechaHora", ot.c.controlado_en),
        C("observaciones", "Observaciones", "texto", ot.c.observaciones, agrupable=False),
    ),
    periodo=("fecha_entrada", "fecha_prometida", "fecha_entrega", "controlado_en"),
    orden_inicial=("numero", "desc"),
)


# ── 2. Pasos de las OT ──

PASOS = Fuente(
    codigo="pasos",
    nombre="Pasos de las OT",
    descripcion="Cada paso de cada OT: proceso, persona, máquina, estado y tiempos estimado y real.",
    icono="list-checks",
    requisitos=POLITICAS["ordenes"].leer,
    permiso="Pide poder ver las órdenes de trabajo (Operaciones).",
    origen=lambda ctx: (
        otp.join(ot, ot.c.id == otp.c.id_orden_trabajo)
        .outerjoin(pc, pc.c.id == otp.c.id_proceso)
        .outerjoin(UP, UP.c.id_otp == otp.c.id)
        .outerjoin(op, op.c.id == PERSONA_DEL_PASO)
        .outerjoin(mq, mq.c.id == MAQUINA_DEL_PASO)
        .outerjoin(cl, cl.c.id == ot.c.id_cliente)
        .outerjoin(ar, ar.c.id == ot.c.id_articulo)
    ),
    clave=lambda ctx: otp.c.id,
    columnas=(
        _numero_ot(ot),
        C("paso", "Paso", "entero", otp.c.orden, medible=False,
          ayuda="El lugar del paso dentro de la OT (1, 2, 3...)."),
        C("proceso", "Proceso", "texto", pc.c.nombre, filtro_expr=otp.c.id_proceso,
          opciones="procesos", por_defecto=True),
        C("persona", "Persona", "texto", _nombre_persona(op), filtro_expr=PERSONA_DEL_PASO,
          opciones="personas", por_defecto=True,
          ayuda="La elegida a mano en la OT y, si no hay, la del último plan que incluyó el paso."),
        C("persona_segun", "Persona según", "texto",
          case((otp.c.id_operario.isnot(None), "La OT"), (UP.c.id_operario.isnot(None), "El plan"),
               else_=None),
          filtrable=False),
        C("maquina", "Máquina", "texto", mq.c.nombre, filtro_expr=MAQUINA_DEL_PASO,
          opciones="maquinas", por_defecto=True,
          ayuda="La elegida en la OT y, si no hay, la del último plan."),
        C("estado", "Estado del paso", "texto", otp.c.id_estado, opciones="estados_paso",
          etiquetas=ESTADOS_PASO, por_defecto=True),
        _cliente(),
        _articulo(),
        C("inicio", "Arranque", "fechaHora", fecha_limpia(otp.c.inicio_real),
          filtro_expr=otp.c.inicio_real, por_defecto=True),
        C("fin", "Fin", "fechaHora", fecha_limpia(otp.c.fin_real), filtro_expr=otp.c.fin_real,
          por_defecto=True),
        C("dia_fin", "Día de fin", "fecha", dia_de(fecha_limpia(otp.c.fin_real)), filtrable=False,
          medible=False),
        C("mes_fin", "Mes de fin", "mes", mes_de(fecha_limpia(otp.c.fin_real))),
        C("horas_estimadas", "Horas estimadas", "numero", otp.c.tiempo_proceso / 60.0,
          decimales=2, totaliza=True, por_defecto=True, rendimiento=True,
          ayuda="El tiempo cargado en la OT para el paso."),
        C("horas_reales", "Horas reales", "numero", horas_reales(otp.c.inicio_real, otp.c.fin_real),
          decimales=2, totaliza=True, por_defecto=True, rendimiento=True,
          ayuda="Del arranque al fin marcados, corridas (como el cuadro «estimado vs. real» del "
                "Dashboard): incluye noches y pausas. Vacío si el paso no tiene los dos."),
        C("personas_en_el_paso", "Personas en el paso", "entero", otp.c.cant_operarios),
    ),
    periodo=("fin", "inicio"),
    orden_inicial=("fin", "desc"),
    # Paso por paso, persona y horas son lo que ya muestra cada OT. Lo confidencial es el
    # ranking: las horas estimadas y reales sumadas por persona (la tarjeta
    # /dashboard/rendimiento-operarios). Eso pide la sección.
    por_persona=("persona",),
)


# ── 3. Personas: sus tiempos, su rendimiento y sus ausencias en el período ──

def _personas_pasos(ctx: Contexto):
    """Los pasos TERMINADOS de cada persona con el fin adentro del período (sin período:
    todos), ya sumados. Una tabla derivada y no una subconsulta por columna: el último
    plan se calcula una vez, no una por persona."""
    def armar():
        x = OrdenTrabajoProceso.__table__.alias("otp_p")
        up = _ultimo_plan()
        quien = func.coalesce(x.c.id_operario, up.c.id_operario)
        horas = horas_reales(x.c.inicio_real, x.c.fin_real)
        condiciones = [x.c.id_estado == 3, fecha_real(x.c.fin_real), quien.isnot(None)]
        if ctx.desde:
            condiciones.append(x.c.fin_real >= _fecha(datetime.combine(ctx.desde, datetime.min.time())))
        if ctx.hasta:
            condiciones.append(x.c.fin_real < _fecha(
                datetime.combine(ctx.hasta + timedelta(days=1), datetime.min.time())))
        return (
            select(
                quien.label("id_persona"),
                func.count().label("pasos"),
                func.sum(horas).label("horas_reales"),
                # Lo estimado sólo de los pasos que se pudieron medir: si no, la eficiencia
                # compararía horas estimadas de pasos sin fin contra nada.
                func.sum(case((horas.isnot(None), x.c.tiempo_proceso / 60.0), else_=None))
                .label("horas_estimadas"),
            )
            .select_from(x.outerjoin(up, up.c.id_otp == x.c.id))
            .where(*condiciones)
            .group_by(quien)
            .subquery("pasos_p")
        )
    return ctx.memo("personas_pasos", armar)


def _personas_ausencias(ctx: Contexto):
    """Las ausencias de cada persona que tocan el período, con los días que caen adentro.
    `vuelve` es el primer día que ya no falta (medio abierto, ver AusenciaOperario). Sin
    período: hasta hoy."""
    def armar():
        manana = literal(ctx.hoy.date() + timedelta(days=1), Date())
        fin_ausencia = func.coalesce(au.c.vuelve, manana)
        desde = literal(ctx.desde, Date()) if ctx.desde else None
        hasta_excl = literal((ctx.hasta or ctx.hoy.date()) + timedelta(days=1), Date())
        arranque = mayor_de(au.c.desde, desde) if desde is not None else au.c.desde
        cierre = menor_de(fin_ausencia, hasta_excl)
        condiciones = [au.c.desde < hasta_excl]
        if desde is not None:
            condiciones.append(fin_ausencia > desde)
        return (
            select(
                au.c.id_operario,
                func.count().label("ausencias"),
                func.sum(mayor_de(literal(0), dias_entre(arranque, cierre))).label("dias"),
            )
            .where(*condiciones)
            .group_by(au.c.id_operario)
            .subquery("ausencias_p")
        )
    return ctx.memo("personas_ausencias", armar)


def _col_pasos(nombre: str):
    return lambda ctx: _personas_pasos(ctx).c[nombre]


def _eficiencia(ctx: Contexto) -> ColumnElement:
    t = _personas_pasos(ctx)
    return case(
        (and_(t.c.horas_reales > 0, t.c.horas_estimadas > 0),
         t.c.horas_estimadas * 100.0 / t.c.horas_reales),
        else_=None,
    )


PERSONAS = Fuente(
    codigo="personas",
    nombre="Personas",
    descripcion="Cada persona con los pasos que terminó, sus horas y sus días de ausencia en el período.",
    icono="users",
    requisitos=POLITICAS["asistencia"].leer,
    permiso="Pide poder ver la ficha de las personas (Recursos u Operaciones).",
    origen=lambda ctx: (
        op.outerjoin(_personas_pasos(ctx), _personas_pasos(ctx).c.id_persona == op.c.id)
        .outerjoin(_personas_ausencias(ctx), _personas_ausencias(ctx).c.id_operario == op.c.id)
    ),
    clave=lambda ctx: op.c.id,
    columnas=(
        C("persona", "Persona", "texto", _nombre_persona(op), filtro_expr=op.c.id,
          opciones="personas", por_defecto=True),
        C("sector", "Sector", "texto", op.c.sector),
        C("categoria", "Categoría", "texto", op.c.categoria, por_defecto=True),
        C("activo", "Activo", "booleano", si_no(op.c.disponible == True),  # noqa: E712
          ayuda="Activo o Ausente en su ficha, hoy."),
        C("pasos_terminados", "Pasos terminados", "entero",
          lambda ctx: func.coalesce(_personas_pasos(ctx).c.pasos, 0), totaliza=True,
          por_defecto=True, ayuda="Pasos terminados con el fin adentro del período."),
        # Las horas de cada persona, una al lado de la otra, son el ranking de la sección
        # confidencial «Rendimiento por persona» (estimado y real por persona): sin la
        # sección no aparecen, igual que la eficiencia que sale de ellas. La ficha de
        # RF-06 da esos totales de a UNA persona; lo cuidado es la comparación de todos.
        C("horas_reales", "Horas reales", "numero", _col_pasos("horas_reales"), decimales=2,
          totaliza=True, por_defecto=True, requisitos=REQUISITOS_RENDIMIENTO,
          ayuda="De esos pasos, del arranque al fin, corridas (incluye noches y pausas). "
                "Es de la sección confidencial «Rendimiento por persona»."),
        C("horas_estimadas", "Horas estimadas", "numero", _col_pasos("horas_estimadas"),
          decimales=2, totaliza=True, requisitos=REQUISITOS_RENDIMIENTO,
          ayuda="Es de la sección confidencial «Rendimiento por persona»."),
        C("eficiencia", "Eficiencia", "porcentaje", _eficiencia, decimales=0, medible=False,
          requisitos=REQUISITOS_RENDIMIENTO,
          ayuda="Horas estimadas sobre horas reales: más de 100 % es más rápido que lo "
                "estimado. Es de la sección confidencial «Rendimiento por persona»."),
        C("ausencias", "Ausencias", "entero",
          lambda ctx: func.coalesce(_personas_ausencias(ctx).c.ausencias, 0), totaliza=True),
        C("dias_ausente", "Días de ausencia", "entero",
          lambda ctx: func.coalesce(_personas_ausencias(ctx).c.dias, 0), totaliza=True,
          por_defecto=True, ayuda="Días corridos ausente dentro del período (sin período: hasta hoy)."),
    ),
    periodo_interno="Cuenta los pasos terminados y los días de ausencia de ese período.",
    orden_inicial=("persona", "asc"),
)


# ── 4. Ausencias ──

def _dias_de_la_ausencia(ctx: Contexto) -> ColumnElement:
    manana = literal(ctx.hoy.date() + timedelta(days=1), Date())
    return dias_entre(au.c.desde, func.coalesce(au.c.vuelve, manana))


AUSENCIAS = Fuente(
    codigo="ausencias",
    nombre="Ausencias",
    descripcion="Cada ausencia cargada: de quién, desde cuándo, cuántos días y por qué.",
    icono="calendar-x",
    requisitos=POLITICAS["asistencia"].leer,
    permiso="Pide poder ver la ficha de las personas (Recursos u Operaciones).",
    origen=lambda ctx: au.join(op, op.c.id == au.c.id_operario),
    clave=lambda ctx: au.c.id,
    columnas=(
        C("persona", "Persona", "texto", _nombre_persona(op), filtro_expr=au.c.id_operario,
          opciones="personas", por_defecto=True),
        C("desde", "Desde", "fecha", au.c.desde, sql_fecha="date", por_defecto=True),
        C("vuelve", "Vuelve", "fecha", au.c.vuelve, sql_fecha="date", por_defecto=True,
          ayuda="El primer día que ya no falta. Vacío: sigue ausente."),
        C("dias", "Días", "entero", _dias_de_la_ausencia, totaliza=True, por_defecto=True,
          ayuda="Días corridos. Si sigue ausente, hasta hoy."),
        C("motivo", "Motivo", "texto", au.c.motivo, opciones="motivos_ausencia",
          etiquetas=MOTIVOS_AUSENCIA, por_defecto=True),
        C("observacion", "Observación", "texto", au.c.observacion, agrupable=False),
        C("sigue_ausente", "Sigue ausente", "booleano", si_no(au.c.vuelve.is_(None))),
        C("mes", "Mes", "mes", mes_de(au.c.desde)),
        C("cargada_por", "Cargada por", "texto", au.c.usuario_carga),
    ),
    periodo=("desde",),
    orden_inicial=("desde", "desc"),
)


# ── 5. Máquinas ──

MAQUINAS = Fuente(
    codigo="maquinas",
    nombre="Máquinas",
    descripcion="El catálogo de máquinas: tipo, estado y mantenimiento.",
    icono="cog",
    requisitos=POLITICAS["maquinarias"].leer,
    permiso="Es un catálogo: lo puede leer cualquiera con sesión.",
    origen=lambda ctx: mq,
    clave=lambda ctx: mq.c.id,
    columnas=(
        C("maquina", "Máquina", "texto", mq.c.nombre, filtro_expr=mq.c.id, opciones="maquinas",
          por_defecto=True),
        C("codigo", "Código", "texto", mq.c.cod_maquina, por_defecto=True),
        C("tipo", "Tipo", "texto", mq.c.tipo, por_defecto=True),
        C("estado", "Estado", "texto", mq.c.estado_operativo, opciones="estados_maquina",
          etiquetas=ESTADOS_OPERATIVOS, por_defecto=True),
        C("mantenimiento_dias", "Mantenimiento cada (días)", "entero",
          mq.c.frecuencia_mantenimiento_dias),
        C("especialidad", "Especialidad", "texto", mq.c.especialidad),
        C("capacidad", "Capacidad", "texto", mq.c.capacidad),
        C("limitacion", "Limitación", "texto", mq.c.limitacion),
    ),
    orden_inicial=("maquina", "asc"),
    # Las horas de uso de cada máquina (RF-10) son la fuente «Uso de máquinas», que pide su
    # permiso (este catálogo es libre).
    nota="Las horas de uso de cada máquina están en «Uso de máquinas», agrupando por máquina.",
)


# ── 5 bis. Uso de máquinas (RF-10) ──

_USO_SUMA = and_(um.c.no_suma.is_(None), um.c.fin.isnot(None))
NO_SUMA_USO = {
    NO_SUMA_FUERA_DE_SERVICIO: "Fuera de servicio",
    NO_SUMA_VUELTA_A_PENDIENTE: "Volvió a Pendiente",
}

USO_MAQUINAS = Fuente(
    codigo="uso_maquinas",
    nombre="Uso de máquinas",
    descripcion="Cada tramo en que se usó una máquina en un paso de una OT: cuándo, cuántas horas y quién.",
    icono="gauge",
    requisitos=POLITICAS["maquinas_uso"].leer,
    permiso="Pide la solapa Recurso maquinaria de Recursos (su uso y mantenimiento).",
    origen=lambda ctx: um.outerjoin(mq, mq.c.id == um.c.id_maquinaria),
    clave=lambda ctx: um.c.id,
    columnas=(
        C("maquina", "Máquina", "texto", mq.c.nombre, filtro_expr=um.c.id_maquinaria,
          opciones="maquinas", por_defecto=True),
        C("numero", "N° de OT", "id", um.c.numero_ot, agrupable=True, por_defecto=True),
        C("paso", "Paso", "entero", um.c.paso, medible=False),
        C("proceso", "Proceso", "texto", um.c.nombre_proceso, por_defecto=True),
        C("persona", "Persona", "texto", um.c.operario, filtro_expr=um.c.id_operario,
          opciones="personas",
          ayuda="La elegida a mano en el paso o, si no hay, la del último plan, al arrancar."),
        C("origen", "Máquina según", "texto", um.c.origen_maquina,
          etiquetas={"OT": "La OT", "PLAN": "El plan"}, filtrable=False),
        C("inicio", "Arranque", "fechaHora", um.c.inicio, por_defecto=True),
        C("fin", "Fin", "fechaHora", um.c.fin, por_defecto=True),
        C("mes", "Mes", "mes", mes_de(um.c.inicio)),
        C("horas_uso", "Horas de uso", "numero",
          case((_USO_SUMA, um.c.efectivo_min / 60.0), else_=None),
          decimales=2, totaliza=True, por_defecto=True, rendimiento=True,
          ayuda="Horas EFECTIVAS (dentro de la jornada y sin pausas) medidas al cerrar el tramo. "
                "Vacío si sigue abierto o si no suma. Cada tramo entero: la solapa Uso de la "
                "máquina recorta al período y no cuenta dos veces dos pasos a la vez."),
        C("horas_corridas", "Horas corridas", "numero",
          case((_USO_SUMA, um.c.corrido_min / 60.0), else_=None),
          decimales=2, totaliza=True, rendimiento=True,
          ayuda="Del arranque al fin, con noches y fines de semana."),
        C("en_curso", "Sigue en uso", "booleano", si_no(um.c.fin.is_(None))),
        C("no_suma", "No suma porque", "texto", um.c.no_suma, etiquetas=NO_SUMA_USO,
          filtrable=False,
          ayuda="Arrancado con la máquina fuera de servicio o el paso volvió a Pendiente."),
        C("arranco", "Lo arrancó", "texto", um.c.usuario_inicio),
        C("cerro", "Lo cerró", "texto", um.c.usuario_fin),
    ),
    periodo=("inicio", "fin"),
    orden_inicial=("inicio", "desc"),
    # Las horas de uso sumadas por persona son horas de cada una: el ranking de la sección
    # confidencial, como en «Pasos de las OT».
    por_persona=("persona",),
)


# ── 6. Consumo de materiales ──

CONSUMOS = Fuente(
    codigo="consumos",
    nombre="Consumo de materiales",
    descripcion="Lo que se consumió de cada material en cada OT, cuándo y quién lo cargó.",
    icono="package-minus",
    requisitos=POLITICAS["consumos_material"].leer,
    permiso="Pide poder ver las órdenes de trabajo (Operaciones).",
    origen=lambda ctx: (
        cm.join(ot, ot.c.id == cm.c.id_orden_trabajo)
        .outerjoin(pz, pz.c.id == cm.c.id_pieza)
        .outerjoin(cl, cl.c.id == ot.c.id_cliente)
    ),
    clave=lambda ctx: cm.c.id,
    columnas=(
        C("fecha", "Fecha", "fechaHora", cm.c.fecha, por_defecto=True),
        C("dia", "Día", "fecha", dia_de(cm.c.fecha), filtrable=False, medible=False),
        C("mes", "Mes", "mes", mes_de(cm.c.fecha)),
        _numero_ot(ot),
        _cliente(),
        C("material", "Material", "texto", pz.c.descripcion, por_defecto=True),
        C("codigo_material", "Código de material", "texto", pz.c.cod_pieza),
        C("material_y_unidad", "Material (unidad)", "texto",
          func.trim(func.coalesce(pz.c.descripcion, "") + " ("
                    + func.coalesce(cm.c.unidad, pz.c.unidad, "sin unidad") + ")"),
          ayuda="El material con su unidad: para sumar cantidades sin mezclar kilos con metros."),
        C("cantidad", "Cantidad", "numero", cm.c.cantidad, decimales=3, totaliza=True,
          por_defecto=True),
        C("unidad", "Unidad", "texto", func.coalesce(cm.c.unidad, pz.c.unidad), por_defecto=True),
        C("cargado_por", "Cargado por", "texto", cm.c.usuario),
        C("observaciones", "Observaciones", "texto", cm.c.observaciones, agrupable=False),
        C("anulado", "Anulado", "booleano", si_no(func.coalesce(cm.c.anulado, 0) == 1),
          ayuda="Una carga equivocada que se anuló: queda, pero no suma."),
    ),
    periodo=("fecha",),
    filtros_iniciales=({"columna": "anulado", "op": "es", "valor": False},),
    orden_inicial=("fecha", "desc"),
)


# ── 7. Materia prima y stock ──

_BAJO_MINIMO = and_(pz.c.stock_minimo.isnot(None), func.coalesce(pz.c.stockactual, 0) < pz.c.stock_minimo)

STOCK = Fuente(
    codigo="stock",
    nombre="Materia prima y stock",
    descripcion="Cada material con su stock actual, su mínimo, si está por debajo y dónde está.",
    icono="boxes",
    requisitos=POLITICAS["piezas"].leer,
    permiso="Es un catálogo: lo puede leer cualquiera con sesión.",
    origen=lambda ctx: pz,
    clave=lambda ctx: pz.c.id,
    columnas=(
        C("codigo", "Código", "texto", pz.c.cod_pieza, por_defecto=True),
        C("material", "Material", "texto", pz.c.descripcion, por_defecto=True),
        C("tipo_material", "Tipo de material", "texto", pz.c.material),
        C("formato", "Formato", "texto", pz.c.formato),
        C("proveedor", "Proveedor", "texto", pz.c.proveedor),
        C("unidad", "Unidad", "texto", pz.c.unidad, por_defecto=True),
        C("stock_actual", "Stock actual", "numero", pz.c.stockactual, decimales=2, por_defecto=True),
        C("stock_minimo", "Stock mínimo", "numero", pz.c.stock_minimo, decimales=2, por_defecto=True),
        C("bajo_minimo", "Bajo el mínimo", "booleano", si_no(_BAJO_MINIMO), por_defecto=True),
        C("faltante", "Falta para el mínimo", "numero",
          case((_BAJO_MINIMO, pz.c.stock_minimo - func.coalesce(pz.c.stockactual, 0)), else_=None),
          decimales=2),
        C("ubicacion", "Ubicación", "texto",
          func.trim(func.coalesce(pz.c.estante, "") + " " + func.coalesce(pz.c.letra, "") + " "
                    + func.coalesce(pz.c.nro, ""))),
        C("precio_unitario", "Precio unitario", "numero", pz.c.unitario, decimales=2),
    ),
    orden_inicial=("material", "asc"),
)


# ── 8. No conformidades ──

NO_CONFORMIDADES = Fuente(
    codigo="no_conformidades",
    nombre="No conformidades",
    descripcion="Cada no conformidad: OT, paso, proceso, quién hizo las piezas, tipo, gravedad, "
                "piezas rechazadas de cuántas controladas y tiempo perdido.",
    icono="shield-alert",
    requisitos=POLITICAS["incidencias"].leer,
    permiso="Pide poder ver las no conformidades (o las órdenes de trabajo).",
    origen=lambda ctx: (
        ic.join(ot, ot.c.id == ic.c.id_orden_trabajo)
        .outerjoin(otp_ic, otp_ic.c.id == ic.c.id_otp)
        .outerjoin(pc, pc.c.id == ic.c.id_proceso)
        .outerjoin(op, op.c.id == ic.c.id_operario)
        .outerjoin(cl, cl.c.id == ot.c.id_cliente)
    ),
    clave=lambda ctx: ic.c.id,
    columnas=(
        C("fecha", "Fecha", "fechaHora", ic.c.fecha_registro, por_defecto=True),
        C("mes", "Mes", "mes", mes_de(ic.c.fecha_registro)),
        _numero_ot(ot),
        _cliente(),
        C("paso", "Paso", "entero", otp_ic.c.orden, medible=False,
          ayuda="El paso de la OT donde pasó (RF-12). Vacío: no se dijo, o el paso se sacó de la OT."),
        C("proceso", "Proceso", "texto", pc.c.nombre, filtro_expr=ic.c.id_proceso,
          opciones="procesos", por_defecto=True),
        C("persona", "Las hizo", "texto", _nombre_persona(op), filtro_expr=ic.c.id_operario,
          opciones="personas", por_defecto=True,
          ayuda="Quién hizo las piezas, como lo eligió quien cargó la no conformidad (el "
                "sistema no registra quién hizo cada paso). Agrupar o filtrar por esta columna "
                "es de la sección confidencial «Rendimiento por persona», como en No conformidades."),
        C("tipo", "Tipo", "texto", ic.c.tipo, opciones="tipos_nc", etiquetas=TIPOS_NC,
          por_defecto=True),
        C("gravedad", "Gravedad", "texto", ic.c.gravedad, opciones="gravedades",
          etiquetas=GRAVEDADES, por_defecto=True),
        C("estado", "Estado", "texto", ic.c.estado, opciones="estados_nc", etiquetas=ESTADOS_NC,
          por_defecto=True),
        C("minutos_perdidos", "Minutos perdidos", "entero", ic.c.minutos_perdidos, totaliza=True,
          por_defecto=True),
        C("personas_extra", "Personas extra", "entero", ic.c.operarios_extra, totaliza=True),
        # El código sigue siendo «piezas_afectadas» (los reportes guardados lo nombran);
        # RF-12 lo muestra como piezas rechazadas.
        C("piezas_afectadas", "Piezas rechazadas", "entero", ic.c.piezas_afectadas, totaliza=True,
          por_defecto=True, rendimiento=True),
        C("piezas_controladas", "Piezas controladas", "entero", ic.c.piezas_controladas,
          totaliza=True, rendimiento=True,
          ayuda="De cuántas piezas controladas salieron las rechazadas. Vacío: no se dijo."),
        C("porcentaje_rechazo", "% de rechazo", "porcentaje",
          case((and_(ic.c.piezas_controladas > 0, ic.c.piezas_afectadas.isnot(None)),
                ic.c.piezas_afectadas * 100.0 / ic.c.piezas_controladas), else_=None),
          decimales=1, medible=False,
          ayuda="Rechazadas sobre controladas, de esta no conformidad. Vacío si no dice de "
                "cuántas controladas. Para el total, sumá las dos columnas."),
        C("disposicion", "Qué se hace con lo rechazado", "texto", ic.c.disposicion,
          opciones="disposiciones", etiquetas=DISPOSICIONES),
        C("descripcion", "Descripción", "texto", ic.c.descripcion, agrupable=False),
        C("accion_correctiva", "Acción correctiva", "texto", ic.c.accion_correctiva, agrupable=False),
        C("registrada_por", "Registrada por", "texto", ic.c.usuario),
        C("fecha_cierre", "Fecha de cierre", "fechaHora", ic.c.fecha_cierre),
    ),
    periodo=("fecha", "fecha_cierre"),
    orden_inicial=("fecha", "desc"),
    # RF-12: las no conformidades AGRUPADAS o FILTRADAS por quién hizo las piezas son de
    # la sección confidencial «Rendimiento por persona» (/incidencias/por-persona y
    # ?id_operario= piden esa sección). La lista con la columna, no: ya lo decía.
    por_persona=("persona",),
    persona_confidencial=True,
)


# ── 9. Pausas ──

def _horas_de_la_pausa(ctx: Contexto) -> ColumnElement:
    """Cuánto duró (o lleva, si sigue abierta: hasta ahora)."""
    return horas_entre(pa.c.desde, func.coalesce(pa.c.hasta, _fecha(ctx.ahora)))


PAUSAS = Fuente(
    codigo="pausas",
    nombre="Pausas",
    descripcion="Cada vez que se paró una OT o un paso: motivo, cuánto duró y quién la pausó.",
    icono="pause-circle",
    requisitos=POLITICAS["pausas"].leer,
    permiso="Pide poder ver las órdenes de trabajo (Operaciones).",
    origen=lambda ctx: (
        pa.join(ot, ot.c.id == pa.c.id_orden_trabajo).outerjoin(cl, cl.c.id == ot.c.id_cliente)
    ),
    clave=lambda ctx: pa.c.id,
    columnas=(
        _numero_ot(ot),
        _cliente(),
        C("que", "Qué se pausó", "texto",
          case((pa.c.id_otp.is_(None), "La OT entera"), else_="Un paso"), filtrable=False,
          por_defecto=True),
        C("paso", "Paso", "texto", pa.c.nombre_proceso, por_defecto=True),
        C("motivo", "Motivo", "texto", pa.c.motivo, opciones="motivos_pausa",
          etiquetas=MOTIVOS_PAUSA, por_defecto=True),
        C("observacion", "Observación", "texto", pa.c.observacion, agrupable=False),
        C("desde", "Desde", "fechaHora", pa.c.desde, por_defecto=True),
        C("hasta", "Hasta", "fechaHora", pa.c.hasta, por_defecto=True),
        C("mes", "Mes", "mes", mes_de(pa.c.desde)),
        C("horas", "Horas", "numero", _horas_de_la_pausa, decimales=2, totaliza=True,
          por_defecto=True, ayuda="Lo que duró; si sigue pausada, hasta ahora."),
        C("abierta", "Sigue pausada", "booleano", si_no(pa.c.hasta.is_(None))),
        C("pauso", "Pausó", "texto", pa.c.usuario_pausa),
        C("reanudo", "Reanudó", "texto", pa.c.usuario_reanuda),
        C("cierre", "Cómo terminó", "texto", pa.c.cierre, opciones="cierres_pausa",
          etiquetas=CIERRE_TEXTO),
    ),
    periodo=("desde",),
    orden_inicial=("desde", "desc"),
)


# ── 10. Auditoría ──

def _condiciones_auditoria(ctx: Contexto, permisos: PermisosUsuario) -> list:
    """Lo mismo que esconde la pantalla de Auditoría, con SUS funciones (no una copia):
    sin «Ingresos y actividad por persona» no van las filas de entrar, salir y claves; sin
    la política «asistencia», las de cargar o borrar ausencias (ver AuditoriaAPI)."""
    from backend.presentation.AuditoriaAPI import _puede, _sin_ausencias, _sin_ingresos, _ve_ausencias

    condiciones = []
    if not _puede(permisos, "auditoria_ingresos"):
        condiciones.append(_sin_ingresos())
    if not _ve_ausencias(permisos):
        condiciones.append(_sin_ausencias())
    return condiciones


AUDITORIA = Fuente(
    codigo="auditoria",
    nombre="Auditoría",
    descripcion="Todo lo que se hizo en el sistema: quién, cuándo, qué y sobre qué.",
    icono="history",
    requisitos=POLITICAS["auditoria"].leer,
    permiso="Pide la solapa «Todo lo que se hizo» de Auditoría.",
    origen=lambda ctx: am,
    clave=lambda ctx: am.c.id,
    condiciones=_condiciones_auditoria,
    columnas=(
        C("cuando", "Cuándo", "fechaHora", am.c.creado_en, por_defecto=True),
        C("dia", "Día", "fecha", dia_de(am.c.creado_en), filtrable=False, medible=False),
        C("mes", "Mes", "mes", mes_de(am.c.creado_en)),
        C("usuario", "Quién", "texto", am.c.usuario, por_defecto=True),
        C("accion", "Acción", "texto", am.c.accion, por_defecto=True),
        C("entidad", "Qué", "texto", am.c.entidad, por_defecto=True),
        C("numero", "Número", "texto", am.c.id_entidad),
        C("descripcion", "Descripción", "texto", am.c.descripcion, agrupable=False, por_defecto=True),
        C("salio_bien", "Salió bien", "booleano", si_no(func.coalesce(am.c.estado, 0) < 400)),
    ),
    periodo=("cuando",),
    orden_inicial=("cuando", "desc"),
)


FUENTES: tuple[Fuente, ...] = (
    ORDENES, PASOS, PERSONAS, AUSENCIAS, MAQUINAS, USO_MAQUINAS, CONSUMOS, STOCK,
    NO_CONFORMIDADES, PAUSAS, AUDITORIA,
)
FUENTE_POR_CODIGO: dict[str, Fuente] = {f.codigo: f for f in FUENTES}
assert len(FUENTE_POR_CODIGO) == len(FUENTES)


# ─────────────────────────── las listas para elegir ───────────────────────────
#
# Las de un catálogo de la base se leen (id, nombre). Las cerradas son las mismas de cada
# pantalla, importadas de donde viven: si allá se suma un motivo, acá aparece solo.

OPCIONES_DE_TABLA: dict[str, tuple] = {
    "clientes": (Cliente.id, Cliente.nombre),
    "prioridades": (Prioridad.id, Prioridad.descripcion),
    "sectores": (Sector.id, Sector.nombre),
    "procesos": (Proceso.id, Proceso.nombre),
    "maquinas": (Maquinaria.id, Maquinaria.nombre),
    "personas": (Operario.id, None),  # nombre y apellido: ver ReportesService._opciones_de_tabla
}

OPCIONES_FIJAS: dict[str, dict] = {
    "estados_ot": ESTADOS_OT,
    "estados_paso": ESTADOS_PASO,
    "motivos_ausencia": MOTIVOS_AUSENCIA,
    "estados_maquina": ESTADOS_OPERATIVOS,
    "tipos_nc": TIPOS_NC,
    "gravedades": GRAVEDADES,
    "estados_nc": ESTADOS_NC,
    "motivos_pausa": MOTIVOS_PAUSA,
    "cierres_pausa": CIERRE_TEXTO,
    "disposiciones": DISPOSICIONES,
}

for _f in FUENTES:
    for _c in _f.columnas:
        assert _c.opciones is None or _c.opciones in OPCIONES_DE_TABLA or _c.opciones in OPCIONES_FIJAS, \
            (_f.codigo, _c.codigo, _c.opciones)


# ─────────────────────────── permisos ───────────────────────────


def puede_fuente(fuente: Fuente, permisos: PermisosUsuario) -> bool:
    return permite(fuente.requisitos, permisos, {})


def puede_columna(columna: Columna, permisos: PermisosUsuario) -> bool:
    return permite(columna.requisitos, permisos, {})


def puede_rendimiento(permisos: PermisosUsuario) -> bool:
    return permite(REQUISITOS_RENDIMIENTO, permisos, {})


# ─────────────────────────── los reportes de ejemplo ───────────────────────────
#
# Arrancan armados para lo que el taller pregunta seguido. No están en la base: son
# parte del catálogo, se abren, se ajustan y se guardan como propios. Cada uno pasa por
# la MISMA validación que un reporte cualquiera (un test lo exige) y sólo se le muestra a
# quien puede leer su fuente.

EJEMPLOS: tuple[dict, ...] = (
    {
        "codigo": "ot_entregadas_por_cliente",
        "nombre": "OT entregadas por cliente este mes",
        "descripcion": "Cuántas órdenes se entregaron a cada cliente este mes y cuántas unidades.",
        "config": {
            "fuente": "ordenes",
            "columnas": ["numero", "cliente", "articulo", "unidades", "fecha_entrega"],
            "periodo": {"columna": "fecha_entrega", "atajo": "este_mes"},
            "filtros": [],
            "agrupar": ["cliente"],
            "medidas": [{"funcion": "conteo"}, {"funcion": "suma", "columna": "unidades"},
                        {"funcion": "suma", "columna": "entregadas"}],
            "orden": {"por": "m0", "direccion": "desc"},
        },
    },
    {
        "codigo": "horas_por_persona_y_proceso",
        "nombre": "Horas por persona y proceso",
        "descripcion": "Pasos terminados este mes, sumados por persona y por proceso.",
        "config": {
            "fuente": "pasos",
            "columnas": ["numero", "proceso", "persona", "horas_estimadas", "horas_reales"],
            "periodo": {"columna": "fin", "atajo": "este_mes"},
            "filtros": [{"columna": "estado", "op": "en", "valores": [3]}],
            "agrupar": ["persona", "proceso"],
            "medidas": [{"funcion": "conteo"}, {"funcion": "suma", "columna": "horas_reales"},
                        {"funcion": "suma", "columna": "horas_estimadas"}],
            "orden": {"por": "persona", "direccion": "asc"},
        },
    },
    {
        "codigo": "consumo_por_ot",
        "nombre": "Consumo de material por OT",
        "descripcion": "Qué material se consumió en cada OT este mes (sin las cargas anuladas).",
        "config": {
            "fuente": "consumos",
            "columnas": ["fecha", "numero", "material", "cantidad", "unidad"],
            "periodo": {"columna": "fecha", "atajo": "este_mes"},
            "filtros": [{"columna": "anulado", "op": "es", "valor": False}],
            "agrupar": ["numero", "material_y_unidad"],
            "medidas": [{"funcion": "suma", "columna": "cantidad"}, {"funcion": "conteo"}],
            "orden": {"por": "numero", "direccion": "desc"},
        },
    },
    {
        "codigo": "no_conformidades_por_persona",
        "nombre": "No conformidades por persona",
        "descripcion": "Cuántas no conformidades tuvo cada persona en los últimos 90 días y cuánto tiempo se perdió.",
        "config": {
            "fuente": "no_conformidades",
            "columnas": ["fecha", "numero", "persona", "tipo", "gravedad", "minutos_perdidos"],
            "periodo": {"columna": "fecha", "atajo": "ultimos_90"},
            "filtros": [],
            "agrupar": ["persona"],
            "medidas": [{"funcion": "conteo"}, {"funcion": "suma", "columna": "minutos_perdidos"},
                        {"funcion": "suma", "columna": "piezas_afectadas"}],
            "orden": {"por": "m0", "direccion": "desc"},
        },
    },
    {
        "codigo": "pausas_por_motivo",
        "nombre": "Pausas por motivo",
        "descripcion": "Cuántas veces y cuántas horas se paró el taller por cada motivo, últimos 30 días.",
        "config": {
            "fuente": "pausas",
            "columnas": ["numero", "motivo", "desde", "hasta", "horas"],
            "periodo": {"columna": "desde", "atajo": "ultimos_30"},
            "filtros": [],
            "agrupar": ["motivo"],
            "medidas": [{"funcion": "conteo"}, {"funcion": "suma", "columna": "horas"}],
            "orden": {"por": "m1", "direccion": "desc"},
        },
    },
    {
        "codigo": "materia_prima_bajo_minimo",
        "nombre": "Materia prima bajo el mínimo",
        "descripcion": "Los materiales con stock por debajo de su mínimo y cuánto falta.",
        "config": {
            "fuente": "stock",
            "columnas": ["codigo", "material", "stock_actual", "stock_minimo", "faltante", "unidad",
                         "proveedor"],
            "filtros": [{"columna": "bajo_minimo", "op": "es", "valor": True}],
            "agrupar": [],
            "medidas": [],
            "orden": {"por": "faltante", "direccion": "desc"},
        },
    },
)
