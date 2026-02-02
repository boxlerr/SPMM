from pydantic import BaseModel
from typing import Optional, Any, Literal
from datetime import datetime

class NotificationDTO(BaseModel):
    type: str # e.g., "WORK_ORDER_CREATED"
    message: str
    severity: Literal["info", "warning", "error", "success"] = "info"
    entity: Optional[dict] = None
    created_at: datetime
