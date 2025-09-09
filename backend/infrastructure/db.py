from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Cambiá los valores por los de tu entorno
DB_SERVER = r"localhost\SQLEXPRESS"        # o el nombre de tu servidor
DB_NAME = "SMPP"               # tu base de datos
#DB_USER = "sa"                 # tu usuario
#DB_PASSWORD = "tu_password"    # tu password
DRIVER = "ODBC+Driver+17+for+SQL+Server"  # revisá el nombre exacto en tu PC

#DATABASE_URL = f"mssql+pyodbc://{DB_USER}:{DB_PASSWORD}@{DB_SERVER}/{DB_NAME}?driver={DRIVER}"
DATABASE_URL = f"mssql+pyodbc://@{DB_SERVER}/{DB_NAME}?driver={DRIVER}&trusted_connection=yes"

engine = create_engine(DATABASE_URL, echo=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base = declarative_base()
