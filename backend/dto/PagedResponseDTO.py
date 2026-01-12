from pydantic import BaseModel
from typing import List, Generic, TypeVar

T = TypeVar('T')

class PagedResponseDTO(BaseModel, Generic[T]):
    data: List[T]
    total_count: int
    page: int
    size: int
    total_pages: int
