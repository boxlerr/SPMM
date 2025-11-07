from pydantic import BaseModel
from typing import Optional

class ErrorItemDTO(BaseModel):
    campo: Optional[str] = None
    message: str