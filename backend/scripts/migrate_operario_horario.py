"""
Fase 2a: agrega los campos dias_trabajo, min_desayuno y min_almuerzo
a la tabla `operario`. Idempotente: chequea cada columna antes de crear.
"""
import asyncio
from sqlalchemy import text
from backend.infrastructure.db import engine


COLUMNAS = [
    (
        "dias_trabajo",
        "VARCHAR(50) NOT NULL CONSTRAINT DF_operario_dias_trabajo DEFAULT 'MON,TUE,WED,THU,FRI'",
    ),
    (
        "min_desayuno",
        "INT NOT NULL CONSTRAINT DF_operario_min_desayuno DEFAULT 15",
    ),
    (
        "min_almuerzo",
        "INT NOT NULL CONSTRAINT DF_operario_min_almuerzo DEFAULT 30",
    ),
]


async def migrate():
    print("Iniciando migración Fase 2a (horario operario)...")
    async with engine.begin() as conn:
        for nombre, definicion in COLUMNAS:
            existe = await conn.execute(
                text(
                    "SELECT 1 FROM sys.columns "
                    "WHERE Name = :col AND Object_ID = OBJECT_ID('operario')"
                ),
                {"col": nombre},
            )
            if existe.first():
                print(f"  - {nombre}: ya existe, salteando.")
                continue

            print(f"  - {nombre}: agregando...")
            await conn.execute(text(f"ALTER TABLE operario ADD {nombre} {definicion}"))
            print(f"  - {nombre}: OK.")

    print("Migración Fase 2a completada.")


if __name__ == "__main__":
    asyncio.run(migrate())
