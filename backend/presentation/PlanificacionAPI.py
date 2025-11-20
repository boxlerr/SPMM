# backend/presentation/controllers/PlanificacionAPI.py
from fastapi import FastAPI,APIRouter, Depends
from backend.application.PlanificacionService import planificar
from backend.infrastructure.db import SessionLocal

from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

app = FastAPI()
router = APIRouter()

async def get_db():
    async with SessionLocal() as session:
        yield session

@router.post("/planificar")
async def planificar_endpoint(db = Depends(get_db)):
    """repo_orden = OrdenTrabajoRepository(db)
    repo_proceso = ProcesoRepository(db)
    repo_maquina = MaquinariaRepository(db)
    repo_operario = OperarioRepository(db)"""

    """resultados = await planificar(repo_orden, repo_proceso, repo_maquina, repo_operario)
    return resultados"""
    
    repo_orden = OrdenTrabajoRepository(db)
    repo_operario = OperarioRepository(db)
    repo_maquinaria = MaquinariaRepository(db)
    resultados = await planificar(repo_orden,repo_operario,repo_maquinaria,db)
    return resultados
    
    



app.include_router(router)
