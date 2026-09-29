"""
Limpieza del catálogo de procesos — reunión con Lucas del 29/9/2026.

    .venv/bin/python -m backend.scripts.limpiar_catalogo_procesos            # en seco
    .venv/bin/python -m backend.scripts.limpiar_catalogo_procesos --aplicar  # escribe

POR QUÉ. El catálogo tenía 415 procesos para ~180 de verdad. 234 eran variantes de texto
libre que el sync viejo daba de alta hasta el 2/9 («TORNO T1 trBAJO 3 dias 24h»,
«FRESADORA CNCC»): no son de la lista del Integral y ninguna OT los usa, pero aparecen al
cargar una OT y en Recursos, y ahí se cargaban skills y rangos en el duplicado equivocado.
Y Lucas pidió procesos con nombre GENÉRICO, con la máquina aparte (ver catalogo_procesos):
TORNEADO en vez de «TORNO T1» a «T6», FRESADO CONVENCIONAL en vez de «FRESADORA F6» a
«F9», y sin «CNC» en el nombre va a las máquinas convencionales.

QUÉ HACE, todo en UNA transacción y con respaldo de lo que toca antes de escribir:

  1. FUSIONES: las pasadas de las OT, los rangos, las skills, las máquinas, las fotos de
     versiones y el borrador del plan que apuntaban al proceso que se va pasan al que
     queda, y el que se va se borra. Si el que queda ya tiene rangos (o una skill de esa
     persona, o máquinas), MANDA LO SUYO: lo del que se va sólo completa lo que falta.
     Así una fusión no le abre un proceso a nadie. Donde los dos tenían rangos distintos
     (CORTE CON AMOLADORA) el que queda es el que coincide con el Excel «Rangos y
     Procesos METLO» del 29/9.
  2. RENOMBRES: los genéricos, y los gemelos con doble espacio quedan con uno solo.
  3. BASURA: se borran los procesos que no son de la lista del Integral y no tienen
     NINGUNA referencia (pasada de OT, rango, skill, máquina, incidencia, plan, uso de
     máquina, auditoría, borrador). No se pierde nada. Sí pueden aparecer en fotos viejas
     de versiones (las de antes de la recarga del 23/9): restaurar una de esas da error
     sin tocar nada, y el proceso está en el respaldo si hiciera falta volver a crearlo.
  4. TIPO de las 13 máquinas de torno y fresadora, con lo que dijo Lucas en la reunión
     (6 tornos + 3 CNC, fresadoras 1, 2 y Van Norman + 1 CNC). Sólo si está vacío.

En seco hace EXACTAMENTE lo mismo —mismas consultas, mismos controles— y al final
deshace la transacción. Con --aplicar confirma sólo si pasan todos los controles.

ORDEN: primero se sube el backend que entiende los nombres nuevos (TORNEADO, FRESADO...
y las familias CNC). Con el backend viejo, TORNEADO no dice «TORNO» y el planificador lo
dejaría sin máquina.

Respaldo: tablas backup_<fecha>_catalogo_*. Vuelta atrás: ver `VUELTA_ATRAS` más abajo.
"""
import asyncio
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from backend.application.catalogo_procesos import nombre_en_spmm
from backend.application.PlanificacionService import _get_tipo_proceso, familia_requerida_from_proceso

APLICAR = "--aplicar" in sys.argv

_TZ_AR = timezone(timedelta(hours=-3))


@dataclass(frozen=True)
class Fusion:
    """El proceso `queda` absorbe a los de `absorbe` y, si hay `nombre_nuevo`, se renombra.

    Los nombres están escritos tal cual están en la base: si alguien los cambió desde
    la medición, el script no adivina y frena."""
    queda: int
    nombre_actual: str
    nombre_nuevo: str | None = None
    absorbe: dict = field(default_factory=dict)   # {id: nombre actual}
    descripcion: str | None = None                # sólo si el proceso no tiene


FUSIONES = [
    Fusion(151, "TORNO T1", "TORNEADO",
           {152: "TORNO T2", 153: "TORNO T3", 154: "TORNO T4", 155: "TORNO T5", 156: "TORNO T6"},
           "Torneado en torno convencional; el planificador elige cuál. "
           "En el sistema viejo: TORNO T1 a TORNO T6."),
    Fusion(68, "FRESADORA F6", "FRESADO CONVENCIONAL",
           {69: "FRESADORA F7", 70: "FRESADORA F8", 71: "FRESADORA F9"},
           "Fresado en fresadora convencional; el planificador elige cuál. "
           "En el sistema viejo: FRESADORA F6 a FRESADORA F9."),
    Fusion(150, "TORNO CNC", "TORNEADO CNC", {},
           "Torneado en torno CNC; el planificador elige cuál. En el sistema viejo: TORNO CNC."),
    Fusion(67, "FRESADORA CNC", "FRESADO CNC", {},
           "Fresado en la fresadora CNC. En el sistema viejo: FRESADORA CNC."),
    # Gemelos que difieren en un espacio. Los dos tienen OT; queda el de más uso.
    Fusion(31, "CORTE CON  AMOLADORA", "CORTE CON AMOLADORA", {222: "CORTE CON AMOLADORA"}),
    Fusion(256, "ENSAMBLAJE, PUNTEADO  Y ESCUADRADO", "ENSAMBLAJE, PUNTEADO Y ESCUADRADO",
           {6224: "ENSAMBLAJE, PUNTEADO Y ESCUADRADO"}),
    Fusion(118, "REBARBADO  TERMINACION", "REBARBADO TERMINACION", {6220: "REBARBADO TERMINACION"}),
    # Errores de tipeo: queda el bien escrito, que es el que tiene rango y skills.
    Fusion(4, "AJUSTE PARA BUJE", None, {3204: "AGUSTE PARA BUJE"},
           "En el sistema viejo: AGUSTE PARA BUJE."),
    Fusion(174, "BICELADO PARA SOLDADURA", None, {3181: "VICELADO PARA SOLDADURA"},
           "En el sistema viejo: VICELADO PARA SOLDADURA."),
    Fusion(137, "SOLDADURA CON ELECTRODO INOXIDABLE", None, {141: "SOLDADURA CUN ELECTRODO INOXIDABLE"}),
    Fusion(138, "SOLDADURA CON MIG", None, {335: "SOLDADURA MIG"}),
]

# Basura con una skill suelta, sin equivalente en el catálogo. La skill (manual, de Nahuel
# Baez) estaba en un proceso que ninguna OT usa, así que nunca tuvo efecto en un plan.
BORRAR_CON_SKILL = {225: "CORTE Y SOLDADO"}

# Lo que dijo Lucas el 29/9 (6 tornos convencionales + 3 CNC; fresadoras 1, 2 y Van
# Norman + 1 CNC). {id: (nombre, tipo)}. El nombre se compara sin espacios de las puntas.
TIPO_MAQUINAS = {
    1: ("TORNO 1", "TORNO"), 2: ("TORNO 2", "TORNO"), 3: ("TORNO 3", "TORNO"),
    4: ("TORNO 4", "TORNO"), 18: ("TORNO 5", "TORNO"), 19: ("TORNO 6 CINDELMET", "TORNO"),
    5: ("TORNO CNC 1", "TORNO_CNC"), 6: ("TORNO CNC 2", "TORNO_CNC"), 7: ("TORNO CNC 3", "TORNO_CNC"),
    9: ("FRESADORA 1", "FRESADORA"), 10: ("FRESADORA 2", "FRESADORA"),
    11: ("FRESADORA VAN NORMAN", "FRESADORA"), 12: ("FRESADORA CNC", "FRESADORA_CNC"),
}

VUELTA_ATRAS = """
  La vuelta atrás es con las tablas de respaldo, en una transacción:
    - proceso: reinsertar las filas borradas y devolverles el nombre y la descripción
      desde backup_<sello>_catalogo_proceso;
    - rango_proceso, operario_proceso_skill y proceso_maquinaria: vaciar las filas de los
      procesos tocados y copiarlas del respaldo;
    - orden_trabajo_proceso: id_proceso desde backup_<sello>_catalogo_otp (por id);
    - orden_trabajo_proceso_version y planificacion_borrador: la columna jsonb desde su
      respaldo (por id);
    - maquinaria.tipo: desde backup_<sello>_catalogo_maquinaria.
"""


# ---------------------------------------------------------------------------
# Lógica pura (sin base): es lo que prueban los tests
# ---------------------------------------------------------------------------
def normalizar(nombre) -> str:
    """Mayúsculas y espacios colapsados, SIN traducir al nombre de SPMM: para saber si un
    nombre es, tal cual, uno de la lista del Integral."""
    return re.sub(r"\s+", " ", nombre or "").strip().upper()


def mapa_de_fusiones(fusiones) -> dict[int, int]:
    """{id que se va: id que queda}."""
    return {viejo: f.queda for f in fusiones for viejo in f.absorbe}


def nombres_finales(fusiones) -> dict[int, str]:
    """{id: nombre con el que queda} para todo proceso que una fusión toca (el que queda y
    los que absorbe). Sirve para reescribir el nombre en el borrador del plan."""
    salida = {}
    for f in fusiones:
        final = f.nombre_nuevo or f.nombre_actual
        salida[f.queda] = final
        for viejo in f.absorbe:
            salida[viejo] = final
    return salida


def es_basura(p: dict, nombres_del_viejo: set, protegidos: set) -> bool:
    """¿Se puede borrar sin perder nada? No es de la lista del Integral —el importador lo
    necesitaría para una OT nueva—, no lo toca ninguna fusión y no lo apunta nadie."""
    if p["id"] in protegidos:
        return False
    if normalizar(p["nombre"]) in nombres_del_viejo:
        return False
    return p["referencias"] == 0


def skills_a_fusionar(filas, mapa):
    """Qué hacer con las skills de los procesos que se van.

    filas: [{"id_operario", "id_proceso", ...}] de los que quedan y de los que se van.
    Manda la fila del que queda. Si esa persona no tiene fila en el que queda, pasa UNA
    de las del que se va (la de menor `orden`, que es la más preferida en su lista) y el
    resto se borra.

    -> (mover [(id_operario, id_viejo, id_nuevo)], borrar [(id_operario, id_viejo)])
    """
    tiene = {(f["id_operario"], f["id_proceso"]) for f in filas if f["id_proceso"] not in mapa}
    candidatas = sorted(
        (f for f in filas if f["id_proceso"] in mapa),
        key=lambda f: (f["id_operario"], f.get("orden") if f.get("orden") is not None else 10**6,
                       f["id_proceso"]))
    mover, borrar = [], []
    for f in candidatas:
        destino = mapa[f["id_proceso"]]
        if (f["id_operario"], destino) in tiene:
            borrar.append((f["id_operario"], f["id_proceso"]))
        else:
            mover.append((f["id_operario"], f["id_proceso"], destino))
            tiene.add((f["id_operario"], destino))
    return mover, borrar


def filas_por_proceso_a_fusionar(filas, mapa, col):
    """Lo mismo para rangos o máquinas del proceso (`col` = id_rango / id_maquinaria):
    si el que queda ya tiene alguno, manda lo suyo; si no tiene ninguno, se queda con los
    de los que se van.

    -> (mover [(valor, id_viejo, id_nuevo)], borrar [(valor, id_viejo)])
    """
    del_que_queda = defaultdict(set)
    for f in filas:
        if f["id_proceso"] not in mapa:
            del_que_queda[f["id_proceso"]].add(f[col])
    ya_tenia = {p for p, vals in del_que_queda.items() if vals}
    mover, borrar = [], []
    for f in sorted((f for f in filas if f["id_proceso"] in mapa), key=lambda f: (f["id_proceso"], f[col])):
        destino = mapa[f["id_proceso"]]
        if destino in ya_tenia or f[col] in del_que_queda[destino]:
            borrar.append((f[col], f["id_proceso"]))
        else:
            mover.append((f[col], f["id_proceso"], destino))
            del_que_queda[destino].add(f[col])
    return mover, borrar


_CLAVE_EDICION = re.compile(r"^(\d+)-(\d+)-(\d+)$")


def reescribir_json(obj, mapa, nombres):
    """Recorre el contenido de un borrador (o una foto de versión) y pasa los procesos
    que se van al que queda. Devuelve (objeto nuevo, cantidad de cambios).

      · "proceso_id" / "id_proceso": el id que se va → el que queda;
      · "nombre_proceso" de un proceso tocado → su nombre final (si no, el borrador
        seguiría diciendo «TORNO T2» hasta recalcular);
      · las claves «orden-proceso-secuencia» de las ediciones a mano del plan. Sólo
        adentro de "ediciones": en otro lado una clave con esa forma puede ser una fecha.
    """
    cambios = 0

    def walk(x, padre=None):
        nonlocal cambios
        if isinstance(x, list):
            return [walk(v) for v in x]
        if not isinstance(x, dict):
            return x
        nuevo = {}
        for k, v in x.items():
            m = _CLAVE_EDICION.match(k) if padre == "ediciones" and isinstance(k, str) else None
            if m and int(m.group(2)) in mapa:
                k = f"{m.group(1)}-{mapa[int(m.group(2))]}-{m.group(3)}"
                cambios += 1
            nuevo[k] = walk(v, k)
        pid = None
        for clave in ("proceso_id", "id_proceso"):
            val = nuevo.get(clave)
            if isinstance(val, int) and not isinstance(val, bool):
                pid = val
                if val in mapa:
                    nuevo[clave] = mapa[val]
                    cambios += 1
        if pid is not None and pid in nombres and "nombre_proceso" in nuevo \
                and nuevo["nombre_proceso"] != nombres[pid]:
            nuevo["nombre_proceso"] = nombres[pid]
            cambios += 1
        return nuevo

    return walk(obj), cambios


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------
def _url():
    from dotenv import find_dotenv, load_dotenv
    load_dotenv(find_dotenv(usecwd=True))
    u = re.sub(r"^postgresql\+\w+://", "postgresql://", os.getenv("SUPABASE_DB_URL")).split("?")[0]
    # Transaction pooler: el 5432 admite 15 clientes para todo el proyecto y es de la app.
    return u.replace(":5432/", ":6543/")


Q_CATALOGO = """
SELECT p.id, p.nombre, p.descripcion,
  (SELECT count(*) FROM orden_trabajo_proceso x WHERE x.id_proceso = p.id)
+ (SELECT count(*) FROM rango_proceso x WHERE x.id_proceso = p.id)
+ (SELECT count(*) FROM operario_proceso_skill x WHERE x.id_proceso = p.id)
+ (SELECT count(*) FROM proceso_maquinaria x WHERE x.id_proceso = p.id)
+ (SELECT count(*) FROM incidencia_proceso x WHERE x.id_proceso = p.id)
+ (SELECT count(*) FROM planificacion x WHERE x.proceso_id = p.id)
+ (SELECT count(*) FROM uso_maquina x WHERE x.id_proceso = p.id)
+ (SELECT count(*) FROM auditoria_proceso_ot x WHERE x.id_proceso = p.id) AS referencias
FROM proceso p ORDER BY p.id
"""


def _jsonb(v):
    return json.loads(v) if isinstance(v, str) else v


async def _respaldar(c, sello, lineas_ids, versiones_ids):
    tablas = {
        "proceso": "SELECT * FROM proceso",
        "rango_proceso": "SELECT * FROM rango_proceso",
        "skill": "SELECT * FROM operario_proceso_skill",
        "proceso_maquinaria": "SELECT * FROM proceso_maquinaria",
        "maquinaria": "SELECT * FROM maquinaria",
        "borrador": "SELECT * FROM planificacion_borrador",
        "otp": "SELECT id, id_orden_trabajo, id_proceso FROM orden_trabajo_proceso "
               f"WHERE id = ANY(ARRAY[{','.join(map(str, lineas_ids)) or 'NULL'}]::bigint[])",
        "version": "SELECT * FROM orden_trabajo_proceso_version "
                   f"WHERE id = ANY(ARRAY[{','.join(map(str, versiones_ids)) or 'NULL'}]::bigint[])",
    }
    for corto, sql in tablas.items():
        nombre = f"backup_{sello}_catalogo_{corto}"
        await c.execute(f"CREATE TABLE {nombre} AS {sql}")
        # Como los demás respaldos: sin RLS, la API REST de Supabase la dejaría leer.
        await c.execute(f"ALTER TABLE {nombre} ENABLE ROW LEVEL SECURITY")
    return [f"backup_{sello}_catalogo_{corto}" for corto in tablas]


async def main():
    import asyncpg
    from backend.scripts.sync_db import _leer

    sello = datetime.now(_TZ_AR).strftime("%Y%m%d_%H%M%S")
    mapa = mapa_de_fusiones(FUSIONES)
    nombres = nombres_finales(FUSIONES)

    print(f"== Limpieza del catálogo de procesos — {'APLICANDO' if APLICAR else 'EN SECO (se deshace al final)'}")
    viejo = await _leer("SELECT proceso, LTRIM(RTRIM(descripcion)) AS nombre FROM dbo.zProcesos")
    nombres_del_viejo = {normalizar(r["nombre"]) for r in viejo if normalizar(r["nombre"])}
    print(f"   Integral: {len(viejo)} procesos, {len(nombres_del_viejo)} nombres distintos")

    c = await asyncpg.connect(_url(), statement_cache_size=0)
    try:
        tr = c.transaction()
        await tr.start()
        terminada = False
        try:
            await c.execute("SET LOCAL lock_timeout = '5s'")
            await c.execute("SET LOCAL statement_timeout = '120s'")

            catalogo = [dict(r) for r in await c.fetch(Q_CATALOGO)]
            por_id = {p["id"]: p for p in catalogo}
            print(f"   SPMM: {len(catalogo)} procesos")

            # ── 0. ¿La base está como cuando se midió? ───────────────────────────
            errores = []
            for f in FUSIONES:
                p = por_id.get(f.queda)
                if not p or p["nombre"] != f.nombre_actual:
                    errores.append(f"el {f.queda} no es {f.nombre_actual!r} (es {p and p['nombre']!r})")
                for vid, vnom in f.absorbe.items():
                    q = por_id.get(vid)
                    if not q or q["nombre"] != vnom:
                        errores.append(f"el {vid} no es {vnom!r} (es {q and q['nombre']!r})")
            for vid, vnom in BORRAR_CON_SKILL.items():
                q = por_id.get(vid)
                if not q or q["nombre"] != vnom:
                    errores.append(f"el {vid} no es {vnom!r} (es {q and q['nombre']!r})")
            if errores:
                print("!! El catálogo cambió desde que se preparó la limpieza; no se toca nada:")
                for e in errores:
                    print("   -", e)
                terminada = True
                await tr.rollback()
                return 2

            # Lo que apunta un borrador no se toca: el borrador lo reescribimos sólo para
            # las fusiones, un proceso borrado ahí quedaría colgando.
            en_borrador = set()
            borradores = [dict(r) for r in await c.fetch("SELECT id, contenido FROM planificacion_borrador")]
            for b in borradores:
                for m in re.finditer(r'"proceso_id": ?(\d+)', json.dumps(_jsonb(b["contenido"]))):
                    en_borrador.add(int(m.group(1)))

            protegidos = {f.queda for f in FUSIONES} | set(mapa) | set(BORRAR_CON_SKILL) | en_borrador
            basura = sorted(p["id"] for p in catalogo if es_basura(p, nombres_del_viejo, protegidos))
            print(f"\n1. BASURA: {len(basura)} procesos que no son del Integral y nadie usa")
            for pid in basura:
                print(f"     {pid:>5} {por_id[pid]['nombre']!r}")

            # ── 1. Lo que apunta a los que se van ────────────────────────────────
            ids_viejos = sorted(mapa)
            lineas = [dict(r) for r in await c.fetch(
                "SELECT id, id_proceso FROM orden_trabajo_proceso WHERE id_proceso = ANY($1::int[])", ids_viejos)]
            versiones = [dict(r) for r in await c.fetch(
                "SELECT id, procesos FROM orden_trabajo_proceso_version")]
            versiones_a_tocar = []
            for v in versiones:
                nuevo, n = reescribir_json(_jsonb(v["procesos"]), mapa, {})
                if n:
                    versiones_a_tocar.append((v["id"], nuevo, n))

            tablas = await _respaldar(c, sello, [l["id"] for l in lineas],
                                      [v[0] for v in versiones_a_tocar])
            print(f"\n   Respaldo: {', '.join(tablas)}")

            # ── 2. Fusiones ───────────────────────────────────────────────────────
            print("\n2. FUSIONES")
            por_viejo = defaultdict(int)
            for l in lineas:
                por_viejo[l["id_proceso"]] += 1
            for f in FUSIONES:
                final = f.nombre_nuevo or f.nombre_actual
                partes = [f"{vid} {vnom!r} ({por_viejo[vid]} pasadas)" for vid, vnom in f.absorbe.items()]
                print(f"   {f.queda:>5} {f.nombre_actual!r} → {final!r}"
                      + (f"  ← absorbe {', '.join(partes)}" if partes else ""))

            for tabla, col in (("orden_trabajo_proceso", "id_proceso"), ("incidencia_proceso", "id_proceso"),
                               ("planificacion", "proceso_id"), ("uso_maquina", "id_proceso")):
                for viejo_id, nuevo_id in mapa.items():
                    await c.execute(f"UPDATE {tabla} SET {col} = $2 WHERE {col} = $1", viejo_id, nuevo_id)
            print(f"   Pasadas de OT que cambian de proceso: {len(lineas)}")

            tocados = sorted(set(mapa) | set(mapa.values()))
            skills = [dict(r) for r in await c.fetch(
                "SELECT * FROM operario_proceso_skill WHERE id_proceso = ANY($1::int[])", tocados)]
            mover, borrar = skills_a_fusionar(skills, mapa)
            for op, viejo_id in borrar:
                await c.execute("DELETE FROM operario_proceso_skill WHERE id_operario = $1 AND id_proceso = $2",
                                op, viejo_id)
            for op, viejo_id, nuevo_id in mover:
                await c.execute("UPDATE operario_proceso_skill SET id_proceso = $3 "
                                "WHERE id_operario = $1 AND id_proceso = $2", op, viejo_id, nuevo_id)
            print(f"   Skills: {len(mover)} pasan al que queda, {len(borrar)} sobraban (esa persona ya la tenía)")

            for tabla, col in (("rango_proceso", "id_rango"), ("proceso_maquinaria", "id_maquinaria")):
                filas = [dict(r) for r in await c.fetch(
                    f"SELECT * FROM {tabla} WHERE id_proceso = ANY($1::int[])", tocados)]
                mover_t, borrar_t = filas_por_proceso_a_fusionar(filas, mapa, col)
                for val, viejo_id in borrar_t:
                    await c.execute(f"DELETE FROM {tabla} WHERE {col} = $1 AND id_proceso = $2", val, viejo_id)
                for val, viejo_id, nuevo_id in mover_t:
                    await c.execute(f"UPDATE {tabla} SET id_proceso = $3 WHERE {col} = $1 AND id_proceso = $2",
                                    val, viejo_id, nuevo_id)
                distintos = [(v, p) for v, p in borrar_t if v not in {
                    x[col] for x in filas if x["id_proceso"] == mapa[p]}]
                print(f"   {tabla}: {len(mover_t)} pasan, {len(borrar_t)} sobraban"
                      + (f" — distintos del que queda, NO se suman: {distintos}" if distintos else ""))

            for vid, nuevo, _n in versiones_a_tocar:
                await c.execute("UPDATE orden_trabajo_proceso_version SET procesos = $2::jsonb WHERE id = $1",
                                vid, json.dumps(nuevo, ensure_ascii=False))
            print(f"   Fotos de versiones reescritas: {len(versiones_a_tocar)}")

            for b in borradores:
                nuevo, n = reescribir_json(_jsonb(b["contenido"]), mapa, nombres)
                if n:
                    await c.execute("UPDATE planificacion_borrador SET contenido = $2::jsonb WHERE id = $1",
                                    b["id"], json.dumps(nuevo, ensure_ascii=False))
                    print(f"   Borrador {b['id']}: {n} cambios (ids y nombres de proceso)")

            await c.execute("DELETE FROM proceso WHERE id = ANY($1::int[])", ids_viejos)
            for f in FUSIONES:
                if f.nombre_nuevo:
                    await c.execute("UPDATE proceso SET nombre = $2 WHERE id = $1", f.queda, f.nombre_nuevo)
                if f.descripcion:
                    await c.execute("UPDATE proceso SET descripcion = $2 WHERE id = $1 "
                                    "AND COALESCE(TRIM(descripcion), '') = ''", f.queda, f.descripcion)

            # ── 3. Basura ─────────────────────────────────────────────────────────
            skills_225 = await c.fetch(
                "SELECT s.*, o.nombre, o.apellido FROM operario_proceso_skill s "
                "JOIN operario o ON o.id = s.id_operario WHERE s.id_proceso = ANY($1::int[])",
                list(BORRAR_CON_SKILL))
            for s in skills_225:
                print(f"\n   {BORRAR_CON_SKILL[s['id_proceso']]!r}: se va con la skill de "
                      f"{s['nombre']} {s['apellido']} (nivel {s['nivel']}, manual={s['manual']})")
            await c.execute("DELETE FROM proceso WHERE id = ANY($1::int[])", basura + list(BORRAR_CON_SKILL))

            # ── 4. Tipo de máquina ────────────────────────────────────────────────
            print("\n4. TIPO DE MÁQUINA")
            maqs = {r["id"]: dict(r) for r in await c.fetch("SELECT id, nombre, tipo FROM maquinaria")}
            for mid, (nom, tipo) in TIPO_MAQUINAS.items():
                m = maqs.get(mid)
                if not m or (m["nombre"] or "").strip() != nom:
                    raise RuntimeError(f"la máquina {mid} no es {nom!r} (es {m and m['nombre']!r})")
                if m["tipo"] and m["tipo"] != tipo:
                    print(f"   {nom}: ya tiene tipo {m['tipo']!r}, no se pisa")
                    continue
                if not m["tipo"]:
                    await c.execute("UPDATE maquinaria SET tipo = $2 WHERE id = $1", mid, tipo)
                print(f"   {nom:<22} {tipo}")

            # ── 5. Controles antes de confirmar ──────────────────────────────────
            print("\n5. CONTROLES")
            quedan = {r["id"]: r["nombre"] for r in await c.fetch("SELECT id, nombre FROM proceso")}
            problemas = []
            colgando = await c.fetchval(
                "SELECT count(*) FROM planificacion WHERE proceso_id IS NOT NULL "
                "AND proceso_id NOT IN (SELECT id FROM proceso)")
            if colgando:
                problemas.append(f"{colgando} filas del plan apuntan a un proceso que no existe")
            # Cada nombre del Integral tiene que caer en UN proceso de SPMM, como lo
            # buscaría el importador. Si no, la próxima OT nueva frena la importación.
            por_clave = defaultdict(list)
            for pid, nom in quedan.items():
                por_clave[nombre_en_spmm(normalizar(nom))].append(pid)
            sin_proceso = sorted(k for k in nombres_del_viejo if not por_clave.get(nombre_en_spmm(k)))
            if sin_proceso:
                problemas.append(f"nombres del Integral sin proceso en SPMM: {sin_proceso}")
            dobles = {k: v for k, v in por_clave.items() if len(v) > 1}
            if dobles:
                problemas.append(f"nombres que siguen repetidos: {dobles}")
            # Ningún proceso tiene que cambiar de familia de máquina por el renombre
            # (TORNEADO sigue siendo torno, FRESADO CNC sigue siendo CNC...). El tipo de
            # proceso sí puede cambiar donde el nombre del Integral estaba mal escrito
            # («AGUSTE» no era AJUSTE para el planificador): se muestra, no frena.
            antes = {**{f.queda: f.nombre_actual for f in FUSIONES},
                     **{vid: vnom for f in FUSIONES for vid, vnom in f.absorbe.items()}}
            for vid, nom in antes.items():
                despues = quedan[mapa.get(vid, vid)]
                fam_antes, fam_despues = familia_requerida_from_proceso(nom), familia_requerida_from_proceso(despues)
                if fam_antes != fam_despues:
                    problemas.append(f"{nom!r} era {fam_antes or 'sin familia'} y queda {fam_despues or 'sin familia'}")
                if _get_tipo_proceso(nom) != _get_tipo_proceso(despues):
                    print(f"   {nom!r} ({por_viejo.get(vid, 0)} pasadas) pasa de "
                          f"{_get_tipo_proceso(nom)} a {_get_tipo_proceso(despues)} como {despues!r}")
            print(f"   Procesos: {len(catalogo)} → {len(quedan)}")
            if not sin_proceso:
                print("   Cada nombre del Integral cae en un solo proceso de SPMM")
            if problemas:
                print("!! NO se confirma:")
                for pr in problemas:
                    print("   -", pr)
                terminada = True
                await tr.rollback()
                return 1

            terminada = True
            if APLICAR:
                await tr.commit()
                print(f"\n== HECHO. Respaldo con el sello {sello}.{VUELTA_ATRAS}")
            else:
                await tr.rollback()
                print("\n== En seco: todo deshecho. Para escribir: --aplicar")
            return 0
        except BaseException:
            if not terminada:
                try:
                    await tr.rollback()
                except Exception:
                    pass
            raise
    finally:
        await c.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
