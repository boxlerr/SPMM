"""
DTOs para requests relacionados con usuarios
"""
import re
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, validator


# RF-24: el rol es el CÓDIGO de una fila de la tabla `rol` (admin, supervisor, operario
# y los que se creen). Acá sólo se mira la FORMA —minúsculas, sin espacios, hasta 20
# como la columna usuario.rol—; que exista lo mira el endpoint contra la tabla
# (AuthAPI._validar_rol), porque un validador de Pydantic no puede consultar la base.
# Hasta el 22/09 esto aceptaba sólo 'admin'.
_FORMA_DE_ROL = re.compile(r"^[a-z][a-z0-9_]{1,19}$")


def _normalizar_rol(v):
    if v is None:
        return v
    v = str(v).strip().lower()
    if not _FORMA_DE_ROL.match(v):
        raise ValueError(
            "Rol inválido: tiene que ser el código de un rol (por ejemplo admin, "
            "supervisor u operario)."
        )
    return v

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
        return _normalizar_rol(v)


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
        return _normalizar_rol(v) if v else v


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
