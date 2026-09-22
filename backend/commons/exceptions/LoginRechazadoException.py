from typing import Optional

from backend.commons.exceptions.BusinessException import BusinessException


class LoginRechazadoException(BusinessException):
    """Un login que no entra y que tiene algo más que decir que «incorrecto» (RF-26).

    Hereda de BusinessException a propósito: todo lo que ya atrapaba los errores de
    login —AuthService, AuthAPI, cualquier test— lo sigue atrapando igual. Lo que suma
    es el código HTTP (401 contraseña mala, 423 cuenta bloqueada) y los datos para que
    la pantalla de login pueda mostrar el bloqueo distinto de un error de tipeo.

    El mensaje ya viene armado para leerse tal cual: un front que no sepa nada de
    esto (el que está hoy en producción) lo muestra y alcanza.
    """

    def __init__(
        self,
        message: str,
        *,
        estado_http: int = 401,
        intentos_restantes: Optional[int] = None,
        bloqueado_hasta: Optional[str] = None,
        maximo_intentos: Optional[int] = None,
        minutos_bloqueo: Optional[int] = None,
    ):
        super().__init__(message)
        self.estado_http = estado_http
        self.intentos_restantes = intentos_restantes
        self.bloqueado_hasta = bloqueado_hasta
        self.maximo_intentos = maximo_intentos
        self.minutos_bloqueo = minutos_bloqueo

    def datos(self) -> dict:
        return {
            "bloqueado": self.bloqueado_hasta is not None,
            "bloqueado_hasta": self.bloqueado_hasta,
            "intentos_restantes": self.intentos_restantes,
            "maximo_intentos": self.maximo_intentos,
            "minutos_bloqueo": self.minutos_bloqueo,
        }
