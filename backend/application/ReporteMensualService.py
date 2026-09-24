"""El reporte mensual (RF-21): producción, eficiencia por persona, consumo de materiales
y uso de maquinaria de un mes, comparado con el mes anterior.

El SRS: «El sistema deberá generar reportes mensuales de producción, eficiencia por
operario, consumo de materiales y uso de maquinaria». Julián lo pidió así: se genera
desde el Dashboard (un botón, se elige el mes) y el envío por mail se configura al final
del proyecto, junto con el de RF-04. Por eso acá hay dos cosas y una sola cuenta:

  · `ReporteMensualService.armar()` — el reporte de un mes, la MISMA respuesta para la
    pantalla, los tres archivos (PDF, Excel, CSV: se arman en el navegador con esto) y
    el mail.
  · `armar_mail_del_reporte()` — ARMA el mail (asunto, HTML, texto y un CSV adjunto),
    sin mandarlo. Cómo se va a disparar: docs/REPORTE_MENSUAL.md y más abajo.

DE DÓNDE SALE CADA NÚMERO (no hay una segunda cuenta de nada)

  Órdenes      las fechas de la OT (estado_ordenes: los centinelas 1950 / 3000 no son
               fechas). Retrasada es la regla del aviso de RF-04 (prometida vencida y sin
               entregar), no la tarjeta «Retrasadas» del Dashboard, que excluye lo que ya
               arrancó: al cierre de un mes lo que importa es qué no salió a tiempo.
  Producción   los tiempos EFECTIVOS de RF-06 (TiempoEfectivo + TiemposOperarioService.
               medir): la jornada del taller menos las pausas (RF-03). Lo mismo que la
               ficha de cada persona, no el tiempo corrido que usa el cuadro «Estimado vs.
               real» del Dashboard.
  Personas     el reporte de rendimiento de cada persona (RF-07,
               RendimientoOperarioService.reporte) con el mes como período.
  Calidad      las no conformidades (RF-12, IncidenciaProcesoRepository.buscar/resumen).
  Materiales   los consumos cargados en la OT (RF-15, consumo_material), sin los anulados.
  Máquinas     las horas de uso de RF-10 (UsoMaquinaService.horas_por_maquina, las
               efectivas) y los mantenimientos registrados en el mes (ver _maquinas).

EL MES

Es el del taller: [día 1 00:00, día 1 del mes siguiente 00:00), hora local de Argentina
sin zona, como todas las fechas de la base. Una OT entregada el 31 a las 23:30 es de ese
mes (en UTC ya sería el 1°: por eso no se usa ningún CURRENT_DATE / now() de la base).
Un mes que no terminó se corta en «ahora» y el reporte lo dice (`parcial`). Un mes que
todavía no empezó no se arma.

QUIÉN VE QUÉ (RF-24)

El endpoint pide el área Dashboard (la política «dashboard» del mapa) y cada parte pide
lo MISMO que pide afuera la pantalla o la tarjeta que la muestra (`alcance_de`). Sin
permiso, esa parte no se lee ni se manda (va en null):

  órdenes, producción        Operaciones (la política «ordenes»)
  ranking de clientes        además Clientes (la tarjeta «Clientes con más órdenes»)
  pausas                     la política «pausas» (Operaciones)
  personas                   la sección CONFIDENCIAL «Rendimiento por persona» — es el
                             reporte de RF-07 de cada uno, con su eficiencia
  ausencias de cada persona  además la política «asistencia» (Recursos u Operaciones):
                             el motivo puede ser una enfermedad (revisión del 23/09)
  calidad                    No conformidades (la tarjeta «Interpretación de planos»)
  materiales                 la política «consumos_material» (Operaciones)
  máquinas                   la política «maquinas_uso» (Recursos › Recurso maquinaria),
                             la de la solapa Uso y mantenimiento de RF-10

Las horas POR PERSONA van en «Personas» y no en «Producción» a propósito: son de la
misma cuenta que la eficiencia de cada uno y ponen un número al lado de un nombre.
Producción muestra horas por proceso y por OT, que no nombran a nadie.

EL MAIL (preparado, NO activado)

`armar_mail_del_reporte(reporte, para=..., url_app=...)` devuelve el mail listo (asunto,
HTML con el resumen, texto plano, el CSV del reporte adjunto y el link a la pantalla,
donde están el PDF y el Excel) y `enviado: False`. No manda nada, no programa nada.
`preparar_mails_del_mes(db, anio, mes)` arma el del mes anterior para los destinatarios
por defecto (los usuarios admin activos con mail): UN mail por destinatario, cada uno con
una sola dirección en «Para», como manda la regla de infrastructure/notifications/email.py
(nadie ve la dirección de los demás: la lista de usuarios con su email es confidencial). Cuando se configure el envío junto con
RF-04, el plan es (docs/REPORTE_MENSUAL.md tiene el detalle y el código del endpoint):

  Cloud Scheduler, el 1° de cada mes a las 07:00 (America/Argentina/Buenos_Aires)
    → POST {backend}/internal/reporte-mensual con el header x-sync-token (SYNC_TOKEN,
      el mismo patrón que /internal/alertas)
    → preparar_mails_del_mes(db, mes anterior) → Resend (RESEND_API_KEY, FROM_EMAIL).

A QUIÉN LE LLEGA es una decisión de Lucas (PENDIENTE): hoy todos los usuarios son admin,
así que «los admin» son todos y su reporte trae todo. Si se le pasa una lista `para` a
mano, el reporte sale SIN las partes de la sección confidencial «Rendimiento por persona»
(personas, sus ausencias y la calidad agrupada por persona), porque no se sabe con qué
permisos cuenta cada dirección. Cuando se decida, armar uno por destinatario con
alcance_de(sus permisos).
"""
from __future__ import annotations

import csv
import html
import io
from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from fastapi.encoders import jsonable_encoder
from sqlalchemy import and_, distinct, func, or_, select

from backend.application.IncidenciaProcesoService import GRAVEDADES, TIPOS
from backend.application.RendimientoOperarioService import RendimientoOperarioService
from backend.application.TiempoEfectivo import (
    interseccion,
    jornada_en_palabras,
    minutos,
    tramos_de_jornada,
)
from backend.application.TiemposOperarioService import (
    TiemposOperarioService,
    abierto_de_mas,
    dato_roto,
    trabajado_en,
)
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from backend.domain.Articulo import Articulo
from backend.domain.AusenciaOperario import AusenciaOperario
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import MOTIVO_TEXTO as MOTIVO_PAUSA_TEXTO
from backend.domain.PausaOrden import PausaOrden
from backend.domain.Pieza import Pieza
from backend.domain.Planificacion import Planificacion
from backend.domain.Proceso import Proceso
from backend.infrastructure.IncidenciaProcesoRepository import IncidenciaProcesoRepository
from backend.infrastructure.estado_ordenes import (
    SIN_FECHA_NUEVA,
    SIN_FECHA_VIEJA,
    ahora_ar,
    es_fecha_real,
    leer_fecha,
)

MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre")

# El primer mes que se puede pedir. Antes no hay datos de SPMM (la base es de 2026) y un
# año mal tipeado (2062, 1026) se ataja acá en vez de armar un reporte vacío.
PRIMER_ANIO = 2020

# Cuántas OT van en «las que más horas llevaron» y cuántos clientes en el ranking.
TOPE_OT = 10
TOPE_CLIENTES = 5

# Las listas de detalle (entregadas, atrasadas, no conformidades, consumos) van enteras
# hasta este tope; si se pasa, se recorta y se avisa. Un mes del taller son decenas.
TOPE_FILAS = 1000

# Desde el 22/09/2026 las no conformidades se registran en hora del taller; las de antes
# quedaron en UTC (domain/IncidenciaProceso.py: reescribirlas es tocar dato del cliente).
NC_EN_HORA_LOCAL_DESDE = datetime(2026, 9, 22)

# La hora del centinela: lo de antes de esto no es un arranque (el viejo pone 1900/1950).
_CENTINELA = datetime(1950, 1, 2)


# ─────────────────────────── el mes ───────────────────────────


def nombre_del_mes(anio: int, mes: int) -> str:
    """«agosto de 2026»."""
    return f"{MESES[mes - 1]} de {anio}"


def mes_anterior(anio: int, mes: int) -> tuple[int, int]:
    return (anio - 1, 12) if mes == 1 else (anio, mes - 1)


def mes_por_defecto(ahora: datetime) -> tuple[int, int]:
    """El mes que se abre si no se elige ninguno: el anterior, que es el que ya cerró."""
    return mes_anterior(ahora.year, ahora.month)


def limites_del_mes(anio: int, mes: int) -> tuple[datetime, datetime]:
    """[día 1 00:00, día 1 del mes siguiente 00:00), hora del taller."""
    ini = datetime(anio, mes, 1)
    sig_anio, sig_mes = (anio + 1, 1) if mes == 12 else (anio, mes + 1)
    return ini, datetime(sig_anio, sig_mes, 1)


def validar_mes(anio, mes, ahora: datetime) -> tuple[int, int]:
    """El mes pedido, como enteros. BusinessException (422) si no es un mes o si todavía
    no empezó."""
    try:
        anio, mes = int(anio), int(mes)
    except (TypeError, ValueError):
        raise BusinessException("El mes se pide con año y mes en números (por ejemplo 2026 y 8).")
    if not 1 <= mes <= 12:
        raise BusinessException("El mes tiene que ser un número del 1 al 12.")
    if anio < PRIMER_ANIO:
        raise BusinessException(f"No hay datos de SPMM antes de {PRIMER_ANIO}: revisá el año.")
    if (anio, mes) > (ahora.year, ahora.month):
        raise BusinessException(f"{nombre_del_mes(anio, mes).capitalize()} todavía no empezó.")
    return anio, mes


@dataclass(frozen=True)
class Mes:
    """Un mes y dónde se corta: al final, o en «ahora» si todavía no terminó."""

    anio: int
    mes: int
    ini: datetime
    fin: datetime
    corte: datetime        # min(fin, ahora)
    parcial: bool          # el mes no terminó: los números son hasta `corte`
    ahora: datetime

    @classmethod
    def de(cls, anio: int, mes: int, ahora: datetime) -> "Mes":
        ini, fin = limites_del_mes(anio, mes)
        return cls(anio, mes, ini, fin, min(fin, ahora), ahora < fin, ahora)

    @property
    def dia_de_corte(self) -> datetime:
        """El «hoy 00:00» del cierre: lo prometido ANTES de esto y no entregado está
        atrasado. Para un mes cerrado es el 1° del mes siguiente (lo prometido hasta el
        31 inclusive); para el mes en curso, hoy (una OT prometida para hoy todavía no
        está atrasada, como en el tablero)."""
        if not self.parcial:
            return self.fin
        return self.ahora.replace(hour=0, minute=0, second=0, microsecond=0)

    @property
    def ultimo_dia(self) -> date:
        return (self.fin - timedelta(days=1)).date()

    def como_dict(self) -> dict:
        return {
            "anio": self.anio,
            "mes": self.mes,
            "titulo": nombre_del_mes(self.anio, self.mes),
            "desde": self.ini.date().isoformat(),
            "hasta": self.ultimo_dia.isoformat(),
            "dias": monthrange(self.anio, self.mes)[1],
            "parcial": self.parcial,
            "corte": self.corte,
        }


# ─────────────────────────── quién ve qué ───────────────────────────


@dataclass(frozen=True)
class Alcance:
    """Qué partes del reporte puede ver quien lo pide. Ver «QUIÉN VE QUÉ» arriba."""

    ordenes: bool = False
    clientes: bool = False
    produccion: bool = False
    pausas: bool = False
    personas: bool = False
    ausencias: bool = False
    calidad: bool = False
    materiales: bool = False
    maquinas: bool = False

    @classmethod
    def todo(cls) -> "Alcance":
        """El de un admin (y el del mail a los admin)."""
        return cls(**{k: True for k in cls.__dataclass_fields__})

    @property
    def algo(self) -> bool:
        return any(getattr(self, k) for k in self.__dataclass_fields__)

    def como_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


def alcance_de(permisos) -> Alcance:
    """El alcance de un PermisosUsuario, con los MISMOS requisitos del mapa
    (core/permisos_rutas.py): si mañana cambia lo que pide una pantalla, cambia acá solo.
    Sin permisos (None) no se ve nada: un permiso que no se pudo leer no abre nada."""
    if permisos is None:
        return Alcance()
    if getattr(permisos, "es_admin", False):
        return Alcance.todo()
    from backend.core.permisos_rutas import POLITICAS, TARJETAS_DASHBOARD, permite

    def puede(requisitos) -> bool:
        try:
            return bool(permite(tuple(requisitos), permisos, {}))
        except Exception:
            return False

    tarjeta = {t.codigo: t.requisito for t in TARJETAS_DASHBOARD}
    ordenes = puede(POLITICAS["ordenes"].leer)
    personas = puede(POLITICAS["rendimiento_operario"].leer)
    return Alcance(
        ordenes=ordenes,
        clientes=ordenes and puede((tarjeta["top_clientes"],)),
        produccion=ordenes,
        pausas=ordenes and puede(POLITICAS["pausas"].leer),
        personas=personas,
        ausencias=personas and puede(POLITICAS["asistencia"].leer),
        calidad=puede((tarjeta["incidencias_planos"],)),
        materiales=puede(POLITICAS["consumos_material"].leer),
        # Las horas de uso y los mantenimientos de cada máquina: lo mismo que pide su
        # pantalla, la solapa Recurso maquinaria (la política «maquinas_uso» de RF-10).
        maquinas=puede(POLITICAS["maquinas_uso"].leer),
    )


# ─────────────────────────── cuentas puras ───────────────────────────


def _dia(valor) -> Optional[date]:
    f = leer_fecha(valor)
    return f.date() if f else None


def desvio_pct(estimado: int | None, real: int | None) -> Optional[float]:
    """(real − estimado) ÷ estimado, en %. Positivo = llevó MÁS de lo estimado. Es la
    misma fórmula del cuadro «Estimado vs. real» del Dashboard. None sin estimado."""
    if not estimado or estimado <= 0 or real is None:
        return None
    return round(100 * (real - estimado) / estimado, 1)


def pct(parte: int, total: int) -> Optional[float]:
    return round(100 * parte / total, 1) if total else None


def _numero_ot(id_ot, id_otvieja) -> int:
    """El N° con el que el taller conoce la OT (id_otvieja); si no tiene, la clave."""
    return id_otvieja or id_ot


def _unidad(u) -> str:
    return (u or "").strip().upper()


# ─────────────────────────── el servicio ───────────────────────────


class ReporteMensualService:
    def __init__(self, db_session):
        self.db = db_session
        self.tiempos = TiemposOperarioService(db_session)
        # El reporte de cada persona (RF-07) se pide DOS veces por persona: este mes y el
        # anterior. Lo pesado de cada pedido es juntar sus pasos de toda la historia (sus
        # elegidos y el plan entero de sus OT), que es lo mismo para los dos meses: se lee
        # una vez por persona y se reusa. La cuenta sigue siendo la de RF-07, sin tocarla.
        self.rendimiento = RendimientoOperarioService(db_session)
        leer_pasos = self.rendimiento.tiempos.pasos_atribuidos
        ya_leidos: dict[int, list[dict]] = {}

        async def pasos_atribuidos(id_operario: int) -> list[dict]:
            if id_operario not in ya_leidos:
                ya_leidos[id_operario] = await leer_pasos(id_operario)
            return ya_leidos[id_operario]

        self.rendimiento.tiempos.pasos_atribuidos = pasos_atribuidos

    async def armar(self, anio, mes, alcance: Alcance, *, ahora: datetime | None = None) -> dict:
        """El reporte de `anio`/`mes` con lo que `alcance` deja ver, y la comparación con
        el mes anterior. Una sección que no se puede ver va en None."""
        ahora = ahora or ahora_ar()
        anio, mes = validar_mes(anio, mes, ahora)
        actual = Mes.de(anio, mes, ahora)
        a_anio, a_mes = mes_anterior(anio, mes)
        anterior = Mes.de(a_anio, a_mes, ahora)

        avisos: list[str] = []
        if actual.parcial:
            avisos.append(
                f"{nombre_del_mes(anio, mes).capitalize()} todavía no terminó: los números "
                "son hasta ahora y el mes anterior está completo.")

        datos: dict = {
            "anio": anio,
            "mes": mes,
            "titulo": nombre_del_mes(anio, mes),
            "periodo": actual.como_dict(),
            "anterior": anterior.como_dict(),
            "generado": ahora,
            "jornada": jornada_en_palabras(),
            "alcance": alcance.como_dict(),
            "ordenes": None,
            "produccion": None,
            "personas": None,
            "calidad": None,
            "materiales": None,
            "maquinas": None,
        }

        # Los pasos de los dos meses se leen una vez: los usan producción y personas.
        pasos_actual = pasos_anterior = None
        if alcance.produccion or alcance.personas:
            pasos_actual = await self._pasos_del_mes(actual)
            pasos_anterior = await self._pasos_del_mes(anterior)

        if alcance.ordenes:
            datos["ordenes"] = await self._ordenes(actual, anterior, alcance)
            sin_fecha = await self._finalizadas_sin_entrega()
            if sin_fecha:
                avisos.append(
                    (f"{sin_fecha} OT figura finalizada sin fecha de entrega: no se sabe en qué "
                     "mes salió y no cuenta como entregada en ningún mes (tampoco como abierta).")
                    if sin_fecha == 1 else
                    (f"{sin_fecha} OT figuran finalizadas sin fecha de entrega: no se sabe en qué "
                     "mes salieron y no cuentan como entregadas en ningún mes (tampoco como abiertas)."))
        if alcance.produccion:
            datos["produccion"] = await self._produccion(actual, anterior, pasos_actual,
                                                         pasos_anterior, alcance)
        if alcance.personas:
            datos["personas"] = await self._personas(actual, anterior, pasos_actual,
                                                     pasos_anterior, alcance)
        if alcance.calidad:
            datos["calidad"] = await self._calidad(actual, anterior, alcance)
            if actual.ini < NC_EN_HORA_LOCAL_DESDE:
                avisos.append(
                    "Las no conformidades cargadas antes del 22/09/2026 quedaron guardadas con "
                    "la hora de Greenwich (3 horas adelante): las de las últimas horas del "
                    "último día pueden figurar en el mes siguiente.")
        if alcance.materiales:
            datos["materiales"] = await self._materiales(actual, anterior)
        if alcance.maquinas:
            datos["maquinas"] = await self._maquinas(actual, anterior)

        datos["avisos"] = avisos
        datos["como_se_cuenta"] = como_se_cuenta(datos)
        return jsonable_encoder(datos)

    # ─────────────────────────── Órdenes ───────────────────────────

    async def _ordenes(self, actual: Mes, anterior: Mes, alcance: Alcance) -> dict:
        esta = await self._ordenes_del_mes(actual, alcance, detalle=True)
        antes = await self._ordenes_del_mes(anterior, alcance, detalle=False)
        esta["anterior"] = antes["resumen"]
        return esta

    async def _ordenes_del_mes(self, m: Mes, alcance: Alcance, detalle: bool) -> dict:
        ot, cli, art = OrdenTrabajo, Cliente, Articulo
        base = (
            select(ot.id, ot.id_otvieja, ot.id_cliente, ot.fecha_entrada, ot.fecha_prometida,
                   ot.fecha_entrega, cli.nombre.label("cliente"),
                   art.descripcion.label("articulo"))
            .select_from(ot)
            .outerjoin(cli, cli.id == ot.id_cliente)
            .outerjoin(art, art.id == ot.id_articulo)
        )

        # Ingresadas: la fecha de ingreso a planta cae en el mes. Los centinelas (1950,
        # 3000) nunca caen adentro de un mes, así que no hace falta filtrarlos aparte.
        ingresadas = (await self.db.execute(
            base.where(ot.fecha_entrada >= m.ini, ot.fecha_entrada < m.corte)
        )).all()

        # Entregadas: la entrega REAL cae en el mes.
        entregadas = (await self.db.execute(
            base.where(ot.fecha_entrega >= m.ini, ot.fecha_entrega < m.corte)
                .order_by(ot.fecha_entrega, ot.id)
        )).all()

        # Abiertas al cierre: ya habían entrado y todavía no habían salido. Una
        # finalizada SIN fecha de entrega no se sabe cuándo salió: no se cuenta abierta
        # (sería abierta en todos los meses de la historia) y el reporte lo avisa.
        sin_entrega_real = or_(
            ot.fecha_entrega.is_(None),
            ot.fecha_entrega <= SIN_FECHA_VIEJA,
            ot.fecha_entrega >= SIN_FECHA_NUEVA,
        )
        abiertas = (await self.db.execute(
            base.where(
                ot.fecha_entrada < m.corte,
                or_(
                    and_(sin_entrega_real, func.coalesce(ot.finalizadototal, 0) != 1),
                    and_(ot.fecha_entrega >= m.corte, ot.fecha_entrega < SIN_FECHA_NUEVA),
                ),
            ).order_by(ot.fecha_prometida, ot.id)
        )).all()

        filas_entregadas = []
        a_tiempo = con_atraso = sin_prometida = 0
        dias_atraso: list[int] = []
        for r in entregadas:
            entrega, prometida = _dia(r.fecha_entrega), _dia(r.fecha_prometida)
            if not es_fecha_real(r.fecha_prometida):
                sin_prometida += 1
                atraso = None
            else:
                atraso = max(0, (entrega - prometida).days)
                if entrega <= prometida:
                    a_tiempo += 1
                else:
                    con_atraso += 1
                    dias_atraso.append(atraso)
            filas_entregadas.append({
                "id": r.id,
                "numero": _numero_ot(r.id, r.id_otvieja),
                "cliente": r.cliente or "Sin cliente",
                "articulo": r.articulo or "Sin artículo",
                "fecha_prometida": prometida if es_fecha_real(r.fecha_prometida) else None,
                "fecha_entrega": r.fecha_entrega,
                "a_tiempo": None if atraso is None else atraso == 0,
                "dias_atraso": atraso,
            })

        corte_dia = m.dia_de_corte
        filas_atrasadas = []
        for r in abiertas:
            if es_fecha_real(r.fecha_prometida) and leer_fecha(r.fecha_prometida) < corte_dia:
                filas_atrasadas.append({
                    "id": r.id,
                    "numero": _numero_ot(r.id, r.id_otvieja),
                    "cliente": r.cliente or "Sin cliente",
                    "articulo": r.articulo or "Sin artículo",
                    "fecha_prometida": _dia(r.fecha_prometida),
                    "dias_atraso": (corte_dia.date() - _dia(r.fecha_prometida)).days,
                })
        filas_atrasadas.sort(key=lambda f: (-f["dias_atraso"], f["numero"]))

        comparables = a_tiempo + con_atraso
        resumen = {
            "ingresadas": len(ingresadas),
            "entregadas": len(entregadas),
            "a_tiempo": a_tiempo,
            "con_atraso": con_atraso,
            "sin_fecha_prometida": sin_prometida,
            "pct_a_tiempo": pct(a_tiempo, comparables),
            "dias_atraso_promedio": (round(sum(dias_atraso) / len(dias_atraso), 1)
                                     if dias_atraso else None),
            "abiertas_al_cierre": len(abiertas),
            "atrasadas_al_cierre": len(filas_atrasadas),
        }
        salida = {"resumen": resumen}
        if not detalle:
            return salida

        top = None
        if alcance.clientes:
            por_cliente: dict = defaultdict(lambda: {"ingresadas": 0, "entregadas": 0})
            for r in ingresadas:
                por_cliente[(r.id_cliente, r.cliente or "Sin cliente")]["ingresadas"] += 1
            for r in entregadas:
                por_cliente[(r.id_cliente, r.cliente or "Sin cliente")]["entregadas"] += 1
            top = sorted(
                ({"cliente": nombre, "ingresadas": v["ingresadas"], "entregadas": v["entregadas"]}
                 for (_, nombre), v in por_cliente.items()),
                key=lambda f: (-f["ingresadas"], -f["entregadas"], f["cliente"]),
            )[:TOPE_CLIENTES]

        salida.update({
            "entregadas": filas_entregadas[:TOPE_FILAS],
            "atrasadas": filas_atrasadas[:TOPE_FILAS],
            "recortado": len(filas_entregadas) > TOPE_FILAS or len(filas_atrasadas) > TOPE_FILAS,
            "top_clientes": top,
        })
        return salida

    async def _finalizadas_sin_entrega(self) -> int:
        ot = OrdenTrabajo
        return int(await self.db.scalar(
            select(func.count()).select_from(ot).where(
                func.coalesce(ot.finalizadototal, 0) == 1,
                or_(ot.fecha_entrega.is_(None), ot.fecha_entrega <= SIN_FECHA_VIEJA,
                    ot.fecha_entrega >= SIN_FECHA_NUEVA),
            )
        ) or 0)

    # ─────────────────────────── Producción ───────────────────────────

    async def _pasos_del_mes(self, m: Mes) -> list[dict]:
        """Los pasos que se trabajaron en el mes (la misma regla que la ficha de cada
        persona, RF-06/07): arrancaron antes de que termine y no terminaron antes de que
        empiece; uno con el dato roto, sólo en el mes en que arrancó."""
        otp = OrdenTrabajoProceso
        filas = (await self.db.execute(
            select(
                otp.id.label("id_otp"),
                otp.id_orden_trabajo,
                otp.id_proceso,
                otp.orden.label("paso"),
                otp.id_estado,
                otp.tiempo_proceso,
                otp.cant_operarios,
                otp.id_operario.label("id_operario_elegido"),
                otp.inicio_real,
                otp.fin_real,
                Proceso.nombre.label("proceso"),
                OrdenTrabajo.id_otvieja,
                Articulo.descripcion.label("articulo"),
                Cliente.nombre.label("cliente"),
            )
            .join(OrdenTrabajo, OrdenTrabajo.id == otp.id_orden_trabajo)
            .outerjoin(Proceso, Proceso.id == otp.id_proceso)
            .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
            .outerjoin(Cliente, Cliente.id == OrdenTrabajo.id_cliente)
            .where(otp.inicio_real.is_not(None), otp.inicio_real > _CENTINELA,
                   otp.inicio_real < m.corte)
            .where(or_(otp.fin_real.is_(None), otp.fin_real < _CENTINELA,
                       otp.fin_real >= m.ini))
        )).all()
        pasos = []
        for f in filas:
            p = dict(f._mapping)
            if dato_roto(p):
                if m.ini <= p["inicio_real"] < m.corte:
                    pasos.append(p)
            elif trabajado_en(p, m.ini, m.corte, m.ahora):
                pasos.append(p)
        return pasos

    async def _produccion(self, actual: Mes, anterior: Mes, pasos_actual, pasos_anterior,
                          alcance: Alcance) -> dict:
        esta = await self._produccion_del_mes(actual, pasos_actual, alcance, detalle=True)
        antes = await self._produccion_del_mes(anterior, pasos_anterior, alcance, detalle=False)
        esta["anterior"] = antes["resumen"]
        return esta

    async def _produccion_del_mes(self, m: Mes, pasos: list[dict], alcance: Alcance,
                                  detalle: bool) -> dict:
        pausas_por_ot, pausas_disponibles, feriados = await self.tiempos.pausas_y_feriados(pasos)
        cerrados = await self.tiempos.cerrados(pasos)
        periodo = [(m.ini, m.corte)]

        def vacio():
            return {"horas_min": 0, "pasos_trabajados": 0, "pasos_terminados": 0,
                    "estimado_min": 0, "real_min": 0, "comparados": 0, "sin_estimado": 0,
                    "sin_datos": 0}

        por_proceso: dict = defaultdict(vacio)
        por_ot: dict = defaultdict(vacio)
        nombres_proceso: dict = {}
        datos_ot: dict = {}
        abiertos = {"pasos": 0, "minutos": 0}

        for p in pasos:
            t, tramos, _ = self.tiempos.medir(p, pausas_por_ot, cerrados, ahora=m.ahora,
                                              feriados=feriados)
            clave_proc = p["id_proceso"]
            nombres_proceso[clave_proc] = p["proceso"] or "Proceso sin nombre"
            datos_ot[p["id_orden_trabajo"]] = p
            destinos = (por_proceso[clave_proc], por_ot[p["id_orden_trabajo"]])
            for d in destinos:
                d["pasos_trabajados"] += 1
            if t is None:
                for d in destinos:
                    d["sin_datos"] += 1
                continue
            en_mes = minutos(interseccion(tramos.efectivos, periodo))
            if abierto_de_mas(p, t):
                abiertos["pasos"] += 1
                abiertos["minutos"] += en_mes
            else:
                for d in destinos:
                    d["horas_min"] += en_mes

            fin = leer_fecha(p["fin_real"])
            terminado = (p["id_estado"] == 3 and fin is not None and fin >= _CENTINELA
                         and m.ini <= fin < m.corte)
            if not terminado:
                continue
            for d in destinos:
                d["pasos_terminados"] += 1
            if (p["tiempo_proceso"] or 0) <= 0:
                for d in destinos:
                    d["sin_estimado"] += 1
            elif t.efectivo > 0:
                for d in destinos:
                    d["estimado_min"] += p["tiempo_proceso"]
                    d["real_min"] += t.efectivo
                    d["comparados"] += 1

        def con_desvio(d: dict) -> dict:
            return {**d, "desvio_pct": desvio_pct(d["estimado_min"], d["real_min"])}

        total = vacio()
        for d in por_proceso.values():
            for k in total:
                total[k] += d[k]

        pausas = await self._pausas_del_mes(m, feriados) if alcance.pausas else None

        resumen = {
            **con_desvio(total),
            "abiertos_de_mas": abiertos,
            "pausas_min": pausas["minutos"] if pausas and pausas["disponibles"] else None,
            "pausas_cantidad": pausas["cantidad"] if pausas and pausas["disponibles"] else None,
        }
        salida = {"resumen": resumen}
        if not detalle:
            return salida

        filas_proceso = sorted(
            ({"id_proceso": k, "proceso": nombres_proceso[k], **con_desvio(d)}
             for k, d in por_proceso.items()),
            key=lambda f: (-f["horas_min"], f["proceso"]),
        )
        filas_ot = sorted(
            ({"id": k,
              "numero": _numero_ot(k, datos_ot[k]["id_otvieja"]),
              "articulo": datos_ot[k]["articulo"] or "Sin artículo",
              "cliente": datos_ot[k]["cliente"] or "Sin cliente",
              **con_desvio(d)}
             for k, d in por_ot.items()),
            key=lambda f: (-f["horas_min"], f["numero"]),
        )
        salida.update({
            "por_proceso": filas_proceso,
            "top_ot": filas_ot[:TOPE_OT],
            "ots_trabajadas": len(filas_ot),
            "pausas": pausas,
            "pausas_en_los_pasos": pausas_disponibles,
        })
        return salida

    async def _pausas_del_mes(self, m: Mes, feriados) -> dict:
        """Las pausas (RF-03) que estuvieron vigentes en algún momento del mes: cuántas y
        cuánto tiempo de JORNADA cayó adentro del mes, por motivo. Cada pausa por
        separado (una de la OT y una de su paso a la vez suman las dos). Sin la tabla,
        `disponibles: False`."""
        try:
            async with self.db.begin_nested():
                filas = (await self.db.execute(
                    select(PausaOrden.id, PausaOrden.motivo, PausaOrden.desde, PausaOrden.hasta)
                    .where(PausaOrden.desde < m.corte)
                    .where(or_(PausaOrden.hasta.is_(None), PausaOrden.hasta > m.ini))
                )).all()
        except Exception as e:
            logger.warning(f"Reporte mensual: no se pudieron leer las pausas: {e}")
            return {"disponibles": False, "cantidad": 0, "minutos": 0,
                    "iniciadas": 0, "por_motivo": []}

        por_motivo: dict = defaultdict(lambda: {"cantidad": 0, "iniciadas": 0, "minutos": 0})
        for f in filas:
            desde = max(f.desde, m.ini)
            hasta = min(f.hasta or m.ahora, m.corte)
            mins = minutos(tramos_de_jornada(desde, hasta, feriados)) if hasta > desde else 0
            d = por_motivo[f.motivo]
            d["cantidad"] += 1
            d["minutos"] += mins
            if m.ini <= f.desde < m.corte:
                d["iniciadas"] += 1
        filas_motivo = sorted(
            ({"motivo": k, "texto": MOTIVO_PAUSA_TEXTO.get(k, k), **v} for k, v in por_motivo.items()),
            key=lambda x: (-x["minutos"], -x["cantidad"]),
        )
        return {
            "disponibles": True,
            "cantidad": sum(v["cantidad"] for v in por_motivo.values()),
            "iniciadas": sum(v["iniciadas"] for v in por_motivo.values()),
            "minutos": sum(v["minutos"] for v in por_motivo.values()),
            "por_motivo": filas_motivo,
        }

    # ─────────────────────────── Personas ───────────────────────────

    async def _personas(self, actual: Mes, anterior: Mes, pasos_actual, pasos_anterior,
                        alcance: Alcance) -> dict:
        esta = await self._personas_del_mes(actual, pasos_actual, alcance)
        antes = await self._personas_del_mes(anterior, pasos_anterior, alcance)
        esta["anterior"] = antes["resumen"]
        return esta

    async def _candidatos(self, m: Mes, pasos: list[dict], con_ausencias: bool) -> set[int]:
        """Quiénes pueden tener algo en el mes: los elegidos a mano en los pasos del mes,
        los que algún plan nombró en esas OT (la atribución la decide después RF-07, con
        su regla) y los que tuvieron una ausencia en el mes."""
        ids = {p["id_operario_elegido"] for p in pasos if p["id_operario_elegido"] is not None}
        ordenes = sorted({p["id_orden_trabajo"] for p in pasos})
        if ordenes:
            ids |= set((await self.db.execute(
                select(distinct(Planificacion.id_operario))
                .where(Planificacion.orden_id.in_(ordenes), Planificacion.id_operario.is_not(None))
            )).scalars().all())
        if con_ausencias:
            try:
                async with self.db.begin_nested():
                    ids |= set((await self.db.execute(
                        select(distinct(AusenciaOperario.id_operario))
                        .where(AusenciaOperario.desde <= self._hasta_personas(m))
                        .where(or_(AusenciaOperario.vuelve.is_(None),
                                   AusenciaOperario.vuelve > m.ini.date()))
                    )).scalars().all())
            except Exception as e:
                logger.warning(f"Reporte mensual: no se pudieron leer las ausencias: {e}")
        return {i for i in ids if i is not None}

    @staticmethod
    def _hasta_personas(m: Mes) -> date:
        """El último día del período de cada persona: el del mes, o hoy si no terminó
        (unas vacaciones cargadas para la semana que viene no son días de este reporte)."""
        return m.ahora.date() if m.parcial else m.ultimo_dia

    async def _personas_del_mes(self, m: Mes, pasos: list[dict], alcance: Alcance) -> dict:
        svc = self.rendimiento
        desde, hasta = m.ini.date(), self._hasta_personas(m)
        filas = []
        for id_operario in sorted(await self._candidatos(m, pasos, alcance.ausencias)):
            try:
                r = (await svc.reporte(id_operario, desde, hasta)).data
            except NotFoundException:
                continue  # el plan nombra a alguien que ya no está en el catálogo
            res = r["resumen"]
            aus = res.get("ausencias") if alcance.ausencias else None
            dias_aus = (aus or {}).get("dias") or 0
            if not res["tareas_trabajadas"] and not res["horas_trabajadas_min"] and not dias_aus:
                continue  # el plan lo nombró, pero esos pasos no se le cuentan a él
            ef = res["eficiencia"]
            filas.append({
                "id_operario": id_operario,
                "persona": r["persona"],
                "horas_trabajadas_min": res["horas_trabajadas_min"],
                "tareas_trabajadas": res["tareas_trabajadas"],
                "tareas_completadas": res["tareas_completadas"],
                "tiempo_promedio_min": res["tiempo_promedio_min"],
                "eficiencia_pct": ef["pct"],
                "nivel": ef["nivel"],
                "estimado_min": ef["estimado_min"],
                "efectivo_min": ef["efectivo_min"],
                "pausas_min": res["pausas"]["minutos"],
                "ausencias": aus,
            })
        filas.sort(key=lambda f: (-f["horas_trabajadas_min"], f["persona"]))

        estimado = sum(f["estimado_min"] for f in filas)
        efectivo = sum(f["efectivo_min"] for f in filas)
        resumen = {
            "personas": len(filas),
            "horas_trabajadas_min": sum(f["horas_trabajadas_min"] for f in filas),
            "tareas_completadas": sum(f["tareas_completadas"] for f in filas),
            "estimado_min": estimado,
            "efectivo_min": efectivo,
            # Suma de estimados sobre suma de efectivos (como RF-07), no el promedio de
            # los porcentajes: una tarea de 5 minutos no pesa lo que una de 5 horas.
            "eficiencia_pct": int(round(100 * estimado / efectivo)) if estimado and efectivo else None,
            "dias_ausencia": (sum((f["ausencias"] or {}).get("dias") or 0 for f in filas)
                              if alcance.ausencias else None),
            "dias_ausencia_laborables": (sum((f["ausencias"] or {}).get("dias_laborables") or 0
                                             for f in filas) if alcance.ausencias else None),
        }
        return {"resumen": resumen, "filas": filas, "ausencias_visibles": alcance.ausencias}

    # ─────────────────────────── Calidad ───────────────────────────

    async def _calidad(self, actual: Mes, anterior: Mes, alcance: Alcance | None = None) -> dict:
        esta = await self._calidad_del_mes(actual, detalle=True)
        antes = await self._calidad_del_mes(anterior, detalle=False)
        esta["anterior"] = antes["resumen"]
        # Las no conformidades AGRUPADAS por quién hizo las piezas comparan a la gente con
        # nombre y apellido: RF-12 las pide con la sección confidencial «Rendimiento por
        # persona» (/incidencias/por-persona y los rechazos de la ficha de la persona).
        # Acá lo mismo: sin esa sección el agrupado no se manda. La lista sí, porque la
        # lista de No conformidades ya dice quién hizo cada una.
        if alcance is not None and not alcance.personas and "por_persona" in esta:
            esta["por_persona"] = None
        return esta

    async def _calidad_del_mes(self, m: Mes, detalle: bool) -> dict:
        repo = IncidenciaProcesoRepository(self.db)
        try:
            async with self.db.begin_nested():
                resumen = await repo.resumen(desde=m.ini, hasta=m.corte)
                filas = await repo.buscar(desde=m.ini, hasta=m.corte, limite=TOPE_FILAS) if detalle else []
        except Exception as e:
            logger.warning(f"Reporte mensual: no se pudieron leer las no conformidades: {e}")
            return {"disponible": False, "resumen": None}

        salida = {"disponible": True, "resumen": resumen}
        if not detalle:
            return salida

        def agrupar(clave, texto):
            grupos: dict = defaultdict(lambda: {"cantidad": 0, "piezas": 0, "minutos": 0,
                                                "_rech": 0, "_ctrl": 0})
            nombres: dict = {}
            for f in filas:
                k = clave(f)
                nombres[k] = texto(f)
                g = grupos[k]
                g["cantidad"] += 1
                g["piezas"] += f["piezas_afectadas"] or 0
                g["minutos"] += f["minutos_perdidos"] or 0
                # De cuántas controladas (RF-12). Sólo las que dijeron los dos números,
                # como el porcentaje del resumen (IncidenciaProcesoRepository).
                if f.get("piezas_afectadas") is not None and f.get("piezas_controladas") is not None:
                    g["_rech"] += f["piezas_afectadas"] or 0
                    g["_ctrl"] += f["piezas_controladas"] or 0
            salida_ = []
            for k, v in grupos.items():
                rech, ctrl = v.pop("_rech"), v.pop("_ctrl")
                salida_.append({"clave": k, "texto": nombres[k], **v,
                                "porcentaje_rechazo": pct(rech, ctrl)})
            return sorted(salida_, key=lambda x: (-x["cantidad"], -x["piezas"], x["texto"]))

        salida.update({
            "por_tipo": agrupar(lambda f: f["tipo"], lambda f: TIPOS.get(f["tipo"], f["tipo"] or "Sin tipo")),
            "por_gravedad": agrupar(lambda f: f["gravedad"] or "SIN_CLASIFICAR",
                                    lambda f: GRAVEDADES.get(f["gravedad"], "Sin clasificar")),
            "por_persona": agrupar(lambda f: f["id_operario"],
                                   lambda f: f["operario"] or "Sin persona asignada"),
            "lista": [{
                "id": f["id"],
                "numero": f["nro_ot"] or f["id_orden_trabajo"],
                "fecha": f["fecha_registro"],
                "tipo": TIPOS.get(f["tipo"], f["tipo"]),
                "gravedad": GRAVEDADES.get(f["gravedad"], "Sin clasificar"),
                "estado": "Cerrada" if f["estado"] == "CERRADA" else "Abierta",
                "piezas_afectadas": f["piezas_afectadas"],
                "piezas_controladas": f.get("piezas_controladas"),
                "minutos_perdidos": f["minutos_perdidos"],
                "proceso": f["proceso"],
                "paso": f.get("paso"),
                "persona": f["operario"],
                "descripcion": f["descripcion"],
            } for f in filas],
            "recortado": resumen["total"] > len(filas),
        })
        return salida

    # ─────────────────────────── Materiales ───────────────────────────

    async def _materiales(self, actual: Mes, anterior: Mes) -> dict:
        esta = await self._materiales_del_mes(actual, detalle=True)
        antes = await self._materiales_del_mes(anterior, detalle=False)
        esta["anterior"] = antes["resumen"]
        return esta

    async def _materiales_del_mes(self, m: Mes, detalle: bool) -> dict:
        """Lo que se consumió en el mes (RF-15): las cargas NO anuladas cuya fecha cae en
        el mes. No se suman cantidades de unidades distintas: por material y unidad."""
        c = ConsumoMaterial
        try:
            async with self.db.begin_nested():
                filas = (await self.db.execute(
                    select(c.id, c.id_orden_trabajo, c.id_pieza, c.cantidad, c.unidad, c.fecha,
                           Pieza.cod_pieza, Pieza.descripcion,
                           OrdenTrabajo.id_otvieja, Articulo.descripcion.label("articulo"))
                    .select_from(c)
                    .outerjoin(Pieza, Pieza.id == c.id_pieza)
                    .outerjoin(OrdenTrabajo, OrdenTrabajo.id == c.id_orden_trabajo)
                    .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
                    .where(c.fecha >= m.ini, c.fecha < m.corte)
                    .where(func.coalesce(c.anulado, 0) == 0)
                    .order_by(c.fecha, c.id)
                )).all()
        except Exception as e:
            logger.warning(f"Reporte mensual: no se pudieron leer los consumos: {e}")
            return {"disponible": False, "resumen": None}

        resumen = {
            "cargas": len(filas),
            "materiales": len({f.id_pieza for f in filas}),
            "ordenes": len({f.id_orden_trabajo for f in filas}),
        }
        salida = {"disponible": True, "resumen": resumen}
        if not detalle:
            return salida

        por_material: dict = {}
        por_ot: dict = {}
        for f in filas:
            unidad = _unidad(f.unidad)
            km = (f.id_pieza, unidad)
            d = por_material.setdefault(km, {
                "id_pieza": f.id_pieza, "cod_pieza": f.cod_pieza,
                "descripcion": f.descripcion or f"Material {f.id_pieza}",
                "unidad": unidad or None, "cantidad": 0.0, "cargas": 0, "_ordenes": set()})
            d["cantidad"] += float(f.cantidad or 0)
            d["cargas"] += 1
            d["_ordenes"].add(f.id_orden_trabajo)
            ko = (f.id_orden_trabajo, f.id_pieza, unidad)
            o = por_ot.setdefault(ko, {
                "id": f.id_orden_trabajo,
                "numero": _numero_ot(f.id_orden_trabajo, f.id_otvieja),
                "articulo": f.articulo or "Sin artículo",
                "cod_pieza": f.cod_pieza,
                "descripcion": f.descripcion or f"Material {f.id_pieza}",
                "unidad": unidad or None, "cantidad": 0.0, "cargas": 0})
            o["cantidad"] += float(f.cantidad or 0)
            o["cargas"] += 1

        filas_material = []
        for d in por_material.values():
            ordenes = d.pop("_ordenes")
            filas_material.append({**d, "cantidad": round(d["cantidad"], 3), "ordenes": len(ordenes)})
        filas_material.sort(key=lambda x: (-x["cargas"], x["descripcion"]))
        filas_ot = sorted(({**o, "cantidad": round(o["cantidad"], 3)} for o in por_ot.values()),
                          key=lambda x: (x["numero"], x["descripcion"]))
        salida.update({"por_material": filas_material, "por_ot": filas_ot[:TOPE_FILAS],
                       "recortado": len(filas_ot) > TOPE_FILAS})
        return salida

    # ─────────────────────────── Máquinas ───────────────────────────

    async def _maquinas(self, actual: Mes, anterior: Mes) -> dict:
        """Las horas de uso de cada máquina en el mes (RF-10) y los mantenimientos hechos.

        Las horas son las de RF-10 sin una segunda cuenta: UsoMaquinaService.
        horas_por_maquina, que mide cada tramo de `uso_maquina` con la jornada del
        taller menos las pausas (las EFECTIVAS), lo recorta al mes y cuenta una sola vez
        la hora en que la máquina tuvo dos pasos abiertos. Lo que RF-10 dice que no suma
        (fuera de servicio, vuelta a Pendiente, abierto sin cierre o abierto de más) no
        suma tampoco acá. «Tareas» son los tramos que sí sumaron.

        Los mantenimientos son los registrados con «Registrar mantenimiento hecho» cuya
        fecha cae en el mes, y los avisos, los que salieron en el mes (la campanita y el
        mail). Sin las tablas de RF-10 (la migración no se aplicó) la sección sale vacía y
        lo dice, como antes: el resto del reporte no se cae.
        """
        from backend.application.UsoMaquinaService import UsoMaquinaService
        from backend.domain.MantenimientoMaquina import MantenimientoAviso, MantenimientoHecho
        from backend.domain.Maquinaria import Maquinaria

        try:
            async with self.db.begin_nested():
                uso = UsoMaquinaService(self.db)
                horas = await uso.horas_por_maquina(actual.ini, actual.corte, actual.ahora)
                horas_antes = await uso.horas_por_maquina(anterior.ini, anterior.corte, anterior.ahora)
                ids = sorted(set(horas) | set(horas_antes))
                hechos = (await self.db.execute(
                    select(MantenimientoHecho.id, MantenimientoHecho.id_maquinaria,
                           MantenimientoHecho.fecha, MantenimientoHecho.hecho_por,
                           MantenimientoHecho.nota)
                    .where(MantenimientoHecho.fecha >= actual.ini.date(),
                           MantenimientoHecho.fecha < actual.corte.date()
                           + (timedelta(days=1) if actual.parcial else timedelta(0)))
                    .order_by(MantenimientoHecho.fecha, MantenimientoHecho.id)
                )).all()
                hechos_antes = (await self.db.execute(
                    select(func.count(MantenimientoHecho.id))
                    .where(MantenimientoHecho.fecha >= anterior.ini.date(),
                           MantenimientoHecho.fecha < anterior.fin.date())
                )).scalar() or 0
                avisos = (await self.db.execute(
                    select(func.count(MantenimientoAviso.id))
                    .where(MantenimientoAviso.creado_en >= actual.ini,
                           MantenimientoAviso.creado_en < actual.corte)
                )).scalar() or 0
                todas = ids + [h.id_maquinaria for h in hechos]
                nombres = {m.id: m.nombre for m in (await self.db.execute(
                    select(Maquinaria.id, Maquinaria.nombre).where(Maquinaria.id.in_(todas))
                )).all()} if todas else {}
        except Exception as e:
            logger.warning(f"Reporte mensual: no se pudo leer el uso de las máquinas: {e}")
            return {
                "disponible": False,
                "texto": ("No se pudo leer el uso de las máquinas: puede que el servidor todavía "
                          "no tenga el registro de horas (RF-10)."),
                "resumen": None,
                "anterior": None,
                "filas": [],
                "mantenimientos": [],
            }

        def nombre(id_m) -> str:
            return nombres.get(id_m) or f"Máquina {id_m}"

        filas = []
        for id_m in ids:
            h, a = horas.get(id_m) or {}, horas_antes.get(id_m) or {}
            if not h.get("efectivo_min") and not a.get("efectivo_min") and not h.get("pasos"):
                continue
            filas.append({
                "id_maquinaria": id_m,
                "maquina": nombre(id_m),
                "horas_min": int(h.get("efectivo_min") or 0),
                "tareas": int(h.get("pasos") or 0),
                "horas_min_anterior": int(a.get("efectivo_min") or 0),
                "mantenimientos": sum(1 for x in hechos if x.id_maquinaria == id_m),
            })
        filas.sort(key=lambda f: (-f["horas_min"], f["maquina"]))

        def resumen(por_maquina: dict, n_hechos: int) -> dict:
            return {
                "maquinas": sum(1 for v in por_maquina.values() if v.get("efectivo_min")),
                "horas_min": sum(int(v.get("efectivo_min") or 0) for v in por_maquina.values()),
                "mantenimientos": n_hechos,
            }

        return {
            "disponible": True,
            "resumen": {**resumen(horas, len(hechos)), "avisos": int(avisos)},
            "anterior": resumen(horas_antes, int(hechos_antes)),
            "filas": filas,
            "mantenimientos": [{
                "id": x.id,
                "id_maquinaria": x.id_maquinaria,
                "maquina": nombre(x.id_maquinaria),
                "fecha": x.fecha,
                "hecho_por": x.hecho_por,
                "nota": x.nota,
            } for x in hechos],
        }


# ─────────────────────────── cómo se cuenta (pantalla, PDF y mail) ───────────────────────────


def como_se_cuenta(datos: dict) -> list[str]:
    """Las aclaraciones fijas de cada sección que se ve, en castellano. Van al pie de la
    pantalla y del PDF: el papel se lee sin nadie al lado."""
    notas = []
    if datos.get("ordenes") is not None:
        notas.append(
            "Órdenes: ingresada = fecha de ingreso a planta en el mes; entregada = fecha de "
            "entrega real en el mes. A tiempo = entregada el día prometido o antes; los días de "
            "atraso se cuentan por día, no por hora. Abiertas al cierre = habían entrado y no "
            "habían salido al terminar el mes; atrasadas = de ésas, las que tenían la fecha "
            "prometida vencida (la regla del aviso de retraso, que también cuenta las que ya "
            "estaban en proceso).")
    if datos.get("produccion") is not None:
        notas.append(
            f"Producción: horas de trabajo EFECTIVO de los pasos, dentro de la jornada del taller "
            f"({datos.get('jornada')}) y sin las pausas, recortadas al mes. Estimado vs. real "
            "compara el tiempo estimado de la OT con el efectivo de los pasos TERMINADOS en el "
            "mes (el paso entero, aunque haya arrancado antes); desvío positivo = llevó más de lo "
            "estimado. Los pasos «en proceso» que nadie cierra hace más de 5 jornadas no suman "
            "horas y se cuentan aparte.")
    if datos.get("personas") is not None:
        notas.append(
            "Personas: el reporte de rendimiento de cada una (el mismo de su ficha) con el mes "
            "como período. Cada paso se le cuenta a quien lo tiene elegido en la OT o, si no hay, "
            "a quien le dio el último plan: el sistema no registra quién lo hizo de verdad. Por "
            "eso las horas por persona no tienen por qué sumar lo mismo que las horas por proceso: "
            "un paso de dos personas son dos personas trabajando, pero a una persona no se le "
            "cuentan dos veces los pasos que hizo a la vez ni lo que cayó en sus ausencias, así "
            "que también pueden sumar menos que Producción.")
    if datos.get("calidad") is not None:
        notas.append(
            "Calidad: las no conformidades registradas en el mes. «Piezas rechazadas» es lo que se "
            "cargó en cada una (vacío no suma). El % de rechazo sale sólo de las que dicen también "
            "de cuántas piezas controladas: sumar rechazadas de una que no lo dice contra "
            "controladas de otra daría un porcentaje que no es de nada.")
    if datos.get("maquinas") is not None:
        notas.append(
            "Máquinas: horas de uso EFECTIVO de cada máquina (dentro de la jornada y sin las "
            "pausas), recortadas al mes, del registro que se abre al pasar un paso a En proceso y "
            "se cierra al terminarlo. Si una máquina tuvo dos pasos abiertos a la vez, esa hora "
            "cuenta una vez. No suman lo arrancado con la máquina fuera de servicio, lo que volvió "
            "a Pendiente ni lo que quedó abierto sin cierre. Mantenimientos = los registrados con "
            "fecha del mes.")
    if datos.get("materiales") is not None:
        notas.append(
            "Materiales: los consumos cargados en las OT con fecha del mes, sin los anulados. No "
            "se suman cantidades de unidades distintas.")
    return notas


# ─────────────────────────── el CSV del reporte (adjunto del mail) ───────────────────────────


def _hh(minutos_: Optional[int]) -> str:
    """Minutos como horas con dos decimales y coma («12,50»): para el Excel del taller."""
    if minutos_ is None:
        return ""
    return f"{minutos_ / 60:.2f}".replace(".", ",")


def _num(valor) -> str:
    if valor is None:
        return ""
    if isinstance(valor, float):
        return (f"{valor:.3f}".rstrip("0").rstrip(".") or "0").replace(".", ",")
    return str(valor)


def _fecha_ar(valor) -> str:
    f = leer_fecha(valor)
    return f.strftime("%d/%m/%Y") if f else ""


def _neutralizar(texto) -> str:
    """Una celda de texto que Excel podría ejecutar como fórmula sale con un apóstrofo
    adelante (lo mismo que hace la exportación de la pantalla, lib/exportar.ts)."""
    t = "" if texto is None else str(texto)
    return "'" + t if t[:1] in ("=", "+", "-", "@", "\t", "\r") else t


def tablas_del_reporte(r: dict) -> list[tuple[str, list[str], list[list[str]]]]:
    """(título, encabezados, filas) de cada tabla del reporte, ya como texto. Es lo que va
    en el CSV del mail; la pantalla arma los suyos (con números de verdad) en el navegador."""
    tablas = []
    o = r.get("ordenes")
    if o:
        res, ant = o["resumen"], o["anterior"]
        filas = [[k, _num(res[k]), _num(ant[k])] for k in (
            "ingresadas", "entregadas", "a_tiempo", "con_atraso", "sin_fecha_prometida",
            "pct_a_tiempo", "dias_atraso_promedio", "abiertas_al_cierre", "atrasadas_al_cierre")]
        tablas.append(("Órdenes - resumen", ["Indicador", r["titulo"], r["anterior"]["titulo"]], filas))
        tablas.append(("Órdenes entregadas", ["N° OT", "Cliente", "Artículo", "Prometida", "Entregada",
                                              "Días de atraso"],
                       [[_num(f["numero"]), _neutralizar(f["cliente"]), _neutralizar(f["articulo"]),
                         _fecha_ar(f["fecha_prometida"]), _fecha_ar(f["fecha_entrega"]),
                         _num(f["dias_atraso"])] for f in o["entregadas"]]))
        tablas.append(("Órdenes atrasadas al cierre", ["N° OT", "Cliente", "Artículo", "Prometida",
                                                       "Días de atraso"],
                       [[_num(f["numero"]), _neutralizar(f["cliente"]), _neutralizar(f["articulo"]),
                         _fecha_ar(f["fecha_prometida"]), _num(f["dias_atraso"])] for f in o["atrasadas"]]))
        if o.get("top_clientes") is not None:
            tablas.append(("Clientes", ["Cliente", "Ingresadas", "Entregadas"],
                           [[_neutralizar(f["cliente"]), _num(f["ingresadas"]), _num(f["entregadas"])]
                            for f in o["top_clientes"]]))
    p = r.get("produccion")
    if p:
        tablas.append(("Producción por proceso", ["Proceso", "Horas en el mes", "Pasos terminados",
                                                  "Estimado (h)", "Real (h)", "Desvío %"],
                       [[_neutralizar(f["proceso"]), _hh(f["horas_min"]), _num(f["pasos_terminados"]),
                         _hh(f["estimado_min"]), _hh(f["real_min"]), _num(f["desvio_pct"])]
                        for f in p["por_proceso"]]))
        tablas.append(("OT con más horas", ["N° OT", "Artículo", "Horas en el mes", "Pasos terminados",
                                            "Estimado (h)", "Real (h)", "Desvío %"],
                       [[_num(f["numero"]), _neutralizar(f["articulo"]), _hh(f["horas_min"]),
                         _num(f["pasos_terminados"]), _hh(f["estimado_min"]), _hh(f["real_min"]),
                         _num(f["desvio_pct"])] for f in p["top_ot"]]))
        if p.get("pausas") and p["pausas"]["disponibles"]:
            tablas.append(("Pausas por motivo", ["Motivo", "Pausas", "Horas paradas (jornada)"],
                           [[f["texto"], _num(f["cantidad"]), _hh(f["minutos"])]
                            for f in p["pausas"]["por_motivo"]]))
    pe = r.get("personas")
    if pe:
        encabezado = ["Persona", "Horas trabajadas", "Tareas completadas", "Promedio por tarea (h)",
                      "Eficiencia %"]
        if pe["ausencias_visibles"]:
            encabezado += ["Días de ausencia", "Días laborables de ausencia"]
        filas = []
        for f in pe["filas"]:
            fila = [_neutralizar(f["persona"]), _hh(f["horas_trabajadas_min"]),
                    _num(f["tareas_completadas"]), _hh(f["tiempo_promedio_min"]),
                    _num(f["eficiencia_pct"])]
            if pe["ausencias_visibles"]:
                a = f["ausencias"] or {}
                fila += [_num(a.get("dias")), _num(a.get("dias_laborables"))]
            filas.append(fila)
        tablas.append(("Personas", encabezado, filas))
    c = r.get("calidad")
    if c and c.get("disponible"):
        tablas.append(("Calidad por tipo", ["Tipo", "No conformidades", "Piezas rechazadas",
                                            "% de rechazo", "Minutos perdidos"],
                       [[f["texto"], _num(f["cantidad"]), _num(f["piezas"]),
                         _num(f.get("porcentaje_rechazo")), _num(f["minutos"])]
                        for f in c["por_tipo"]]))
        # Sin la sección «Rendimiento por persona» el agrupado no viene (None).
        if c.get("por_persona") is not None:
            tablas.append(("Calidad por persona", ["Persona", "No conformidades", "Piezas rechazadas",
                                                   "% de rechazo", "Minutos perdidos"],
                           [[_neutralizar(f["texto"]), _num(f["cantidad"]), _num(f["piezas"]),
                             _num(f.get("porcentaje_rechazo")), _num(f["minutos"])]
                            for f in c["por_persona"]]))
    mt = r.get("materiales")
    if mt and mt.get("disponible"):
        tablas.append(("Consumo por material", ["Código", "Material", "Unidad", "Cantidad", "Cargas",
                                                "OT"],
                       [[_neutralizar(f["cod_pieza"]), _neutralizar(f["descripcion"]), f["unidad"] or "",
                         _num(f["cantidad"]), _num(f["cargas"]), _num(f["ordenes"])]
                        for f in mt["por_material"]]))
    mq = r.get("maquinas")
    if mq and mq.get("disponible"):
        # Las horas de RF-10 (ver ReporteMensualService._maquinas).
        tablas.append(("Máquinas", ["Máquina", "Horas de uso", "Tareas", "Horas del mes anterior",
                                    "Mantenimientos"],
                       [[_neutralizar(f.get("maquina")), _hh(f.get("horas_min")), _num(f.get("tareas")),
                         _hh(f.get("horas_min_anterior")), _num(f.get("mantenimientos") or 0)]
                        for f in mq.get("filas") or []]))
        if mq.get("mantenimientos"):
            tablas.append(("Mantenimientos hechos", ["Fecha", "Máquina", "Lo hizo", "Nota"],
                           [[_fecha_ar(m.get("fecha")), _neutralizar(m.get("maquina")),
                             _neutralizar(m.get("hecho_por") or ""), _neutralizar(m.get("nota") or "")]
                            for m in mq["mantenimientos"]]))
    return tablas


def csv_del_reporte(r: dict) -> str:
    """Todas las tablas en un CSV para el Excel del taller: `;` y BOM, como el CSV de no
    conformidades (en es-AR la coma es el decimal y sin BOM los acentos salen rotos)."""
    salida = io.StringIO()
    w = csv.writer(salida, delimiter=";", lineterminator="\r\n")
    w.writerow([f"Reporte mensual - {r['titulo']}"])
    for i, (titulo, encabezado, filas) in enumerate(tablas_del_reporte(r)):
        w.writerow([])
        w.writerow([titulo])
        w.writerow(encabezado)
        w.writerows(filas)
    return "﻿" + salida.getvalue()


# ─────────────────────────── el mail (se arma, NO se manda) ───────────────────────────


def _fmt_horas(minutos_: Optional[int]) -> str:
    if minutos_ is None:
        return "—"
    h, m = divmod(int(round(minutos_)), 60)
    return f"{h} h {m} min" if h and m else (f"{h} h" if h else f"{m} min")


def _fmt(valor, tipo: str = "n") -> str:
    if valor is None:
        return "—"
    if tipo == "h":
        return _fmt_horas(valor)
    if tipo == "%":
        return f"{_num(float(valor))} %"
    return _num(valor)


def _variacion(actual, anterior, tipo: str = "n") -> str:
    if actual is None or anterior is None:
        return ""
    dif = actual - anterior
    if not dif:
        return "igual"
    signo = "+" if dif > 0 else "−"
    return f"{signo}{_fmt(abs(dif), tipo)}"


def indicadores_del_mail(r: dict) -> list[tuple[str, list[tuple[str, object, object, str]]]]:
    """(sección, [(indicador, este mes, mes anterior, tipo)]): el resumen que va en el
    cuerpo del mail. Sólo las secciones que el reporte trae (las que el destinatario ve)."""
    salida = []
    o = r.get("ordenes")
    if o:
        a, b = o["resumen"], o["anterior"]
        salida.append(("Órdenes", [
            ("Ingresadas", a["ingresadas"], b["ingresadas"], "n"),
            ("Entregadas", a["entregadas"], b["entregadas"], "n"),
            ("Entregadas a tiempo", a["pct_a_tiempo"], b["pct_a_tiempo"], "%"),
            ("Días de atraso promedio", a["dias_atraso_promedio"], b["dias_atraso_promedio"], "n"),
            ("Abiertas al cierre", a["abiertas_al_cierre"], b["abiertas_al_cierre"], "n"),
            ("Atrasadas al cierre", a["atrasadas_al_cierre"], b["atrasadas_al_cierre"], "n"),
        ]))
    p = r.get("produccion")
    if p:
        a, b = p["resumen"], p["anterior"]
        salida.append(("Producción", [
            ("Horas trabajadas", a["horas_min"], b["horas_min"], "h"),
            ("Pasos terminados", a["pasos_terminados"], b["pasos_terminados"], "n"),
            ("Desvío contra lo estimado", a["desvio_pct"], b["desvio_pct"], "%"),
        ]))
    pe = r.get("personas")
    if pe:
        a, b = pe["resumen"], pe["anterior"]
        filas = [
            ("Personas con trabajo o ausencias", a["personas"], b["personas"], "n"),
            ("Horas trabajadas (por persona)", a["horas_trabajadas_min"], b["horas_trabajadas_min"], "h"),
            ("Eficiencia", a["eficiencia_pct"], b["eficiencia_pct"], "%"),
        ]
        if pe["ausencias_visibles"]:
            filas.append(("Días de ausencia", a["dias_ausencia"], b["dias_ausencia"], "n"))
        salida.append(("Personas", filas))
    c = r.get("calidad")
    if c and c.get("disponible") and c.get("resumen"):
        a, b = c["resumen"], c.get("anterior") or {}
        salida.append(("Calidad", [
            ("No conformidades", a["total"], b.get("total"), "n"),
            ("Piezas rechazadas", a["piezas_afectadas"], b.get("piezas_afectadas"), "n"),
            ("Piezas controladas", a.get("piezas_controladas"), b.get("piezas_controladas"), "n"),
            ("% de rechazo", a.get("porcentaje_rechazo"), b.get("porcentaje_rechazo"), "%"),
            ("Minutos perdidos", a["minutos_perdidos"], b.get("minutos_perdidos"), "n"),
        ]))
    mt = r.get("materiales")
    if mt and mt.get("disponible") and mt.get("resumen"):
        a, b = mt["resumen"], mt.get("anterior") or {}
        salida.append(("Materiales", [
            ("Cargas de consumo", a["cargas"], b.get("cargas"), "n"),
            ("Materiales distintos", a["materiales"], b.get("materiales"), "n"),
            ("OT con consumo", a["ordenes"], b.get("ordenes"), "n"),
        ]))
    mq = r.get("maquinas")
    if mq and mq.get("disponible") and mq.get("resumen"):
        a, b = mq["resumen"], mq.get("anterior") or {}
        salida.append(("Máquinas", [
            ("Máquinas con uso", a.get("maquinas"), b.get("maquinas"), "n"),
            ("Horas de uso", a.get("horas_min"), b.get("horas_min"), "h"),
            ("Mantenimientos hechos", a.get("mantenimientos"), b.get("mantenimientos"), "n"),
        ]))
    return salida


def url_del_reporte(url_app: str, anio: int, mes: int) -> str:
    return f"{(url_app or '').rstrip('/')}/dashboard/reporte-mensual?anio={anio}&mes={mes}"


def armar_mail_del_reporte(reporte: dict, *, para: Iterable[str], url_app: str,
                           adjuntar_csv: bool = True) -> dict:
    """ARMA el mail del reporte mensual. NO lo manda.

    Devuelve {para, asunto, html, texto, link, adjuntos: [{nombre, tipo, contenido}],
    enviado: False}. `contenido` es bytes (el CSV en UTF-8 con BOM). El PDF y el Excel no
    se adjuntan: se arman en el navegador (lib/exportar) y el link lleva a la pantalla,
    donde están los dos botones. Si el día del envío se quiere el PDF adjunto, hay que
    armarlo en el servidor (una librería más en la imagen): queda anotado como pendiente.

    `reporte` es lo que devuelve ReporteMensualService.armar() CON LOS PERMISOS DEL
    DESTINATARIO: esto no filtra nada, manda lo que el reporte trae.
    """
    e = html.escape
    titulo = reporte["titulo"]
    anterior = reporte["anterior"]["titulo"]
    link = url_del_reporte(url_app, reporte["anio"], reporte["mes"])
    asunto = f"SPMM · Reporte mensual de {titulo}"
    secciones = indicadores_del_mail(reporte)

    NAVY, ROJO, GRIS = "#1e3a5f", "#DC143C", "#6b7280"
    bloques = []
    texto = [f"Reporte mensual de {titulo} (comparado con {anterior})", ""]
    for nombre, filas in secciones:
        renglones = "".join(
            "<tr>"
            f"<td style='padding:6px 8px;border-bottom:1px solid #e5e7eb'>{e(ind)}</td>"
            f"<td style='padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600'>{e(_fmt(a, t))}</td>"
            f"<td style='padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:{GRIS}'>{e(_fmt(b, t))}</td>"
            f"<td style='padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:{GRIS}'>{e(_variacion(a, b, t))}</td>"
            "</tr>"
            for ind, a, b, t in filas)
        bloques.append(
            f"<h3 style='margin:20px 0 6px;font-size:14px;color:{NAVY};text-transform:uppercase;"
            f"letter-spacing:.04em'>{e(nombre)}</h3>"
            "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse;font-size:13px'>"
            f"<tr style='color:{GRIS};font-size:11px'><td style='padding:4px 8px'></td>"
            f"<td style='padding:4px 8px;text-align:right'>{e(titulo)}</td>"
            f"<td style='padding:4px 8px;text-align:right'>{e(anterior)}</td>"
            "<td style='padding:4px 8px;text-align:right'>Diferencia</td></tr>"
            f"{renglones}</table>")
        texto.append(nombre.upper())
        texto += [f"  {ind}: {_fmt(a, t)} (antes {_fmt(b, t)})" for ind, a, b, t in filas]
        texto.append("")

    avisos = reporte.get("avisos") or []
    if avisos:
        bloques.append(
            f"<p style='margin:18px 0 0;font-size:12px;color:{GRIS}'>"
            + "<br>".join(e(a) for a in avisos) + "</p>")
        texto += avisos + [""]
    if not secciones:
        bloques.append(f"<p style='font-size:13px;color:{GRIS}'>No hay partes del reporte para mostrar.</p>")

    cuerpo = (
        "<!doctype html><html><body style='margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif'>"
        "<table cellpadding='0' cellspacing='0' style='width:100%;background:#f3f4f6'><tr><td align='center' style='padding:24px 12px'>"
        "<table cellpadding='0' cellspacing='0' style='width:100%;max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden'>"
        f"<tr><td style='background:{NAVY};padding:18px 24px;color:#ffffff'>"
        "<div style='font-size:11px;letter-spacing:.08em;opacity:.8'>METALÚRGICA LONGCHAMPS · SPMM</div>"
        f"<div style='font-size:20px;font-weight:700;margin-top:4px'>Reporte mensual de {e(titulo)}</div>"
        f"<div style='font-size:12px;opacity:.8;margin-top:2px'>Comparado con {e(anterior)}</div></td></tr>"
        f"<tr><td style='height:4px;background:{ROJO}'></td></tr>"
        f"<tr><td style='padding:8px 24px 24px'>{''.join(bloques)}"
        f"<p style='margin:24px 0 0'><a href='{e(link, quote=True)}' style='display:inline-block;background:{ROJO};"
        "color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600'>"
        "Ver el reporte completo (PDF y Excel)</a></p>"
        f"<p style='margin:14px 0 0;font-size:11px;color:{GRIS}'>Lo armó SPMM solo. El detalle "
        "(las OT, las personas, las no conformidades y los consumos) está en la pantalla y en el CSV adjunto.</p>"
        "</td></tr></table></td></tr></table></body></html>")

    texto += [f"Reporte completo (PDF y Excel): {link}"]
    adjuntos = []
    if adjuntar_csv:
        adjuntos.append({
            "nombre": f"reporte_mensual_{reporte['anio']}-{reporte['mes']:02d}.csv",
            "tipo": "text/csv; charset=utf-8",
            "contenido": csv_del_reporte(reporte).encode("utf-8"),
        })
    return {
        "para": list(para),
        "asunto": asunto,
        "html": cuerpo,
        "texto": "\n".join(texto),
        "link": link,
        "adjuntos": adjuntos,
        "enviado": False,
    }


async def destinatarios_por_defecto(db) -> list[str]:
    """Los mails de los usuarios ADMIN activos. DECISIÓN PENDIENTE (Lucas): a quién le
    llega. Es lo más cerrado que hay —el reporte trae la sección confidencial— y hoy
    todos los usuarios son admin, así que en la práctica es todo el equipo."""
    from backend.domain.Usuario import Usuario

    filas = (await db.execute(
        select(Usuario.email).where(Usuario.rol == "admin", Usuario.activo.is_(True))
        .order_by(Usuario.id_usuario)
    )).scalars().all()
    return [m for m in filas if m and "@" in m]


async def preparar_mails_del_mes(db, anio: int | None = None, mes: int | None = None, *,
                                 url_app: str | None = None, para: Iterable[str] | None = None,
                                 ahora: datetime | None = None) -> list[dict]:
    """Lo que va a correr el endpoint interno el 1° de cada mes: el reporte del mes
    anterior (o el pedido), armado para los admin, y sus mails. NO manda nada: devuelve
    los mails armados, UNO POR DESTINATARIO con una sola dirección en «para» (la regla de
    email.py: nadie ve la dirección de los demás). El reporte se arma una vez: hoy todos
    reciben el mismo; el día que cada uno reciba el suyo según sus permisos, se arma
    acá por destinatario y quien lo llama no cambia."""
    from backend.core.config import settings

    ahora = ahora or ahora_ar()
    if anio is None or mes is None:
        anio, mes = mes_por_defecto(ahora)
    crudos = list(para) if para is not None else await destinatarios_por_defecto(db)
    destinatarios: list[str] = []
    for d in crudos:
        d = (d or "").strip()
        if d and d.lower() not in {x.lower() for x in destinatarios}:
            destinatarios.append(d)
    if not destinatarios:
        return []
    # Los destinatarios por defecto son admin: les va todo. Una lista `para` puesta a mano
    # puede tener a alguien sin la sección CONFIDENCIAL «Rendimiento por persona» (la que
    # piden RF-07 y los rechazos por persona de RF-12), y acá no se sabe con qué permisos:
    # opción conservadora, sin personas, sin ausencias y sin calidad por persona. Si Lucas
    # decide que le llegue a alguien más, se arma con alcance_de(los permisos de cada uno).
    alcance = Alcance.todo() if para is None else replace(Alcance.todo(), personas=False,
                                                          ausencias=False)
    reporte = await ReporteMensualService(db).armar(anio, mes, alcance, ahora=ahora)
    return [armar_mail_del_reporte(reporte, para=[d], url_app=url_app or settings.FRONTEND_URL)
            for d in destinatarios]
