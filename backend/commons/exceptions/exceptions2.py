"""# exceptions/app_exceptions.py
class ApplicationException(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)

# domain/exceptions.py
class DomainException(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)

class InfrastructureException(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)

class NotFoundException(ApplicationException):
    def __init__(self, message: str):
        super().__init__(message)"""


