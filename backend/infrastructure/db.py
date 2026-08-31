
import os
import re
from urllib.parse import quote_plus
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from backend.commons.loggers.logger import logger

# 🔹 Cargar variables de entorno desde .env
# Asegurate de tener instalado python-dotenv → pip install python-dotenv
load_dotenv()

# ---------------------------------------------------------------------------
# La app puede apuntar a Postgres (Supabase) o al SQL Server on-prem.
#
#   - Si existe SUPABASE_DB_URL (o DATABASE_URL) → Postgres/Supabase.
#   - Si no → SQL Server por ODBC, como venía funcionando.
#
# Así el cutover (y el rollback, si algo sale mal) es cambiar UNA variable de
# entorno en Render, sin tocar código ni redeployar otra rama.
# ---------------------------------------------------------------------------
PG_URL = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")

DB_PASSWORD = os.getenv("DB_PASSWORD")
engine_kwargs = {}

if PG_URL:
    # Normalizamos el prefijo: Supabase entrega "postgresql://..." y nosotros
    # necesitamos el driver async.
    url = PG_URL
    for viejo in ("postgresql+psycopg2://", "postgresql+asyncpg://", "postgresql://", "postgres://"):
        if url.startswith(viejo):
            url = "postgresql+asyncpg://" + url[len(viejo):]
            break
    DATABASE_URL = url

    # Supabase se conecta a través de su pooler (Supavisor). Los prepared
    # statements con nombre no sobreviven a un pooler en modo transaction, así
    # que desactivamos el cache de asyncpg: evita el clásico "prepared statement
    # _pgN already exists" si algún día se pasa al puerto 6543 (transaction).
    engine_kwargs["connect_args"] = {"statement_cache_size": 0}

    # Cuántas conexiones abre ESTA instancia contra el pooler.
    #
    # El session pooler de Supabase tiene un tope de clientes para TODO el
    # proyecto (15 en el plan actual), y el default de SQLAlchemy —5 fijas + 10
    # de overflow— se lo come entero una sola instancia. Con producción andando,
    # cualquier segundo backend contra la misma base (uno local, un script, una
    # revisión nueva conviviendo con la vieja durante un deploy) se lleva:
    #
    #     (EMAXCONNSESSION) max clients reached in session mode
    #                       - max clients are limited to pool_size: 15
    #
    # No es un error del código: es la suma de los pools. Se deja configurable
    # para poder levantar un backend local con una o dos conexiones sin dejar sin
    # lugar al de producción. Los valores por defecto son los mismos de antes.
    engine_kwargs["pool_size"] = int(os.getenv("DB_POOL_SIZE", "5"))
    engine_kwargs["max_overflow"] = int(os.getenv("DB_MAX_OVERFLOW", "10"))
    logger.info(
        "DB: Postgres (Supabase) — pool %s + %s de overflow",
        engine_kwargs["pool_size"], engine_kwargs["max_overflow"],
    )
else:
    DRIVER = "ODBC Driver 17 for SQL Server"
    DB_SERVER = os.getenv("DB_SERVER")
    DB_NAME = os.getenv("DB_NAME")
    DB_USER = os.getenv("DB_USER")
    TRUSTED = os.getenv("TRUSTED_CONNECTION")

    # 🔹 Armar la cadena ODBC según el tipo de conexión
    if TRUSTED and TRUSTED.lower() == "yes":
        connection_string = (
            f"DRIVER={{{DRIVER}}};"
            f"SERVER={DB_SERVER};"
            f"DATABASE={DB_NAME};"
            f"Trusted_Connection=yes;"
            f"MARS_Connection=yes;"
            f"TrustServerCertificate=yes;"
        )
    else:
        connection_string = (
            f"DRIVER={{{DRIVER}}};"
            f"SERVER={DB_SERVER};"
            f"DATABASE={DB_NAME};"
            f"UID={DB_USER};"
            f"PWD={DB_PASSWORD};"
            f"MARS_Connection=yes;"
            f"TrustServerCertificate=yes;"
        )

    # 🔹 Codificar correctamente para aioodbc
    DATABASE_URL = f"mssql+aioodbc:///?odbc_connect={quote_plus(connection_string)}"
    logger.info("DB: SQL Server (on-prem)")

# 🔹 Loguear resultado sin exponer credenciales.
# Se enmascara SIEMPRE la contraseña que venga en la URL (antes solo se tapaba
# DB_PASSWORD, así que la de Postgres se escribía en claro en los logs).
safe_log = re.sub(r"://([^:/@]+):[^@]*@", r"://\1:*****@", DATABASE_URL)
if DB_PASSWORD:
    safe_log = safe_log.replace(DB_PASSWORD, "*****")
logger.info(f"Resultado URL: {safe_log}")

# 🔹 Crear el engine asincrónico
# pool_pre_ping: prueba cada conexión antes de usarla y descarta las muertas.
#   Evita el error intermitente "server disconnected" cuando el servidor / el
#   firewall cierra conexiones ociosas y el pool entrega una conexión obsoleta.
# pool_recycle: recicla conexiones con más de 30 min para que no lleguen a
#   quedar obsoletas por timeout del servidor.
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True,
    pool_recycle=1800,
    **engine_kwargs,
)

# 🔹 Crear la sesión asincrónica
SessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False
)

# 🔹 Base para los modelos
Base = declarative_base()
