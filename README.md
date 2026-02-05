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

## Keep Alive (Render Cold Start)

Para evitar el "cold start" del plan gratuito de Render, se configuró un **GitHub Action** que hace ping al endpoint `/health` cada 10 minutos.

### Configuración

1.  Ir a **Settings > Secrets and variables > Actions** en el repositorio.
2.  Crear un **New Repository Secret**:
    *   **Name**: `KEEPALIVE_URL`
    *   **Value**: `https://TU-APP-EN-RENDER.onrender.com/health`

> **Nota:** Si no se configura este secret, el action fallará o intentará usar una URL por defecto que no funcionará.

### Uso Manual

El workflow corre automáticamente, pero se puede ejecutar manualmente:

1.  Ir a la pestaña **Actions**.
2.  Seleccionar "Keep Alive".
3.  Click en **Run workflow**.

### Endpoint `/health`

El backend expone `GET /health` que retorna:
```json
{
  "status": "ok",
  "timestamp": "2024-02-05T10:00:00.123456",
  "service": "SPMM Backend"
}
```
Este endpoint tiene `Cache-Control: no-store` para asegurar que la petición llegue siempre al servidor.
