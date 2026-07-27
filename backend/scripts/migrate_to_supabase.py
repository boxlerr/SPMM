"""
Migración SQL Server (SMPP on-prem) → Supabase (Postgres).

Cubre las fases 1 y 2 del plan de migración: crear el esquema en Supabase a
partir de los modelos del ORM y copiar los datos tabla por tabla.

Uso (desde la raíz del repo):
    backend/venv/bin/python -m backend.scripts.migrate_to_supabase schema
    backend/venv/bin/python -m backend.scripts.migrate_to_supabase data
    backend/venv/bin/python -m backend.scripts.migrate_to_supabase verify
    backend/venv/bin/python -m backend.scripts.migrate_to_supabase all

Se puede limitar a algunas tablas:
    ... migrate_to_supabase data articulo pieza

Variables de entorno (.env de la raíz, ya está gitignoreado):
    DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD  → origen (SQL Server)
    SUPABASE_DB_URL                           → destino, por ejemplo:
        postgresql+psycopg2://postgres:PASS@db.xxxx.supabase.co:5432/postgres
    (si la red es IPv4, usar la cadena del "Session pooler" del dashboard)

Es re-ejecutable: `schema` usa create_all (no toca lo que ya existe) y `data`
vacía cada tabla destino antes de insertar, respetando el orden de las FKs.
"""

import os
import sys
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, func, select, text

# Importar el paquete de modelos puebla Base.metadata con todas las tablas.
import backend.domain  # noqa: F401
from backend.infrastructure.db import Base

load_dotenv()

# `ots_validas` es una tabla auxiliar (159 filas) que no tiene modelo en el ORM.
# La declaramos acá para que entre en create_all y en la copia de datos.
if "ots_validas" not in Base.metadata.tables:
    Table("ots_validas", Base.metadata, Column("id_ot", Integer, primary_key=True))

BATCH = 1000
BATCH_BLOB = 50  # tablas con binarios (plano.archivo) van de a poco


def _src_engine():
    """Engine sincrónico contra el SQL Server on-prem (mismas credenciales que la app)."""
    driver = "ODBC Driver 17 for SQL Server"
    if (os.getenv("TRUSTED_CONNECTION") or "").lower() == "yes":
        conn = (
            f"DRIVER={{{driver}}};SERVER={os.getenv('DB_SERVER')};"
            f"DATABASE={os.getenv('DB_NAME')};Trusted_Connection=yes;"
            f"TrustServerCertificate=yes;"
        )
    else:
        conn = (
            f"DRIVER={{{driver}}};SERVER={os.getenv('DB_SERVER')};"
            f"DATABASE={os.getenv('DB_NAME')};UID={os.getenv('DB_USER')};"
            f"PWD={os.getenv('DB_PASSWORD')};TrustServerCertificate=yes;"
        )
    return create_engine(f"mssql+pyodbc:///?odbc_connect={quote_plus(conn)}", future=True)


def _dst_engine():
    url = os.getenv("SUPABASE_DB_URL")
    if not url:
        sys.exit(
            "Falta SUPABASE_DB_URL en el .env.\n"
            "Copiala del dashboard de Supabase (Connect → ORM / Direct connection) y pegala así:\n"
            "  SUPABASE_DB_URL=postgresql+psycopg2://postgres:TU_PASS@db.xxxx.supabase.co:5432/postgres"
        )
    # Aceptamos la URL tal cual la da Supabase (postgresql://) y le ponemos el driver.
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return create_engine(url, future=True)


def _tablas(filtro):
    """Tablas en orden seguro de FKs (padres antes que hijos)."""
    tablas = list(Base.metadata.sorted_tables)
    if filtro:
        tablas = [t for t in tablas if t.name in filtro]
    return tablas


def cmd_schema(dst):
    print("→ Creando esquema en Supabase (create_all)...")
    Base.metadata.create_all(dst)
    with dst.connect() as c:
        n = c.execute(
            text("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
        ).scalar()
    print(f"✓ Esquema listo. Tablas en public: {n}")


def cmd_data(src, dst, filtro):
    tablas = _tablas(filtro)

    # Vaciar en orden inverso (hijos antes que padres) para no romper FKs.
    print("→ Vaciando tablas destino...")
    with dst.begin() as c:
        for t in reversed(tablas):
            c.execute(t.delete())

    print("→ Copiando datos...")
    total = 0
    with src.connect() as s:
        for t in tablas:
            filas = [dict(r) for r in s.execute(select(t)).mappings()]
            if not filas:
                print(f"   {t.name:<28} 0")
                continue
            tiene_blob = any(str(col.type).upper().startswith(("LARGEBINARY", "BYTEA")) for col in t.columns)
            paso = BATCH_BLOB if tiene_blob else BATCH
            with dst.begin() as d:
                for i in range(0, len(filas), paso):
                    d.execute(t.insert(), filas[i : i + paso])
            total += len(filas)
            print(f"   {t.name:<28} {len(filas)}")
    print(f"✓ Copiadas {total} filas en {len(tablas)} tablas")

    # Las secuencias de las PK autoincrementales quedan en 1 tras insertar IDs
    # explícitos: hay que llevarlas a max(id) o el primer INSERT nuevo choca.
    print("→ Reseteando secuencias...")
    with dst.begin() as d:
        for t in tablas:
            pk = list(t.primary_key.columns)
            if len(pk) != 1 or not isinstance(pk[0].type, Integer):
                continue
            col = pk[0].name
            d.execute(
                text(
                    f"SELECT setval(pg_get_serial_sequence('{t.name}', '{col}'), "
                    f"COALESCE((SELECT MAX({col}) FROM {t.name}), 1), true) "
                    f"WHERE pg_get_serial_sequence('{t.name}', '{col}') IS NOT NULL"
                )
            )
    print("✓ Secuencias al día")


def cmd_verify(src, dst, filtro):
    print(f"{'TABLA':<28}{'ORIGEN':>10}{'DESTINO':>10}   ESTADO")
    ok = True
    with src.connect() as s, dst.connect() as d:
        for t in _tablas(filtro):
            a = s.execute(select(func.count()).select_from(t)).scalar()
            b = d.execute(select(func.count()).select_from(t)).scalar()
            estado = "OK" if a == b else "DIFIERE"
            if a != b:
                ok = False
            print(f"{t.name:<28}{a:>10}{b:>10}   {estado}")
    print("\n✓ Todo coincide" if ok else "\n✗ Hay diferencias, revisar")
    return ok


def main():
    args = sys.argv[1:]
    if not args or args[0] not in {"schema", "data", "verify", "all"}:
        sys.exit(__doc__)
    cmd, filtro = args[0], set(args[1:])

    dst = _dst_engine()
    if cmd == "schema":
        cmd_schema(dst)
        return
    src = _src_engine()
    if cmd == "data":
        cmd_data(src, dst, filtro)
    elif cmd == "verify":
        cmd_verify(src, dst, filtro)
    else:
        cmd_schema(dst)
        cmd_data(src, dst, filtro)
        cmd_verify(src, dst, filtro)


if __name__ == "__main__":
    main()
