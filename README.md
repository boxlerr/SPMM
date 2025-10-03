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
