""" 

from fastapi import FastAPI
from backend.presentation.OrdenTrabajoAPI import router as orden_trabajo_router
from backend.presentation.SectorAPI import router as sector_router
from backend.presentation.OperarioAPI import router as operario_router

app = FastAPI()

app.include_router(orden_trabajo_router)
app.include_router(sector_router)
app.include_router(operario_router)



"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.presentation.ProcesoAPI import router as proceso_router

app = FastAPI()

origins = [
    "http://localhost:3000/",
    "http://localhost:8000/",
]

app.add_middleware(
    CORSMiddleware,
    allow_origin=".",   # acepta cualquier origen
    allow_credentials=True,
    allow_methods=["."],
    allow_headers=["*"],
)

app.include_router(proceso_router, tags=["procesos"])

@app.get("/")
def root():
    return {"message": "Backend funcionando correctamente 🚀"}

