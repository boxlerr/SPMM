# app/exception_handlers.py
from fastapi import Request,HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.DomainException import DomainException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.PlanificacionException import PlanificacionException
from backend.commons.loggers.logger import logger
from backend.commons.ResponseDTO import ResponseDTO
from backend.dto.ErrorItemDTO import ErrorItemDTO


#----- Handlers personalizados:
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.info("Inicio Validation Exception Handler")
    errores_limpios = []
    for err in exc.errors():
        campo = ".".join(str(x) for x in err["loc"] if x != "body")
        message = err["msg"].replace("Value error, ", "")
        
        # Personalizar message para campos obligatorios
        if err["msg"] == "Field required":
            message = f"El campo {campo} es obligatorio"

        errores_limpios.append(ErrorItemDTO(campo=campo, message=message))

    return JSONResponse(
        status_code=400,
        content=ResponseDTO(status=False, data=None, errors=errores_limpios).model_dump()
    )

async def http_exception_handler(request: Request, exc: HTTPException):
    logger.info("Inicio HTTP Exception Handler")
    detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail), "campo": "global"}
    error_item = ErrorItemDTO(**detail) if isinstance(detail, dict) else ErrorItemDTO(message=str(detail), campo="global")
    respuesta = ResponseDTO(status=False, 
                            data=None, 
                            errors=[error_item])
    return JSONResponse(status_code=exc.status_code, content=respuesta.model_dump())
#-----------------------

# ---------------------- Handlers de excepciones:

"""def constructor_error_response(message: str, status_code: int):
    #Esta funcion construye la respuesta.
    return JSONResponse(
        status_code=status_code,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message=message, campo="global")]
        ).model_dump()
    
    )""" 
#Revisar luego.

async def infrastructure_handler(request: Request, exc: InfrastructureException):
    return JSONResponse(
        status_code=500,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message=exc.message, campo="global")]
        ).model_dump()
    )

async def application_handler(request: Request, exc: ApplicationException):
    return JSONResponse(
        status_code=500,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message=exc.message, campo="global")]
        ).model_dump()
    )
    

async def not_found_handler(request: Request, exc: NotFoundException):
    return JSONResponse(
        status_code=404,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message=exc.message, campo="global")]
        ).model_dump()
    )

async def business_handler(request: Request, exc: BusinessException):
    return JSONResponse(
        status_code=422,  # o 400 si preferís
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message=exc.message, campo="global")]
        ).model_dump()
    )

async def confirmacion_requerida_handler(request: Request, exc: ConfirmacionRequeridaException):
    """
    409: no falló nada, falta confirmar.

    Va separado de business_handler (422) justamente para que el front pueda
    distinguir "esto no se puede" de "esto se puede, pero mirá lo que te llevás":
    con el 409 muestra el motivo y habilita el botón de eliminar igual.
    """
    return JSONResponse(
        status_code=409,
        content=ResponseDTO(
            status=False,
            data={"requiere_confirmacion": True},
            errors=[ErrorItemDTO(message=exc.message, campo="global")]
        ).model_dump()
    )


async def domain_handler(request: Request, exc: DomainException):
    return JSONResponse(
        status_code=400,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message=exc.message, campo="global")]
        ).model_dump()
    )

async def planificacion_handler(request: Request, exc: PlanificacionException):
    return JSONResponse(
        status_code=422,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message=exc.message, campo="global")]
        ).model_dump()
    )

async def generic_handler(request: Request, exc: Exception):
    logger.info("Inicio Generic Exception Handler")
    logger.exception(f"Error inesperado: {exc}")
    return JSONResponse(
        status_code=500,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message="Error inesperado", campo="global")]
        ).model_dump()
    )


# ---------------------- Registro:

def registrar_exception_handlers(app):
    """
    Deja la app con TODOS los handlers de arriba enchufados.

    Antes esta lista vivía suelta en main.py y se desincronizó de este archivo:
    `business_handler` y `planificacion_handler` estaban escritos acá pero nunca
    registrados. Una excepción sin handler no la agarra el ExceptionMiddleware, se
    escapa de la app y la termina atendiendo el ServerErrorMiddleware, que arma el
    500 POR FUERA del CORSMiddleware. Al navegador le llega una respuesta sin
    Access-Control-Allow-Origin, la bloquea, y el fetch del front cae en su catch:
    el usuario lee "Error de conexión" en vez del motivo real —así se veía el
    "No se puede eliminar «RECTIFICADOR»: 2 operarios lo tienen asignado".

    Por eso el registro vive al lado de los handlers: si se agrega uno nuevo y no se
    lo suma acá, el test de backend/tests/test_exception_handlers.py lo marca.
    """
    app.add_exception_handler(InfrastructureException, infrastructure_handler)
    app.add_exception_handler(ApplicationException, application_handler)
    app.add_exception_handler(PlanificacionException, planificacion_handler)
    app.add_exception_handler(DomainException, domain_handler)
    app.add_exception_handler(BusinessException, business_handler)
    app.add_exception_handler(ConfirmacionRequeridaException, confirmacion_requerida_handler)
    app.add_exception_handler(NotFoundException, not_found_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(Exception, generic_handler)
