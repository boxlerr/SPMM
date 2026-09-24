"""Trae las OT del sistema viejo a SPMM, con los procesos sacados de la tabla que corresponde.

LA TABLA EQUIVOCADA (23/09/2026)

Todas las migraciones de procesos anteriores —la de julio, `remigrar_procesos_legacy`
(31/8), `migrar_procesos_faltantes` (agosto a septiembre)— leyeron `dbo.otrabajoProceso`.
Esa tabla NO es la lista de procesos de la OT: es la HOJA DE RUTA. Tiene las líneas del
plan y, abajo, los partes de trabajo (`empleado`, `fecha`, `hinicio`, `hfinal`, `REMITO`).
La lista de procesos que el taller carga y ve en el programa viejo está en
`dbo.ZoTProcesos` (proceso por id contra `dbo.zProcesos`, tiempo en minutos).

Medido ese día sobre las 1839 OT del viejo desde la 14000:
  · en 20 la hoja de ruta tiene la lista cargada 2 o 3 veces exactas (15556: 9 procesos
    en la lista, 18 en la hoja). La 15243 tiene el bloque de 6 pasos dos veces más el
    embalado: 13 filas contra los 7 procesos que Lucas ve en el viejo.
  · en 87 la lista tiene procesos que la hoja no, agregados después de armarla.
  · hay OT que parecían «sin procesos en el legacy» (15839, 15852, 15872) y tenían 7 a
    10 en la lista: la hoja todavía no se había generado.
Toda migración que lea la hoja hereda eso. Por eso se multiplicaban los procesos, y por
eso se volvía a romper cada vez que alguien los traía de nuevo.

MODOS

  (por defecto)  ALTAS. Sólo agrega, nunca pisa ni borra. Es el que se corre cada
                 semana mientras el taller siga cargando OT en el viejo:
                   · las OT pendientes del viejo que SPMM no tiene, con sus procesos;
                   · los procesos de las OT abiertas que en SPMM todavía no tienen
                     NINGUNO (se trajo la OT antes de que le cargaran la lista).
                 Una OT que ya está en SPMM no se toca: ni una columna ni un proceso.
                 Correrlo dos veces seguidas no hace nada la segunda.

  --recargar     RECARGA DE CERO, una sola vez (23/09/2026, pedido de Julián y Lucas).
                 Deja cada OT de SPMM igual al viejo: la cabecera y la lista de
                 procesos. LO QUE SE HAYA CARGADO EN SPMM EN ESAS OT SE PIERDE (queda
                 en el respaldo y en el deshacer de la OT). No volver a correrlo sin
                 decidirlo de nuevo con el taller.
                   · Conserva el `id` de cada OT: no se rompen los materiales, la
                     auditoría ni los planes que la nombran.
                   · Los procesos se ajustan pasada por pasada: la n-ésima de un
                     proceso en SPMM es la n-ésima del viejo. Se actualizan paso y
                     minutos, se borran las de más y se insertan las que faltan. Las
                     que se conservan mantienen su id, su avance y su lugar en el plan.
                   · Antes de tocar los procesos de una OT deja una foto en
                     `orden_trabajo_proceso_version`, la misma que deja la pantalla al
                     editar: se vuelve atrás una OT con
                     POST /ordenes/{id}/procesos/restaurar/{id_version}.
                   · Antes de escribir nada copia orden_trabajo, orden_trabajo_proceso
                     y planificacion enteras a tablas backup_<fecha>_*.
                   · Abierta en SPMM = pendiente en el viejo (la regla de Jorge,
                     Q_PENDIENTES), que es lo que hacía el sync hasta el 2/9.
                   · NO toca las OT que el viejo no tiene (21, todas cerradas).

  --recargar --ot 15xxx,15yyy
                 La misma recarga, SÓLO para esas OT (prueba piloto del 28/9: las OT del
                 plan, después de que Matías corrija sus procesos en el viejo). Las que
                 SPMM no tiene, las trae. No toca ninguna otra OT ni trae otras nuevas.

  --cerrar       Cierra en SPMM las OT abiertas que el viejo ya no tiene pendientes
                 (entregadas, fc, ttt1, suspendidas o con todo entregado). Copia del viejo
                 la fecha de entrega, lo entregado y esas marcas; guarda antes una copia de
                 esas filas en backup_<fecha>_cierre_ot. Se puede sumar a cualquier modo.

Corre EN SECO por defecto. Con --aplicar escribe, todo en una transacción.

    .venv/bin/python -m backend.scripts.importar_ot_legacy
    .venv/bin/python -m backend.scripts.importar_ot_legacy --aplicar
    .venv/bin/python -m backend.scripts.importar_ot_legacy --ot 15820 --aplicar
    .venv/bin/python -m backend.scripts.importar_ot_legacy --recargar            # en seco
    .venv/bin/python -m backend.scripts.importar_ot_legacy --recargar --aplicar
    .venv/bin/python -m backend.scripts.importar_ot_legacy --recargar --ot 15243,15556   # en seco
    .venv/bin/python -m backend.scripts.importar_ot_legacy --cerrar                      # en seco

Va por el puerto 6543 (ver supabase-pooler-15-conexiones): el 5432 tiene 15 plazas para
todo el proyecto y un script ahí le saca lugar a producción.

Los números son de OT VIEJA (id_otvieja), el que se ve en pantalla.
"""
import asyncio
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from backend.scripts.sync_db import COLS_OT, Q_OTS, Q_PENDIENTES, _clave, _leer, _norm

APLICAR = "--aplicar" in sys.argv
RECARGAR = "--recargar" in sys.argv
CERRAR = "--cerrar" in sys.argv

# La lista de procesos de la OT, como la ve el programa viejo. `orden` se usa para
# ordenar y `id` desempata (hay pasos repetidos); el paso de SPMM se renumera 1..N.
Q_LISTA = """
SELECT z.ot, z.orden, z.id, z.proceso, LTRIM(RTRIM(p.descripcion)) AS nombre,
       ISNULL(z.tiempo, 0) AS minutos
FROM dbo.ZoTProcesos z
LEFT JOIN dbo.zProcesos p ON p.proceso = z.proceso
WHERE z.ot IN ({ids})
"""

USUARIO = "Recarga desde el sistema viejo"
MOTIVO = "recarga desde el viejo"

# Hora del taller sin zona, como todas las fechas de la base (ver fechas-todas-sin-zona).
_TZ_AR = timezone(timedelta(hours=-3))


def _ahora_ar():
    return datetime.now(_TZ_AR).replace(tzinfo=None)


def clave_proceso(nombre) -> str:
    """Nombre de proceso para comparar: mayúsculas y espacios colapsados. El catálogo de
    SPMM se cosechó de texto libre y tiene gemelos que difieren sólo en eso."""
    return re.sub(r"\s+", " ", nombre or "").strip().upper()


# ---------------------------------------------------------------------------
# Lógica pura (sin base): es lo que prueban los tests
# ---------------------------------------------------------------------------
def lista_del_viejo(filas):
    """Filas de ZoTProcesos de UNA OT -> [(paso, clave, minutos)], paso = 1..N.

    Una fila sin proceso (id 0 o sin descripción en zProcesos) no es un paso: se saltea.
    """
    salida = []
    for f in sorted(filas, key=lambda x: (x["orden"] or 0, x["id"] or 0)):
        nombre = clave_proceso(f["nombre"])
        if not f["proceso"] or not nombre:
            continue
        salida.append((len(salida) + 1, nombre, int(f["minutos"] or 0)))
    return salida


def elegir_id_por_nombre(catalogo):
    """Catálogo de SPMM -> {clave: id}. Si dos procesos tienen el mismo nombre (hay 14
    pares así, de cuando el sync daba de alta cada variante de tipeo), gana el que tiene
    algo configurado —rango, skills, máquina—, después el más usado y al final el id
    más bajo. Así una pasada nueva cae en el que el planificador sabe asignar."""
    elegido = {}
    for p in catalogo:
        k = clave_proceso(p["nombre"])
        puntaje = (p.get("configurado", 0), p.get("usos", 0), -p["id"])
        if k not in elegido or puntaje > elegido[k][0]:
            elegido[k] = (puntaje, p["id"])
    return {k: v[1] for k, v in elegido.items()}


def cambios_de_procesos(spmm, viejo):
    """Qué hay que hacer para que los procesos de una OT queden como en el viejo.

    spmm:  [{"id", "orden", "clave", "minutos"}] tal como están, en orden de paso.
    viejo: [(paso, clave, minutos)] de `lista_del_viejo`.

    Se machea la n-ésima pasada de un proceso en SPMM con la n-ésima del viejo. Lo que
    machea se conserva (con su id, su avance y su lugar en el plan) y sólo se le corrige
    el paso y los minutos; lo que sobra se borra; lo que falta se inserta.

    -> (actualizar [(id, paso, minutos)], borrar [id], insertar [(paso, clave, minutos)])
    """
    libres = defaultdict(list)
    for fila in sorted(spmm, key=lambda x: (x["orden"] or 0, x["id"])):
        libres[fila["clave"]].append(fila)

    actualizar, insertar = [], []
    for paso, clave, minutos in viejo:
        cola = libres.get(clave)
        if not cola:
            insertar.append((paso, clave, minutos))
            continue
        fila = cola.pop(0)
        if (fila["orden"], fila["minutos"]) != (paso, minutos):
            actualizar.append((fila["id"], paso, minutos))
    borrar = [f["id"] for cola in libres.values() for f in cola]
    return actualizar, sorted(borrar), insertar


def finalizada_segun_el_viejo(idot, pendientes) -> int:
    """Abierta en SPMM si y sólo si el viejo la da por pendiente (regla de Jorge).

    No alcanza con copiar `finalizadototal` del viejo: allá una OT suspendida, de la
    marca ttt1 o con todo entregado sigue con 0 y con fecha de entrega 1950. Es la misma
    regla que aplicaban los dos UPDATE de zombies del sync hasta el 2/9.
    """
    return 0 if idot in pendientes else 1


def ot_a_dar_de_alta(pendientes, en_spmm, pedidas=()):
    """Las OT del viejo que hay que traer: pendientes o pedidas a mano, que SPMM no tenga."""
    return sorted((set(pendientes) | set(pedidas)) - set(en_spmm))


def alcance(recargar, pedidas, pendientes, en_spmm):
    """-> (OT a recargar, OT a dar de alta), según el modo.

    · por defecto: no se recarga ninguna; se traen las pendientes que faltan y las
      pedidas con --ot.
    · --recargar: se recargan TODAS las de SPMM y se traen las pendientes que faltan.
    · --recargar --ot: sólo las pedidas. Las que SPMM tiene se recargan, las que no se
      traen, y ninguna otra OT se toca ni se trae.
    """
    if recargar and pedidas:
        return sorted(set(pedidas) & set(en_spmm)), sorted(set(pedidas) - set(en_spmm))
    if recargar:
        return sorted(en_spmm), ot_a_dar_de_alta(pendientes, en_spmm)
    return [], ot_a_dar_de_alta(pendientes, en_spmm, pedidas)


def ot_a_cerrar(spmm_ots, pendientes):
    """Las OT abiertas en SPMM que el viejo ya no tiene pendientes. Es la otra mitad de
    «abierta en SPMM ⇔ pendiente en el viejo»; la de traer las que faltan es la de altas."""
    return sorted(otv for otv, o in spmm_ots.items() if o["abierta"] and otv not in pendientes)


def motivo_de_cierre(v) -> str:
    """Por qué el viejo ya no la tiene pendiente, leído de su fila de Q_OTS."""
    if v.get("fecha_entrega"):
        return f"entregada el {v['fecha_entrega']:%d/%m/%Y}"
    for marca, texto in (("fc", "marcada fc"), ("ttt1", "marca ttt1"), ("suspendida", "suspendida")):
        if v.get(marca):
            return texto
    if (v.get("cantidad_entregada") or 0) >= (v.get("unidades") or 0):
        return "todo entregado"
    return "no figura como pendiente"


def es_otra_ot(spmm, viejo) -> bool:
    """¿El número está en SPMM pero es OTRA orden? Pasa si alguien crea una OT en SPMM:
    toma max(id_otvieja)+1, que es el próximo número del viejo. Se compara cliente y día
    de alta, que no cambian en la vida de una OT. Una OT de SPMM sin cliente sólo se
    compara por el día."""
    fecha = lambda v: v.date() if isinstance(v, datetime) else v
    if fecha(spmm["fecha_orden"]) != fecha(viejo["fecha_orden"]):
        return True
    return spmm["cliente_viejo"] is not None and spmm["cliente_viejo"] != viejo["_cliente_viejo"]


# Columnas NOT NULL de orden_trabajo que vienen del viejo. Si el viejo no trae valor, se
# conserva el de SPMM en vez de romper la transacción entera por una OT.
NO_NULAS = ("id_prioridad", "id_sector", "id_articulo", "ttt1", "fc",
            "fecha_orden", "fecha_entrada", "fecha_prometida")


def columnas_que_cambian(actual, nueva):
    """Columnas de la cabecera que difieren del viejo, sin pisar con vacío lo que el
    viejo no pudo resolver (un cliente o artículo que SPMM no tiene, una fecha NULL)."""
    return {col: nueva[col] for col in COLS_OT
            if _norm(actual.get(col)) != _norm(nueva.get(col))
            and not (nueva.get(col) is None and (col in NO_NULAS or col == "id_cliente"))}


# ---------------------------------------------------------------------------
# Lecturas
# ---------------------------------------------------------------------------
def _url():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    u = re.sub(r"^postgresql\+\w+://", "postgresql://", os.getenv("SUPABASE_DB_URL")).split("?")[0]
    return u.replace(":5432/", ":6543/")


def _pedidas():
    if "--ot" not in sys.argv:
        return []
    crudo = sys.argv[sys.argv.index("--ot") + 1]
    return [int(x) for x in crudo.replace(",", " ").split()]


async def _leer_por_tandas(sql, ids, tanda=800):
    filas = []
    ids = sorted(ids)
    for i in range(0, len(ids), tanda):
        filas += await _leer(sql.format(ids=",".join(str(x) for x in ids[i:i + tanda])))
    return filas


async def _listas_del_viejo(ids):
    por_ot = defaultdict(list)
    for f in await _leer_por_tandas(Q_LISTA, ids):
        por_ot[f["ot"]].append(f)
    return {ot: lista_del_viejo(filas) for ot, filas in por_ot.items()}


async def _cabeceras_del_viejo(ids):
    base = Q_OTS.split("\nWHERE", 1)[0]
    return {f["id_otvieja"]: f for f in await _leer_por_tandas(base + "\nWHERE v.idot IN ({ids})", ids)}


async def _mapas(c):
    async def mapa(tabla, col):
        return {_clave(r[col]): r["id"] for r in await c.fetch(f"SELECT id, {col} FROM {tabla}")
                if r[col] is not None}
    return {"cliente": await mapa("cliente", "id_viejo"),
            "articulo": await mapa("articulo", "cod_articulo"),
            "sector": await mapa("sector", "nombre"),
            "prioridad": await mapa("prioridad", "descripcion")}


def _cabecera(fila, mapas, pendientes, avisos):
    """Fila de Q_OTS -> columnas de orden_trabajo, con las FK resueltas como el sync."""
    f = {k: v for k, v in fila.items() if not k.startswith("_")}
    otv = f["id_otvieja"]
    f["id_cliente"] = mapas["cliente"].get(_clave(fila["_cliente_viejo"]))
    if f["id_cliente"] is None:
        avisos.append(f"OT {otv}: el cliente {fila['_cliente_viejo']} del viejo no está en SPMM")
    f["id_articulo"] = mapas["articulo"].get(_clave(fila["_cod_articulo"]))
    if f["id_articulo"] is None:
        avisos.append(f"OT {otv}: el artículo '{fila['_cod_articulo']}' no está en SPMM")
    # Sector vacío es lo normal en el viejo (832 OT en SIN SECTOR): no se inventa uno.
    f["id_sector"] = mapas["sector"].get(_clave(fila["_sector"])) or mapas["sector"].get("SIN SECTOR")
    f["id_prioridad"] = (mapas["prioridad"].get(_clave(fila["_prioridad"]))
                         or mapas["prioridad"].get("SIN PRIORIDAD"))
    f["finalizadototal"] = finalizada_segun_el_viejo(otv, pendientes)
    for col in NO_NULAS:
        if f.get(col) is None and col != "id_articulo":
            avisos.append(f"OT {otv}: el viejo no tiene {col}")
    return f


# ---------------------------------------------------------------------------
# Escrituras
# ---------------------------------------------------------------------------
_INSERT_PROCESO = """
    INSERT INTO orden_trabajo_proceso
        (id_orden_trabajo, id_proceso, orden, tiempo_proceso, id_estado, cant_operarios)
    VALUES ($1, $2, $3, $4, 1, 1)"""


async def _insertar_procesos(c, id_ot, lista, id_por_nombre):
    if lista:
        await c.executemany(_INSERT_PROCESO, [(id_ot, id_por_nombre[clave], paso, minutos)
                                              for paso, clave, minutos in lista])


def _foto(filas) -> str:
    """La misma foto que deja la pantalla antes de un cambio (OrdenTrabajoRepository.
    _guardar_version_procesos), así «Deshacer» la puede restaurar."""
    return json.dumps([{k: f[k] for k in ("id", "id_proceso", "orden", "tiempo_proceso",
                                          "cant_operarios", "id_maquinaria", "id_operario",
                                          "no_lleva_maquina", "id_estado", "observaciones")}
                       for f in filas], default=str)


async def _escribir_recarga(c, sello, cabeceras_cambian, plan_procesos, spmm_ots, spmm_procs,
                            id_por_nombre):
    """La recarga de cero. Es el ÚNICO lugar del script que actualiza o borra: el modo
    por defecto no pasa por acá (lo cuida test_importar_ot_legacy)."""
    for tabla, corto in (("orden_trabajo", "ot"), ("orden_trabajo_proceso", "otp"),
                         ("planificacion", "plan")):
        await c.execute(f"CREATE TABLE backup_{sello}_recarga_{corto} AS SELECT * FROM {tabla}")

    for otv, cols in cabeceras_cambian.items():
        await c.execute(
            f"UPDATE orden_trabajo SET {', '.join(f'{k} = ${i + 2}' for i, k in enumerate(cols))} "
            f"WHERE id_otvieja = $1", otv, *cols.values())

    # Los procesos van en tandas (executemany): la transacción tiene filas del taller
    # tomadas y no puede quedarse minutos haciendo un viaje por fila.
    ahora = _ahora_ar()
    await c.executemany("""
        INSERT INTO orden_trabajo_proceso_version
            (id_orden_trabajo, creado_en, id_usuario, usuario, motivo, procesos)
        VALUES ($1, $2, NULL, $3, $4, CAST($5 AS JSONB))""",
                        [(spmm_ots[otv]["id"], ahora, USUARIO, MOTIVO, _foto(spmm_procs.get(otv, [])))
                         for otv in plan_procesos])
    borrar = [i for _, b, _ in plan_procesos.values() for i in b]
    if borrar:
        # planificacion cuelga con ON DELETE CASCADE: la fila del plan de una pasada que
        # ya no existe cae con ella.
        await c.execute("DELETE FROM orden_trabajo_proceso WHERE id = ANY($1::bigint[])", borrar)
    await c.executemany("UPDATE orden_trabajo_proceso SET orden = $2, tiempo_proceso = $3 WHERE id = $1",
                        [fila for a, _, _ in plan_procesos.values() for fila in a])
    await c.executemany(_INSERT_PROCESO,
                        [(spmm_ots[otv]["id"], id_por_nombre[clave], paso, minutos)
                         for otv, (_, _, insertar) in plan_procesos.items()
                         for paso, clave, minutos in insertar])


async def _escribir_cierres(c, sello, a_cerrar, cabeceras):
    """Cierra las OT que el viejo ya no tiene pendientes. Corre sólo con --cerrar."""
    await c.execute(f"CREATE TABLE backup_{sello}_cierre_ot AS SELECT * FROM orden_trabajo "
                    "WHERE id_otvieja = ANY($1::int[])", a_cerrar)
    await c.executemany("""
        UPDATE orden_trabajo
           SET finalizadototal = 1, fecha_entrega = $2, cantidad_entregada = $3,
               fc = $4, ttt1 = $5, suspendida = $6
         WHERE id_otvieja = $1""",
                        [(otv, v["fecha_entrega"], v["cantidad_entregada"], v["fc"], v["ttt1"],
                          v["suspendida"]) for otv in a_cerrar for v in (cabeceras[otv],)])


async def _altas(c, nuevas, cabeceras, listas, mapas, pendientes, id_por_nombre, avisos):
    """Modo por defecto: SÓLO INSERT. Una OT que ya está no se toca."""
    insertadas = 0
    for otv in nuevas:
        if otv not in cabeceras:
            continue
        f = _cabecera(cabeceras[otv], mapas, pendientes, avisos)
        if f["id_articulo"] is None:
            f["id_articulo"] = mapas["articulo"].get("NO-DEF")
        cols = ["id_otvieja"] + COLS_OT
        id_ot = await c.fetchval(
            f"INSERT INTO orden_trabajo ({', '.join(cols)}) "
            f"VALUES ({', '.join(f'${i + 1}' for i in range(len(cols)))}) RETURNING id",
            *[f[k] for k in cols])
        await _insertar_procesos(c, id_ot, listas.get(otv, []), id_por_nombre)
        insertadas += 1
    return insertadas


async def main():
    import asyncpg

    c = await asyncpg.connect(_url(), statement_cache_size=0)
    try:
        pendientes = {r["idot"] for r in await _leer(Q_PENDIENTES)}
        spmm_ots = {r["id_otvieja"]: dict(r) for r in await c.fetch("""
            SELECT ot.id, ot.id_otvieja, ot.fecha_orden, ot.modificado_en,
                   COALESCE(ot.finalizadototal, 0) = 0 AND ot.fecha_entrega IS NULL AS abierta,
                   cl.id_viejo AS cliente_viejo
            FROM orden_trabajo ot LEFT JOIN cliente cl ON cl.id = ot.id_cliente
            WHERE ot.id_otvieja IS NOT NULL""")}
        catalogo = await c.fetch("""
            SELECT p.id, p.nombre,
                   (SELECT count(*) FROM rango_proceso x WHERE x.id_proceso = p.id)
                 + (SELECT count(*) FROM operario_proceso_skill x WHERE x.id_proceso = p.id)
                 + (SELECT count(*) FROM proceso_maquinaria x WHERE x.id_proceso = p.id) AS configurado,
                   (SELECT count(*) FROM orden_trabajo_proceso x WHERE x.id_proceso = p.id) AS usos
            FROM proceso p""")
        id_por_nombre = elegir_id_por_nombre([dict(r) for r in catalogo])
        mapas = await _mapas(c)

        pedidas = _pedidas()
        a_recargar, nuevas = alcance(RECARGAR, pedidas, pendientes, spmm_ots)
        candidatas_cierre = ot_a_cerrar(spmm_ots, pendientes) if CERRAR else []
        # Se leen también las pendientes que ya están en SPMM: si el número es de OTRA
        # orden, la del viejo no entra nunca, y eso se avisa fuerte.
        leer = sorted(set(a_recargar) | set(nuevas) | (pendientes & set(spmm_ots))
                      | set(candidatas_cierre))
        cabeceras = await _cabeceras_del_viejo(leer) if leer else {}
        listas = await _listas_del_viejo(leer) if leer else {}
        # Una pedida con --ot que el viejo no tiene no se puede traer: se avisa abajo.
        nuevas = [o for o in nuevas if o in cabeceras]

        sin_catalogo = sorted({cl for l in listas.values() for _, cl, _ in l if cl not in id_por_nombre})
        if sin_catalogo:
            print(f"!! {len(sin_catalogo)} procesos del viejo no están en el catálogo de SPMM: {sin_catalogo}")
            print("   Darlos de alta en SPMM (Recursos > Procesos) y volver a correr. No se escribió nada.")
            return

        colisiones = [otv for otv in sorted(set(spmm_ots) & set(cabeceras))
                      if es_otra_ot(spmm_ots[otv], cabeceras[otv])]

        # --- procesos de las que ya están ---
        spmm_procs = defaultdict(list)
        if leer:
            ids_spmm = [spmm_ots[o]["id"] for o in leer if o in spmm_ots]
            for r in await c.fetch("""
                SELECT p.*, pr.nombre AS nombre_proceso, ot.id_otvieja,
                       (SELECT count(*) FROM planificacion pl WHERE pl.id_orden_trabajo_proceso = p.id) AS en_plan
                FROM orden_trabajo_proceso p
                JOIN orden_trabajo ot ON ot.id = p.id_orden_trabajo
                JOIN proceso pr ON pr.id = p.id_proceso
                WHERE p.id_orden_trabajo = ANY($1::int[])
                ORDER BY p.orden, p.id""", ids_spmm):
                spmm_procs[r["id_otvieja"]].append(dict(r))

        # Llenar una OT vacía es una ALTA de procesos: no pisa nada. En la recarga no hace
        # falta, porque la recarga ya las deja como el viejo (y las llenaría dos veces).
        a_llenar = [] if RECARGAR else [
            otv for otv in sorted(pendientes & set(spmm_ots))
            if spmm_ots[otv]["abierta"] and not spmm_procs.get(otv) and listas.get(otv)
            and otv not in colisiones]

        a_cerrar = [o for o in candidatas_cierre if o in cabeceras and o not in colisiones]

        plan_procesos, viejo_sin_lista = {}, []
        if RECARGAR:
            for otv in a_recargar:
                if otv not in cabeceras or otv in colisiones:
                    continue  # el viejo no la tiene, o es otra orden: no hay de dónde recargarla
                if not listas.get(otv):
                    # Sin lista en el viejo no se deja la OT en cero: es un hueco del viejo
                    # (el taller todavía no la cargó), no una orden sin trabajo.
                    if spmm_procs.get(otv):
                        viejo_sin_lista.append(otv)
                    continue
                actuales = [{"id": f["id"], "orden": f["orden"], "minutos": f["tiempo_proceso"] or 0,
                             "clave": clave_proceso(f["nombre_proceso"])} for f in spmm_procs.get(otv, [])]
                cambios = cambios_de_procesos(actuales, listas[otv])
                if any(cambios):
                    plan_procesos[otv] = cambios

        cabeceras_cambian, reabren, cierran, pisan_spmm, avisos = {}, [], [], [], []
        if RECARGAR:
            actuales_ot = {r["id_otvieja"]: dict(r) for r in await c.fetch(
                f"SELECT id_otvieja, {', '.join(COLS_OT)} FROM orden_trabajo WHERE id_otvieja IS NOT NULL")}
            for otv in a_recargar:
                if otv not in cabeceras or otv in colisiones:
                    continue
                nueva = _cabecera(cabeceras[otv], mapas, pendientes, avisos)
                distintas = columnas_que_cambian(actuales_ot[otv], nueva)
                if distintas:
                    cabeceras_cambian[otv] = distintas
                    abierta_despues = nueva["finalizadototal"] == 0 and nueva["fecha_entrega"] is None
                    if abierta_despues and not spmm_ots[otv]["abierta"]:
                        reabren.append(otv)
                    if spmm_ots[otv]["abierta"] and not abierta_despues:
                        cierran.append(otv)
                    if spmm_ots[otv]["modificado_en"]:
                        pisan_spmm.append((otv, sorted(distintas)))

        # --- informe ---
        print("=" * 78)
        print((f"RECARGA desde el viejo de {len(pedidas)} OT pedidas" if RECARGAR and pedidas
               else "RECARGA DE CERO desde el viejo" if RECARGAR else "ALTAS desde el viejo (sólo agrega)")
              + (" + CIERRES" if CERRAR else ""))
        print("=" * 78)
        print(f"Pendientes en el viejo        : {len(pendientes)}")
        print(f"OT del viejo en SPMM          : {len(spmm_ots)}  (abiertas {sum(o['abierta'] for o in spmm_ots.values())})")
        print(f"OT nuevas a traer             : {len(nuevas)} {nuevas if len(nuevas) <= 40 else ''}")
        for otv in nuevas:
            n = len(listas.get(otv, []))
            print(f"   OT {otv}: {n} procesos{'  (el viejo todavía no tiene la lista: se completa en otra corrida)' if not n else ''}")
        if not RECARGAR:
            print(f"OT abiertas sin procesos a las que el viejo ya les cargó la lista: {len(a_llenar)} {a_llenar}")
        if pedidas:
            no_en_viejo = [o for o in pedidas if o not in cabeceras]
            sin_lista = [o for o in pedidas if o in cabeceras and not listas.get(o)]
            no_pend = [o for o in pedidas if o in cabeceras and o not in pendientes]
            print(f"\nOT pedidas con --ot: {len(pedidas)}")
            if no_en_viejo:
                print(f"   !! el viejo no las tiene (no se tocan): {no_en_viejo}")
            if sin_lista:
                print(f"   !! sin procesos en el viejo, hay que cargarlos (Matías): {sin_lista}")
            if no_pend:
                print(f"   !! el viejo no las tiene pendientes"
                      f"{' (con --recargar quedan cerradas)' if RECARGAR else ' (se traen abiertas igual)'}: "
                      + ", ".join(f"{o} ({motivo_de_cierre(cabeceras[o])})" for o in no_pend))
        if colisiones:
            print(f"\n!! NÚMERO REPETIDO: {len(colisiones)} OT del viejo tienen un número que en SPMM es OTRA orden.")
            print("   No se trae ni se toca ninguna; hay que renumerar la de SPMM a mano:")
            for otv in colisiones:
                s, v = spmm_ots[otv], cabeceras[otv]
                print(f"   OT {otv}: SPMM cliente {s['cliente_viejo']} del {str(s['fecha_orden'])[:10]}"
                      f" | viejo cliente {v['_cliente_viejo']} del {str(v['fecha_orden'])[:10]}")

        if RECARGAR:
            filas_borrar = [i for (_, b, _) in plan_procesos.values() for i in b]
            por_id = {f["id"]: f for l in spmm_procs.values() for f in l}
            con_avance = [i for i in filas_borrar if (por_id[i]["id_estado"] or 1) != 1]
            en_plan = sum(por_id[i]["en_plan"] for i in filas_borrar)
            print(f"\nPROCESOS: {len(plan_procesos)} OT cambian "
                  f"({sum(1 for o in plan_procesos if spmm_ots[o]['abierta'])} abiertas)")
            print(f"   pasadas que se corrigen (paso/minutos): {sum(len(a) for a, _, _ in plan_procesos.values())}")
            print(f"   pasadas que se BORRAN                 : {len(filas_borrar)}"
                  f"  (con avance: {len(con_avance)}, filas de plan que caen: {en_plan})")
            print(f"   pasadas que se insertan               : {sum(len(i) for _, _, i in plan_procesos.values())}")
            print("\n   Abiertas que cambian (SPMM -> viejo):")
            for otv in sorted(plan_procesos):
                if not spmm_ots[otv]["abierta"]:
                    continue
                antes = spmm_procs.get(otv, [])
                despues = listas.get(otv, [])
                print(f"   OT {otv}: {len(antes):>2} procesos / {sum((f['tiempo_proceso'] or 0) for f in antes):>5} min"
                      f"  ->  {len(despues):>2} / {sum(m for _, _, m in despues):>5} min")
            print(f"\nCABECERA: {len(cabeceras_cambian)} OT con alguna columna distinta al viejo")
            por_col = defaultdict(int)
            for d in cabeceras_cambian.values():
                for col in d:
                    por_col[col] += 1
            for col, n in sorted(por_col.items(), key=lambda x: -x[1]):
                print(f"   {col:<22} {n:>5}")
            print(f"   se REABREN (el viejo las tiene pendientes): {reabren}")
            print(f"   se CIERRAN (el viejo no las tiene pendientes): {cierran}")
            if pisan_spmm:
                print("   editadas en SPMM (modificado_en) que el viejo pisa:")
                for otv, cols in pisan_spmm:
                    print(f"      OT {otv}: {', '.join(cols)}")
            sin_viejo = sorted(set(a_recargar) - set(cabeceras))
            print(f"\nNo están en el viejo y NO se tocan: {len(sin_viejo)} {sin_viejo}")
            if viejo_sin_lista:
                print(f"El viejo no tiene lista de procesos y SPMM sí (se dejan como están): {viejo_sin_lista}")
        if CERRAR:
            print(f"\nCIERRES: {len(a_cerrar)} OT abiertas en SPMM que el viejo ya no tiene pendientes")
            for otv in a_cerrar:
                en_plan = sum(f["en_plan"] for f in spmm_procs.get(otv, []))
                print(f"   OT {otv}: {motivo_de_cierre(cabeceras[otv])}"
                      f"{f'  (tiene {en_plan} filas en un plan)' if en_plan else ''}")
            reabrir = sorted(o for o in pendientes & set(spmm_ots) if not spmm_ots[o]["abierta"])
            if reabrir:
                print(f"   !! al revés, pendientes en el viejo y cerradas acá (NO se tocan): {reabrir}")
        for a in sorted(set(avisos)):
            print(f"  ! {a}")

        if not APLICAR:
            print("\n(en seco — no se escribió nada; agregar --aplicar)")
            return

        # --- escribir, todo o nada ---
        sello = _ahora_ar().strftime("%Y%m%d_%H%M")
        async with c.transaction():
            if RECARGAR:
                await _escribir_recarga(c, sello, cabeceras_cambian, plan_procesos,
                                        spmm_ots, spmm_procs, id_por_nombre)
            if CERRAR and a_cerrar:
                await _escribir_cierres(c, sello, a_cerrar, cabeceras)
            for otv in a_llenar:
                await _insertar_procesos(c, spmm_ots[otv]["id"], listas[otv], id_por_nombre)
            nuevas_sin_choque = [o for o in nuevas if o not in colisiones]
            # En altas, una OT pedida a mano con --ot entra abierta aunque el viejo no la
            # liste como pendiente (una tercerizada, una suspendida): si la pidieron es para
            # trabajarla. En la recarga manda la regla del viejo, igual que para las demás.
            insertadas = await _altas(c, nuevas_sin_choque, cabeceras, listas, mapas,
                                      pendientes if RECARGAR else pendientes | set(pedidas),
                                      id_por_nombre, avisos)

        print(f"\nLISTO. OT nuevas: {insertadas}. OT a las que se les cargó la lista: {len(a_llenar)}.")
        if CERRAR and a_cerrar:
            print(f"Cerradas: {len(a_cerrar)} {a_cerrar}. Copia de cómo estaban: backup_{sello}_cierre_ot")
        if RECARGAR:
            print(f"Recargadas: {len(cabeceras_cambian)} cabeceras, {len(plan_procesos)} listas de procesos.")
            print(f"Respaldo: backup_{sello}_recarga_ot / _otp / _plan")
            print("Volver atrás una OT puntual: POST /ordenes/{id}/procesos/restaurar/{id_version}, con la "
                  f"versión de motivo «{MOTIVO}» (GET /ordenes/{{id}}/procesos/versiones).")
        if nuevas_sin_choque:
            print("Revertir las altas: borrar las OT con id_otvieja en "
                  f"({','.join(str(o) for o in nuevas_sin_choque)}), primero sus filas de "
                  "orden_trabajo_proceso y después las de orden_trabajo.")
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
