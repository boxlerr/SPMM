import asyncio
from sqlalchemy import text
from backend.infrastructure.db import engine

async def migrate():
    print("Iniciando migración de base de datos...")
    async with engine.begin() as conn:
        try:
            # SQL Server syntax to add columns with defaults
            print("Agregando columna hora_inicio...")
            await conn.execute(text("ALTER TABLE operario ADD hora_inicio TIME NOT NULL DEFAULT '09:00:00'"))
            print("Agregando columna hora_fin...")
            await conn.execute(text("ALTER TABLE operario ADD hora_fin TIME NOT NULL DEFAULT '18:00:00'"))
            print("Migración completada exitosamente.")
        except Exception as e:
            if "already" in str(e).lower() or "exists" in str(e).lower():
                print("Las columnas ya existen o hubo un error manejable.")
            else:
                print(f"Error durante la migración: {e}")
                raise e

if __name__ == "__main__":
    asyncio.run(migrate())
