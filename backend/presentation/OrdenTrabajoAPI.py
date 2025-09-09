from fastapi import FastAPI, APIRouter
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.application.CrearOrdenTrabajoService import CrearOrdenTrabajoService
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.dto.OrdenTrabajoDTO import OrdenTrabajoDTO

app = FastAPI()
router = APIRouter()

@router.post("/ordenes-trabajo")
def crear_orden(orden_dto: OrdenTrabajoDTO):
    # Creamos la entidad
    orden = OrdenTrabajo(
        id_ot=orden_dto.id_ot,
        descripcion=orden_dto.descripcion,
        id_operario=orden_dto.id_operario,
        id_maquinaria=orden_dto.id_maquinaria
    )

    # Creamos el servicio con su repositorio
    repository = OrdenTrabajoRepository()
    service = CrearOrdenTrabajoService(repository)

    # Ejecutamos la lógica de negocio
    resultado = service.ejecutar(orden)

    return {
        "id_ot": resultado.id_ot,
        "descripcion": resultado.descripcion,
        "fecha": resultado.fecha,
        "id_operario": resultado.id_operario,
        "id_maquinaria": resultado.id_maquinaria
    }

app.include_router(router)


