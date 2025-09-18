from typing import Any, Optional
from pydantic import BaseModel

class ResponseDTO(BaseModel):
    status: bool = True
    errorDescription: Optional[str] = None
    data: Optional[Any] = None

