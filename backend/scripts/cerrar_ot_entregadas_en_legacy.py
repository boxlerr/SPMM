"""Cierra en SPMM las OT que el sistema viejo ya entregó.

Por qué hace falta: el sync se apagó el 2/9/2026 y con él se cortaron las DOS
direcciones. `migrar_ot_faltantes` tapa una —las OT nuevas que se dan de alta allá y no
llegan acá—; ésta tapa la otra: el taller marca la entrega en el programa viejo y en
SPMM la orden sigue abierta, así que el planificador le sigue haciendo lugar a trabajo
que ya salió por la puerta. El 10/9/2026 eran 19 OT.

Qué toma como "entregada": la misma regla del legacy —una `fechaentrega` de verdad (no
el 1950-01-01 que es su "sin fecha") o `fc = 1`—. No inventa nada: copia la fecha de
entrega y la cantidad entregada tal cual están allá.

Qué NO hace: no toca las suspendidas ni las de la marca `ttt1`. Ésas no están entregadas,
están frenadas o son otra cosa, y decidir qué hacer con ellas es del taller. Tampoco toca
una OT sin `id_otvieja`: si se creó en SPMM, el legacy no tiene nada que decir.

    .venv/bin/python -m backend.scripts.cerrar_ot_entregadas_en_legacy
    .venv/bin/python -m backend.scripts.cerrar_ot_entregadas_en_legacy --aplicar
"""
import asyncio
import sys

from sqlalchemy import text

from backend.infrastructure.db import SessionLocal
from backend.scripts.sync_db import _leer

APLICAR = "--aplicar" in sys.argv

# El "sin fecha" del legacy. Ver [[no-tocar-datos-del-cliente]]: se copia tal cual, no se
# reemplaza por una fecha inventada.
SIN_FECHA = "1950-01-01"

Q_ESTADO = """
SELECT v.idot,
       CASE WHEN v.fechaentrega = '{sin_fecha}' THEN NULL ELSE v.fechaentrega END AS fecha_entrega,
       ISNULL(v.fc, 0) AS fc,
       v.cantidad,
       ISNULL(v.cantidadE, 0) AS cantidad_entregada
FROM dbo.otrabajo v
WHERE v.idot IN ({ids})
"""


async def main():
    async with SessionLocal() as session:
        res = await session.execute(text("""
            SELECT id_otvieja FROM orden_trabajo
             WHERE id_otvieja IS NOT NULL
               AND COALESCE(finalizadototal, 0) = 0
               AND fecha_entrega IS NULL
        """))
        abiertas = [r[0] for r in res]
        print(f"OT abiertas en SPMM que vienen del sistema viejo: {len(abiertas)}")
        if not abiertas:
            return

        filas = await _leer(Q_ESTADO.format(
            sin_fecha=SIN_FECHA, ids=",".join(str(i) for i in abiertas)))
        cerradas = [f for f in filas if f["fecha_entrega"] is not None or f["fc"] == 1]

        print(f"De ésas, el sistema viejo ya entregó o cerró: {len(cerradas)}\n")
        for f in sorted(cerradas, key=lambda x: x["idot"]):
            fecha = str(f["fecha_entrega"])[:10] if f["fecha_entrega"] else "sin fecha"
            print(f"  OT {f['idot']}  entregada {fecha}  "
                  f"{f['cantidad_entregada']}/{f['cantidad']}")

        if not cerradas:
            print("Nada que cerrar.")
            return
        if not APLICAR:
            print("\n(corrida en seco — no se escribió nada; usar --aplicar)")
            return

        for f in cerradas:
            await session.execute(text("""
                UPDATE orden_trabajo
                   SET finalizadototal = 1,
                       fc = :fc,
                       fecha_entrega = :fecha_entrega,
                       cantidad_entregada = :cantidad_entregada
                 WHERE id_otvieja = :idot
            """), f)
        await session.commit()

        ids = ",".join(str(f["idot"]) for f in sorted(cerradas, key=lambda x: x["idot"]))
        print(f"\nCERRADAS {len(cerradas)} OT.")
        print("revertir: update orden_trabajo set finalizadototal=0, fecha_entrega=null, "
              f"cantidad_entregada=0 where id_otvieja in ({ids});")


if __name__ == "__main__":
    asyncio.run(main())
