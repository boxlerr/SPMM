from typing import Any, Optional,List
from pydantic import BaseModel

from backend.dto.ErrorItemDTO import ErrorItemDTO

class ResponseDTO(BaseModel):
    status: bool = True
    errorDescription: Optional[str] = None
    data: Optional[Any] = None
    errors: List[ErrorItemDTO] = []

""""
result: bool
    data: Optional[Any] = None
    errors: List[ErrorItemDTO] = []
"""