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


class TiemposOperarioService:
    def __init__(self, db_session):
        self.db = db_session
        self.repository = TiemposOperarioRepository(db_session)

    async def tareas(self, id_operario: int, desde=None, hasta=None) -> ResponseDTO:
        """Los pasos de OT de la persona que arrancaron, con estimado, corrido y efectivo.

        `desde` / `hasta` (días, incluidos) filtran los que se TRABAJARON en ese período:
        los que arrancaron antes de que termine y terminaron (o siguen) después de que
        empiece. Los minutos son los del paso entero, no recortados al período.
        """
        op = await AusenciaRepository(self.db).find_operario(id_operario)
        if op is None:
            raise NotFoundException(f"No existe la persona {id_operario}.")
        p_desde, p_hasta = _leer_fecha(desde, "desde"), _leer_fecha(hasta, "hasta")
        if p_desde and p_hasta and p_hasta < p_desde:
            raise BusinessException("El período termina antes de empezar.")

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

        # 2. Los que arrancaron y le tocan de verdad (la regla de le_toca).
        pasos = []
        for p in await self.repository.pasadas_arrancadas(sorted(candidatos)):
            origen = le_toca(id_operario, p["id_operario_elegido"],
                             del_plan.get(p["id_otp"], set()), p["cant_operarios"])
            if origen is not None:
                pasos.append({**p, "origen": origen})

        # 3. El período: se trabajó en él si arrancó antes de que termine y no terminó
        #    antes de que empiece.
        ahora = ahora_ar()
        if p_desde or p_hasta:
            ini_p = datetime.combine(p_desde, time()) if p_desde else datetime.min
            fin_p = datetime.combine(p_hasta + timedelta(days=1), time()) if p_hasta else datetime.max
            pasos = [p for p in pasos
                     if p["inicio_real"] < fin_p and (fecha_real(p["fin_real"]) or ahora) >= ini_p]

        # 4. Las pausas de esas OT y los feriados, y la cuenta.
        pausas = await self.repository.pausas_sin_romper(sorted({p["id_orden_trabajo"] for p in pasos}))
        feriados = await self.repository.feriados()
        pausas_por_ot: dict[int, list] = defaultdict(list)
        for pausa in pausas or []:
            pausas_por_ot[pausa.id_orden_trabajo].append(pausa)

        tareas = []
        for p in pasos:
            fin = fecha_real(p["fin_real"])
            terminado = p["id_estado"] == 3
            # Terminado y sin fin (o con el fin antes del arranque): el dato está roto y
            # no hay cuenta honesta. Se muestra, pero sin minutos y fuera de los totales.
            sin_datos = (terminado and fin is None) or (fin is not None and fin < p["inicio_real"])
            t = None
            if not sin_datos:
                del_paso = pausas_del_paso(pausas_por_ot.get(p["id_orden_trabajo"], []), p["id_otp"])
                t = tiempo_de_un_paso(p["inicio_real"], fin, [(x.desde, x.hasta) for x in del_paso],
                                      ahora=ahora, feriados=feriados)
            tareas.append({
                "id_otp": p["id_otp"],
                "id_orden_trabajo": p["id_orden_trabajo"],
                "numero_ot": p["id_otvieja"] or p["id_orden_trabajo"],
                "articulo": p["articulo"],
                "proceso": p["proceso"],
                "paso": p["paso"],
                "id_estado": p["id_estado"],
                "estado": ESTADO_TEXTO.get(p["id_estado"], "Pendiente"),
                "inicio_real": p["inicio_real"],
                "fin_real": fin,
                "en_curso": bool(t.en_curso) if t else False,
                "sin_datos": sin_datos,
                "origen": p["origen"],
                "estimado_min": p["tiempo_proceso"],
                "corrido_min": t.corrido if t else None,
                "fuera_de_jornada_min": t.fuera_de_jornada if t else None,
                "pausa_min": t.en_pausa if t else None,
                "efectivo_min": t.efectivo if t else None,
            })

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
            "pausas_disponibles": pausas is not None,
            "recortado": recortado,
            "resumen": resumen,
            "tareas": tareas,
        }
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")
