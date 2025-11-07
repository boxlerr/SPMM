"""
DTOs para Notificaciones
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class NotificacionCreateDTO(BaseModel):
    """DTO para crear una notificación"""
    mensaje: str = Field(..., max_length=500, description="Mensaje de la notificación")
    tipo: str = Field(..., description="Tipo de notificación (operario_created, operario_updated, etc.)")
    motivo: Optional[str] = Field(None, description="Motivo o detalles adicionales")
    id_usuario_creador: Optional[int] = Field(None, description="ID del usuario que crea la notificación")

    class Config:
        json_schema_extra = {
            "example": {
                "mensaje": "Operario creado exitosamente",
                "tipo": "operario_created",
                "motivo": None,
                "id_usuario_creador": 1
            }
        }


class NotificacionUpdateDTO(BaseModel):
    """DTO para actualizar una notificación (marcar como leída)"""
    leida: bool = Field(..., description="Estado de lectura de la notificación")

    class Config:
        json_schema_extra = {
            "example": {
                "leida": True
            }
        }


class NotificacionResponseDTO(BaseModel):
    """DTO de respuesta para notificaciones"""
    id_notificacion: int
    mensaje: str
    tipo: str
    leida: bool
    motivo: Optional[str]
    fecha_creacion: datetime
    id_usuario_creador: Optional[int]

    class Config:
        from_attributes = True

