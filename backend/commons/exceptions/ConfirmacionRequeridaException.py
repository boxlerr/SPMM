
class ConfirmacionRequeridaException(Exception):
    """
    La operación se puede hacer, pero arrastra algo que el usuario tiene que saber
    antes: gente que pierde una categoría, filas que se van con lo borrado.

    No es un error. Es el paso "¿estás seguro?" con el motivo adentro: el mensaje
    dice qué se pierde y la misma operación repetida con `forzar` la ejecuta.
    """
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)
