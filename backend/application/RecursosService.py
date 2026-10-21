"""Los recursos del taller —personas y máquinas— para organizar la producción con una IA.

Lucas, 21/10/2026: «tendría que existir un reporte de recursos de la empresa, que sea
sencillo y exportable a Excel»: las personas disponibles con sus habilidades, sus horas por
día y sus días por semana; las máquinas disponibles, qué procesos hace cada una y cuándo
están. «Le entregamos un archivo con las OT pendientes y todos sus procesos, y otro con los
recursos humanos y las máquinas; la IA analiza la capacidad, distribuye los trabajos,
asigna recursos y propone un cronograma.» El de las OT es el reporte «OT pendientes con
sus procesos» del armador; éste es el otro.

NO ES OTRA REGLA: es lo que mira el planificador, dicho en un archivo.

  · Personas: las disponibles («Activo» en su ficha; los «VACANTE … A CUBRIR» son puestos),
    con sus habilidades tal como las arma EquipoService, y su capacidad con SU horario,
    contada como la cuenta el planificador (calendarios_de_operarios): horas EFECTIVAS por
    día —sin el desayuno ni el almuerzo—, los días que trabaja y las horas por semana. Más
    las ausencias cargadas desde hoy: el planificador no las mira (sólo «Ausente», ver
    AusenciaOperario), pero quien arma un cronograma de varias semanas las necesita.
  · Máquinas: todas, con su estado (informativo: el planificador no lo mira), los procesos
    que el planificador les puede dar —los cargados en Recursos y, si no hay, los que
    deduce del nombre y del tipo (MaquinasDelProceso, el 21/10 sólo 14 de las 27 tenían
    procesos cargados)— y quién las puede usar: las personas con un rango que la habilita.
    No tienen horario propio: trabajan cuando trabaja quien las usa, en la jornada del
    taller.
  · La jornada del taller y los feriados de los próximos DIAS_ADELANTE días, con lo que
    eligió el taller (FeriadoRepository.bloquea).

No escribe nada.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import or_, select

from backend.application.EquipoService import armar_equipo
from backend.application.MaquinariaService import ESTADOS_OPERATIVOS, TIPOS_MAQUINA
from backend.application.MaquinasDelProceso import con_maquinas_de_cada_proceso
from backend.application.PlanificacionService import (
    MIN_LABORAL_DIA,
    MIN_LABORAL_SABADO,
    calendarios_de_operarios,
)
from backend.application.TiempoEfectivo import jornada_en_palabras
from backend.domain.AusenciaOperario import MOTIVO_TEXTO, AusenciaOperario
from backend.infrastructure.FeriadoRepository import FeriadoRepository
from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.RangoRepository import RangoRepository
from backend.infrastructure.estado_ordenes import ahora_ar

# Hasta dónde se miran las ausencias cargadas y los feriados: lo que suele abarcar un
# cronograma de producción.
DIAS_ADELANTE = 60

_NOMBRE_DIA = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")


def _horas(minutos: int) -> float:
    return round(minutos / 60, 2)


def capacidad(calendario: dict) -> dict:
    """Las horas de una persona con su horario, en la línea de tiempo del planificador:
    de lunes a viernes, sus minutos de trabajo por día; el sábado, los suyos si lo
    trabaja; el domingo no existe (ver construir_ventanas_semanales)."""
    dias = sorted(d for d in calendario["dias"] if d <= 5)
    de_semana = [d for d in dias if d < 5]
    min_dia = max(0, calendario["hasta"] - calendario["desde"])
    min_sabado = max(0, calendario["hasta_sab"] - calendario["desde_sab"]) if 5 in dias else 0
    return {
        "dias": [_NOMBRE_DIA[d] for d in dias],
        "dias_por_semana": len(dias),
        "horas_por_dia": _horas(min_dia),
        "horas_sabado": _horas(min_sabado) if 5 in dias else None,
        "horas_por_semana": _horas(min_dia * len(de_semana) + min_sabado),
    }


async def _ausencias(db, ids: list[int], hoy: date) -> dict[int, list[dict]]:
    """Las ausencias de esas personas que siguen o empiezan en los próximos días.
    `hasta` es el último día que falta (la tabla guarda `vuelve`, el primero que ya no);
    None: sigue ausente."""
    if not ids:
        return {}
    filas = (await db.execute(
        select(AusenciaOperario)
        .where(AusenciaOperario.id_operario.in_(ids),
               or_(AusenciaOperario.vuelve.is_(None), AusenciaOperario.vuelve > hoy),
               AusenciaOperario.desde <= hoy + timedelta(days=DIAS_ADELANTE))
        .order_by(AusenciaOperario.desde)
    )).scalars().all()
    salida: dict[int, list[dict]] = {}
    for a in filas:
        if a.vuelve is not None and a.vuelve <= a.desde:
            continue  # cero días: un «Ausente» apretado y deshecho el mismo día
        salida.setdefault(a.id_operario, []).append({
            "desde": a.desde.isoformat(),
            "hasta": (a.vuelve - timedelta(days=1)).isoformat() if a.vuelve else None,
            "motivo": MOTIVO_TEXTO.get(a.motivo or "", None),
        })
    return salida


def _texto_del_feriado(f: dict) -> str:
    if f["se_trabaja"] is True:
        return "Se trabaja"
    if f["se_trabaja"] is False:
        return "No se trabaja"
    if f["bloquea"]:
        return "No se trabaja (nadie eligió otra cosa)"
    return "Se trabaja (día no laborable: nadie eligió otra cosa)"


async def armar_recursos(db) -> dict:
    ahora = ahora_ar()
    hoy = ahora.date()

    todos = await OperarioRepository(db).find_all()
    equipo = await armar_equipo(db, todos)
    calendarios = calendarios_de_operarios([o for o in todos if o.disponible])
    ausencias = await _ausencias(db, list(calendarios), hoy)

    personas = []
    for p in equipo["operarios"]:
        personas.append({**p, **capacidad(calendarios[p["id"]]),
                         "ausencias": ausencias.get(p["id"], [])})

    # Los procesos de cada máquina, como los va a usar el planificador: se da vuelta la
    # lista de máquinas de cada proceso del catálogo.
    cobertura = con_maquinas_de_cada_proceso(await RangoRepository(db).find_cobertura())
    procesos_de: dict[int, list[str]] = {}
    for proc in cobertura.get("procesos") or []:
        for m in proc.get("maquinas_efectivas") or []:
            procesos_de.setdefault(m["id"], []).append((proc.get("nombre") or "").strip())

    maquinas = []
    for m in equipo["maquinas"]:
        rangos = set(m["rangos"])
        maquinas.append({
            "id": m["id"],
            "nombre": m["nombre"],
            # Como en la pantalla («Soldadora MIG/MAG»); sin tipo cargado, la familia que
            # deduce el planificador del nombre.
            "tipo": TIPOS_MAQUINA.get(m["tipo"] or m["familia"] or "", m["tipo"] or m["familia"]),
            "estado": ESTADOS_OPERATIVOS.get(m["estado"] or "", m["estado"]),
            "disponible": (m["estado"] or "operativa") == "operativa",
            "procesos": sorted(set(procesos_de.get(m["id"], []))),
            "rangos": m["rangos"],
            # Los rangos se comparan por nombre: los dos salen del mismo catálogo.
            "personas": [p["nombre"] for p in personas if rangos & set(p["rangos"])],
        })

    feriados = [
        {"fecha": f["fecha"], "nombre": f["nombre"], "tipo": f["tipo"],
         "se_trabaja": not f["bloquea"], "texto": _texto_del_feriado(f)}
        for f in await FeriadoRepository(db).listar(hoy, hoy + timedelta(days=DIAS_ADELANTE))
    ]

    sabado_con_gente = any(p["horas_sabado"] is not None for p in personas)
    return {
        "generado": ahora.replace(microsecond=0).isoformat(),
        "hasta": (hoy + timedelta(days=DIAS_ADELANTE)).isoformat(),
        "jornada": {
            "texto": jornada_en_palabras(),
            "horas_por_dia": _horas(MIN_LABORAL_DIA),
            "horas_sabado": _horas(MIN_LABORAL_SABADO),
            "sabado_con_gente": sabado_con_gente,
        },
        "personas": personas,
        "maquinas": maquinas,
        "feriados": feriados,
        "resumen": {
            "personas": len(personas),
            "horas_por_semana": round(sum(p["horas_por_semana"] for p in personas), 2),
            "maquinas": len(maquinas),
            "maquinas_disponibles": sum(1 for m in maquinas if m["disponible"]),
        },
    }
