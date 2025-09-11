""" from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List

app = FastAPI()

# Modelo de request/response
class Operario(BaseModel):
    id: int
    nombre: str
    especialidad: str

# "Base de datos" en memoria --------
operarios: List[Operario] = []

@app.get("/")
def read_root():
    return {"message": "Hola, FastAPI funcionando 🚀"}

# Nuevo recurso: lista de operarios
# Listar todos
@app.get("/operarios", response_model=List[Operario])
def list_operarios():
    return operarios



@app.get("/operarios/{operario_id}", response_model=Operario)
def get_operario(operario_id: int):
    for o in operarios:
        if o.id == operario_id:
            return o
    raise HTTPException(status_code=404, detail="Operario no encontrado")

# Crear un nuevo operario (POST)
@app.post("/operarios", response_model=Operario)
def create_operario(operario: Operario):
    operarios.append(operario)
    return operario

# Actualizar (PUT)
@app.put("/operarios/{operario_id}", response_model=Operario)
def update_operario(operario_id: int, datos: Operario):
    for index, o in enumerate(operarios):
        if o.id == operario_id:
            operarios[index] = datos
            return datos
    raise HTTPException(status_code=404, detail="Operario no encontrado")

# Eliminar (DELETE)
@app.delete("/operarios/{operario_id}")
def delete_operario(operario_id: int):
    for index, o in enumerate(operarios):
        if o.id == operario_id:
            operarios.pop(index)
            return {"message": f"Operario {operario_id} eliminado"}
    raise HTTPException(status_code=404, detail="Operario no encontrado") """

from fastapi import FastAPI
from backend.presentation.OrdenTrabajoAPI import router as orden_trabajo_router

app = FastAPI()

app.include_router(orden_trabajo_router)



