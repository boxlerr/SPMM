from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
# Routers de presentación
from backend.presentation.ProcesoAPI import router as proceso_router
from backend.presentation.OperarioAPI import router as operario_router
from backend.presentation.OrdenTrabajoAPI import router as orden_trabajo_router
from backend.presentation.SectorAPI import router as sector_router
import logging

#from backend.commons.exceptions import ApplicationException,BusinessException,DomainException,InfrastructureException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException

"""from backend.commons.handlers.exception_handlers import (
    application_handler,
    validation_exception_handler,
    http_exception_handler,
    infrastructure_handler,
    domain_handler,
    generic_handler,
    not_found_handler
)"""

from backend.commons.handlers.exception_handlers import (
    infrastructure_handler,
    validation_exception_handler,
    not_found_handler
)




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


# Agrega los handler de exepciones globales al contexto de la aplicacion
app.add_exception_handler(InfrastructureException, infrastructure_handler)
#app.add_exception_handler(ApplicationException, application_handler)
#app.add_exception_handler(DomainException, domain_handler)
#app.add_exception_handler(Exception, generic_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
#app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(NotFoundException, not_found_handler)



# 🔹 Logger básico
logger = logging.getLogger("uvicorn")

# 🔹 Endpoint raíz
@app.get("/")
def root():
    return {"message": "Backend funcionando correctamente 🚀"}
