# app/exception_handlers.py
from fastapi import Request,HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.DomainException import DomainException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.loggers.logger import logger
from backend.commons.ResponseDTO import ResponseDTO
from backend.dto.ErrorItemDTO import ErrorItemDTO


#----- Handlers personalizados:
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.info("PASAPOR ACA 3")
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
    logger.info("PASAPOR ACA 1")
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

async def domain_handler(request: Request, exc: DomainException):
    return JSONResponse(
        status_code=400,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message=exc.message, campo="global")]
        ).model_dump()
    )

async def generic_handler(request: Request, exc: Exception):
    logger.info("PASAPOR ACA 2")
    logger.exception(f"Error inesperado: {exc}")
    return JSONResponse(
        status_code=500,
        content=ResponseDTO(
            status=False,
            data=None,
            errors=[ErrorItemDTO(message="Error inesperado", campo="global")]
        ).model_dump()
    )
