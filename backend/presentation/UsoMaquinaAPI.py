"""El uso y el mantenimiento preventivo de cada máquina (RF-10), en Recursos › Recurso
maquinaria.

  GET    /maquinarias-uso                          horas del período y estado del
                                                   mantenimiento de TODAS (la tabla)
  GET    /maquinarias/{id}/uso                     los tramos de uso de una máquina
  GET    /maquinarias/{id}/mantenimiento           configuración, estado, historial,
                                                   a quién le llega y avisos que salieron
  PUT    /maquinarias/{id}/mantenimiento           configurar (lo que viene se cambia)
  POST   /maquinarias/{id}/mantenimientos          registrar un mantenimiento hecho
  DELETE /maquinarias/{id}/mantenimientos/{id_r}   borrar uno cargado por error
  GET    /maquinarias-mantenimiento/destinatarios  los usuarios que pueden recibir el aviso

Los tramos de uso no se cargan desde acá: los escribe solo el cambio de estado de los
pasos (infrastructure/UsoMaquinaRepository.py). El aviso lo dispara el cron, en
POST /internal/alertas (main.py).

Qué pide cada ruta: core/permisos_rutas.py, política «maquinas_uso». Las rutas de TODAS
las máquinas van con guion (/maquinarias-uso) y no debajo de /maquinarias/ a propósito:
`GET /maquinarias/{id}` se declara antes y se tragaría «uso» como un id (422).

LOS EMAILS: la lista de usuarios con su email es de la sección confidencial «Usuarios y
permisos». Quien no la tiene ve el email tapado («j•••@hotmail.com»): alcanza para saber
a qué cuenta le llega, no para llevarse la lista.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel

from backend.application.MantenimientoMaquinaService import MantenimientoMaquinaService
from backend.application.PausaService import ahora_ar
from backend.application.UsoMaquinaService import UsoMaquinaService, periodo_de
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user, get_permisos_actuales
from backend.infrastructure.AuditoriaRepository import nombre_de
from backend.infrastructure.db import SessionLocal

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


class ConfigurarMantenimientoDTO(BaseModel):
    """Todo opcional: se cambia sólo lo que viene (exclude_unset). `null` SÍ es un valor:
    «ya no se cuenta por horas», «a nadie»."""
    frecuencia_dias: Optional[int] = None
    cada_horas: Optional[int] = None
    dias_aviso: Optional[int] = None
    # Texto «AAAA-MM-DD» y no `date`: un día del taller, sin zona (ver leer_fecha).
    contar_desde: Optional[str] = None
    destinatarios: Optional[list[int]] = None


class RegistrarMantenimientoDTO(BaseModel):
    fecha: str
    hecho_por: Optional[str] = None
    nota: Optional[str] = None


def _ve_emails(permisos) -> bool:
    """Sólo quien ve la lista de usuarios (sección confidencial) ve los emails enteros."""
    try:
        return bool(permisos and permisos.tiene_seccion("configuracion_usuarios", "read"))
    except Exception:
        return False


def _dejar_dicho(request: Request, frase: str) -> None:
    """La frase de Auditoría › Todo lo que se hizo."""
    try:
        request.state.auditoria = {"frase": frase}
    except Exception:
        pass


@router.get("/maquinarias-uso")
async def resumen(desde: str | None = None, hasta: str | None = None, db=Depends(get_db)):
    """Horas de uso de cada máquina en el período (por defecto, todo) y el estado de su
    mantenimiento. Las que no tuvieron uso no vienen en `horas`."""
    logger.info(f"API - Inicio GET /maquinarias-uso ({desde} → {hasta})")
    p_desde, p_hasta, ini, fin = periodo_de(desde, hasta)
    ahora = ahora_ar()
    horas = await UsoMaquinaService(db).horas_por_maquina(ini, fin, ahora)
    # El mantenimiento aparte y sin romper: si su tabla todavía no está, las horas salen
    # igual y la columna del mantenimiento no se muestra.
    try:
        async with db.begin_nested():
            estados = await MantenimientoMaquinaService(db).estados(ahora)
        mantenimiento = {
            str(id_m): {k: e[k] for k in ("estado", "estado_texto", "proxima_fecha", "dias_restantes",
                                          "vencido_por", "horas_restantes_min")}
            for id_m, e in estados.items()
        }
    except Exception as e:
        logger.warning(f"Uso de máquinas: no se pudo leer el mantenimiento: {e}")
        mantenimiento = None
    return ResponseDTO(status=True, data=jsonable_encoder({
        "periodo": {"desde": p_desde.isoformat() if p_desde else None,
                    "hasta": p_hasta.isoformat() if p_hasta else None},
        "horas": {str(k): v for k, v in horas.items()},
        "mantenimiento": mantenimiento,
    }), errorDescription="")


@router.get("/maquinarias-mantenimiento/destinatarios")
async def destinatarios_posibles(db=Depends(get_db), permisos=Depends(get_permisos_actuales)):
    logger.info("API - Inicio GET /maquinarias-mantenimiento/destinatarios")
    return await MantenimientoMaquinaService(db).destinatarios_posibles(ve_emails=_ve_emails(permisos))


@router.get("/maquinarias/{id_maquinaria}/uso")
async def uso(id_maquinaria: int, desde: str | None = None, hasta: str | None = None,
              db=Depends(get_db)):
    logger.info(f"API - Inicio GET /maquinarias/{id_maquinaria}/uso ({desde} → {hasta})")
    return await UsoMaquinaService(db).uso_de_la_maquina(id_maquinaria, desde, hasta)


@router.get("/maquinarias/{id_maquinaria}/mantenimiento")
async def ver_mantenimiento(id_maquinaria: int, db=Depends(get_db),
                            permisos=Depends(get_permisos_actuales)):
    logger.info(f"API - Inicio GET /maquinarias/{id_maquinaria}/mantenimiento")
    return await MantenimientoMaquinaService(db).ver(id_maquinaria, ve_emails=_ve_emails(permisos))


@router.put("/maquinarias/{id_maquinaria}/mantenimiento")
async def configurar(id_maquinaria: int, dto: ConfigurarMantenimientoDTO, request: Request,
                     db=Depends(get_db), usuario: dict = Depends(get_current_user),
                     permisos=Depends(get_permisos_actuales)):
    logger.info(f"API - Inicio PUT /maquinarias/{id_maquinaria}/mantenimiento")
    salida = await MantenimientoMaquinaService(db).configurar(
        id_maquinaria, dto.model_dump(exclude_unset=True),
        id_usuario=usuario.get("id_usuario"), usuario=nombre_de(usuario),
        ve_emails=_ve_emails(permisos),
    )
    _dejar_dicho(request, f"configuró el mantenimiento de «{salida.data.get('maquina')}»")
    return salida


@router.post("/maquinarias/{id_maquinaria}/mantenimientos")
async def registrar(id_maquinaria: int, dto: RegistrarMantenimientoDTO, request: Request,
                    db=Depends(get_db), usuario: dict = Depends(get_current_user),
                    permisos=Depends(get_permisos_actuales)):
    logger.info(f"API - Inicio POST /maquinarias/{id_maquinaria}/mantenimientos ({dto.fecha})")
    salida = await MantenimientoMaquinaService(db).registrar_hecho(
        id_maquinaria, dto.model_dump(),
        id_usuario=usuario.get("id_usuario"), usuario=nombre_de(usuario),
        ve_emails=_ve_emails(permisos),
    )
    _dejar_dicho(request, f"registró un mantenimiento de «{salida.data.get('maquina')}» "
                          f"del {'/'.join(reversed(str(dto.fecha)[:10].split('-')))}")
    return salida


@router.delete("/maquinarias/{id_maquinaria}/mantenimientos/{id_registro}")
async def borrar(id_maquinaria: int, id_registro: int, request: Request, db=Depends(get_db),
                 permisos=Depends(get_permisos_actuales)):
    logger.info(f"API - Inicio DELETE /maquinarias/{id_maquinaria}/mantenimientos/{id_registro}")
    salida = await MantenimientoMaquinaService(db).borrar_hecho(
        id_maquinaria, id_registro, ve_emails=_ve_emails(permisos))
    _dejar_dicho(request, f"borró un mantenimiento registrado de «{salida.data.get('maquina')}»")
    return salida
