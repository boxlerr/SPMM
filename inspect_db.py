import asyncio
from backend.infrastructure.db import SessionLocal
from sqlalchemy import text

async def inspect():
    async with SessionLocal() as session:
        # Query for SQL Server to list columns
        result = await session.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orden_trabajo'"))
        columns = [row[0] for row in result.fetchall()]
        print("Columns in orden_trabajo:", columns)

if __name__ == "__main__":
    asyncio.run(inspect())
