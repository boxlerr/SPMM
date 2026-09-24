"""Trae del sistema viejo las OT pendientes que todavía no están en SPMM.

Por qué hace falta: el 2/9/2026 se apagó el sync de órdenes (SPMM pasó a ser el dueño),
pero el taller SIGUE dando de alta OT en el programa viejo. Cada una de esas nace fuera
de SPMM y no llega sola: el 3/9 faltaban 7 (15810-15816) y el 9/9 faltaban 8 más. Este
script es esa migración a mano, hecha repetible — antes se escribía de nuevo cada vez.

Qué trae: las OT que el legacy considera PENDIENTES (Q_PENDIENTES, la regla de Jorge) y
no están en SPMM. Las que el legacy da por cerradas, entregadas o suspendidas quedan
afuera A PROPÓSITO: son las ~5700 que nunca se migraron. Si el taller pide una de ésas
puntual, se la nombra con --ot.

Qué NO hace: no toca las OT que ya están. `_upsert` corre con cols_update=[], así que si
una OT ya existe en SPMM no se le escribe una sola columna — lo que se corrigió acá no se
pisa con lo que diga el legacy. Ver el comentario de la sección 3 de sync_db.py.

Los procesos vienen aparte, con `migrar_procesos_faltantes` (el legacy suele no tenerlos).

    .venv/bin/python -m backend.scripts.migrar_ot_faltantes
    .venv/bin/python -m backend.scripts.migrar_ot_faltantes --aplicar
    .venv/bin/python -m backend.scripts.migrar_ot_faltantes --ot 15820 --aplicar
"""

# ---------------------------------------------------------------------------
# 🚫 FRENADO EL 23/09/2026 — NO CORRER. Reemplazado por `importar_ot_legacy`.
#
# Traía la cabecera de las OT nuevas pero no sus procesos, y dejaba ese paso a
# `migrar_procesos_faltantes`, que leía la tabla equivocada. `importar_ot_legacy` hace
# las dos cosas en una corrida, sólo agrega y avisa si un número ya es de otra orden.
#
#   Traer OT nuevas y sus procesos:  .venv/bin/python -m backend.scripts.importar_ot_legacy
#   Ver cómo está cada OT:           .venv/bin/python -m backend.scripts.auditoria_procesos_vs_legacy --abiertas
# ---------------------------------------------------------------------------
import sys as _sys

# Sólo frena si alguien lo EJECUTA; importarlo sigue andando (la auditoría reusa helpers).
if __name__ == "__main__" and "--sin-freno" not in _sys.argv:
    print("🚫 FRENADO: reemplazado por importar_ot_legacy (trae la OT y sus procesos juntos).")
    print("   Usar:  .venv/bin/python -m backend.scripts.importar_ot_legacy")
    _sys.exit(1)

import asyncio
import sys

from sqlalchemy import text

from backend.infrastructure.db import SessionLocal
from backend.scripts.sync_db import (
    COLS_OT,
    Q_OTS,
    Q_PENDIENTES,
    _clave,
    _leer,
    _mapa,
    _upsert,
)

APLICAR = "--aplicar" in sys.argv


def _ot_pedidas():
    """--ot 15820,15821 -> [15820, 15821]. Fuerza traer esas aunque el legacy no las
    liste como pendientes (una tercerizada, una suspendida). Es una decisión del taller,
    no del script."""
    if "--ot" not in sys.argv:
        return []
    crudo = sys.argv[sys.argv.index("--ot") + 1]
    return [int(x) for x in crudo.replace(",", " ").split()]


# El SELECT de Q_OTS con otro WHERE: mismas columnas, mismos CASE, mismos ISNULL que
# usaron las 1252 OT que ya están, así que las nuevas entran idénticas a sus hermanas.
# Copiar el SELECT acá sería la forma segura de que se desfasen.
def _query_por_id(ids):
    select_sin_where = Q_OTS.split("\nWHERE", 1)[0]
    return f"{select_sin_where}\nWHERE v.idot IN ({','.join(str(i) for i in ids)})"


async def main():
    async with SessionLocal() as session:
        pedidas = _ot_pedidas()

        pendientes = {r["idot"] for r in await _leer(Q_PENDIENTES)}
        res = await session.execute(
            text("SELECT id_otvieja FROM orden_trabajo WHERE id_otvieja IS NOT NULL")
        )
        ya_estan = {r[0] for r in res}

        faltan = sorted((pendientes - ya_estan) | (set(pedidas) - ya_estan))
        print(f"Pendientes en el legacy : {len(pendientes)}")
        print(f"OT del legacy en SPMM   : {len(ya_estan)}")
        if pedidas:
            print(f"Pedidas a mano (--ot)   : {sorted(pedidas)}")
            ya = sorted(set(pedidas) & ya_estan)
            if ya:
                print(f"   (de ésas ya estaban en SPMM, se saltean: {ya})")
        print(f"FALTAN                  : {len(faltan)} -> {faltan}")
        if not faltan:
            print("\nNada que migrar.")
            return

        filas = await _leer(_query_por_id(faltan))

        # Las FKs las resolvía el JOIN cross-database del MERGE viejo; sin él se
        # resuelven acá, con los mismos defaults que sembraba el sync (SEEDS).
        m_cliente = await _mapa(session, "cliente", "id_viejo")
        m_articulo = await _mapa(session, "articulo", "cod_articulo")
        m_sector = await _mapa(session, "sector", "nombre")
        m_prioridad = await _mapa(session, "prioridad", "descripcion")

        listas, avisos = [], []
        for r in filas:
            f = {k: v for k, v in r.items() if not k.startswith("_")}

            f["id_cliente"] = m_cliente.get(_clave(r["_cliente_viejo"]))
            if f["id_cliente"] is None:
                avisos.append(f"OT {r['id_otvieja']}: cliente {r['_cliente_viejo']} no está en SPMM (queda sin cliente)")

            f["id_articulo"] = m_articulo.get(_clave(r["_cod_articulo"]))
            if f["id_articulo"] is None:
                f["id_articulo"] = m_articulo.get("NO-DEF")
                avisos.append(f"OT {r['id_otvieja']}: artículo '{r['_cod_articulo']}' no está en el catálogo -> NO-DEF")

            # Sector vacío en el legacy es el caso NORMAL, no un error: 832 OT ya
            # quedaron en SIN SECTOR por esto mismo. No inventar un sector.
            f["id_sector"] = m_sector.get(_clave(r["_sector"])) or m_sector.get("SIN SECTOR")
            f["id_prioridad"] = m_prioridad.get(_clave(r["_prioridad"])) or m_prioridad.get("SIN PRIORIDAD")

            listas.append(f)

        print("\nA migrar:")
        for f in sorted(listas, key=lambda x: x["id_otvieja"]):
            prom = f["fecha_prometida"]
            prom = "sin fecha (1950)" if prom and prom.year == 1950 else str(prom)[:10]
            print(f"  OT {f['id_otvieja']}  {str(f['fecha_orden'])[:10]}  "
                  f"art {[k for k, v in m_articulo.items() if v == f['id_articulo']][:1]}  "
                  f"x{f['unidades']}  prometida {prom}")
        for a in avisos:
            print(f"  ! {a}")

        if not APLICAR:
            print("\n(corrida en seco — no se escribió nada; usar --aplicar para insertar)")
            return

        nuevas, cambiadas = await _upsert(
            session, "orden_trabajo", listas, ["id_otvieja"],
            ["id_otvieja"] + COLS_OT, cols_update=[],
        )
        await session.commit()
        print(f"\nINSERTADAS {nuevas} OT (actualizadas {cambiadas} — tiene que decir 0).")
        print("revertir: delete from orden_trabajo where id_otvieja in ("
              + ",".join(str(f["id_otvieja"]) for f in listas) + ");")
        print("\nAhora los procesos: .venv/bin/python -m backend.scripts.migrar_procesos_faltantes --aplicar")


if __name__ == "__main__":
    asyncio.run(main())
