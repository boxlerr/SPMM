"""Quién es el DUEÑO de las materias primas: el Sistema Integral (el viejo) o SPMM.

POR QUÉ EXISTE

La reunión del 23/09/2026 decidió que la gestión de materias primas pasa a SPMM, y la
sección «Materia prima» se construyó para eso. Pero el 24/09 Lucas avisó que la semana
del 28/09 hay PRUEBA PILOTO de SPMM en paralelo con el Integral, y que durante la prueba
el Integral sigue siendo el dueño de todo: Carolina y Maxi cargan allá y SPMM tiene que
REFLEJARLO, con las marcas reales y actualizado solo. Recién después de la prueba SPMM
pasa a ser el dueño.

Son dos modos de la misma sección, y se eligen con UNA variable de entorno:

  integral  (por defecto)  SPMM es un ESPEJO del Integral:
              · el sync corre en cada pasada el espejo (scripts/sync_db.py →
                scripts/importar_materia_prima_legacy.importar): gana el Integral;
              · las APIs de materia prima contestan 422 a toda escritura (salvo la vista
                previa del alta, que no escribe): lo que se cargara acá lo pisaría el
                espejo en la pasada siguiente, o peor, quedaría distinto del Integral;
              · GET /materia-prima/catalogos devuelve dueno='integral' y el texto del
                cartel (aviso_dueno) para que la pantalla lo diga.
  spmm      SPMM es el dueño (lo construido): el espejo se apaga, el sync sólo trae
            altas y precios del viejo (paso 7b) y las APIs escriben.

Por defecto 'integral' A PROPÓSITO: un deploy del backend no cambia el comportamiento de
la prueba hasta que alguien ponga la variable en 'spmm'. Cualquier otro valor (vacío, mal
escrito) también es 'integral': ante la duda, SPMM no escribe y refleja.

CÓMO SE PASA A 'spmm' (el día que termina la prueba), sin deploy de código:

    gcloud run services update spmm-backend --region southamerica-east1 \\
        --update-env-vars MATERIA_PRIMA_DUENO=spmm

Eso crea una revisión nueva con la variable y le pasa el tráfico; la próxima pasada del
sync ya no corre el espejo. Para volver atrás, lo mismo con MATERIA_PRIMA_DUENO=integral.

Se lee del entorno en CADA llamada (no al importar el módulo): así el cambio de la
variable no depende de reiniciar nada y los tests la cambian con monkeypatch.setenv.
"""
from __future__ import annotations

import os

from fastapi import Request

from backend.commons.exceptions.BusinessException import BusinessException

VARIABLE = "MATERIA_PRIMA_DUENO"
INTEGRAL = "integral"
SPMM = "spmm"

# Cada cuántos minutos corre el sync, y con él el espejo: el Cloud Scheduler `spmm-sync`
# está en */30 (verificado el 24/09 con gcloud). Lo único que lo usa es el texto del aviso,
# pero el aviso le promete a Carolina y a Maxi cuánto tarda en verse acá lo que cargan en el
# Integral, así que tiene que decir la verdad: si el Scheduler pasa a */10, se cambia acá.
FRECUENCIA_ESPEJO_MIN = 30

# El cartel de la pantalla y el 422 de las escrituras dicen lo mismo: quien intenta
# cargar algo tiene que saber DÓNDE se carga, que no hace falta hacer nada más y cuánto
# tarda en verse (no «al instante»: la pantalla se refresca sola, pero el dato llega con
# el sync).
AVISO_PILOTO = ("Durante la prueba piloto las materias primas se cargan en el Sistema "
                f"Integral; Metlosys las trae de ahí cada {FRECUENCIA_ESPEJO_MIN} minutos.")

# Lo que no escribe aunque sea un POST: la vista previa del alta de un insumo (arma la
# descripción y el código con las reglas del backend). Sin ella la ficha no se puede ni
# mirar armada.
_NO_ESCRIBEN = {("POST", "/materia-prima/insumos/previsualizar")}

_LECTURAS = {"GET", "HEAD", "OPTIONS"}


class EscrituraEnModoEspejo(BusinessException):
    """El 422 de una escritura con el Integral como dueño. Es un BusinessException (el
    mismo 422 y el mismo errors[0].message de siempre) que además pide que el aviso vaya
    en errorDescription: el handler (commons/handlers/exception_handlers.business_handler)
    lo copia de `error_description`. Lo pidió la prueba de punta a punta del 24/09: la
    pantalla y quien mire la respuesta a mano leen uno u otro campo."""

    def __init__(self, mensaje: str = AVISO_PILOTO):
        super().__init__(mensaje)
        self.error_description = mensaje


def dueno() -> str:
    """'integral' o 'spmm', leído del entorno ahora. Lo que no sea 'spmm' es 'integral'."""
    valor = (os.getenv(VARIABLE) or "").strip().lower()
    return SPMM if valor == SPMM else INTEGRAL


def spmm_es_dueno() -> bool:
    return dueno() == SPMM


def aviso_dueno() -> str | None:
    """El texto del cartel de la sección, o None cuando SPMM es el dueño (no hay nada
    que avisar)."""
    return None if spmm_es_dueno() else AVISO_PILOTO


def es_escritura(metodo: str, ruta: str) -> bool:
    """¿Este pedido escribe? Por el método, salvo las rutas de _NO_ESCRIBEN. `ruta` es
    la plantilla de la ruta (/materia-prima/insumos/{id_pieza}), no la dirección."""
    metodo = (metodo or "").upper()
    return metodo not in _LECTURAS and (metodo, ruta) not in _NO_ESCRIBEN


async def solo_si_spmm_es_dueno(request: Request) -> None:
    """Dependencia de los tres routers de materia prima (se cuelga en el APIRouter, así
    vale en cualquier app que los monte). Con el Integral como dueño, toda escritura
    contesta 422 con el aviso de la prueba piloto; las lecturas pasan siempre.

    Corre DESPUÉS de la sesión y la política que main.py cuelga en include_router: sin
    token sigue siendo 401 y sin permiso 403. Y ANTES de validar el cuerpo del pedido:
    el 422 dice por qué no se puede, no qué campo falta.
    """
    if spmm_es_dueno():
        return
    ruta = getattr(request.scope.get("route"), "path", None) or request.url.path
    if es_escritura(request.method, ruta):
        raise EscrituraEnModoEspejo(AVISO_PILOTO)
