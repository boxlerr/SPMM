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
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi.encoders import jsonable_encoder

from backend.application.PausaService import ahora_ar, pausas_del_paso
from backend.application.TiempoEfectivo import (
    fecha_real,
    jornada_en_palabras,
    tiempo_de_un_paso,
)
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.infrastructure.AusenciaRepository import AusenciaRepository
from backend.infrastructure.TiemposOperarioRepository import TiemposOperarioRepository

ESTADO_TEXTO = {1: "Pendiente", 2: "En proceso", 3: "Terminado"}

# Más que esto en una sola respuesta no se lee en una ficha; se avisa que se recortó.
TOPE_TAREAS = 500


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


def dato_roto(paso: dict) -> bool:
    """Terminado y sin fin (o con el fin antes del arranque): no hay cuenta honesta."""
    fin = fecha_real(paso["fin_real"])
    return (paso["id_estado"] == 3 and fin is None) or (fin is not None and fin < paso["inicio_real"])


def fila_de_tarea(paso: dict, t) -> dict:
    """Cómo sale un paso por la API. `t` es su TiempoDePaso (None si el dato está roto)."""
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
        "en_curso": bool(t.en_curso) if t else False,
        "sin_datos": t is None,
        "origen": paso["origen"],
        "estimado_min": paso["tiempo_proceso"],
        "corrido_min": t.corrido if t else None,
        "fuera_de_jornada_min": t.fuera_de_jornada if t else None,
        "pausa_min": t.en_pausa if t else None,
        "efectivo_min": t.efectivo if t else None,
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

    async def tareas(self, id_operario: int, desde=None, hasta=None) -> ResponseDTO:
        """Los pasos de OT de la persona que arrancaron, con estimado, corrido y efectivo.

        `desde` / `hasta` (días, incluidos) filtran los que se TRABAJARON en ese período:
        los que arrancaron antes de que termine y terminaron (o siguen) después de que
        empiece. Los minutos son los del paso entero, no recortados al período.
        """
        await self.persona(id_operario)
        p_desde, p_hasta = _leer_fecha(desde, "desde"), _leer_fecha(hasta, "hasta")
        if p_desde and p_hasta and p_hasta < p_desde:
            raise BusinessException("El período termina antes de empezar.")

        pasos = await self.pasos_atribuidos(id_operario)

        # 3. El período: se trabajó en él si arrancó antes de que termine y no terminó
        #    antes de que empiece.
        ahora = ahora_ar()
        if p_desde or p_hasta:
            ini_p = datetime.combine(p_desde, time()) if p_desde else None
            fin_p = datetime.combine(p_hasta + timedelta(days=1), time()) if p_hasta else None
            pasos = [p for p in pasos if trabajado_en(p, ini_p, fin_p, ahora)]

        # 4. Las pausas de esas OT y los feriados, y la cuenta.
        pausas_por_ot, pausas_disponibles, feriados = await self.pausas_y_feriados(pasos)

        tareas = []
        for p in pasos:
            t = None
            if not dato_roto(p):
                del_paso = self.pausas_de(p, pausas_por_ot)
                t = tiempo_de_un_paso(p["inicio_real"], fecha_real(p["fin_real"]),
                                      [(x.desde, x.hasta) for x in del_paso],
                                      ahora=ahora, feriados=feriados)
            tareas.append(fila_de_tarea(p, t))

        tareas.sort(key=lambda x: x["inicio_real"], reverse=True)
        recortado = len(tareas) > TOPE_TAREAS
        tareas = tareas[:TOPE_TAREAS]

        con_datos = [t for t in tareas if not t["sin_datos"]]
        resumen = {
            "tareas": len(tareas),
            "terminadas": sum(1 for t in tareas if t["id_estado"] == 3),
            "en_curso": sum(1 for t in tareas if t["en_curso"]),
            "estimado_min": sum(t["estimado_min"] or 0 for t in con_datos),
            "corrido_min": sum(t["corrido_min"] for t in con_datos),
            "pausa_min": sum(t["pausa_min"] for t in con_datos),
            "fuera_de_jornada_min": sum(t["fuera_de_jornada_min"] for t in con_datos),
            "efectivo_min": sum(t["efectivo_min"] for t in con_datos),
        }
        data = {
            "id_operario": id_operario,
            "periodo": {"desde": p_desde.isoformat() if p_desde else None,
                        "hasta": p_hasta.isoformat() if p_hasta else None},
            "jornada": jornada_en_palabras(),
            # False = la tabla de pausas todavía no está: el efectivo no descuenta pausas.
            "pausas_disponibles": pausas_disponibles,
            "recortado": recortado,
            "resumen": resumen,
            "tareas": tareas,
        }
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")
