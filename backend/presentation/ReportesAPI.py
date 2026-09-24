"""El armador de reportes personalizados del Dashboard (RF-23).

Lo que se puede pedir está en application/ReportesCatalogo.py (catálogo cerrado); cómo
se valida y se corre, en application/ReportesService.py; los guardados, en
application/ReportesGuardadosService.py.

QUÉ PIDE CADA RUTA (core/permisos_rutas.py, «reportes_personalizados»)

El router pide el área Dashboard, que es donde vive el botón: leer para armar, ver y
exportar; editar para guardar. Encima, CADA FUENTE pide lo de la pantalla que muestra esos
datos, y eso lo mira el servicio con los permisos de quien pide (no los de quien guardó el
reporte): la Auditoría, la solapa «Todo lo que se hizo»; la eficiencia de cada persona, la
sección confidencial «Rendimiento por persona»; etc.

CORRER UN REPORTE ES UN GET

El reporte viaja en la dirección (`?config=` con el JSON) y no en el cuerpo de un POST a
propósito: correrlo es LEER, y la política del router lo trata como lectura. Con un POST,
cada vista previa —una por cada cambio en la pantalla— quedaría en la auditoría como
«creó reporte», y para correr uno haría falta el permiso de escribir.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.application import ReportesService as servicio
from backend.application.ReportesGuardadosService import ReporteGuardadoDTO, ReportesGuardadosService
from backend.application.ReportesService import LARGO_MAXIMO_CONFIG, ReporteSinPermiso
from backend.commons.ResponseDTO import ResponseDTO
from backend.core.permisos import PermisosUsuario
from backend.core.security import (
    UsuarioActual,
    get_current_user,
    get_permisos_actuales,
    get_usuario_actual,
)
from backend.infrastructure.db import SessionLocal

router = APIRouter(prefix="/reportes/personalizados")


async def get_db():
    async with SessionLocal() as session:
        yield session


def _prohibido(e: ReporteSinPermiso) -> HTTPException:
    return HTTPException(status_code=403, detail={"message": e.message, "campo": "permiso"})


# 🔹 Qué se puede armar: las fuentes y columnas que ESTA persona puede ver, y los ejemplos
@router.get("/catalogo")
async def catalogo(permisos: PermisosUsuario = Depends(get_permisos_actuales)):
    return ResponseDTO(data=servicio.catalogo(permisos))


# 🔹 Los valores para elegir en los filtros de una fuente (clientes, personas, estados...)
@router.get("/opciones")
async def opciones(
    fuente: str = Query(..., max_length=40),
    db=Depends(get_db),
    permisos: PermisosUsuario = Depends(get_permisos_actuales),
):
    try:
        return ResponseDTO(data=await servicio.opciones(db, fuente, permisos))
    except ReporteSinPermiso as e:
        raise _prohibido(e)


# 🔹 Correr un reporte: la vista previa (50 filas) o todo (hasta 20.000), con los totales
@router.get("/datos")
async def datos(
    config: str = Query(..., max_length=LARGO_MAXIMO_CONFIG),
    vista_previa: bool = False,
    db=Depends(get_db),
    permisos: PermisosUsuario = Depends(get_permisos_actuales),
):
    try:
        return ResponseDTO(data=await servicio.ejecutar(db, config, permisos, vista_previa=vista_previa))
    except ReporteSinPermiso as e:
        raise _prohibido(e)


def _autor(current_user: dict) -> Optional[str]:
    nombre = " ".join(x for x in (current_user.get("nombre"), current_user.get("apellido")) if x)
    return nombre or current_user.get("username")


# 🔹 Los reportes guardados: los propios y los que compartió un admin
@router.get("/guardados")
async def guardados(
    db=Depends(get_db),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    permisos: PermisosUsuario = Depends(get_permisos_actuales),
):
    return ResponseDTO(data=await ReportesGuardadosService(db).listar(usuario.id_usuario, permisos))


# 🔹 Guardar uno nuevo
@router.post("/guardados")
async def guardar(
    dto: ReporteGuardadoDTO,
    db=Depends(get_db),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    current_user: dict = Depends(get_current_user),
    permisos: PermisosUsuario = Depends(get_permisos_actuales),
):
    try:
        return ResponseDTO(data=await ReportesGuardadosService(db).crear(
            dto, usuario.id_usuario, usuario.es_admin, _autor(current_user), permisos))
    except ReporteSinPermiso as e:
        raise _prohibido(e)


# 🔹 Cambiar uno propio (nombre, receta, y si es admin, compartirlo)
@router.put("/guardados/{id_reporte}")
async def editar(
    id_reporte: int,
    dto: ReporteGuardadoDTO,
    db=Depends(get_db),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    permisos: PermisosUsuario = Depends(get_permisos_actuales),
):
    try:
        return ResponseDTO(data=await ReportesGuardadosService(db).editar(
            id_reporte, dto, usuario.id_usuario, usuario.es_admin, permisos))
    except ReporteSinPermiso as e:
        raise _prohibido(e)


# 🔹 Borrar uno propio
@router.delete("/guardados/{id_reporte}")
async def borrar(
    id_reporte: int,
    db=Depends(get_db),
    usuario: UsuarioActual = Depends(get_usuario_actual),
):
    try:
        return ResponseDTO(data=await ReportesGuardadosService(db).borrar(id_reporte, usuario.id_usuario))
    except ReporteSinPermiso as e:
        raise _prohibido(e)
