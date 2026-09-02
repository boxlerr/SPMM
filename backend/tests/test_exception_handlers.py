"""
Los errores de negocio tienen que llegar al navegador, no morir en un 500.

El bug: `business_handler` estaba escrito pero nunca registrado. Sin handler, la
excepción se escapa de la app y la atiende el ServerErrorMiddleware, que arma el 500
POR FUERA del CORSMiddleware. La respuesta sale sin Access-Control-Allow-Origin, el
navegador la bloquea y el fetch del front cae en su catch: el usuario leía "Error de
conexión al eliminar el rango" en lugar de "2 operarios lo tienen asignado".
"""
import inspect

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.testclient import TestClient

from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import (
    ConfirmacionRequeridaException,
)
from backend.commons.handlers import exception_handlers
from backend.commons.handlers.exception_handlers import registrar_exception_handlers

ORIGIN = "https://metlosys.com"

MOTIVO = (
    "No se puede eliminar «RECTIFICADOR»: 2 operarios lo tienen asignado. "
    "Cambiales el rango primero."
)


def _app_con_cors():
    """Una app mínima armada como la real: CORS por fuera, handlers registrados."""
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    registrar_exception_handlers(app)

    @app.delete("/rangos/{id}")
    async def _borrar(id: int):
        raise BusinessException(MOTIVO)

    @app.delete("/rangos/{id}/confirmable")
    async def _borrar_confirmable(id: int):
        raise ConfirmacionRequeridaException(MOTIVO)

    return app


def test_el_motivo_de_negocio_llega_con_cabecera_cors():
    with TestClient(_app_con_cors()) as client:
        r = client.delete("/rangos/13", headers={"Origin": ORIGIN})

    # 422 y no 500: el borrado no falló, se rechazó por una regla.
    assert r.status_code == 422
    # Sin esta cabecera el navegador descarta la respuesta y el front muestra
    # "Error de conexión", que fue exactamente el síntoma reportado.
    assert r.headers.get("access-control-allow-origin") == ORIGIN
    assert r.json()["errors"][0]["message"] == MOTIVO


def test_lo_que_pide_confirmacion_sale_409_y_no_500():
    """
    El 409 es lo que le permite al front distinguir "no se puede" de "se puede, pero
    mirá lo que te llevás": con eso muestra el motivo y habilita "Eliminar igual".
    """
    with TestClient(_app_con_cors()) as client:
        r = client.delete("/rangos/13/confirmable", headers={"Origin": ORIGIN})

    assert r.status_code == 409
    assert r.headers.get("access-control-allow-origin") == ORIGIN
    assert r.json()["errors"][0]["message"] == MOTIVO
    assert r.json()["data"]["requiere_confirmacion"] is True


def test_no_queda_ningun_handler_sin_registrar():
    """
    Cada `*_handler` del módulo tiene que estar enchufado.

    Es el guard contra la forma original del bug: escribir el handler y olvidarse de
    sumarlo a la lista.
    """
    app = FastAPI()
    registrar_exception_handlers(app)
    registrados = set(app.exception_handlers.values())

    definidos = [
        fn
        for nombre, fn in vars(exception_handlers).items()
        if nombre.endswith("_handler") and inspect.isfunction(fn)
    ]
    assert definidos, "no se encontró ningún handler en el módulo"

    sin_registrar = [fn.__name__ for fn in definidos if fn not in registrados]
    assert not sin_registrar, f"handlers definidos pero no registrados: {sin_registrar}"


def test_la_app_real_registra_business_exception():
    """El wiring de main.py, que es donde faltaba."""
    main = pytest.importorskip("backend.presentation.main")
    assert BusinessException in main.app.exception_handlers
