#Levantar Frotend

cd frontend
npm install
npm run dev

http://localhost:3000

#Levantar Backend

cd backend
python -m venv venv # crear entorno virtual
venv\Scripts\activate # en Windows

pip install -r requirements.txt

# Levantar el servidor

uvicorn backend.carpeta.archivo.py:app (direccion del archivo que vamos a correr)

http://127.0.0.1:8000

en caso que no te ande FastAPI y SQLAlchemy:
pip install fastapi uvicorn
pip install sqlalchemy


## Configuración BDD

1. Copiar `.env.example` a `.env`
2. Completar las variables de entorno necesarias:
   - DB_SERVER
   - DB_NAME
   - DB_USER
   - DB_PASSWORD
   - TRUSTED_CONNECTION
