import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Cargar variables desde .env
load_dotenv()

# Variables de entorno
DB_SERVER = os.getenv("DB_SERVER")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
TRUSTED = os.getenv("TRUSTED_CONNECTION")  # "yes" o "no"
DRIVER = "ODBC+Driver+17+for+SQL+Server"

# Armar la URL según el tipo de conexión
if TRUSTED and TRUSTED.lower() == "yes":
    DATABASE_URL = f"mssql+pyodbc://@{DB_SERVER}/{DB_NAME}?driver={DRIVER}&trusted_connection=yes"
else:
    DATABASE_URL = f"mssql+pyodbc://{DB_USER}:{DB_PASSWORD}@{DB_SERVER}/{DB_NAME}?driver={DRIVER}"

# Crear el engine y la sesión
engine = create_engine(DATABASE_URL, echo=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# Base para los modelos
Base = declarative_base()

