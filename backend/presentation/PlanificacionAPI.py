# backend/presentation/controllers/PlanificacionAPI.py
from fastapi import FastAPI,APIRouter
from backend.application.PlanificacionService import planificar

app = FastAPI()
router = APIRouter()

@router.get("/jssp")
async def generar_planificacion():
    resultado = await planificar()
    return {"planificacion": resultado}


app.include_router(router)
