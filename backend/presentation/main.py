from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.presentation.ProcesoAPI import router as proceso_router
from backend.presentation.OperarioAPI import router as operario_router
# Descomenta estas líneas cuando las necesites:
# from backend.presentation.SectorAPI import router as sector_router
# from backend.presentation.OrdenTrabajoAPI import router as orden_trabajo_router

app = FastAPI()

# Configuración de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # En producción, especifica los orígenes permitidos
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir routers
app.include_router(proceso_router, tags=["procesos"])
app.include_router(operario_router, tags=["operarios"])
# Descomenta estas líneas cuando las necesites:
# app.include_router(sector_router, tags=["sectores"])
# app.include_router(orden_trabajo_router, tags=["ordenes"])

@app.get("/")
def root():
    return {"message": "Backend funcionando correctamente 🚀"}