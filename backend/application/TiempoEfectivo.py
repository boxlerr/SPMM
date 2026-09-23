"""Cuánto se trabajó de verdad en un paso de una OT (RF-06). Funciones puras.

El SRS pide «registrar ... el tiempo efectivo de trabajo de cada operario en cada tarea
asignada». Lo que había era el tiempo CORRIDO de cada paso —`fin_real − inicio_real`,
que se estampan al ponerlo en proceso y al terminarlo— y ese número miente de dos
maneras:

  1. Cuenta la noche, el fin de semana y el feriado. Un paso que se arranca el viernes
     a las 15 y se termina el lunes a las 8 «duró» 65 horas.
  2. Cuenta lo que estuvo parado. Si se rompió la máquina o faltó material, el reloj
     siguió corriendo y el operario parecía lento. Para eso está RF-03: las pausas.

EFECTIVO = lo que cae adentro de la jornada del taller, menos lo que estuvo en pausa
adentro de esa jornada. Y se devuelve el desglose entero, para que nada quede
escondido:

    corrido = efectivo + en pausa + fuera de jornada (+ terminado, si se reabrió)

LA JORNADA ES LA DEL PLANIFICADOR

No hay una tercera jornada acá: los tramos de reloj se derivan de TRAMOS_LV_LAB,
TRAMOS_SAB_LAB y minutos_muertos_del_dia de PlanificacionService, los mismos que usa el
solver y que el front tiene espejados en plan-fechas.ts (test_jornada_front_y_back_no_se_
separan). Hoy: lunes a viernes 07:00–09:00, 09:15–12:00 y 12:30–16:00 (495 minutos);
sábado 07:00–12:00; domingo y los días bloqueados del calendario, nada. Si mañana se
cambia la jornada, esto la sigue sola.

Qué se pierde, dicho: lo que alguien trabaje fuera de ese horario (horas extra, un
domingo) no cuenta como efectivo. No se esconde: sale en «fuera de jornada». Es la
misma jornada con la que el planificador cuenta la capacidad del taller, así que las
dos cuentas hablan el mismo idioma.

TODO EN MINUTOS ENTEROS

Las fechas se truncan al minuto antes de hacer nada. Si no, el desglose puede no
cerrar por un minuto (el redondeo de cada parte por separado).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Iterable, NamedTuple, Optional

from backend.application.PlanificacionService import (
    HORA_APERTURA,
    TRAMOS_LV_LAB,
    TRAMOS_SAB_LAB,
    minutos_muertos_del_dia,
)

Tramo = tuple[datetime, datetime]

# Las fechas «vacías» del sistema viejo: el legacy guarda 1900-01-01 y 1950-01-01 donde
# no hay dato. Mismo corte que usa el dashboard para el estimado vs. real.
_CENTINELA = datetime(1950, 1, 2)


def fecha_real(valor: Optional[datetime]) -> Optional[datetime]:
    """La fecha, o None si es vacía o el centinela del sistema viejo."""
    if valor is None or valor < _CENTINELA:
        return None
    return valor


def _al_minuto(d: datetime) -> datetime:
    return d.replace(second=0, microsecond=0)


def _tramos_de_reloj(es_sabado: bool) -> list[tuple[int, int]]:
    """Los tramos de trabajo del día en minutos desde las 00:00, derivados de los del
    planificador (que cuentan minutos TRABAJADOS desde la apertura)."""
    apertura = HORA_APERTURA.hour * 60 + HORA_APERTURA.minute
    salida = []
    for ini, fin in (TRAMOS_SAB_LAB if es_sabado else TRAMOS_LV_LAB):
        # El minuto `ini` de trabajo arranca DESPUÉS de las pausas que ya pasaron; el
        # minuto `fin` termina antes de la que viene.
        desde = apertura + ini + minutos_muertos_del_dia(ini + 1, es_sabado)
        hasta = apertura + fin + minutos_muertos_del_dia(fin, es_sabado)
        salida.append((desde, hasta))
    return salida


RELOJ_LV = _tramos_de_reloj(False)    # [(420, 540), (555, 720), (750, 960)]
RELOJ_SABADO = _tramos_de_reloj(True)  # [(420, 720)]

# Los minutos de una jornada de lunes a viernes (495): la unidad con la que se dice
# «lleva cinco jornadas abierto».
MINUTOS_JORNADA = sum(b - a for a, b in RELOJ_LV)


def _hhmm(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def jornada_en_palabras() -> str:
    """«Lunes a viernes 07:00–09:00, 09:15–12:00 y 12:30–16:00; sábados 07:00–12:00»."""
    lv = [f"{_hhmm(a)}–{_hhmm(b)}" for a, b in RELOJ_LV]
    lv_texto = ", ".join(lv[:-1]) + (" y " if len(lv) > 1 else "") + lv[-1]
    sab = ", ".join(f"{_hhmm(a)}–{_hhmm(b)}" for a, b in RELOJ_SABADO)
    return f"Lunes a viernes {lv_texto}; sábados {sab}; sin domingos ni feriados"


def tramos_de_jornada(desde: datetime, hasta: datetime,
                      feriados: Iterable[date] = ()) -> list[Tramo]:
    """Los pedazos de [desde, hasta] que caen adentro de la jornada del taller."""
    if hasta <= desde:
        return []
    feriados = set(feriados)
    salida: list[Tramo] = []
    dia = desde.date()
    while dia <= hasta.date():
        if dia.weekday() != 6 and dia not in feriados:
            medianoche = datetime.combine(dia, time())
            for a, b in (RELOJ_SABADO if dia.weekday() == 5 else RELOJ_LV):
                ini = max(medianoche + timedelta(minutes=a), desde)
                fin = min(medianoche + timedelta(minutes=b), hasta)
                if fin > ini:
                    salida.append((ini, fin))
        dia += timedelta(days=1)
    return salida


def unir(tramos: Iterable[Tramo]) -> list[Tramo]:
    """Ordena y une los que se pisan o se tocan. Una hora parada por dos motivos a la
    vez (el torno roto y el cliente que pidió esperar) es UNA hora parada."""
    salida: list[list[datetime]] = []
    for ini, fin in sorted(t for t in tramos if t[1] > t[0]):
        if salida and ini <= salida[-1][1]:
            salida[-1][1] = max(salida[-1][1], fin)
        else:
            salida.append([ini, fin])
    return [(a, b) for a, b in salida]


def interseccion(a: Iterable[Tramo], b: Iterable[Tramo]) -> list[Tramo]:
    """Lo que está en las dos listas de tramos."""
    a, b = unir(a), unir(b)
    salida: list[Tramo] = []
    i = j = 0
    while i < len(a) and j < len(b):
        ini, fin = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if fin > ini:
            salida.append((ini, fin))
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return salida


def minutos(tramos: Iterable[Tramo]) -> int:
    return int(sum((fin - ini).total_seconds() for ini, fin in unir(tramos)) // 60)


class TiempoDePaso(NamedTuple):
    """El tiempo de un paso, desglosado.
    `corrido = efectivo + en_pausa + fuera_de_jornada + cerrado`."""

    corrido: int           # reloj: del arranque al fin (o a ahora, si sigue)
    fuera_de_jornada: int  # noches, domingos, feriados, desayuno y almuerzo
    en_pausa: int          # lo que estuvo pausado (RF-03) ADENTRO de la jornada
    efectivo: int          # lo que queda: trabajado dentro de la jornada
    en_curso: bool         # sin fin todavía: se cuenta hasta ahora
    cerrado: int = 0       # lo que estuvo TERMINADO antes de que lo reabrieran


# ── Un paso que se reabre ─────────────────────────────────────────────────────
#
# Un paso terminado el lunes que alguien vuelve a poner «en proceso» el jueves (y
# termina de nuevo el viernes) guarda UN arranque —el del lunes— y el fin del viernes:
# la columna no tiene lugar para los dos tramos. Contado de corrido, el paso «duró» de
# lunes a viernes, con el martes y el miércoles adentro, cuando estuvo terminado y nadie
# lo tocaba. Esos tramos (del fin viejo a la reapertura) son `cerrado`: salen de la
# cuenta como si no fueran del paso. Quién los arma: TiemposOperarioService, desde el
# historial de pasos de la OT (auditoria_proceso_ot).


def _cerrados_del_paso(cerrado: Iterable[Tramo], inicio: datetime, hasta: datetime) -> list[Tramo]:
    """Los tramos en que el paso estuvo terminado, al minuto y recortados al paso."""
    salida = []
    for c_desde, c_hasta in cerrado or ():
        if c_desde is None or c_hasta is None:
            continue
        a, b = max(_al_minuto(c_desde), inicio), min(_al_minuto(c_hasta), hasta)
        if b > a:
            salida.append((a, b))
    return unir(salida)


def tiempo_de_un_paso(inicio: Optional[datetime], fin: Optional[datetime],
                      pausas: Iterable[tuple[datetime, Optional[datetime]]] = (), *,
                      ahora: datetime, feriados: Iterable[date] = (),
                      cerrado: Iterable[Tramo] = ()) -> Optional[TiempoDePaso]:
    """El tiempo corrido y el efectivo de un paso. None si no arrancó.

    · `inicio` / `fin`: inicio_real y fin_real del paso. Sin `fin`, el paso sigue en
      curso y se cuenta hasta `ahora`.
    · `pausas`: (desde, hasta) de las que lo pararon —las suyas y las de su OT entera,
      ver PausaService.pausas_del_paso—. Una abierta (`hasta` vacío) cuenta hasta
      `ahora`. Sólo cuenta lo que cae adentro del paso: una pausa que empezó antes del
      arranque o terminó después del fin se recorta.
    · `feriados`: los días bloqueados del calendario del taller.
    · `cerrado`: (desde, hasta) en que el paso estuvo terminado antes de que lo
      reabrieran (ver arriba). No son del paso: ni jornada, ni pausa.

    Un fin anterior al arranque (un dato roto) da todo en cero: no hay forma honesta de
    decir cuánto duró.
    """
    inicio = fecha_real(inicio)
    if inicio is None:
        return None
    en_curso = fecha_real(fin) is None
    ahora = _al_minuto(ahora)
    inicio = _al_minuto(inicio)
    hasta = ahora if en_curso else _al_minuto(fin)
    if hasta <= inicio:
        return TiempoDePaso(0, 0, 0, 0, en_curso)

    corrido = int((hasta - inicio).total_seconds() // 60)
    cerrados = _cerrados_del_paso(cerrado, inicio, hasta)
    cerrado_min = minutos(cerrados)
    jornada = restar(tramos_de_jornada(inicio, hasta, feriados), cerrados)
    en_jornada = minutos(jornada)

    paradas = []
    for p_desde, p_hasta in pausas:
        if p_desde is None:
            continue
        a = max(_al_minuto(p_desde), inicio)
        b = min(_al_minuto(p_hasta) if p_hasta is not None else ahora, hasta)
        if b > a:
            paradas.append((a, b))
    en_pausa = minutos(interseccion(jornada, paradas))

    return TiempoDePaso(
        corrido=corrido,
        fuera_de_jornada=corrido - en_jornada - cerrado_min,
        en_pausa=en_pausa,
        efectivo=en_jornada - en_pausa,
        en_curso=en_curso,
        cerrado=cerrado_min,
    )


# ── Los tramos, no sólo los minutos (RF-07) ───────────────────────────────────
#
# El reporte de rendimiento de una persona necesita más que los minutos de cada paso:
#
#   · RECORTARLOS AL PERÍODO. Un paso que arrancó el 28 del mes pasado y terminó el 3
#     de éste tiene la mayor parte de su trabajo en el mes pasado: las «horas
#     trabajadas» de este mes no pueden llevarse el paso entero.
#   · NO CONTAR DOS VECES LA MISMA HORA. Si a una persona le quedaron dos pasos «en
#     proceso» a la vez (pasa: se arranca todo lo de la OT de una), sumar el efectivo de
#     cada uno da más horas de las que tiene el día. Uniendo los tramos, esa hora cuenta
#     una vez.
#   · SABER DE QUÉ PAUSA ES CADA MINUTO PARADO, para decir «máquina rota: 2 h».
#
# Por eso esto devuelve los TRAMOS. La cuenta es la misma que la de tiempo_de_un_paso
# (un test compara las dos, caso por caso): minutos(efectivos) == efectivo y
# minutos(en_pausa) == en_pausa.


def restar(a: Iterable[Tramo], b: Iterable[Tramo]) -> list[Tramo]:
    """Lo de `a` que no está en `b`."""
    a, b = unir(a), unir(b)
    salida: list[Tramo] = []
    for ini, fin in a:
        cursor = ini
        for b_ini, b_fin in b:
            if b_fin <= cursor:
                continue
            if b_ini >= fin:
                break
            if b_ini > cursor:
                salida.append((cursor, b_ini))
            cursor = max(cursor, b_fin)
            if cursor >= fin:
                break
        if cursor < fin:
            salida.append((cursor, fin))
    return salida


class TramosDePaso(NamedTuple):
    """Dónde cayó el tiempo de un paso, tramo por tramo."""

    jornada: list[Tramo]            # lo que del paso cae adentro de la jornada
    efectivos: list[Tramo]          # jornada sin lo pausado: lo trabajado
    en_pausa: list[Tramo]           # jornada Y pausado (unidas: cada minuto una vez)
    por_pausa: list[list[Tramo]]    # lo de cada pausa de la entrada, en el mismo orden
    en_curso: bool
    cerrado: tuple = ()             # lo que estuvo terminado antes de reabrirlo


def tramos_de_un_paso(inicio: Optional[datetime], fin: Optional[datetime],
                      pausas: Iterable[tuple[datetime, Optional[datetime]]] = (), *,
                      ahora: datetime, feriados: Iterable[date] = (),
                      cerrado: Iterable[Tramo] = ()) -> Optional[TramosDePaso]:
    """Lo mismo que tiempo_de_un_paso, pero con los tramos. None si no arrancó.

    `por_pausa[i]` es lo que la pausa `pausas[i]` paró adentro de la jornada y del paso:
    dos pausas que se pisan tienen, cada una, su parte entera (sirve para repartir por
    motivo); `en_pausa` es la unión, lo que de verdad se descuenta.
    """
    inicio = fecha_real(inicio)
    if inicio is None:
        return None
    pausas = list(pausas)
    en_curso = fecha_real(fin) is None
    ahora = _al_minuto(ahora)
    inicio = _al_minuto(inicio)
    hasta = ahora if en_curso else _al_minuto(fin)
    if hasta <= inicio:
        return TramosDePaso([], [], [], [[] for _ in pausas], en_curso)

    cerrados = _cerrados_del_paso(cerrado, inicio, hasta)
    jornada = restar(tramos_de_jornada(inicio, hasta, feriados), cerrados)
    por_pausa: list[list[Tramo]] = []
    for p_desde, p_hasta in pausas:
        if p_desde is None:
            por_pausa.append([])
            continue
        a = max(_al_minuto(p_desde), inicio)
        b = min(_al_minuto(p_hasta) if p_hasta is not None else ahora, hasta)
        por_pausa.append(interseccion(jornada, [(a, b)]) if b > a else [])
    en_pausa = unir(t for tramos in por_pausa for t in tramos)
    return TramosDePaso(
        jornada=jornada,
        efectivos=restar(jornada, en_pausa),
        en_pausa=en_pausa,
        por_pausa=por_pausa,
        en_curso=en_curso,
        cerrado=tuple(cerrados),
    )
