"""Las habilidades de TODO el equipo, en una sola respuesta.

Reunión con Lucas del 17/10/2026. Para entender por qué el plan del lunes 19 le dio la
fresadora a Gustavo y no a Alejandro hacía falta mirar las habilidades de cada uno, y la
única forma era abrir la ficha de cada persona. Lucas: «un exportable y que lo mandemos a
analizar a la IA»; Julián: «un botón para exportar todas las skills de una».

Es lo que ve el planificador, con su misma regla (ver skills-modelo-nativas-manda):

  · PUEDE hacer un proceso quien lo tiene por su RANGO (rango_proceso) o cargado A MANO
    (operario_proceso_skill.manual), salvo que se lo hayan APAGADO (habilitado = False);
  · SKILL 1 y SKILL 2 sólo dicen a quién PREFERIR, y la posición desempata.

Sólo las personas disponibles (las que entran al planificador: los «VACANTE … A CUBRIR»
son puestos, no personas). Las apagadas salen igual, marcadas: «no la hace» también es un
dato para comparar con el plan. No escribe nada.
"""
from sqlalchemy import select

from backend.application.PlanificacionService import familia_de_maquina
from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.RangoRepository import RangoRepository

_DIAS = {"MON": "lun", "TUE": "mar", "WED": "mié", "THU": "jue", "FRI": "vie", "SAT": "sáb", "SUN": "dom"}


def _horario(o) -> str:
    """«07:00 a 16:00, lun a vie»: como lo diría el taller."""
    desde = o.hora_inicio.strftime("%H:%M") if o.hora_inicio else "07:00"
    hasta = o.hora_fin.strftime("%H:%M") if o.hora_fin else "16:00"
    dias = [d.strip().upper() for d in (o.dias_trabajo or "").split(",") if d.strip()]
    if dias == ["MON", "TUE", "WED", "THU", "FRI"]:
        cuando = "lun a vie"
    elif dias == ["MON", "TUE", "WED", "THU", "FRI", "SAT"]:
        cuando = "lun a sáb"
    else:
        cuando = ", ".join(_DIAS.get(d, d.lower()) for d in dias) or "lun a vie"
    return f"{desde} a {hasta}, {cuando}"


def prioridad_de(nivel, apagada: bool) -> str:
    """El rótulo de una habilidad, el mismo en la pantalla y en los archivos."""
    if apagada:
        return "Apagada (no la hace)"
    if nivel == 1:
        return "SKILL 1"
    if nivel == 2:
        return "SKILL 2"
    return "Sabe (sin marcar)"


async def armar_equipo(db, todos_los_operarios: list | None = None) -> dict:
    """`todos_los_operarios`: los de la base, si quien llama ya los leyó (RecursosService
    los necesita también para el horario): así no se leen dos veces en el mismo pedido."""
    repo_op = OperarioRepository(db)
    if todos_los_operarios is None:
        todos_los_operarios = await repo_op.find_all()
    operarios = [o for o in todos_los_operarios if o.disponible]
    rangos_de: dict[int, set[int]] = {}
    for id_op, id_rango in await repo_op.find_with_rangos():
        rangos_de.setdefault(id_op, set()).add(id_rango)

    repo_rango = RangoRepository(db)
    nombre_rango = {r.id: r.nombre for r in await repo_rango.find_all()}
    procesos_por_rango = await repo_rango.find_procesos_por_rango()   # claves str
    maquinas_por_rango = await repo_rango.find_maquinarias_por_rango()

    repo_proc = ProcesoRepository(db)
    nombre_proceso = {p.id: (p.nombre or f"#{p.id}").strip() for p in await repo_proc.find_all()}
    maquinas_por_proceso = await repo_proc.find_maquinarias_por_proceso()

    filas = (await db.execute(select(OperarioProcesoSkill))).scalars().all()
    override: dict[tuple[int, int], OperarioProcesoSkill] = {
        (f.id_operario, f.id_proceso): f for f in filas}

    salida_ops = []
    for o in sorted(operarios, key=lambda x: (f"{x.nombre} {x.apellido}".strip().upper())):
        mis_rangos = rangos_de.get(o.id, set())
        nativas = {p for r in mis_rangos for p in procesos_por_rango.get(str(r), [])}
        manuales = {p for (op, p), f in override.items() if op == o.id and f.manual}
        habilidades = []
        for id_proc in nativas | manuales:
            f = override.get((o.id, id_proc))
            apagada = f is not None and not f.habilitado
            nivel = f.nivel if (f is not None and f.nivel in (1, 2)) else None
            habilidades.append({
                "id_proceso": id_proc,
                "proceso": nombre_proceso.get(id_proc, f"#{id_proc}"),
                "nivel": nivel,
                "orden": f.orden if (f is not None and nivel is not None) else None,
                "origen": "a_mano" if id_proc not in nativas else "rango",
                "apagada": apagada,
                "prioridad": prioridad_de(nivel, apagada),
            })
        # SKILL 1 primero, en su orden; después SKILL 2; después lo que sabe sin marcar;
        # las apagadas al final.
        habilidades.sort(key=lambda h: (h["apagada"], h["nivel"] or 9,
                                        h["orden"] if h["orden"] is not None else 999,
                                        h["proceso"]))
        salida_ops.append({
            "id": o.id,
            "nombre": f"{o.nombre} {o.apellido}".strip(),
            "categoria": o.categoria,
            "rangos": sorted(nombre_rango.get(r, f"#{r}") for r in mis_rangos),
            "interpreta_planos": bool(o.interpreta_planos),
            "horario": _horario(o),
            "habilidades": habilidades,
        })

    rangos_de_maquina: dict[int, set[int]] = {}
    for id_rango, ids in maquinas_por_rango.items():
        for id_maq in ids:
            rangos_de_maquina.setdefault(id_maq, set()).add(int(id_rango))
    procesos_de_maquina: dict[int, list[str]] = {}
    for id_proc, ids in maquinas_por_proceso.items():
        for id_maq in ids:
            procesos_de_maquina.setdefault(id_maq, []).append(nombre_proceso.get(id_proc, f"#{id_proc}"))

    maquinas = []
    for m in sorted(await MaquinariaRepository(db).find_with_rangos(), key=lambda x: (x.nombre or "")):
        maquinas.append({
            "id": m.id,
            "nombre": (m.nombre or "").strip(),
            "tipo": getattr(m, "tipo", None),
            "familia": familia_de_maquina((m.id, set(), m.nombre, m.cod_maquina, getattr(m, "tipo", None))) or None,
            "estado": getattr(m, "estado_operativo", None),
            "rangos": sorted(nombre_rango.get(r, f"#{r}") for r in rangos_de_maquina.get(m.id, set())),
            "procesos": sorted(procesos_de_maquina.get(m.id, [])),
        })

    return {"operarios": salida_ops, "maquinas": maquinas}
