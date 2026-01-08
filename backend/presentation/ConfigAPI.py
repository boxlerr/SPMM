
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from backend.infrastructure.ConfigRepository import ConfigRepository

router = APIRouter(prefix="/config", tags=["Configuration"])

class BlockedDateDTO(BaseModel):
    date: str

@router.get("/availability")
def get_blocked_dates():
    repo = ConfigRepository()
    return {"blocked_dates": repo.get_blocked_dates()}

@router.post("/availability")
def add_blocked_date(dto: BlockedDateDTO):
    repo = ConfigRepository()
    repo.add_blocked_date(dto.date)
    return {"message": "Date blocked successfully", "blocked_dates": repo.get_blocked_dates()}

@router.delete("/availability/{date_str}")
def remove_blocked_date(date_str: str):
    repo = ConfigRepository()
    repo.remove_blocked_date(date_str)
    return {"message": "Date unblocked successfully", "blocked_dates": repo.get_blocked_dates()}
