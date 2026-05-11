"""
Configuración de variables de entorno
"""
import os
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

class Settings:
    """Configuración de la aplicación"""
    
    # Base de datos
    DB_SERVER: str = os.getenv("DB_SERVER", "localhost")
    DB_NAME: str = os.getenv("DB_NAME", "SMPP")
    DB_USER: str = os.getenv("DB_USER", "")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    TRUSTED_CONNECTION: str = os.getenv("TRUSTED_CONNECTION", "no")
    
    # JWT
    SECRET_KEY: str = os.getenv("SECRET_KEY", "your-secret-key-here")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    # JWT vence en 30 días por default. Si el equipo está siempre en la oficina
    # y la app es interna, mantener la sesión abierta evita la fricción de tener
    # que loguearse cada turno. Se puede sobreescribir con env var en Render.
    # (8h = 480, 1 día = 1440, 7 días = 10080, 30 días = 43200, 1 año = 525600)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "43200"))
    
    # Resend Email
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    FROM_EMAIL: str = os.getenv("FROM_EMAIL", "noreply@metalurgicalongchamps.com")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    
    # CORS
    CORS_ORIGINS: list = [
        "http://localhost:3000",
        "http://localhost:8000",
        "https://www.metlosys.com",
        "https://metlosys.com",
        "https://spmm-1.onrender.com", # Backend production itself
        os.getenv("FRONTEND_URL", ""),
        "*" # Permissive for now to ensure connectivity from any frontend
    ]

# Instancia global de configuración
settings = Settings()
