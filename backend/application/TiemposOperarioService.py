"""El tiempo de cada paso de OT que hizo una persona: estimado, corrido y efectivo (RF-06).

La cuenta está en application/TiempoEfectivo.py (funciones puras). Acá va de dónde sale
cada dato, y sobre todo una decisión que no es técnica:

QUIÉN HIZO UN PASO

El sistema no guarda quién hizo cada paso. `inicio_real` y `fin_real` se estampan al
cambiarle el estado, sin persona: los operarios no tienen usuario, y quien marca el
avance suele ser el supervisor. Lo que sí hay son dos intenciones:

  · la persona ELEGIDA A MANO en la OT (`orden_trabajo_proceso.id_operario`), y
  · la que le dio el PLAN (`planificacion.id_operario`).

Con eso, un paso cuenta para una persona si:

  1. la tiene elegida a mano; o
  2. no tiene a nadie elegido y el ÚLTIMO plan que incluyó ese paso se lo dio a ella.
     «Último» porque el plan se acumula por lotes: si se replanificó, manda el más
     nuevo, no el primero que lo tocó. Un paso de varias personas (cant_operarios) se
     le cuenta a cada una: cada una puso ese tiempo.

  Si la elegida a mano forma parte de ese último plan y el paso lleva más de una
  persona, cuenta el equipo entero del plan (el elegido y los que el plan le sumó).

Es una atribución, no un registro, y la pantalla lo dice («según la OT» / «según el
plan»). Registrar quién lo hizo de verdad pide elegir a la persona al marcar el avance,
o fichadas: la v2 (Módulo J).
"""
import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi.encoders import jsonable_encoder

from backend.application.PausaService import ahora_ar, pausas_del_paso
from backend.application.TiempoEfectivo import (
    MINUTOS_JORNADA,
    Tramo,
    fecha_real,
    interseccion,
    jornada_en_palabras,
    minutos,
    restar,
    tiempo_de_un_paso,
    tramos_de_un_paso,
    unir,
)
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.infrastructure.AusenciaRepository import AusenciaRepository
from backend.infrastructure.TiemposOperarioRepository import TiemposOperarioRepository

ESTADO_TEXTO = {1: "Pendiente", 2: "En proceso", 3: "Terminado"}

# Más que esto en una sola respuesta no se lee en una ficha; se avisa que se recortó.
# Los totales se cuentan ANTES de recortar: son de todas las tareas, no de las visibles.
TOPE_TAREAS = 500

# Un paso «en proceso» que nadie cerró sigue sumando una jornada entera por cada día
# hábil que pasa. Pasadas estas jornadas de trabajo efectivo (y el doble de lo estimado,
# para no marcar un trabajo largo de verdad), se marca «¿quedó abierto?» y sus horas NO
# entran en las horas trabajadas: se dice cuántas quedaron afuera.
TOPE_JORNADAS_ABIERTO = 5

# Por qué un paso no se puede medir. Lo lee la pantalla tal cual.
SIN_DATOS_TEXTO = {
    "terminado_sin_fin": "Figura terminado pero sin fecha de fin: no se puede medir.",
    "fin_antes_del_arranque": "El fin registrado es anterior al arranque: no se puede medir.",
    "pendiente_con_arranque": ("Figura pendiente pero tiene un arranque registrado (dato del "
                               "sistema viejo o de una migración): no se sabe si se trabajó."),
}


def _leer_fecha(valor, campo: str) -> date | None:
    if valor is None or valor == "":
        return None
    if isinstance(valor, date):
        return valor
    try:
        return date.fromisoformat(str(valor).strip()[:10])
    except ValueError:
        raise BusinessException(f"La fecha «{campo}» tiene que ser del tipo AAAA-MM-DD.")


def resolver_pasada(fila: dict, pasos_por_ot_proceso: dict) -> int | None:
    """De qué paso es una fila del plan. Las de antes del 28/08 no lo dicen: si en la OT
    hay UNA sola pasada de ese proceso es ésa; si hay varias no se adivina."""
    if fila.get("id_orden_trabajo_proceso") is not None:
        return int(fila["id_orden_trabajo_proceso"])
    candidatos = pasos_por_ot_proceso.get((fila.get("orden_id"), fila.get("proceso_id")), [])
    return candidatos[0] if len(candidatos) == 1 else None


def personas_del_ultimo_plan(filas: list[dict], pasos_por_ot_proceso: dict) -> dict[int, set[int]]:
    """{paso: personas} según el ÚLTIMO lote de plan que incluyó cada paso."""
    por_paso: dict[int, list[dict]] = defaultdict(list)
    for f in filas:
        pasada = resolver_pasada(f, pasos_por_ot_proceso)
        if pasada is not None:
            por_paso[pasada].append(f)
    salida: dict[int, set[int]] = {}
    for pasada, del_paso in por_paso.items():
        ultima = max(del_paso, key=lambda f: (f.get("creado_en") or datetime.min, f.get("id") or 0))
        lote = ultima.get("id_planificacion_lote")
        salida[pasada] = {f["id_operario"] for f in del_paso
                          if f.get("id_planificacion_lote") == lote and f.get("id_operario") is not None}
    return salida


def le_toca(id_operario: int, elegido: int | None, del_plan: set[int], cant_operarios: int | None) -> str | None:
    """Si el paso cuenta para esta persona, y por qué: «ot» (elegida a mano) o «plan».
    None si no le toca. Ver la regla en el docstring del módulo."""
    if elegido is not None:
        if (cant_operarios or 1) > 1 and elegido in del_plan and id_operario in del_plan:
            return "ot" if id_operario == elegido else "plan"
        return "ot" if id_operario == elegido else None
    return "plan" if id_operario in del_plan else None


def trabajado_en(paso: dict, ini_p: datetime | None, fin_p: datetime | None,
                 ahora: datetime) -> bool:
    """Si el paso se trabajó en [ini_p, fin_p): arrancó antes de que termine el período y
    no terminó antes de que empiece (uno sin fin sigue abierto hasta ahora)."""
    ini_p = ini_p or datetime.min
    fin_p = fin_p or datetime.max
    return paso["inicio_real"] < fin_p and (fecha_real(paso["fin_real"]) or ahora) >= ini_p


def pausas_por_orden(pausas) -> dict[int, list]:
    salida: dict[int, list] = defaultdict(list)
    for pausa in pausas or []:
        salida[pausa.id_orden_trabajo].append(pausa)
    return salida


def dato_roto(paso: dict) -> str | None:
    """Por qué no hay cuenta honesta de este paso (una clave de SIN_DATOS_TEXTO), o None.

    · Terminado y sin fin: no se sabe hasta cuándo se trabajó.
    · El fin antes del arranque.
    · PENDIENTE con arranque: la app lo borra al volver a Pendiente, pero el sistema viejo
      o una OT migrada lo pueden traer. Contarlo «en curso» porque no tiene fin es darle
      una jornada entera por cada día hábil desde ese arranque a alguien que ni lo tocó.
      En curso es sólo lo que está EN PROCESO (id_estado = 2).
    """
    fin = fecha_real(paso["fin_real"])
    if paso["id_estado"] == 3 and fin is None:
        return "terminado_sin_fin"
    if fin is not None and fin < paso["inicio_real"]:
        return "fin_antes_del_arranque"
    if paso["id_estado"] not in (2, 3):
        return "pendiente_con_arranque"
    return None


def en_curso(paso: dict, t) -> bool:
    """Sigue abierto: EN PROCESO y sin fin. No alcanza con que falte el fin."""
    return bool(t is not None and t.en_curso and paso["id_estado"] == 2)


def abierto_de_mas(paso: dict, t) -> bool:
    """En curso y con más trabajo acumulado del que es creíble sin que nadie lo cierre:
    más de TOPE_JORNADAS_ABIERTO jornadas efectivas y más del doble de lo estimado."""
    if not en_curso(paso, t):
        return False
    tope = max(TOPE_JORNADAS_ABIERTO * MINUTOS_JORNADA, 2 * (paso["tiempo_proceso"] or 0))
    return t.efectivo > tope


def _fecha_del_historial(texto) -> datetime | None:
    """El «antes» de un cambio del historial de pasos. Por el ORM se guarda como
    «22/09/2026 11:00»; por el UPDATE masivo en SQL, como lo devuelve la base."""
    if texto is None or texto == "":
        return None
    if isinstance(texto, datetime):
        return texto
    limpio = str(texto).strip()
    for formato in ("%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"):
        try:
            return datetime.strptime(limpio, formato)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(limpio.replace("T", " "))
    except ValueError:
        return None


def cerrados_del_historial(filas) -> dict[int, list[Tramo]]:
    """{paso: [(desde, hasta)]} en que cada paso estuvo TERMINADO antes de que alguien le
    cambiara el fin: lo reabrió (fin → vacío) o lo volvió a terminar encima (fin → otro).

    Sale del historial de pasos de la OT (auditoria_proceso_ot): cada edición que tocó el
    «fin real» dice cuál era el fin de antes y cuándo se cambió. De ese fin a ese cambio,
    el paso estaba terminado y nadie lo trabajaba. Sin esto, un paso terminado el lunes,
    reabierto el jueves y terminado de nuevo el viernes cuenta como trabajado de lunes a
    viernes (la columna guarda un solo arranque y un solo fin).

    Lo que no está en el historial no se ve: los cambios de antes del 17/09/2026, cuando
    empezó a registrarse, y los que se hagan por fuera de la app.
    """
    salida: dict[int, list[Tramo]] = defaultdict(list)
    for id_otp, cuando, cambios in filas or ():
        if id_otp is None or cuando is None:
            continue
        try:
            lista = json.loads(cambios or "[]")
        except (TypeError, ValueError):
            continue
        for c in lista if isinstance(lista, list) else ():
            if not isinstance(c, dict) or c.get("campo") != "fin real":
                continue
            antes = fecha_real(_fecha_del_historial(c.get("antes")))
            if antes is not None and cuando > antes:
                salida[int(id_otp)].append((antes, cuando))
    return dict(salida)


def tramos_de_ausencia(ausencias, hoy: date) -> list[Tramo]:
    """Los días de ausencia (RF-06) como tramos de reloj: [desde 00:00, vuelve 00:00).
    Una abierta llega hasta el final de hoy; una de «volvió el mismo día» no ocupa nada."""
    salida = []
    for desde, vuelve in ausencias or ():
        fin = vuelve if vuelve is not None else hoy + timedelta(days=1)
        if fin > desde:
            salida.append((datetime.combine(desde, time()), datetime.combine(fin, time())))
    return unir(salida)


def horas_en_el_periodo(medidos, periodo: list[Tramo] | None,
                        ausencias: list[Tramo] | None) -> dict:
    """Las horas que trabajó la persona en el período: UNA sola cuenta, la misma para la
    solapa Tiempos (RF-06) y para el reporte de Rendimiento (RF-07).

    `medidos` son (fila, tramos) de cada paso (tramos None si no se pudo medir). Las
    horas son el efectivo de todos los pasos:
      · recortado al período (sin período, toda la historia);
      · unido: la hora en que tenía dos pasos abiertos a la vez cuenta una vez;
      · sin los días en que figura ausente (una ausencia cargada o el Ausente de la
        ficha): esa jornada no la trabajó, aunque un paso suyo siguiera abierto;
      · sin los pasos «¿quedó abierto?» (ver abierto_de_mas).
    Lo que se sacó se devuelve aparte, para decirlo.
    """
    contados: list[Tramo] = []
    por_paso = 0
    abiertos = {"pasos": 0, "minutos": 0}
    for fila, tramos in medidos:
        if tramos is None:
            continue
        propios = (interseccion(tramos.efectivos, periodo) if periodo is not None
                   else unir(tramos.efectivos))
        if fila.get("abierto_de_mas"):
            abiertos["pasos"] += 1
            abiertos["minutos"] += minutos(propios)
            continue
        por_paso += minutos(propios)
        contados.extend(propios)
    union = unir(contados)
    en_ausencia = minutos(interseccion(union, ausencias or []))
    return {
        "horas_trabajadas_min": minutos(union) - en_ausencia,
        "superpuesto_min": max(0, por_paso - minutos(union)),
        "en_ausencia_min": en_ausencia,
        "abiertos_de_mas": abiertos,
    }


def fila_de_tarea(paso: dict, t) -> dict:
    """Cómo sale un paso por la API. `t` es su TiempoDePaso (None si el dato está roto)."""
    roto = dato_roto(paso)
    return {
        "id_otp": paso["id_otp"],
        "id_orden_trabajo": paso["id_orden_trabajo"],
        "numero_ot": paso["id_otvieja"] or paso["id_orden_trabajo"],
        "articulo": paso["articulo"],
        "proceso": paso["proceso"],
        "paso": paso["paso"],
        "id_estado": paso["id_estado"],
        "estado": ESTADO_TEXTO.get(paso["id_estado"], "Pendiente"),
        "inicio_real": paso["inicio_real"],
        "fin_real": fecha_real(paso["fin_real"]),
        "en_curso": en_curso(paso, t),
        "sin_datos": t is None,
        # Por qué no se mide (clave y texto), cuando no se mide.
        "sin_datos_motivo": roto if t is None else None,
        "sin_datos_texto": SIN_DATOS_TEXTO.get(roto) if t is None else None,
        "origen": paso["origen"],
        "estimado_min": paso["tiempo_proceso"],
        "corrido_min": t.corrido if t else None,
        "fuera_de_jornada_min": t.fuera_de_jornada if t else None,
        "pausa_min": t.en_pausa if t else None,
        "efectivo_min": t.efectivo if t else None,
        # Se terminó, se reabrió y se volvió a terminar (o se le pisó el fin): el tiempo
        # en que estuvo terminado no cuenta. Ver cerrados_del_historial.
        "cerrado_min": t.cerrado if t else None,
        "reabierto": bool(t and t.cerrado),
        # En proceso desde hace demasiado: ¿quedó abierto sin querer? No suma horas.
        "abierto_de_mas": abierto_de_mas(paso, t),
    }


class TiemposOperarioService:
    def __init__(self, db_session):
        self.db = db_session
        self.repository = TiemposOperarioRepository(db_session)

    async def persona(self, id_operario: int):
        op = await AusenciaRepository(self.db).find_operario(id_operario)
        if op is None:
            raise NotFoundException(f"No existe la persona {id_operario}.")
        return op

    async def pasos_atribuidos(self, id_operario: int) -> list[dict]:
        """Los pasos que arrancaron y le tocan a la persona (la regla de le_toca), de
        toda la historia, con `origen` («ot» o «plan»)."""
        # 1. Los candidatos: los elegidos a mano, y los pasos de las OT donde algún plan
        #    le dio algo.
        elegidos = set(await self.repository.pasadas_elegidas(id_operario))
        ordenes_plan = await self.repository.ordenes_del_plan(id_operario)
        filas_plan = await self.repository.filas_del_plan(ordenes_plan)
        pasos_por_ot_proceso: dict = defaultdict(list)
        for id_otp, id_ot, id_proceso in await self.repository.pasos_de(ordenes_plan):
            pasos_por_ot_proceso[(id_ot, id_proceso)].append(id_otp)
        del_plan = personas_del_ultimo_plan(filas_plan, pasos_por_ot_proceso)
        candidatos = elegidos | {p for p, gente in del_plan.items() if id_operario in gente}

        # 2. Los que arrancaron y le tocan de verdad.
        pasos = []
        for p in await self.repository.pasadas_arrancadas(sorted(candidatos)):
            origen = le_toca(id_operario, p["id_operario_elegido"],
                             del_plan.get(p["id_otp"], set()), p["cant_operarios"])
            if origen is not None:
                pasos.append({**p, "origen": origen})
        return pasos

    async def pausas_y_feriados(self, pasos: list[dict]) -> tuple[dict[int, list], bool, list[date]]:
        """Las pausas de las OT de esos pasos (por OT), si se pudieron leer, y los
        feriados. Sin la tabla de pausas: nada que descontar, y `False` para decirlo."""
        pausas = await self.repository.pausas_sin_romper(sorted({p["id_orden_trabajo"] for p in pasos}))
        feriados = await self.repository.feriados()
        return pausas_por_orden(pausas), pausas is not None, feriados

    @staticmethod
    def pausas_de(paso: dict, pausas_por_ot: dict[int, list]) -> list:
        return pausas_del_paso(pausas_por_ot.get(paso["id_orden_trabajo"], []), paso["id_otp"])

    async def cerrados(self, pasos: list[dict]) -> dict[int, list[Tramo]]:
        """Cuándo estuvo terminado cada paso que después se reabrió (del historial de
        pasos). Sin la tabla de auditoría: nada que sacar."""
        filas = await self.repository.cambios_de_fin_sin_romper(sorted({p["id_otp"] for p in pasos}))
        return cerrados_del_historial(filas)

    async def ausencias(self, id_operario: int, desde: date | None, hasta: date | None,
                        hoy: date) -> list[Tramo] | None:
        """Los días de ausencia de la persona como tramos. None si no se pueden leer."""
        filas = await self.repository.ausencias_sin_romper(id_operario, desde, hasta)
        return None if filas is None else tramos_de_ausencia(filas, hoy)

    def medir(self, paso: dict, pausas_por_ot: dict[int, list], cerrados: dict[int, list],
              *, ahora: datetime, feriados) -> tuple:
        """(TiempoDePaso, TramosDePaso, pausas del paso) de un paso; (None, None, []) si
        el dato está roto. La MISMA medición para la solapa Tiempos y para Rendimiento."""
        if dato_roto(paso):
            return None, None, []
        del_paso = self.pausas_de(paso, pausas_por_ot)
        entrada = [(x.desde, x.hasta) for x in del_paso]
        fin = fecha_real(paso["fin_real"])
        cerrado = cerrados.get(paso["id_otp"], ())
        t = tiempo_de_un_paso(paso["inicio_real"], fin, entrada, ahora=ahora,
                              feriados=feriados, cerrado=cerrado)
        tramos = tramos_de_un_paso(paso["inicio_real"], fin, entrada, ahora=ahora,
                                   feriados=feriados, cerrado=cerrado)
        return t, tramos, del_paso

    async def tareas(self, id_operario: int, desde=None, hasta=None) -> ResponseDTO:
        """Los pasos de OT de la persona que arrancaron, con estimado, corrido y efectivo.

        `desde` / `hasta` (días, incluidos) filtran los que se TRABAJARON en ese período:
        los que arrancaron antes de que termine y terminaron (o siguen) después de que
        empiece. Los minutos de cada paso son los del paso entero, no recortados al
        período. El total de horas del resumen, en cambio, es el del período: la misma
        cuenta que las «horas trabajadas» del reporte de Rendimiento (ver
        horas_en_el_periodo), para que la ficha no diga dos números distintos.
        """
        await self.persona(id_operario)
        p_desde, p_hasta = _leer_fecha(desde, "desde"), _leer_fecha(hasta, "hasta")
        if p_desde and p_hasta and p_hasta < p_desde:
            raise BusinessException("El período termina antes de empezar.")

        pasos = await self.pasos_atribuidos(id_operario)

        # 3. El período: se trabajó en él si arrancó antes de que termine y no terminó
        #    antes de que empiece.
        ahora = ahora_ar()
        periodo = None
        if p_desde or p_hasta:
            ini_p = datetime.combine(p_desde, time()) if p_desde else None
            fin_p = datetime.combine(p_hasta + timedelta(days=1), time()) if p_hasta else None
            periodo = [(ini_p or datetime.min, fin_p or datetime.max)]
            # Un pendiente con arranque no tiene fin y no está en curso: sin esto saldría
            # en todos los períodos que vienen. Va en el que arrancó, como en Rendimiento.
            pasos = [p for p in pasos
                     if (periodo[0][0] <= p["inicio_real"] < periodo[0][1]
                         if dato_roto(p) == "pendiente_con_arranque"
                         else trabajado_en(p, ini_p, fin_p, ahora))]

        # 4. Las pausas de esas OT, los feriados, lo reabierto y las ausencias; la cuenta.
        pausas_por_ot, pausas_disponibles, feriados = await self.pausas_y_feriados(pasos)
        cerrados = await self.cerrados(pasos)
        ausencias = await self.ausencias(id_operario, p_desde, p_hasta, ahora.date())

        tareas, medidos = [], []
        for p in pasos:
            t, tramos, _ = self.medir(p, pausas_por_ot, cerrados, ahora=ahora, feriados=feriados)
            fila = fila_de_tarea(p, t)
            tareas.append(fila)
            medidos.append((fila, tramos))

        # El resumen, de TODAS las tareas: se cuenta antes de recortar la lista.
        con_datos = [t for t in tareas if not t["sin_datos"]]
        horas = horas_en_el_periodo(medidos, periodo, ausencias)
        efectivo_pasos = sum(t["efectivo_min"] for t in con_datos)
        resumen = {
            "tareas": len(tareas),
            "terminadas": sum(1 for t in tareas if t["id_estado"] == 3),
            "en_curso": sum(1 for t in tareas if t["en_curso"]),
            "sin_datos": len(tareas) - len(con_datos),
            "reabiertas": sum(1 for t in tareas if t["reabierto"]),
            "estimado_min": sum(t["estimado_min"] or 0 for t in con_datos),
            "corrido_min": sum(t["corrido_min"] for t in con_datos),
            "pausa_min": sum(t["pausa_min"] for t in con_datos),
            "fuera_de_jornada_min": sum(t["fuera_de_jornada_min"] for t in con_datos),
            # La suma del efectivo de cada paso ENTERO (lo de antes y después del
            # período incluido, y las horas superpuestas dos veces). No es lo trabajado
            # en el período: eso es `trabajado_min`.
            "efectivo_min": efectivo_pasos,
            # Lo trabajado EN el período: igual a las «horas trabajadas» de Rendimiento.
            "trabajado_min": horas["horas_trabajadas_min"],
            "superpuesto_min": horas["superpuesto_min"],
            "en_ausencia_min": horas["en_ausencia_min"],
            "abiertos_de_mas": horas["abiertos_de_mas"],
            # Lo que de los pasos enteros cae antes o después del período.
            "fuera_del_periodo_min": max(0, efectivo_pasos - horas["horas_trabajadas_min"]
                                         - horas["superpuesto_min"] - horas["en_ausencia_min"]
                                         - horas["abiertos_de_mas"]["minutos"]),
        }

        tareas.sort(key=lambda x: x["inicio_real"], reverse=True)
        recortado = len(tareas) > TOPE_TAREAS
        tareas = tareas[:TOPE_TAREAS]

        data = {
            "id_operario": id_operario,
            "periodo": {"desde": p_desde.isoformat() if p_desde else None,
                        "hasta": p_hasta.isoformat() if p_hasta else None},
            "jornada": jornada_en_palabras(),
            # False = la tabla de pausas todavía no está: el efectivo no descuenta pausas.
            "pausas_disponibles": pausas_disponibles,
            # False = la tabla de ausencias todavía no está: las horas no las descuentan.
            "ausencias_disponibles": ausencias is not None,
            "tope_jornadas_abierto": TOPE_JORNADAS_ABIERTO,
            "recortado": recortado,
            "resumen": resumen,
            "tareas": tareas,
        }
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")
