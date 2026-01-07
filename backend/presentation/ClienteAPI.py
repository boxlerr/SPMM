from fastapi import FastAPI, APIRouter, Depends
from backend.application.ClienteService import ClienteService
from backend.dto.ClienteRequestDTO import ClienteRequestDTO
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user


app = FastAPI()
router = APIRouter(
    dependencies=[Depends(get_current_user)]
)

# 🔹 Dependencia para obtener sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session

# 🔹 Crear cliente
@router.post("/clientes")
async def crear_cliente(cliente_dto: ClienteRequestDTO, db=Depends(get_db)):
    logger.info("API - Inicio POST /clientes")
    service = ClienteService(db)
    result = await service.crearCliente(cliente_dto)
    return result

# 🔹 Listar todos los clientes
@router.get("/clientes")
async def listar_clientes(db=Depends(get_db)):
    logger.info("API - Inicio GET /clientes")
    service = ClienteService(db)
    return await service.listarClientes()

# 🔹 Obtener cliente por ID
@router.get("/clientes/{id}")
async def obtener_cliente(id: int, db=Depends(get_db)):
    service = ClienteService(db)
    return await service.obtenerClientePorId(id)

# 🔹 Actualizar cliente
@router.put("/clientes/{id}")
async def actualizar_cliente(id: int, cliente_dto: ClienteRequestDTO, db=Depends(get_db)):
    logger.info(f"API - Inicio PUT /clientes/{id}")
    service = ClienteService(db)
    return await service.actualizarCliente(id, cliente_dto)

# 🔹 Eliminar cliente
@router.delete("/clientes/{id}")
async def eliminar_cliente(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /clientes/{id}")
    service = ClienteService(db)
    return await service.eliminarCliente(id)

app.include_router(router)
