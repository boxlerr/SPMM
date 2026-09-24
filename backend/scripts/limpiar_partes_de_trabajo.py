"""Saca de las OT los procesos que en realidad eran partes de trabajo.

EL PROBLEMA (10/09/2026)

`dbo.otrabajoProceso` del legacy no es la lista de procesos de la OT: es el parte de
trabajo. Cada fila tiene `empleado`, `fecha`, `hinicio`, `hfinal` y `REMITO`. Ahí
conviven dos cosas distintas:

  · LÍNEAS DE PLAN — sin empleado ni fecha, sólo el tiempo estimado. Esos son los
    procesos de la OT.
  · PARTES DE TRABAJO — con empleado y fecha. Trabajo ya hecho, muchas veces ya
    remitado. No son procesos a planificar.

Las dos migraciones leyeron la tabla entera sin distinguir:

  · La de julio SUMÓ los dos en una fila por proceso. Por eso FRESADORA CNC de la
    13343 quedó con 390 minutos: 270 de un parte de julio de 2025 más los 120 del
    plan.
  · `remigrar_procesos_legacy` (31/8) las volvió a separar en una fila cada una,
    tomando cada parte como si fuera un paso más. La 13345 pasó de 12 procesos a
    20; la 13813, de 3 a 23 sesiones de torno de 2025 ya facturadas.

Resultado: 22 de las 175 OT abiertas tienen procesos de más y minutos inflados, y el
planificador les reserva máquina y gente para trabajo que ya se hizo el año pasado.

QUÉ HACE ESTE SCRIPT

Reconstruye, para cada OT, la lista que corresponde —las líneas de plan del legacy;
si no hay ninguna, los partes agrupados por proceso con los minutos sumados, que es
la única lectura posible y la que usó julio— y la compara con lo que hay en SPMM.

QUÉ TOCA Y QUÉ NO

  ✓ Borra las copias de más de un proceso que el legacy tiene menos veces.
  ✓ Reacomoda el `orden` (el paso) de las que quedan, que es de lo que depende la
    regla de "sólo se puede agregar a mano un proceso de paso 1 o 2".
  ✗ NO toca los minutos. El estimado del legacy es de cuando se presupuestó y el
    taller lo corrige en la pantalla; es dato de ellos. Con `--minutos` se pisan
    igual, pero no hace falta.
  ✗ NO toca una fila con avance (`id_estado` distinto de Pendiente): alguien ya
    trabajó sobre ella y ese dato es del taller.
  ✗ NO toca una fila que esté en una planificación guardada.
  ✗ NO toca un proceso que el legacy no tiene: lo cargaron en SPMM después del
    cutover de julio y es de ellos.
  ✗ NO toca las OT que ya coinciden.

Todo lo que se salta se lista con el motivo. Corre EN SECO por defecto.

    venv/bin/python -m backend.scripts.limpiar_partes_de_trabajo 13345 13813
    venv/bin/python -m backend.scripts.limpiar_partes_de_trabajo --abiertas
    venv/bin/python -m backend.scripts.limpiar_partes_de_trabajo --abiertas --aplicar

Antes de `--aplicar` conviene mirar la salida en seco con el taller: el número de
minutos de una OT cambia, y eso cambia lo que entra en la semana.

Los números son de OT VIEJA (id_otvieja), el que se ve en pantalla.
"""

# ---------------------------------------------------------------------------
# 🚫 FRENADO EL 23/09/2026 — NO CORRER. Reemplazado por `importar_ot_legacy`.
#
# Limpiaba contra `dbo.otrabajoProceso` (la hoja de ruta). Esa tabla no es la lista de
# procesos: la lista está en `dbo.ZoTProcesos`. Para dejar una OT como el viejo se usa
# `importar_ot_legacy --recargar`.
#
#   Traer OT nuevas y sus procesos:  .venv/bin/python -m backend.scripts.importar_ot_legacy
#   Ver cómo está cada OT:           .venv/bin/python -m backend.scripts.auditoria_procesos_vs_legacy --abiertas
# ---------------------------------------------------------------------------
import sys as _sys

# Sólo frena si alguien lo EJECUTA; importarlo sigue andando (la auditoría reusa helpers).
if __name__ == "__main__" and "--sin-freno" not in _sys.argv:
    print("🚫 FRENADO: compara contra la hoja de ruta (otrabajoProceso), no contra la lista de procesos.")
    print("   Usar:  .venv/bin/python -m backend.scripts.importar_ot_legacy")
    _sys.exit(1)

import asyncio
import os
import re
import sys
from collections import defaultdict

import asyncpg
from dotenv import load_dotenv

import backend.scripts.sync_db as sync_db
from backend.scripts.auditoria_procesos_vs_legacy import (
    _clave, _es_linea_de_plan, _por_ot, _procesos_del_legacy,
)

APLICAR = "--aplicar" in sys.argv
# Los minutos NO se tocan (Julián, 10/09: "los minutos no importan, eso pueden
# ponerlo ellos"). El estimado del legacy es de cuando se presupuestó y el taller lo
# corrige a ojo en la pantalla; pisárselo sería cambiarles un dato que ellos manejan
# mejor. El PASO sí se acomoda: de eso depende la regla de orden 1-2.
MINUTOS = "--minutos" in sys.argv
ABIERTAS = "--abiertas" in sys.argv
OTS_PEDIDAS = [int(a) for a in sys.argv[1:] if a.isdigit() and len(a) <= 6]

# Pendiente. Cualquier otro estado significa que alguien ya la empezó o la terminó.
ESTADO_PENDIENTE = 1


def _url():
    load_dotenv()
    u = re.sub(r"^postgresql\+\w+://", "postgresql://", os.getenv("SUPABASE_DB_URL")).split("?")[0]
    return u.replace(":5432/", ":6543/")


async def _objetivo(c):
    if OTS_PEDIDAS:
        filas = await c.fetch(
            "select id, id_otvieja from orden_trabajo where id_otvieja = any($1::int[])",
            OTS_PEDIDAS)
        return {f["id_otvieja"]: f["id"] for f in filas}
    if ABIERTAS:
        filas = await c.fetch("""
            select id, id_otvieja from orden_trabajo
            where coalesce(finalizadototal,0)=0
              and (fecha_entrega is null or extract(year from fecha_entrega) <= 1950)
              and id_otvieja is not null""")
        return {f["id_otvieja"]: f["id"] for f in filas}
    return {}


async def main():
    if not OTS_PEDIDAS and not ABIERTAS:
        print(__doc__)
        return

    c = await asyncpg.connect(_url(), statement_cache_size=0)
    try:
        por_vieja = await _objetivo(c)
        if not por_vieja:
            print("No hay OTs para revisar.")
            return

        lista = ",".join(str(o) for o in por_vieja)
        crudas = await sync_db._leer(
            f"SELECT Idot AS idot, empleado, proceso, fecha, total, orden "
            f"FROM dbo.otrabajoProceso WHERE Idot IN ({lista})")
        legacy = {otv: _procesos_del_legacy(filas) for otv, filas in _por_ot(crudas).items()}
        partes = {otv: sum(1 for r in filas if not _es_linea_de_plan(r))
                  for otv, filas in _por_ot(crudas).items()}

        actuales = defaultdict(list)
        for r in await c.fetch("""
            select p.id, p.id_orden_trabajo, ot.id_otvieja, upper(trim(pr.nombre)) as nombre,
                   p.orden, coalesce(p.tiempo_proceso,0) as minutos, p.id_estado,
                   exists (select 1 from planificacion pl
                            where pl.id_orden_trabajo_proceso = p.id) as en_plan
            from orden_trabajo_proceso p
            join orden_trabajo ot on ot.id = p.id_orden_trabajo
            join proceso pr on pr.id = p.id_proceso
            where p.id_orden_trabajo = any($1::int[])
            order by ot.id_otvieja, p.orden, p.id""", list(por_vieja.values())):
            actuales[r["id_otvieja"]].append(dict(r))

        a_borrar, a_ajustar, intactas, sin_datos, repes = [], [], [], [], []

        for otv in sorted(por_vieja):
            esperado = legacy.get(otv, [])
            filas = actuales.get(otv, [])
            if not esperado:
                # Sin nada en el legacy no hay con qué comparar: la OT nació en SPMM
                # o no se migró. Decir "sobra todo" sería inventar.
                if filas:
                    sin_datos.append((otv, len(filas)))
                continue

            # Cuántas veces tiene que estar cada proceso, y con qué paso y minutos.
            quedan = defaultdict(list)
            for orden, nombre, minutos in esperado:
                quedan[_clave(nombre)].append((orden, minutos))

            borrar_ot, ajustar_ot = [], []
            for fila in filas:
                nombre = _clave(fila["nombre"])
                cola = quedan.get(nombre)
                if cola:
                    orden_ok, min_ok = cola.pop(0)
                    destino = (orden_ok, min_ok if MINUTOS else fila["minutos"])
                    if (fila["orden"], fila["minutos"]) != destino:
                        ajustar_ot.append({**fila, "otv": otv, "a": destino})
                    continue

                # Sobra. Antes de proponerla para borrar, los tres frenos.
                if nombre not in quedan:
                    intactas.append((otv, fila, "el legacy no tiene este proceso: lo cargaron acá"))
                elif fila["id_estado"] != ESTADO_PENDIENTE:
                    intactas.append((otv, fila, f"tiene avance (estado {fila['id_estado']})"))
                elif fila["en_plan"]:
                    intactas.append((otv, fila, "está en una planificación guardada"))
                else:
                    borrar_ot.append({**fila, "otv": otv})

            # Un proceso que el legacy no tiene y que en SPMM está DOS veces con los
            # mismos minutos no lo puede arbitrar este script: el legacy no opina y
            # las dos filas son igual de válidas. Se avisa y decide el taller. Pasa en
            # la 15400, que tiene el mismo bloque de cuatro procesos repetido entero.
            vistos = defaultdict(list)
            for otv2, fila, motivo in intactas:
                if otv2 == otv and motivo.startswith("el legacy no tiene"):
                    vistos[(_clave(fila["nombre"]), fila["minutos"])].append(fila)
            for (nombre, minutos), grupo in vistos.items():
                if len(grupo) > 1:
                    repes.append((otv, nombre, minutos, [f["id"] for f in grupo]))

            if borrar_ot or ajustar_ot:
                min_antes = sum(f["minutos"] for f in filas)
                borradas = {f["id"] for f in borrar_ot}
                min_despues = (sum(m for _, _, m in esperado) if MINUTOS
                               else sum(f["minutos"] for f in filas if f["id"] not in borradas))
                plan = sum(m for _, _, m in esperado)
                nota_min = "" if MINUTOS else f"  (el legacy dice {plan})"
                print(f"OT {otv:<6} {len(filas):>3} filas → {len(filas) - len(borrar_ot):>3}    "
                      f"{min_antes:>5} min → {min_despues:>5} min{nota_min}    "
                      f"({partes.get(otv, 0)} partes de trabajo en el legacy)")
                for f in borrar_ot:
                    print(f"     borrar   paso {f['orden']:>3}  {f['minutos']:>5}m  "
                          f"{f['nombre'][:44]}  (fila #{f['id']})")
                for f in ajustar_ot:
                    cambio = (f"paso {f['orden']}→{f['a'][0]}"
                              + (f", {f['minutos']}→{f['a'][1]} min" if MINUTOS else ""))
                    print(f"     mover    {f['nombre'][:36]:<36} {cambio}  (fila #{f['id']})")
            a_borrar += borrar_ot
            a_ajustar += ajustar_ot

        print("\n" + "=" * 78)
        print(f"OT miradas                   : {len(por_vieja)}")
        print(f"Filas a BORRAR               : {len(a_borrar)} "
              f"en {len({f['otv'] for f in a_borrar})} OT")
        que = "paso y minutos" if MINUTOS else "paso"
        print(f"Filas a reacomodar ({que:<13}): {len(a_ajustar)} "
              f"en {len({f['otv'] for f in a_ajustar})} OT")
        if not MINUTOS:
            print("   (los minutos quedan como están: los pone el taller)")
        if intactas:
            print(f"\nFilas que SOBRAN pero NO se tocan ({len(intactas)}):")
            for otv, f, motivo in intactas[:20]:
                print(f"   OT {otv}  paso {f['orden']:>3}  {f['nombre'][:34]:<34}  → {motivo}")
            if len(intactas) > 20:
                print(f"   ... y {len(intactas) - 20} más")
        if repes:
            print(f"\n⚠️  Procesos repetidos DENTRO de SPMM que el legacy no puede arbitrar "
                  f"({len(repes)}).")
            print("   Están cargados acá y el legacy no los tiene, así que ninguna copia es "
                  "\"la buena\". Hay que preguntarle al taller cuál va:")
            for otv, nombre, minutos, ids in repes:
                print(f"   OT {otv}  {nombre[:36]:<36} x{len(ids)}  {minutos}m cada una  "
                      f"(filas {', '.join('#' + str(i) for i in ids)})")

        if sin_datos:
            print(f"\nOT sin líneas en el legacy, se saltean ({len(sin_datos)}): "
                  + ", ".join(f"{o} ({n} filas)" for o, n in sin_datos[:20]))

        if not APLICAR:
            print("\n(corrida en seco — no se escribió nada; usar --aplicar para escribir)")
            return
        if not a_borrar and not a_ajustar:
            print("\nNada para escribir.")
            return

        # La copia de seguridad va ANTES y en la misma base: si el arreglo sale mal,
        # volver tiene que ser un INSERT ... SELECT y no una restauración entera.
        respaldo = "backup_20260910_otp_partes"
        async with c.transaction():
            await c.execute(f"""
                create table if not exists {respaldo} as
                select * from orden_trabajo_proceso where false""")
            ids = [f["id"] for f in a_borrar] + [f["id"] for f in a_ajustar]
            await c.execute(f"""
                insert into {respaldo}
                select * from orden_trabajo_proceso where id = any($1::bigint[])""", ids)
            for f in a_ajustar:
                await c.execute(
                    "update orden_trabajo_proceso set orden=$2, tiempo_proceso=$3 where id=$1",
                    f["id"], f["a"][0], f["a"][1])
            if a_borrar:
                await c.execute(
                    "delete from orden_trabajo_proceso where id = any($1::bigint[])",
                    [f["id"] for f in a_borrar])

        print(f"\nBORRADAS {len(a_borrar)} filas, AJUSTADAS {len(a_ajustar)}.")
        print(f"Copia de las {len(ids)} filas tocadas en `{respaldo}`.")
        print(f"Volver atrás: insert into orden_trabajo_proceso select * from {respaldo};")
        print("\nOJO: las OT tocadas cambiaron. El plan guardado de esas OT quedó viejo "
              "y hay que replanificarlas.")
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
