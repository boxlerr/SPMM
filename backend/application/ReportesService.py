"""
El armador de reportes personalizados (RF-23): validar lo que pide la persona contra el
catálogo, armar la consulta y correrla con tope de filas y de tiempo.

El catálogo (qué se puede pedir) está en application/ReportesCatalogo.py; acá está qué
se hace con eso. El porqué completo del armador, en ese archivo.

EL CAMINO DE UN PEDIDO

  1. `leer_config`: el JSON que manda la pantalla, con su forma (pydantic, sin campos de
     más). Un campo que no se conoce es un error, no algo que se ignora.
  2. `validar`: cada código contra el catálogo y contra los permisos de QUIEN PIDE —no de
     quien guardó el reporte—. Lo inventado es 422 («no existe»); lo que no puede ver es
     403. Sale un `Plan` con las piezas del catálogo ya resueltas.
  3. `ejecutar`: arma UNA consulta base (las columnas que hacen falta, con su etiqueta, y
     los filtros) y la usa como subconsulta para todo lo demás: las filas, la cuenta, los
     totales y la agrupación. Agrupar sobre la subconsulta, y no repetir cada expresión en
     el GROUP BY, hace que Postgres no tenga que reconocer dos veces la misma expresión con
     parámetros distintos.

LOS TOPES

  · 20.000 filas por archivo (TOPE_FILAS). Si hay más, se bajan las primeras y la
    respuesta lo dice con todas las letras: cuántas había y cuántas van. La vista previa
    trae 50.
  · 20 segundos por consulta en Postgres (statement_timeout, sólo para este pedido) y 25
    en total: un reporte de «todo, desde siempre» sobre la auditoría no puede tomar una
    conexión del pooler —15 para todo el proyecto— hasta que alguien se canse.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import Date, false, func, literal, or_, select, text, true
from sqlalchemy.exc import DBAPIError

from backend.application import ReportesCatalogo as cat
from backend.application.ReportesCatalogo import (
    ATAJOS,
    EJEMPLOS,
    FECHAS,
    FUENTE_POR_CODIGO,
    FUENTES,
    NOMBRE_FUNCION,
    NUMERICOS,
    OPCIONES_DE_TABLA,
    OPCIONES_FIJAS,
    OPERACION_DE_FILTRO,
    Columna,
    Contexto,
    Fuente,
    puede_columna,
    puede_fuente,
    rango_del_atajo,
)
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.loggers.logger import logger
from backend.core.permisos import PermisosUsuario
from backend.domain.Operario import Operario
from backend.infrastructure.estado_ordenes import ahora_ar

TOPE_FILAS = 20_000
FILAS_VISTA_PREVIA = 50
TOPE_SEGUNDOS_SQL = 20
TOPE_SEGUNDOS = 25
# El JSON de un reporte viaja en la dirección (es una lectura: GET). Uno armado a mano con
# todo lo que el catálogo deja pedir mide ~3 KB; esto es el doble y pico.
LARGO_MAXIMO_CONFIG = 8000
TOPE_OPCIONES = 5000


class ReporteSinPermiso(Exception):
    """La persona pidió una fuente o una columna que no puede ver: 403 en la API."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


# ─────────────────────────── 1. la forma del pedido ───────────────────────────


class _Estricto(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FiltroCfg(_Estricto):
    columna: str = Field(max_length=40)
    op: Literal["en", "contiene", "entre", "es"]
    valores: Optional[list[Union[int, str, None]]] = Field(None, max_length=200)
    valor: Optional[Union[bool, str]] = None
    desde: Optional[Union[int, float, str]] = None
    hasta: Optional[Union[int, float, str]] = None


class PeriodoCfg(_Estricto):
    columna: Optional[str] = Field(None, max_length=40)
    atajo: Optional[Literal["este_mes", "mes_pasado", "ultimos_30", "ultimos_90", "este_anio"]] = None
    desde: Optional[date] = None
    hasta: Optional[date] = None


class MedidaCfg(_Estricto):
    funcion: Literal["conteo", "suma", "promedio", "minimo", "maximo"]
    columna: Optional[str] = Field(None, max_length=40)


class OrdenCfg(_Estricto):
    por: str = Field(max_length=40)
    direccion: Literal["asc", "desc"] = "asc"


class ConfigReporte(_Estricto):
    version: Literal[1] = 1
    fuente: str = Field(max_length=40)
    columnas: list[str] = Field(default_factory=list, max_length=40)
    filtros: list[FiltroCfg] = Field(default_factory=list, max_length=20)
    periodo: Optional[PeriodoCfg] = None
    agrupar: list[str] = Field(default_factory=list, max_length=2)
    medidas: list[MedidaCfg] = Field(default_factory=list, max_length=8)
    orden: Optional[OrdenCfg] = None


def leer_config(crudo: Any) -> ConfigReporte:
    """El pedido con su forma, o BusinessException (422) diciendo qué está mal."""
    if isinstance(crudo, str):
        if len(crudo) > LARGO_MAXIMO_CONFIG:
            raise BusinessException("El reporte es demasiado largo para pedirlo de una vez.")
        try:
            crudo = json.loads(crudo)
        except ValueError:
            raise BusinessException("No se entiende el reporte pedido (no es un JSON válido).")
    if not isinstance(crudo, dict):
        raise BusinessException("No se entiende el reporte pedido.")
    try:
        return ConfigReporte.model_validate(crudo)
    except ValidationError as e:
        primero = e.errors()[0]
        donde = ".".join(str(x) for x in primero.get("loc", ()))
        raise BusinessException(f"El reporte pedido no tiene la forma esperada ({donde}: {primero.get('msg')}).")


# ─────────────────────────── 2. validar contra el catálogo ───────────────────────────


@dataclass
class Filtro:
    columna: Columna
    op: str
    valores: list = field(default_factory=list)
    valor: Any = None
    desde: Any = None
    hasta: Any = None


@dataclass
class Medida:
    funcion: str
    columna: Optional[Columna]

    @property
    def nombre(self) -> str:
        if self.funcion == "conteo":
            return "Cantidad"
        return f"{self.columna.nombre} ({NOMBRE_FUNCION[self.funcion].lower()})"

    @property
    def tipo(self) -> str:
        if self.funcion == "conteo":
            return "entero"
        if self.funcion == "promedio":
            return "numero"
        return self.columna.tipo

    @property
    def decimales(self) -> Optional[int]:
        if self.funcion == "conteo":
            return 0
        if self.funcion == "promedio":
            return 2 if self.columna.decimales is None else max(2, self.columna.decimales)
        return self.columna.decimales


@dataclass
class Periodo:
    columna: Optional[Columna]  # None: la fuente lo usa adentro (periodo_interno)
    desde: date
    hasta: date
    atajo: Optional[str] = None


@dataclass
class Plan:
    """El pedido ya resuelto contra el catálogo: piezas del catálogo, no códigos."""

    fuente: Fuente
    config: ConfigReporte
    columnas: list[Columna]
    filtros: list[Filtro]
    periodo: Optional[Periodo]
    agrupar: list[Columna]
    medidas: list[Medida]
    orden_por: str  # un código de columna, o «m0», «m1»... en una agrupación
    orden_desc: bool

    @property
    def agrupado(self) -> bool:
        return bool(self.agrupar)


def _fuente(codigo: str, permisos: PermisosUsuario) -> Fuente:
    fuente = FUENTE_POR_CODIGO.get(codigo)
    if fuente is None:
        raise BusinessException(f"No existe la fuente de datos «{codigo}».")
    if not puede_fuente(fuente, permisos):
        raise ReporteSinPermiso(f"No tenés permiso para ver «{fuente.nombre}». {fuente.permiso}")
    return fuente


def _columna(fuente: Fuente, codigo: Optional[str], permisos: PermisosUsuario) -> Columna:
    col = fuente.columna(codigo or "")
    if col is None:
        raise BusinessException(f"«{fuente.nombre}» no tiene la columna «{codigo}».")
    if not puede_columna(col, permisos):
        raise ReporteSinPermiso(
            f"No tenés permiso para ver «{col.nombre}» de «{fuente.nombre}». "
            "Es de la sección confidencial «Rendimiento por persona».")
    return col


def _leer_dia(valor, que: str) -> date:
    if isinstance(valor, date):
        return valor
    try:
        return date.fromisoformat(str(valor).strip()[:10])
    except ValueError:
        raise BusinessException(f"{que}: «{valor}» no es una fecha (se espera AAAA-MM-DD).")


def _leer_numero(valor, que: str) -> float:
    if isinstance(valor, bool):
        raise BusinessException(f"{que}: se espera un número.")
    try:
        n = float(valor)
    except (TypeError, ValueError):
        raise BusinessException(f"{que}: «{valor}» no es un número.")
    if n != n or n in (float("inf"), float("-inf")):
        raise BusinessException(f"{que}: se espera un número.")
    return n


def _validar_filtro(fuente: Fuente, f: FiltroCfg, permisos: PermisosUsuario) -> Filtro:
    col = _columna(fuente, f.columna, permisos)
    tipo_filtro = col.filtro
    if tipo_filtro is None:
        raise BusinessException(f"«{col.nombre}» no se puede usar como filtro.")
    esperada = OPERACION_DE_FILTRO[tipo_filtro]
    if f.op != esperada:
        raise BusinessException(f"«{col.nombre}» se filtra con «{esperada}», no con «{f.op}».")
    que = f"Filtro «{col.nombre}»"

    if f.op == "en":
        valores = list(f.valores or [])
        if not valores:
            raise BusinessException(f"{que}: elegí al menos un valor.")
        if col.opciones in OPCIONES_FIJAS:
            permitidos = OPCIONES_FIJAS[col.opciones]
            for v in valores:
                if v is not None and v not in permitidos:
                    raise BusinessException(f"{que}: «{v}» no es uno de los valores posibles.")
        else:
            limpios = []
            for v in valores:
                if v is None:
                    limpios.append(None)
                    continue
                if isinstance(v, bool) or not str(v).strip().lstrip("-").isdigit():
                    raise BusinessException(f"{que}: «{v}» no es uno de los valores posibles.")
                limpios.append(int(v))
            valores = limpios
        return Filtro(col, "en", valores=list(dict.fromkeys(valores)))

    if f.op == "contiene":
        texto = (f.valor if isinstance(f.valor, str) else "").strip()
        if not texto:
            raise BusinessException(f"{que}: escribí qué buscar.")
        if len(texto) > 100:
            raise BusinessException(f"{que}: el texto a buscar es demasiado largo.")
        return Filtro(col, "contiene", valor=texto)

    if f.op == "es":
        if not isinstance(f.valor, bool):
            raise BusinessException(f"{que}: se espera sí o no.")
        return Filtro(col, "es", valor=f.valor)

    # entre
    if f.desde in (None, "") and f.hasta in (None, ""):
        raise BusinessException(f"{que}: poné un «desde», un «hasta» o los dos.")
    if tipo_filtro == "fecha":
        desde = _leer_dia(f.desde, que) if f.desde not in (None, "") else None
        hasta = _leer_dia(f.hasta, que) if f.hasta not in (None, "") else None
    else:
        desde = _leer_numero(f.desde, que) if f.desde not in (None, "") else None
        hasta = _leer_numero(f.hasta, que) if f.hasta not in (None, "") else None
    if desde is not None and hasta is not None and desde > hasta:
        raise BusinessException(f"{que}: el «desde» es posterior al «hasta».")
    return Filtro(col, "entre", desde=desde, hasta=hasta)


def _validar_periodo(fuente: Fuente, p: Optional[PeriodoCfg], permisos, hoy: date) -> Optional[Periodo]:
    if p is None or (p.atajo is None and p.desde is None and p.hasta is None):
        return None
    if not fuente.periodo and not fuente.periodo_interno:
        raise BusinessException(f"«{fuente.nombre}» no tiene fechas: no se puede acotar por período.")
    if p.atajo and (p.desde or p.hasta):
        raise BusinessException("El período es un atajo o un rango de fechas, no los dos.")
    if fuente.periodo_interno:
        if p.columna:
            raise BusinessException(f"El período de «{fuente.nombre}» no se elige por columna.")
        columna = None
    else:
        codigo = p.columna or fuente.periodo[0]
        if codigo not in fuente.periodo:
            # Puede ser una columna que existe pero no es una fecha del período.
            _columna(fuente, codigo, permisos)
            raise BusinessException(f"«{fuente.nombre}» no se acota por «{codigo}».")
        columna = _columna(fuente, codigo, permisos)
    if p.atajo:
        desde, hasta = rango_del_atajo(p.atajo, hoy)
    else:
        if p.desde is None or p.hasta is None:
            raise BusinessException("El período necesita las dos fechas: desde y hasta.")
        desde, hasta = p.desde, p.hasta
        if desde > hasta:
            raise BusinessException("El período empieza después de terminar.")
        if (hasta - desde).days > 3660:
            raise BusinessException("El período no puede pasar de diez años.")
    return Periodo(columna, desde, hasta, p.atajo)


def validar(crudo: Any, permisos: PermisosUsuario, hoy: Optional[date] = None) -> Plan:
    """El pedido resuelto contra el catálogo y los permisos de quien pide."""
    cfg = crudo if isinstance(crudo, ConfigReporte) else leer_config(crudo)
    hoy = hoy or ahora_ar().date()
    fuente = _fuente(cfg.fuente, permisos)

    columnas = []
    for codigo in cfg.columnas:
        col = _columna(fuente, codigo, permisos)
        if col in columnas:
            raise BusinessException(f"La columna «{col.nombre}» está dos veces.")
        columnas.append(col)

    filtros = [_validar_filtro(fuente, f, permisos) for f in cfg.filtros]
    periodo = _validar_periodo(fuente, cfg.periodo, permisos, hoy)

    agrupar = []
    for codigo in cfg.agrupar:
        col = _columna(fuente, codigo, permisos)
        if not col.agrupable:
            raise BusinessException(f"No se puede agrupar por «{col.nombre}».")
        if col in agrupar:
            raise BusinessException(f"«{col.nombre}» está dos veces en «agrupar».")
        agrupar.append(col)

    medidas = []
    for m in cfg.medidas:
        if m.funcion == "conteo":
            if m.columna:
                raise BusinessException("La cantidad cuenta filas: no lleva columna.")
            medida = Medida("conteo", None)
        else:
            col = _columna(fuente, m.columna, permisos)
            if m.funcion not in col.funciones():
                raise BusinessException(
                    f"A «{col.nombre}» no se le puede pedir {NOMBRE_FUNCION[m.funcion].lower()}.")
            medida = Medida(m.funcion, col)
        if any(x.funcion == medida.funcion and x.columna is medida.columna for x in medidas):
            raise BusinessException(f"«{medida.nombre}» está dos veces.")
        medidas.append(medida)

    if not agrupar and not columnas:
        raise BusinessException("Elegí al menos una columna.")
    if agrupar and not medidas:
        medidas = [Medida("conteo", None)]

    # El orden: lo pedido, o el de siempre de la fuente.
    if cfg.orden:
        por, desc = cfg.orden.por, cfg.orden.direccion == "desc"
        if agrupar:
            indices = {f"m{i}" for i in range(len(medidas))}
            if por not in indices and por not in {c.codigo for c in agrupar}:
                raise BusinessException(
                    "En una agrupación se ordena por una de las columnas agrupadas o por una cuenta.")
        else:
            _columna(fuente, por, permisos)
    elif agrupar:
        por, desc = agrupar[0].codigo, False
    elif fuente.orden_inicial and puede_columna(fuente.columna(fuente.orden_inicial[0]), permisos):
        por, desc = fuente.orden_inicial[0], fuente.orden_inicial[1] == "desc"
    else:
        por, desc = columnas[0].codigo, False

    return Plan(fuente, cfg, columnas, filtros, periodo, agrupar, medidas, por, desc)


# ─────────────────────────── 3. armar y correr ───────────────────────────


def _escapar_like(texto: str) -> str:
    return texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _inicio_del_dia(d: date) -> datetime:
    return datetime.combine(d, time.min)


def _entre_fechas(expr, columna: Columna, desde: Optional[date], hasta: Optional[date]) -> list:
    """`desde` y `hasta` INCLUIDOS. Para una fecha y hora, hasta el final de `hasta`."""
    condiciones = []
    if columna.sql_fecha == "date":
        if desde is not None:
            condiciones.append(expr >= literal(desde, Date()))
        if hasta is not None:
            condiciones.append(expr <= literal(hasta, Date()))
    else:
        if desde is not None:
            condiciones.append(expr >= cat._fecha(_inicio_del_dia(desde)))
        if hasta is not None:
            condiciones.append(expr < cat._fecha(_inicio_del_dia(hasta + timedelta(days=1))))
    return condiciones


def _condicion(f: Filtro, ctx: Contexto):
    col = f.columna
    expr = (col.filtro_expr or col.expr)(ctx)
    if f.op == "en":
        valores = [v for v in f.valores if v is not None]
        partes = []
        if valores:
            partes.append(expr.in_(valores))
        if None in f.valores:
            partes.append(expr.is_(None))
        return or_(*partes)
    if f.op == "contiene":
        return expr.ilike(f"%{_escapar_like(f.valor)}%", escape="\\")
    if f.op == "es":
        return expr == (true() if f.valor else false())
    # entre
    if col.tipo in FECHAS:
        condiciones = _entre_fechas(expr, col, f.desde, f.hasta)
    else:
        condiciones = []
        if f.desde is not None:
            condiciones.append(expr >= f.desde)
        if f.hasta is not None:
            condiciones.append(expr <= f.hasta)
    return condiciones[0] if len(condiciones) == 1 else condiciones[0] & condiciones[1]


def _etiqueta(codigo: str) -> str:
    # El código ya pasó por el catálogo ([a-z0-9_]): la etiqueta no lleva nada de afuera.
    return f"c_{codigo}"


def _agregado(funcion: str, expr):
    return {
        "conteo": lambda: func.count(),
        "suma": lambda: func.sum(expr),
        "promedio": lambda: func.avg(expr),
        "minimo": lambda: func.min(expr),
        "maximo": lambda: func.max(expr),
    }[funcion]()


def armar_consultas(plan: Plan, ctx: Contexto, permisos: PermisosUsuario, limite: int) -> dict:
    """Las consultas del reporte, sin correrlas: {"filas", "cuenta"} (y "grupos" si se
    agrupa). Separado de correrlas para poder mirarlas en un test."""
    fuente = plan.fuente
    necesarias: list[Columna] = []

    def necesito(col: Optional[Columna]):
        if col is not None and col not in necesarias:
            necesarias.append(col)

    for c in plan.columnas if not plan.agrupado else ():
        necesito(c)
    for c in plan.agrupar:
        necesito(c)
    for m in plan.medidas if plan.agrupado else ():
        necesito(m.columna)
    if not plan.agrupado:
        necesito(fuente.columna(plan.orden_por))

    condiciones = [_condicion(f, ctx) for f in plan.filtros]
    if plan.periodo and plan.periodo.columna is not None:
        col = plan.periodo.columna
        condiciones += _entre_fechas((col.filtro_expr or col.expr)(ctx), col,
                                     plan.periodo.desde, plan.periodo.hasta)
    if fuente.condiciones:
        condiciones += fuente.condiciones(ctx, permisos)

    base = (
        select(*[c.expr(ctx).label(_etiqueta(c.codigo)) for c in necesarias],
               fuente.clave(ctx).label("clave_fila"))
        .select_from(fuente.origen(ctx))
        .where(*condiciones)
        .subquery("base")
    )

    if not plan.agrupado:
        orden = base.c[_etiqueta(plan.orden_por)]
        orden = orden.desc() if plan.orden_desc else orden.asc()
        filas = (
            select(*[base.c[_etiqueta(c.codigo)] for c in plan.columnas])
            .order_by(orden.nulls_last(), base.c.clave_fila)
            .limit(limite)
        )
        cuenta = select(
            func.count().label("filas"),
            *[func.sum(base.c[_etiqueta(c.codigo)]).label(_etiqueta(c.codigo))
              for c in plan.columnas if c.totaliza],
        ).select_from(base)
        return {"filas": filas, "cuenta": cuenta}

    grupos = [base.c[_etiqueta(c.codigo)] for c in plan.agrupar]
    medidas = [
        _agregado(m.funcion, base.c[_etiqueta(m.columna.codigo)] if m.columna else None).label(f"m{i}")
        for i, m in enumerate(plan.medidas)
    ]
    if plan.orden_por.startswith("m") and plan.orden_por[1:].isdigit():
        orden = medidas[int(plan.orden_por[1:])]
    else:
        orden = base.c[_etiqueta(plan.orden_por)]
    orden = orden.desc() if plan.orden_desc else orden.asc()
    filas = (
        select(*grupos, *medidas)
        .group_by(*grupos)
        .order_by(orden.nulls_last(), *[g.asc().nulls_last() for g in grupos])
        .limit(limite)
    )
    cuenta = select(
        func.count().label("filas"),
        *[_agregado(m.funcion, base.c[_etiqueta(m.columna.codigo)] if m.columna else None).label(f"m{i}")
          for i, m in enumerate(plan.medidas)],
    ).select_from(base)
    cuantos_grupos = select(func.count()).select_from(select(*grupos).group_by(*grupos).subquery("g"))
    return {"filas": filas, "cuenta": cuenta, "grupos": cuantos_grupos}


def _dialecto(db) -> str:
    try:
        return db.get_bind().dialect.name
    except Exception:
        return ""


async def _correr(db, consultas: dict) -> dict:
    """Corre las consultas con el tope de tiempo. En Postgres el tope lo corta la base
    (statement_timeout, sólo para esta transacción: SET LOCAL), y el wait_for es por si
    la base ni contesta."""
    async def todo():
        if _dialecto(db) == "postgresql":
            await db.execute(text(f"SET LOCAL statement_timeout = '{int(TOPE_SEGUNDOS_SQL)}s'"))
        salida = {"filas": (await db.execute(consultas["filas"])).mappings().all(),
                  "cuenta": (await db.execute(consultas["cuenta"])).mappings().one()}
        if "grupos" in consultas:
            salida["grupos"] = (await db.execute(consultas["grupos"])).scalar() or 0
        return salida

    try:
        return await asyncio.wait_for(todo(), timeout=TOPE_SEGUNDOS)
    except asyncio.TimeoutError:
        raise BusinessException(_TARDO)
    except DBAPIError as e:
        if "statement timeout" in str(e).lower() or "canceling statement" in str(e).lower():
            raise BusinessException(_TARDO)
        raise


_TARDO = (f"El reporte tardó más de {TOPE_SEGUNDOS_SQL} segundos y se cortó. Acotá el período o "
          "sacá algún filtro de texto y probá de nuevo.")


# ── los valores, como los lee la pantalla ──

def _valor(tipo: str, v, etiquetas: Optional[dict] = None, decimales: Optional[int] = None):
    if v is None:
        return None
    if isinstance(v, Decimal):
        v = float(v)
    if etiquetas is not None:
        return etiquetas.get(v, v)
    if tipo in ("fecha", "fechaHora"):
        if isinstance(v, str):
            v = v.strip().replace(" ", "T")
            try:
                v = datetime.fromisoformat(v) if tipo == "fechaHora" or "T" in v else date.fromisoformat(v)
            except ValueError:
                return v
        if isinstance(v, datetime):
            if not (cat.SIN_FECHA_VIEJA < v < cat.SIN_FECHA_NUEVA):
                return None
            return v.date().isoformat() if tipo == "fecha" else v.replace(microsecond=0).isoformat()
        if isinstance(v, date):
            return v.isoformat() if tipo == "fecha" else datetime.combine(v, time.min).isoformat()
        return str(v)
    if tipo in ("entero", "id"):
        return int(round(v)) if isinstance(v, (int, float)) else v
    if tipo in ("numero", "porcentaje"):
        if isinstance(v, (int, float)):
            return round(float(v), 6 if decimales is None else max(decimales, 2) + 2)
        return v
    if tipo == "booleano":
        return bool(v)
    return v if isinstance(v, str) else str(v)


def _meta(clave: str, nombre: str, tipo: str, decimales: Optional[int], totaliza: bool = False) -> dict:
    return {"clave": clave, "nombre": nombre, "tipo": tipo, "decimales": decimales,
            "totaliza": totaliza}


async def _opciones_de_tabla(db, lista: str, ids: Optional[list] = None) -> list[dict]:
    col_id, col_nombre = OPCIONES_DE_TABLA[lista]
    if lista == "personas":
        nombre = func.trim(Operario.nombre + " " + Operario.apellido)
    else:
        nombre = col_nombre
    q = select(col_id, nombre.label("texto"))
    if ids is not None:
        q = q.where(col_id.in_(ids))
    q = q.order_by(nombre).limit(TOPE_OPCIONES)
    return [{"valor": r[0], "texto": (r[1] or "").strip() or f"#{r[0]}"}
            for r in (await db.execute(q)).all()]


def _fecha_ar(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _numero_ar(n: float) -> str:
    texto = f"{n:,.2f}".rstrip("0").rstrip(".")
    return texto.replace(",", "§").replace(".", ",").replace("§", ".")


async def criterios(db, plan: Plan) -> dict:
    """Lo que el reporte tiene puesto, dicho en castellano: va arriba del PDF, en la hoja
    «Datos del reporte» del Excel y en la pantalla. Los clientes, personas y máquinas de
    un filtro se nombran (el pedido trae sus números)."""
    lineas = [f"Datos: {plan.fuente.nombre}"]
    periodo_texto = None
    p = plan.periodo
    if p:
        rango = f"del {_fecha_ar(p.desde)} al {_fecha_ar(p.hasta)}"
        cuando = f"{ATAJOS[p.atajo].lower()} ({rango})" if p.atajo else rango
        if p.columna is not None:
            periodo_texto = f"Período: {cuando}, según {p.columna.nombre.lower()}"
        else:
            periodo_texto = f"Período: {cuando}. {plan.fuente.periodo_interno}"
        lineas.append(periodo_texto)
    elif plan.fuente.periodo or plan.fuente.periodo_interno:
        lineas.append("Período: todas las fechas")

    for f in plan.filtros:
        col = f.columna
        if f.op == "en":
            if col.opciones in OPCIONES_FIJAS:
                nombres = {k: v for k, v in OPCIONES_FIJAS[col.opciones].items()}
            else:
                ids = [v for v in f.valores if v is not None]
                nombres = {o["valor"]: o["texto"] for o in await _opciones_de_tabla(db, col.opciones, ids)}
            textos = [nombres.get(v, f"#{v}") if v is not None else "(sin dato)" for v in f.valores]
            lineas.append(f"{col.nombre}: {', '.join(textos)}")
        elif f.op == "contiene":
            lineas.append(f"{col.nombre} contiene «{f.valor}»")
        elif f.op == "es":
            lineas.append(f"{col.nombre}: {'Sí' if f.valor else 'No'}")
        else:
            fmt = _fecha_ar if col.tipo in FECHAS else _numero_ar
            if f.desde is not None and f.hasta is not None:
                lineas.append(f"{col.nombre}: de {fmt(f.desde)} a {fmt(f.hasta)}")
            elif f.desde is not None:
                lineas.append(f"{col.nombre}: desde {fmt(f.desde)}")
            else:
                lineas.append(f"{col.nombre}: hasta {fmt(f.hasta)}")

    agrupacion_texto = None
    if plan.agrupado:
        agrupacion_texto = ("Agrupado por " + " y ".join(c.nombre for c in plan.agrupar)
                            + " · Cuentas: " + ", ".join(m.nombre for m in plan.medidas))
        lineas.append(agrupacion_texto)
        if plan.orden_por.startswith("m") and plan.orden_por[1:].isdigit():
            orden_nombre = plan.medidas[int(plan.orden_por[1:])].nombre
        else:
            orden_nombre = plan.fuente.columna(plan.orden_por).nombre
    else:
        orden_nombre = plan.fuente.columna(plan.orden_por).nombre
    lineas.append(f"Ordenado por {orden_nombre} ({'de mayor a menor' if plan.orden_desc else 'de menor a mayor'})")
    return {"lineas": lineas, "periodo": periodo_texto, "agrupacion": agrupacion_texto}


async def ejecutar(db, crudo: Any, permisos: PermisosUsuario, vista_previa: bool = False) -> dict:
    """Corre el reporte. `vista_previa`: las primeras 50 filas (los totales son de todo)."""
    ahora = ahora_ar()
    plan = validar(crudo, permisos, ahora.date())
    ctx = Contexto(ahora=ahora)
    if plan.periodo and plan.periodo.columna is None:
        ctx.desde, ctx.hasta = plan.periodo.desde, plan.periodo.hasta

    limite = FILAS_VISTA_PREVIA if vista_previa else TOPE_FILAS
    resultado = await _correr(db, armar_consultas(plan, ctx, permisos, limite))
    cuenta = resultado["cuenta"]
    total_filas = int(cuenta["filas"] or 0)

    if not plan.agrupado:
        columnas = [_meta(c.codigo, c.nombre, c.tipo, c.decimales, c.totaliza) for c in plan.columnas]
        filas = [
            {c.codigo: _valor(c.tipo, r[_etiqueta(c.codigo)], c.etiquetas, c.decimales)
             for c in plan.columnas}
            for r in resultado["filas"]
        ]
        totales = {c.codigo: _valor("entero" if c.tipo in ("entero", "id") else "numero",
                                    cuenta[_etiqueta(c.codigo)], None, c.decimales)
                   for c in plan.columnas if c.totaliza}
        total = total_filas
        total_grupos = None
    else:
        columnas = [_meta(c.codigo, c.nombre, c.tipo, c.decimales) for c in plan.agrupar]
        columnas += [_meta(f"m{i}", m.nombre, m.tipo, m.decimales, totaliza=True)
                     for i, m in enumerate(plan.medidas)]
        filas = []
        for r in resultado["filas"]:
            fila = {c.codigo: _valor(c.tipo, r[_etiqueta(c.codigo)], c.etiquetas, c.decimales)
                    for c in plan.agrupar}
            for i, m in enumerate(plan.medidas):
                fila[f"m{i}"] = _valor(m.tipo, r[f"m{i}"], None, m.decimales)
            filas.append(fila)
        totales = {f"m{i}": _valor(m.tipo, cuenta[f"m{i}"], None, m.decimales)
                   for i, m in enumerate(plan.medidas)}
        total_grupos = int(resultado["grupos"])
        total = total_grupos

    recortado = total > len(filas)
    aviso = None
    if recortado and not vista_previa:
        que = "grupos" if plan.agrupado else "filas"
        aviso = (f"Hay {total:,} {que} y el archivo trae las primeras {len(filas):,}: es el tope "
                 f"de un reporte. Acotá el período o agregá un filtro para ver el resto."
                 ).replace(",", ".")

    return {
        "fuente": plan.fuente.codigo,
        "fuente_nombre": plan.fuente.nombre,
        "modo": "grupos" if plan.agrupado else "filas",
        "columnas": columnas,
        "filas": filas,
        "totales": totales,
        "total_filas": total_filas,
        "total_grupos": total_grupos,
        "recortado": recortado,
        "vista_previa": vista_previa,
        "tope": TOPE_FILAS,
        "aviso": aviso,
        "periodo": ({"desde": plan.periodo.desde.isoformat(), "hasta": plan.periodo.hasta.isoformat(),
                     "atajo": plan.periodo.atajo,
                     "columna": plan.periodo.columna.codigo if plan.periodo.columna else None}
                    if plan.periodo else None),
        "criterios": await criterios(db, plan),
        "generado": ahora.replace(microsecond=0).isoformat(),
    }


# ─────────────────────────── el catálogo, para la pantalla ───────────────────────────


def _columna_para_pantalla(c: Columna) -> dict:
    return {
        "codigo": c.codigo,
        "nombre": c.nombre,
        "tipo": c.tipo,
        "ayuda": c.ayuda or None,
        "filtro": c.filtro,
        "opciones": c.opciones,
        "agrupable": c.agrupable,
        "funciones": list(c.funciones()),
        "totaliza": c.totaliza,
        "decimales": c.decimales,
        "por_defecto": c.por_defecto,
    }


def ejemplo_disponible(ejemplo: dict, permisos: PermisosUsuario) -> bool:
    try:
        validar(ejemplo["config"], permisos)
        return True
    except (BusinessException, ReporteSinPermiso):
        return False


def catalogo(permisos: PermisosUsuario) -> dict:
    """Las fuentes y columnas que ESTA persona puede usar (lo demás no se manda), los
    atajos del período, los topes y los reportes de ejemplo que puede abrir."""
    fuentes = []
    for f in FUENTES:
        if not puede_fuente(f, permisos):
            continue
        columnas = [c for c in f.columnas if puede_columna(c, permisos)]
        fuentes.append({
            "codigo": f.codigo,
            "nombre": f.nombre,
            "descripcion": f.descripcion,
            "icono": f.icono,
            "columnas": [_columna_para_pantalla(c) for c in columnas],
            "periodo": list(f.periodo),
            "periodo_interno": f.periodo_interno,
            "filtros_iniciales": list(f.filtros_iniciales),
            "orden_inicial": list(f.orden_inicial) if f.orden_inicial else None,
            "nota": f.nota or None,
        })
    return {
        "version": 1,
        "fuentes": fuentes,
        "atajos": [{"codigo": k, "nombre": v} for k, v in ATAJOS.items()],
        "funciones": [{"codigo": k, "nombre": v} for k, v in NOMBRE_FUNCION.items()],
        "tope_filas": TOPE_FILAS,
        "filas_vista_previa": FILAS_VISTA_PREVIA,
        "ejemplos": [
            {"codigo": e["codigo"], "nombre": e["nombre"], "descripcion": e["descripcion"],
             "config": {"version": 1, **e["config"]}}
            for e in EJEMPLOS if ejemplo_disponible(e, permisos)
        ],
    }


async def opciones(db, fuente_codigo: str, permisos: PermisosUsuario) -> dict:
    """Los valores para elegir en los filtros de UNA fuente, de las columnas que la
    persona puede ver: {columna: [{valor, texto}]}."""
    fuente = _fuente(fuente_codigo, permisos)
    salida: dict[str, list] = {}
    leidas: dict[str, list] = {}
    for c in fuente.columnas:
        if not c.opciones or not puede_columna(c, permisos):
            continue
        if c.opciones not in leidas:
            if c.opciones in OPCIONES_FIJAS:
                leidas[c.opciones] = [{"valor": k, "texto": v} for k, v in OPCIONES_FIJAS[c.opciones].items()]
            else:
                leidas[c.opciones] = await _opciones_de_tabla(db, c.opciones)
        salida[c.codigo] = leidas[c.opciones]
    return salida
