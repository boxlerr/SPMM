
import os
from urllib.parse import quote_plus
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from backend.commons.loggers.logger import logger

# 🔹 Cargar variables de entorno desde .env
# Asegurate de tener instalado python-dotenv → pip install python-dotenv
load_dotenv()

# 🔹 Leer variables
DB_SERVER = os.getenv("DB_SERVER")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
TRUSTED = os.getenv("TRUSTED_CONNECTION")
DRIVER = "ODBC Driver 17 for SQL Server"

# 🔹 Armar la cadena ODBC según el tipo de conexión
if TRUSTED and TRUSTED.lower() == "yes":
    connection_string = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={DB_SERVER};"
        f"DATABASE={DB_NAME};"
        f"Trusted_Connection=yes;"
        f"MARS_Connection=yes;"
    )
else:
    connection_string = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={DB_SERVER};"
        f"DATABASE={DB_NAME};"
        f"UID={DB_USER};"
        f"PWD={DB_PASSWORD};"
        f"MARS_Connection=yes;"
    )

# 🔹 Codificar correctamente para aioodbc
params = quote_plus(connection_string)

# 🔹 Construir la URL final
DATABASE_URL = f"mssql+aioodbc:///?odbc_connect={params}"

# 🔹 Loguear resultado sin exponer credenciales
safe_log = DATABASE_URL.replace(DB_PASSWORD or "", "*****") if DB_PASSWORD else DATABASE_URL
logger.info(f"Resultado URL: {safe_log}")

# 🔹 Crear el engine asincrónico
engine = create_async_engine(DATABASE_URL, echo=False, future=True)

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



