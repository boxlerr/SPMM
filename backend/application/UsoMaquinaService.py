"""Las horas de uso de cada máquina (RF-10).

Los tramos los escribe solo el cambio de estado de los pasos (ver
infrastructure/UsoMaquinaRepository.py). Acá se miden y se suman.

DOS HORAS DISTINTAS, LAS DOS A LA VISTA

  · CORRIDAS: el reloj, del arranque al fin. Cuentan la noche y el fin de semana.
  · EFECTIVAS: lo que cae adentro de la jornada del taller menos lo que el paso o su OT
    estuvieron en pausa (RF-03). Es la MISMA cuenta que el tiempo efectivo de RF-06
    (application/TiempoEfectivo.py), con la misma jornada del planificador: no hay una
    segunda jornada para las máquinas. Las horas «de uso» son éstas, y son las que
    cuentan para el mantenimiento por horas.

LAS HORAS DE UN PERÍODO

  · RECORTADAS AL PERÍODO: un tramo del 28 al 3 aporta al mes pasado lo del 28 al 31.
  · CADA HORA UNA VEZ: si la máquina tenía dos pasos abiertos a la vez (pasa: se
    arrancan juntos), esa hora es una hora de máquina, no dos. Lo superpuesto se dice.
  · NO SUMAN: lo arrancado con la máquina fuera de servicio, lo que volvió a Pendiente,
    el tramo que sigue abierto aunque su paso ya no esté en proceso (se borró el paso o
    se cambió por un camino que no avisa) y el que lleva abierto demasiado (el mismo
    «¿quedó abierto?» de RF-06: más de 5 jornadas y del doble de lo estimado). Se
    muestran en la lista, marcados, y se cuentan aparte.

Un tramo cerrado muestra las horas que se le midieron AL CERRARLO (el registro no cambia
después); la suma del período se vuelve a medir con las pausas de hoy, porque tiene que
recortar. Si alguien corrige una pausa vieja, el total la sigue y el renglón no.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi.encoders import jsonable_encoder

from backend.application.AusenciaService import dia_en_rango, leer_fecha
from backend.application.PausaService import ahora_ar, pausas_del_paso
from backend.application.TiempoEfectivo import (
    MINUTOS_JORNADA,
    Tramo,
    interseccion,
    jornada_en_palabras,
    minutos,
    tiempo_de_un_paso,
    tramos_de_un_paso,
    unir,
)
from backend.application.TiemposOperarioService import TOPE_JORNADAS_ABIERTO
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.domain.UsoMaquina import (
    NO_SUMA_FUERA_DE_SERVICIO,
    NO_SUMA_VUELTA_A_PENDIENTE,
    UsoMaquina,
)
from backend.infrastructure.DiaBloqueadoRepository import feriados_sin_romper
from backend.infrastructure.TiemposOperarioRepository import TiemposOperarioRepository
from backend.infrastructure.UsoMaquinaRepository import UsoMaquinaRepository

# Por qué un tramo no suma, como lo lee la pantalla.
SIN_CIERRE = "SIN_CIERRE"
ABIERTO_DE_MAS = "ABIERTO_DE_MAS"
NO_SUMA_TEXTO = {
    NO_SUMA_FUERA_DE_SERVICIO: "Se arrancó con la máquina fuera de servicio: no suma horas.",
    NO_SUMA_VUELTA_A_PENDIENTE: "El paso volvió a Pendiente: no cuenta como uso.",
    SIN_CIERRE: ("Sigue abierto pero el paso ya no está en proceso (se borró o se cambió por "
                 "otro camino): no se sabe hasta cuándo se usó y no suma."),
    ABIERTO_DE_MAS: ("Lleva abierto más de lo creíble (más de 5 jornadas y del doble de lo "
                     "estimado): ¿quedó abierto sin querer? No suma hasta que se cierre."),
}

# Más renglones que esto en una respuesta no se leen; los totales son de todos.
TOPE_USOS = 500


def _al_minuto(d: datetime) -> datetime:
    return d.replace(second=0, microsecond=0)


def periodo_de(desde, hasta) -> tuple[date | None, date | None, datetime | None, datetime | None]:
    """Los días que se piden (incluidos) y el tramo de reloj [desde 00:00, hasta+1 00:00)."""
    p_desde = dia_en_rango(leer_fecha(desde, "desde"), "desde")
    p_hasta = dia_en_rango(leer_fecha(hasta, "hasta"), "hasta")
    if p_desde and p_hasta and p_hasta < p_desde:
        raise BusinessException("El período termina antes de empezar.")
    ini = datetime.combine(p_desde, time()) if p_desde else None
    fin = datetime.combine(p_hasta + timedelta(days=1), time()) if p_hasta else None
    return p_desde, p_hasta, ini, fin


def por_que_no_suma(uso, paso_hoy: dict | None, t) -> str | None:
    """Por qué este tramo no suma horas (una clave de NO_SUMA_TEXTO), o None si suma."""
    if uso.no_suma:
        return uso.no_suma
    if uso.fin is None:
        if paso_hoy is None or paso_hoy.get("id_estado") != 2:
            return SIN_CIERRE
        tope = max(TOPE_JORNADAS_ABIERTO * MINUTOS_JORNADA, 2 * (paso_hoy.get("tiempo_proceso") or 0))
        if t is not None and t.efectivo > tope:
            return ABIERTO_DE_MAS
    return None


async def pausas_y_feriados(db, ordenes_ids) -> tuple[dict[int, list], bool, list[date]]:
    """Las pausas de esas OT (por OT) y los feriados. Sin la tabla de pausas, nada que
    descontar y `False` para decirlo."""
    pausas = await TiemposOperarioRepository(db).pausas_sin_romper(sorted(set(ordenes_ids)))
    por_ot: dict[int, list] = {}
    for p in pausas or []:
        por_ot.setdefault(p.id_orden_trabajo, []).append(p)
    return por_ot, pausas is not None, await feriados_sin_romper(db)


def _entrada_de_pausas(uso, pausas_por_ot) -> list[tuple]:
    return [(p.desde, p.hasta) for p in pausas_del_paso(pausas_por_ot.get(uso.id_orden_trabajo, []), uso.id_otp)]


async def medir_al_cerrar(db, usos: list[UsoMaquina], cuando: datetime) -> None:
    """Escribe corrido y efectivo de los tramos que se están cerrando en `cuando`. Lo
    llama el registro (adentro de su savepoint)."""
    pausas_por_ot, _, feriados = await pausas_y_feriados(db, [u.id_orden_trabajo for u in usos])
    for uso in usos:
        t = tiempo_de_un_paso(uso.inicio, max(cuando, uso.inicio), _entrada_de_pausas(uso, pausas_por_ot),
                              ahora=cuando, feriados=feriados)
        uso.corrido_min = t.corrido if t else 0
        uso.efectivo_min = t.efectivo if t else 0


def sumar(medidos: list[tuple[dict, object]], periodo: Tramo | None, ahora: datetime) -> dict:
    """Las horas de un conjunto de tramos adentro del período (sin período, todo).

    `medidos` son (renglón, TramosDePaso) de cada tramo. Sólo suman los renglones con
    `suma`. Efectivas y corridas, cada una recortada y unida (cada hora una vez).
    """
    efectivos, corridos, por_tramo = [], [], 0
    pasos = en_curso = 0
    for fila, tramos in medidos:
        if not fila["suma"] or tramos is None:
            continue
        propios = interseccion(tramos.efectivos, [periodo]) if periodo else unir(tramos.efectivos)
        por_tramo += minutos(propios)
        efectivos.extend(propios)
        ini = _al_minuto(fila["_inicio"])
        fin = _al_minuto(fila["_fin"] or ahora)
        if periodo:
            ini, fin = max(ini, periodo[0]), min(fin, periodo[1])
        if fin > ini:
            corridos.append((ini, fin))
        pasos += 1
        en_curso += 1 if fila["en_curso"] else 0
    union = unir(efectivos)
    return {
        "efectivo_min": minutos(union),
        "corrido_min": minutos(corridos),
        "superpuesto_min": max(0, por_tramo - minutos(union)),
        "pasos": pasos,
        "en_curso": en_curso,
    }


class UsoMaquinaService:
    def __init__(self, db_session):
        self.db = db_session
        self.repository = UsoMaquinaRepository(db_session)

    async def _maquina(self, id_maquinaria: int):
        from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
        m = await MaquinariaRepository(self.db).find_by_id(id_maquinaria)
        if m is None:
            raise NotFoundException(f"No existe la máquina {id_maquinaria}.")
        return m

    async def medir(self, usos: list[UsoMaquina], ahora: datetime) -> tuple[list[tuple[dict, object]], bool]:
        """(renglón, tramos) de cada tramo, y si se pudieron leer las pausas."""
        pausas_por_ot, pausas_ok, feriados = await pausas_y_feriados(self.db, [u.id_orden_trabajo for u in usos])
        pasos_hoy = await self.repository.pasos_de([u.id_otp for u in usos if u.fin is None])
        salida = []
        for u in usos:
            entrada = _entrada_de_pausas(u, pausas_por_ot)
            t = tiempo_de_un_paso(u.inicio, u.fin, entrada, ahora=ahora, feriados=feriados)
            tramos = tramos_de_un_paso(u.inicio, u.fin, entrada, ahora=ahora, feriados=feriados)
            motivo = por_que_no_suma(u, pasos_hoy.get(int(u.id_otp)), t)
            cerrado = u.fin is not None
            fila = {
                "id": u.id,
                "id_maquinaria": u.id_maquinaria,
                "id_orden_trabajo": u.id_orden_trabajo,
                "numero_ot": u.numero_ot or u.id_orden_trabajo,
                "id_otp": u.id_otp,
                "paso": u.paso,
                "proceso": u.nombre_proceso,
                "operario": u.operario,
                "origen_maquina": u.origen_maquina,
                "inicio": u.inicio,
                "fin": u.fin,
                "en_curso": not cerrado and motivo is None,
                # El registro de un tramo cerrado: lo que se le midió al cerrarlo.
                "corrido_min": (u.corrido_min if cerrado and u.corrido_min is not None
                                else (t.corrido if t else 0)),
                "efectivo_min": (u.efectivo_min if cerrado and u.efectivo_min is not None
                                 else (t.efectivo if t else 0)),
                "suma": motivo is None,
                "no_suma": motivo,
                "no_suma_texto": NO_SUMA_TEXTO.get(motivo) if motivo else None,
                "usuario_inicio": u.usuario_inicio,
                "usuario_fin": u.usuario_fin,
                # Para sumar (no salen por la API).
                "_inicio": u.inicio,
                "_fin": u.fin,
            }
            salida.append((fila, tramos))
        return salida, pausas_ok

    @staticmethod
    def _publico(fila: dict) -> dict:
        return {k: v for k, v in fila.items() if not k.startswith("_")}

    async def uso_de_la_maquina(self, id_maquinaria: int, desde=None, hasta=None) -> ResponseDTO:
        """Los tramos de uso de una máquina que tocan el período, con las horas."""
        m = await self._maquina(id_maquinaria)
        p_desde, p_hasta, ini, fin = periodo_de(desde, hasta)
        ahora = ahora_ar()
        usos = await self.repository.usos(ids_maquina=[id_maquinaria], desde=ini, hasta=fin)
        medidos, pausas_ok = await self.medir(usos, ahora)
        periodo = (ini or datetime.min, fin or datetime.max) if (ini or fin) else None
        resumen = sumar(medidos, periodo, ahora)
        resumen["no_suman"] = sum(1 for f, _ in medidos if not f["suma"])
        resumen["fuera_de_servicio"] = sum(1 for f, _ in medidos if f["no_suma"] == NO_SUMA_FUERA_DE_SERVICIO)
        filas = [self._publico(f) for f, _ in medidos]
        recortado = len(filas) > TOPE_USOS
        data = {
            "id_maquinaria": m.id,
            "maquina": m.nombre,
            "estado_operativo": m.estado_operativo,
            "periodo": {"desde": p_desde.isoformat() if p_desde else None,
                        "hasta": p_hasta.isoformat() if p_hasta else None},
            "jornada": jornada_en_palabras(),
            "pausas_disponibles": pausas_ok,
            "resumen": resumen,
            "recortado": recortado,
            "usos": filas[:TOPE_USOS],
        }
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")

    async def horas_por_maquina(self, ini: datetime | None, fin: datetime | None,
                                ahora: datetime) -> dict[int, dict]:
        """{máquina: horas del período} de TODAS las máquinas con uso en el período."""
        usos = await self.repository.usos(ids_maquina=None, desde=ini, hasta=fin)
        medidos, _ = await self.medir(usos, ahora)
        por_maquina: dict[int, list] = {}
        for fila, tramos in medidos:
            por_maquina.setdefault(fila["id_maquinaria"], []).append((fila, tramos))
        periodo = (ini or datetime.min, fin or datetime.max) if (ini or fin) else None
        return {id_m: sumar(lista, periodo, ahora) for id_m, lista in por_maquina.items()}

    async def minutos_desde(self, desde_por_maquina: dict[int, datetime], ahora: datetime) -> dict[int, int]:
        """Minutos de uso EFECTIVO de cada máquina desde su fecha (el último mantenimiento)."""
        if not desde_por_maquina:
            return {}
        primero = min(desde_por_maquina.values())
        usos = await self.repository.usos(ids_maquina=sorted(desde_por_maquina), desde=primero, hasta=None)
        medidos, _ = await self.medir(usos, ahora)
        salida = {}
        for id_m, desde in desde_por_maquina.items():
            propios = [(f, t) for f, t in medidos if f["id_maquinaria"] == id_m]
            salida[id_m] = sumar(propios, (desde, datetime.max), ahora)["efectivo_min"]
        return salida
