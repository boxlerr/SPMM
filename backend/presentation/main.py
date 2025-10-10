from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Routers de presentación
from backend.presentation.ProcesoAPI import router as proceso_router
from backend.presentation.OperarioAPI import router as operario_router
from backend.presentation.OrdenTrabajoAPI import router as orden_trabajo_router
from backend.presentation.SectorAPI import router as sector_router

import logging

app = FastAPI(title="SPMM Backend", version="1.0")

# Configuración CORS
origins = [
    "http://localhost:3000",
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # o usa 'origins' si querés restringir
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 🔹 Registrar todos los routers
app.include_router(proceso_router, tags=["procesos"])
app.include_router(operario_router, tags=["operarios"])
app.include_router(orden_trabajo_router, tags=["ordenes_trabajo"])
app.include_router(sector_router, tags=["sectores"])

# 🔹 Logger básico
logger = logging.getLogger("uvicorn")

# 🔹 Endpoint raíz
@app.get("/")
def root():
    return {"message": "Backend funcionando correctamente 🚀"}
