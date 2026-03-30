import asyncio
import os
import sys

# Add project root to sys.path
sys.path.append(os.path.abspath("."))

from backend.infrastructure.db import SessionLocal
from sqlalchemy import text

async def check():
    async with SessionLocal() as db:
        query = text("""
            SELECT p.id_planificacion_lote, 
                   COUNT(*) as total_registros,
                   SUM(CASE WHEN (ot.fecha_entrega = '1950-01-01 00:00:00' OR ot.fecha_entrega IS NULL) THEN 0 ELSE 1 END) as registros_finalizados
            FROM planificacion p
            INNER JOIN orden_trabajo ot ON p.orden_id = ot.id
            GROUP BY p.id_planificacion_lote
        """)
        res = await db.execute(query)
        rows = res.fetchall()
        print("| Lote ID | Total | Finalizados | Se puede borrar? |")
        print("|---------|-------|-------------|------------------|")
        for row in rows:
            lote_id, total, finished = row
            can_delete = "Solo parcial" if finished > 0 else "Sí, todo"
            print(f"| {lote_id} | {total} | {finished} | {can_delete} |")

if __name__ == "__main__":
    asyncio.run(check())
