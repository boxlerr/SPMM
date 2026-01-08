from fastapi import FastAPI,HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
# Routers de presentación
from backend.presentation.ProcesoAPI import router as proceso_router
from backend.presentation.OperarioAPI import router as operario_router
from backend.presentation.OrdenTrabajoAPI import router as orden_trabajo_router
from backend.presentation.SectorAPI import router as sector_router
from backend.presentation.ArticuloAPI import router as articulo_router
from backend.presentation.PlanificacionAPI import router as plan_router
from backend.presentation.PrioridadAPI import router as prioridad_router
from backend.presentation.MaquinariaAPI import router as maquinaria_router
from backend.presentation.AuthAPI import router as auth_router
from backend.presentation.NotificacionAPI import router as notificacion_router
from backend.presentation.DashboardAPI import router as dashboard_router
from backend.presentation.PlanoAPI import router as plano_router
from backend.presentation.ClienteAPI import router as cliente_router
from backend.presentation.ConfigAPI import router as config_router

import logging

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.DomainException import DomainException


from backend.commons.handlers.exception_handlers import (
    application_handler,
    infrastructure_handler,
    validation_exception_handler,
    http_exception_handler,
    not_found_handler,
    domain_handler,
    generic_handler,
    not_found_handler
)

app = FastAPI(title="SPMM Backend", version="1.0")

from backend.core.config import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 🔹 Registrar todos los routers
app.include_router(auth_router)  # Autenticación
app.include_router(articulo_router, tags=["articulos"])
app.include_router(proceso_router, tags=["procesos"])
app.include_router(operario_router, tags=["operarios"])
app.include_router(orden_trabajo_router, tags=["ordenes_trabajo"])
app.include_router(sector_router, tags=["sectores"])
app.include_router(plan_router,tags=["planificacion"])
app.include_router(prioridad_router,tags=["prioridades"])
app.include_router(maquinaria_router,tags=["maquinarias"])
app.include_router(notificacion_router, tags=["notificaciones"])
app.include_router(dashboard_router, tags=["dashboard"])
app.include_router(plano_router, tags=["planos"])
app.include_router(cliente_router, tags=["clientes"])
app.include_router(config_router)

# Agrega los handler de exepciones globales al contexto de la aplicacion
app.add_exception_handler(InfrastructureException, infrastructure_handler)
app.add_exception_handler(ApplicationException, application_handler)
app.add_exception_handler(DomainException, domain_handler)
app.add_exception_handler(Exception, generic_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(NotFoundException, not_found_handler)


# 🔹 Logger básico
logger = logging.getLogger("uvicorn")

# 🔹 Endpoint raíz
@app.get("/")
def root():
    return {"message": "Backend funcionando correctamente"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
