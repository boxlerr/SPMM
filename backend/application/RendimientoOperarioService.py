"""El rendimiento de una persona en un período (RF-07): el reporte de su ficha.

El SRS pide «reportes individuales por operario, con métricas de eficiencia, cantidad
de tareas completadas y tiempo promedio por tarea». Julián lo pidió en el perfil de cada
persona y exportable a Excel y PDF. La exportación se arma en el navegador con esto
mismo (RF-22), así que acá está TODA la cuenta, una sola vez.

DE DÓNDE SALE

De los tiempos EFECTIVOS de RF-06 (TiemposOperarioService + TiempoEfectivo), no del
tiempo corrido (fin_real − inicio_real) que usa el cuadro «Estimado vs. real» del
Dashboard. Con eso vienen resueltas dos cosas que ese cuadro tiene mal:

  1. Cruza el plan por pasada (id_orden_trabajo_proceso) y no por (OT, proceso): un
     proceso repetido en una OT —la 7497 tiene TORNO CNC trece veces— no se cuenta de
     más.
  2. Cada paso se le cuenta a UNA atribución: la persona elegida a mano en la OT o, si
     no hay, la del último plan que lo incluyó (ver TiemposOperarioService). No a todas
     las que algún plan viejo nombró.

Y el tiempo es el de la jornada del taller menos las pausas (RF-03): una noche, un fin
de semana o una máquina rota no hacen parecer lento a nadie.

QUÉ ES CADA NÚMERO

El período son días del taller, los dos incluidos: [desde 00:00, hasta+1 00:00).

  tareas completadas  pasos TERMINADOS cuyo fin cae en el período.
  tiempo promedio     el efectivo promedio de esas tareas. Es el del paso ENTERO —cuánto
                      le llevó la tarea—, aunque haya arrancado antes del período.
  eficiencia          estimado ÷ efectivo de esas mismas tareas, en %. 100 % = tardó lo
                      estimado; más de 100 %, menos de lo estimado; menos de 100 %, más.
                      Es la suma de estimados sobre la suma de efectivos, no el promedio
                      de los porcentajes: una tarea de 5 minutos no pesa lo mismo que una
                      de 5 horas.
  horas trabajadas    el efectivo que cae ADENTRO del período, de todos los pasos que
                      trabajó (terminados o no), y sin contar dos veces la hora en que
                      tenía dos pasos abiertos a la vez (pasa: se arrancan todos los de
                      una OT de una). Sin los días en que figura ausente y sin los pasos
                      «en proceso» que nadie cierra hace más de TOPE_JORNADAS_ABIERTO
                      jornadas. Es la misma cuenta que el total de la solapa Tiempos
                      (TiemposOperarioService.horas_en_el_periodo). Lo que se superpuso, lo
                      de los días de ausencia y lo de los pasos abiertos de más se informa
                      aparte.
  pausas              lo que sus pasos estuvieron parados (RF-03) adentro de la jornada
                      y del período, cuántas pausas y por qué.
  días de ausencia    los de su asistencia (RF-06) en el período: corridos y laborables.

QUÉ NO ENTRA EN EL PROMEDIO NI EN LA EFICIENCIA, y se dice cuántos quedaron afuera:

  · un terminado sin fin registrado: no hay cuenta honesta (sale en la tabla, sin
    minutos, y no se sabe cuándo terminó);
  · uno con efectivo cero: se marcó el arranque y el fin juntos, o se trabajó entero
    fuera de la jornada. Dividir por cero no es una eficiencia;
  · sin estimado en la OT: entra en el promedio, pero no en la eficiencia (no hay contra
    qué comparar).

Tampoco cuenta nada (ni tiempo, ni horas) un paso PENDIENTE con arranque: el sistema
viejo o una OT migrada lo pueden traer, y no dice si alguien lo trabajó. En curso es sólo
lo que está en proceso.

UN PASO REABIERTO (terminado, vuelto a poner en proceso y terminado de nuevo) guarda un
solo arranque y un solo fin. El tiempo en que estuvo terminado sale del historial de
pasos de la OT y no se cuenta (ver TiemposOperarioService.cerrados_del_historial); el
paso queda marcado en la tabla.

LO QUE ESTE NÚMERO NO DICE, y la pantalla lo aclara: mide contra el tiempo estimado de
la OT —si la estimación está mal, la eficiencia también— y quién hizo cada paso es una
atribución, no un registro (no hay fichadas: v2, Módulo J).
"""
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi.encoders import jsonable_encoder

from backend.application.AusenciaService import AusenciaService, dia_en_rango, leer_fecha, nombre_persona
from backend.application.PausaService import ahora_ar
from backend.application.TiempoEfectivo import (
    fecha_real,
    interseccion,
    jornada_en_palabras,
    minutos,
)
from backend.application.TiemposOperarioService import (
    TOPE_JORNADAS_ABIERTO,
    TOPE_TAREAS,
    TiemposOperarioService,
    dato_roto,
    fila_de_tarea,
    horas_en_el_periodo,
    trabajado_en,
)
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.loggers.logger import logger
from backend.domain.PausaOrden import MOTIVO_TEXTO as MOTIVO_PAUSA_TEXTO

# Un período de más de un año es, casi seguro, un año mal tipeado en el rango a mano.
TOPE_DIAS_PERIODO = 366

# Sin período: los últimos 30 días, igual que la pantalla.
DIAS_POR_DEFECTO = 30

# Entre estos dos, «más o menos lo estimado». Es el mismo ±10 % con el que el cuadro del
# Dashboard pinta el desvío.
PAREJO_DESDE, PAREJO_HASTA = 90, 110


# ─────────────────────────── cuentas puras ───────────────────────────


def fmt_minutos(m: int | None) -> str:
    """«45 min», «2 h», «2 h 15 min». Igual que fmtMinutos del front."""
    if m is None:
        return "—"
    m = max(0, int(round(m)))
    if m < 60:
        return f"{m} min"
    h, resto = divmod(m, 60)
    return f"{h} h {resto} min" if resto else f"{h} h"


def eficiencia_pct(estimado_min: int | None, efectivo_min: int | None) -> int | None:
    """Estimado ÷ efectivo, en %. None si falta alguno de los dos (o es cero)."""
    if not estimado_min or not efectivo_min or estimado_min <= 0 or efectivo_min <= 0:
        return None
    return int(round(100 * estimado_min / efectivo_min))


def nivel_de(pct: int | None) -> str | None:
    """«rapido», «parejo» o «lento», para el color de la pantalla."""
    if pct is None:
        return None
    if pct > PAREJO_HASTA:
        return "rapido"
    if pct < PAREJO_DESDE:
        return "lento"
    return "parejo"


def lectura_eficiencia(pct: int | None, estimado_min: int, efectivo_min: int, tareas: int) -> str:
    """La eficiencia en castellano, con los números que la forman."""
    if pct is None:
        return ("Todavía no se puede calcular: hace falta al menos una tarea terminada en el "
                "período, con tiempo estimado en la OT y con tiempo trabajado medido.")
    cuantas = f"{tareas} {'tarea' if tareas == 1 else 'tareas'}"
    base = (f"lo que se estimaba en {fmt_minutos(estimado_min)} le llevó "
            f"{fmt_minutos(efectivo_min)} ({cuantas})")
    nivel = nivel_de(pct)
    if nivel == "rapido":
        return f"Tardó menos de lo estimado: {base}."
    if nivel == "lento":
        return f"Tardó más de lo estimado: {base}."
    return f"Tardó más o menos lo estimado: {base}."


def resumir(filas: list[dict]) -> dict:
    """Lo que sale de las tareas (sin horas, pausas ni ausencias, que van por tramos).

    `filas` son las de la tabla, ya con `terminada_en_periodo` y `medible`.
    """
    completadas = [f for f in filas if f["terminada_en_periodo"]]
    medibles = [f for f in completadas if f["medible"]]
    con_estimado = [f for f in medibles if (f["estimado_min"] or 0) > 0]
    estimado = sum(f["estimado_min"] for f in con_estimado)
    efectivo = sum(f["efectivo_min"] for f in con_estimado)
    pct = eficiencia_pct(estimado, efectivo)
    return {
        "tareas_trabajadas": len(filas),
        "tareas_completadas": len(completadas),
        "en_curso": sum(1 for f in filas if f["en_curso"]),
        # Afuera del promedio y de la eficiencia, con su porqué.
        "sin_datos": sum(1 for f in filas if f["sin_datos"]),
        "sin_tiempo": sum(1 for f in completadas if not f["sin_datos"] and not f["medible"]),
        "sin_estimado": len(medibles) - len(con_estimado),
        "tiempo_promedio_min": (int(round(sum(f["efectivo_min"] for f in medibles) / len(medibles)))
                                if medibles else None),
        "tareas_medidas": len(medibles),
        "eficiencia": {
            "pct": pct,
            "nivel": nivel_de(pct),
            "estimado_min": estimado,
            "efectivo_min": efectivo,
            "tareas": len(con_estimado),
            "lectura": lectura_eficiencia(pct, estimado, efectivo, len(con_estimado)),
        },
    }


# ─────────────────────────── el servicio ───────────────────────────


def leer_periodo(desde, hasta, hoy: date) -> tuple[date, date]:
    """El período pedido, con sus defectos: sin `hasta`, hoy; sin `desde`, 30 días
    antes de `hasta`."""
    p_desde = dia_en_rango(leer_fecha(desde, "desde"), "desde")
    p_hasta = dia_en_rango(leer_fecha(hasta, "hasta"), "hasta")
    p_hasta = p_hasta or hoy
    p_desde = p_desde or p_hasta - timedelta(days=DIAS_POR_DEFECTO - 1)
    if p_hasta < p_desde:
        raise BusinessException("El período termina antes de empezar.")
    if (p_hasta - p_desde).days + 1 > TOPE_DIAS_PERIODO:
        raise BusinessException("El período puede ser de hasta un año (366 días): achicalo.")
    return p_desde, p_hasta


class RendimientoOperarioService:
    def __init__(self, db_session):
        self.db = db_session
        self.tiempos = TiemposOperarioService(db_session)

    async def _ausencias(self, id_operario: int, desde: date, hasta: date) -> dict | None:
        """Los días de ausencia del período (RF-06). En un SAVEPOINT: si la tabla de
        ausencias no está, el reporte sale igual y dice que ese dato falta."""
        try:
            async with self.db.begin_nested():
                r = await AusenciaService(self.db).historial(
                    id_operario, desde.isoformat(), hasta.isoformat())
            return r.data["resumen"]
        except Exception as e:
            logger.warning(f"Rendimiento: no se pudieron leer las ausencias de {id_operario}: {e}")
            return None

    async def reporte(self, id_operario: int, desde=None, hasta=None) -> ResponseDTO:
        op = await self.tiempos.persona(id_operario)
        ahora = ahora_ar()
        p_desde, p_hasta = leer_periodo(desde, hasta, ahora.date())
        ini_p = datetime.combine(p_desde, time())
        fin_p = datetime.combine(p_hasta + timedelta(days=1), time())
        periodo = [(ini_p, fin_p)]

        todos = await self.tiempos.pasos_atribuidos(id_operario)
        # Un dato roto (terminado sin fin, pendiente con arranque) no se sabe hasta
        # cuándo se trabajó: para el filtro de la solapa Tiempos «sigue abierto», y acá
        # aparecería —y contaría como trabajada— en todos los períodos que vienen. Va
        # sólo en el que arrancó.
        pasos = [p for p in todos
                 if (ini_p <= p["inicio_real"] < fin_p if dato_roto(p)
                     else trabajado_en(p, ini_p, fin_p, ahora))]
        pausas_por_ot, pausas_disponibles, feriados = await self.tiempos.pausas_y_feriados(pasos)
        cerrados = await self.tiempos.cerrados(pasos)
        ausencias = await self.tiempos.ausencias(id_operario, p_desde, p_hasta, ahora.date())

        filas: list[dict] = []
        medidos: list = []          # (fila, tramos) de cada paso, para las horas
        parado: list = []           # lo pausado adentro de la jornada y del período
        parado_por_motivo: dict[str, list] = defaultdict(list)
        pausas_contadas: set = set()

        for p in pasos:
            fin = fecha_real(p["fin_real"])
            t, tramos, del_paso = self.tiempos.medir(p, pausas_por_ot, cerrados,
                                                     ahora=ahora, feriados=feriados)

            fila = fila_de_tarea(p, t)
            en_periodo = None
            if tramos is not None:
                en_periodo = minutos(interseccion(tramos.efectivos, periodo))
                for pausa, suyos in zip(del_paso, tramos.por_pausa):
                    adentro = interseccion(suyos, periodo)
                    if adentro:
                        parado.extend(adentro)
                        parado_por_motivo[pausa.motivo].extend(adentro)
                        pausas_contadas.add(pausa.id)

            terminada = p["id_estado"] == 3 and fin is not None and ini_p <= fin < fin_p
            medible = terminada and not fila["sin_datos"] and (fila["efectivo_min"] or 0) > 0
            fila.update({
                "efectivo_en_periodo_min": en_periodo,
                "terminada_en_periodo": terminada,
                "medible": medible,
                "eficiencia_pct": eficiencia_pct(fila["estimado_min"], fila["efectivo_min"]) if medible else None,
            })
            filas.append(fila)
            medidos.append((fila, tramos))

        # Lo que sigue en curso arriba; después, lo último que terminó.
        filas.sort(key=lambda f: (f["en_curso"], f["fin_real"] or f["inicio_real"], f["inicio_real"]),
                   reverse=True)

        resumen = resumir(filas)
        horas = horas_en_el_periodo(medidos, periodo, ausencias)
        resumen.update({
            "horas_trabajadas_min": horas["horas_trabajadas_min"],
            "superpuesto_min": horas["superpuesto_min"],
            # Lo de sus pasos que cayó en días en que figura ausente: no se cuenta.
            "en_ausencia_min": horas["en_ausencia_min"] if ausencias is not None else None,
            # Pasos «en proceso» que nadie cierra hace demasiado: sus horas no se cuentan.
            "abiertos_de_mas": horas["abiertos_de_mas"],
            "reabiertas": sum(1 for f in filas if f["reabierto"]),
            "pausas": {
                "minutos": minutos(parado),
                "cantidad": len(pausas_contadas),
                "por_motivo": sorted(
                    ({"motivo": m, "texto": MOTIVO_PAUSA_TEXTO.get(m, m), "minutos": minutos(tr)}
                     for m, tr in parado_por_motivo.items()),
                    key=lambda x: -x["minutos"]),
            },
            "ausencias": await self._ausencias(id_operario, p_desde, p_hasta),
        })

        data = {
            "id_operario": id_operario,
            "persona": nombre_persona(op),
            "periodo": {"desde": p_desde.isoformat(), "hasta": p_hasta.isoformat(),
                        "dias": (p_hasta - p_desde).days + 1},
            "generado": ahora,
            "jornada": jornada_en_palabras(),
            "tope_jornadas_abierto": TOPE_JORNADAS_ABIERTO,
            # False = el servidor no tiene las pausas (RF-03): el efectivo no las descuenta.
            "pausas_disponibles": pausas_disponibles,
            # False = no tiene la asistencia (RF-06): los días de ausencia no se saben.
            "ausencias_disponibles": resumen["ausencias"] is not None,
            # Para el estado vacío: ¿nunca se le marcó un paso, o no en este período?
            "historial": {
                "pasos": len(todos),
                "ultimo_arranque": max((p["inicio_real"] for p in todos), default=None),
            },
            "resumen": resumen,
            "recortado": len(filas) > TOPE_TAREAS,
            "tareas": filas[:TOPE_TAREAS],
        }
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")
