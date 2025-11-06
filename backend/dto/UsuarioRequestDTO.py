"""
DTOs para requests relacionados con usuarios
"""
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, validator

class UsuarioCreateDTO(BaseModel):
    """DTO para crear un nuevo usuario"""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)
    nombre: str = Field(..., min_length=1, max_length=100)
    apellido: str = Field(..., min_length=1, max_length=100)
    rol: str = Field(default="admin")
    activo: bool = Field(default=True)
    
    @validator('username')
    def username_alphanumeric(cls, v):
        if not v.replace('_', '').replace('.', '').isalnum():
            raise ValueError('El username solo puede contener letras, números, _ y .')
        return v.lower()
    
    @validator('rol')
    def validate_rol(cls, v):
        if v not in ['admin']:
            raise ValueError('Rol inválido. Solo se permite: admin')
        return v


class UsuarioUpdateDTO(BaseModel):
    """DTO para actualizar un usuario existente"""
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email: Optional[EmailStr] = None
    nombre: Optional[str] = Field(None, min_length=1, max_length=100)
    apellido: Optional[str] = Field(None, min_length=1, max_length=100)
    rol: Optional[str] = None
    activo: Optional[bool] = None
    
    @validator('username')
    def username_alphanumeric(cls, v):
        if v and not v.replace('_', '').replace('.', '').isalnum():
            raise ValueError('El username solo puede contener letras, números, _ y .')
        return v.lower() if v else v
    
    @validator('rol')
    def validate_rol(cls, v):
        if v and v not in ['admin']:
            raise ValueError('Rol inválido. Solo se permite: admin')
        return v


class UsuarioChangePasswordDTO(BaseModel):
    """DTO para cambiar contraseña"""
    current_password: str
    new_password: str = Field(..., min_length=6)
    confirm_password: str
    
    @validator('confirm_password')
    def passwords_match(cls, v, values):
        if 'new_password' in values and v != values['new_password']:
            raise ValueError('Las contraseñas no coinciden')
        return v


class LoginRequestDTO(BaseModel):
    """DTO para login"""
    username: str
    password: str


class ForgotPasswordDTO(BaseModel):
    """DTO para solicitar recuperación de contraseña"""
    email: EmailStr


class ResetPasswordDTO(BaseModel):
    """DTO para resetear contraseña con token"""
    token: str
    new_password: str = Field(..., min_length=6)
    confirm_password: str
    
    @validator('confirm_password')
    def passwords_match(cls, v, values):
        if 'new_password' in values and v != values['new_password']:
            raise ValueError('Las contraseñas no coinciden')
        return v
